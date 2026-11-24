import { randomUUID } from 'node:crypto';
import { AppError, choosePost, contentHash, dueSlots, matchesRules, weekStart, localParts, taipeiDate, PLATFORMS } from './core.mjs';
import { discoverLinks, readArticles } from './codex-web.mjs';
import { generateDraft, assessArticle, planTopicCards } from './ai.mjs';
import { importImage, mediaForPlatform, createCard, generateImage } from './media.mjs';
import { cardPageInput } from './card-layout.mjs';
import { preflight, publishPost, channelStatus, publicationAccount, matchesPublicationAccount, PLATFORM_KEYS } from './publish.mjs';
import { notify, queueMail, sendMailQueue } from './mailer.mjs';
import {selectionCheck,articleExpiry,draftWindow,draftCapacity,maintainArticles,diversifyArticles} from './automation.mjs';
import { draftTopicNext } from './topic-drafts.mjs';
import { draftFromPublicArticle } from './article-drafts.mjs';

export function enqueueDraft(store,articleId,brief='') {
  if(!store.get('articles',articleId))throw new AppError('找不到素材',404);
  const existing=store.list('generation_jobs').find(j=>j.articleId===articleId&&['pending','running'].includes(j.status));
  if(existing)return existing;
  const job={id:randomUUID(),articleId,brief:brief.slice(0,2000),status:'pending',createdAt:new Date().toISOString()};store.put('generation_jobs',job);return job;
}
export async function gatherSources(store,now=new Date(),deps={}) {
  const settings=store.kv('settings'),last=store.kv('lastScan',''),force=store.kv('scanRequested',false);
  const shouldScan=force||!last||now.getTime()-Date.parse(last)>=settings.scanMinutes*60000;
  if(shouldScan){
  store.set('scanRequested',false);store.set('lastScan',now.toISOString());
  maintainArticles(store,now);
  for(const source of store.list('sources').filter(s=>s.enabled)){
    let newCount=0;
    const currentSource=()=>{
      const current=store.get('sources',source.id);
      return current?.enabled&&(current.scanRevision??null)===(source.scanRevision??null)?current:null;
    };
    const finish=fields=>store.transaction(()=>{
      const current=currentSource();
      if(!current)return false;
      store.put('sources',{...current,lastScanAt:now.toISOString(),...fields});
      return true;
    });
    try {
      const links=await (deps.discoverLinks||discoverLinks)(source);
      const known=new Set(store.list('articles').map(a=>a.url));
      const candidates=links.filter(url=>!known.has(url)).slice(0,8);
      const batch=deps.readArticle||!currentSource()?[]:await (deps.readArticles||readArticles)(candidates,{selector:source.articleSelector});
      // Keep unprocessed links discoverable next scan instead of starving later articles.
      for(const url of candidates) {
        if(!currentSource())break;
        try {
          const article=deps.readArticle?await deps.readArticle(url,source.articleSelector):batch.find(item=>item.url===url);
          if(!article)throw new AppError('Codex Web Search 讀不到文章正文');
          const inserted=store.transaction(()=>{
            const current=currentSource();
            if(!current||store.db.prepare('SELECT id FROM articles WHERE url=?').get(article.url))return false;
            const age=article.publishedAt?now.getTime()-Date.parse(article.publishedAt):0;
            const match=matchesRules(article,settings)&&age<=settings.sourceMaxAgeDays*86400000;
            const duplicate=store.list('articles').find(a=>a.text.replace(/\s/g,'')===article.text.replace(/\s/g,''));
            store.put('articles',{...article,id:randomUUID(),sourceId:source.id,category:current.category||'其他',duplicateOf:duplicate?.id||'',status:match&&!duplicate?'available':'filtered',createdAt:now.toISOString(),mediaIds:[]});
            return true;
          });
          if(inserted)newCount++;
        } catch(error){store.event('warning',`來源「${source.name}」有一篇文章無法整理：${error instanceof AppError?error.message:'擷取失敗，請手動匯入'}`);}
      }
      finish({lastError:'',lastNewCount:newCount});
    }catch(error){
      const message=error instanceof AppError?error.message:'來源網站無法讀取，請確認網址或改用貼上原文';
      if(finish({lastError:message}))notify(store,`source:${source.id}:${taipeiDate(now)}`,`來源「${source.name}」整理失敗：${message}`,now);
    }
  }
  }
  const window=draftWindow(settings,store.kv('draftCursor'),now);
  store.set('draftCursor',now.toISOString());
  const canDispatch=settings.draftMode==='scheduled'?window.due:shouldScan;
  if(canDispatch)enqueueAvailableDrafts(store,now);
}

