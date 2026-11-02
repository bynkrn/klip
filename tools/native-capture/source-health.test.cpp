#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define EMBER_HEALTH_TRANSPORT_ONLY
#include "source-health.hpp"
#include <cassert>
#include <iostream>
using namespace ember_health;
template<class F> bool until(F ready){for(int i=0;i<150;++i){if(ready())return true;Sleep(10);}return false;}
int main(){
 const DWORD pid=GetCurrentProcessId();wchar_t name[96];
 swprintf_s(name,L"CaptureHook_HookInfo%lu",pid);
 HANDLE metadata=CreateFileMappingW(INVALID_HANDLE_VALUE,nullptr,PAGE_READWRITE,0,sizeof(HookInfo),name);assert(metadata);
 auto info=static_cast<HookInfo*>(MapViewOfFile(metadata,FILE_MAP_ALL_ACCESS,0,0,sizeof(HookInfo)));assert(info);
 // Synthetic producer uses its own IPC objects; no game/window interaction.
 info->hook_ver_major=1;info->hook_ver_minor=8;info->type=0;info->window=100;info->cx=1920;info->cy=1080;info->map_id=1;info->map_size=4096;
 swprintf_s(name,L"CaptureHook_Texture_100_1");
 HANDLE pixels=CreateFileMappingW(INVALID_HANDLE_VALUE,nullptr,PAGE_READWRITE,0,4096,name);assert(pixels);
 auto header=static_cast<SharedHeader*>(MapViewOfFile(pixels,FILE_MAP_ALL_ACCESS,0,0,sizeof(SharedHeader)));assert(header);header->last_tex=0;
 {
  SharedMemoryTransport transport(pid);
  assert(until([&]{return transport.snapshot().observed;}));
  assert(transport.snapshot().frameSequence==0); // Retained allocation alone proves no fresh delivery.
  Sleep(40);header->last_tex=1;
  assert(until([&]{return transport.snapshot().frameSequence>0;}));
  const auto delivered=transport.snapshot();Sleep(100);
  assert(transport.snapshot().lastFrameNs==delivered.lastFrameNs); // Frozen producer cannot be masked by polling.
  // Unchanged pixel bytes with alternating buffer ownership remain live.
  for(int i=0;i<8;++i){header->last_tex=i%2;Sleep(23);}
  assert(transport.snapshot().frameSequence>=5);
  auto generation=transport.snapshot().generation;info->map_id=2;
  assert(until([&]{auto state=transport.snapshot();return state.generation>generation&&!state.observed&&state.frameSequence==0;}));
  info->hook_ver_major=99;info->map_id=1;
  Sleep(600);assert(!transport.snapshot().observed); // Refuse unknown ABI.
 }
 UnmapViewOfFile(header);CloseHandle(pixels);UnmapViewOfFile(info);CloseHandle(metadata);
 std::cout<<"source transport health tests passed\n";
}
