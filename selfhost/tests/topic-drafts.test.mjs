import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../store.mjs';
import { contentHash } from '../core.mjs';
import { createSlot, draftNext, publicationTick } from '../engine.mjs';
import { linkTopicMaterial, listTopics, saveTopic } from '../topics.mjs';
import { requestTopicRefresh, setTopicDraftLock } from '../topic-drafts.mjs';
import { planTopicDraft } from '../ai.mjs';

const now=new Date('2026-11-16T01:00:00.000Z');
const first='2026-11-16T02:00:00.000Z', second='2026-11-18T02:00:00.000Z';
const dates={startDate:'2026-11-16',endDate:'2026-11-18'};
const content={title:'講座草稿',variants:{facebook:'活動文案',instagram:'活動文案',threads:'活動文案',line:'活動文案'},imagePrompt:'',cardTitle:'',cardSummary:''};
const review=async(_store,{sources})=>({verdict:'pass',reason:'內容符合素材',facts:[{field:'活動內容',sourceId:sources[0].id,quote:sources[0].text}]});

function fixture(t) {
  const root=path.resolve(os.tmpdir());
  const directory=mkdtempSync(path.join(root,'campus-topic-draft-'));
  let store=openStore(directory);
  store.set('settings',{...store.kv('settings'),aiEnabled:true,channels:['line']});
  store.setSecret('LINE_CHANNEL_TOKEN','fixture');
  t.after(()=>{
    store.close();
    if(path.dirname(directory)!==root||!path.basename(directory).startsWith('campus-topic-draft-'))throw new Error('Unsafe cleanup');
    rmSync(directory,{recursive:true,force:true});
  });
  const topic=saveTopic(store,null,{title:'校友講座',...dates},now);
  const article={id:'material',title:'活動簡章',text:'講座將分享職涯經驗與校友交流資訊，完整議程以此素材為準。',url:'',createdAt:now.toISOString()};
  store.put('articles',article);
  linkTopicMaterial(store,topic.id,'article',article);
  return {topic,article,get store(){return store;},reopen(){store.close();store=openStore(directory);}};
}

test('topic drafting resumes an interrupted search from saved sources and produces one previewable draft',async t=>{
  const f=fixture(t);
  let planned=0,searched=0,generated=0;
  const deps={
    reviewTopicDraft:review,
    planTopicDraft:async(_store,input)=>{
      planned++;
      assert.equal(input.sources[0].text,f.article.text);
      assert.deepEqual(input.slots,[first,second]);
      return {purpose:'活動通知',angle:'用校友故事開場',when:second,query:'公開職涯活動'};
    },
    searchArticles:async ({queries})=>{searched++;assert.equal(queries[0],'公開職涯活動');return [{title:'職涯報導',text:'公開報導原文片段',url:'https://example.org/career'}];},
    generateDraft:async(_store,{topicContext})=>{
      generated++;
      assert.equal(topicContext.proposedSlot,second);
      assert.equal(topicContext.materials[0].text,f.article.text);
      assert.equal(topicContext.publicReferences[0].text,'公開報導原文片段');
      return content;
    },
  };
  await draftNext(f.store,now,deps);
  await draftNext(f.store,now,deps);
  const saved=f.store.list('generation_jobs')[0];
  assert.equal(saved.stage,'search');
  f.store.put('generation_jobs',{...saved,status:'running',attempt:'crashed'});
  f.reopen();
  await draftNext(f.store,now,deps);
  assert.equal(f.store.get('generation_jobs',saved.id).stage,'draft');
  f.reopen();
  await draftNext(f.store,now,deps);
  await draftNext(f.store,now,deps);
  assert.deepEqual([planned,searched,generated],[1,1,1]);
  const [post]=f.store.list('posts');
  assert.equal(f.store.list('posts').length,1);
  assert.equal(post.status,'draft');
  const [topic]=listTopics(f.store);
  assert.equal(topic.postId,post.id);
  assert.equal(topic.draft.plan.when,second);
  assert.equal(topic.draft.status,'completed');
  assert.equal(f.store.get('generation_jobs',saved.id).webSources[0].url,'https://example.org/career');
  assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM slot_bindings').get().count,0);

  // A reviewed topic draft still needs a chosen slot; the general queue cannot pick it up.
  f.store.db.prepare('UPDATE posts SET data=? WHERE id=?').run(JSON.stringify({...post,status:'approved',reviewHash:contentHash(post)}),post.id);
  assert.equal(createSlot(f.store,first,new Date(first)).status,'skipped');
  saveTopic(f.store,topic.id,{...dates,title:topic.title,version:topic.version,schedule:{postId:post.id,when:second,version:1,revision:null}},now);
  assert.equal(createSlot(f.store,second,new Date(second)).postId,post.id);
});

