#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <objbase.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <functiondiscoverykeys_devpkey.h>
#include <wrl/client.h>
#include <fcntl.h>
#include <io.h>
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <filesystem>
#include <iostream>
#include <mutex>
#include <condition_variable>
#include <array>
#include <unordered_map>
#include <thread>
#include <chrono>
#include <stdexcept>
#include "vendor/json.hpp"
#include "util/c99defs.h"
#undef EXPORT
#define EXPORT __declspec(dllimport)
#include "obs.h"

using json=nlohmann::json;
namespace fs=std::filesystem;
using namespace std::chrono_literals;
static std::mutex wireMutex;
static void send(const json &message){std::lock_guard<std::mutex> lock(wireMutex);std::cout<<message.dump(-1,' ',false,json::error_handler_t::replace)<<'\n'<<std::flush;}
static void event(const char *name,json data=json::object()){send({{"event",name},{"data",std::move(data)}});}
static void logMessage(int level,const char *format,va_list args,void*){if(level>(std::getenv("KLIP_CAPTURE_DEBUG")?LOG_DEBUG:LOG_INFO))return;char text[8192];vsnprintf(text,sizeof(text),format,args);fprintf(stderr,"%s\n",text);fflush(stderr);}
struct Data{obs_data_t *p;explicit Data(const json &value=json::object()):p(obs_data_create_from_json(value.dump().c_str())){if(!p)throw std::runtime_error("Invalid settings JSON");}~Data(){obs_data_release(p);}operator obs_data_t*()const{return p;}Data(const Data&)=delete;};
static std::string value(const char *text){return text?text:"";}
static void require(bool ok,const std::string &message){if(!ok)throw std::runtime_error(message);}
static std::string utf8(const wchar_t *text){if(!text)return{};int size=WideCharToMultiByte(CP_UTF8,0,text,-1,nullptr,0,nullptr,nullptr);if(size<=1)return{};std::string result(size,'\0');WideCharToMultiByte(CP_UTF8,0,text,-1,result.data(),size,nullptr,nullptr);result.pop_back();return result;}
static json defaultAudioEndpointInfo(){
 using Microsoft::WRL::ComPtr;ComPtr<IMMDeviceEnumerator> enumerator;require(SUCCEEDED(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,IID_PPV_ARGS(&enumerator))),"Cannot enumerate audio endpoints");ComPtr<IMMDevice> device;require(SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eRender,eConsole,&device)),"Default audio output is unavailable");
 wchar_t *identifier=nullptr;require(SUCCEEDED(device->GetId(&identifier)),"Cannot read audio endpoint ID");std::string id=utf8(identifier);CoTaskMemFree(identifier);std::string name=id;ComPtr<IPropertyStore> properties;
 if(SUCCEEDED(device->OpenPropertyStore(STGM_READ,&properties))){PROPVARIANT property{};if(SUCCEEDED(properties->GetValue(PKEY_Device_FriendlyName,&property))&&property.vt==VT_LPWSTR)name=utf8(property.pwszVal);PropVariantClear(&property);}
 ComPtr<IAudioClient> client;require(SUCCEEDED(device->Activate(__uuidof(IAudioClient),CLSCTX_ALL,nullptr,&client)),"Cannot inspect audio output format");WAVEFORMATEX *format=nullptr;require(SUCCEEDED(client->GetMixFormat(&format)),"Cannot inspect audio sample rate");json result={{"endpointId",id},{"name",name},{"sampleRate",format->nSamplesPerSec},{"channels",format->nChannels},{"bitsPerSample",format->wBitsPerSample}};CoTaskMemFree(format);
 json roles=json::array();for(auto role:{eConsole,eMultimedia,eCommunications}){ComPtr<IMMDevice> current;if(SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eRender,role,&current))){wchar_t *other=nullptr;if(SUCCEEDED(current->GetId(&other))){if(id==utf8(other))roles.push_back(role==eConsole?"console":role==eMultimedia?"multimedia":"communications");CoTaskMemFree(other);}}}result["defaultRoles"]=roles;return result;
}

