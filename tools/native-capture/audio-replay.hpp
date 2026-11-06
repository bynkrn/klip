#pragma once
#include "audio-journal.hpp"
#include "replay-checkpoint.hpp"
#include "audio-tree-policy.hpp"
#include <audiopolicy.h>
#include <tlhelp32.h>
#include <map>
#include <set>
#include <cwctype>

namespace ember_audio_replay {
using Microsoft::WRL::ComPtr;
inline std::wstring lower(std::wstring text){for(auto &ch:text)ch=(wchar_t)std::towlower(ch);return text;}
inline std::string toUtf8(const std::wstring &text){if(text.empty())return{};int count=WideCharToMultiByte(CP_UTF8,0,text.data(),(int)text.size(),nullptr,0,nullptr,nullptr);std::string result(count,'\0');WideCharToMultiByte(CP_UTF8,0,text.data(),(int)text.size(),result.data(),count,nullptr,nullptr);return result;}
struct Process {DWORD parent=0;std::wstring path;};
inline std::unordered_map<DWORD,Process> processes(){
 std::unordered_map<DWORD,Process> result;HANDLE snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);if(snapshot==INVALID_HANDLE_VALUE)return result;PROCESSENTRY32W entry{};entry.dwSize=sizeof(entry);if(Process32FirstW(snapshot,&entry))do{result[entry.th32ProcessID]={entry.th32ParentProcessID,{}};}while(Process32NextW(snapshot,&entry));CloseHandle(snapshot);return result;
}
inline std::wstring processPath(DWORD pid,std::unordered_map<DWORD,Process> &all){auto found=all.find(pid);if(found!=all.end()&&!found->second.path.empty())return found->second.path;HANDLE process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid);if(!process)return{};std::wstring path(32768,L'\0');DWORD size=(DWORD)path.size();if(!QueryFullProcessImageNameW(process,0,path.data(),&size))size=0;CloseHandle(process);path.resize(size);if(found!=all.end())found->second.path=path;return path;}
inline bool descendant(DWORD pid,DWORD root,const std::unordered_map<DWORD,Process> &all){if(!root)return false;for(int depth=0;pid&&depth<128;++depth){if(pid==root)return true;auto found=all.find(pid);if(found==all.end()||found->second.parent==pid)break;pid=found->second.parent;}return false;}
inline DWORD appRoot(DWORD pid,const std::wstring &path,std::unordered_map<DWORD,Process> &all){std::set<DWORD> seen;const auto expected=lower(path);for(int depth=0;depth<128&&seen.insert(pid).second;++depth){auto found=all.find(pid);if(found==all.end()||!found->second.parent||found->second.parent==pid)break;DWORD parent=found->second.parent;if(lower(processPath(parent,all))!=expected)break;pid=parent;}return pid;}
inline json sessionInventory(DWORD excluded){
 auto all=processes();ComPtr<IMMDeviceEnumerator> devices;ember_audio::check(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,IID_PPV_ARGS(&devices)),"Cannot enumerate application audio endpoints");ComPtr<IMMDeviceCollection> endpoints;ember_audio::check(devices->EnumAudioEndpoints(eRender,DEVICE_STATE_ACTIVE,&endpoints),"Cannot enumerate render endpoints");UINT count=0;endpoints->GetCount(&count);
 struct Group {std::wstring path;std::set<DWORD> roots;bool active=false;};std::map<std::wstring,Group> groups;json warnings=json::array();
 for(UINT endpoint=0;endpoint<count;++endpoint){ComPtr<IMMDevice> device;if(FAILED(endpoints->Item(endpoint,&device)))continue;ComPtr<IAudioSessionManager2> manager;if(FAILED(device->Activate(__uuidof(IAudioSessionManager2),CLSCTX_ALL,nullptr,&manager)))continue;ComPtr<IAudioSessionEnumerator> sessions;if(FAILED(manager->GetSessionEnumerator(&sessions)))continue;int size=0;sessions->GetCount(&size);
  for(int index=0;index<size;++index){ComPtr<IAudioSessionControl> session;if(FAILED(sessions->GetSession(index,&session)))continue;ComPtr<IAudioSessionControl2> details;if(FAILED(session.As(&details))||details->IsSystemSoundsSession()==S_OK)continue;DWORD pid=0;if(FAILED(details->GetProcessId(&pid))||!pid||descendant(pid,excluded,all)||descendant(pid,GetCurrentProcessId(),all))continue;AudioSessionState state=AudioSessionStateExpired;if(FAILED(details->GetState(&state))||state==AudioSessionStateExpired)continue;auto path=processPath(pid,all);if(path.empty())continue;DWORD root=appRoot(pid,path,all);if(descendant(root,excluded,all))continue;auto &group=groups[lower(path)];group.path=path;group.roots.insert(root);group.active=group.active||state==AudioSessionStateActive;
  }
 }
 json result=json::array();for(const auto &pair:groups){const auto &group=pair.second;json roots=json::array();for(auto pid:group.roots)roots.push_back(pid);result.push_back({{"id","app:"+toUtf8(pair.first)},{"name",std::filesystem::path(group.path).stem().u8string()},{"exePath",toUtf8(group.path)},{"processId",*group.roots.begin()},{"roots",roots},{"active",group.active}});}json parents=json::array();for(const auto &process:all)parents.push_back({process.first,process.second.parent});return{{"sessions",result},{"warnings",warnings},{"_parents",parents}};
}
class Notification final:public Microsoft::WRL::RuntimeClass<Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,Microsoft::WRL::FtmBase,IAudioSessionNotification> {
public: HRESULT STDMETHODCALLTYPE OnSessionCreated(IAudioSessionControl*)override{event("AudioSessionsChanged");return S_OK;}
};
class Manager {
 struct Watch {ComPtr<IAudioSessionManager2> manager;ComPtr<Notification> notification;~Watch(){if(manager&&notification)manager->UnregisterSessionNotification(notification.Get());}};
 struct Entry {std::string name;std::shared_ptr<ember_app_audio::Journal> journal;std::string group;std::map<DWORD,int64_t> roots;};
 std::filesystem::path directory;
 std::shared_ptr<ember_replay::Ledger> ledger=std::make_shared<ember_replay::Ledger>();
 std::unordered_map<std::string,Entry> journals;
 std::unordered_map<obs_source_t*,std::string> attached;
 struct FrozenApp {std::string id,name;std::shared_ptr<ember_app_audio::Journal> journal;std::shared_ptr<ember_app_audio::Journal::Pin> pin;std::string group;std::vector<uint32_t> roots;};
 struct FrozenWindow {int64_t start,end;std::vector<FrozenApp> apps;};
 std::unordered_map<std::string,FrozenWindow> frozen;
 std::unordered_map<std::string,std::string> pinErrors;
 std::mutex mutex;
 std::map<DWORD,int64_t> blockedRoots;
 DWORD lastExcluded=0;
 static DWORD sourcePid(obs_source_t *source){auto settings=obs_source_get_settings(source);DWORD pid=(DWORD)obs_data_get_int(settings,"target_process_id");if(!pid)pid=(DWORD)obs_data_get_int(settings,"process_id");obs_data_release(settings);return pid;}
 static std::vector<uint32_t> rootIds(const Entry &entry){std::vector<uint32_t> roots;for(const auto &root:entry.roots)roots.push_back(root.first);return roots;}
 HANDLE stopEvent=nullptr;
 std::thread monitor;
 void watch(){
  HRESULT com=CoInitializeEx(nullptr,COINIT_MULTITHREADED);if(FAILED(com))return;
  try{ComPtr<IMMDeviceEnumerator> devices;ember_audio::check(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,IID_PPV_ARGS(&devices)),"Cannot monitor application audio sessions");std::map<std::wstring,std::unique_ptr<Watch>> watches;
   while(WaitForSingleObject(stopEvent,0)!=WAIT_OBJECT_0){ComPtr<IMMDeviceCollection> endpoints;if(SUCCEEDED(devices->EnumAudioEndpoints(eRender,DEVICE_STATE_ACTIVE,&endpoints))){UINT count=0;endpoints->GetCount(&count);std::set<std::wstring> present;
    for(UINT index=0;index<count;++index){ComPtr<IMMDevice> device;if(FAILED(endpoints->Item(index,&device)))continue;LPWSTR id=nullptr;if(FAILED(device->GetId(&id)))continue;std::wstring key=id;CoTaskMemFree(id);present.insert(key);if(watches.count(key))continue;auto watch=std::make_unique<Watch>();if(FAILED(device->Activate(__uuidof(IAudioSessionManager2),CLSCTX_ALL,nullptr,&watch->manager)))continue;watch->notification=Microsoft::WRL::Make<Notification>();if(FAILED(watch->manager->RegisterSessionNotification(watch->notification.Get())))continue;
     // Core Audio requires creating/enumerating the initial session list before
     // it begins delivering future session-created notifications.
     ComPtr<IAudioSessionEnumerator> initial;if(SUCCEEDED(watch->manager->GetSessionEnumerator(&initial))){int ignored=0;initial->GetCount(&ignored);}watches[key]=std::move(watch);event("AudioSessionsChanged");
    }
    for(auto it=watches.begin();it!=watches.end();)if(!present.count(it->first)){it=watches.erase(it);event("AudioSessionsChanged");}else++it;
   }if(WaitForSingleObject(stopEvent,2000)==WAIT_OBJECT_0)break;}
  }catch(const std::exception &e){event("AudioReplayWarning",{{"message",e.what()}});}CoUninitialize();
 }
 static int64_t timestamp(const json &data,const char *key){const auto &value=data.at(key);int64_t parsed=0;if(value.is_string()){const auto text=value.get<std::string>();size_t used=0;parsed=std::stoll(text,&used);require(used==text.size(),"Invalid audio snapshot timestamp");}else if(value.is_number_integer())parsed=value.get<int64_t>();else throw std::runtime_error("Audio snapshot timestamps must be integer nanoseconds");require(parsed>=0,"Audio snapshot timestamps must be nonnegative");return parsed;}
