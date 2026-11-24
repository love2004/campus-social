import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../store.mjs';
import {defaultSettings,contentHash} from '../core.mjs';
import {selectionCheck,articleExpiry,draftWindow,maintainArticles,draftCapacity,diversifyArticles} from '../automation.mjs';
import {gatherSources,draftNext,enqueueDraft,createSlot} from '../engine.mjs';
import {mediaForPlatform} from '../media.mjs';
import {assessArticle} from '../ai.mjs';
import {writeFile} from 'node:fs/promises';

const now=new Date('2026-11-06T00:30:05Z');
function fixture(t){
  const dir=mkdtempSync(path.join(os.tmpdir(),'campus-auto-test-')),store=openStore(dir);
  t.after(()=>{store.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'campus-auto-test-')));rmSync(dir,{recursive:true,force:true});});
  return store;
}
function article(id='source',patch={}){return {id,title:'國際合作與學習成果',text:'可核對的原文事實。'.repeat(60),url:'',mediaIds:[],imageUrls:[],status:'available',createdAt:now.toISOString(),publishedAt:'',category:'國際交流',...patch};}
const draft={title:'國際合作消息',variants:{facebook:'文案',instagram:'文案',threads:'文案',line:'文案'},cardTitle:'合作交流',cardSummary:'三項事實',imagePrompt:'主題插畫'};

test('general automatic selection spreads slots across sources and topics',()=>{
  const recent=article('recent',{title:'輝達 AI 晶片出口管制',url:'https://business.example/1',category:'科技'});
  const followup=article('followup',{title:'輝達 AI 晶片出口管制後續',url:'https://business.example/2',category:'科技'});
  const ecosystem=article('ecology',{title:'濕地生態與候鳥',url:'https://science.example/1',category:'生態'});
  const sports=article('sports',{title:'校園棒球國際交流',url:'https://sport.example/1',category:'體育'});
  assert.deepEqual(diversifyArticles([followup,ecosystem,sports],[recent],2).map(x=>x.id),['ecology','sports']);
  assert.deepEqual(diversifyArticles([followup],[recent],2).map(x=>x.id),['followup']);
});

test('general automatic drafts cite verified context and regenerate when a quote cannot be verified',async t=>{
  const store=fixture(t);
  store.set('settings',{...defaultSettings(),aiEnabled:true});
  const reference='https://news.example/context';
  for(const accepted of [true,false]){
    const source=article(String(accepted),{url:`https://source.example/${accepted}`});
    store.put('articles',source);
    store.set('scanRequested',true);
    await gatherSources(store,now);
    await draftNext(store,now,{
      planTopicDraft:async()=>({query:'校園 交流',angle:'新生視角',purpose:'說明'}),
      searchArticles:async ({kind})=>kind==='news'?[{title:'近期消息',url:reference,text:'可以查到的具體內容。'}]:[],
      generateDraft:async(_store,input)=>input.articleContext.publicReferences.length
        ?{...draft,variants:{...draft.variants,facebook:`延伸內容\n${reference}`}}:draft,
      reviewTopicDraft:async()=>({verdict:'pass',reason:'核對',facts:[
        {field:'公開背景',sourceId:'public-1',quote:accepted?'可以查到的具體內容。':'找不到的引文'},
      ]}),
    });
    const created=store.list('posts').find(post=>post.sourceId===source.id);
    assert.equal(created.articleResearch.status,accepted?'used':'discarded');
    assert.equal(created.variants.facebook.includes(reference),accepted);
  }
});

