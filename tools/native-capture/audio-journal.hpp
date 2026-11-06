#pragma once
#include "packet-ring.hpp"
#include <condition_variable>
#include <fstream>
#include <thread>
#include <cmath>
#include <cstring>
#include <winioctl.h>

namespace ember_app_audio {
struct Samples {std::vector<float> data;int64_t timestamp;};
class Journal {
public:
 struct Pin {int64_t start,end;std::vector<std::shared_ptr<ember_replay::Segment>> segments;};
private:
 std::string id,name,fault;
 std::shared_ptr<ember_replay::Session> session;
 std::shared_ptr<ember_replay::Ledger> ledger;
 std::deque<std::shared_ptr<ember_replay::Segment>> segments;
 int64_t retentionNs;uint64_t sequence=0,queuedBytes=0;
 std::mutex queueMutex,journalMutex;std::condition_variable changed;std::deque<Samples> pending;
 bool closing=false,writing=false;std::thread writer;
 std::vector<std::weak_ptr<Pin>> pins;
 std::atomic<int64_t> captureEnd{INT64_MAX};
 int64_t contaminatedUntil=0;
 inline static std::mutex budgetMutex;
 std::vector<std::shared_ptr<ember_replay::Segment>> expire(int64_t now){std::vector<std::shared_ptr<ember_replay::Segment>> retired;while(!segments.empty()&&segments.front()->startNs+1000000000LL<now-retentionNs){retired.push_back(std::move(segments.front()));segments.pop_front();}return retired;}
 void work(){
  SetThreadPriority(GetCurrentThread(),THREAD_PRIORITY_BELOW_NORMAL);
  for(;;){Samples block;{std::unique_lock<std::mutex> lock(queueMutex);changed.wait(lock,[&]{return closing||!pending.empty();});if(pending.empty()&&closing)return;block=std::move(pending.front());pending.pop_front();writing=true;}
   if(block.timestamp>=captureEnd.load()){std::lock_guard<std::mutex> lock(queueMutex);queuedBytes-=block.data.size()*sizeof(float);writing=false;changed.notify_all();continue;}
   try{std::shared_ptr<ember_replay::Segment> destination;std::vector<std::shared_ptr<ember_replay::Segment>> retired;{std::lock_guard<std::mutex> lock(journalMutex);retired=expire(block.timestamp);if(!segments.empty()&&block.timestamp<segments.back()->startNs+1000000000LL)destination=segments.back();}retired.clear();
    if(!destination){
     std::error_code error;auto space=std::filesystem::space(session->folder,error);if(error||space.available<1073741824ULL)throw std::runtime_error("Audio history needs at least 1 GiB of free disk space");
     if(ledger->bytes.load()>16ULL*1024*1024*1024)throw std::runtime_error("Application audio history disk budget exceeded");
     destination=std::make_shared<ember_replay::Segment>(ember_replay::Storage::Disk,ledger,session,++sequence,block.timestamp);{std::lock_guard<std::mutex> lock(journalMutex);segments.push_back(destination);}
    }
    ember_replay::PacketInfo info;info.presentationNs=block.timestamp;info.durationNs=(int64_t)(block.data.size()/2)*1000000000LL/48000;
    {std::lock_guard<std::mutex> budget(budgetMutex);const auto bytes=block.data.size()*sizeof(float);if(ledger->bytes.load()>16ULL*1024*1024*1024-bytes)throw std::runtime_error("Application audio history disk budget exceeded; combined audio is retained");destination->append(info,reinterpret_cast<const uint8_t*>(block.data.data()),(uint32_t)bytes);}
    {std::lock_guard<std::mutex> lock(journalMutex);for(auto it=pins.begin();it!=pins.end();){if(auto pin=it->lock()){if(info.presentationNs<pin->end&&info.presentationNs+info.durationNs>pin->start&&std::find(pin->segments.begin(),pin->segments.end(),destination)==pin->segments.end())pin->segments.push_back(destination);++it;}else it=pins.erase(it);}}
   }catch(const std::exception &error){std::lock_guard<std::mutex> lock(queueMutex);if(fault.empty())fault=error.what();}
   {std::lock_guard<std::mutex> lock(queueMutex);queuedBytes-=block.data.size()*sizeof(float);writing=false;}changed.notify_all();
  }
 }
 static void word(std::ostream &out,uint32_t value,int count){for(int n=0;n<count;n++)out.put((char)(value>>(8*n)));}
public:
 Journal(std::string key,std::string label,std::shared_ptr<ember_replay::Session> folder,std::shared_ptr<ember_replay::Ledger> count,int retentionSeconds):id(std::move(key)),name(std::move(label)),session(std::move(folder)),ledger(std::move(count)),retentionNs((int64_t)retentionSeconds*1000000000LL),writer(&Journal::work,this){}
 ~Journal(){{std::lock_guard<std::mutex> lock(queueMutex);closing=true;}changed.notify_all();if(writer.joinable())writer.join();}
 void push(const float *data,uint32_t frames,int64_t timestamp){
  if(timestamp>=captureEnd.load())return;
  bool audible=false;for(size_t n=0;n<(size_t)frames*2;n++)if(std::isfinite(data[n])&&std::abs(data[n])>0.0000001f){audible=true;break;}if(!audible)return;
  std::lock_guard<std::mutex> lock(queueMutex);if(closing||!fault.empty())return;if(queuedBytes+(uint64_t)frames*8>4*1024*1024){fault="Application audio writer could not keep up; combined audio is retained";return;}
  Samples block;block.timestamp=timestamp;block.data.assign(data,data+(size_t)frames*2);for(auto &sample:block.data)if(!std::isfinite(sample))sample=0;const auto bytes=block.data.size()*sizeof(float);pending.push_back(std::move(block));queuedBytes+=bytes;changed.notify_all();
 }
 void flush(){std::unique_lock<std::mutex> lock(queueMutex);if(!changed.wait_for(lock,std::chrono::seconds(10),[&]{return pending.empty()&&!writing;}))throw std::runtime_error("Application audio writer did not finish its snapshot");if(!fault.empty())throw std::runtime_error(fault);}
 void prune(int64_t now){std::vector<std::shared_ptr<ember_replay::Segment>> retired;{std::lock_guard<std::mutex> lock(journalMutex);retired=expire(now);}}
 bool empty(){std::lock_guard<std::mutex> lock(journalMutex);return segments.empty();}
 void pauseAfter(int64_t end){captureEnd=end;}
 // The unsafe sink is unregistered immediately. Three seconds also covers
 // its final queued block and the supported maximum positive sync offset.
 void markContaminated(int64_t now){std::lock_guard<std::mutex> lock(journalMutex);contaminatedUntil=std::max(contaminatedUntil,now+3000000000LL);}
 std::shared_ptr<Pin> pin(int64_t start,int64_t end){std::lock_guard<std::mutex> lock(journalMutex);auto result=std::make_shared<Pin>();result->start=start;result->end=end;result->segments.assign(segments.begin(),segments.end());pins.push_back(result);return result;}
 float wave(const std::filesystem::path &path,int64_t start,int64_t end,const std::shared_ptr<Pin> &pin={}){
  if(end<=start||end-start>301000000000LL)throw std::runtime_error("Invalid application audio snapshot duration");flush();
  {std::lock_guard<std::mutex> lock(journalMutex);if(start<contaminatedUntil)throw std::runtime_error("Overlapping process-tree audio: this ancestor application stem was omitted; combined audio is retained");}
  std::vector<ember_replay::PacketRef> records;
  {std::lock_guard<std::mutex> lock(journalMutex);auto collect=[&](const auto &owners){for(auto &segment:owners)for(const auto &record:segment->copyRecords())if(record.info.presentationNs<end&&record.info.presentationNs+record.info.durationNs>start)records.push_back({record.info,record.offset,record.size,segment,record.checksum});};if(pin)collect(pin->segments);else collect(segments);}
  if(records.empty())return 0;
  std::stable_sort(records.begin(),records.end(),[](const auto &a,const auto &b){return a.info.presentationNs<b.info.presentationNs;});
  auto peak=writeWave(path,start,end,records,[](const auto &record){return record.segment->read(record.offset,record.size);});
  {std::lock_guard<std::mutex> lock(journalMutex);if(start<contaminatedUntil){std::filesystem::remove(path);throw std::runtime_error("Overlapping process-tree audio: this ancestor application stem was omitted; combined audio is retained");}}
  return peak;
 }
 ember_replay::Snapshot durable(int64_t start,int64_t end,std::string *warning=nullptr){
  try{flush();}catch(const std::exception &e){if(!warning)throw;*warning=e.what();}ember_replay::Snapshot result;result.startNs=start;result.endNs=end;
  std::lock_guard<std::mutex> lock(journalMutex);if(start<contaminatedUntil)throw std::runtime_error("Overlapping ancestor application stem omitted; combined audio is retained");
  for(const auto &segment:segments)for(const auto &record:segment->copyRecords())if(record.info.presentationNs<end&&record.info.presentationNs+record.info.durationNs>start){result.packets.push_back({record.info,record.offset,record.size,segment,record.checksum});result.bytes+=record.size;}
  return result;
 }
 template<class Records,class Reader> static float writeWave(const std::filesystem::path &path,int64_t start,int64_t end,const Records &records,Reader read){
  if(end<=start||end-start>301000000000LL)throw std::runtime_error("Invalid application audio recovery duration");
  int64_t frames=(int64_t)std::llround((end-start)*48000.0/1000000000.0);uint32_t bytes=(uint32_t)(frames*8);
  std::ofstream out(path,std::ios::binary|std::ios::trunc);if(!out)throw std::runtime_error("Cannot create application audio snapshot");
  HANDLE sparse=CreateFileW(path.c_str(),GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);if(sparse!=INVALID_HANDLE_VALUE){DWORD ignored=0;DeviceIoControl(sparse,FSCTL_SET_SPARSE,nullptr,0,nullptr,0,&ignored,nullptr);CloseHandle(sparse);}
  out.write("RIFF",4);word(out,36+bytes,4);out.write("WAVEfmt ",8);word(out,16,4);word(out,3,2);word(out,2,2);word(out,48000,4);word(out,384000,4);word(out,8,2);word(out,32,2);out.write("data",4);word(out,bytes,4);
  float peak=0;size_t first=0;
  for(int64_t frame=0;frame<frames;frame+=48000){int64_t count=std::min<int64_t>(48000,frames-frame);std::vector<float> block((size_t)count*2,0);
   while(first<records.size()&&(int64_t)std::llround((records[first].info.presentationNs-start)*48000.0/1e9)+records[first].size/8<=frame)first++;
   for(size_t n=first;n<records.size();n++){const auto &record=records[n];int64_t at=(int64_t)std::llround((record.info.presentationNs-start)*48000.0/1e9);if(at>=frame+count)break;int64_t from=std::max<int64_t>(0,frame-at),to=std::max<int64_t>(0,at-frame),take=std::min<int64_t>((int64_t)record.size/8-from,count-to);if(take<=0)continue;
    auto data=read(record);for(int64_t sample=0;sample<take*2;sample++){float value;std::memcpy(&value,data.data()+(from*2+sample)*4,4);block[(size_t)to*2+sample]+=value;}
   }
   float local=0;for(auto value:block)local=std::max(local,std::abs(value));peak=std::max(peak,local);if(local>0.0000001f){out.seekp(44+frame*8);out.write(reinterpret_cast<const char*>(block.data()),count*8);}
  }
  if(peak<=0.0000001f){out.close();std::filesystem::remove(path);return 0;}if(out.tellp()<44+(int64_t)bytes){out.seekp(43+(int64_t)bytes);out.put(0);}out.flush();if(!out)throw std::runtime_error("Application audio snapshot write failed");return peak;
 }
 const std::string &label()const{return name;}
};
}
