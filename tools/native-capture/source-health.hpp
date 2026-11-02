#pragma once
#include <windows.h>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#ifndef EMBER_HEALTH_TRANSPORT_ONLY
#include "util/windows/window-helpers.h"
#endif

namespace ember_health {
// Read-only view of the published OBS 33.0.1 hook IPC ABI, not private source data:
// https://github.com/obsproject/obs-studio/blob/33.0.1/shared/obs-hook-config/graphics-hook-info.h
// graphics-hook.c changes last_tex only after a producer copy. Rendering the
// retained OBS texture, encoder packets and unchanged pixels cannot advance it.
#pragma pack(push,8)
struct HookInfo {
 uint32_t hook_ver_major,hook_ver_minor,type,window,format,cx,cy,base_cx,base_cy,pitch,map_id,map_size;
 bool flip;uint64_t frame_interval;uint8_t remaining[584];
};
struct SharedHeader {volatile int last_tex;uint32_t tex1_offset,tex2_offset;};
#pragma pack(pop)
static_assert(sizeof(HookInfo)==648,"OBS 33.0.1 hook IPC ABI");
static_assert(offsetof(HookInfo,frame_interval)==56,"OBS hook IPC alignment");
inline uint64_t clockNs(){return (uint64_t)std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();}
struct TransportState {bool observed=false;uint64_t frameSequence=0,lastFrameNs=0,generation=0;};

class SharedMemoryTransport {
 DWORD pid;HANDLE infoHandle=nullptr,textureHandle=nullptr;
 const HookInfo *info=nullptr;const SharedHeader *header=nullptr;
 std::wstring textureName;int previous=-1;uint64_t refreshAt=0;
 mutable std::mutex mutex;std::condition_variable wake;bool stopped=false;
 TransportState state;std::thread worker;
 void dropTexture(){if(header)UnmapViewOfFile(header);header=nullptr;if(textureHandle)CloseHandle(textureHandle);textureHandle=nullptr;textureName.clear();previous=-1;state.observed=false;state.frameSequence=0;state.lastFrameNs=0;state.generation++;}
 void refresh(){
  if(!info){wchar_t name[80];swprintf_s(name,L"CaptureHook_HookInfo%lu",pid);infoHandle=OpenFileMappingW(FILE_MAP_READ,FALSE,name);if(infoHandle)info=static_cast<const HookInfo*>(MapViewOfFile(infoHandle,FILE_MAP_READ,0,0,sizeof(HookInfo)));if(!info&&infoHandle){CloseHandle(infoHandle);infoHandle=nullptr;}}
  if(!info)return;
  // Unknown versions, texture-only transport and incomplete producer metadata
  // are explicitly unobservable; never interpret them as a live frame counter.
  if(info->hook_ver_major!=1||info->hook_ver_minor!=8||info->type!=0||!info->map_id||!info->window||!info->cx||!info->cy||info->map_size<sizeof(SharedHeader)){if(header||!textureName.empty())dropTexture();return;}
  auto window=(HWND)(uintptr_t)info->window;auto root=GetAncestor(window,GA_ROOT);if(root)window=root;
  wchar_t name[112];swprintf_s(name,L"CaptureHook_Texture_%llu_%u",(unsigned long long)(uintptr_t)window,info->map_id);
  if(textureName==name&&header)return;
  if(textureName!=name){dropTexture();textureName=name;}
  textureHandle=OpenFileMappingW(FILE_MAP_READ,FALSE,name);
  if(textureHandle)header=static_cast<const SharedHeader*>(MapViewOfFile(textureHandle,FILE_MAP_READ,0,0,sizeof(SharedHeader)));
  if(!header&&textureHandle){CloseHandle(textureHandle);textureHandle=nullptr;}
  state.observed=header!=nullptr;
 }
 void run(){
  // Uneven, small observations avoid sampling one side of an even frame rate.
  // Only 4 IPC bytes are read per observation; no pixel copies or GPU readback.
  constexpr int intervals[]={5,11,7,13,3,9,17};size_t step=0;
  std::unique_lock<std::mutex> lock(mutex);
  while(!stopped){
   auto now=clockNs();if(now>=refreshAt){refresh();refreshAt=now+250000000;}
   if(header){int current=header->last_tex;if(current==0||current==1){if(previous!=-1&&current!=previous){state.frameSequence++;state.lastFrameNs=now;}previous=current;}}
   wake.wait_for(lock,std::chrono::milliseconds(intervals[step++%7]),[&]{return stopped;});
  }
 }
public:
 explicit SharedMemoryTransport(DWORD target):pid(target),worker([this]{run();}){}
 ~SharedMemoryTransport(){{std::lock_guard<std::mutex> lock(mutex);stopped=true;}wake.notify_all();worker.join();dropTexture();if(info)UnmapViewOfFile(info);if(infoHandle)CloseHandle(infoHandle);}
 SharedMemoryTransport(const SharedMemoryTransport&)=delete;
 TransportState snapshot()const{std::lock_guard<std::mutex> lock(mutex);return state;}
};

#ifndef EMBER_HEALTH_TRANSPORT_ONLY
class SourceHealth {
 struct Entry {uint64_t generation=0;DWORD pid=0;std::unique_ptr<SharedMemoryTransport> transport;};
 std::unordered_map<obs_source_t*,Entry> entries;uint64_t nextGeneration=0;
 struct Info {obs_source_t *source;uint32_t width=0,height=0;bool available=false,hooked=false,suspended=false,compatibility=false;DWORD pid=0;};
 static void inspect(void *opaque){
  auto &out=*static_cast<Info*>(opaque);auto source=out.source;
  out.width=obs_source_get_width(source);out.height=obs_source_get_height(source);
  const std::string kind=obs_source_get_id(source);if(kind!="game_capture"&&kind!="window_capture")return;
  calldata_t call;calldata_init(&call);out.available=proc_handler_call(obs_source_get_proc_handler(source),"get_hooked",&call);out.hooked=out.available&&calldata_bool(&call,"hooked");
  auto settings=obs_source_get_settings(source);out.compatibility=kind=="game_capture"&&obs_data_get_bool(settings,"sli_compatibility");
  char *windowClass=nullptr,*title=nullptr,*executable=nullptr;
  ms_build_window_strings(obs_data_get_string(settings,"window"),&windowClass,&title,&executable);
  const char *hookClass=out.hooked?calldata_string(&call,"class"):windowClass;
  const char *hookTitle=out.hooked?calldata_string(&call,"title"):title;
  const char *hookExe=out.hooked?calldata_string(&call,"executable"):executable;
  HWND window=ms_find_window_top_level(INCLUDE_MINIMIZED,WINDOW_PRIORITY_EXE,hookClass,hookTitle,hookExe);
  if(window){out.suspended=IsIconic(window)!=FALSE;GetWindowThreadProcessId(window,&out.pid);}
  else if(out.hooked)out.hooked=false;
  bfree(windowClass);bfree(title);bfree(executable);obs_data_release(settings);calldata_free(&call);
 }
public:
 nlohmann::json query(obs_source_t *source){
  Info info{source};obs_queue_task(OBS_TASK_GRAPHICS,inspect,&info,true);
  auto found=entries.find(source);if(found==entries.end()){Entry entry;entry.generation=++nextGeneration;found=entries.emplace(source,std::move(entry)).first;}
  auto &entry=found->second;
  if(entry.pid!=info.pid||!info.compatibility||!info.hooked){entry.transport.reset();entry.pid=info.pid;}
  if(info.compatibility&&info.hooked&&info.pid&&!entry.transport)entry.transport=std::make_unique<SharedMemoryTransport>(info.pid);
  const auto transport=entry.transport?entry.transport->snapshot():TransportState{};
  const auto now=clockNs();nlohmann::json age=nullptr;if(transport.lastFrameNs&&now>=transport.lastFrameNs)age=(now-transport.lastFrameNs)/1000000.0;
  return{{"sourceWidth",info.width},{"sourceHeight",info.height},{"hookStatusAvailable",info.available},{"hooked",info.hooked},{"suspended",info.suspended},{"freshnessRequired",info.compatibility},{"transportObserved",transport.observed},{"frameSequence",std::to_string(transport.frameSequence)},{"lastFrameAgeMs",age},{"generation",std::to_string(entry.generation)+"-"+std::to_string(transport.generation)},{"freshnessCapability",info.compatibility?"shared-memory-buffer-ownership":"hook-lifecycle-only"}};
 }
 void reset(obs_source_t *source){entries.erase(source);}
 void clear(){entries.clear();}
};
#endif
}