test('editing a topic during inference discards the old result and the latest version can finish',async t=>{
  const f=fixture(t);
  let searched=0;
  const deps={reviewTopicDraft:review,planTopicDraft:async(_store,{topic})=>({purpose:'活動通知',angle:topic.title,when:'invalid',query:''}),
    searchArticles:async()=>{searched++;return [];},generateDraft:async()=>content};
  for(let step=0;step<3;step++)await draftNext(f.store,now,deps);
  const [oldJob]=f.store.list('generation_jobs');
  await draftNext(f.store,now,{...deps,generateDraft:async()=>{
    const [topic]=listTopics(f.store);
    saveTopic(f.store,topic.id,{...dates,title:'改過的講座',version:topic.version},now);
    return {...content,title:'不應出現的舊稿'};
  }});
  assert.equal(f.store.get('generation_jobs',oldJob.id).status,'cancelled');
  assert.equal(f.store.list('posts').length,0);
  for(let step=0;step<5;step++)await draftNext(f.store,now,deps);
  assert.equal(searched,0);
  assert.equal(f.store.list('posts').length,1);
  assert.equal(listTopics(f.store)[0].draft.plan.angle,'改過的講座');
  assert.equal(listTopics(f.store)[0].draft.plan.when,first);
});

test('a reviewed calendar draft includes its generated artwork when the slot publishes',async t=>{
  const f=fixture(t);
  f.store.set('settings',{...f.store.kv('settings'),scheduleEnabled:true,topicAutoPublish:true,autoArtwork:'ai',imageEnabled:true});
  const cardId='generated-card';
  const sent=[];
  const deps={
    planTopicDraft:async()=>({purpose:'活動通知',angle:'講座介紹',when:first,query:''}),
    generateDraft:async()=>({...content,imagePrompt:'校友交流插畫',cardTitle:'校友講座'}),
    reviewTopicDraft:review,
    generateImage:async()=>({id:'generated-background'}),
    createCard:async(store,{mediaId,title})=>{
      assert.equal(mediaId,'generated-background');
      assert.equal(title,'校友講座');
      return {id:cardId};
    },
    preflight:()=>{},
    mediaForPlatform:async(_store,ids)=>ids,
    publishPost:async(_store,post,_channel,images)=>{sent.push({text:post.variants.line,images});return {id:'published'};},
  };
  for(let step=0;step<5;step++)await draftNext(f.store,now,deps);
  f.reopen();
  await draftNext(f.store,now,deps);
  f.store.set('schedulerCursor',now.toISOString());
  await publicationTick(f.store,new Date(first),deps);
  assert.deepEqual(sent,[{text:'活動文案',images:[cardId]}]);
});

test('three planned cards are reviewed and generated in order with one shared background',async t=>{
  const f=fixture(t),pages=[{title:'背景',summary:'第一頁'},{title:'重點',summary:'第二頁'},{title:'行動',summary:'第三頁'}];
  f.store.set('settings',{...f.store.kv('settings'),autoArtwork:'ai',imageEnabled:true,topicCardCount:3});
  const deps={planTopicDraft:async()=>({purpose:'資訊',angle:'說明',when:second,query:''}),generateDraft:async()=>content,
    planTopicCards:async(_store,{count})=>{assert.equal(count,3);return pages;},
    reviewTopicDraft:async(_store,{candidate,sources})=>{assert.deepEqual(candidate.cards,pages);return review(_store,{sources});},
    generateImage:async()=>({id:'background'}),createCard:async(_store,input)=>{assert.equal(input.mediaId,'background');if(input.title!=='背景'){assert.equal(input.align,'center');assert.equal(input.subtitle,'');}return {id:input.title};}};
  for(let step=0;step<6;step++)await draftNext(f.store,now,deps);
  assert.deepEqual(f.store.list('posts')[0].mediaIds,['背景','第二頁','第三頁']);
});

test('requested public research generates a search query even when the first plan is blank',async t=>{
  const f=fixture(t);f.store.set('settings',{...f.store.kv('settings'),aiProvider:'openai',topicResearchEnabled:true});let calls=0;
  const reply=value=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]});
  const apiRequest=async(_s,payload)=>{calls++;assert.match(payload.input,/搜尋/);return reply({purpose:'資訊分享',angle:'校園永續',when:second,query:calls===1?'':'校園 永續'});};
  const result=await planTopicDraft(f.store,{topic:f.topic,slots:[second],sources:[]},{apiRequest});
  assert.equal(result.query,'校園 永續');assert.equal(calls,2);
});

