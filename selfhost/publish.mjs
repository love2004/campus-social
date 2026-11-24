import { AppError, NAMES } from './core.mjs';
import { createHash, createHmac, randomUUID } from 'node:crypto';

export const PLATFORM_KEYS={facebook:['META_GRAPH_VERSION','FACEBOOK_PAGE_ID','FACEBOOK_PAGE_TOKEN'],instagram:['META_GRAPH_VERSION','INSTAGRAM_USER_ID','FACEBOOK_PAGE_TOKEN'],threads:['THREADS_USER_ID','THREADS_TOKEN'],line:['LINE_CHANNEL_TOKEN']};
const digest=value=>createHash('sha256').update(value).digest('hex');
export const isLineGroupId=value=>typeof value==='string'&&/^C[0-9a-f]{32}$/i.test(value);
const lineRecipientKey=(account,groupId)=>groupId&&account?`${account}:group:${digest(groupId)}`:account;
export function metaGraphUrl(store,url,token) {
  const target=new URL(url);
  const secret=target.origin==='https://graph.facebook.com'&&store.secret('FACEBOOK_APP_SECRET');
  if(!secret||!token)return String(url);
  target.searchParams.set('appsecret_proof',createHmac('sha256',secret).update(token).digest('hex'));
  return target.toString();
}
export function lineTokenAccount(store) {
  const token=store.secret('LINE_CHANNEL_TOKEN');
  return lineRecipientKey(token?`line-token:${digest(token)}`:null,store.secret('LINE_GROUP_ID'));
}
export function publicationAccount(store,channel) {
  if(channel==='line'){
    const tokenKey=lineTokenAccount(store);
    if(!tokenKey)return null;
    const verified=store.kv('lineAccount');
    return verified?.tokenKey===tokenKey?verified.accountKey:tokenKey;
  }
  const key={facebook:'FACEBOOK_PAGE_ID',instagram:'INSTAGRAM_USER_ID',threads:'THREADS_USER_ID'}[channel];
  const id=key&&store.secret(key);
  return id?`${channel}:${digest(id)}`:null;
}
export function matchesPublicationAccount(store,channel,expected) {
  return !!expected&&(expected===publicationAccount(store,channel)||(channel==='line'&&expected===lineTokenAccount(store)));
}
export const approvalAccounts=(store,channels)=>Object.fromEntries(channels.map(channel=>[channel,publicationAccount(store,channel)]));
export function historicalAccount(job) {
  if(job.accountKey)return job.accountKey;
  // Facebook composite post IDs contain the owning page's ID.
  const page=job.channel==='facebook'&&/^(\d+)_\d+$/.exec(job.result?.id);
  return page?`facebook:${digest(page[1])}`:null;
}

