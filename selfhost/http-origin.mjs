import {AppError} from './core.mjs';

const loopbackHost=host=>['localhost','127.0.0.1','[::1]','::1'].includes(host.toLowerCase());
const loopbackPeer=address=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address||'');

export function validateRequestOrigin(req,publicBaseUrl=process.env.PUBLIC_BASE_URL){
  const origin=req.headers.origin;
  if(!origin)return;
  const reject=()=>{throw new AppError('請從工作台本身送出操作',403,'invalid_origin');};
  let direct,configured;
  try{
    direct=new URL(`${req.socket.encrypted?'https':'http'}://${req.headers.host}`);
    configured=publicBaseUrl?new URL(publicBaseUrl):null;
  }catch{return reject();}
  if(origin===(configured||direct).origin)return;
  // A local preview may use a different port from the saved local publish URL.
  // Both the peer and Host must be loopback; Origin must exactly match this
  // connection's actual listening port. Public deployments keep their explicit
  // origin allowlist and never trust forwarded host headers here.
  const port=Number(direct.port||(direct.protocol==='https:'?443:80));
  const localPreview=configured?.protocol==='http:'&&loopbackHost(configured.hostname)&&
    loopbackPeer(req.socket.remoteAddress)&&loopbackHost(direct.hostname)&&
    port===req.socket.localPort&&origin===direct.origin;
  if(!localPreview)reject();
}
