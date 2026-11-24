import { cardPageInput } from './card-layout.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, contentHash, dueSlots, taipeiDate } from './core.mjs';
import { generateDraft, planTopicDraft, planTopicCards, reviewTopicDraft } from './ai.mjs';
import { searchArticles } from './codex-web.mjs';
import { channelStatus, approvalAccounts, matchesPublicationAccount } from './publish.mjs';
import { createCard, generateImage } from './media.mjs';
import { writeSlotBinding } from './engine.mjs';

const dayMs=86400000;

function materialsFor(store,topicId) {
  const links=store.db.prepare('SELECT kind,material_id AS id FROM topic_materials WHERE topic_id=? ORDER BY rowid').all(topicId);
  const articles=links.filter(link=>link.kind==='article').map(link=>store.get('articles',link.id)).filter(article=>article&&!article.archivedAt&&article.text?.trim());
  return {articles,mediaIds:links.filter(link=>link.kind==='media'&&store.get('media',link.id)).map(link=>link.id).slice(0,10)};
}

export function topicSlots(store,topic,now) {
  const start=new Date(`${topic.startDate}T00:00:00+08:00`);
  const end=new Date(`${topic.endDate}T23:59:59+08:00`);
  const from=new Date(Math.max(start.getTime()-1,now.getTime()));
  const reserved=new Set(store.db.prepare('SELECT slot_id FROM slot_bindings UNION SELECT id FROM slots').all().map(row=>row.slot_id));
  return dueSlots({...store.kv('settings'),scheduleEnabled:true},from,end)
    .filter(when=>!reserved.has(when)&&taipeiDate(new Date(when))<=topic.endDate).slice(0,60);
}

function enqueueTopics(store,now) {
  const topics=store.db.prepare('SELECT id,version FROM topics WHERE post_id IS NULL AND end_date>=?').all(taipeiDate(now));
  for(const topic of topics) {
    const id=`topic:${topic.id}:${topic.version}`;
    if(store.get('generation_jobs',id))continue;
    if(!materialsFor(store,topic.id).articles.length)continue;
    store.put('generation_jobs',{id,topicId:topic.id,topicVersion:topic.version,status:'pending',stage:'sources',createdAt:now.toISOString()});
  }
  if(!store.kv('settings').topicAutoPublish)return;
  const reviewed=store.db.prepare(`SELECT t.id,t.start_date AS startDate,t.end_date AS endDate,t.post_id FROM topics t
    JOIN posts p ON p.id=t.post_id LEFT JOIN slot_bindings b ON b.post_id=t.post_id
    WHERE b.post_id IS NULL AND t.end_date>=? AND json_extract(p.data,'$.topicReview.verdict')='pass'`).all(taipeiDate(now));
  for(const topic of reviewed) {
    const post=store.get('posts',topic.post_id);
    if(post.status!=='draft'||post.topicDraftLocked||post.topicNeedsReview||post.topicReview.postHash!==contentHash(post))continue;
    let slots=topicSlots(store,topic,now);
    if(post.expiresAt)slots=slots.filter(when=>Date.parse(when)<Date.parse(post.expiresAt));
    const job=store.get('generation_jobs',post.topicDraftJobId);
    if(!job||job.postId!==post.id)continue;
    const when=slots.includes(job.plan.when)?job.plan.when:slots[0];
    const settings=store.kv('settings'),connections=channelStatus(store);
    if(!when||!post.channels.some(channel=>connections[channel].ready&&settings.channels.includes(channel)))continue;
    const item={...post,status:'approved',reviewHash:post.topicReview.postHash,approvalAccounts:approvalAccounts(store,post.channels),approvedAt:now.toISOString(),approvedBy:'ai'};
    store.db.prepare('UPDATE posts SET version=version+1,data=? WHERE id=?').run(JSON.stringify(item),post.id);
    writeSlotBinding(store,post.id,{when,version:post.version+1,revision:null},now);
  }
  const bound=store.db.prepare(`SELECT t.id,t.version,t.post_id,b.slot_id,b.revision FROM topics t
    JOIN slot_bindings b ON b.post_id=t.post_id WHERE b.slot_id>? AND b.slot_id<=?`)
    .all(new Date(now.getTime()+dayMs).toISOString(),new Date(now.getTime()+2*dayMs).toISOString());
  for(const topic of bound) {
    const post=store.get('posts',topic.post_id);
    const previous=post?.topicDraftJobId&&store.get('generation_jobs',post.topicDraftJobId);
    if(!previous||(!post.topicNeedsReview&&(previous.basePostId||!previous.plan?.query)))continue;
    if(refreshable(store,post))enqueueRefresh(store,topic,post,now);
  }
}

