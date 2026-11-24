import{ApiError,config}from"./server";
export function allowedUrl(value:string){let u:URL;try{u=new URL(value);}catch{throw new ApiError("請輸入有效網址");}const hosts=(config().SOURCE_ALLOWED_HOSTS||"dyu.edu.tw,*.dyu.edu.tw").split(",").map(x=>x.trim().toLowerCase());if(u.protocol!=="https:"||u.port||u.username||u.password||!hosts.some(h=>h.startsWith("*.")?u.hostname.endsWith(h.slice(1)):u.hostname===h))throw new ApiError("此來源尚未開放。預設可解析大葉大學網域；其他網站請由管理員加入來源白名單，或使用貼上原文。");return u;}
export async function parseSource(value:string){
  const target=allowedUrl(value);
  const {CODEX_WEB_BRIDGE_URL:bridgeUrl,CODEX_WEB_BRIDGE_TOKEN:token}=config();
  if(!bridgeUrl||!token)throw new ApiError("尚未設定 Codex Web Search 轉接服務，請貼上原文",503);
  let bridge:URL;
  try{bridge=new URL(bridgeUrl);}catch{throw new ApiError("Codex Web Search 轉接網址無效",503);}
  if(bridge.protocol!=="https:"||bridge.username||bridge.password)throw new ApiError("Codex Web Search 轉接需要 HTTPS",503);
  let response:Response;
  try{
    response=await fetch(new URL("/api/codex-web/read",bridge),{
      method:"POST",redirect:"error",signal:AbortSignal.timeout(150000),
      headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
      body:JSON.stringify({url:target.href}),
    });
  }catch{throw new ApiError("Codex Web Search 轉接暫時無法連線，請貼上原文",502);}
  if(!response.ok)throw new ApiError("Codex Web Search 讀不到文章，請貼上原文或改用其他公開來源",response.status===422?422:502);
  const article=await response.json() as {url:string;title:string;text:string};
  return {url:allowedUrl(article.url).href,title:article.title,text:article.text};
}
