const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('klip',{call:async(name,...args)=>{const result=await ipcRenderer.invoke('klip:'+name,...args);if(result.error)throw new Error(result.error);return result.data;},onState:fn=>{const handler=(_,data)=>fn(data);ipcRenderer.on('native-state',handler);return()=>ipcRenderer.removeListener('native-state',handler);}});