test('a general draft requires recent Taiwan popularity and an exact use in the Facebook prose',async t=>{
  const store=fixture(t);
  store.set('settings',{...defaultSettings(),aiEnabled:true,dailyDraftLimit:5});
  const url='https://dailyview.tw/popular/detail/example';
  const usageQuote='這句話把讀者遇到的情境帶入正題';
  const quote='這個梗用來形容遇到小挫折時的反應。';
  const popularityQuote='台灣社群已有多人翻拍，近一週聲量超過萬筆。';
  for(const scenario of ['valid','missing-prose','stale','missing-popularity','foreign']){
    const source=article(scenario,{url:`https://source.example/${scenario}`});
    const reference=scenario==='foreign'?'https://knowyourmeme.com/memes/example':url;
    store.put('articles',source);
    store.set('scanRequested',true);
    await gatherSources(store,now);
    await draftNext(store,now,{
      planTopicDraft:async()=>({query:'',angle:'讀者視角',purpose:'說明',memeQueries:['範例梗']}),
      searchArticles:async ({queries})=>{assert.equal(queries[0],'台灣 範例梗 網路梗');return [{title:'台灣社群流行語',url:reference,text:`${quote}\n${popularityQuote}`,
        publishedAt:scenario==='stale'?'2026-06-01T00:00:00Z':'2026-11-01T00:00:00Z'}];},
      generateDraft:async(_store,input)=>input.articleContext.publicReferences.length
        ?{...draft,variants:{...draft.variants,facebook:`${scenario==='missing-prose'?'只有一般內容':usageQuote}\n${reference}`}}:draft,
      reviewTopicDraft:async()=>({verdict:'pass',reason:'核對',meme:{name:'範例梗',sourceId:'meme-1',quote,usageQuote,popularityQuote},
        facts:[{field:'梗的用法',sourceId:'meme-1',quote},
          ...(scenario==='missing-popularity'?[]:[{field:'流傳證據',sourceId:'meme-1',quote:popularityQuote}])]}),
    });
    const post=store.list('posts').find(post=>post.sourceId===source.id);
    assert.equal(post.articleResearch.meme?.name,scenario==='valid'?'範例梗':undefined);
    assert.equal(post.variants.facebook.includes(reference),scenario==='valid');
  }
});

test('source age uses publication date or acquisition fallback and an earlier event deadline',()=>{
  const settings=defaultSettings();
  assert.equal(selectionCheck(article('a',{createdAt:'2026-09-01T00:00:00Z'}),settings,now).eligible,false);
  assert.equal(selectionCheck(article('a',{publishedAt:'2026-08-01T00:00:00Z'}),settings,now).eligible,false);
  assert.equal(articleExpiry(article('a',{assessment:{expiresAt:'2026-11-07T00:00:00Z'}}),settings),'2026-11-07T00:00:00.000Z');
  assert.equal(selectionCheck(article('a',{text:'只有標題'}),settings,now).eligible,false);
});

test('AI draft windows use Taipei time and discard windows older than fifteen minutes',()=>{
  const settings={...defaultSettings(),draftMode:'scheduled',draftWeekdays:[5],draftTimes:['08:30','15:00']};
  assert.equal(draftWindow(settings,'2026-11-06T00:29:50Z',now).due,true);
  assert.equal(draftWindow(settings,now.toISOString(),new Date('2026-11-06T00:30:20Z')).due,false);
  assert.equal(draftWindow(settings,'2026-11-06T00:00:00Z',new Date('2026-11-06T00:50:00Z')).due,false);
});

test('scheduled drafts dispatch independently of the two-hour source scan and respect daily cap',async t=>{
  const store=fixture(t);store.set('settings',{...defaultSettings(),aiEnabled:true,draftMode:'scheduled',draftWeekdays:[5],draftTimes:['08:30'],dailyDraftLimit:1});
  store.set('lastScan','2026-11-06T00:00:00Z');store.set('draftCursor','2026-11-06T00:29:50Z');
  store.put('articles',article('a'));store.put('articles',article('b'));
  await gatherSources(store,now,{discoverLinks:()=>{throw Error('Scan should not run');}});
  assert.equal(store.list('generation_jobs').length,1);
  assert.equal(draftCapacity(store.list('generation_jobs'),store.kv('settings'),now),0);
  await gatherSources(store,new Date('2026-11-06T00:30:20Z'));
  assert.equal(store.list('generation_jobs').length,1);
});

test('automatic archive preserves linked content and skips active generation jobs',t=>{
  const store=fixture(t);store.put('articles',article('old',{createdAt:'2026-01-01T00:00:00Z'}));
  store.put('articles',article('busy',{createdAt:'2026-01-01T00:00:00Z'}));enqueueDraft(store,'busy');
  maintainArticles(store,now);
  assert.ok(store.get('articles','old').archivedAt);
  assert.equal(store.get('articles','old').text,article().text);
  assert.ok(!store.get('articles','busy').archivedAt);
});

test('semantic rejection stores evidence and does not call drafting or artwork providers',async t=>{
  const store=fixture(t);store.set('settings',{...defaultSettings(),aiEnabled:true,aiSelectionEnabled:true,autoArtwork:'template'});store.put('articles',article());
  const job=enqueueDraft(store,'source');store.put('generation_jobs',{...job,automatic:true});
  let writes=0;await draftNext(store,now,{assessArticle:async()=>({eligible:false,score:20,category:'其他',reason:'只有文章列表標題，缺少原文事實',facts:[],expiresAt:''}),generateDraft:async()=>{writes++;return draft;}});
  assert.equal(writes,0);assert.equal(store.list('posts').length,0);
  assert.equal(store.list('generation_jobs')[0].status,'skipped');assert.match(store.get('articles','source').assessment.reason,/列表/);
});

