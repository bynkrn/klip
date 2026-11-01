// Independent Windows process-loopback packet timestamps; no libobs code.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <ks.h>
#include <ksmedia.h>
#include <wrl/client.h>
#include <wrl/implements.h>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include "json.hpp"
using Microsoft::WRL::ComPtr;using json=nlohmann::json;
static void check(HRESULT hr,const char *what){if(FAILED(hr))throw std::runtime_error(std::string(what)+" HRESULT="+std::to_string((unsigned)hr));}
class Activation final:public Microsoft::WRL::RuntimeClass<Microsoft::WRL::RuntimeClassFlags<Microsoft::WRL::ClassicCom>,Microsoft::WRL::FtmBase,IActivateAudioInterfaceCompletionHandler>{
public:HANDLE signal=CreateEventW(nullptr,FALSE,FALSE,nullptr);HRESULT result=E_FAIL;ComPtr<IAudioClient> client;
 ~Activation(){CloseHandle(signal);}
 STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation *operation)override{HRESULT active=E_FAIL;ComPtr<IUnknown> object;result=operation->GetActivateResult(&active,&object);if(SUCCEEDED(result))result=active;if(SUCCEEDED(result))result=object.As(&client);SetEvent(signal);return S_OK;}
};
int main(int argc,char **argv){try{
 if(argc!=2)throw std::runtime_error("Expected target process id");DWORD pid=std::stoul(argv[1]);check(CoInitializeEx(nullptr,COINIT_MULTITHREADED),"COM");
 AUDIOCLIENT_ACTIVATION_PARAMS parameters{};parameters.ActivationType=AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;parameters.ProcessLoopbackParams.TargetProcessId=pid;parameters.ProcessLoopbackParams.ProcessLoopbackMode=PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
 PROPVARIANT properties{};properties.vt=VT_BLOB;properties.blob.cbSize=sizeof(parameters);properties.blob.pBlobData=reinterpret_cast<BYTE*>(&parameters);
 ComPtr<IAudioClient> client;if(pid){auto handler=Microsoft::WRL::Make<Activation>();ComPtr<IActivateAudioInterfaceAsyncOperation> operation;check(ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,__uuidof(IAudioClient),&properties,handler.Get(),&operation),"Activate process loopback");if(WaitForSingleObject(handler->signal,10000)!=WAIT_OBJECT_0)throw std::runtime_error("Activation timeout");check(handler->result,"Process audio activation");client=handler->client;}else{ComPtr<IMMDeviceEnumerator> enumerator;check(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,IID_PPV_ARGS(&enumerator)),"Device enumerator");ComPtr<IMMDevice> endpoint;check(enumerator->GetDefaultAudioEndpoint(eRender,eConsole,&endpoint),"Default render endpoint");check(endpoint->Activate(__uuidof(IAudioClient),CLSCTX_ALL,nullptr,&client),"Activate system loopback");}
 WAVEFORMATEXTENSIBLE format{};format.Format.wFormatTag=WAVE_FORMAT_EXTENSIBLE;format.Format.nChannels=2;format.Format.nSamplesPerSec=48000;format.Format.wBitsPerSample=32;format.Format.nBlockAlign=8;format.Format.nAvgBytesPerSec=384000;format.Format.cbSize=22;format.Samples.wValidBitsPerSample=32;format.dwChannelMask=3;format.SubFormat=KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
 check(client->Initialize(AUDCLNT_SHAREMODE_SHARED,AUDCLNT_STREAMFLAGS_LOOPBACK,10000000,0,&format.Format,nullptr),"Initialize loopback");ComPtr<IAudioCaptureClient> capture;check(client->GetService(IID_PPV_ARGS(&capture)),"Capture service");check(client->Start(),"Start loopback");
 REFERENCE_TIME latency=0,period=0,minPeriod=0;HRESULT latencyResult=client->GetStreamLatency(&latency),periodResult=client->GetDevicePeriod(&period,&minPeriod);UINT32 bufferFrames=0;HRESULT bufferResult=client->GetBufferSize(&bufferFrames);
 LARGE_INTEGER frequency;QueryPerformanceFrequency(&frequency);std::cout<<json({{"event","reader-ready"},{"pid",pid},{"sampleRate",48000},{"captureStreamLatencyHresult",(unsigned)latencyResult},{"captureStreamLatencyMs",SUCCEEDED(latencyResult)?json(double(latency)/10000):json(nullptr)},{"devicePeriodHresult",(unsigned)periodResult},{"devicePeriodMs",SUCCEEDED(periodResult)?json(double(period)/10000):json(nullptr)},{"bufferSizeHresult",(unsigned)bufferResult},{"bufferFrames",bufferFrames}}).dump()<<'\n'<<std::flush;
 double cosine[48],sine[48];for(int i=0;i<48;i++){cosine[i]=std::cos(2*3.14159265358979323846*1000*i/48000);sine[i]=std::sin(2*3.14159265358979323846*1000*i/48000);}
 for(;;){UINT32 available=0;check(capture->GetNextPacketSize(&available),"Packet size");while(available){BYTE *bytes=nullptr;UINT32 frames=0;DWORD flags=0;UINT64 position=0,qpc=0;check(capture->GetBuffer(&bytes,&frames,&flags,&position,&qpc),"Packet buffer");LARGE_INTEGER now;QueryPerformanceCounter(&now);json amplitudes=json::array();for(UINT32 first=0;first+48<=frames;first+=48){double real=0,imag=0;for(UINT32 i=0;i<48;i++){double mono=flags&AUDCLNT_BUFFERFLAGS_SILENT?0:(reinterpret_cast<float*>(bytes)[(first+i)*2]+reinterpret_cast<float*>(bytes)[(first+i)*2+1])*0.5;real+=mono*cosine[i];imag+=mono*sine[i];}amplitudes.push_back(2*std::hypot(real,imag)/48);}std::cout<<json({{"event","packet"},{"qpc100ns",qpc},{"readQpc100ns",double(now.QuadPart)*1e7/frequency.QuadPart},{"frames",frames},{"flags",flags},{"devicePosition",position},{"toneAmplitudes",amplitudes}}).dump()<<'\n'<<std::flush;check(capture->ReleaseBuffer(frames),"Release packet");check(capture->GetNextPacketSize(&available),"Next packet");}Sleep(2);}
 }catch(const std::exception &error){std::cerr<<error.what()<<'\n';return 1;}}
