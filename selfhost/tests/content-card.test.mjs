import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {openStore} from '../store.mjs';
import {defaultSettings,settingsInput} from '../core.mjs';
import {captionLength,captionIssues} from '../content.mjs';
import {cardPreset,cardLayout,cardOverlay,cropPlacement,wrapCardText} from '../card-layout.mjs';
import {generateDraft,reconcileTopicReviews} from '../ai.mjs';
import {saveImage,createCard,generateImage} from '../media.mjs';

function fixture(t){const dir=mkdtempSync(path.join(os.tmpdir(),'campus-card-test-')),s=openStore(dir);t.after(()=>{s.close();if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'campus-card-test-'))throw new Error('Unsafe cleanup');rmSync(dir,{recursive:true,force:true});});return s;}
const variants=text=>Object.fromEntries(['facebook','instagram','threads','line'].map(p=>[p,text]));
test('independent reviewers must both pass and any conflict prevents approval',()=>{
  const pass={verdict:'pass',reason:'有來源',facts:[{field:'日期',sourceId:'a',quote:'原文'}]};
  assert.equal(reconcileTopicReviews(pass,pass).verdict,'pass');
  assert.equal(reconcileTopicReviews(pass,{verdict:'revise',reason:'來源不足',facts:[]}).verdict,'revise');
  assert.equal(reconcileTopicReviews(pass,{verdict:'conflict',reason:'資料衝突',facts:[]}).verdict,'conflict');
});
test('card wrapping keeps common words and dates together without starting a line with punctuation',()=>{
  for(const value of ['今天開放免費報名','活動日期為12月5日上午','請至官網查詢客服。']){
    const lines=wrapCardText(value,8);
    assert.equal(lines.join(''),value);
    assert.ok(!lines.slice(1).some(line=>/^[，。！？、）]/.test(line)));
    assert.ok(!lines.some((line,i)=>i<lines.length-1&&/報$|客$|12月$/.test(line)));
  }
  const nature=wrapCardText('雌蟲從葉尖捲起，產卵後封住葉捲下端。幼蟲在葉捲裡取食、長大和化蛹，成蟲才離開。',32.4);
  assert.ok(!nature.some((line,i)=>i<nature.length-1&&line.endsWith('化')&&nature[i+1].startsWith('蛹')));
  assert.deepEqual(wrapCardText('在校園學習人工智慧',7),['在校園學習','人工智慧']);
  assert.deepEqual(wrapCardText('來自世界各地 11 國學生',8),['來自世界各地','11 國學生']);
});
test('body counts exclude URLs, whitespace and standalone hashtags, include punctuation and whole emoji',()=>{
  assert.equal(captionLength('資訊 彙整。\n重點🌿 https://example.org/detail?q=1\n#校園生活 #AI'),8);
  assert.equal(captionIssues(variants('學'.repeat(250)),defaultSettings()).length,0);
  assert.equal(captionIssues(variants('學'.repeat(199)),defaultSettings()).length,4);
  assert.equal(settingsInput.safeParse({...defaultSettings(),captionMinChars:301,captionMaxChars:200}).success,false);
});
test('out of range drafts get one semantic revision on the SAME provider without slicing facts or paid fallback',async t=>{
  const s=fixture(t);s.set('settings',{...defaultSettings(),aiEnabled:true,aiProvider:'codex'});let calls=0,paid=0,revision='';
  const result=await generateDraft(s,{title:'可靠原文',text:'原文資訊'.repeat(100)},'',{codexDraft:async(_a,_s,brief)=>{calls++;revision=brief;return {title:'彙整',variants:variants('學'.repeat(calls===1?180:250)),imagePrompt:'無字主題配圖',cardTitle:'主題',cardSummary:'重點'};},apiRequest:async()=>{paid++;}});
  assert.equal(calls,2);assert.equal(paid,0);assert.match(revision,/180字/);assert.equal(result.variants.facebook.length,250);
});
test('a source that cannot support the requested length fails clearly instead of padding or silently truncating',async t=>{
  const s=fixture(t);s.set('settings',{...defaultSettings(),aiEnabled:true});let calls=0;
  await assert.rejects(generateDraft(s,{title:'短原文',text:'很短'},'',{codexDraft:async()=>{calls++;return {title:'原標題',variants:variants('資訊不足'),imagePrompt:''};}}),e=>e.code==='ai_length');assert.equal(calls,2);
});
test('card preview and export share explicit line breaks, escaped text, overflow checks and crop geometry',()=>{
  const r={...cardPreset('photo','portrait'),title:'第一行\n第二行',subtitle:'完整保留摘要',label:'單位'};
  assert.deepEqual(cardLayout(r).layers.find(l=>l.key==='title').lines,['第一行','第二行']);
  const svg=cardOverlay({...r,title:'<script>測試</script>'});assert.ok(!svg.includes('<script>'));assert.match(svg,/&lt;/);assert.ok(!svg.includes('data-layer'));
  assert.match(cardOverlay(r,{interactive:true}),/data-layer="title"/);
  assert.ok(cardLayout({...r,titleY:95}).warnings.length>0);
  assert.deepEqual(cropPlacement(1600,900,1080,1080,1,50,50),{width:1920,height:1080,left:420,top:0});
});
test('edited card exports new media with a reusable recipe while preserving original photo and prior export',async t=>{
  const s=fixture(t),photo=await saveImage(s,await sharp({create:{width:700,height:400,channels:3,background:'#98b78b'}}).png().toBuffer(),'原始照片');
  const first=await createCard(s,{mediaId:photo.id,title:'主題資訊卡',subtitle:'來源重點摘要',format:'portrait',postId:'p'});
  assert.equal(first.width,1080);assert.equal(first.height,1350);assert.equal(first.cardRecipe.mediaId,photo.id);assert.equal(first.sourcePostId,'p');
  const before=readFileSync(path.join(s.directory,'media',`${first.id}.jpg`));
  const second=await createCard(s,{...first.cardRecipe,title:'修改後的文字',titleX:12,titleSize:55});
  assert.notEqual(second.id,first.id);assert.deepEqual(readFileSync(path.join(s.directory,'media',`${first.id}.jpg`)),before);assert.equal(second.cardRecipe.mediaId,photo.id);
  await assert.rejects(createCard(s,{...second.cardRecipe,titleY:95}),/超出畫布/);
});
test('topic image requests are grounded in their post and stored with topic association, never add typography',async t=>{
  const s=fixture(t);s.set('settings',{...defaultSettings(),imageEnabled:true,imageProvider:'openai'});s.setSecret('OPENAI_API_KEY','fixture-not-real');
  const p={id:'running',title:'路跑與健康關懷',cardSummary:'運動、關懷、友善職場',variants:variants('來源內容')};s.db.prepare('INSERT INTO posts VALUES (?,1,?)').run(p.id,JSON.stringify(p));
  const image=await sharp({create:{width:100,height:100,channels:3,background:'#24634b'}}).jpeg().toBuffer();let payload;
  const media=await generateImage(s,'慢跑概念插畫',{postId:p.id,fetchFn:async(_url,init)=>{payload=JSON.parse(init.body);return new Response(JSON.stringify({data:[{b64_json:image.toString('base64')}]}),{status:200});}});
  assert.match(payload.prompt,/路跑與健康關懷/);assert.match(payload.prompt,/運動、關懷、友善職場/);assert.match(payload.prompt,/不含任何文字/);assert.equal(media.kind,'ai');assert.equal(media.sourcePostId,'running');
});

test('Codex images import into the library without API requests or dollar budget reservations, including on failure',async t=>{
  const s=fixture(t);s.set('settings',{...defaultSettings(),imageEnabled:true,imageProvider:'codex'});
  const bytes=await sharp({create:{width:100,height:100,channels:3,background:'#24634b'}}).jpeg().toBuffer();
  let apiRequests=0;
  const fetchFn=async()=>{apiRequests++;throw new Error('API must not be used');};
  const media=await generateImage(s,'測試閱讀配圖',{fetchFn,codexImageFn:async(_store,brief)=>{assert.match(brief,/測試閱讀配圖/);return {bytes};}});
  assert.equal(media.provider,'codex');assert.ok(s.get('media',media.id));assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM budget').get().n,0);
  await assert.rejects(generateImage(s,'失敗配圖',{fetchFn,codexImageFn:async()=>{throw new Error('subscription limit');}}),/subscription limit/);
  assert.equal(apiRequests,0);
});