export function enqueueAvailableDrafts(store,now=new Date()){
  return store.transaction(()=>{
    const settings=store.kv('settings');
    if(!settings.aiEnabled||store.kv('aiPaused'))return {queued:0,remaining:0};
    const jobs=store.list('generation_jobs');
    const remaining=draftCapacity(jobs,settings,now);
    if(!remaining)return {queued:0,remaining:0};
    const queued=new Set(jobs.map(j=>j.articleId));
    const topicSources=new Set(store.db.prepare("SELECT material_id FROM topic_materials WHERE kind='article'").all().map(row=>row.material_id));
    const recent=jobs.filter(job=>job.automatic&&['completed','pending','running'].includes(job.status)&&now.getTime()-Date.parse(job.createdAt)<7*86400000)
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,12).map(job=>store.get('articles',job.articleId)).filter(Boolean);
    const eligible=store.list('articles').filter(a=>a.status==='available'&&!queued.has(a.id)&&!topicSources.has(a.id)&&selectionCheck(a,settings,now).eligible);
    const selected=diversifyArticles(eligible,recent,remaining);
    for(const article of selected) {
      const job=enqueueDraft(store,article.id);store.put('generation_jobs',{...job,automatic:true,createdAt:now.toISOString(),ruleSnapshot:{topics:settings.topics,keywords:settings.keywords,excludes:settings.excludes,aiSelectionEnabled:settings.aiSelectionEnabled,selectionRules:settings.selectionRules,selectionMinScore:settings.selectionMinScore,selectionMinFacts:settings.selectionMinFacts,imageRules:settings.imageRules,autoArtwork:settings.autoArtwork}});
    }
    return {queued:selected.length,remaining:remaining-selected.length};
  });
}
export async function draftNext(store,now=new Date(),deps={}) {
  const settings=store.kv('settings');if(!settings.aiEnabled||store.kv('aiPaused'))return;
  if(await draftTopicNext(store,now,deps))return;
  // A crashed inference is not blindly rerun and charged again.
  for(const j of store.list('generation_jobs').filter(j=>!j.topicId&&j.status==='running'&&Date.parse(j.startedAt)<now.getTime()-300000))store.put('generation_jobs',{...j,status:'failed',error:'上次產稿被中斷，請人工重新建立工作'});
  const job=store.list('generation_jobs').filter(j=>!j.topicId&&j.status==='pending').sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];if(!job)return;
  if(!store.db.prepare("UPDATE generation_jobs SET status='running' WHERE id=? AND status='pending'").run(job.id).changes)return;
  store.put('generation_jobs',{...job,status:'running',startedAt:now.toISOString()});
  let article=store.get('articles',job.articleId);
  try {
    if(!article)throw new AppError('素材已不存在');
    if(article.archivedAt)throw new AppError('素材已封存，停止產稿');
    if(job.automatic){
      const check=selectionCheck(article,settings,now);
      if(!check.eligible)throw new AppError(check.reasons.join('；'));
      if(settings.aiSelectionEnabled){
        const assessment=await (deps.assessArticle||assessArticle)(store,article,now);
        const current=store.get('articles',article.id);
        article={...current,assessment,category:current.category&&current.category!=='其他'?current.category:assessment.category};
        store.put('articles',article);
        if(!assessment.eligible){
          store.put('articles',{...article,status:'filtered'});
          store.put('generation_jobs',{...job,status:'skipped',error:`AI 未選用：${assessment.reason}`,completedAt:new Date().toISOString()});
          store.event('info',`AI 選稿未採用：${article.title}（${assessment.reason}）`);
          return;
        }
      }
    }
    const searchPublicMaterial=job.automatic&&article.url&&Object.hasOwn(article,'publishedAt');
    const {result,research}=searchPublicMaterial
      ?await draftFromPublicArticle(store,article,job.brief,now,deps)
      :{result:await (deps.generateDraft||generateDraft)(store,article,job.brief,deps)};
    const mediaIds=[...(article.mediaIds||[])];
    if(!mediaIds.length)for(const url of (article.imageUrls||[]).slice(0,10)){try{mediaIds.push((await (deps.importImage||importImage)(store,url,article.title)).id);}catch{/* Draft keeps text and original image references for manual completion. */}}
    const connections=channelStatus(store);
    const latest=store.get('articles',article.id);
    if(latest.archivedAt)throw new AppError('素材在產稿期間已封存，停止建立草稿');
    article={...latest};
    const post={...result,id:randomUUID(),sourceId:article.id,category:article.category||'其他',mediaIds,channels:settings.channels.filter(c=>connections[c].ready),status:'draft',backup:false,expiresAt:job.automatic?articleExpiry(article,settings):'',reviewHash:'',queueOrder:now.getTime(),createdAt:now.toISOString(),updatedAt:now.toISOString(),selection:article.assessment||null};
    if(job.automatic&&settings.autoArtwork!=='manual'){
      try{
        let backgroundId=settings.autoArtwork==='source'?mediaIds[0]||'':'';
        const count=settings.articleCardCount||1;
        const pages=count===1?[{title:result.cardTitle||result.title.slice(0,25),summary:result.cardSummary||''}]
          :await (deps.planTopicCards||planTopicCards)(store,{topic:{title:article.title},candidate:result,
            sources:[{title:article.title,url:article.url,text:article.text,excerpts:article.excerpts}],count,singleCover:true},deps);
        if(settings.autoArtwork==='ai'){
          const imageBrief=[result.title,result.imagePrompt,settings.imageRules,'方形圖卡共用底圖，中央和下半部留低對比空間放白色文字。'].join('\n').slice(0,3000);
          const image=await (deps.generateImage||generateImage)(store,imageBrief,{style:'柔和編輯插畫'});
          backgroundId=image.id;store.put('media',{...image,sourcePostId:post.id});
        }
        const label=settings.autoArtwork==='ai'?`${settings.unitName}｜概念插畫`:settings.unitName;
        const cards=[];
        for(const [index,page] of pages.entries()){
          const card=await (deps.createCard||createCard)(store,{...cardPageInput(page,{mediaId:backgroundId,label,body:index>0}),postId:post.id});
          cards.push(card.id);
        }
        post.mediaIds=count>1?cards:[...cards,...mediaIds].slice(0,10);
      }catch(error){post.artworkError=error instanceof AppError?error.message:'自動圖卡未完成，請人工補圖';store.event('warning',`已保留文案草稿，圖片待處理：${post.artworkError}`);}
    }
    store.transaction(()=>{
      const current=store.get('articles',article.id);
      store.db.prepare('INSERT INTO posts VALUES (?,1,?)').run(post.id,JSON.stringify({...post,category:current.category||'其他',selection:current.assessment||null,...(research?{articleResearch:research}:{})}));
      store.put('articles',{...current,status:'drafted',mediaIds});
      store.put('generation_jobs',{...job,status:'completed',postId:post.id,completedAt:new Date().toISOString(),...(research?{research}:{})});
    });
    store.set('aiVerified',{provider:settings.aiProvider,at:new Date().toISOString()});
    store.event('info',`已製作待審草稿：${post.title}`);
  } catch(error) {
    const message=error instanceof AppError?error.message:'AI 草稿未完成，請檢查模型與素材';
    store.put('generation_jobs',{...job,status:'failed',error:message});
    if(['ai_quota','ai_auth'].includes(error.code))store.set('aiPaused',{reason:message,at:new Date().toISOString()});
    notify(store,`ai:${error.code||'failed'}:${taipeiDate(now)}`,message,now);
  }
}
export function bindPostSlot(store, postId, {when, version, revision}, now = new Date()) {
  return store.transaction(() => {
    const topic=store.db.prepare('SELECT start_date,end_date FROM topics WHERE post_id=?').get(postId);
    if(topic&&Number.isFinite(Date.parse(when))) {
      const date=taipeiDate(new Date(when));
      if(date<topic.start_date||date>topic.end_date)throw new AppError('發文時段須在主題日期內');
    }
    return writeSlotBinding(store,postId,{when,version,revision},now);
  });
}