function refreshable(store,post) {
  return post&&!post.topicDraftLocked&&['draft','approved'].includes(post.status)&&
    !store.db.prepare('SELECT 1 FROM publications WHERE post_id=?').get(post.id);
}

function enqueueRefresh(store,topic,post,now) {
  const id=`topic:${topic.id}:${topic.version}:${post.version}:${topic.revision}`;
  const existing=store.get('generation_jobs',id);
  if(existing)return existing;
  const job={id,topicId:topic.id,topicVersion:topic.version,basePostId:post.id,baseVersion:post.version,
    bindingRevision:topic.revision,targetSlot:topic.slot_id,status:'pending',stage:'sources',createdAt:now.toISOString()};
  store.put('generation_jobs',job);
  return job;
}

export function requestTopicRefresh(store,topicId,now=new Date()) {
  return store.transaction(()=>{
    const topic=store.db.prepare(`SELECT t.id,t.version,t.post_id,b.slot_id,b.revision FROM topics t
      JOIN slot_bindings b ON b.post_id=t.post_id WHERE t.id=?`).get(topicId);
    const post=topic&&store.get('posts',topic.post_id);
    const settings=store.kv('settings');
    if(!settings.aiEnabled||!settings.topicAutoPublish||store.kv('aiPaused'))throw new AppError('請先啟用 AI 產稿與主題自動發文',409);
    if(!topic||!refreshable(store,post))throw new AppError('此主題目前無法換稿，請確認發文時段及鎖稿狀態',409);
    if(Date.parse(topic.slot_id)-now.getTime()<=dayMs)throw new AppError('已到發文前 24 小時的換稿截止時間',409);
    return enqueueRefresh(store,topic,post,now);
  });
}

export function setTopicDraftLock(store,topicId,locked,version) {
  return store.transaction(()=>{
    const topic=store.db.prepare('SELECT post_id FROM topics WHERE id=?').get(topicId);
    const post=topic?.post_id&&store.get('posts',topic.post_id);
    if(!post||!['approved','draft'].includes(post.status)||post.version!==version)throw new AppError('稿件狀態已更新，請重新載入',409);
    if(Boolean(post.topicDraftLocked)!==locked) {
      const item={...post,topicDraftLocked:locked};
      store.db.prepare('UPDATE posts SET data=?,version=version+1 WHERE id=?').run(JSON.stringify(item),post.id);
    }
    return {ok:true};
  });
}

function claimTopicJob(store,now) {
  return store.transaction(()=>{
    enqueueTopics(store,now);
    // A new worker can reclaim a running stage only after the draft lane lease expires.
    const rows=store.db.prepare(`SELECT jobs.data,topics.title,topics.start_date,topics.end_date,topics.version,topics.post_id
      FROM generation_jobs jobs JOIN topics ON topics.id=json_extract(jobs.data,'$.topicId')
      WHERE jobs.status IN ('pending','running') ORDER BY jobs.rowid`).all();
    for(const row of rows) {
      const prior=JSON.parse(row.data);
      if(row.end_date<taipeiDate(now)||!jobMatches(store,prior,row)||
        (prior.targetSlot&&Date.parse(prior.targetSlot)-now.getTime()<=(prior.refreshStartedAt?0:dayMs))) {
        store.put('generation_jobs',{...prior,status:'cancelled',error:'主題或時段已變更、已鎖稿或已超過備稿期限'});
        continue;
      }
      const job={...prior,status:'running',attempt:randomUUID(),startedAt:now.toISOString()};
      if(job.targetSlot&&!job.refreshStartedAt)job.refreshStartedAt=now.toISOString();
      store.put('generation_jobs',job);
      return {job,topic:{id:job.topicId,title:row.title,startDate:row.start_date,endDate:row.end_date}};
    }
    return null;
  });
}

function jobMatches(store,job,topic) {
  if(!topic||topic.version!==job.topicVersion||(topic.post_id??null)!==(job.basePostId??null))return false;
  if(!job.basePostId)return true;
  const post=store.get('posts',job.basePostId);
  const binding=store.db.prepare('SELECT revision FROM slot_bindings WHERE post_id=?').get(job.basePostId);
  return store.kv('settings').topicAutoPublish&&refreshable(store,post)&&post.version===job.baseVersion&&binding?.revision===job.bindingRevision;
}