public:
 explicit Manager(const std::filesystem::path &root):directory(root/"audio-history"){std::filesystem::create_directories(directory);stopEvent=CreateEventW(nullptr,TRUE,FALSE,nullptr);require(stopEvent!=nullptr,"Cannot create audio session monitor event");try{monitor=std::thread(&Manager::watch,this);}catch(...){CloseHandle(stopEvent);stopEvent=nullptr;throw;}}
 ~Manager(){if(stopEvent)SetEvent(stopEvent);if(monitor.joinable())monitor.join();clear();if(stopEvent)CloseHandle(stopEvent);std::error_code error;std::filesystem::remove(directory,error);}
 json applyInventory(json inventory,int64_t now){
  std::unordered_map<uint32_t,uint32_t> parents;for(const auto &pair:inventory.value("_parents",json::array()))parents[pair.at(0).get<uint32_t>()]=pair.at(1).get<uint32_t>();std::lock_guard<std::mutex> lock(mutex);
  for(const auto &source:attached){auto entry=journals.find(source.second);if(entry!=journals.end())entry->second.roots[sourcePid(source.first)]=now;}
  std::vector<ember_audio_policy::Roots> groups;for(const auto &row:inventory["sessions"])groups.push_back({row.at("id").get<std::string>(),row.at("roots").get<std::vector<uint32_t>>()});
  const auto currentChildren=groups;
  for(auto &entry:journals){for(auto it=entry.second.roots.begin();it!=entry.second.roots.end();)if(now-it->second>360000000000LL)it=entry.second.roots.erase(it);else++it;groups.push_back({entry.second.group,rootIds(entry.second)});}
  for(const auto &window:frozen)for(const auto &app:window.second.apps)groups.push_back({app.group,app.roots});
  const auto newlyUnsafe=ember_audio_policy::overlappingAncestors(groups,parents,&currentChildren);json warnings=inventory.value("warnings",json::array());
  for(auto root:newlyUnsafe){bool first=!blockedRoots.count(root)||blockedRoots[root]<=now;blockedRoots[root]=now+360000000000LL;std::string label="Ancestor application";
   for(const auto &row:inventory["sessions"])for(const auto &pid:row["roots"])if(pid.get<DWORD>()==root)label=row.value("name",label);
   for(const auto &source:attached)if(sourcePid(source.first)==root)ember_audio::setRawSink(source.first,{});
   for(auto &entry:journals)if(entry.second.roots.count(root)){label=entry.second.name;entry.second.journal->markContaminated(now);}
   for(auto &window:frozen)for(auto &app:window.second.apps)if(std::find(app.roots.begin(),app.roots.end(),root)!=app.roots.end()){label=app.name;app.journal->markContaminated(now);}
   if(first)warnings.push_back(label+": Windows process-tree capture also includes another application. This ancestor stem is omitted; combined audio is retained.");
  }
  for(auto it=blockedRoots.begin();it!=blockedRoots.end();)if(it->second<=now)it=blockedRoots.erase(it);else++it;
  json safe=json::array(),blocked=json::array();for(const auto &root:blockedRoots)blocked.push_back(root.first);for(auto row:inventory["sessions"]){json roots=json::array();for(const auto &root:row["roots"])if(!blockedRoots.count(root.get<DWORD>()))roots.push_back(root);if(roots.empty())continue;row["roots"]=roots;row["processId"]=roots.front();safe.push_back(std::move(row));}
  inventory["sessions"]=safe;inventory["blockedRoots"]=blocked;inventory["warnings"]=warnings;inventory.erase("_parents");return inventory;
 }
 json list(DWORD excluded){
  lastExcluded=excluded;
  {std::lock_guard<std::mutex> lock(mutex);const auto now=(int64_t)os_gettime_ns();for(auto it=journals.begin();it!=journals.end();){it->second.journal->prune(now);bool bound=false;for(const auto &source:attached)if(source.second==it->first){bound=true;break;}if(!bound&&it->second.journal->empty())it=journals.erase(it);else++it;}}
  auto inventory=std::async(std::launch::async,[excluded]{HRESULT com=CoInitializeEx(nullptr,COINIT_MULTITHREADED);ember_audio::check(com,"Cannot enumerate audio sessions on a COM worker");try{auto result=sessionInventory(excluded);CoUninitialize();return result;}catch(...){CoUninitialize();throw;}}).get();return applyInventory(std::move(inventory),(int64_t)os_gettime_ns());
 }
 json attach(obs_source_t *source,const json &data){
  require(std::string(obs_source_get_id(source))=="ember_process_audio_capture","Independent app history requires a process audio source");auto id=data.at("id").get<std::string>(),name=data.at("name").get<std::string>();require(!id.empty()&&id.size()<=4096&&!name.empty()&&name.size()<=1024,"Invalid application audio identity");int retention=data.value("retentionSeconds",360);require(retention>=1&&retention<=360,"Application audio retention must fit six minutes");const DWORD pid=sourcePid(source);require(pid&&data.value("processId",pid)==pid,"Application audio root does not match its capture source");detach(source);std::lock_guard<std::mutex> lock(mutex);require(!blockedRoots.count(pid)||blockedRoots[pid]<=(int64_t)os_gettime_ns(),"Ancestor process-tree audio overlaps another application; combined audio is retained");
  auto found=journals.find(id);if(found==journals.end()){auto root=std::filesystem::u8path(data.value("bufferDir",directory.u8string()));require(root.is_absolute(),"Absolute application audio journal path required");std::filesystem::create_directories(root);auto session=std::make_shared<ember_replay::Session>(root);auto journal=std::make_shared<ember_app_audio::Journal>(id,name,session,ledger,retention);found=journals.emplace(id,Entry{name,std::move(journal)}).first;}
  std::unordered_map<DWORD,Process> known;const auto path=processPath(pid,known);if(found->second.group.empty())found->second.group=path.empty()?"attached:"+id:"app:"+toUtf8(lower(path));found->second.roots[pid]=(int64_t)os_gettime_ns();
  std::weak_ptr<ember_app_audio::Journal> weak=found->second.journal;ember_audio::setRawSink(source,[weak](const float *samples,uint32_t frames,int64_t ns){if(auto journal=weak.lock())journal->push(samples,frames,ns);});obs_source_set_audio_mixers(source,0);attached[source]=id;return{{"attached",true},{"id",id},{"storage","disk"}};
 }
 void detach(obs_source_t *source){std::lock_guard<std::mutex> lock(mutex);auto binding=attached.find(source);if(binding!=attached.end()){auto entry=journals.find(binding->second);if(entry!=journals.end())entry->second.roots[sourcePid(source)]=(int64_t)os_gettime_ns();}ember_audio::setRawSink(source,{});attached.erase(source);}
 void clear(){std::lock_guard<std::mutex> lock(mutex);for(const auto &entry:attached)ember_audio::setRawSink(entry.first,{});attached.clear();frozen.clear();pinErrors.clear();journals.clear();blockedRoots.clear();}
 void pin(const json &snapshot){
  if(snapshot.value("holdWindow",false)){const auto end=timestamp(snapshot,"replayEndMonotonicNs");std::lock_guard<std::mutex> lock(mutex);for(const auto &entry:journals)entry.second.journal->pauseAfter(end);}
  const auto id=snapshot.at("snapshotId").get<std::string>();const auto start=timestamp(snapshot,"replayStartMonotonicNs"),end=timestamp(snapshot,"replayEndMonotonicNs");std::lock_guard<std::mutex> lock(mutex);auto existing=frozen.find(id);if(existing!=frozen.end()){require(existing->second.start==start&&existing->second.end==end,"Pinned replay window cannot change during retry");return;}if(frozen.size()>=32){const std::string message="Too many unclaimed application audio snapshots; combined audio is retained";if(pinErrors.size()>=32)pinErrors.erase(pinErrors.begin());pinErrors[id]=message;event("AudioReplayWarning",{{"snapshotId",id},{"message",message}});return;}FrozenWindow window{start,end,{}};for(const auto &entry:journals)window.apps.push_back({entry.first,entry.second.name,entry.second.journal,entry.second.journal->pin(start,end),entry.second.group,rootIds(entry.second)});frozen[id]=std::move(window);
 }
 void discard(const std::string &id){std::lock_guard<std::mutex> lock(mutex);frozen.erase(id);pinErrors.erase(id);}
 ember_replay::DurableAudio checkpoint(int64_t start,int64_t end){
  std::vector<FrozenApp> apps;{std::lock_guard<std::mutex> lock(mutex);for(const auto &entry:journals)apps.push_back({entry.first,entry.second.name,entry.second.journal,{},entry.second.group,rootIds(entry.second)});}
  ember_replay::DurableAudio result;result.payload.startNs=start;result.payload.endNs=end;
  for(const auto &app:apps){try{std::string warning;auto payload=app.journal->durable(start,end,&warning);if(!warning.empty())result.warnings.push_back({{"id",app.id},{"name",app.name},{"message",warning+"; only durably available application samples were checkpointed"}});if(payload.packets.empty())continue;const auto first=std::min_element(payload.packets.begin(),payload.packets.end(),[](const auto &a,const auto &b){return a.info.presentationNs<b.info.presentationNs;})->info.presentationNs;const auto index=(uint32_t)result.tracks.size();result.tracks.push_back({{"id",app.id},{"name",app.name},{"sourceStartMonotonicNs",std::to_string(first)},{"sourceOffsetNs",std::to_string(first-start)},{"videoOffsetNs","0"},{"videoStartMonotonicNs",std::to_string(start)},{"sampleRate",48000},{"channels",2}});for(auto &packet:payload.packets){packet.info.track=index;result.payload.packets.push_back(std::move(packet));}result.payload.bytes+=payload.bytes;}catch(const std::exception &e){result.warnings.push_back({{"id",app.id},{"name",app.name},{"message",e.what()}});}}
  return result;
 }
 json snapshot(const json &data){
  const auto start=timestamp(data,"startNs"),end=timestamp(data,"endNs");require(end>start&&end-start<=301000000000LL,"Invalid application audio snapshot window");auto folder=std::filesystem::u8path(data.at("folder").get<std::string>());require(folder.is_absolute(),"Absolute application audio snapshot folder required");std::filesystem::create_directories(folder);json tracks=json::array(),warnings=json::array();size_t index=0;
  try{auto current=list(lastExcluded);warnings=current.value("warnings",json::array());}catch(const std::exception &e){warnings.push_back(std::string("Application process-tree isolation could not be verified; combined audio is retained: ")+e.what());discard(data.value("snapshotId",std::string()));return{{"snapshotId",data.value("snapshotId",std::string())},{"folder",folder.u8string()},{"tracks",tracks},{"warnings",warnings}};}
  {std::lock_guard<std::mutex> lock(mutex);auto error=pinErrors.find(data.value("snapshotId",std::string()));if(error!=pinErrors.end()){warnings.push_back({{"message",error->second}});pinErrors.erase(error);return{{"snapshotId",data.value("snapshotId",std::string())},{"folder",folder.u8string()},{"tracks",tracks},{"warnings",warnings}};}}
  std::vector<FrozenApp> apps;{std::lock_guard<std::mutex> lock(mutex);auto held=frozen.find(data.value("snapshotId",std::string()));if(held!=frozen.end()){require(held->second.start==start&&held->second.end==end,"Application audio snapshot window differs from its pinned video window");apps=std::move(held->second.apps);frozen.erase(held);}else{for(const auto &entry:journals)apps.push_back({entry.first,entry.second.name,entry.second.journal,entry.second.journal->pin(start,end),entry.second.group,rootIds(entry.second)});}}
  // Allow the final process-loopback block to arrive, then drain its bounded
  // queue. This happens during save work, away from video encoding callbacks.
  const auto now=(int64_t)os_gettime_ns();if(end>now-100000000LL&&end<=now+1000000000LL)std::this_thread::sleep_for(std::chrono::nanoseconds(std::min<int64_t>(200000000LL,end+100000000LL-now)));
  for(auto &entry:apps){auto file=folder/("app-"+std::to_string(++index)+".wav");try{float peak=entry.journal->wave(file,start,end,entry.pin);if(peak>0.0000001f)tracks.push_back({{"id",entry.id},{"name",entry.name},{"file",file.u8string()},{"peak",peak}});}catch(const std::exception &e){std::error_code ignored;std::filesystem::remove(file,ignored);warnings.push_back({{"id",entry.id},{"name",entry.name},{"message",e.what()}});}}
  return{{"snapshotId",data.value("snapshotId",std::string())},{"folder",folder.u8string()},{"tracks",tracks},{"warnings",warnings}};
 }
};
}
