import https from 'node:https';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from './core.mjs';

export function publicIp(ip) {
  const raw=ip.toLowerCase().replace(/^\[|\]$/g,'');
  if(isIP(raw)===4){const [a,b]=raw.split('.').map(Number);return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||a>=224);}
  // Only globally routable IPv6 unicast; reject IPv4-mapped, NAT64 and local ranges.
  return isIP(raw)===6 && /^[23][0-9a-f]{0,3}:/.test(raw) && !raw.startsWith('2001:db8:') && !raw.startsWith('2001:0:');
}
export function sourceUrl(value) {
  let u;try{u=new URL(value);}catch{throw new AppError('請輸入完整的 HTTPS 網址');}
  const host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||(isIP(host.replace(/^\[|\]$/g,''))&&!publicIp(host)))throw new AppError('來源必須是公開 HTTPS 網站');
  return u;
}
export async function fetchPublic(value,{maxBytes=2_000_000,accept='image/jpeg,image/png,image/webp,image/avif',allowedHosts,redirects=4}={}) {
  const u=sourceUrl(value);if(allowedHosts&&!allowedHosts.includes(u.hostname))throw new AppError('重新導向超出來源網站範圍，請另新增該來源');
  const addresses=await dns.lookup(u.hostname.replace(/^\[|\]$/g,''),{all:true});
  if(!addresses.length||addresses.some(a=>!publicIp(a.address)))throw new AppError('來源指向非公開網路，無法讀取');
  const address=addresses[0];
  const result=await new Promise((resolve,reject)=>{
    const req=https.get(u,{lookup:(_host,options,callback)=>options?.all?callback(null,[address]):callback(null,address.address,address.family),headers:{'User-Agent':'CampusSocial/2.0 (unit source reader)',Accept:accept},timeout:15000},res=>{
      if(res.statusCode>=300&&res.statusCode<400){res.resume();resolve({redirect:res.headers.location});return;}
      if(res.statusCode!==200){res.resume();reject(new AppError(`來源回應 ${res.statusCode}，可改用貼上原文`,502));return;}
      const chunks=[];let total=0;
      res.on('data',chunk=>{total+=chunk.length;if(total>maxBytes){res.destroy(new AppError('來源內容超過大小限制'));return;}chunks.push(chunk);});
      res.on('error',reject);res.on('end',()=>resolve({bytes:Buffer.concat(chunks),type:String(res.headers['content-type']||''),url:u.href}));
    });req.on('timeout',()=>req.destroy(new AppError('來源網站讀取逾時',504)));req.on('error',reject);
  });
  if(result.redirect){if(!redirects)throw new AppError('來源重新導向次數過多');return fetchPublic(new URL(result.redirect,u).href,{maxBytes,accept,allowedHosts,redirects:redirects-1});}
  return result;
}
export const TAIWAN_MEME_WINDOW_DAYS=90;
const taiwanPublishers=new Set(['udn.com','setn.com','ltn.com.tw','ettoday.net','cts.com.tw','tvbs.com.tw','storm.mg','cna.com.tw']);

export function isRecentTaiwanMemeSource(article,now){
  const hostname=new URL(article.url).hostname.replace(/^www\./,'');
  const isLocal=hostname.endsWith('.tw')||[...taiwanPublishers].some(host=>hostname===host||hostname.endsWith('.'+host));
  const age=now.getTime()-Date.parse(article.publishedAt);
  return isLocal&&age>=0&&age<=TAIWAN_MEME_WINDOW_DAYS*86400000&&
    /[\p{Script=Han}]/u.test(article.title)&&/梗|迷因|流行語|熱門關鍵字|社群用語|接龍|挑戰/u.test(
      [article.title,article.text.slice(0,12000),...(article.excerpts||[])].join('\n'));
}
