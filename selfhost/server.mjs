import { categoryName, materialCategories, requireCategory, saveMaterialCategory } from './material-categories.mjs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import { AppError, settingsInput, sourceInput, manualSourceInput, postInput, cardInput, contentHash, upcomingSlots, PLATFORMS, taipeiDate } from './core.mjs';
import { openStore } from './store.mjs';
import { sourceUrl } from './network.mjs';
import { readArticle } from './codex-web.mjs';
import { codexStatus } from './ai.mjs';
import { saveImage, importImage, createCard, generateImage } from './media.mjs';
import { channelStatus, verifyChannel, approvalAccounts, bindExistingPublicationAccounts, matchesPublicationAccount, facebookDeletionTarget, deleteFacebookPublication, isLineGroupId } from './publish.mjs';
import { createAnalytics } from './analytics.mjs';
import { analyticsDays, analyticsPlatforms } from './analytics-report.mjs';
import { bindPostSlot, enqueueDraft, enqueueAvailableDrafts, createEngine, createSlot, transitionPublication } from './engine.mjs';
import { queueMail } from './mailer.mjs';
import {selectionCheck,articleExpiry,draftCapacity} from './automation.mjs';
import {validateRequestOrigin} from './http-origin.mjs';
import { linkTopicMaterial, listSlotBindings, listTopics, requireTopic, saveTopic, topicInput } from './topics.mjs';
import { invalidateTopicDraft, requestTopicRefresh, retryTopicDraft, setTopicDraftLock } from './topic-drafts.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export const SECRET_KEYS=['OPENAI_API_KEY','META_GRAPH_VERSION','FACEBOOK_PAGE_ID','FACEBOOK_PAGE_TOKEN','FACEBOOK_APP_SECRET','INSTAGRAM_USER_ID','INSTAGRAM_INSIGHTS_TOKEN','THREADS_USER_ID','THREADS_TOKEN','LINE_CHANNEL_TOKEN','LINE_GROUP_ID','LINE_CHANNEL_SECRET','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASSWORD','SMTP_FROM'];
const secretInput=z.record(z.enum(SECRET_KEYS),z.string().max(8000));
function digest(token){return createHash('sha256').update(token).digest('hex');}
function passwordHash(password,salt=randomBytes(16).toString('hex')){return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;}
function passwordMatches(password,stored){const [salt,hash]=stored.split(':');const actual=scryptSync(password,salt,64),expected=Buffer.from(hash,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected);}
const administratorInput=z.object({email:z.string().email().max(254),password:z.string().min(12).max(500)});
const passwordInput=z.object({current:z.string().max(500),next:z.string().min(12).max(500)});
const sessionMaxAge=7*24*60*60;
function issueSession(store,now=Date.now()){
  const token=randomBytes(32).toString('base64url'),expiresAt=now+sessionMaxAge*1000;
  store.db.prepare('INSERT INTO sessions VALUES (?,?)').run(digest(token),expiresAt);
  store.db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now);
  return {token,expiresAt};
}
export function initializeAdministrator(store,input,{signIn=false}={}){
  return store.transaction(()=>{
    if(store.kv('administrator'))return {created:false};
    const {email,password}=administratorInput.parse(input);
    store.set('administrator',{email:email.toLowerCase(),hash:passwordHash(password)});
    store.event('info','已建立本單位管理者帳號');
    return {created:true,session:signIn?issueSession(store):null};
  });
}
export function changeAdministratorPassword(store,input,{sessionToken}={}){
  const {current,next}=passwordInput.parse(input);
  return store.transaction(()=>{
    const admin=store.kv('administrator');
    if(!admin||!passwordMatches(current,admin.hash))throw new AppError('目前密碼不正確',403);
    const session=sessionToken?{token:sessionToken}:issueSession(store);
    store.set('administrator',{...admin,hash:passwordHash(next)});
    store.db.prepare('DELETE FROM sessions WHERE hash<>?').run(digest(session.token));
    return session;
  });
}
async function bytes(req,max=1_000_000){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw new AppError('上傳資料超過大小限制',413);chunks.push(chunk);}return Buffer.concat(chunks);}
async function jsonBody(req){if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new AppError('請使用 JSON 格式',415);try{return JSON.parse((await bytes(req)).toString('utf8'));}catch(error){if(error instanceof AppError)throw error;throw new AppError('JSON 格式不正確');}}
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
const cookieToken=req=>String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('campus_session='))?.slice(15)||'';
function securityHeaders(res,dev=false){res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'${dev?" 'unsafe-inline'":''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'${dev?' ws:':''}; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);}
export async function createApp({directory=process.env.DATA_DIR||path.join(root,'selfhost-data'),dev=false,startWorker=true,bootstrapEmail=process.env.ADMIN_EMAIL,bootstrapPassword=process.env.ADMIN_PASSWORD,requestBaseUrl,analyticsDeps}={}) {
  const store=openStore(path.resolve(directory));
  bindExistingPublicationAccounts(store);
  if(bootstrapEmail&&bootstrapPassword)initializeAdministrator(store,{email:bootstrapEmail,password:bootstrapPassword});
  const engine=createEngine(store),analytics=createAnalytics(store,analyticsDeps);let vite;
  let bridgeBusy=false;
  if(dev){const {createServer}=await import('vite');vite=await createServer({configFile:path.join(root,'selfhost/vite.config.ts'),server:{middlewareMode:true},appType:'custom'});}
  if(startWorker)engine.start();
  function authorize(req){const token=cookieToken(req);const row=token&&store.db.prepare('SELECT expires_at FROM sessions WHERE hash=?').get(digest(token));if(!row||row.expires_at<Date.now())throw new AppError('請先登入工作台',401,'unauthorized');return token;}
  function validateOrigin(req){validateRequestOrigin(req,requestBaseUrl);}
  function requirePost(id){const item=store.get('posts',id);if(!item)throw new AppError('找不到貼文',404);return item;}
  function publicPublication(job){const {accountKey:_accountKey,...publication}=job;return {...publication,canDelete:Boolean(facebookDeletionTarget(store,job))};}
  function expectVersion(post,version){if(post.version!==version)throw new AppError('這篇內容已在其他視窗更新，請重新載入後再操作',409,'conflict');}
  function validateMedia(input){if(input.mediaIds.some(id=>!store.get('media',id)))throw new AppError('選取的圖片已不存在');}
  async function api(req,res,url){
    const p=url.pathname,m=req.method;
    if(p==='/api/health'&&m==='GET')return json(res,{ok:true,configured:!!store.kv('administrator'),mode:'private-selfhost',version:'1.0.0'});
    if(p==='/api/codex-web/read'&&m==='POST'){
      const secret=process.env.CODEX_WEB_BRIDGE_TOKEN||'';
      if(secret.length<32)throw new AppError('Codex Web Search 轉接未啟用',404);
      const provided=String(req.headers.authorization||'');
      if(!timingSafeEqual(Buffer.from(digest(provided),'hex'),Buffer.from(digest(`Bearer ${secret}`),'hex')))throw new AppError('轉接驗證失敗',401);
      const {url}=z.object({url:z.string().url().max(2000)}).parse(await jsonBody(req));
      if(bridgeBusy)throw new AppError('Codex Web Search 正在讀取其他文章',429);
      bridgeBusy=true;
      try{return json(res,await readArticle(url));}
      finally{bridgeBusy=false;}
    }
    if(p==='/api/line/webhook'&&m==='POST'){
      const secret=store.secret('LINE_CHANNEL_SECRET');
      if(!secret)throw new AppError('LINE webhook 尚未啟用',404);
      const raw=await bytes(req,256_000);
      const signature=Buffer.from(String(req.headers['x-line-signature']||''));
      const expected=Buffer.from(createHmac('sha256',secret).update(raw).digest('base64'));
      if(signature.length!==expected.length||!timingSafeEqual(signature,expected))throw new AppError('LINE webhook 簽章不符',401);
      let payload;
      try{payload=JSON.parse(raw.toString('utf8'));}catch{throw new AppError('LINE webhook 格式不正確');}
      if(!Array.isArray(payload?.events))throw new AppError('LINE webhook 格式不正確');
      const event=payload.events.findLast(event=>event?.source?.type==='group'&&isLineGroupId(event.source.groupId)&&['join','message'].includes(event.type));
      if(event&&secret===store.secret('LINE_CHANNEL_SECRET'))store.set('lineDiscoveredGroup',{id:event.source.groupId,secretHash:digest(secret)});
      return json(res,{ok:true});
    }
    if(p==='/api/login'&&m==='POST'){
      const data=z.object({email:z.string().email().max(254),password:z.string().max(500)}).parse(await jsonBody(req));
      const ip=req.socket.remoteAddress||'local',key=digest(ip),now=Date.now(),attempt=store.db.prepare('SELECT * FROM login_attempts WHERE key=?').get(key);
      if(attempt&&attempt.started_at>now-900000&&attempt.count>=10)throw new AppError('登入嘗試過多，請於 15 分鐘後重試',429);
      const admin=store.kv('administrator');
      const valid=admin&&passwordMatches(data.password,admin.hash)&&data.email.toLowerCase()===admin.email;
      if(!valid){store.db.prepare('INSERT INTO login_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN started_at<? THEN 1 ELSE count+1 END,started_at=CASE WHEN started_at<? THEN excluded.started_at ELSE started_at END').run(key,now,now-900000,now-900000);throw new AppError('登入資訊不符，請確認信箱與密碼',401);}
      store.db.prepare('DELETE FROM login_attempts WHERE key=?').run(key);
      const {token}=issueSession(store,now);
      res.setHeader('Set-Cookie',`campus_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionMaxAge}${(requestBaseUrl??process.env.PUBLIC_BASE_URL)?.startsWith('https://')?'; Secure':''}`);
      return json(res,{email:admin.email});
    }
    const token=authorize(req);
    if(p==='/api/line/discovered-group'&&m==='GET'){
      const secret=store.secret('LINE_CHANNEL_SECRET'),group=store.kv('lineDiscoveredGroup');
      return json(res,{id:secret&&group?.secretHash===digest(secret)?group.id:null});
    }
    if(p==='/api/state/revision'&&m==='GET')return json(res,{revision:store.workspaceRevision()});
    if(p==='/api/analytics'&&m==='GET'){
      const days=Number(url.searchParams.get('days')??'30'),platform=url.searchParams.get('platform')??'all';
      if(!analyticsDays.includes(days)||!(platform==='all'||analyticsPlatforms.includes(platform)))throw new AppError('分析期間或平台不正確');
      return json(res,await analytics({days,platform}));
    }
    if(p==='/api/session'&&m==='GET')return json(res,{email:store.kv('administrator').email});
    if(p==='/api/logout'&&m==='POST'){store.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token));res.setHeader('Set-Cookie','campus_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return json(res,{ok:true});}
    if(p==='/api/topics'&&m==='POST')return json(res,saveTopic(store,null,topicInput.parse(await jsonBody(req))),201);
    const topicMatch=p.match(/^\/api\/topics\/([\w-]+)$/);
    if(topicMatch&&m==='PUT')return json(res,saveTopic(store,topicMatch[1],topicInput.parse(await jsonBody(req))));
    const draftTopicMatch=p.match(/^\/api\/topics\/([\w-]+)\/draft$/);
    if(draftTopicMatch&&m==='POST')return json(res,retryTopicDraft(store,requireTopic(store,draftTopicMatch[1])),202);
    if(draftTopicMatch&&m==='GET'){
      const topic=requireTopic(store,draftTopicMatch[1]);
      const post=store.db.prepare('SELECT post_id FROM topics WHERE id=?').get(topic).post_id;
      const jobId=post&&store.get('posts',post)?.topicDraftJobId;
      const job=jobId&&store.get('generation_jobs',jobId);
      if(!job||job.topicId!==topic)throw new AppError('找不到主題備稿來源',404);
      return json(res,{revision:job.id,sources:[...job.sources,...job.webSources]});
    }
    const topicAction=p.match(/^\/api\/topics\/([\w-]+)\/(lock|refresh)$/);
    if(topicAction&&m==='POST'){
      const id=requireTopic(store,topicAction[1]);
      if(topicAction[2]==='refresh')return json(res,{id:requestTopicRefresh(store,id).id},202);
      const {locked,version}=z.object({locked:z.boolean(),version:z.number().int().positive()}).parse(await jsonBody(req));
      return json(res,setTopicDraftLock(store,id,locked,version));
    }
    if(p==='/api/material-categories'&&m==='POST'){
      const {name}=z.object({name:categoryName}).parse(await jsonBody(req));
      return json(res,{categories:saveMaterialCategory(store,null,name)},201);
    }
    if(p==='/api/material-categories'&&(m==='PUT'||m==='DELETE')){
      const body=await jsonBody(req);
      const previous=categoryName.parse(body.previous),name=m==='PUT'?categoryName.parse(body.name):null;
      return json(res,{categories:saveMaterialCategory(store,previous,name)});
    }
    if(p==='/api/state'&&m==='GET'){
      const revision=store.workspaceRevision(),settings=store.kv('settings'),month=taipeiDate().slice(0,7);
      const compact=url.searchParams.get('compact')==='1';
      const articles=(compact?store.articleSummaries():store.list('articles'))
        .map(article=>({...article,category:article.category||'其他',expiresAt:articleExpiry(article,settings)}))
        .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
      const articleCategories=new Map(articles.map(article=>[article.id,article.category]));
      const posts=store.list('posts').map(({approvalAccounts:accounts,...post})=>({
        ...post,category:post.category||articleCategories.get(post.sourceId)||'其他',
        accountChanged:post.status==='approved'&&Boolean(accounts&&post.channels.some(channel=>!matchesPublicationAccount(store,channel,accounts[channel]))),
      })).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
      const publications=compact?[]:store.list('publications').map(publicPublication);
      const publicationSummary=compact?{
        publicationPostIds:store.db.prepare('SELECT DISTINCT post_id FROM publications').all().map(row=>row.post_id),
        ...store.db.prepare("SELECT count(*) AS publicationCount, count(*) FILTER (WHERE status IN ('unknown','failed')) AS publicationIssues FROM publications").get(),
      }:{};
      return json(res,{revision,settings,categories:materialCategories(store),topics:listTopics(store),slotBindings:listSlotBindings(store),settingsVersion:store.kv('settingsVersion',1),sources:store.list('sources'),articles,posts,media:store.list('media').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),publications,...publicationSummary,slots:store.list('slots').sort((a,b)=>b.id.localeCompare(a.id)).slice(0,200),jobs:store.list('generation_jobs').filter(job=>!job.topicId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100),events:store.db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 40').all(),mail:store.list('outbox').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,30),upcoming:upcomingSlots(settings),runtime:{channels:channelStatus(store),secretStatus:Object.fromEntries(SECRET_KEYS.map(k=>[k,!!store.secret(k)])),environmentKeys:SECRET_KEYS.filter(k=>!!process.env[k]),publicBaseUrl:process.env.PUBLIC_BASE_URL||'',codex:store.kv('codexStatus',{ready:false,message:'尚未檢查主機登入'}),aiPaused:store.kv('aiPaused'),aiVerified:store.kv('aiVerified'),reserved:Number(store.db.prepare('SELECT COALESCE(SUM(reserve),0) AS total FROM budget WHERE month=?').get(month).total)}});
    }
    if(p==='/api/publications'&&m==='GET'){
      const input=z.object({
        page:z.coerce.number().int().min(1).max(1e6).default(1),
        category:z.string().max(40).default('all'),
        period:z.enum(['all','7','30','90']).default('all'),
        sort:z.enum(['oldest','newest']).default('newest'),
      }).parse(Object.fromEntries(url.searchParams));
      const category="coalesce(nullif(json_extract(posts.data,'$.category'),''),nullif(json_extract(articles.data,'$.category'),''),'其他')";
      const date="json_extract(publications.data,'$.createdAt')";
      const from=`FROM publications LEFT JOIN posts ON posts.id=publications.post_id
        LEFT JOIN articles ON articles.id=json_extract(posts.data,'$.sourceId')`;
      const filters=[],params=[];
      if(input.category!=='all'){filters.push(category+'=?');params.push(input.category);}
      if(input.period!=='all'){filters.push(date+'>=?');params.push(new Date(Date.now()-Number(input.period)*86_400_000).toISOString());}
      const where=filters.length?'WHERE '+filters.join(' AND '):'';
      const {total}=store.db.prepare(`SELECT count(*) AS total ${from} ${where}`).get(...params);
      const page=Math.min(input.page,Math.max(1,Math.ceil(total/12)));
      const order=input.sort==='oldest'?'ASC':'DESC';
      const rows=store.db.prepare(`SELECT publications.data,publications.status,${category} AS category,
          coalesce(json_extract(posts.data,'$.title'),'貼文紀錄') AS title
        ${from} ${where} ORDER BY ${date} ${order},publications.id ASC LIMIT 12 OFFSET ?`).all(...params,(page-1)*12);
      const items=rows.map(row=>{
        const publication=publicPublication({...JSON.parse(row.data),status:row.status});
        return {...publication,title:row.title,category:row.category};
      });
      return json(res,{items,total,page});
    }
    if(p==='/api/articles/search'&&m==='GET'){
      const query=z.string().max(500).parse(url.searchParams.get('q')||'');
      const ids=store.db.prepare(`SELECT id FROM articles
        WHERE instr(fold_case(json_extract(data,'$.title')||' '||json_extract(data,'$.text')),fold_case(?))>0`).all(query);
      return json(res,{ids:ids.map(row=>row.id)});
    }
    const articleDetail=p.match(/^\/api\/articles\/([\w-]+)$/);
    if(articleDetail&&m==='GET'){
      const article=store.get('articles',articleDetail[1]);
      if(!article)throw new AppError('找不到素材',404);
      return json(res,{...article,category:article.category||'其他',expiresAt:articleExpiry(article,store.kv('settings'))});
    }
    if(p==='/api/automation/preview'&&m==='POST'){
      const body=await jsonBody(req),settings=settingsInput.parse(body.settings||store.kv('settings')),now=new Date();
      const lastScan=store.kv('lastScan');
      const jobs=store.list('generation_jobs');
      const candidates=store.list('articles').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(article=>{
        const check=selectionCheck(article,settings,now);
        const existing=jobs.some(job=>job.articleId===article.id);
        if(existing||article.status!=='available')check.reasons.push('已製作／已判斷，或已有產稿紀錄');
        return {id:article.id,title:article.title,...check,eligible:check.reasons.length===0,assessment:article.assessment||null};
      });
      return json(res,{at:now.toISOString(),lastScan,nextScan:lastScan?new Date(Date.parse(lastScan)+settings.scanMinutes*60000).toISOString():now.toISOString(),capacity:draftCapacity(jobs,settings,now),eligibleCount:candidates.filter(a=>a.eligible).length,candidates:candidates.slice(0,30)});
    }
    const categoryMatch=p.match(/^\/api\/articles\/([\w-]+)\/category$/);
    if(categoryMatch&&m==='PUT'){
      const {category}=z.object({category:categoryName}).parse(await jsonBody(req));
      const article=store.get('articles',categoryMatch[1]);if(!article)throw new AppError('找不到素材',404);
      requireCategory(store,category);const item={...article,category};store.put('articles',item);return json(res,item);
    }
    const archiveMatch=p.match(/^\/api\/articles\/([\w-]+)\/archive$/);
    if(archiveMatch&&m==='PUT'){
      const {archived}=z.object({archived:z.boolean()}).parse(await jsonBody(req));
      const article=store.get('articles',archiveMatch[1]);if(!article)throw new AppError('找不到素材',404);
      if(store.list('generation_jobs').some(job=>job.articleId===article.id&&['pending','running'].includes(job.status)))throw new AppError('這篇素材正在產稿，請完成後再封存',409);
      const item={...article,archivedAt:archived?new Date().toISOString():''};
      store.transaction(()=>{
        store.put('articles',item);
        if(Boolean(article.archivedAt)===archived)return;
        for(const {topic_id} of store.db.prepare("SELECT topic_id FROM topic_materials WHERE kind='article' AND material_id=?").all(article.id)) {
          store.db.prepare('UPDATE topics SET version=version+1 WHERE id=?').run(topic_id);
          invalidateTopicDraft(store,topic_id);
        }
      });
      return json(res,item);
    }
    if(p==='/api/settings'&&m==='PUT'){
      const data=await jsonBody(req),settings=settingsInput.parse(data.settings),old=store.kv('settings');
      const version=store.kv('settingsVersion',1);if(data.version!==version)throw new AppError('設定已被其他視窗更新，請重新載入',409);
      if(settings.logoMediaId&&!store.get('media',settings.logoMediaId))throw new AppError('Logo 圖片不存在');
      if(settings.autoArtwork==='ai'&&!settings.imageEnabled)throw new AppError('自動 AI 作圖需要先啟用生圖功能');
      if(settings.autoArtwork==='ai'&&settings.imageProvider==='openai'&&!store.secret('OPENAI_API_KEY'))throw new AppError('選用 API 自動作圖需要設定 API 金鑰');
      store.transaction(()=>{store.set('settings',settings);store.set('settingsVersion',version+1);if(JSON.stringify([old.draftMode,old.draftWeekdays,old.draftTimes])!==JSON.stringify([settings.draftMode,settings.draftWeekdays,settings.draftTimes]))store.set('draftCursor',new Date().toISOString());if(JSON.stringify([old.scheduleEnabled,old.weekdays,old.times])!==JSON.stringify([settings.scheduleEnabled,settings.weekdays,settings.times]))store.set('schedulerCursor',new Date().toISOString());});
      store.event('info','已更新單位設定與排程規則');return json(res,{ok:true,version:version+1});
    }
    if(p==='/api/secrets'&&m==='PUT'){
      const input=secretInput.parse(await jsonBody(req));for(const [key,value] of Object.entries(input)){
        if(process.env[key])throw new AppError(`${key} 由主機環境管理，請在主機修改`);
        if(key==='META_GRAPH_VERSION'&&value&&!/^v\d+\.\d+$/.test(value))throw new AppError('Meta API 版本格式應為 v數字.數字');
        if(key==='LINE_GROUP_ID'&&value.trim()&&!isLineGroupId(value.trim()))throw new AppError('請填寫以 C 開頭的有效 LINE 群組 ID');
        if(key==='SMTP_PORT'&&value&&!['25','465','587','2525'].includes(value))throw new AppError('請使用 SMTP 常見的 25、465、587 或 2525 連接埠');
      }
      store.transaction(()=>{
        if(['LINE_GROUP_ID','LINE_CHANNEL_TOKEN'].some(key=>key in input&&input[key].trim()!==store.secret(key)))store.set('verified:line',null);
        for(const [key,value] of Object.entries(input))store.setSecret(key,value.trim());
      });return json(res,{ok:true});
    }
    if(p==='/api/password'&&m==='PUT'){
      changeAdministratorPassword(store,await jsonBody(req),{sessionToken:token});
      return json(res,{ok:true});
    }
    if(p==='/api/sources'&&m==='POST'){const data=sourceInput.parse(await jsonBody(req));requireCategory(store,data.category);sourceUrl(data.url);const item={...data,id:randomUUID(),scanRevision:randomUUID(),createdAt:new Date().toISOString(),lastError:''};store.put('sources',item);store.set('scanRequested',true);return json(res,item,201);}
    let match=p.match(/^\/api\/sources\/([\w-]+)$/);
    if(match&&['PUT','DELETE'].includes(m)){
      const data=m==='PUT'?sourceInput.parse(await jsonBody(req)):null;
      if(data){requireCategory(store,data.category);sourceUrl(data.url);}
      store.transaction(()=>{
        const source=store.get('sources',match[1]);
        if(!source)throw new AppError('找不到來源',404);
        if(!data)store.db.prepare('DELETE FROM sources WHERE id=?').run(source.id);
        else {
          store.put('sources',{...source,...data,scanRevision:randomUUID(),lastError:'',lastScanAt:'',lastNewCount:0});
          if(data.enabled)store.set('scanRequested',true);
        }
      });
      return json(res,{ok:true});
    }
    if(p==='/api/scan'&&m==='POST'){store.set('scanRequested',true);return json(res,{ok:true,message:'已安排來源整理，背景工作會接續處理'},202);}
    if(p==='/api/drafts/queue'&&m==='POST'){
      if(!store.kv('settings').aiEnabled)throw new AppError('請先在 AI 設定啟用產稿',409);
      if(store.kv('aiPaused'))throw new AppError('AI 已暫停，請先處理額度或授權',409);
      return json(res,enqueueAvailableDrafts(store),202);
    }
    if(p==='/api/articles'&&m==='POST'){
      const body=await jsonBody(req),data=manualSourceInput.parse(body);requireCategory(store,data.category);if(data.url)sourceUrl(data.url);
      const topicId=body.topicId===undefined?null:requireTopic(store,z.string().uuid().parse(body.topicId));
      const item={...data,id:randomUUID(),sourceId:'',status:'available',imageUrls:[],mediaIds:[],createdAt:new Date().toISOString()};
      store.transaction(()=>{store.put('articles',item);linkTopicMaterial(store,topicId,'article',item);});
      return json(res,item,201);
    }
    if(p==='/api/articles/import'&&m==='POST'){
      const data=z.object({url:z.string().url(),selector:z.string().max(200).default(''),category:categoryName.default('其他'),topicId:z.string().uuid().optional()}).parse(await jsonBody(req));
      const topicId=data.topicId&&requireTopic(store,data.topicId),article=await readArticle(data.url,data.selector);
      const {item,created}=store.transaction(()=>{
        requireCategory(store,data.category);
        const old=store.db.prepare('SELECT id FROM articles WHERE url=?').get(article.url);
        if(old)return {item:linkTopicMaterial(store,topicId,'article',store.get('articles',old.id)),created:false};
        const item={...article,id:randomUUID(),sourceId:'',category:data.category,status:'available',mediaIds:[],createdAt:new Date().toISOString()};
        store.put('articles',item);linkTopicMaterial(store,topicId,'article',item);
        return {item,created:true};
      });
      return json(res,item,created?201:200);
    }
    match=p.match(/^\/api\/articles\/([\w-]+)\/draft$/);
    if(match&&m==='POST'){const data=z.object({brief:z.string().max(2000).default('')}).parse(await jsonBody(req));if(store.get('articles',match[1])?.archivedAt)throw new AppError('請先還原封存素材再產稿');if(!store.kv('settings').aiEnabled)throw new AppError('請先在 AI 設定啟用產稿');if(store.kv('aiPaused'))throw new AppError('AI 已暫停，請先處理額度或授權');return json(res,enqueueDraft(store,match[1],data.brief),202);}
    if(p==='/api/ai/check'&&m==='POST'){const status=await codexStatus();store.set('codexStatus',status);return json(res,status);}
    if(p==='/api/ai/resume'&&m==='POST'){store.set('aiPaused',null);return json(res,{ok:true});}
    if(p==='/api/media/upload'&&m==='POST'){
      const topic=url.searchParams.get('topicId'),topicId=topic===null?null:requireTopic(store,z.string().uuid().parse(topic));
      const label=decodeURIComponent(String(req.headers['x-file-name']||'上傳圖片')).slice(0,150);
      const item=await saveImage(store,await bytes(req,10_000_000),label);
      return json(res,linkTopicMaterial(store,topicId,'media',item),201);
    }
    if(p==='/api/media/import'&&m==='POST'){const data=z.object({url:z.string().url(),label:z.string().max(150).default('來源圖片')}).parse(await jsonBody(req));return json(res,await importImage(store,data.url,data.label),201);}
    if(p==='/api/media/card'&&m==='POST'){const data=cardInput.parse(await jsonBody(req));if(data.postId&&!store.get('posts',data.postId))throw new AppError('找不到圖卡對應的貼文',404);return json(res,await createCard(store,data),201);}
    if(p==='/api/media/generate'&&m==='POST'){
      const data=z.object({prompt:z.string().max(3000).default(''),postId:z.string().max(80).default(''),style:z.string().max(100).default('柔和編輯插畫')}).parse(await jsonBody(req));
      const provider=store.kv('settings').imageProvider||'codex';
      store.event('info',`開始生成 AI 配圖（${provider==='codex'?'Codex 訂閱':'Images API'}）`);
      try{
        const media=await generateImage(store,data.prompt,{postId:data.postId,style:data.style});
        store.set('imageLastError',null);store.event('info',`AI 配圖已完成：${media.label}`);return json(res,media,201);
      }catch(error){
        const message=error instanceof AppError?error.message:'AI 配圖未完成，請稍後再試';
        store.set('imageLastError',{message,code:error.code||'ai_image_failed',provider,at:new Date().toISOString()});
        store.event('error',`AI 配圖失敗：${message}`);throw error;
      }
    }
    match=p.match(/^\/api\/media\/([\w-]+)$/);
    if(match&&m==='GET'){if(!store.get('media',match[1]))throw new AppError('找不到圖片',404);res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private,max-age=3600'});res.end(await readFile(path.join(store.directory,'media',`${match[1]}.jpg`)));return;}
    if(p==='/api/posts'&&m==='POST'){
      const data=postInput.parse(await jsonBody(req));requireCategory(store,data.category);validateMedia(data);const item={...data,id:randomUUID(),status:'draft',reviewHash:'',queueOrder:Date.now(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};store.db.prepare('INSERT INTO posts VALUES (?,1,?)').run(item.id,JSON.stringify(item));return json(res,{...item,version:1},201);
    }
    match=p.match(/^\/api\/posts\/([\w-]+)$/);
    if(match&&m==='PUT'){
      const body=await jsonBody(req),input=postInput.parse(body),old=requirePost(match[1]);expectVersion(old,body.version);requireCategory(store,input.category);validateMedia(input);
      if(store.list('publications').some(j=>j.postId===old.id))throw new AppError('這篇內容已有送出紀錄，請複製為新草稿後修改',409);
      const item={...old,...input,updatedAt:new Date().toISOString()},changed=contentHash(old)!==contentHash(item);
      if(changed){item.status='draft';item.reviewHash='';if(old.topicDraftJobId){item.topicDraftLocked=true;delete item.topicReview;}}
      if(old.sourceId!==item.sourceId||PLATFORMS.some(platform=>old.variants[platform]!==item.variants[platform]))delete item.articleResearch;
      const result=store.db.prepare('UPDATE posts SET data=?,version=version+1 WHERE id=? AND version=?').run(JSON.stringify(item),old.id,old.version);if(!result.changes)throw new AppError('貼文已更新，請重新載入',409);
      return json(res,{...item,version:old.version+1});
    }
    if(match&&m==='DELETE'){
      const {version}=z.object({version:z.number().int().positive()}).parse(await jsonBody(req));
      store.transaction(()=>{
        const old=requirePost(match[1]);
        if(store.list('publications').some(j=>j.postId===old.id))throw new AppError('有送出紀錄的貼文需保留供核對');
        expectVersion(old,version);
        if(old.status!=='draft')throw new AppError('這篇內容已非待審草稿，請重新載入；已核准內容需先撤回核准',409,'conflict');
        store.db.prepare('DELETE FROM posts WHERE id=? AND version=?').run(old.id,version);
      });return json(res,{ok:true});
    }
    match=p.match(/^\/api\/posts\/([\w-]+)\/(approve|revoke|duplicate|publish)$/);
    if(match&&m==='POST'){
      const old=requirePost(match[1]),action=match[2],data=await jsonBody(req);expectVersion(old,data.version);
      if(action==='duplicate'){const item={...old,id:randomUUID(),title:`${old.title}（副本）`.slice(0,200),status:'draft',reviewHash:'',queueOrder:Date.now(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};store.db.prepare('INSERT INTO posts VALUES (?,1,?)').run(item.id,JSON.stringify(item));return json(res,{...item,version:1},201);}
      if(store.list('publications').some(j=>j.postId===old.id))throw new AppError('這篇內容已有發佈工作，請到發佈紀錄處理',409);
      if(action==='approve'){
        const valid=postInput.parse(old);validateMedia(valid);if(!valid.channels.length)throw new AppError('請先設定社群 API 並選擇至少一個發佈平台');if(valid.channels.some(c=>!channelStatus(store)[c].ready))throw new AppError('所選平台尚未設定完成，請先設定社群 API');if(valid.channels.includes('instagram')&&!valid.mediaIds.length)throw new AppError('Instagram 需要圖片，請先加入圖片或取消該平台');
        if(valid.expiresAt&&Date.parse(valid.expiresAt)<=Date.now())throw new AppError('內容已過期，請確認有效期限');
        const item={...old,status:'approved',reviewHash:contentHash(old),approvalAccounts:approvalAccounts(store,valid.channels),approvedAt:new Date().toISOString(),approvedBy:'human',topicNeedsReview:false};
        store.transaction(()=>{
          if(!store.db.prepare('UPDATE posts SET version=version+1,data=? WHERE id=? AND version=?').run(JSON.stringify(item),old.id,old.version).changes)throw new AppError('內容或發佈狀態已更新，請重新載入',409);
          store.db.prepare('UPDATE slot_bindings SET review_hash=?,revision=? WHERE post_id=?').run(item.reviewHash,randomUUID(),old.id);
        });
        return json(res,{...item,version:old.version+1});
      }
      if(action==='publish'){
        if(old.status!=='approved'||old.reviewHash!==contentHash(old))throw new AppError('請先核准最新內容');
        const configured=old.channels.filter(c=>channelStatus(store)[c].ready);const channels=data.channels===undefined?configured:z.array(z.enum(PLATFORMS)).min(1).max(4).parse(data.channels);if(!channels.length||channels.some(c=>!configured.includes(c)))throw new AppError('只能手動發佈至已設定 API 且已核准的平台');const slot=createSlot(store,new Date().toISOString(),new Date(),old.id,channels);if(!slot?.postId)throw new AppError('沒有可發佈的內容，請確認有效期限及啟用平台');return json(res,slot,202);
      }
      const item={...old,status:'draft',reviewHash:''};if(!store.db.prepare('UPDATE posts SET version=version+1,data=? WHERE id=? AND version=?').run(JSON.stringify(item),old.id,old.version).changes)throw new AppError('發佈工作已開始或內容已更新，請重新載入',409);return json(res,{...item,version:old.version+1});
    }
    if(p==='/api/slot-bindings'&&m==='GET'){
      const bindings=listSlotBindings(store);
      return json(res,{bindings});
    }
    match=p.match(/^\/api\/posts\/([\w-]+)\/slot-binding$/);
    if(match&&m==='PUT'){
      const input=z.object({when:z.string().datetime({offset:true}),version:z.number().int().positive(),revision:z.string().uuid().nullable()})
        .parse(await jsonBody(req));
      return json(res,bindPostSlot(store,match[1],input));
    }
    if(p==='/api/queue'&&m==='PUT'){
      const {ids}=z.object({ids:z.array(z.string()).max(1000)}).parse(await jsonBody(req));
      store.transaction(()=>{const posts=store.list('posts').filter(p=>p.status==='approved');if(new Set(ids).size!==ids.length||ids.length!==posts.length||ids.some(id=>!posts.some(p=>p.id===id)))throw new AppError('佇列已變更，請重新載入',409);ids.forEach((id,i)=>{const post=posts.find(p=>p.id===id);store.db.prepare('UPDATE posts SET version=version+1,data=? WHERE id=?').run(JSON.stringify({...post,queueOrder:i}),id);});});return json(res,{ok:true});
    }
    match=p.match(/^\/api\/publications\/([\w-]+)$/);
    if(match&&m==='DELETE')return json(res,{ok:true,deletion:await deleteFacebookPublication(store,match[1])});
    match=p.match(/^\/api\/publications\/([\w-]+)\/(retry|resolve)$/);
    if(match&&m==='POST'){
      const job=store.get('publications',match[1]);if(!job)throw new AppError('找不到紀錄',404);const data=await jsonBody(req),post=requirePost(job.postId);
      if(match[2]==='retry'){
        if(post.reviewHash!==contentHash(post))throw new AppError('內容核准狀態不符，不能補送');
        if(!matchesPublicationAccount(store,job.channel,job.accountKey))throw new AppError('發佈帳號已變更，請確認目的地後複製到新草稿重新核准',409);
        if(post.expiresAt&&Date.parse(post.expiresAt)<=Date.now())throw new AppError('內容已過期，不能補送');
        if(job.bindingRevision&&store.db.prepare('SELECT revision FROM slot_bindings WHERE post_id=?').get(post.id)?.revision!==job.bindingRevision){
          throw new AppError('發文時段已變更，不能補送舊工作',409);
        }
      }
      let next;
      if(match[2]==='retry'){
        if(job.status!=='failed')throw new AppError('僅能補送已確認失敗的工作');
        next={...job,status:'pending',phase:'queued',error:'',manualRetry:true};
      }else{
        if(job.status!=='unknown')throw new AppError('此筆紀錄不需要結果核對');
        const input=z.object({
          outcome:z.enum(['sent','not_sent']),
          note:z.string().trim().min(5).max(500),
          publishedAt:z.string().datetime({offset:true}).optional(),
          platformId:z.string().trim().max(100).optional(),
        }).parse(data);
        next={...job,status:input.outcome==='sent'?'sent':'failed',note:input.note,resolvedAt:new Date().toISOString()};
        if(next.status==='sent'){
          next.error='';
          if(input.publishedAt){
            const time=Date.parse(input.publishedAt);
            if(!Number.isFinite(time)||time>Date.now())throw new AppError('平台發文時間須是有效且已發生的時間');
            next.publishedAt=new Date(time).toISOString();
          }
          if(input.platformId){
            const valid=job.channel==='line'?/^[\w-]+$/:/^[0-9]+(?:_[0-9]+)?$/;
            if(!valid.test(input.platformId))throw new AppError('平台識別碼格式不正確');
            next.result={...job.result,[job.channel==='line'?'requestId':'id']:input.platformId};
          }
        }
      }
      if(!transitionPublication(store,next,job.status))throw new AppError('這筆紀錄已被更新，請重新載入',409);
      store.event('info','承辦人已處理一筆發佈紀錄');
      return json(res,{ok:true});
    }
    match=p.match(/^\/api\/channels\/(facebook|instagram|threads|line)\/check$/);
    if(match&&m==='POST'){const result=await verifyChannel(store,match[1]);store.set(`verified:${match[1]}`,result);return json(res,result);}
    if(p==='/api/mail/test'&&m==='POST'){if(!store.kv('settings').notifyEmail)throw new AppError('請先設定通知收件信箱');if(!store.secret('SMTP_HOST'))throw new AppError('請先設定 SMTP');queueMail(store,`test:${randomUUID()}`,'[社群工作台] 郵件連線測試','這是一封由你在設定頁主動要求寄出的測試郵件。');return json(res,{ok:true,message:'測試郵件已排入寄送佇列'},202);}
    throw new AppError('找不到這個操作',404);
  }
  const handler=async(req,res)=>{
    securityHeaders(res,dev);
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname.startsWith('/api/')){if(!['GET','HEAD'].includes(req.method))validateOrigin(req);return await api(req,res,url);}
      if(req.method!=='GET'&&req.method!=='HEAD')throw new AppError('不支援的操作',405);
      const image=url.pathname.match(/^\/media\/([0-9a-f-]{36})-(facebook|instagram|threads|line)\.jpg$/);
      if(image){if(!store.get('media',image[1])?.public)throw new AppError('找不到圖片',404);const file=await readFile(path.join(store.directory,'media',`${image[1]}-${image[2]}.jpg`));res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'public,max-age=86400'});res.end(req.method==='HEAD'?undefined:file);return;}
      if(vite){return vite.middlewares(req,res,async()=>{try{const template=readFileSync(path.join(root,'selfhost/web/index.html'),'utf8'),html=await vite.transformIndexHtml(url.pathname,template);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);}catch{json(res,{error:'預覽尚未就緒'},503);}});}
      const base=path.join(root,'selfhost-dist'),decoded=decodeURIComponent(url.pathname),target=path.resolve(base,'.'+decoded);
      if(target!==base&&!target.startsWith(base+path.sep))throw new AppError('找不到檔案',404);
      const isAsset=path.extname(target)&&path.extname(target)!=='.html',file=isAsset?target:path.join(base,'index.html');
      if(!existsSync(file))throw new AppError(isAsset?'找不到檔案':'尚未建立前端，請先執行 npm run selfhost:build',isAsset?404:503);
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
      res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':isAsset?'public,max-age=31536000,immutable':'no-cache'});res.end(req.method==='HEAD'?undefined:await readFile(file));
    } catch(error){if(res.headersSent){res.destroy();return;}if(error instanceof z.ZodError)json(res,{error:error.issues.map(e=>e.message).slice(0,3).join('；'),code:'validation'},400);else if(error instanceof AppError)json(res,{error:error.message,code:error.code},error.status);else{console.error('Campus request failed:',error?.name||'Error');json(res,{error:'操作暫時無法完成，請稍後重試',code:'server_error'},500);}}
  };
  return {store,engine,handler,async close(){await engine.stop();if(vite)await vite.close();store.close();}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dev=process.argv.includes('--dev'),app=await createApp({dev,startWorker:process.env.EMBEDDED_WORKER!=='false'}),server=http.createServer(app.handler);
  server.requestTimeout=240000;server.headersTimeout=30000;
  const port=Number(process.env.PORT||5180),host=process.env.HOST||'127.0.0.1';
  server.listen(port,host,()=>console.log(`Campus Social 自架模式：http://${host}:${port}${dev?'（開發預覽）':''}`));
  let stopping=false;
  async function shutdown(){if(stopping)return;stopping=true;server.close();await app.close();process.exit(0);}
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