// Called inside the transaction that saves the topic and its slot together.
export function writeSlotBinding(store, postId, {when, version, revision}, now = new Date()) {
  const timestamp = Date.parse(when);
  if (!Number.isFinite(timestamp) || timestamp <= now.getTime()) throw new AppError('請選擇未來的發文時段');
  const slotId = new Date(timestamp).toISOString();

  const post = store.get('posts', postId);
  if (!post) throw new AppError('找不到貼文', 404);
  const current = store.db.prepare('SELECT * FROM slot_bindings WHERE post_id=?').get(postId);
  if (post.version !== version || (current?.revision ?? null) !== revision) {
    throw new AppError('貼文或時段綁定已變更，請重新載入', 409);
  }
  const settings = {...store.kv('settings'), scheduleEnabled: true};
  if (!dueSlots(settings, new Date(timestamp - 1), new Date(timestamp)).includes(slotId)) {
    throw new AppError('請選擇目前週期排程中的發文時段');
  }
  const occupied = store.db.prepare('SELECT post_id FROM slot_bindings WHERE slot_id=?').get(slotId);
  if ((occupied && occupied.post_id !== postId) || store.get('slots', slotId)) {
    throw new AppError('此時段已被使用，請選擇其他時段', 409);
  }
  if (!post.reviewHash || post.reviewHash !== contentHash(post) ||
      !(post.status === 'approved' || (current && ['publishing', 'attention'].includes(post.status)))) {
    throw new AppError('請先核准可發佈的貼文');
  }
  if (post.expiresAt && Date.parse(post.expiresAt) <= timestamp) {
    throw new AppError('貼文在指定時段前已過期');
  }
  const jobs = store.list('publications').filter(job => job.postId === postId);
  const movable = new Set(['pending', 'preparing', 'cancelled']);
  if (!post.channels.some(channel => !jobs.some(job => job.channel === channel && !movable.has(job.status)))) {
    throw new AppError('各平台均已有發佈嘗試，請到發佈紀錄處理', 409);
  }
  if (current?.slot_id === slotId && current.review_hash === post.reviewHash) {
    return {postId, when: slotId, revision};
  }

  const nextRevision = randomUUID();
  store.db.prepare(`INSERT INTO slot_bindings VALUES (?,?,?,?) ON CONFLICT(post_id) DO UPDATE
    SET slot_id=excluded.slot_id, revision=excluded.revision, review_hash=excluded.review_hash`)
    .run(postId, slotId, nextRevision, post.reviewHash);
  for (const job of jobs.filter(job => ['pending', 'preparing'].includes(job.status))) {
    savePublication(store, {...job, status: 'cancelled', error: '發文時段已變更，停止送出舊工作'}, job.status);
  }
  if (current && jobs.some(job => job.slotId === current.slot_id)) {
    updateSlotResult(store, current.slot_id);
  }
  if (post.status !== 'approved') {
    store.db.prepare('UPDATE posts SET version=version+1,data=? WHERE id=?')
      .run(JSON.stringify({...post, status: 'approved', updatedAt: now.toISOString()}), postId);
  }
  return {postId, when: slotId, revision: nextRevision};
}