function saveStage(store,job,patch,attach) {
  return store.transaction(()=>{
    const current=store.get('generation_jobs',job.id);
    if(current?.attempt!==job.attempt||current.status!=='running')return false;
    const topic=store.db.prepare('SELECT version,post_id FROM topics WHERE id=?').get(job.topicId);
    if(!jobMatches(store,job,topic)) {
      store.put('generation_jobs',{...current,status:'cancelled'});
      return false;
    }
    const next={...current,status:'pending',error:'',...patch};
    if(attach)attach(next);
    store.put('generation_jobs',next);
    return true;
  });
}

const snapshot=(article,kind,now)=>({kind,id:article.id||randomUUID(),title:article.title,text:article.text.slice(0,12000),
  url:article.url||'',publishedAt:article.publishedAt||'',capturedAt:now.toISOString(),extraction:article.extraction,excerpts:article.excerpts});

async function searchSources(store,query,now,deps,materials=[]) {
  if(!query)return {webSources:[],searchNote:store.kv('settings').topicResearchEnabled?'無法產生可公開的搜尋詞，未執行搜尋；已使用主題素材。':''};
  if(!/^[\p{L}\p{N} \u3000-]+$/u.test(query))return {webSources:[],searchNote:'查詢含不適合傳送的字元，已使用主題素材。'};
  const terms=query.trim().split(/\s+/).filter(term=>!/^(?:20\d{2}|最新消息|近期新聞|新聞|時事|熱梗)$/u.test(term));
  const queries=[...new Set([query,...(store.kv('settings').topicResearchEnabled?[terms.slice(-2).join(' '),terms.at(-1)]:[])].filter(Boolean))];
  const preferredSite=materials.some(item=>URL.canParse(item.url)&&new URL(item.url).hostname==='bulletin.dyu.edu.tw')?'bulletin.dyu.edu.tw':'';
  try{
    const sources=await (deps.searchArticles||searchArticles)({queries,kind:'news',preferredSite,max:3,
      since:taipeiDate(new Date(now.getTime()-90*dayMs))},{runner:deps.runner});
    const webSources=sources.filter(source=>!materials.some(material=>material.url===source.url)).map(source=>snapshot(source,'web',now));
    return {webSources,searchAttempts:[{query:queries.join(' / '),provider:'Codex Web Search',results:sources.length,readable:webSources.length}],
      searchNote:webSources.length?'公開來源已透過 Codex Web Search 擷取。':'Codex Web Search 未取得可閱讀的公開來源，已使用主題素材。'};
  }catch{
    return {webSources:[],searchNote:'Codex Web Search 暫時無法使用，已使用主題素材。'};
  }
}

export function checkEvidence(review,sources) {
  const rejected=[];
  const facts=review.facts.flatMap(fact=>{
    const source=sources.find(item=>item.id===fact.sourceId);
    if(!source||!fact.quote.trim()){rejected.push(fact);return [];}
    const original=source.extraction==='codex_web_search'?(source.excerpts||[]).join('\n'):source.text;
    const offset=original.indexOf(fact.quote);
    const sourcePart=offset>=0?'text':source.url===fact.quote?'url':source.title===fact.quote?'title':null;
    if(!sourcePart){rejected.push(fact);return [];}
    return [{...fact,offset,sourcePart}];
  });
  if(review.verdict==='pass'&&(!facts.length||facts.length!==review.facts.length)) {
    const detail=rejected.slice(0,8).map(fact=>`事實「${fact.field.slice(0,120)}」，來源 ${fact.sourceId}，無法核對引文「${fact.quote.slice(0,200)}」`).join('；');
    return {verdict:'revise',reason:`部分關鍵事實無法對照已保存的原文。${detail||'審核未提供可核對的事實。'}請依素材重新核對，刪除或改寫無法支持的說法，不得虛構引文。`,facts};
  }
  return {...review,facts};
}

