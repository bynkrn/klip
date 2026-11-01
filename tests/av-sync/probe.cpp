#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <wrl/client.h>
#include <atomic>
#include <thread>
#include <iostream>
#include <mutex>
#include <cmath>
#include <stdexcept>
#include "json.hpp"
using Microsoft::WRL::ComPtr;
using json=nlohmann::json;
static HWND windowHandle;
static std::atomic<bool> finished=false;
static std::atomic<UINT64> clockPosition=0,clockQpc=0,clockFrequency=1;
static std::atomic<UINT32> paddingFrames=0;
static std::atomic<UINT64> submittedFrames=0;
static std::atomic<UINT32> rate=48000,bufferCapacity=0;
static std::mutex outputMutex;
static bool marker=false;
static LARGE_INTEGER qpcFrequency;
static double qpc100ns(){LARGE_INTEGER now;QueryPerformanceCounter(&now);return double(now.QuadPart)*1e7/double(qpcFrequency.QuadPart);}
static void output(const json &value){std::lock_guard<std::mutex> lock(outputMutex);std::cout<<value.dump()<<'\n'<<std::flush;}
static void check(HRESULT hr,const char *what){if(FAILED(hr))throw std::runtime_error(std::string(what)+" HRESULT="+std::to_string((unsigned)hr));}
static void audioThread(){
 HRESULT apartment=CoInitializeEx(nullptr,COINIT_MULTITHREADED);
 try{
  ComPtr<IMMDeviceEnumerator> enumerator;check(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,IID_PPV_ARGS(&enumerator)),"Audio enumerator");
  ComPtr<IMMDevice> device;check(enumerator->GetDefaultAudioEndpoint(eRender,eConsole,&device),"Default audio endpoint");
  ComPtr<IAudioClient> client;check(device->Activate(__uuidof(IAudioClient),CLSCTX_ALL,nullptr,&client),"Audio client");
  WAVEFORMATEX *mix=nullptr;check(client->GetMixFormat(&mix),"Mix format");
  bool floating=mix->wFormatTag==WAVE_FORMAT_IEEE_FLOAT||(mix->wFormatTag==WAVE_FORMAT_EXTENSIBLE&&reinterpret_cast<WAVEFORMATEXTENSIBLE*>(mix)->SubFormat.Data1==WAVE_FORMAT_IEEE_FLOAT);
  if(!(floating&&mix->wBitsPerSample==32)&&mix->wBitsPerSample!=16)throw std::runtime_error("Probe supports float32 or PCM16 endpoint mix formats");
  check(client->Initialize(AUDCLNT_SHAREMODE_SHARED,AUDCLNT_STREAMFLAGS_NOPERSIST,300000,0,mix,nullptr),"Initialize audio");
  UINT32 capacity=0;check(client->GetBufferSize(&capacity),"Audio buffer size");
  REFERENCE_TIME latency=0,period=0,minPeriod=0;check(client->GetStreamLatency(&latency),"Stream latency");check(client->GetDevicePeriod(&period,&minPeriod),"Device period");
  ComPtr<IAudioRenderClient> render;ComPtr<IAudioClock> clock;check(client->GetService(IID_PPV_ARGS(&render)),"Render service");check(client->GetService(IID_PPV_ARGS(&clock)),"Audio clock");
  UINT64 frequency=0;check(clock->GetFrequency(&frequency),"Clock frequency");clockFrequency=frequency;
  UINT64 written=0;const auto sampleRate=mix->nSamplesPerSec;const auto channels=mix->nChannels;rate=sampleRate;bufferCapacity=capacity;
  auto fill=[&](UINT32 count){if(!count)return;BYTE *bytes=nullptr;check(render->GetBuffer(count,&bytes),"Render buffer");for(UINT32 frame=0;frame<count;++frame){double t=double(written+frame)/sampleRate,phase=t>=4?std::fmod(t-4,5.0):-1.0;double signal=0;if(phase>=0&&phase<0.060){double envelope=std::min(1.0,std::min(phase/0.002,(0.060-phase)/0.002));signal=0.0125*envelope*std::sin(2.0*3.14159265358979323846*1000.0*t);}for(UINT16 channel=0;channel<channels;++channel){size_t i=size_t(frame)*channels+channel;if(floating)reinterpret_cast<float*>(bytes)[i]=float(signal);else reinterpret_cast<short*>(bytes)[i]=short(signal*32767);}}written+=count;submittedFrames=written;check(render->ReleaseBuffer(count,0),"Queue audio");};
  fill(capacity);UINT64 beforePosition=0,beforeClockQpc=0,afterPosition=0,afterClockQpc=0;check(clock->GetPosition(&beforePosition,&beforeClockQpc),"Initial clock position");double beforeStart=qpc100ns();check(client->Start(),"Start audio");double afterStart=qpc100ns();check(clock->GetPosition(&afterPosition,&afterClockQpc),"Started clock position");
  output({{"event","ready"},{"sampleRate",sampleRate},{"channels",channels},{"float32",floating},{"amplitude",0.0125},{"toneHz",1000},{"toneSeconds",0.060},{"periodSeconds",5},{"firstPulseSeconds",4},{"markerSeconds",0.090},{"streamLatencyMs",double(latency)/10000},{"devicePeriodMs",double(period)/10000},{"bufferFrames",capacity},{"clockFrequency",frequency},{"clockPositionBeforeStart",beforePosition},{"clockPositionAfterStart",afterPosition},{"prefillFramesIncludedInWrittenCounter",written},{"beforeStartQpc100ns",beforeStart},{"afterStartQpc100ns",afterStart},{"window",{{"x",16},{"y",16},{"width",240},{"height",100}}},{"marker",{{"x",24},{"y",24},{"width",16},{"height",16}}}});
  HANDLE timer=CreateWaitableTimerExW(nullptr,nullptr,CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,TIMER_ALL_ACCESS);if(!timer)timer=CreateWaitableTimerW(nullptr,FALSE,nullptr);
  bool previous=false;int previousIndex=-1;
  while(!finished){
   UINT32 padding=0;check(client->GetCurrentPadding(&padding),"Current audio padding");paddingFrames=padding;fill(capacity-padding);
   UINT64 position=0,qpc=0;check(clock->GetPosition(&position,&qpc),"Audio playback position");clockPosition=position;clockQpc=qpc;
   double seconds=double(position)/frequency;int index=seconds>=4?int(std::floor((seconds-4)/5)):-1;double phase=index>=0?seconds-(4+index*5):-1;bool on=phase>=0&&phase<0.090;
   if(on!=previous||(on&&index!=previousIndex)){previous=on;previousIndex=index;PostMessageW(windowHandle,WM_APP+1,on?index+1:0,0);}
   if(seconds>=160){PostMessageW(windowHandle,WM_CLOSE,0,0);break;}
   LARGE_INTEGER due;due.QuadPart=-10000;SetWaitableTimer(timer,&due,0,nullptr,nullptr,FALSE);WaitForSingleObject(timer,20);
  }
  CloseHandle(timer);client->Stop();CoTaskMemFree(mix);
 }catch(const std::exception &error){output({{"event","error"},{"message",error.what()}});PostMessageW(windowHandle,WM_CLOSE,0,0);}
 if(SUCCEEDED(apartment))CoUninitialize();
}
static LRESULT CALLBACK windowProcedure(HWND window,UINT message,WPARAM w,LPARAM l){
 if(message==WM_NCHITTEST)return HTTRANSPARENT;
 if(message==WM_MOUSEACTIVATE)return MA_NOACTIVATE;
 if(message==WM_APP+1){
  marker=w!=0;UINT64 position=clockPosition.load(),clockTime=clockQpc.load(),frequency=clockFrequency.load();double audioSeconds=double(position)/frequency;
  InvalidateRect(window,nullptr,FALSE);UpdateWindow(window);double drawn=qpc100ns();
  if(marker){int index=int(w)-1;double expected=4+index*5,predictedQpc=double(clockTime)+(expected-audioSeconds)*1e7;output({{"event","paint"},{"index",index},{"pulseSeconds",expected},{"clockSeconds",audioSeconds},{"clockQpc100ns",clockTime},{"paintQpc100ns",drawn},{"expectedAudioQpc100ns",predictedQpc},{"paintLatenessMs",(drawn-predictedQpc)/10000},{"queuedFramesBeforeRefill",paddingFrames.load()},{"submittedFrames",submittedFrames.load()},{"clockFrames",audioSeconds*rate.load()},{"filledBufferFrames",bufferCapacity.load()}});}
  return 0;
 }
 if(message==WM_PAINT){PAINTSTRUCT paint;HDC dc=BeginPaint(window,&paint);RECT area;GetClientRect(window,&area);HBRUSH background=CreateSolidBrush(RGB(32,32,32));FillRect(dc,&area,background);DeleteObject(background);RECT square{8,8,24,24};HBRUSH color=CreateSolidBrush(marker?RGB(220,128,32):RGB(48,48,48));FillRect(dc,&square,color);DeleteObject(color);SetBkMode(dc,TRANSPARENT);SetTextColor(dc,RGB(132,132,132));const wchar_t *text=L"Klip A/V timing test\nQuiet pulse every 5 seconds\nThis window does not take focus";RECT textArea{32,8,232,92};DrawTextW(dc,text,-1,&textArea,DT_LEFT|DT_WORDBREAK);EndPaint(window,&paint);return 0;}
 if(message==WM_CLOSE){finished=true;DestroyWindow(window);return 0;}
 if(message==WM_DESTROY){PostQuitMessage(0);return 0;}
 return DefWindowProcW(window,message,w,l);
}
int main(){
 SetProcessDPIAware();QueryPerformanceFrequency(&qpcFrequency);WNDCLASSW wc{};wc.hInstance=GetModuleHandleW(nullptr);wc.lpszClassName=L"KlipAvSyncProbeWindow";wc.lpfnWndProc=windowProcedure;RegisterClassW(&wc);
 windowHandle=CreateWindowExW(WS_EX_NOACTIVATE|WS_EX_TOPMOST|WS_EX_TRANSPARENT|WS_EX_LAYERED,wc.lpszClassName,L"Klip AV sync probe",WS_POPUP,16,16,240,100,nullptr,nullptr,wc.hInstance,nullptr);if(!windowHandle)return 2;
 SetLayeredWindowAttributes(windowHandle,0,255,LWA_ALPHA);SetWindowPos(windowHandle,HWND_TOPMOST,16,16,240,100,SWP_NOACTIVATE|SWP_SHOWWINDOW);
 std::thread audio(audioThread);MSG message;while(GetMessageW(&message,nullptr,0,0)>0){TranslateMessage(&message);DispatchMessageW(&message);}finished=true;audio.join();return 0;
}
