#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <objbase.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <wrl/client.h>
#include <thread>
#include <future>
#include <mutex>
#include <stdexcept>
#include <cassert>
#include <iostream>
#include "vendor/json.hpp"
#include "util/c99defs.h"
#undef EXPORT
#define EXPORT __declspec(dllimport)
#include "obs.h"
using json=nlohmann::json;
static void event(const char*,json=json::object()){}
static void require(bool ok,const std::string &message){if(!ok)throw std::runtime_error(message);}
#include "process-audio-exclusion.hpp"
#include "audio-replay.hpp"
static void quiet(int,const char*,va_list,void*){}
static std::vector<float> samples(float gain,int frequency){std::vector<float> result(4800*2);for(size_t frame=0;frame<4800;++frame){const auto value=gain*(float)std::sin(6.283185307179586*frequency*frame/48000);result[frame*2]=result[frame*2+1]=value;}return result;}
int main()try{
 SetErrorMode(SEM_FAILCRITICALERRORS|SEM_NOGPFAULTERRORBOX);CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);base_set_log_handler(quiet,nullptr);require(obs_startup("en-US",nullptr,nullptr),"OBS startup failed");obs_audio_info format{};format.samples_per_sec=48000;format.speakers=SPEAKERS_STEREO;require(obs_reset_audio(&format),"OBS audio startup failed");ember_audio::registerSource();
 auto folder=std::filesystem::temp_directory_path()/("ember-audio-manager-test-"+std::to_string(GetCurrentProcessId()));std::filesystem::create_directories(folder);std::vector<obs_source_t*> sources;
 {
  ember_audio_replay::Manager manager(folder);
  auto source=[&](const std::string &id,const std::string &label){auto *settings=obs_data_create();obs_data_set_int(settings,"target_process_id",GetCurrentProcessId());auto *source=obs_source_create("ember_process_audio_capture",("Source "+std::to_string(sources.size())).c_str(),settings,nullptr);obs_data_release(settings);require(source&&!ember_audio::creationError.size(),"Silent process source could not initialize");assert(obs_source_get_audio_mixers(source)==0);sources.push_back(source);manager.attach(source,{{"id",id},{"name",label},{"retentionSeconds",1},{"bufferDir",folder.u8string()}});return source;};
  for(int app=0;app<8;++app)source("app"+std::to_string(app),"Application "+std::to_string(app));auto *secondRoot=source("app0","Application 0");auto *silent=source("silent","Silent application");auto *outside=source("outside","Outside clip");
  const auto start=(int64_t)os_gettime_ns()-5000000000LL,end=start+500000000LL;
  manager.pin({{"snapshotId","owned-test"},{"replayStartMonotonicNs",std::to_string(start)},{"replayEndMonotonicNs",std::to_string(end)}});
  // All PCM stays inside this process; nothing is submitted to a render device.
  for(int app=0;app<8;++app){auto data=samples(.2f,200+app*50);ember_audio::submitRaw(sources[app],data.data(),4800,start+100000000LL);}
  auto duplicate=samples(.1f,200);ember_audio::submitRaw(secondRoot,duplicate.data(),4800,start+100000000LL);auto zero=std::vector<float>(9600,0);ember_audio::submitRaw(silent,zero.data(),4800,start+100000000LL);auto other=samples(.2f,1800);ember_audio::submitRaw(outside,other.data(),4800,start+1000000000LL);
  for(auto *source:sources)manager.detach(source);
  // Force rolling history expiry after the snapshot pin; snapshots still own
  // the segments, including blocks which were pending when the pin was taken.
  manager.list(GetCurrentProcessId());
  manager.pin({{"snapshotId","owned-test"},{"replayStartMonotonicNs",std::to_string(start)},{"replayEndMonotonicNs",std::to_string(end)}});
  const auto result=manager.snapshot({{"snapshotId","owned-test"},{"startNs",std::to_string(start)},{"endNs",std::to_string(end)},{"folder",(folder/"snapshot").u8string()}});
  assert(result["warnings"].empty());assert(result["tracks"].size()==8);
  for(const auto &track:result["tracks"]){const auto id=track.at("id").get<std::string>();int app=std::stoi(id.substr(3));float gain=app==0?.3f:.2f;assert(std::abs(track.at("peak").get<float>()-gain)<.002f);auto file=std::filesystem::u8path(track.at("file").get<std::string>());assert(std::filesystem::file_size(file)==44+24000*8);std::ifstream wave(file,std::ios::binary);float zeroSample=1;wave.seekg(44);wave.read((char*)&zeroSample,4);assert(zeroSample==0);std::vector<float> raw(4800*2);wave.seekg(44+4800*8);wave.read((char*)raw.data(),raw.size()*sizeof(float));double dot=0;for(size_t frame=0;frame<4800;++frame)dot+=raw[frame*2]*std::sin(6.283185307179586*(200+app*50)*frame/48000);assert(std::abs(dot*2/4800-gain)<.002);wave.close();std::filesystem::remove(file);}
  std::atomic<bool> producing{true};auto live=samples(.1f,300);std::thread producer([&]{while(producing){ember_audio::submitRaw(sources[0],live.data(),480,(int64_t)os_gettime_ns());std::this_thread::sleep_for(std::chrono::milliseconds(1));}});
  for(int round=0;round<20;++round){manager.attach(sources[0],{{"id","hot-detach"},{"name","Hot detach"},{"retentionSeconds",1}});manager.detach(sources[0]);}
  manager.clear();producing=false;producer.join();
  // Only the policy metadata uses fake PIDs. These clients still capture this
  // silent test process, as established at construction; PCM is injected below.
  const std::vector<DWORD> fakePids={100,200,300};const std::vector<std::string> ids={"steam","quake","discord"},labels={"Steam","Quake","Discord"};
  for(size_t n=0;n<3;++n){auto settings=obs_source_get_settings(sources[n]);obs_data_set_int(settings,"target_process_id",fakePids[n]);obs_source_update(sources[n],settings);obs_data_release(settings);manager.attach(sources[n],{{"id",ids[n]},{"name",labels[n]},{"processId",fakePids[n]},{"retentionSeconds",360}});}
  const auto isolatedStart=(int64_t)os_gettime_ns()-1000000000LL,isolatedEnd=isolatedStart+500000000LL;
  auto launcher=samples(.1f,100),game=samples(.3f,300),chat=samples(.2f,700);for(size_t n=0;n<launcher.size();++n)launcher[n]+=game[n];
  ember_audio::submitRaw(sources[0],launcher.data(),4800,isolatedStart+100000000LL);ember_audio::submitRaw(sources[1],game.data(),4800,isolatedStart+100000000LL);ember_audio::submitRaw(sources[2],chat.data(),4800,isolatedStart+100000000LL);
  manager.pin({{"snapshotId","isolation-test"},{"replayStartMonotonicNs",std::to_string(isolatedStart)},{"replayEndMonotonicNs",std::to_string(isolatedEnd)}});
  json rows=json::array();for(size_t n=0;n<3;++n)rows.push_back({{"id",ids[n]},{"name",labels[n]},{"exePath",ids[n]+".exe"},{"roots",json::array({fakePids[n]})},{"active",n!=0}});
  auto policy=manager.applyInventory({{"sessions",rows},{"warnings",json::array()},{"_parents",{{100,1},{200,100},{300,1}}}},(int64_t)os_gettime_ns());assert(policy["sessions"].size()==2);assert(policy["blockedRoots"]==json::array({100}));assert(policy["warnings"].size()==1);
  manager.detach(sources[0]);bool refused=false;try{manager.attach(sources[0],{{"id","steam"},{"name","Steam"},{"processId",100},{"retentionSeconds",360}});}catch(const std::exception &e){refused=std::string(e.what()).find("combined audio")!=std::string::npos;}assert(refused);
  auto isolated=manager.snapshot({{"snapshotId","isolation-test"},{"startNs",std::to_string(isolatedStart)},{"endNs",std::to_string(isolatedEnd)},{"folder",(folder/"isolation").u8string()}});
  assert(isolated["tracks"].size()==2);std::set<std::string> kept;for(const auto &track:isolated["tracks"]){kept.insert(track["id"].get<std::string>());const float gain=track["id"]=="quake"?.3f:.2f;assert(std::abs(track["peak"].get<float>()-gain)<.002f);std::filesystem::remove(std::filesystem::u8path(track["file"].get<std::string>()));}assert(kept==std::set<std::string>({"quake","discord"}));assert(!isolated["warnings"].empty());std::filesystem::remove(folder/"isolation");
  manager.clear();for(auto *source:sources)obs_source_release(source);sources.clear();
 }
 obs_shutdown();CoUninitialize();std::filesystem::remove(folder/"snapshot");assert(std::filesystem::is_empty(folder));std::filesystem::remove(folder);std::cout<<"8 app stems, two-root mixing, silence/outside exclusion, queued tails, exact alignment and pinned expiry passed\n";return 0;
}catch(const std::exception &error){std::cerr<<error.what()<<'\n';return 1;}