test('active topic search includes broader variants in the Codex search',async t=>{
  const f=fixture(t),queries=[];
  f.store.set('settings',{...f.store.kv('settings'),topicResearchEnabled:true});
  const deps={
    planTopicDraft:async()=>({purpose:'資訊',angle:'說明',when:second,query:'2026 大學 永續校園 水資源 最新消息'}),
    searchArticles:async request=>{queries.push(...request.queries);return [{title:'水資源報導',text:'可供核對的公開報導原文',url:'https://example.org/water'}];},
  };
  for(let step=0;step<3;step++)await draftNext(f.store,now,deps);
  const [job]=f.store.list('generation_jobs');
  assert.deepEqual(queries,['2026 大學 永續校園 水資源 最新消息','永續校園 水資源','水資源']);
  assert.equal(job.webSources[0].url,'https://example.org/water');
  assert.deepEqual(job.searchAttempts.map(attempt=>attempt.readable),[1]);
});

async function readyTopic(f) {
  f.store.set('settings',{...f.store.kv('settings'),topicAutoPublish:true,scheduleEnabled:true});
  const make=(title,text)=>({...content,title,variants:{...content.variants,line:text}});
  const deps={planTopicDraft:async()=>({purpose:'活動通知',angle:'校友經驗',when:second,query:''}),
    generateDraft:async()=>make('原稿','原稿文案'),reviewTopicDraft:review};
  for(let step=0;step<5;step++)await draftNext(f.store,now,deps);
  return {deps,make,post:f.store.list('posts')[0],slot:new Date(second),
    early:new Date('2026-11-17T01:59:00.000Z'),cutoff:new Date('2026-11-17T02:00:00.000Z')};
}

async function publishAtSlot(f,slot) {
  const sent=[];
  f.store.set('schedulerCursor',new Date(slot.getTime()-1000).toISOString());
  await publicationTick(f.store,slot,{fetchFn:async(_url,options)=>{
    sent.push(JSON.parse(options.body).messages[0].text);
    return new Response('{}');
  }});
  return sent;
}

test('independent review binds substantiated copy, and a refresh started before cutoff can replace it after cutoff',async t=>{
  const f=fixture(t),{deps,make,post,slot,early,cutoff}=await readyTopic(f);
  assert.equal(post.approvedBy,'ai');
  assert.equal(post.topicReview.facts[0].offset,0);
  assert.equal(f.store.db.prepare('SELECT slot_id FROM slot_bindings').get().slot_id,second);
  assert.equal(createSlot(f.store,second,early),null);
  assert.throws(()=>requestTopicRefresh(f.store,f.topic.id,cutoff),/24 小時/);
  const job=requestTopicRefresh(f.store,f.topic.id,early);
  await draftNext(f.store,early,deps);
  const replacement={...deps,generateDraft:async()=>make('新版','新版文案')};
  for(let step=0;step<4;step++)await draftNext(f.store,cutoff,replacement);
  assert.equal(f.store.get('posts',post.id).title,'新版');
  assert.match(f.store.get('generation_jobs',job.id).replacementReason,/通過審核/);
  assert.deepEqual(await publishAtSlot(f,slot),['新版文案']);
  await publicationTick(f.store,slot,{fetchFn:async()=>assert.fail('duplicate publish')});
});

test('an unfinished refresh falls back to the effective original at the due slot',async t=>{
  const f=fixture(t),{deps,make,post,slot,early}=await readyTopic(f);
  const job=requestTopicRefresh(f.store,f.topic.id,early);
  for(let step=0;step<4;step++)await draftNext(f.store,early,{...deps,generateDraft:async()=>make('未審新版','不應發佈')});
  assert.equal(f.store.get('generation_jobs',job.id).stage,'review');
  assert.deepEqual(await publishAtSlot(f,slot),['原稿文案']);
  await draftNext(f.store,slot,deps);
  assert.equal(f.store.get('posts',post.id).title,'原稿');
});

