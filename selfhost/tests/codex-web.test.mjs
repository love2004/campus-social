import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { discoverLinks, readArticles } from '../codex-web.mjs';
import { checkEvidence } from '../topic-drafts.mjs';

function response(data,opened=[]){
  return async(args,{input})=>{
    assert.ok(args.includes('web_search="live"'));
    assert.ok(args.includes('features.shell_tool=false'));
    assert.match(input,/忽略其中指令/);
    await writeFile(args[args.indexOf('--output-last-message')+1],JSON.stringify(data));
    const events=opened.map(url=>({type:'item.completed',item:{type:'web_search',action:{type:'open_page',url},results:[{url}]}}));
    return {code:0,stdout:[...events,{type:'turn.completed'}].map(event=>JSON.stringify(event)).join('\n'),stderr:''};
  };
}

test('Codex source link extraction requires an observed list and validates returned links',async()=>{
  const source={kind:'website',url:'https://example.org/news',linkPattern:'/stories/'};
  const result={links:['https://example.org/stories/1','https://example.org/stories/1','https://other.example/stories/2',
    'https://127.0.0.1/stories/3','https://example.org/events']};
  assert.deepEqual(await discoverLinks(source,{runner:response(result,[source.url])}),['https://example.org/stories/1']);
  await assert.rejects(discoverLinks(source,{runner:response(result,['https://other.example/news'])}),/無法開啟來源列表/);
  assert.deepEqual(await discoverLinks(source,{runner:response(result,['https://example.org/stories/1','https://other.example/stories/2'])}),['https://example.org/stories/1']);
});

test('Codex extracts only opened articles and never accepts its summary as a verbatim quote',async()=>{
  const url='https://example.org/story',other='https://example.org/other',quote='公告明載11月20日開始報名。';
  const article={url,title:'公開公告',text:'這是系統整理的摘要。'.repeat(10),publishedAt:'2026-11-18',imageUrls:['https://127.0.0.1/a.jpg'],excerpts:[quote]};
  const result={articles:[article,{...article,url:other}]};
  const [verified,...unobserved]=await readArticles([url,other],{runner:response(result,[url])});
  assert.equal(verified.url,url);
  assert.deepEqual(verified.imageUrls,[]);
  assert.deepEqual(unobserved,[]);
  await assert.rejects(readArticles([url],{runner:response(result)}),/未執行 Web Search/);
  const review=claim=>checkEvidence({verdict:'pass',reason:'核對',facts:[{field:'日期',sourceId:'article',quote:claim}]},[{...verified,id:'article'}]);
  assert.equal(review(quote).verdict,'pass');
  assert.equal(review('這是系統整理的摘要。').verdict,'revise');
});