function completeDraft(store,job,topic,next,now) {
  const settings=store.kv('settings'),connections=channelStatus(store);
  const base=job.basePostId&&store.get('posts',job.basePostId);
  const sources=[...job.sources,...job.webSources];
  const channels=(base?.channels||settings.channels).filter(channel=>settings.channels.includes(channel)&&connections[channel].ready&&(channel!=='instagram'||job.mediaIds.length));
  const slots=job.targetSlot?[job.targetSlot]:topicSlots(store,topic,now);
  const when=slots.includes(job.plan.when)?job.plan.when:slots[0]||'';
  const passed=job.review.verdict==='pass';
  const accountChanged=base?.approvalAccounts&&channels.some(channel=>!matchesPublicationAccount(store,channel,base.approvalAccounts[channel]));
  if(base&&(!passed||accountChanged||Date.parse(when)<=now.getTime()||!channels.length||store.get('slots',when)||
      (base.expiresAt&&Date.parse(base.expiresAt)<=Date.parse(when))||
      !dueSlots({...settings,scheduleEnabled:true},new Date(Date.parse(when)-1),new Date(when)).includes(when))) {
    if(job.review.verdict==='conflict')stopTopicPost(store,base);
    next.postId=base.id;
    next.error=!passed?job.review.reason:accountChanged?'發佈帳號已變更，請核對目的地後重新核准':'新版未能在原時段排入，已保留目前稿件';
    return;
  }
  const post={...job.candidate,id:base?.id||randomUUID(),sourceId:job.sources[0].id,topicDraftJobId:job.id,category:base?.category||'其他',
    mediaIds:job.mediaIds,channels,status:'draft',backup:false,expiresAt:base?.expiresAt||'',reviewHash:'',
    queueOrder:base?.queueOrder??now.getTime(),createdAt:base?.createdAt||now.toISOString(),updatedAt:now.toISOString(),
    topicReview:{...job.review,sourceHash:createHash('sha256').update(JSON.stringify(sources)).digest('hex'),at:now.toISOString()}};
  const auto=settings.topicAutoPublish&&passed&&!!when&&channels.length>0;
  post.topicReview.postHash=contentHash(post);
  if(auto) {
    post.status='approved';post.reviewHash=contentHash(post);post.approvalAccounts=approvalAccounts(store,channels);post.approvedAt=now.toISOString();post.approvedBy='ai';
  }
  if(base)store.db.prepare('UPDATE posts SET version=version+1,data=? WHERE id=?').run(JSON.stringify(post),post.id);
  else store.db.prepare('INSERT INTO posts VALUES (?,1,?)').run(post.id,JSON.stringify(post));
  if(auto)writeSlotBinding(store,post.id,{when,version:base?base.version+1:1,revision:job.bindingRevision??null},now);
  store.db.prepare('UPDATE topics SET post_id=?,version=version+1 WHERE id=?').run(post.id,topic.id);
  next.plan={...job.plan,when};
  next.postId=post.id;
  if(base&&auto)next.replacementReason=job.revisionReason||`新版通過審核：${job.review.reason}`;
}

export function stopTopicPost(store,post) {
  if(!post?.topicDraftJobId||!['draft','approved','publishing','attention'].includes(post.status))return;
  const item={...post,status:post.status==='approved'?'draft':post.status,reviewHash:'',topicNeedsReview:true};
  store.db.prepare('UPDATE posts SET version=version+1,data=? WHERE id=?').run(JSON.stringify(item),post.id);
}

export function invalidateTopicDraft(store,topicId,now=new Date()) {
  const topic=store.db.prepare(`SELECT t.id,t.version,t.post_id,b.slot_id,b.revision FROM topics t
    LEFT JOIN slot_bindings b ON b.post_id=t.post_id WHERE t.id=?`).get(topicId);
  const post=topic?.post_id&&store.get('posts',topic.post_id);
  stopTopicPost(store,post);
  if(!post?.topicDraftJobId||!topic.slot_id||Date.parse(topic.slot_id)-now.getTime()<=dayMs||!store.kv('settings').topicAutoPublish)return;
  const stopped=store.get('posts',post.id);
  if(!refreshable(store,stopped))return;
  enqueueRefresh(store,topic,stopped,now);
}