export function bindExistingPublicationAccounts(store) {
  store.transaction(()=>{
    if(store.kv('publicationAccountsV1'))return;
    for(const post of store.list('posts').filter(post=>['approved','publishing','attention'].includes(post.status)&&post.reviewHash)) {
      if(post.approvalAccounts)continue;
      store.db.prepare('UPDATE posts SET data=? WHERE id=?').run(JSON.stringify({...post,approvalAccounts:approvalAccounts(store,post.channels)}),post.id);
    }
    for(const job of store.list('publications').filter(job=>['pending','preparing','sending','failed','unknown'].includes(job.status))) {
      if(job.accountKey!==undefined)continue;
      store.db.prepare('UPDATE publications SET data=? WHERE id=?').run(JSON.stringify({...job,accountKey:publicationAccount(store,job.channel)}),job.id);
    }
    store.set('publicationAccountsV1',true);
  });
}
export class DeliveryError extends AppError {
  constructor(message,outcome='failed'){super(message,502,'delivery_failed');this.outcome=outcome;}
}
export function channelStatus(store) {return Object.fromEntries(Object.entries(PLATFORM_KEYS).map(([p,keys])=>[p,{ready:keys.every(k=>store.secret(k)),missing:keys.filter(k=>!store.secret(k))}]));}
export function preflight(store,post,channel) {
  const keys=PLATFORM_KEYS[channel];if(!keys)throw new AppError('此平台不在第一版支援範圍');
  const missing=keys.filter(k=>!store.secret(k));if(missing.length)throw new AppError(`${NAMES[channel]} 尚未完成帳號設定`,503);
  if(channel==='line'&&store.secret('LINE_GROUP_ID')&&!isLineGroupId(store.secret('LINE_GROUP_ID')))throw new AppError('LINE 群組 ID 格式不正確');
  if(!post.variants[channel]?.trim())throw new AppError(`${NAMES[channel]} 內容不可空白`);
  if(channel==='threads'&&Array.from(post.variants[channel]).length>500)throw new AppError('Threads 內容超過 500 字');
  if(channel==='instagram'&&!post.mediaIds.length)throw new AppError('Instagram 貼文需要至少一張圖片');
  if(post.mediaIds.length>10)throw new AppError('每篇最多 10 張圖片');
  if(post.mediaIds.some(id=>!store.get('media',id)))throw new AppError('貼文圖片不存在，請重新選擇');
  if(channel!=='facebook'&&post.mediaIds.length&&!/^https:\/\//.test(process.env.PUBLIC_BASE_URL||''))throw new AppError('主機尚未設定供平台讀取圖片的公開 HTTPS 網址',503);
}
async function call(url,token,{method='POST',data,final=false,headers={},fetchFn=fetch}={}) {
  let response;
  const formData=data instanceof FormData;
  try{response=await fetchFn(url,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,...(data&&!formData?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...headers},...(data?{body:formData?data:new URLSearchParams(data)}:{})});}
  catch{throw new DeliveryError(final?'送出後未取得平台回應，請核對平台上的結果':'平台準備程序連線失敗',final?'unknown':'failed');}
  if(!response.ok)throw new DeliveryError(`平台回應 ${response.status}，請檢查授權、內容或配額`,final&&response.status>=500?'unknown':'failed');
  try{return await response.json();}catch{throw new DeliveryError('平台沒有回傳可確認的結果',final?'unknown':'failed');}
}

const pagePostId=/^([0-9]+)_[0-9]+$/;

export function facebookDeletionTarget(store,job) {
  if(job.channel!=='facebook'||job.status!=='sent'||['deleted','unknown'].includes(job.deletion?.status))return null;
  const id=job.result?.id;
  const pageId=store.secret('FACEBOOK_PAGE_ID');
  if(typeof id!=='string'||!/^[0-9]+(?:_[0-9]+)?$/.test(id)||!/^[0-9]+$/.test(pageId)||!channelStatus(store).facebook.ready)return null;
  const account=historicalAccount(job);
  if(account&&!matchesPublicationAccount(store,'facebook',account))return null;
  const composite=pagePostId.exec(id);
  return composite&&composite[1]!==pageId?null:id;
}

