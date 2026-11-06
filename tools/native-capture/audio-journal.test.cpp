#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include "audio-journal.hpp"
#include "audio-tree-policy.hpp"
#include <cassert>
#include <fstream>
#include <iostream>
int main()try{
 {std::unordered_map<uint32_t,uint32_t> parents={{100,1},{200,100},{300,1}};auto blocked=ember_audio_policy::overlappingAncestors({{"steam",{100}},{"quake",{200}},{"discord",{300}}},parents);assert(blocked==std::set<uint32_t>({100}));assert(ember_audio_policy::overlappingAncestors({{"same-app",{100}},{"same-app",{200}}},parents).empty());}
 auto root=std::filesystem::temp_directory_path()/("ember-audio-test-"+std::to_string(GetCurrentProcessId()));std::filesystem::create_directories(root);
 {auto ledger=std::make_shared<ember_replay::Ledger>();auto session=std::make_shared<ember_replay::Session>(root);
 ember_app_audio::Journal journal("test","Test app",session,ledger,360);
 std::vector<float> tone(2400*2,.25f),other(2400*2,.2f),silence(4800*2,0);
 journal.push(silence.data(),4800,1000000000);journal.push(tone.data(),2400,1100000000);journal.push(other.data(),2400,1100000000);journal.flush();
 auto out=root/"test.wav";auto peak=journal.wave(out,1000000000,1500000000);assert(std::abs(peak-.45f)<.0001f);assert(std::filesystem::file_size(out)==44+24000*8);
 std::ifstream wave(out,std::ios::binary);float first=1,signal=0;wave.seekg(44);wave.read((char*)&first,4);wave.seekg(44+4800*8);wave.read((char*)&signal,4);assert(first==0);assert(std::abs(signal-.45f)<.0001f);
 assert(journal.wave(root/"silent.wav",2000000000,2500000000)==0);assert(!std::filesystem::exists(root/"silent.wav"));
 auto pinned=journal.pin(1000000000,1500000000);journal.prune(500000000000LL);assert(journal.wave(root/"expired.wav",1000000000,1500000000)==0);assert(std::abs(journal.wave(root/"pinned.wav",1000000000,1500000000,pinned)-.45f)<.0001f);std::filesystem::remove(root/"pinned.wav");
 wave.close();std::filesystem::remove(out);}
 {auto ledger=std::make_shared<ember_replay::Ledger>();auto session=std::make_shared<ember_replay::Session>(root);ember_app_audio::Journal journal("bounded","Bounded",session,ledger,360);std::vector<float> oversized(524289*2,.1f);journal.push(oversized.data(),524289,1000000000);bool failed=false;try{journal.flush();}catch(const std::exception &e){failed=std::string(e.what()).find("keep up")!=std::string::npos;}assert(failed);assert(ledger->bytes.load()==0);}
 {auto ledger=std::make_shared<ember_replay::Ledger>();auto session=std::make_shared<ember_replay::Session>(root);ember_app_audio::Journal journal("fault-tail","Fault tail",session,ledger,360);std::vector<float> good(960,.2f),oversized(524289*2,.1f);journal.push(good.data(),480,1100000000);journal.flush();journal.push(oversized.data(),524289,1200000000);std::string warning;auto available=journal.durable(1000000000,2000000000,&warning);assert(available.packets.size()==1);assert(!warning.empty());assert(available.packets[0].checksum!=0);}
 {auto ledger=std::make_shared<ember_replay::Ledger>();auto session=std::make_shared<ember_replay::Session>(root);ember_app_audio::Journal journal("budget","Budget",session,ledger,360);ledger->bytes=16ULL*1024*1024*1024;std::vector<float> data(960,.1f);journal.push(data.data(),480,1000000000);bool failed=false;try{journal.flush();}catch(const std::exception &e){failed=std::string(e.what()).find("budget")!=std::string::npos;}assert(failed);assert(ledger->bytes.load()==16ULL*1024*1024*1024);ledger->bytes=0;}
 {auto ledger=std::make_shared<ember_replay::Ledger>();auto session=std::make_shared<ember_replay::Session>(root);ember_app_audio::Journal journal("steam","Steam",session,ledger,360);std::vector<float> mixed(960,.4f);journal.push(mixed.data(),480,1100000000);journal.flush();auto pin=journal.pin(1000000000,1500000000);journal.markContaminated(2000000000);bool suppressed=false;try{journal.wave(root/"contaminated.wav",1000000000,1500000000,pin);}catch(const std::exception &e){suppressed=std::string(e.what()).find("combined audio")!=std::string::npos;}assert(suppressed);assert(!std::filesystem::exists(root/"contaminated.wav"));}
 assert(std::filesystem::is_empty(root));std::filesystem::remove(root);std::cout<<"Aligned sparse audio, source mixing, silence exclusion and retention passed\n";
}catch(const std::exception &error){std::cerr<<error.what()<<'\n';return 1;}