export async function draftTopicNext(store,now,deps={}) {
  const claimed=claimTopicJob(store,now);
  if(!claimed)return false;
  const {job,topic}=claimed;
  const started=performance.now();
  try {
    if(job.stage==='sources') {
      const {articles,mediaIds}=materialsFor(store,topic.id);
      if(!articles.length)throw new AppError('請先匯入可讀的文字或公開文章');
      saveStage(store,job,{stage:'plan',sources:articles.slice(0,8).map(article=>snapshot(article,'material',now)),mediaIds});
    } else if(job.stage==='plan') {
      const slots=job.targetSlot?[job.targetSlot]:topicSlots(store,topic,now);
      const plan=await (deps.planTopicDraft||planTopicDraft)(store,{topic,slots,sources:job.sources},deps);
      saveStage(store,job,{stage:'search',plan:{...plan,when:slots.includes(plan.when)?plan.when:slots[0]||''}});
    } else if(job.stage==='search') {
      saveStage(store,job,{stage:'draft',...await searchSources(store,job.plan.query,now,deps,job.sources)});
    } else if(job.stage==='draft') {
      const topicContext={topic,purpose:job.plan.purpose,angle:job.plan.angle,proposedSlot:job.plan.when,
        materials:job.sources,publicReferences:job.webSources,...(job.revisionReason&&job.candidate?{previousCandidate:job.candidate}:{})};
      const first=job.sources[0];
      const settings=store.kv('settings');
      const result=await (deps.generateDraft||generateDraft)(store,{...first,title:topic.title,topicContext},job.revisionReason||'',deps);
      const count=settings.autoArtwork==='manual'?1:(settings.topicCardCount||1);
      const cards=count>1?await (deps.planTopicCards||planTopicCards)(store,{topic,candidate:result,sources:[...job.sources,...job.webSources],count},deps):null;
      saveStage(store,job,{stage:'review',candidate:cards?{...result,cards}:result,provider:settings.aiProvider,model:settings.apiTextModel});
    } else if(job.stage==='review'||job.stage==='artwork') {
      const settings=store.kv('settings');
      if(job.provider!==settings.aiProvider||(job.provider==='openai'&&job.model!==settings.apiTextModel)) {
        saveStage(store,job,{stage:'draft'});
        return true;
      }
      let review=job.review;
      let mediaIds=job.mediaIds;
      if(job.stage==='review') {
        const sources=[...job.sources,...job.webSources];
        review=checkEvidence(await (deps.reviewTopicDraft||reviewTopicDraft)(store,{topic,purpose:job.plan.purpose,
          when:job.plan.when,candidate:job.candidate,sources},deps),sources);
        if(review.verdict==='revise'&&!job.revisionReason) {
          saveStage(store,job,{stage:'draft',revisionReason:review.reason});
          return true;
        }
        if(review.verdict==='pass'&&settings.autoArtwork!=='manual') {
          saveStage(store,job,{stage:'artwork',review});
          return true;
        }
      } else if(settings.autoArtwork!=='manual') {
        const {title,cardTitle,cardSummary,imagePrompt}=job.candidate;
        const aiArtwork=settings.autoArtwork==='ai';
        const prompt=[topic.title,settings.imageRules,imagePrompt].join('\n').slice(0,3000);
        const image=aiArtwork?await (deps.generateImage||generateImage)(store,prompt):null;
        const pages=job.candidate.cards||[{title:cardTitle||title.slice(0,25),summary:cardSummary||''}];
        const cards=[];
        for(const [index,page] of pages.entries()){
          const body=index>0&&page.layout!=='cover';
          const label=aiArtwork?`${settings.unitName}｜概念插畫`:settings.unitName;
          const mediaId=image?.id||(settings.autoArtwork==='source'?job.mediaIds[0]||'':'');
          const card=await (deps.createCard||createCard)(store,cardPageInput(page,{mediaId,label,body}));
          cards.push(card.id);
        }
        mediaIds=[...cards,...mediaIds].slice(0,10);
      }
      const completedAt=new Date(now.getTime()+Math.max(0,performance.now()-started));
      const saved=saveStage(store,job,{status:'completed',stage:'complete',review,mediaIds,completedAt:completedAt.toISOString()},
        next=>completeDraft(store,{...job,review,mediaIds},topic,next,completedAt));
      if(saved)store.set('aiVerified',{provider:settings.aiProvider,at:now.toISOString()});
    } else throw new AppError('無法辨識備稿階段');
  } catch(error) {
    const message=error instanceof AppError?error.message:'AI 主題備稿失敗，請檢查素材或模型設定';
    const paused=['ai_quota','ai_auth','ai_paused','ai_disabled'].includes(error.code);
    const saved=saveStage(store,job,{status:paused?'pending':'failed',error:message});
    if(saved&&['ai_quota','ai_auth'].includes(error.code))store.set('aiPaused',{reason:message,at:now.toISOString()});
  }
  return true;
}

export function retryTopicDraft(store,topicId) {
  return store.transaction(()=>{
    const topic=store.db.prepare('SELECT version,post_id FROM topics WHERE id=?').get(topicId);
    const job=topic&&store.get('generation_jobs',`topic:${topicId}:${topic.version}`);
    if(!job||job.status!=='failed'||topic.post_id)throw new AppError('目前沒有可重試的備稿工作',409);
    store.put('generation_jobs',{...job,status:'pending',error:''});
    return {ok:true};
  });
}