export async function deleteFacebookPublication(store,id) {
  const lease=`delete-publication:${id}`;
  const owner=randomUUID();
  if(!store.lease(lease,owner,120000))throw new AppError('這筆刪除正在處理，請稍後重新載入',409);
  try {
    const job=store.get('publications',id);
    if(!job)throw new AppError('找不到發佈紀錄',404);
    if(job.deletion?.status==='deleted')return job.deletion;
    if(job.deletion?.status==='unknown')throw new AppError('Facebook 刪除結果待核對，請先到專頁查看原貼文',409);
    const target=facebookDeletionTarget(store,job);
    if(!target)throw new AppError('請確認這筆發佈紀錄有 Facebook 貼文 ID，且目前連線與原專頁相符',409);

    const pageId=store.secret('FACEBOOK_PAGE_ID');
    const token=store.secret('FACEBOOK_PAGE_TOKEN');
    const version=store.secret('META_GRAPH_VERSION');
    if(!/^v[0-9]+(?:\.[0-9]+)?$/.test(version))throw new AppError('Facebook API 版本格式無效',409);
    const graphUrl=path=>metaGraphUrl(store,`https://graph.facebook.com/${version}/${path}`,token);
    let postId=target;
    try {
      if(!pagePostId.test(target)) {
        const photo=await call(graphUrl(`${target}?fields=id,from,page_story_id`),token,{method:'GET'});
        if(photo.id!==target||photo.from?.id!==pageId)throw new AppError('Facebook 圖片的原發佈專頁無法核對',409);
        postId=/^[0-9]+$/.test(photo.page_story_id)?`${pageId}_${photo.page_story_id}`:photo.page_story_id;
      }
      if(pagePostId.exec(postId)?.[1]!==pageId)throw new AppError('Facebook 貼文的原發佈專頁無法核對',409);
      const remote=await call(graphUrl(`${postId}?fields=id,from`),token,{method:'GET'});
      if(remote.id!==postId||remote.from?.id!==pageId)throw new AppError('Facebook 回傳的貼文與原專頁不符',409);
    } catch(error) {
      if(!(error instanceof DeliveryError))throw error;
      throw new AppError('無法在 Facebook 核對原貼文，請確認貼文仍存在且目前帳號有存取權',502);
    }

    if(facebookDeletionTarget(store,store.get('publications',id))!==target||store.secret('FACEBOOK_PAGE_TOKEN')!==token) {
      throw new AppError('Facebook 發佈帳號或紀錄已變更，請重新載入',409);
    }
    const removedAt=new Date().toISOString();
    const attempt={status:'unknown',postId,attemptedAt:removedAt};
    const save=deletion=>store.db.prepare("UPDATE publications SET data=json_set(data,'$.deletion',json(?)) WHERE id=? AND status='sent'").run(JSON.stringify(deletion),id);
    save(attempt);
    try {
      const result=await call(graphUrl(postId),token,{method:'DELETE',final:true});
      if(result.success!==true)throw new DeliveryError('Facebook 未確認刪除','unknown');
    } catch(error) {
      if(error instanceof DeliveryError&&error.outcome==='failed') {
        const message='Facebook 拒絕刪除，請檢查專頁權限或到 Meta Business Suite 處理';
        save({...attempt,status:'failed',error:message});
        throw new AppError(message,502);
      }
      throw new AppError('Facebook 刪除結果待核對，請先到專頁查看原貼文',502);
    }
    const deletion={...attempt,status:'deleted',deletedAt:new Date().toISOString()};
    store.transaction(()=>{save(deletion);store.event('info',`承辦人已刪除 Facebook 貼文 ${postId}`);});
    return deletion;
  } finally {
    store.release(lease,owner);
  }
}