test('automatic template produces a reviewable card, expiry and no selected disconnected platforms',async t=>{
  const store=fixture(t);store.set('settings',{...defaultSettings(),aiEnabled:true,autoArtwork:'template'});store.put('articles',article());
  const job=enqueueDraft(store,'source');store.put('generation_jobs',{...job,automatic:true});
  await draftNext(store,now,{generateDraft:async()=>draft});
  const post=store.list('posts')[0];assert.equal(post.status,'draft');assert.deepEqual(post.channels,[]);assert.ok(post.expiresAt);assert.equal(post.mediaIds.length,1);
  const media=store.get('media',post.mediaIds[0]);assert.equal(media.kind,'card');assert.equal(media.sourcePostId,post.id);
});

test('ordinary automatic drafts lay out 3–5 cards with a shared source or generated background',async t=>{
  for(const [count,mode] of [[3,'source'],[4,'ai'],[5,'template']]){
    const store=fixture(t);
    store.set('settings',{...defaultSettings(),aiEnabled:true,autoArtwork:mode,articleCardCount:count});
    store.put('media',{id:'source-photo'});
    store.put('articles',article('source',{mediaIds:['source-photo']}));
    store.set('scanRequested',true);
    await gatherSources(store,now);
    let generated=0;
    const recipes=[];
    await draftNext(store,now,{
      generateDraft:async()=>draft,
      planTopicCards:async(_store,options)=>{
        assert.equal(options.count,count);
        assert.equal(options.singleCover,true);
        return Array.from({length:count},(_,i)=>({layout:'cover',title:`標題 ${i}`,summary:`內文 ${i}`}));
      },
      generateImage:async()=>{generated++;return {id:'ai-background'};},
      createCard:async(_store,recipe)=>{recipes.push(recipe);return {id:`card-${recipes.length}`};},
    });
    const [post]=store.list('posts');
    assert.deepEqual(post.mediaIds,Array.from({length:count},(_,i)=>`card-${i+1}`));
    assert.deepEqual(store.get('articles','source').mediaIds,['source-photo']);
    assert.equal(generated,mode==='ai'?1:0);
    assert.equal(recipes[0].title,'標題 0');
    assert.equal(recipes[0].subtitle,'內文 0');
    assert.ok(recipes.every(recipe=>recipe.postId===post.id&&recipe.mediaId==={source:'source-photo',ai:'ai-background',template:''}[mode]));
    for(const [index,recipe] of recipes.slice(1).entries()){
      assert.equal(recipe.align,'center');
      assert.equal(recipe.titleX,50);
      assert.equal(recipe.title,`內文 ${index+1}`);
      assert.equal(recipe.subtitle,'');
    }
  }
});

test('missing image API leaves text draft for review and records artwork error',async t=>{
  const store=fixture(t);store.set('settings',{...defaultSettings(),aiEnabled:true,autoArtwork:'ai',imageEnabled:false});store.put('articles',article());
  const job=enqueueDraft(store,'source');store.put('generation_jobs',{...job,automatic:true});
  await draftNext(store,now,{generateDraft:async()=>draft});
  assert.equal(store.list('posts')[0].status,'draft');assert.match(store.list('posts')[0].artworkError,/生圖/);
});

test('scheduler only creates jobs for configured platforms and pure text needs no media host',async t=>{
  const store=fixture(t);store.setSecret('LINE_CHANNEL_TOKEN','fixture-line');
  const post={...draft,id:'approved',channels:['facebook','line'],mediaIds:[],sourceId:'',expiresAt:'',status:'approved',backup:false,queueOrder:1,createdAt:now.toISOString()};post.reviewHash=contentHash(post);
  store.db.prepare('INSERT INTO posts VALUES (?,1,?)').run(post.id,JSON.stringify(post));
  createSlot(store,now.toISOString(),now);assert.deepEqual(store.list('publications').map(p=>p.channel),['line']);
  assert.deepEqual(await mediaForPlatform(store,[],'line'),[]);
});

test('AI relevance gate enforces threshold, facts and expiry rather than trusting model eligible flag',async t=>{
  const store=fixture(t);store.set('settings',{...defaultSettings(),aiEnabled:true,aiSelectionEnabled:true});
  const result=await assessArticle(store,article(),now,{runner:async(args)=>{
    await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify({eligible:true,score:99,category:'校園新聞',reason:'資料看似可用',facts:['只有一項事實'],expiresAt:''}));
    return {code:0,stdout:'{"type":"turn.completed"}\n',stderr:''};
  }});
  assert.equal(result.eligible,false);
});
