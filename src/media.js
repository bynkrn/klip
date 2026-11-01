const fs=require('node:fs'),path=require('node:path'),{Readable}=require('node:stream');
function parseRange(header,size){
 const match=/^bytes=(\d*)-(\d*)$/i.exec(header.trim());if(!match||!size||!match[1]&&!match[2])return null;
 let start,end;if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return null;start=Math.max(0,size-suffix);end=size-1;}
 else{start=Number(match[1]);end=match[2]?Number(match[2]):size-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start)return null;end=Math.min(end,size-1);}
 return{start,end};
}
async function fileResponse(file,request){
 if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
 let stat;try{stat=await fs.promises.stat(file);}catch{return new Response(null,{status:404});}if(!stat.isFile())return new Response(null,{status:404});
 const type={'.mp4':'video/mp4','.m4a':'audio/mp4','.aac':'audio/aac','.mkv':'video/x-matroska','.webm':'video/webm','.mov':'video/quicktime','.jpg':'image/jpeg','.png':'image/png'}[path.extname(file).toLowerCase()]||'application/octet-stream';
 const headers={'Content-Type':type,'Accept-Ranges':'bytes'},requested=request.method==='GET'?request.headers.get('range'):null;
 const range=requested?parseRange(requested,stat.size):{start:0,end:stat.size-1};
 if(!range)return new Response(null,{status:416,headers:{...headers,'Content-Range':'bytes */'+stat.size}});
 headers['Content-Length']=String(Math.max(0,range.end-range.start+1));if(requested)headers['Content-Range']=`bytes ${range.start}-${range.end}/${stat.size}`;
 if(request.method==='HEAD'||!stat.size)return new Response(null,{status:200,headers});
 const stream=fs.createReadStream(file,{start:range.start,end:range.end});const abort=()=>stream.destroy();request.signal?.addEventListener('abort',abort,{once:true});stream.once('close',()=>request.signal?.removeEventListener('abort',abort));
 return new Response(Readable.toWeb(stream,{strategy:{highWaterMark:256*1024,size:chunk=>chunk.byteLength}}),{status:requested?206:200,headers});
}
module.exports={parseRange,fileResponse};
