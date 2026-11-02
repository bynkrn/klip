#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <cassert>
#include <iostream>
#include "packet-ring.hpp"
using namespace ember_replay;
static PacketInfo frame(int second,bool key=true){PacketInfo p{};p.video=true;p.keyframe=key;p.pts=second*60;p.dts=p.pts;p.timebaseNum=1;p.timebaseDen=60;p.presentationNs=10000000000LL+second*1000000000LL;p.durationNs=16666667;p.sysDtsUsec=p.presentationNs/1000;return p;}
static void exercise(Storage storage,const std::filesystem::path &root){
 Ring ring(storage,root,3000000000LL,1024*1024,0);
 const uint8_t a[]={1,2,3,4};
 ring.append(frame(0),a,sizeof(a));ring.append(frame(1),a,sizeof(a));ring.append(frame(2),a,sizeof(a));
 auto saved=ring.snapshot();assert(saved.startNs==10000000000LL);assert(saved.endNs==12016666667LL);assert(saved.packets.size()==3);
 auto path=saved.packets.front().segment->path();
 assert(storage==Storage::Ram?!std::filesystem::exists(path):std::filesystem::exists(path));
 // A save pins bytes while capture expires and continues the same session.
 for(int i=3;i<20;++i)ring.append(frame(i),a,sizeof(a));
 assert(ring.snapshot().endNs-ring.snapshot().startNs<=3000000000LL);
 assert(saved.read(saved.packets.front())==std::vector<uint8_t>({1,2,3,4}));
 if(storage==Storage::Disk)assert(std::filesystem::exists(path));
 assert(ring.retainedBytes()<128);assert(ring.liveBytes()>=ring.retainedBytes()+12);
 saved={};
 if(storage==Storage::Disk)assert(!std::filesystem::exists(path));
 assert(ring.liveBytes()==ring.retainedBytes());
}
int main(){
 auto root=std::filesystem::temp_directory_path()/(L"ember-ring-unit-"+std::to_wstring(GetCurrentProcessId()));std::filesystem::create_directories(root);
 exercise(Storage::Ram,root);exercise(Storage::Disk,root);
 {Ring ring(Storage::Ram,root,300000000000LL,12,0);uint8_t bytes[8]{};ring.append(frame(0),bytes,8);bool rejected=false;try{ring.append(frame(1),bytes,8);}catch(const std::exception &e){rejected=std::string(e.what()).find("limit")!=std::string::npos;}assert(rejected);assert(ring.snapshot().packets.size()==1);assert(ring.liveBytes()==8);}
 {Ring ring(Storage::Disk,root,300000000000LL,1024,UINT64_MAX);uint8_t bytes[8]{};bool rejected=false;try{ring.append(frame(0),bytes,8);}catch(const std::exception &e){rejected=std::string(e.what()).find("space")!=std::string::npos;}assert(rejected);assert(ring.liveBytes()==0);}
 {Ring ring(Storage::Disk,root,300000000000LL,1024*1024,0);uint8_t byte=17;for(int i=0;i<=600;++i)ring.append(frame(i),&byte,1);auto saved=ring.snapshot();assert(saved.startNs==311000000000LL);assert(saved.endNs==610016666667LL);assert(saved.packets.size()==300);assert(saved.endNs-saved.startNs<=300000000000LL);assert(ring.retainedBytes()<=301);}
 std::filesystem::path durable;{Ring ring(Storage::Disk,root,3000000000LL,1024,0);uint8_t bytes[]={9,8,7};ring.append(frame(0),bytes,3);auto snapshot=ring.snapshot();durable=snapshot.packets.front().segment->path();snapshot.packets.front().segment->preserveDiskFile();}assert(std::filesystem::file_size(durable)==3);std::filesystem::remove(durable);std::filesystem::remove(durable.parent_path()/".preserve");std::filesystem::remove(durable.parent_path());
 assert(std::filesystem::is_empty(root));std::filesystem::remove(root);std::cout<<"bounded RAM/disk, snapshot pins, exact windows, cap and free-space checks passed\n";
}
