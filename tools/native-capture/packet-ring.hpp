#pragma once
#include <windows.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
#include <deque>
#include <filesystem>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

// Encoded payloads stay in their selected storage. Snapshots pin segment owners,
// never duplicate the history, and may read while the capture appends/expires.
namespace ember_replay {
inline uint32_t checksum(const uint8_t *data,size_t size){static const auto table=[](){std::array<uint32_t,256> t{};for(uint32_t i=0;i<256;++i){auto c=i;for(int n=0;n<8;++n)c=(c>>1)^((c&1)?0xedb88320U:0);t[i]=c;}return t;}();uint32_t c=~0U;for(size_t i=0;i<size;++i)c=table[(c^data[i])&255]^(c>>8);return ~c;}
enum class Storage {Ram,Disk};
struct PacketInfo {
 int64_t pts=0,dts=0,sysDtsUsec=0,presentationNs=0,durationNs=0;
 int32_t timebaseNum=1,timebaseDen=1;
 uint32_t track=0;
 bool video=false,keyframe=false;
};
struct Ledger {std::atomic<uint64_t> bytes{0};};
inline uint64_t processCreatedAt(HANDLE process){FILETIME created{},exit{},kernel{},user{};if(!GetProcessTimes(process,&created,&exit,&kernel,&user))return 0;return (uint64_t(created.dwHighDateTime)<<32)|created.dwLowDateTime;}
inline bool journalOwnerDead(const std::wstring &name){auto dash=name.find(L'-',12);if(dash==std::wstring::npos)return false;uint64_t pid=0,created=0;try{pid=std::stoull(name.substr(12,dash-12));if(std::count(name.begin()+12,name.end(),L'-')>=3)created=std::stoull(name.substr(name.rfind(L'-')+1));}catch(...){return false;}if(!pid||pid>MAXDWORD)return false;HANDLE owner=OpenProcess(SYNCHRONIZE|PROCESS_QUERY_LIMITED_INFORMATION,FALSE,(DWORD)pid);if(!owner)return GetLastError()==ERROR_INVALID_PARAMETER;const auto actual=processCreatedAt(owner);bool dead=WaitForSingleObject(owner,0)==WAIT_OBJECT_0||(created&&actual&&created!=actual);CloseHandle(owner);return dead;}
struct Session {
 std::filesystem::path folder;
 std::mutex preserveMutex;size_t preservedFiles=0;
 explicit Session(const std::filesystem::path &root){
  // A process crash can leave transient manual-delete files. Reclaim only our
  // dead-owner directories without a durable recovery marker; never recurse.
  std::error_code scanError;for(const auto &entry:std::filesystem::directory_iterator(root,scanError)){const auto name=entry.path().filename().wstring();if(name.rfind(L".ember-ring-",0)!=0||(GetFileAttributesW(entry.path().c_str())&FILE_ATTRIBUTE_REPARSE_POINT)||std::filesystem::exists(entry.path()/L".preserve"))continue;bool dead=journalOwnerDead(name);if(!dead)continue;std::vector<std::filesystem::path> files;bool owned=true;for(const auto &file:std::filesystem::directory_iterator(entry.path(),scanError)){auto stem=file.path().stem().wstring();if(file.path().extension()!=L".packets"||stem.empty()||stem.find_first_not_of(L"0123456789")!=std::wstring::npos||(GetFileAttributesW(file.path().c_str())&FILE_ATTRIBUTE_REPARSE_POINT)){owned=false;break;}files.push_back(file.path());}if(!owned||scanError)continue;for(const auto &file:files)std::filesystem::remove(file,scanError);std::filesystem::remove(entry.path(),scanError);}
  static std::atomic<uint64_t> serial{0};
  for(int attempt=0;attempt<32;++attempt){folder=root/(L".ember-ring-"+std::to_wstring(GetCurrentProcessId())+L"-"+std::to_wstring(GetTickCount64())+L"-"+std::to_wstring(++serial)+L"-"+std::to_wstring(processCreatedAt(GetCurrentProcess())));if(std::filesystem::create_directory(folder))return;}
  throw std::runtime_error("Cannot create private replay journal");
 }
 ~Session(){std::error_code error;std::filesystem::remove(folder,error);}
 void retain(){std::lock_guard<std::mutex> lock(preserveMutex);if(!preservedFiles){auto marker=folder/L".preserve";HANDLE handle=CreateFileW(marker.c_str(),GENERIC_WRITE,FILE_SHARE_READ,nullptr,OPEN_ALWAYS,FILE_ATTRIBUTE_NORMAL|FILE_FLAG_WRITE_THROUGH,nullptr);if(handle==INVALID_HANDLE_VALUE)throw std::runtime_error("Cannot mark replay journal for durable recovery");bool ok=FlushFileBuffers(handle)!=FALSE;CloseHandle(handle);if(!ok)throw std::runtime_error("Cannot flush replay recovery marker");}++preservedFiles;}
 void release(){std::lock_guard<std::mutex> lock(preserveMutex);if(preservedFiles&&!--preservedFiles){std::error_code ignored;std::filesystem::remove(folder/L".preserve",ignored);}}
};
class Segment {
 Storage storage;
 std::shared_ptr<Ledger> ledger;
 std::shared_ptr<Session> session;
 std::filesystem::path file;
 HANDLE handle=INVALID_HANDLE_VALUE;
 std::vector<std::vector<uint8_t>> memory;
 uint64_t bytes=0;
 size_t preserved=0;uint64_t flushedBytes=0;
 mutable std::mutex io;
public:
 struct Record {PacketInfo info;uint64_t offset;uint32_t size;uint32_t checksum;};
 std::vector<Record> records;
 int64_t startNs;
 Segment(Storage mode,std::shared_ptr<Ledger> count,std::shared_ptr<Session> owner,uint64_t sequence,int64_t start):storage(mode),ledger(std::move(count)),session(std::move(owner)),startNs(start){
  if(storage==Storage::Disk){file=session->folder/(std::to_wstring(sequence)+L".packets");handle=CreateFileW(file.c_str(),GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,CREATE_NEW,FILE_ATTRIBUTE_TEMPORARY,nullptr);if(handle==INVALID_HANDLE_VALUE)throw std::runtime_error("Cannot create replay journal file");}
 }
 ~Segment(){if(handle!=INVALID_HANDLE_VALUE){CloseHandle(handle);if(!preserved){std::error_code ignored;std::filesystem::remove(file,ignored);}}ledger->bytes.fetch_sub(bytes);}
 Segment(const Segment&)=delete;
 const std::filesystem::path &path()const{return file;}
 uint64_t size()const{std::lock_guard<std::mutex> lock(io);return bytes;}
 void preserveDiskFile(){std::lock_guard<std::mutex> lock(io);if(storage!=Storage::Disk)throw std::runtime_error("RAM replay cannot be retained without free disk space");if(flushedBytes!=bytes){if(!FlushFileBuffers(handle))throw std::runtime_error("Cannot flush retained replay data for recovery");flushedBytes=bytes;}if(!preserved)session->retain();++preserved;}
 void releaseDiskFilePreservation(){std::lock_guard<std::mutex> lock(io);if(preserved&&!--preserved)session->release();}
 std::vector<Record> copyRecords()const{std::lock_guard<std::mutex> lock(io);return records;}
 void append(const PacketInfo &info,const uint8_t *data,uint32_t size){
  std::lock_guard<std::mutex> lock(io);
  // Reserve metadata first: a failed allocation must never orphan stored bytes.
  if(records.size()==records.capacity())records.reserve(std::max<size_t>(16,records.capacity()*2));
  if(storage==Storage::Ram&&memory.size()==memory.capacity())memory.reserve(std::max<size_t>(16,memory.capacity()*2));
  if(storage==Storage::Disk){LARGE_INTEGER offset{};offset.QuadPart=bytes;DWORD written=0;if(!SetFilePointerEx(handle,offset,nullptr,FILE_BEGIN)||!WriteFile(handle,data,size,&written,nullptr)||written!=size)throw std::runtime_error("Replay journal write failed; check free disk space");}
  else memory.emplace_back(data,data+size);
  records.push_back({info,bytes,size,checksum(data,size)});bytes+=size;ledger->bytes.fetch_add(size);
 }
 std::vector<uint8_t> read(uint64_t offset,uint32_t count)const{
  std::lock_guard<std::mutex> lock(io);if(offset>bytes||count>bytes-offset)throw std::runtime_error("Replay snapshot packet is outside its segment");
  std::vector<uint8_t> result(count);
  if(storage==Storage::Disk){LARGE_INTEGER at{};at.QuadPart=offset;DWORD got=0;if(!SetFilePointerEx(handle,at,nullptr,FILE_BEGIN)||!ReadFile(handle,result.data(),count,&got,nullptr)||got!=count)throw std::runtime_error("Replay snapshot journal read failed");}
  else {auto found=std::lower_bound(records.begin(),records.end(),offset,[](const Record &r,uint64_t at){return r.offset<at;});if(found==records.end()||found->offset!=offset||found->size!=count)throw std::runtime_error("Replay RAM packet was not found");result=memory[(size_t)(found-records.begin())];}
  return result;
 }
};
struct PacketRef {PacketInfo info;uint64_t offset;uint32_t size;std::shared_ptr<Segment> segment;uint32_t checksum=0;};
struct Snapshot {
 int64_t startNs=0,endNs=0;
 uint64_t bytes=0;
 std::vector<PacketRef> packets;
 std::vector<uint8_t> read(const PacketRef &packet)const{return packet.segment->read(packet.offset,packet.size);}
};
class Ring {
 Storage storage;
 std::filesystem::path directory;
 int64_t durationNs;
 uint64_t maxBytes,minFreeBytes,sequence=0,retained=0,packetCount=0;
 uint64_t spaceCheckedAt=0,spaceBudget=0,spaceConsumed=0;
 int64_t lastEndNs=0;
 std::shared_ptr<Ledger> ledger=std::make_shared<Ledger>();
 std::shared_ptr<Session> session;
 std::deque<std::shared_ptr<Segment>> segments;
 mutable std::mutex mutex;
 void expire(int64_t end){
  // Retain a predecessor GOP for an exact bounded snapshot selection. It costs
  // at most one configured 1-second GOP beyond the selected history.
  const auto cutoff=end-durationNs;
  while(segments.size()>1&&segments[1]->startNs<=cutoff){auto &old=segments.front();retained-=old->size();packetCount-=old->records.size();segments.pop_front();}
 }
public:
 Ring(Storage mode,const std::filesystem::path &root,int64_t duration,uint64_t limit,uint64_t reserve):storage(mode),directory(root),durationNs(duration),maxBytes(limit),minFreeBytes(reserve){if(duration<=0||duration>300000000000LL||!limit)throw std::runtime_error("Invalid replay history limit");std::filesystem::create_directories(root);if(mode==Storage::Disk)session=std::make_shared<Session>(root);}
 void append(const PacketInfo &info,const uint8_t *data,size_t count){
  std::lock_guard<std::mutex> lock(mutex);
  if(!count)return;
  if(count>32*1024*1024)throw std::runtime_error("Replay packet exceeds the safe packet limit");
  if(segments.empty()&&!(info.video&&info.keyframe))return;
  if(info.video)expire(std::max(lastEndNs,info.presentationNs+info.durationNs));
  if(packetCount>=500000||count>maxBytes||ledger->bytes.load()>maxBytes-count)throw std::runtime_error(storage==Storage::Ram?"RAM replay limit reached. Save the current history and choose disk storage or a shorter duration.":"Disk replay limit reached. Save the current history and choose a shorter duration.");
  if(storage==Storage::Disk){
   const auto now=GetTickCount64();if(!spaceCheckedAt||now-spaceCheckedAt>=1000||spaceConsumed>=64*1048576ULL||spaceBudget<count){std::error_code error;auto space=std::filesystem::space(directory,error);if(error||space.available<minFreeBytes)throw std::runtime_error("Insufficient free disk space for replay history; capture stopped before losing retained history");spaceBudget=space.available-minFreeBytes;spaceCheckedAt=now;spaceConsumed=0;}
   if(spaceBudget<count)throw std::runtime_error("Insufficient free disk space for replay history; capture stopped before losing retained history");spaceBudget-=count;spaceConsumed+=count;
  }
  if(info.video&&info.keyframe){segments.push_back(std::make_shared<Segment>(storage,ledger,session,++sequence,info.presentationNs));}
  segments.back()->append(info,data,(uint32_t)count);retained+=count;++packetCount;
  if(info.video)lastEndNs=std::max(lastEndNs,info.presentationNs+info.durationNs);
 }
 Snapshot snapshot(bool completedOnly=false)const{
  std::lock_guard<std::mutex> lock(mutex);Snapshot result;if(!lastEndNs)throw std::runtime_error("Replay history has no video frames yet");
  result.packets.reserve((size_t)packetCount);
  const int64_t end=completedOnly?segments.back()->startNs:lastEndNs,cutoff=end-durationNs;
  for(const auto &segment:segments){if(segment->startNs<cutoff||segment->startNs>=end)continue;if(!result.startNs)result.startNs=segment->startNs;for(const auto &record:segment->records){
    // Audio can straddle the boundary by one AAC frame; retain only samples
    // whose presentation starts inside the exact video window.
    if(record.info.presentationNs<result.startNs||record.info.presentationNs>=end)continue;
    result.packets.push_back({record.info,record.offset,record.size,segment,record.checksum});result.bytes+=record.size;
   }}
  if(result.packets.empty()||!result.packets.front().info.video||!result.packets.front().info.keyframe)throw std::runtime_error("Replay has not reached a usable keyframe inside the selected duration");
  result.endNs=end;return result;
 }
 uint64_t liveBytes()const{return ledger->bytes.load();}
 uint64_t retainedBytes()const{std::lock_guard<std::mutex> lock(mutex);return retained;}
 double retainedSeconds()const{std::lock_guard<std::mutex> lock(mutex);for(const auto &segment:segments)if(segment->startNs>=lastEndNs-durationNs&&!segment->records.empty())return double(lastEndNs-segment->startNs)/1e9;return 0;}
};
}