const pause=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
export async function pollContainer(url,token,kind,{fetchFn=fetch,sleep=pause,attempts=6,store}={}) {
  for(let i=0;i<attempts;i++){
    const target=`${url}?fields=${kind==='instagram'?'status_code,status':'status,error_message'}`;
    const r=await call(store&&kind==='instagram'?metaGraphUrl(store,target,token):target,token,{method:'GET',fetchFn});
    const status=kind==='instagram'?r.status_code:r.status;
    if(status==='FINISHED'||status==='PUBLISHED')return status;
    if(status==='ERROR'||status==='EXPIRED')throw new DeliveryError('平台圖片容器處理失敗或過期');
    if(i<attempts-1)await sleep(60000);
  }
  throw new DeliveryError('平台圖片處理尚未完成，請稍後核對容器狀態');
}
export async function publishPost(store,post,channel,images,requestKey,checkpoint=()=>{},deps={}) {
  const fetchFn=deps.fetchFn||fetch,text=post.variants[channel];
  const graphVersion=store.secret('META_GRAPH_VERSION'),pageToken=store.secret('FACEBOOK_PAGE_TOKEN');
  const send=async(url,token,data,final=false)=>{if(final)checkpoint({phase:'sending'});return call(metaGraphUrl(store,url,token),token,{data,final,fetchFn});};
  if(channel==='facebook'){
    const base=`https://graph.facebook.com/${graphVersion}/${store.secret('FACEBOOK_PAGE_ID')}`;
    const uploadPhoto=(image,fields,final=false)=>{
      if(typeof image==='string')return send(`${base}/photos`,pageToken,{url:image,...fields},final);
      const data=new FormData();
      data.set('source',image,'photo.jpg');
      for(const [name,value] of Object.entries(fields))data.set(name,value);
      return send(`${base}/photos`,pageToken,data,final);
    };
    if(images.length===1){const r=await uploadPhoto(images[0],{caption:text},true);if(!r.id)throw new DeliveryError('Facebook 未回傳貼文識別碼','unknown');return {id:r.post_id||r.id};}
    const attached=[];
    for(const image of images){const r=await uploadPhoto(image,{published:'false'});if(!r.id)throw new DeliveryError('Facebook 未回傳圖片識別碼');attached.push({media_fbid:r.id});checkpoint({phase:'preparing',photoIds:attached.map(i=>i.media_fbid)});}
    const r=await send(`${base}/feed`,pageToken,{message:text,...(attached.length?{attached_media:JSON.stringify(attached)}:{})},true);
    if(!r.id)throw new DeliveryError('Facebook 未回傳貼文識別碼','unknown');return {id:r.id};
  }
  if(channel==='instagram'||channel==='threads'){
    const instagram=channel==='instagram',token=instagram?pageToken:store.secret('THREADS_TOKEN');
    const origin=instagram?`https://graph.facebook.com/${graphVersion}`:'https://graph.threads.com/v1.0';
    const user=store.secret(instagram?'INSTAGRAM_USER_ID':'THREADS_USER_ID'),base=`${origin}/${user}`;
    const create=async(data)=>{const r=await send(`${base}/${instagram?'media':'threads'}`,token,data);if(!r.id)throw new DeliveryError('平台未回傳圖片容器');return r.id;};
    let container;
    if(images.length>1){const ids=[];for(const url of images){const id=await create({image_url:url,is_carousel_item:'true',...(!instagram?{media_type:'IMAGE'}:{})});ids.push(id);checkpoint({phase:'preparing',childIds:ids});}
      await Promise.all(ids.map(id=>pollContainer(`${origin}/${id}`,token,channel,{...deps,store})));
      container=await create({media_type:'CAROUSEL',children:ids.join(','),[instagram?'caption':'text']:text});
    }else container=await create(instagram?{image_url:images[0],caption:text}:images.length?{media_type:'IMAGE',image_url:images[0],text}:{media_type:'TEXT',text});
    checkpoint({phase:'preparing',containerId:container});
    const status=await pollContainer(`${origin}/${container}`,token,channel,{...deps,store});
    if(status==='PUBLISHED')return {containerId:container,reconciled:true};
    const r=await send(`${base}/${instagram?'media_publish':'threads_publish'}`,token,{creation_id:container},true);
    if(!r.id)throw new DeliveryError('平台未回傳發佈識別碼','unknown');return {id:r.id,containerId:container};
  }
  if(channel==='line'){
    const groupId=store.secret('LINE_GROUP_ID');
    if(groupId&&!isLineGroupId(groupId))throw new AppError('LINE 群組 ID 格式不正確');
    const endpoint=groupId?'push':'broadcast';
    const messages=[{type:'text',text}];
    if(images.length===1)messages.push({type:'image',originalContentUrl:images[0],previewImageUrl:images[0]});
    if(images.length>1)messages.push({type:'flex',altText:post.title.slice(0,200),contents:{type:'carousel',contents:images.map(url=>({type:'bubble',size:'mega',hero:{type:'image',url,size:'full',aspectRatio:'1:1',aspectMode:'cover',action:{type:'uri',uri:url}}}))}});
    checkpoint({phase:'sending'});
    let res;try{res=await fetchFn(`https://api.line.me/v2/bot/message/${endpoint}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${store.secret('LINE_CHANNEL_TOKEN')}`,'Content-Type':'application/json','X-Line-Retry-Key':requestKey},body:JSON.stringify(groupId?{to:groupId,messages}:{messages})});}
    catch{throw new DeliveryError('LINE 送出後未取得回應，請核對發送目的地','unknown');}
    if(res.status===409&&res.headers.get('x-line-accepted-request-id'))return {accepted:true,requestId:res.headers.get('x-line-accepted-request-id'),deduplicated:true};
    if(!res.ok)throw new DeliveryError(`LINE 回應 ${res.status}，請檢查授權、額度或訊息格式`,res.status>=500?'unknown':'failed');
    return {accepted:true,requestId:res.headers.get('x-line-request-id')||requestKey};
  }
  throw new AppError('不支援的平台');
}
export async function verifyChannel(store,channel,{fetchFn=fetch}={}) {
  const missing=PLATFORM_KEYS[channel]?.filter(k=>!store.secret(k));if(!missing||missing.length)throw new AppError('請先填寫平台帳號與必要設定');
  let url,token;
  if(channel==='line'){url='https://api.line.me/v2/bot/info';token=store.secret('LINE_CHANNEL_TOKEN');}
  else if(channel==='threads'){url=`https://graph.threads.com/v1.0/${store.secret('THREADS_USER_ID')}?fields=id,username`;token=store.secret('THREADS_TOKEN');}
  else {const id=store.secret(channel==='facebook'?'FACEBOOK_PAGE_ID':'INSTAGRAM_USER_ID');url=`https://graph.facebook.com/${store.secret('META_GRAPH_VERSION')}/${id}?fields=id,${channel==='facebook'?'name':'username'}`;token=store.secret('FACEBOOK_PAGE_TOKEN');}
  const groupId=channel==='line'&&store.secret('LINE_GROUP_ID');
  const r=await call(metaGraphUrl(store,url,token),token,{method:'GET',fetchFn});
  let group;
  if(groupId){
    if(!isLineGroupId(groupId))throw new AppError('LINE 群組 ID 格式不正確');
    group=await call(`https://api.line.me/v2/bot/group/${groupId}/summary`,token,{method:'GET',fetchFn});
    if(group.groupId!==groupId||!group.groupName)throw new AppError('LINE 未回傳可辨識的群組');
  }
  if(channel==='line'&&(groupId!==store.secret('LINE_GROUP_ID')||token!==store.secret('LINE_CHANNEL_TOKEN')))throw new AppError('LINE 目的地已變更，請重新檢查',409);
  if(channel==='line'&&typeof r.userId==='string'&&r.userId&&token===store.secret('LINE_CHANNEL_TOKEN')){
    store.transaction(()=>{
      if(token!==store.secret('LINE_CHANNEL_TOKEN'))return;
      const tokenKey=lineTokenAccount(store),accountKey=lineRecipientKey(`line:${digest(r.userId)}`,groupId);
      store.set('lineAccount',{tokenKey,accountKey});
      // Upgrade work approved with this exact token to the verified account.
      for(const post of store.list('posts').filter(post=>post.approvalAccounts?.line===tokenKey)) {
        const approvalAccounts={...post.approvalAccounts,line:accountKey};
        store.db.prepare('UPDATE posts SET data=? WHERE id=?').run(JSON.stringify({...post,approvalAccounts}),post.id);
      }
      for(const job of store.list('publications').filter(job=>job.channel==='line'&&job.accountKey===tokenKey&&!['preparing','sending'].includes(job.status))) {
        store.db.prepare('UPDATE publications SET data=? WHERE id=?').run(JSON.stringify({...job,accountKey}),job.id);
      }
    });
  }
  return {name:group?.groupName||r.name||r.username||r.displayName||r.id||'帳號已回應',verifiedAt:new Date().toISOString(),message:group?'已確認官方帳號可讀取指定群組；尚未發送訊息':'已確認帳號可讀取；實際發文權限仍需測試貼文驗收'};
}
