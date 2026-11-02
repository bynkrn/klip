#pragma once
#include "packet-ring.hpp"
#include "replay-checkpoint.hpp"
#include "util/platform.h"
#include <fstream>
#include <functional>

namespace ember_replay {
// OBS 33.0.1's documented-in-source obs-ffmpeg-mux wire record. The helper
// accepts original H.264/AAC packets and performs container muxing only.
struct MuxPacket {int64_t pts=0,dts=0;uint32_t size=0,index=0,type=0;bool keyframe=false;uint8_t reserved[3]{};};
static_assert(sizeof(MuxPacket)==32,"OBS mux packet ABI changed");
inline std::wstring wide(const std::string &s){if(s.empty())return{};int count=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,s.data(),(int)s.size(),nullptr,0);if(!count)throw std::runtime_error("Invalid replay path encoding");std::wstring result(count,L'\0');MultiByteToWideChar(CP_UTF8,0,s.data(),(int)s.size(),result.data(),count);return result;}
inline std::wstring quote(const std::wstring &s){std::wstring result=L"\"";size_t slashes=0;for(wchar_t ch:s){if(ch==L'\\'){++slashes;continue;}if(ch==L'\"')result.append(slashes*2+1,L'\\');else result.append(slashes,L'\\');slashes=0;result+=ch;}result.append(slashes*2,L'\\');return result+L'\"';}
class MuxProcess {
 HANDLE input=nullptr,process=nullptr,log=nullptr;
 std::thread deadline;
public:
 explicit MuxProcess(const std::filesystem::path &exe,const std::vector<std::string> &args,const std::filesystem::path &logPath){
  SECURITY_ATTRIBUTES security{sizeof(security),nullptr,TRUE};HANDLE childInput=nullptr;
  if(!CreatePipe(&childInput,&input,&security,1024*1024))throw std::runtime_error("Cannot create replay mux pipe");SetHandleInformation(input,HANDLE_FLAG_INHERIT,0);
  log=CreateFileW(logPath.c_str(),GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_DELETE,&security,CREATE_NEW,FILE_ATTRIBUTE_TEMPORARY|FILE_FLAG_DELETE_ON_CLOSE,nullptr);
  if(log==INVALID_HANDLE_VALUE){CloseHandle(childInput);CloseHandle(input);input=nullptr;log=nullptr;throw std::runtime_error("Cannot create replay mux diagnostics");}
  std::wstring command=quote(exe.wstring());for(const auto &arg:args)command+=L" "+quote(wide(arg));
  STARTUPINFOW startup{};startup.cb=sizeof(startup);startup.dwFlags=STARTF_USESTDHANDLES;startup.hStdInput=childInput;startup.hStdOutput=log;startup.hStdError=log;PROCESS_INFORMATION info{};
  bool started=CreateProcessW(exe.c_str(),command.data(),nullptr,nullptr,TRUE,CREATE_NO_WINDOW,nullptr,exe.parent_path().c_str(),&startup,&info)!=FALSE;CloseHandle(childInput);
  if(!started){CloseHandle(input);CloseHandle(log);input=log=nullptr;throw std::runtime_error("Cannot start the OBS replay mux helper");}
  process=info.hProcess;CloseHandle(info.hThread);
  try{deadline=std::thread([this]{if(WaitForSingleObject(process,120000)==WAIT_TIMEOUT)TerminateProcess(process,124);});}catch(...){TerminateProcess(process,125);CloseHandle(input);CloseHandle(process);CloseHandle(log);input=process=log=nullptr;throw;}
 }
 ~MuxProcess(){finish(false);}
 void write(const void *data,size_t size){const auto *bytes=static_cast<const uint8_t*>(data);while(size){DWORD wrote=0;DWORD part=(DWORD)std::min<size_t>(size,1024*1024);if(!WriteFile(input,bytes,part,&wrote,nullptr)||!wrote)throw std::runtime_error("Replay mux failed while copying encoded packets");bytes+=wrote;size-=wrote;}}
 DWORD finish(bool check=true){if(!process)return 0;if(input){CloseHandle(input);input=nullptr;}if(WaitForSingleObject(process,30000)==WAIT_TIMEOUT){TerminateProcess(process,124);WaitForSingleObject(process,5000);}DWORD code=1;GetExitCodeProcess(process,&code);if(deadline.joinable())deadline.join();CloseHandle(process);process=nullptr;CloseHandle(log);log=nullptr;if(check&&code)throw std::runtime_error("Replay mux helper failed ("+std::to_string(code)+")");return code;}
};
class Output {
 obs_output_t *output;
 std::filesystem::path directory,helper;
 Storage storage;
 int seconds;
 uint64_t limit,reserve,saveReserve;
 std::unique_ptr<Ring> ring;
 std::atomic<bool> active{false},saving{false};
 std::atomic<uint64_t> packetAt{0},videoAt{0},savedSequence{0};
 std::thread saveThread;
 std::mutex state;
 int64_t videoOriginNs=0;
 bool haveVideoOrigin=false;
 std::string failureReason;
 bool recoveryRequested=false;
 std::filesystem::path emergencyManifest;
 std::string heldSnapshotId;
 std::unique_ptr<Snapshot> heldVideoSnapshot;
 std::function<void(const json&)> snapshotObserver;
 std::function<void(const std::string&)> discardObserver;
 static const char *name(void*){return "Ember bounded replay journal";}
 static void *create(obs_data_t *settings,obs_output_t *output){try{return new Output(settings,output);}catch(const std::exception &e){obs_output_set_last_error(output,e.what());return nullptr;}}
 static void destroy(void *data){delete static_cast<Output*>(data);}
 static bool start(void *data){auto &self=*static_cast<Output*>(data);try{if(self.saveThread.joinable())self.saveThread.join();if(!obs_output_can_begin_data_capture(self.output,0)||!obs_output_initialize_encoders(self.output,0))return false;{std::lock_guard<std::mutex> lock(self.state);self.ring=std::make_unique<Ring>(self.storage,self.directory,(int64_t)self.seconds*1000000000LL,self.limit,self.reserve);self.haveVideoOrigin=false;self.videoOriginNs=0;self.failureReason.clear();self.recoveryRequested=false;self.emergencyManifest.clear();self.heldSnapshotId.clear();self.heldVideoSnapshot.reset();}self.packetAt=0;self.videoAt=0;self.active=true;obs_output_begin_data_capture(self.output,0);return true;}catch(const std::exception &e){obs_output_set_last_error(self.output,e.what());return false;}}
 static void stop(void *data,uint64_t){auto &self=*static_cast<Output*>(data);self.active=false;obs_output_end_data_capture(self.output);}
 static void encoded(void *data,encoder_packet *packet){if(!packet)static_cast<Output*>(data)->fail("NVENC or AAC encoding failed");}
 static void packet(obs_output_t*,encoder_packet *packet,encoder_packet_time *timing,void *data){auto &self=*static_cast<Output*>(data);if(!self.active)return;try{self.append(*packet,timing);}catch(const std::exception &e){self.fail(e.what());}}
 void fail(const std::string &message){
  if(!active.exchange(false))return;obs_output_set_last_error(output,message.c_str());
  event("ReplayBufferLimitReached",{{"message",message},{"storage",storage==Storage::Disk?"disk":"ram"},{"historyRetained",false},{"preservingHistory",true}});
  bool busy;{std::lock_guard<std::mutex> lock(state);failureReason=message;busy=saving.load();recoveryRequested=true;}
  try{Snapshot frozen;json identity;{std::lock_guard<std::mutex> lock(state);frozen=ring->snapshot();if(heldSnapshotId.empty()){heldSnapshotId=std::to_string(GetCurrentProcessId())+"-"+std::to_string(os_gettime_ns())+"-"+std::to_string(++savedSequence);heldVideoSnapshot=std::make_unique<Snapshot>(frozen);}identity={{"snapshotId",heldSnapshotId},{"replayStartMonotonicNs",std::to_string(frozen.startNs)},{"replayEndMonotonicNs",std::to_string(frozen.endNs)},{"automatic",true},{"holdWindow",true}};}if(snapshotObserver)snapshotObserver(identity);}catch(const std::exception &e){event("AudioReplayWarning",{{"message",e.what()}});}
  // Deliver a finalized recovery clip before notifying the bridge of a stopped
  // output: the bridge closes native capture as soon as it sees that signal.
  if(!busy){try{save(true);}catch(const std::exception &e){if(saving.load()){std::lock_guard<std::mutex> lock(state);recoveryRequested=true;}else notifyRecovery(message+" Automatic replay preservation failed: "+e.what());}}
 }
 void notifyRecovery(const std::string &message){json detail={{"message",message},{"keepAlive",emergencyManifest.empty()},{"historyRetained",true},{"applicationStemsRetained",emergencyManifest.empty()}};{std::lock_guard<std::mutex> lock(state);if(heldVideoSnapshot){detail["snapshotId"]=heldSnapshotId;detail["replayStartMonotonicNs"]=std::to_string(heldVideoSnapshot->startNs);detail["replayEndMonotonicNs"]=std::to_string(heldVideoSnapshot->endNs);}else if(!ring||!ring->retainedBytes()){detail["historyRetained"]=false;detail["keepAlive"]=false;}}if(!emergencyManifest.empty())detail["recoveryManifest"]=emergencyManifest.u8string();event("ReplayBufferRecoveryRequired",detail);if(!detail["keepAlive"].get<bool>())obs_output_signal_stop(output,OBS_OUTPUT_ERROR);}
 void discardUnlessHeld(const json &identity){bool held;const auto id=identity.at("snapshotId").get<std::string>();{std::lock_guard<std::mutex> lock(state);held=heldSnapshotId==id;}if(!held&&discardObserver)try{discardObserver(id);}catch(...){} }
 void append(const encoder_packet &packet,const encoder_packet_time *timing){
  std::lock_guard<std::mutex> lock(state);if(!ring)return;
  PacketInfo info;info.video=packet.type==OBS_ENCODER_VIDEO;info.keyframe=packet.keyframe;info.pts=packet.pts;info.dts=packet.dts;info.track=(uint32_t)packet.track_idx;info.sysDtsUsec=packet.sys_dts_usec;info.timebaseNum=packet.timebase_num;info.timebaseDen=packet.timebase_den;
  require(info.timebaseNum>0&&info.timebaseDen>0,"Invalid replay packet timebase");
  const auto ptsNs=(int64_t)std::llround((long double)packet.pts*info.timebaseNum*1000000000.0L/info.timebaseDen);
  info.durationNs=info.video?(int64_t)std::llround((long double)info.timebaseNum*1000000000.0L/info.timebaseDen):(int64_t)std::llround((long double)obs_encoder_get_frame_size(packet.encoder)*1000000000.0L/obs_encoder_get_sample_rate(packet.encoder));
  if(info.video){require(timing&&timing->cts,"OBS did not supply the video composition timestamp; cannot guarantee replay/audio alignment");info.presentationNs=(int64_t)timing->cts;if(!haveVideoOrigin){videoOriginNs=info.presentationNs-ptsNs;haveVideoOrigin=true;}videoAt=os_gettime_ns();}
  else {if(!haveVideoOrigin)return;info.presentationNs=videoOriginNs+ptsNs;}
  ring->append(info,packet.data,packet.size);packetAt=os_gettime_ns();
 }
 struct MuxSetup {std::vector<std::string> args;std::vector<std::vector<uint8_t>> headers;std::vector<int> sampleRates;};
 MuxSetup muxSetup(const std::filesystem::path &path){
  MuxSetup setup;auto add=[&](const auto &v){setup.args.push_back(std::to_string(v));};auto *video=obs_output_get_video_encoder(output);obs_video_info info{};obs_get_video_info(&info);
  size_t tracks=0;while(tracks<MAX_OUTPUT_AUDIO_ENCODERS&&obs_output_get_audio_encoder(output,tracks))++tracks;
  setup.args.push_back(path.u8string());add(1);add(tracks);setup.args.push_back(obs_encoder_get_codec(video));
  auto *settings=obs_encoder_get_settings(video);add(obs_data_get_int(settings,"bitrate"));obs_data_release(settings);
  add(obs_output_get_width(output));add(obs_output_get_height(output));add(1);add(1);add(1);add(info.range==VIDEO_RANGE_FULL?2:1);add(1);add(0);add(info.fps_num);add(info.fps_den);add(0);
  auto header=[&](obs_encoder_t *encoder){uint8_t *bytes=nullptr;size_t size=0;require(obs_encoder_get_extra_data(encoder,&bytes,&size)&&bytes&&size,"Replay encoder headers are unavailable");setup.headers.emplace_back(bytes,bytes+size);};header(video);
  if(tracks){setup.args.push_back(obs_encoder_get_codec(obs_output_get_audio_encoder(output,0)));for(size_t i=0;i<tracks;++i){auto *audio=obs_output_get_audio_encoder(output,i);setup.args.push_back(obs_encoder_get_name(audio));auto *s=obs_encoder_get_settings(audio);add(obs_data_get_int(s,"bitrate"));obs_data_release(s);int rate=(int)obs_encoder_get_sample_rate(audio);setup.sampleRates.push_back(rate);add(rate);add(obs_encoder_get_frame_size(audio));add(obs_encoder_get_priming_samples(audio));add(2);header(audio);}}
  setup.args.push_back("");setup.args.push_back("avoid_negative_ts=disabled");return setup;
 }
 static void writePacket(MuxProcess &process,MuxPacket packet,const std::vector<uint8_t> &bytes){packet.size=(uint32_t)bytes.size();process.write(&packet,sizeof(packet));process.write(bytes.data(),bytes.size());}
 void removeAbandonedMuxFiles(){
  std::error_code error;std::filesystem::directory_iterator files(directory,error);if(error)return;
  for(const auto &file:files){auto name=file.path().filename().u8string();const std::string suffix=".partial.mkv";
   if(name.rfind(".Ember-",0)!=0||name.size()<=7+suffix.size()||name.compare(name.size()-suffix.size(),suffix.size(),suffix)!=0||!std::filesystem::is_regular_file(file.symlink_status(error))||error)continue;
   size_t end=name.find('-',7);if(end==std::string::npos)continue;auto pidText=name.substr(7,end-7);if(pidText.empty()||pidText.find_first_not_of("0123456789")!=std::string::npos)continue;
   unsigned long long pid=0;try{pid=std::stoull(pidText);}catch(...){continue;}if(!pid||pid>MAXDWORD)continue;
   HANDLE owner=OpenProcess(SYNCHRONIZE,FALSE,(DWORD)pid);bool abandoned=false;if(owner){abandoned=WaitForSingleObject(owner,0)==WAIT_OBJECT_0;CloseHandle(owner);}else abandoned=GetLastError()==ERROR_INVALID_PARAMETER;
   // Never remove an active save, and never follow links. A sharing violation
   // from a still-finishing orphan helper is harmless; retry next startup.
   if(abandoned)std::filesystem::remove(file.path(),error);
  }
 }
public:
 Output(obs_data_t *settings,obs_output_t *target):output(target),directory(std::filesystem::u8path(obs_data_get_string(settings,"directory"))),helper(std::filesystem::u8path(obs_data_get_string(settings,"mux_helper"))),storage(std::string(obs_data_get_string(settings,"storage"))=="disk"?Storage::Disk:Storage::Ram),seconds((int)obs_data_get_int(settings,"max_time_sec")),limit((uint64_t)obs_data_get_int(settings,"max_size_bytes")),reserve((uint64_t)obs_data_get_int(settings,"min_free_mb")*1048576ULL),saveReserve((uint64_t)obs_data_get_int(settings,"save_min_free_mb")*1048576ULL){removeAbandonedMuxFiles();obs_output_add_packet_callback(output,packet,this);}
 ~Output(){active=false;obs_output_remove_packet_callback(output,packet,this);if(saveThread.joinable())saveThread.join();}
 static Output &from(obs_output_t *output){return *static_cast<Output*>(obs_obj_get_data(output));}
 void setSnapshotObserver(std::function<void(const json&)> observer,std::function<void(const std::string&)> discard={}){snapshotObserver=std::move(observer);discardObserver=std::move(discard);}
 static void registerType(){obs_output_info info{};info.id="ember_replay_journal";info.flags=OBS_OUTPUT_AV|OBS_OUTPUT_ENCODED|OBS_OUTPUT_MULTI_TRACK;info.get_name=name;info.create=create;info.destroy=destroy;info.start=start;info.stop=stop;info.encoded_packet=encoded;info.encoded_video_codecs="h264";info.encoded_audio_codecs="aac";obs_register_output(&info);}
 json status(){std::lock_guard<std::mutex> lock(state);return{{"outputActive",obs_output_active(output)},{"journalAcceptingPackets",active.load()},{"storage",storage==Storage::Disk?"disk":"ram"},{"saving",saving.load()},{"retainedBytes",ring?ring->retainedBytes():0},{"liveBytes",ring?ring->liveBytes():0},{"limitBytes",limit},{"retainedDurationSeconds",ring?ring->retainedSeconds():0},{"lastEncodedPacketMonotonicNs",std::to_string(packetAt.load())},{"lastVideoPacketMonotonicNs",std::to_string(videoAt.load())}};}
 json save(bool automatic=false){
  bool expected=false;require(saving.compare_exchange_strong(expected,true),"A replay save is already in progress");
  try{if(saveThread.joinable())saveThread.join();Snapshot snapshot;std::string id;{std::lock_guard<std::mutex> lock(state);require(ring!=nullptr,"Replay history is unavailable");snapshot=heldVideoSnapshot?*heldVideoSnapshot:ring->snapshot();if(automatic)recoveryRequested=false;id=heldSnapshotId.empty()?std::to_string(GetCurrentProcessId())+"-"+std::to_string(os_gettime_ns())+"-"+std::to_string(++savedSequence):heldSnapshotId;}
   const auto final=directory/("Ember-"+id+".mkv"),partial=directory/(".Ember-"+id+".partial.mkv");
   auto setup=muxSetup(partial);json result={{"snapshotId",id},{"replayStartMonotonicNs",std::to_string(snapshot.startNs)},{"replayEndMonotonicNs",std::to_string(snapshot.endNs)},{"automatic",automatic}};
   if(snapshotObserver)snapshotObserver(result);
   bool fault;{std::lock_guard<std::mutex> lock(state);fault=!failureReason.empty();}
   if(storage==Storage::Disk&&(automatic||fault)){if(emergencyManifest.empty()){auto manifest=directory/("Ember-Recovery-"+id+".json");writeCheckpoint(manifest,snapshot,{{"args",setup.args},{"headers",setup.headers},{"sampleRates",setup.sampleRates}},result);emergencyManifest=manifest;}result["recoveryManifest"]=emergencyManifest.u8string();result["applicationStemsRetained"]=false;}
   std::error_code spaceError;auto space=std::filesystem::space(directory,spaceError);
   if(spaceError||space.available<=snapshot.bytes+saveReserve){
    active=false;{std::lock_guard<std::mutex> lock(state);failureReason="Insufficient free disk space to save the complete replay";heldSnapshotId=id;heldVideoSnapshot=std::make_unique<Snapshot>(snapshot);}
    result["holdWindow"]=true;if(snapshotObserver)snapshotObserver(result);
    if(storage==Storage::Disk&&emergencyManifest.empty()){
     try{auto manifest=directory/("Ember-Recovery-"+id+".json");writeCheckpoint(manifest,snapshot,{{"args",setup.args},{"headers",setup.headers},{"sampleRates",setup.sampleRates}},result);emergencyManifest=manifest;}
     catch(const std::exception &e){saving=false;notifyRecovery(std::string("Keep this capture session open; its recovery checkpoint could not be written: ")+e.what());result["recoveryRequired"]=true;return result;}
    }
    saving=false;notifyRecovery("Insufficient free disk space to save the complete replay. Free space and retry; the retained history has not been discarded.");result["recoveryRequired"]=true;return result;
   }
   saveThread=std::thread([this,snapshot=std::move(snapshot),setup=std::move(setup),final,partial,result]()mutable{
    try{auto outputPath=final,workingPath=partial;
    for(;;){
    if(result.value("automatic",false)&&storage==Storage::Disk){if(emergencyManifest.empty()){auto manifest=directory/("Ember-Recovery-"+result["snapshotId"].get<std::string>()+".json");writeCheckpoint(manifest,snapshot,{{"args",setup.args},{"headers",setup.headers},{"sampleRates",setup.sampleRates}},result);emergencyManifest=manifest;}result["recoveryManifest"]=emergencyManifest.u8string();result["applicationStemsRetained"]=false;}
    if(snapshotObserver)try{snapshotObserver(result);}catch(const std::exception &e){event("AudioReplayWarning",{{"snapshotId",result["snapshotId"]},{"message",e.what()}});}
    bool saved=false;try{MuxProcess process(helper,setup.args,std::filesystem::path(workingPath.wstring()+L".log"));for(size_t i=0;i<setup.headers.size();++i){MuxPacket header;header.type=i?1:0;header.index=i?(uint32_t)i-1:0;writePacket(process,header,setup.headers[i]);}
     const auto &first=snapshot.packets.front().info;const int64_t videoOffset=first.pts;const long double offsetSeconds=(long double)first.pts*first.timebaseNum/first.timebaseDen;
     for(const auto &packet:snapshot.packets){MuxPacket out;out.type=packet.info.video?0:1;out.index=packet.info.track;out.keyframe=packet.info.keyframe;int64_t offset=packet.info.video?videoOffset:(int64_t)std::llround(offsetSeconds*setup.sampleRates.at(packet.info.track));out.pts=packet.info.pts-offset;out.dts=packet.info.dts-offset;writePacket(process,out,snapshot.read(packet));}
     process.finish();require(std::filesystem::exists(workingPath)&&std::filesystem::file_size(workingPath)>0,"Replay mux produced no video file");require(MoveFileExW(workingPath.c_str(),outputPath.c_str(),MOVEFILE_WRITE_THROUGH)!=FALSE,"Cannot finalize saved replay file");result["savedReplayPath"]=outputPath.u8string();result["storage"]=storage==Storage::Disk?"disk":"ram";result["durationSeconds"]=double(snapshot.endNs-snapshot.startNs)/1e9;saved=true;{std::lock_guard<std::mutex> lock(state);if(heldSnapshotId==result["snapshotId"].get<std::string>()){heldSnapshotId.clear();heldVideoSnapshot.reset();}}event("ReplayBufferSaved",result);
    }catch(const std::exception &e){discardUnlessHeld(result);std::error_code ignored;std::filesystem::remove(workingPath,ignored);event("ReplayBufferSaveFailed",{{"snapshotId",result["snapshotId"]},{"message",e.what()}});event("engine-error",{{"message",e.what()}});}
    std::string failure;
    {std::lock_guard<std::mutex> lock(state);if(recoveryRequested){recoveryRequested=false;snapshot=heldVideoSnapshot?*heldVideoSnapshot:ring->snapshot();const auto recoveryId=heldSnapshotId.empty()?std::to_string(GetCurrentProcessId())+"-"+std::to_string(os_gettime_ns())+"-"+std::to_string(++savedSequence):heldSnapshotId;outputPath=directory/("Ember-"+recoveryId+".mkv");workingPath=directory/(".Ember-"+recoveryId+".partial.mkv");setup.args[0]=workingPath.u8string();result={{"snapshotId",recoveryId},{"automatic",true},{"replayStartMonotonicNs",std::to_string(snapshot.startNs)},{"replayEndMonotonicNs",std::to_string(snapshot.endNs)}};continue;}failure=failureReason;saving=false;}
    if(!failure.empty()){if(saved){event("engine-error",{{"message",failure}});obs_output_signal_stop(output,OBS_OUTPUT_ERROR);}else notifyRecovery(failure+" The complete replay could not be muxed; retry recovery after freeing disk space.");}break;
    }}catch(const std::exception &e){discardUnlessHeld(result);saving=false;notifyRecovery(std::string("Replay preservation failed: ")+e.what());}
   });return result;
  }catch(...){saving=false;throw;}
 }
 static json listRecoveries(const std::filesystem::path &directory){json manifests=json::array();std::error_code error;for(const auto &entry:std::filesystem::directory_iterator(directory,error)){auto name=entry.path().filename().u8string();if(name.rfind("Ember-Recovery-",0)!=0||entry.path().extension()!=L".json"||!std::filesystem::is_regular_file(entry.symlink_status()))continue;try{auto data=readCheckpoint(entry.path());auto summary=data.at("snapshot");summary["manifest"]=entry.path().u8string();summary["bytes"]=data["bytes"];manifests.push_back(summary);}catch(...){}}return{{"manifests",manifests}};}
 static json recover(const json &request,const std::filesystem::path &helper){
  auto manifest=std::filesystem::u8path(request.at("manifest").get<std::string>());auto data=readCheckpoint(manifest);auto destination=std::filesystem::u8path(request.value("outputDirectory",manifest.parent_path().u8string()));require(destination.is_absolute(),"Absolute recovery output directory required");std::filesystem::create_directories(destination);const auto id=data.at("snapshot").at("snapshotId").get<std::string>();const auto final=destination/("Ember-Recovered-"+id+"-"+std::to_string(os_gettime_ns())+".mkv"),partial=std::filesystem::path(final.wstring()+L".partial.mkv");std::error_code error;auto space=std::filesystem::space(destination,error);require(!error&&space.available>data.at("bytes").get<uint64_t>()+64*1048576ULL,"Free disk space before recovering the retained replay");
  auto args=data.at("codec").at("args").get<std::vector<std::string>>();require(args.size()>=4,"Invalid recovery mux configuration");args[0]=partial.u8string();auto headers=data["codec"]["headers"].get<std::vector<std::vector<uint8_t>>>();auto rates=data["codec"]["sampleRates"].get<std::vector<int>>();require(headers.size()>=1&&headers.size()<=7&&rates.size()<=6,"Invalid recovery codec headers");
  try{MuxProcess process(helper,args,std::filesystem::path(partial.wstring()+L".log"));for(size_t i=0;i<headers.size();++i){MuxPacket header;header.type=i?1:0;header.index=i?(uint32_t)i-1:0;writePacket(process,header,headers[i]);}const auto &first=data["packets"][0];require(first.size()==13&&first[11].get<bool>()&&first[12].get<bool>(),"Recovery history must begin with a video keyframe");const auto videoOffset=first[3].get<int64_t>();const long double seconds=(long double)videoOffset*first[8].get<int32_t>()/first[9].get<int32_t>();
   for(const auto &record:data["packets"]){require(record.is_array()&&record.size()==13,"Invalid recovery packet metadata");auto index=record[0].get<size_t>();require(index<data["files"].size(),"Invalid recovery segment index");auto file=checkpointPayload(manifest,data["files"][index]);const auto offset=record[1].get<uint64_t>();auto size=record[2].get<uint32_t>();const auto length=std::filesystem::file_size(file);require(size<=32*1048576&&offset<=length&&size<=length-offset,"Recovery packet exceeds its retained segment");std::ifstream input(file,std::ios::binary);input.seekg((std::streamoff)offset);std::vector<uint8_t> payload(size);require(input.read((char*)payload.data(),size).good(),"Cannot read retained replay payload");MuxPacket packet;const bool video=record[11].get<bool>();packet.type=video?0:1;packet.index=record[10].get<uint32_t>();packet.keyframe=record[12].get<bool>();require(video||packet.index<rates.size(),"Invalid recovery audio track");auto adjust=video?videoOffset:(int64_t)std::llround(seconds*rates[packet.index]);packet.pts=record[3].get<int64_t>()-adjust;packet.dts=record[4].get<int64_t>()-adjust;writePacket(process,packet,payload);
   }process.finish();require(MoveFileExW(partial.c_str(),final.c_str(),MOVEFILE_WRITE_THROUGH)!=FALSE,"Cannot finalize recovered replay");
  }catch(...){std::error_code ignored;std::filesystem::remove(partial,ignored);throw;}
  auto result=data["snapshot"];result["savedReplayPath"]=final.u8string();result["recoveryManifest"]=manifest.u8string();result["automatic"]=true;result["recovered"]=true;result["applicationStemsRetained"]=false;event("ReplayBufferSaved",result);return result;
 }
 static json completeRecovery(const json &request){auto manifest=std::filesystem::u8path(request.at("manifest").get<std::string>());auto data=readCheckpoint(manifest);std::vector<std::filesystem::path> files;for(const auto &file:data["files"])files.push_back(checkpointPayload(manifest,file));for(const auto &file:files){std::error_code error;std::filesystem::remove(file,error);require(!error,"Cannot remove completed replay journal payload");}std::filesystem::remove(manifest);for(const auto &file:files){std::error_code ignored;std::filesystem::remove(file.parent_path()/L".preserve",ignored);std::filesystem::remove(file.parent_path(),ignored);}return{{"completed",true}};}
};
}
