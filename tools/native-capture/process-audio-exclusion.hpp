#pragma once
#include <audioclientactivationparams.h>
#include <wrl/implements.h>
#include <future>
#include <vector>
#include <functional>
#include <unordered_map>
#include "util/platform.h"

// Unlike the stock OBS process source, this takes a root PID rather than a
// window and uses Windows' exclusion mode. Never fall back to endpoint loopback:
// that would silently put Ember notifications back into the recording.
namespace ember_audio {
using RawSink=std::function<void(const float*,uint32_t,int64_t)>;
inline std::mutex sinkMutex;
inline std::unordered_map<obs_source_t*,RawSink> sinks;
inline void setRawSink(obs_source_t *source,RawSink sink){std::lock_guard<std::mutex> lock(sinkMutex);if(sink)sinks[source]=std::move(sink);else sinks.erase(source);}
inline void submitRaw(obs_source_t *source,const float *samples,uint32_t frames,int64_t timestamp){std::lock_guard<std::mutex> lock(sinkMutex);auto found=sinks.find(source);if(found!=sinks.end())found->second(samples,frames,timestamp);}
using Microsoft::WRL::ComPtr;
using ActivateFn=HRESULT(STDAPICALLTYPE *)(LPCWSTR,REFIID,PROPVARIANT*,IActivateAudioInterfaceCompletionHandler*,IActivateAudioInterfaceAsyncOperation**);
inline void check(HRESULT hr,const char *operation){if(FAILED(hr)){char message[256];snprintf(message,sizeof(message),"%s (0x%08lX)",operation,(unsigned long)hr);throw std::runtime_error(message);}}
struct Handle {
 HANDLE value=nullptr;
 explicit Handle(bool manual=false):value(CreateEventW(nullptr,manual,FALSE,nullptr)){if(!value)throw std::runtime_error("Cannot create audio capture event");}
 ~Handle(){CloseHandle(value);}
 Handle(const Handle&)=delete;
};
struct Module {
 HMODULE value=LoadLibraryW(L"Mmdevapi.dll");
 ~Module(){if(value)FreeLibrary(value);}
};
class Activation final:public Microsoft::WRL::RuntimeClass<Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,Microsoft::WRL::FtmBase,IActivateAudioInterfaceCompletionHandler> {
 Handle ready;
 HRESULT result=E_PENDING;
 ComPtr<IUnknown> activated;
public:
 HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation *operation) override {
  HRESULT activationResult=E_FAIL;HRESULT hr=operation->GetActivateResult(&activationResult,&activated);result=FAILED(hr)?hr:activationResult;SetEvent(ready.value);return S_OK;
 }
 ComPtr<IAudioClient> wait(){
  if(WaitForSingleObject(ready.value,10000)!=WAIT_OBJECT_0)throw std::runtime_error("Audio exclusion activation timed out");
  check(result,"Windows audio process exclusion is unavailable");ComPtr<IAudioClient> client;check(activated.As(&client),"Cannot obtain exclusion audio client");return client;
 }
};
class Source {
 obs_source_t *source;
 DWORD target;
 bool include;
 Handle stop{true};
 std::thread worker;
 void capture(std::promise<void> started){
  bool acknowledged=false;HRESULT com=CoInitializeEx(nullptr,COINIT_MULTITHREADED);
  try{
   check(com,"Cannot initialize audio exclusion COM");
   // Resolve at runtime so older Windows versions fail visibly rather than
   // failing to launch the host. This also works without a stock WASAPI source.
   Module module;
   auto activate=module.value?reinterpret_cast<ActivateFn>(GetProcAddress(module.value,"ActivateAudioInterfaceAsync")):nullptr;
   if(!activate)throw std::runtime_error("Windows audio process exclusion requires Windows 10 build 20348 or later");
   AUDIOCLIENT_ACTIVATION_PARAMS activation{};activation.ActivationType=AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
   activation.ProcessLoopbackParams.TargetProcessId=target;
   activation.ProcessLoopbackParams.ProcessLoopbackMode=include?PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE:PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
   PROPVARIANT parameters{};parameters.vt=VT_BLOB;parameters.blob.cbSize=sizeof(activation);parameters.blob.pBlobData=reinterpret_cast<BYTE*>(&activation);
   auto completion=Microsoft::WRL::Make<Activation>();ComPtr<IActivateAudioInterfaceAsyncOperation> pending;
   check(activate(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,__uuidof(IAudioClient),&parameters,completion.Get(),&pending),"Cannot request system audio excluding Ember");
   auto client=completion->wait();
   WAVEFORMATEX format{};format.wFormatTag=WAVE_FORMAT_IEEE_FLOAT;format.nChannels=2;format.nSamplesPerSec=48000;format.wBitsPerSample=32;format.nBlockAlign=8;format.nAvgBytesPerSec=384000;
   check(client->Initialize(AUDCLNT_SHAREMODE_SHARED,AUDCLNT_STREAMFLAGS_LOOPBACK|AUDCLNT_STREAMFLAGS_EVENTCALLBACK,2000000,0,&format,nullptr),"Cannot initialize audio exclusion");
   Handle samples;check(client->SetEventHandle(samples.value),"Cannot register audio exclusion event");
   ComPtr<IAudioCaptureClient> packets;check(client->GetService(IID_PPV_ARGS(&packets)),"Cannot obtain exclusion audio packets");
   check(client->Start(),"Cannot start audio exclusion");started.set_value();acknowledged=true;
   HANDLE signals[]={stop.value,samples.value};std::vector<float> silence;
   while(true){
    DWORD wait=WaitForMultipleObjects(2,signals,FALSE,100);if(wait==WAIT_OBJECT_0)break;if(wait==WAIT_FAILED)throw std::runtime_error("Audio exclusion event failed");
    UINT32 next=0;check(packets->GetNextPacketSize(&next),"Cannot inspect exclusion audio packet");
    while(next){
     BYTE *bytes=nullptr;UINT32 frames=0;DWORD flags=0;UINT64 device=0,qpc=0;
     check(packets->GetBuffer(&bytes,&frames,&flags,&device,&qpc),"Cannot read exclusion audio packet");
     // Process-loopback QPC timestamps use 100 ns units, like stock WASAPI.
     obs_source_audio audio{};audio.frames=frames;audio.speakers=SPEAKERS_STEREO;audio.format=AUDIO_FORMAT_FLOAT;audio.samples_per_sec=48000;
     audio.timestamp=(flags&AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR)?os_gettime_ns()-(uint64_t)frames*1000000000ULL/48000:qpc*100;
     if(flags&AUDCLNT_BUFFERFLAGS_SILENT){silence.assign((size_t)frames*2,0.0f);audio.data[0]=reinterpret_cast<uint8_t*>(silence.data());}else audio.data[0]=bytes;
     submitRaw(source,reinterpret_cast<const float*>(audio.data[0]),frames,(int64_t)audio.timestamp+obs_source_get_sync_offset(source));
     if(!include||obs_source_get_audio_mixers(source))obs_source_output_audio(source,&audio);check(packets->ReleaseBuffer(frames),"Cannot release exclusion audio packet");
     check(packets->GetNextPacketSize(&next),"Cannot inspect next exclusion audio packet");
    }
   }
   client->Stop();
  }catch(...){
   if(!acknowledged)started.set_exception(std::current_exception());
   else {try{throw;}catch(const std::exception &error){event(include?"AudioReplayWarning":"engine-error",{{"message",std::string(include?"Application audio capture stopped: ":"System audio exclusion stopped: ")+error.what()},{"inputName",obs_source_get_name(source)}});}}
  }
  if(SUCCEEDED(com))CoUninitialize();
 }
public:
 Source(obs_data_t *settings,obs_source_t *source):source(source),target((DWORD)obs_data_get_int(settings,"target_process_id")),include(std::string(obs_source_get_id(source))=="ember_process_audio_capture"){
  if(!target)target=(DWORD)obs_data_get_int(settings,"process_id");
  if(!target)throw std::runtime_error("Ember root process ID is required for audio exclusion");
  obs_source_set_sync_offset(source,obs_data_get_int(settings,"__ember_initial_sync_offset_ns"));
  if(include)obs_source_set_audio_mixers(source,0);
  std::promise<void> started;auto ready=started.get_future();worker=std::thread(&Source::capture,this,std::move(started));
  try{ready.get();}catch(...){SetEvent(stop.value);worker.join();throw;}
 }
 ~Source(){setRawSink(source,{});SetEvent(stop.value);if(worker.joinable())worker.join();}
};
inline const char *name(void*){return "System audio excluding Ember";}
inline const char *processName(void*){return "Application process audio";}
// libobs can return an obs_source_t even when its create callback returned null.
// The synchronous bridge must explicitly reject that inert source.
inline thread_local std::string creationError;
inline void *create(obs_data_t *settings,obs_source_t *source){creationError.clear();try{return new Source(settings,source);}catch(const std::exception &error){creationError=error.what();fprintf(stderr,"Ember audio exclusion: %s\n",error.what());return nullptr;}}
inline void destroy(void *source){delete static_cast<Source*>(source);}
inline void registerSource(){obs_source_info info{};info.id="ember_system_audio_capture";info.type=OBS_SOURCE_TYPE_INPUT;info.output_flags=OBS_SOURCE_AUDIO|OBS_SOURCE_DO_NOT_DUPLICATE;info.get_name=name;info.create=create;info.destroy=destroy;obs_register_source_s(&info,sizeof(info));info.id="ember_process_audio_capture";info.get_name=processName;obs_register_source_s(&info,sizeof(info));}
}