test('manual lock holds the original, but changed key materials still prevent its publication',async t=>{
  const f=fixture(t),{deps,make,post,slot,early}=await readyTopic(f);
  const job=requestTopicRefresh(f.store,f.topic.id,early);
  for(let step=0;step<4;step++)await draftNext(f.store,early,{...deps,generateDraft:async()=>make('候選稿','不應發佈')});
  await draftNext(f.store,early,{...deps,reviewTopicDraft:async(...args)=>{
    setTopicDraftLock(f.store,f.topic.id,true,post.version);
    return review(...args);
  }});
  assert.equal(f.store.get('generation_jobs',job.id).status,'cancelled');
  assert.equal(f.store.get('posts',post.id).title,'原稿');
  assert.throws(()=>requestTopicRefresh(f.store,f.topic.id,early),/鎖稿/);
  const correction={...f.article,id:'correction',text:'講座時間與地點有變，請以新公告為準。'};
  f.store.put('articles',correction);linkTopicMaterial(f.store,f.topic.id,'article',correction);
  assert.equal(f.store.get('posts',post.id).topicNeedsReview,true);
  assert.deepEqual(await publishAtSlot(f,slot),[]);
});

test('a locked original still publishes at its slot when its information remains valid',async t=>{
  const f=fixture(t),{post,slot,early}=await readyTopic(f);
  setTopicDraftLock(f.store,f.topic.id,true,post.version);
  assert.throws(()=>requestTopicRefresh(f.store,f.topic.id,early),/鎖稿/);
  assert.deepEqual(await publishAtSlot(f,slot),['原稿文案']);
});

test('enabling topic autopublish schedules a previously reviewed unedited draft',async t=>{
  const f=fixture(t);
  const deps={planTopicDraft:async()=>({purpose:'活動通知',angle:'校友經驗',when:second,query:''}),
    generateDraft:async()=>content,reviewTopicDraft:review};
  for(let step=0;step<5;step++)await draftNext(f.store,now,deps);
  const [post]=f.store.list('posts');
  assert.equal(post.status,'draft');
  f.store.set('settings',{...f.store.kv('settings'),topicAutoPublish:true});
  await draftNext(f.store,now,deps);
  assert.equal(f.store.get('posts',post.id).approvedBy,'ai');
  assert.equal(f.store.db.prepare('SELECT slot_id FROM slot_bindings').get().slot_id,second);
});

test('an unsupported quote cannot auto-approve a draft, even after one rewrite',async t=>{
  const f=fixture(t);
  f.store.set('settings',{...f.store.kv('settings'),topicAutoPublish:true});
  let generated=0,reviews=0;
  const deps={planTopicDraft:async()=>({purpose:'活動通知',angle:'介紹活動',when:second,query:''}),
    generateDraft:async()=>{generated++;return content;},reviewTopicDraft:async()=>{
      reviews++;return {verdict:'pass',reason:'看似通過',facts:[{field:'時間',sourceId:f.article.id,quote:'不存在的日期'}]};
    }};
  for(let step=0;step<8;step++)await draftNext(f.store,now,deps);
  const [post]=f.store.list('posts');
  assert.deepEqual([generated,reviews],[2,2]);
  assert.equal(post.status,'draft');
  assert.equal(post.topicReview.verdict,'revise');
  assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM slot_bindings').get().count,0);
});

test('a failed evidence check tells the rewrite which claim and quotation could not be verified',async t=>{
  const f=fixture(t);
  let count=0,feedback='';
  const deps={planTopicDraft:async()=>({purpose:'知識分享',angle:'說明氣候',when:second,query:''}),
    generateDraft:async(_store,article,brief)=>{if(++count===2){feedback=brief;assert.deepEqual(article.topicContext.previousCandidate,content);}return content;},
    reviewTopicDraft:async()=>({verdict:'pass',reason:'核對完成',facts:[{field:'地球散熱機制',sourceId:f.article.id,quote:'不存在的原文片段'}]})};
  for(let step=0;step<7;step++)await draftNext(f.store,now,deps);
  assert.match(feedback,/地球散熱機制/);
  assert.match(feedback,/不存在的原文片段/);
});

test('source titles are valid evidence while unsupported quotations remain blocked',async t=>{
  const f=fixture(t);
  const deps={planTopicDraft:async()=>({purpose:'知識分享',angle:'介紹',when:second,query:''}),generateDraft:async()=>content,
    reviewTopicDraft:async()=>({verdict:'pass',reason:'來源名稱正確',facts:[{field:'來源名稱',sourceId:f.article.id,quote:f.article.title}]})};
  for(let step=0;step<5;step++)await draftNext(f.store,now,deps);
  assert.equal(f.store.list('posts')[0].topicReview.verdict,'pass');
});