class Engine{
 bool initialized=false;
 fs::path root,buffer;
 json config;
 std::unordered_map<std::string,obs_scene_t*> scenes;
 std::unordered_map<std::string,obs_source_t*> inputs;
 obs_output_t *replay=nullptr;
 obs_encoder_t *videoEncoder=nullptr;
 std::array<obs_encoder_t*,6> audioEncoders{};
 std::mutex stopMutex;
 std::condition_variable stopCondition;
 bool outputStopped=true;
 static void onSaved(void *opaque,calldata_t*){
  auto &self=*static_cast<Engine*>(opaque);calldata_t data;calldata_init(&data);
  if(self.replay&&proc_handler_call(obs_output_get_proc_handler(self.replay),"get_last_replay",&data)){
   auto path=value(calldata_string(&data,"path"));if(!path.empty())event("ReplayBufferSaved",{{"savedReplayPath",path}});
  }calldata_free(&data);
 }
 static void onStopped(void *opaque,calldata_t *data){
  auto &self=*static_cast<Engine*>(opaque);int code=(int)calldata_int(data,"code");
  {std::lock_guard<std::mutex> lock(self.stopMutex);self.outputStopped=true;}self.stopCondition.notify_all();
  event("ReplayBufferStateChanged",{{"outputActive",false},{"outputState","OBS_WEBSOCKET_OUTPUT_STOPPED"},{"outputCode",code}});
  if(code)event("engine-error",{{"message","Replay buffer stopped with code "+std::to_string(code)}});
 }
 obs_scene_t *scene(const json &data){auto name=data.value("sceneName",std::string("Klip"));auto it=scenes.find(name);require(it!=scenes.end(),"Scene not found: "+name);return it->second;}
 obs_source_t *input(const json &data){auto name=data.at("inputName").get<std::string>();auto it=inputs.find(name);require(it!=inputs.end(),"Input not found: "+name);return it->second;}
 obs_sceneitem_t *item(const json &data){auto result=obs_scene_find_sceneitem_by_id(scene(data),data.at("sceneItemId").get<int64_t>());require(result!=nullptr,"Scene item not found");return result;}
 void loadModule(const char *name){auto base=root/"core"/name;obs_module_t *module=nullptr;int code=obs_open_module(&module,(base/(std::string(name)+".dll")).generic_u8string().c_str(),(base/"data").generic_u8string().c_str());require(code==MODULE_SUCCESS&&module&&obs_init_module(module),std::string("Cannot load capture module: ")+name+" ("+std::to_string(code)+")");}
 void videoSettings(const json &data){
  obs_video_info info{};info.graphics_module="libobs-d3d11";
  info.base_width=data.value("baseWidth",1920u);info.base_height=data.value("baseHeight",1080u);
  info.output_width=data.value("outputWidth",info.base_width);info.output_height=data.value("outputHeight",info.base_height);
  info.fps_num=data.value("fpsNumerator",60u);info.fps_den=data.value("fpsDenominator",1u);
  require(info.base_width>=16&&info.base_width<=8192&&info.base_height>=16&&info.base_height<=8192&&info.fps_num>=1&&info.fps_num<=360&&info.fps_den==1,"Invalid video dimensions/FPS");
  info.output_format=VIDEO_FORMAT_NV12;info.gpu_conversion=true;info.colorspace=VIDEO_CS_709;info.range=VIDEO_RANGE_PARTIAL;info.scale_type=OBS_SCALE_BICUBIC;
  int result=obs_reset_video(&info);require(result==OBS_VIDEO_SUCCESS,"D3D11 video initialization failed: "+std::to_string(result));
 }
 void prepareReplay(){
  if(replay)return;
  Data videoSettings({{"rate_control","CQP"},{"cqp",16},{"preset","p5"},{"profile","high"},{"keyint_sec",1}});
  videoEncoder=obs_video_encoder_create("obs_nvenc_h264_tex","Klip NVENC",videoSettings,nullptr);
  require(videoEncoder!=nullptr,"NVIDIA NVENC H.264 encoder is unavailable");obs_encoder_set_video(videoEncoder,obs_get_video());
  Data outputSettings({{"directory",buffer.u8string()},{"format","Klip-%CCYY-%MM-%DD-%hh-%mm-%ss"},{"extension","mkv"},{"allow_spaces",true},{"max_time_sec",config.value("duration",120)},{"max_size_mb",4096}});
  replay=obs_output_create("replay_buffer","Klip Replay",outputSettings,nullptr);require(replay!=nullptr,"Replay buffer output is unavailable");
  obs_output_set_video_encoder(replay,videoEncoder);
  for(size_t i=0;i<audioEncoders.size();++i){Data settings({{"bitrate",256}});auto name="Klip AAC "+std::to_string(i+1);audioEncoders[i]=obs_audio_encoder_create("ffmpeg_aac",name.c_str(),settings,i,nullptr);require(audioEncoders[i]!=nullptr,"AAC encoder is unavailable");obs_encoder_set_audio(audioEncoders[i],obs_get_audio());obs_output_set_audio_encoder(replay,audioEncoders[i],i);}
  signal_handler_t *signals=obs_output_get_signal_handler(replay);signal_handler_connect(signals,"saved",onSaved,this);signal_handler_connect(signals,"stop",onStopped,this);
 }
 void prepareVisibleDisplays(){
  for(auto &entry:inputs){auto source=entry.second;if(value(obs_source_get_id(source))!="monitor_capture"||!obs_source_showing(source))continue;
   auto ready=[&]{return obs_source_get_width(source)>0&&obs_source_get_height(source)>0;};
   auto waitReady=[&]{auto until=std::chrono::steady_clock::now()+2s;while(!ready()&&std::chrono::steady_clock::now()<until)std::this_thread::sleep_for(20ms);return ready();};
   if(ready()||waitReady())continue;
   auto settings=obs_source_get_settings(source);bool automatic=obs_data_get_int(settings,"method")==0;
   if(automatic){obs_data_set_int(settings,"method",2);obs_source_update(source,settings);fprintf(stderr,"Display capture unavailable through DXGI; trying Windows Graphics Capture for %s\n",entry.first.c_str());event("CaptureSourceFallback",{{"inputName",entry.first},{"from","dxgi"},{"to","wgc"}});}obs_data_release(settings);
   require(automatic&&waitReady(),"Ekran görüntüsü alınamadı. Ekran yakalama kaynağını kontrol et.");
  }
 }
 void stopOutput(){
  if(!replay||!obs_output_active(replay))return;
  obs_output_stop(replay);
  auto waitStopped=[&](auto duration){auto until=std::chrono::steady_clock::now()+duration;std::unique_lock<std::mutex> lock(stopMutex);while(obs_output_active(replay)&&std::chrono::steady_clock::now()<until)stopCondition.wait_for(lock,20ms);return !obs_output_active(replay);};
  if(!waitStopped(8s)){obs_output_force_stop(replay);require(waitStopped(3s),"Replay buffer stop timed out");}
 }
public:
 ~Engine(){try{shutdown();}catch(...){}}
 void initialize(const json &data){
  require(!initialized,"Capture engine is already initialized");root=fs::u8path(data.at("root").get<std::string>());buffer=fs::u8path(data.at("bufferDir").get<std::string>());config=data.at("config");
  require(root.is_absolute()&&buffer.is_absolute(),"Absolute engine/buffer paths required");fs::create_directories(buffer);
  auto moduleConfig=buffer/"engine-state";fs::create_directories(moduleConfig);
  require(obs_startup("en-US",moduleConfig.u8string().c_str(),nullptr),"Cannot initialize capture core");initialized=true;
  obs_add_data_path((root/"data/libobs").u8string().c_str());
  obs_audio_info audio{};audio.samples_per_sec=48000;audio.speakers=SPEAKERS_STEREO;require(obs_reset_audio(&audio),"Cannot initialize stereo audio");
  auto resolution=config.value("resolution",std::string("1920x1080"));auto split=resolution.find('x');require(split!=std::string::npos,"Invalid resolution");
  unsigned fps=config.value("fps",std::string("60"))=="custom"?config.value("customFps",90):std::stoul(config.value("fps",std::string("60")));
  videoSettings({{"baseWidth",std::stoul(resolution.substr(0,split))},{"baseHeight",std::stoul(resolution.substr(split+1))},{"fpsNumerator",fps}});
  for(auto name:{"win-capture","win-wasapi","obs-nvenc","obs-ffmpeg"})loadModule(name);obs_post_load_modules();
 }
 void shutdown(){
  if(!initialized)return;stopOutput();
  if(replay){signal_handler_disconnect(obs_output_get_signal_handler(replay),"saved",onSaved,this);signal_handler_disconnect(obs_output_get_signal_handler(replay),"stop",onStopped,this);obs_output_release(replay);replay=nullptr;}
  if(videoEncoder){obs_encoder_release(videoEncoder);videoEncoder=nullptr;}for(auto &encoder:audioEncoders)if(encoder){obs_encoder_release(encoder);encoder=nullptr;}
  obs_set_output_source(0,nullptr);for(auto &entry:scenes)obs_scene_release(entry.second);scenes.clear();for(auto &entry:inputs)obs_source_release(entry.second);inputs.clear();
  obs_shutdown();initialized=false;
 }
 json call(const std::string &type,const json &data){
  if(type=="Initialize"){initialize(data);return{{"version",obs_get_version_string()},{"engine","Klip.Capture"}};}
  if(type=="Close"){shutdown();return json::object();}
  if(type=="GetDefaultAudioEndpointInfo")return defaultAudioEndpointInfo();
  require(initialized,"Capture engine is not initialized");
  if(type=="GetSceneList"){json list=json::array();for(auto &entry:scenes)list.push_back({{"sceneName",entry.first}});return{{"scenes",list}};}
  if(type=="CreateScene"){auto name=data.at("sceneName").get<std::string>();require(!scenes.count(name),"Scene already exists");auto created=obs_scene_create(name.c_str());require(created!=nullptr,"Cannot create scene");scenes[name]=created;return json::object();}
  if(type=="SetCurrentProgramScene"){obs_set_output_source(0,obs_scene_get_source(scene(data)));return json::object();}
  if(type=="GetInputKindList"){json kinds=json::array();const char *kind=nullptr;for(size_t i=0;obs_enum_input_types(i,&kind);++i)kinds.push_back(kind);return{{"inputKinds",kinds}};}
  if(type=="GetInputList"){json list=json::array();for(auto &entry:inputs)list.push_back({{"inputName",entry.first},{"inputKind",obs_source_get_id(entry.second)}});return{{"inputs",list}};}
  if(type=="CreateInput"){
   auto name=data.at("inputName").get<std::string>(),kind=data.at("inputKind").get<std::string>();require(!inputs.count(name),"Input already exists");
   auto actualSettings=data.value("inputSettings",json::object()),initialSettings=actualSettings;double initialOffset=data.value("inputAudioSyncOffset",0.0);require(std::isfinite(initialOffset)&&initialOffset>=-2000&&initialOffset<=2000,"Invalid initial audio sync offset");bool staged=initialOffset!=0;
   if(staged){require(kind=="wasapi_output_capture"||kind=="wasapi_process_output_capture","Initial calibration is supported only for output audio capture");if(kind=="wasapi_output_capture")initialSettings["device_id"]="__klip_unbound_audio_endpoint__";else initialSettings["window"]="";}
   Data settings(initialSettings);auto source=obs_source_create(kind.c_str(),name.c_str(),settings,nullptr);require(source!=nullptr,"Cannot create input: "+kind);
   if(staged){obs_source_set_sync_offset(source,(int64_t)std::llround(initialOffset*1000000.0));Data actual(actualSettings);obs_source_update(source,actual);}
   auto added=obs_scene_add(scene(data),source);if(!added){obs_source_release(source);throw std::runtime_error("Cannot add source to scene");}inputs[name]=source;
   obs_sceneitem_set_visible(added,data.value("sceneItemEnabled",true));return{{"sceneItemId",obs_sceneitem_get_id(added)}};
  }
  if(type=="SetInputSettings"){auto source=input(data);Data patch(data.at("inputSettings"));if(data.value("overlay",true)){obs_data_t *settings=obs_source_get_settings(source);obs_data_apply(settings,patch);obs_source_update(source,settings);obs_data_release(settings);}else obs_source_update(source,patch);return json::object();}
  if(type=="GetInputSettings"){auto source=input(data);auto settings=obs_source_get_settings(source);auto result=json::parse(obs_data_get_json(settings));obs_data_release(settings);return{{"inputSettings",result},{"inputKind",obs_source_get_id(source)}};}
  if(type=="GetInputPropertiesListPropertyItems"){
   auto source=input(data);auto properties=obs_source_properties(source);require(properties!=nullptr,"Input has no properties");auto name=data.at("propertyName").get<std::string>();auto property=obs_properties_get(properties,name.c_str());
   if(!property){obs_properties_destroy(properties);throw std::runtime_error("Input property not found: "+name);}json list=json::array();auto format=obs_property_list_format(property);
   for(size_t i=0;i<obs_property_list_item_count(property);++i){json v;if(format==OBS_COMBO_FORMAT_INT)v=obs_property_list_item_int(property,i);else if(format==OBS_COMBO_FORMAT_FLOAT)v=obs_property_list_item_float(property,i);else if(format==OBS_COMBO_FORMAT_BOOL)v=obs_property_list_item_bool(property,i);else v=value(obs_property_list_item_string(property,i));list.push_back({{"itemName",value(obs_property_list_item_name(property,i))},{"itemValue",v},{"itemEnabled",!obs_property_list_item_disabled(property,i)}});}obs_properties_destroy(properties);return{{"propertyItems",list}};
  }
  if(type=="SetInputMute"){obs_source_set_muted(input(data),data.at("inputMuted").get<bool>());return json::object();}
  if(type=="GetInputMute")return{{"inputMuted",obs_source_muted(input(data))}};
  if(type=="GetInputAudioSyncOffset")return{{"inputAudioSyncOffset",double(obs_source_get_sync_offset(input(data)))/1000000.0}};
  if(type=="SetInputAudioSyncOffset"){double milliseconds=data.at("inputAudioSyncOffset").get<double>();require(std::isfinite(milliseconds)&&milliseconds>=-2000&&milliseconds<=2000,"Invalid audio sync offset");obs_source_set_sync_offset(input(data),(int64_t)std::llround(milliseconds*1000000.0));return json::object();}
  if(type=="SetInputAudioTracks"){uint32_t mask=0;auto tracks=data.at("inputAudioTracks");for(unsigned i=1;i<=6;++i)if(tracks.value(std::to_string(i),false))mask|=1u<<(i-1);obs_source_set_audio_mixers(input(data),mask);return json::object();}
  if(type=="GetInputAudioTracks"){uint32_t mask=obs_source_get_audio_mixers(input(data));json tracks=json::object();for(unsigned i=1;i<=6;++i)tracks[std::to_string(i)]=(mask&(1u<<(i-1)))!=0;return{{"inputAudioTracks",tracks}};}
  if(type=="GetSceneItemList"){json list=json::array();obs_scene_enum_items(scene(data),[](obs_scene_t*,obs_sceneitem_t *item,void *opaque){auto &out=*static_cast<json*>(opaque);auto source=obs_sceneitem_get_source(item);out.push_back({{"sceneItemId",obs_sceneitem_get_id(item)},{"sourceName",obs_source_get_name(source)},{"sceneItemIndex",obs_sceneitem_get_order_position(item)},{"sceneItemEnabled",obs_sceneitem_visible(item)}});return true;},&list);return{{"sceneItems",list}};}
  if(type=="SetSceneItemEnabled"){auto target=item(data);bool enabled=data.at("sceneItemEnabled").get<bool>();if(obs_sceneitem_visible(target)!=enabled)obs_sceneitem_set_visible(target,enabled);require(obs_sceneitem_visible(target)==enabled,"Cannot update source visibility");return json::object();}
  if(type=="SetSceneItemIndex"){obs_sceneitem_set_order_position(item(data),data.at("sceneItemIndex").get<int>());return json::object();}
  if(type=="SetSceneItemTransform"){
   auto target=item(data);auto t=data.at("sceneItemTransform");obs_transform_info info{};obs_sceneitem_get_info2(target,&info);
   info.pos.x=t.value("positionX",info.pos.x);info.pos.y=t.value("positionY",info.pos.y);info.rot=t.value("rotation",info.rot);info.scale.x=t.value("scaleX",info.scale.x);info.scale.y=t.value("scaleY",info.scale.y);
   auto bounds=t.value("boundsType",std::string());if(!bounds.empty())info.bounds_type=bounds=="OBS_BOUNDS_STRETCH"?OBS_BOUNDS_STRETCH:bounds=="OBS_BOUNDS_SCALE_INNER"?OBS_BOUNDS_SCALE_INNER:OBS_BOUNDS_NONE;
   info.bounds.x=t.value("boundsWidth",info.bounds.x);info.bounds.y=t.value("boundsHeight",info.bounds.y);info.bounds_alignment=t.value("boundsAlignment",info.bounds_alignment);info.alignment=OBS_ALIGN_TOP|OBS_ALIGN_LEFT;obs_sceneitem_set_info2(target,&info);
   obs_sceneitem_crop crop{};obs_sceneitem_get_crop(target,&crop);crop.left=t.value("cropLeft",crop.left);crop.top=t.value("cropTop",crop.top);crop.right=t.value("cropRight",crop.right);crop.bottom=t.value("cropBottom",crop.bottom);obs_sceneitem_set_crop(target,&crop);return json::object();
  }
  if(type=="GetSceneItemTransform"){auto target=item(data);auto source=obs_sceneitem_get_source(target);obs_transform_info info{};obs_sceneitem_get_info2(target,&info);obs_sceneitem_crop crop{};obs_sceneitem_get_crop(target,&crop);const char *bounds[]={"OBS_BOUNDS_NONE","OBS_BOUNDS_STRETCH","OBS_BOUNDS_SCALE_INNER","OBS_BOUNDS_SCALE_OUTER","OBS_BOUNDS_SCALE_TO_WIDTH","OBS_BOUNDS_SCALE_TO_HEIGHT","OBS_BOUNDS_MAX_ONLY"};return{{"sceneItemTransform",{{"sourceWidth",obs_source_get_width(source)},{"sourceHeight",obs_source_get_height(source)},{"positionX",info.pos.x},{"positionY",info.pos.y},{"rotation",info.rot},{"alignment",info.alignment},{"boundsType",bounds[info.bounds_type]},{"boundsWidth",info.bounds.x},{"boundsHeight",info.bounds.y},{"boundsAlignment",info.bounds_alignment},{"scaleX",info.scale.x},{"scaleY",info.scale.y},{"cropLeft",crop.left},{"cropTop",crop.top},{"cropRight",crop.right},{"cropBottom",crop.bottom}}}};}
  if(type=="SetStudioModeEnabled"){require(!data.value("studioModeEnabled",false),"Studio mode is not available");return json::object();}
  if(type=="SetVideoSettings"){videoSettings(data);return json::object();}
  if(type=="GetVideoSettings"){obs_video_info info{};obs_get_video_info(&info);return{{"baseWidth",info.base_width},{"baseHeight",info.base_height},{"outputWidth",info.output_width},{"outputHeight",info.output_height},{"fpsNumerator",info.fps_num},{"fpsDenominator",info.fps_den}};}
  if(type=="StartReplayBuffer"){prepareVisibleDisplays();prepareReplay();require(!obs_output_active(replay),"Replay buffer already running");{std::lock_guard<std::mutex> lock(stopMutex);outputStopped=false;}if(!obs_output_start(replay)){std::lock_guard<std::mutex> lock(stopMutex);outputStopped=true;throw std::runtime_error("Cannot start NVENC replay buffer: "+value(obs_output_get_last_error(replay))+" "+value(obs_encoder_get_last_error(videoEncoder)));}return json::object();}
  if(type=="StopReplayBuffer"){stopOutput();return json::object();}
  if(type=="GetReplayBufferStatus")return{{"outputActive",replay&&obs_output_active(replay)}};
  if(type=="SaveReplayBuffer"){require(replay&&obs_output_active(replay),"Replay buffer is not running");calldata_t args;calldata_init(&args);bool ok=proc_handler_call(obs_output_get_proc_handler(replay),"save",&args);calldata_free(&args);require(ok,"Cannot request replay save");return json::object();}
  throw std::runtime_error("Unsupported capture request: "+type);
 }
};

int main(){
 SetErrorMode(SEM_FAILCRITICALERRORS|SEM_NOGPFAULTERRORBOX);CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);base_set_log_handler(logMessage,nullptr);
 _setmode(_fileno(stdin),_O_BINARY);_setmode(_fileno(stdout),_O_BINARY);
 Engine engine;event("bridge-ready");std::string line;
 while(std::getline(std::cin,line)){json request;try{require(line.size()<=1024*1024,"Capture request too large");request=json::parse(line);auto type=request.at("type").get<std::string>();auto result=engine.call(type,request.value("data",json::object()));send({{"id",request.at("id")},{"data",result}});if(type=="Close")break;}catch(const std::exception &error){send({{"id",request.value("id",json(nullptr))},{"error",error.what()}});}}
 try{engine.shutdown();}catch(const std::exception &error){fprintf(stderr,"Shutdown: %s\n",error.what());}CoUninitialize();return 0;
}