export function createSlot(store,when,now=new Date(),desiredPostId='',selectedChannels) {
  const timestamp=Date.parse(when);
  if(!Number.isFinite(timestamp)||timestamp>now.getTime())return null;
  return store.transaction(()=>{
    if(store.get('slots',when))return null;
    const saved=store.kv('settings'),connections=channelStatus(store);
    const settings={...saved,channels:(selectedChannels||saved.channels).filter(c=>connections[c].ready)};
    if(now.getTime()-Date.parse(when)>settings.catchUpMinutes*60000){const item={id:when,status:'missed',postId:null,message:'主機恢復時已超過補送期限，未補發舊排程',createdAt:now.toISOString()};store.db.prepare('INSERT INTO slots VALUES (?,?,?,?)').run(when,null,item.status,JSON.stringify(item));return item;}
    const bindings=store.db.prepare('SELECT * FROM slot_bindings').all();
    const reserved=new Set(bindings.map(binding=>binding.post_id));
    if(!desiredPostId) {
      const topicPosts=store.db.prepare('SELECT post_id FROM topics WHERE post_id IS NOT NULL').all();
      for(const topic of topicPosts)reserved.add(topic.post_id);
    }
    const binding=bindings.find(item=>item.slot_id===when);
    if(desiredPostId&&(binding||reserved.has(desiredPostId)))throw new AppError('此貼文或時段已有指定發文安排',409);
    const boundPost=binding&&store.get('posts',binding.post_id);
    const priorJobs=boundPost?store.list('publications').filter(job=>job.postId===boundPost.id):[];
    const boundChannels=settings.channels.filter(channel=>!priorJobs.some(job=>job.channel===channel&&job.status!=='cancelled'));
    const accountsMatch=(post,channels)=>!post.approvalAccounts||channels.filter(channel=>post.channels.includes(channel))
      .every(channel=>matchesPublicationAccount(store,channel,post.approvalAccounts[channel]));
    const reservedPost=boundPost&&(boundPost.approvedBy!=='ai'||(saved.topicAutoPublish&&boundPost.topicReview?.postHash===boundPost.reviewHash))&&
      boundPost.reviewHash===binding.review_hash&&accountsMatch(boundPost,boundChannels)&&choosePost([boundPost],boundChannels,now);
    const post=reservedPost||choosePost(store.list('posts').filter(p=>!reserved.has(p.id)&&(!desiredPostId||p.id===desiredPostId)&&accountsMatch(p,settings.channels)),settings.channels,now);
    const message=binding&&!reservedPost?'指定稿無法發佈，已檢查一般佇列與備稿':post?'':'沒有合適的已核准內容或有效備稿';
    const channels=(reservedPost?boundChannels:settings.channels).filter(channel=>post?.channels.includes(channel));
    const item={id:when,origin:desiredPostId?'manual':'schedule',status:post?'processing':'skipped',postId:post?.id||null,title:post?.title||'',backup:post?.backup||false,channels,message,createdAt:now.toISOString()};
    store.db.prepare('INSERT INTO slots VALUES (?,?,?,?)').run(when,item.postId,item.status,JSON.stringify(item));
    if(post){const next={...post,status:'publishing',updatedAt:now.toISOString()};store.db.prepare('UPDATE posts SET version=version+1,data=? WHERE id=?').run(JSON.stringify(next),post.id);
      for(const channel of channels){
        const accountKey=post.approvalAccounts?post.approvalAccounts[channel]??null:publicationAccount(store,channel);
        const job={id:randomUUID(),postId:post.id,channel,slotId:when,origin:item.origin,accountKey,postVersion:post.version+1,reviewHash:post.reviewHash,
          ...(reservedPost?{bindingRevision:binding.revision}:{}),status:'pending',phase:'queued',requestKey:randomUUID(),createdAt:now.toISOString(),updatedAt:now.toISOString()};
        store.db.prepare(`INSERT INTO publications VALUES (?,?,?,?,?) ON CONFLICT(post_id,channel) DO UPDATE
          SET id=excluded.id,status=excluded.status,data=excluded.data WHERE publications.status='cancelled'`)
          .run(job.id,post.id,channel,job.status,JSON.stringify(job));
      }
    }
    return item;
  });
}
function savePublication(store,job,expectedStatus) {
  if(job.channel==='line'&&job.accountKey?.startsWith('line-token:')&&matchesPublicationAccount(store,job.channel,job.accountKey)){
    job={...job,accountKey:publicationAccount(store,job.channel)};
  }
  return store.db.prepare('UPDATE publications SET status=?,data=? WHERE id=? AND status=?')
    .run(job.status,JSON.stringify({...job,updatedAt:new Date().toISOString()}),job.id,expectedStatus).changes===1;
}
function publicationStatus(jobs) {
  if(jobs.some(job=>['pending','preparing','sending'].includes(job.status)))return 'publishing';
  if(jobs.every(job=>job.status==='sent'))return 'published';
  if(jobs.every(job=>job.status==='missed'))return 'missed';
  if(jobs.every(job=>job.status==='cancelled'))return 'cancelled';
  return 'attention';
}
function updateSlotResult(store, slotId) {
  const slot=store.get('slots',slotId);
  const jobs=store.list('publications').filter(job=>job.slotId===slotId);
  if(!slot||!jobs.length)return;
  const outcomes=slot.channels?.map(channel=>jobs.find(job=>job.channel===channel)||{status:'cancelled'})||jobs;
  const status=publicationStatus(outcomes);
  const slotStatus=status==='publishing'?'processing':status;
  const message=status==='missed'?'已超過補送期限，未補發舊排程':slot.message;
  if(slot.status!==slotStatus||slot.message!==message)store.db.prepare('UPDATE slots SET status=?,data=? WHERE id=?')
    .run(slotStatus,JSON.stringify({...slot,status:slotStatus,message}),slot.id);
}
function finalizePost(store,postId,slotId) {
    const jobs=store.list('publications').filter(j=>j.postId===postId),post=store.get('posts',postId);
    if(!post||!jobs.length)return;
    updateSlotResult(store,slotId||jobs[0].slotId);
    const binding=store.db.prepare('SELECT slot_id FROM slot_bindings WHERE post_id=?').get(postId);
    if(binding&&store.get('slots',binding.slot_id)?.postId!==postId)return;
    const outcome=publicationStatus(jobs);
    const status=['cancelled','missed'].includes(outcome)?'attention':outcome;
    if(post.status!==status)store.db.prepare('UPDATE posts SET data=? WHERE id=?')
      .run(JSON.stringify({...post,status}),postId);
}
export function transitionPublication(store, job, expectedStatus) {
  return store.transaction(()=>{
    if(!savePublication(store,job,expectedStatus))return false;
    finalizePost(store,job.postId,job.slotId);
    return true;
  });
}
function pastCatchUp(store,job,time) {
  if(job.manualRetry)return false;
  const slot=store.get('slots',job.slotId),slotTime=Date.parse(job.slotId);
  // Older scheduled slots were always aligned to the minute.
  const origin=job.origin||slot?.origin||(slotTime%60_000===0?'schedule':'manual');
  return origin==='schedule'&&time-slotTime>store.kv('settings').catchUpMinutes*60_000;
}
export async function processPublication(store,job,now=new Date(),deps={}) {
  if(pastCatchUp(store,job,now.getTime())){
    if(transitionPublication(store,{...job,status:'missed',error:'已超過補送期限，未送出'},'pending'))
      notify(store,`slot:${job.slotId}`,'已超過補送期限，未補發舊排程',now);
    return;
  }
  let current={...job,status:'preparing',phase:'preparing'};
  if(!savePublication(store,current,'pending'))return;
  const started=performance.now();
  const assertCurrent = () => {
    const post=store.get('posts',job.postId);
    const time=now.getTime()+performance.now()-started;
    if(pastCatchUp(store,job,time))throw new AppError('已超過補送期限，未送出',409,'missed_slot');
    if(job.accountKey!==undefined&&!matchesPublicationAccount(store,job.channel,job.accountKey))
      throw new AppError('發佈帳號已變更，請確認目的地後複製到新草稿重新核准',409,'account_changed');
    if(!post||post.reviewHash!==contentHash(post)||
        (job.postVersion!==undefined&&(post.version!==job.postVersion||post.reviewHash!==job.reviewHash))) {
      throw new AppError('內容未核准或版本已變更，停止發佈');
    }
    if(post.expiresAt&&Date.parse(post.expiresAt)<=time) {
      throw new AppError('內容已超過有效期限，停止發佈');
    }
    if(job.bindingRevision) {
      const binding=store.db.prepare('SELECT * FROM slot_bindings WHERE post_id=?').get(job.postId);
      if(binding?.revision!==job.bindingRevision||binding.slot_id!==job.slotId||binding.review_hash!==job.reviewHash||
          store.get('slots',job.slotId)?.postId!==job.postId) {
        throw new AppError('發文時段已變更，停止送出舊工作');
      }
    }
    if(post.approvedBy==='ai'&&(!store.kv('settings').topicAutoPublish||post.topicReview?.postHash!==post.reviewHash)) {
      throw new AppError('主題 AI 自動發文未啟用或審核版本已失效');
    }
    return post;
  };
  const checkpoint=(patch)=>{
    const sending=patch.phase==='sending';
    const next={...current,...patch,...(sending?{attemptedAt:new Date(now.getTime()+performance.now()-started).toISOString()}:{}),status:sending?'sending':current.status};
    const persist=()=>{
      if(sending)assertCurrent();
      if(!savePublication(store,next,current.status))throw new AppError('發佈工作已變更，停止送出舊工作');
    };
    if(sending)store.transaction(persist);
    else persist();
    current=next;
  };
  try {
    const post=assertCurrent();
    (deps.preflight||preflight)(store,post,job.channel);
    const images=await (deps.mediaForPlatform||mediaForPlatform)(store,post.mediaIds,job.channel);
    const credentials=store.transaction(()=>{
      assertCurrent();
      const keys=PLATFORM_KEYS[job.channel];
      const meta=job.channel==='facebook'||job.channel==='instagram';
      return Object.fromEntries((meta?[...keys,'FACEBOOK_APP_SECRET']:keys).map(key=>[key,store.secret(key)]));
    });
    const publishingStore={...store,secret:key=>credentials[key]??''};
    const result=await (deps.publishPost||publishPost)(publishingStore,post,job.channel,images,job.requestKey,checkpoint,deps);
    if(transitionPublication(store,{...current,status:'sent',phase:'completed',result,completedAt:new Date().toISOString()},current.status)) {
      store.event('info',`${post.title}：${job.channel==='line'?'LINE 已接受群發請求':job.channel+' 已發佈'}`);
    }
  }catch(error){const status=error.outcome==='unknown'||(current.phase==='sending'&&!error.outcome)?'unknown':error.code==='missed_slot'?'missed':'failed';
    const message=error instanceof AppError?error.message:'發佈程序未完成，請檢查主機與平台設定';
    if(transitionPublication(store,{...current,status,error:message},current.status)) {
      notify(store,`publication:${job.id}`,`貼文${status==='unknown'?'送出結果待核對':'發佈失敗'}：${message}`,now);
    }
  }
}
export async function publicationTick(store,now=new Date(),deps={}) {
  const settings=store.kv('settings');
  const last=store.kv('schedulerCursor',now.toISOString());
  const lower=new Date(Math.max(Date.parse(last),now.getTime()-7*86400000));
  if(settings.scheduleEnabled){for(const when of dueSlots(settings,lower,now)){const slot=createSlot(store,when,now);if(slot&&slot.status!=='processing')notify(store,`slot:${when}`,slot.message,now);}store.set('schedulerCursor',now.toISOString());}
  // Only stale claims from a dead worker are recovered; active workers hold a renewable lease.
  for(const job of store.list('publications').filter(j=>['preparing','sending'].includes(j.status)&&Date.parse(j.updatedAt)<now.getTime()-900000)){
    const status=job.phase==='sending'?'unknown':pastCatchUp(store,job,now.getTime())?'missed':'failed';
    if(transitionPublication(store,{...job,status,error:status==='missed'?'已超過補送期限，未送出':'上次程序中斷，請核對平台紀錄後處理'},job.status)) {
      notify(store,`publication:${job.id}`,'上次發文程序中斷，有貼文需要人工核對',now);
    }
  }
  const stuck=store.db.prepare("SELECT id,post_id FROM slots WHERE status='processing'").all();
  if(stuck.length)store.transaction(()=>{for(const slot of stuck)finalizePost(store,slot.post_id,slot.id);});
  const pending=store.list('publications').filter(j=>j.status==='pending');
  // Channels of one shared slot start together; each keeps its own durable outcome.
  const firstSlot=pending.sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0]?.slotId;
  await Promise.allSettled(pending.filter(j=>j.slotId===firstSlot).map(job=>processPublication(store,job,now,deps)));
}
export async function mailTick(store,now=new Date(),deps={}) {
  const settings=store.kv('settings'),{date,time}=localParts(now);
  for(const mail of store.list('outbox').filter(m=>m.status==='sending'&&Date.parse(m.startedAt||m.createdAt)<now.getTime()-300000))store.put('outbox',{...mail,status:'unknown',error:'上次寄送程序中斷，請核對郵件紀錄；系統不會自動重寄這封結果不明的信件'});
  if(time>=settings.digestTime&&store.kv('lastDigest')!==date){
    const drafts=store.list('posts').filter(p=>p.status==='draft'),backups=store.list('posts').filter(p=>p.status==='approved'&&p.backup&&(!p.expiresAt||Date.parse(p.expiresAt)>now.getTime()));
    if(drafts.length||backups.length<2)queueMail(store,`digest:${date}`,`[社群工作台] ${drafts.length} 篇待審・${backups.length} 篇有效備稿`,`${settings.unitName}\n待審草稿：${drafts.length} 篇\n有效備稿：${backups.length} 篇${backups.length<2?'，建議補充備稿':''}\n\n${drafts.slice(0,15).map(p=>`• ${p.title}`).join('\n')}\n\n登入處理：${process.env.PUBLIC_BASE_URL||'工作台'}`,now);
    store.set('lastDigest',date);
  }
  await (deps.sendMailQueue||sendMailQueue)(store,undefined,now);
}
export function createEngine(store,{interval=15000,deps={}}={}) {
  const owner=randomUUID(),running=new Map(),timers=[];
  const lanes={gather:gatherSources,draft:draftNext,publish:publicationTick,mail:mailTick};
  async function run(name) {
    if(running.has(name)||!store.lease(`worker:${name}`,owner,900000))return;
    const heartbeat=setInterval(()=>store.lease(`worker:${name}`,owner,900000),30000);heartbeat.unref();
    const task=(async()=>{try{await lanes[name](store,new Date(),deps);}catch(error){store.event('error',`${name} 背景工作未完成：${error instanceof AppError?error.message:'請檢查執行環境'}`);}finally{clearInterval(heartbeat);store.release(`worker:${name}`,owner);running.delete(name);}})();
    running.set(name,task);await task;
  }
  return {run,start(){for(const name of Object.keys(lanes)){void run(name);const timer=setInterval(()=>void run(name),interval);timer.unref();timers.push(timer);}},async stop(){timers.forEach(clearInterval);await Promise.allSettled([...running.values()]);}};
}
