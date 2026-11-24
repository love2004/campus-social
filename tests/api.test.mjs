import test from 'node:test';
import assert from 'node:assert/strict';
import { initialData } from '../lib/campus.ts';
const base='http://localhost:5173';
test('real workspace auth, atomic saves, input protection and missing-credential publishing',async()=>{
  const anon=await fetch(base+'/api/workspace');assert.equal(anon.status,401);
  const login=await fetch(base+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});assert.equal(login.status,302);
  const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie,'local mock sign-in cookie');
  async function call(path,method='GET',value,extra={}){const r=await fetch(base+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json',...extra},...(value?{body:JSON.stringify(value)}:{})});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={error:text};}return{status:r.status,data};}
  const original=await call('/api/workspace');assert.equal(original.status,200);assert.equal(typeof original.data.version,'number');
  try{
    const now=new Date().toISOString().slice(0,10),state=initialData();state.sources.push({id:'local-test-source',title:'LOCAL TEST',url:'https://www.dyu.edu.tw/',text:'這是本機整合測試專用素材，不是實際校園新聞。用於驗證資料儲存、權限與缺少 API 金鑰的錯誤處理。',category:'測試',createdAt:now,demo:false});state.posts.push({id:'local-test-post',title:'LOCAL TEST',body:'這是本機整合測試，不得實際發佈。',sourceId:'local-test-source',channels:['facebook','instagram','line'],status:'draft',date:'',imageUrl:'',imagePrompt:'',variant:'story',reviewed:false,demo:false});
    const pair=await Promise.all([call('/api/workspace','PUT',{version:original.data.version,data:state}),call('/api/workspace','PUT',{version:original.data.version,data:state})]);assert.deepEqual(pair.map(x=>x.status).sort(),[200,409]);
    const get=await call('/api/workspace');assert.equal(get.data.data.sources[0].title,'LOCAL TEST');
    const refused=await call('/api/publish','POST',{postId:'local-test-post'});assert.equal(refused.status,400);assert.match(refused.data.error,/核對/);
    state.posts[0].reviewed=true;const approved=await call('/api/workspace','PUT',{version:get.data.version,data:state,reviewPostId:state.posts[0].id});assert.equal(approved.status,200);
    const publish=await call('/api/publish','POST',{postId:'local-test-post'});assert.equal(publish.status,200);assert.ok(publish.data.results.every(x=>x.status==='blocked'));assert.equal((await call('/api/workspace')).data.publications.length,original.data.publications.length);
    const changed=approved.data.data;
    changed.posts[0].variant='question';
    changed.posts[0].channels=['facebook'];
    const changedSave=await call('/api/workspace','PUT',{version:approved.data.version,data:changed});
    assert.equal(changedSave.status,200);
    assert.equal(changedSave.data.data.posts[0].reviewed,false);
    assert.equal((await call('/api/publish','POST',{postId:'local-test-post'})).status,400);
    assert.equal((await call('/api/generate','POST',{sourceId:'local-test-source',audience:'test',tone:'test',prompt:'test',variant:'story'})).status,503);
    assert.equal((await call('/api/source','POST',{url:'http://127.0.0.1:5173/'})).status,400);
    assert.equal((await call('/api/source','POST',{url:'https://www.dyu.edu.tw.evil.example/'})).status,400);
    assert.equal((await call('/api/source','POST',{url:'https://www.dyu.edu.tw/'},{Origin:'https://evil.example'})).status,403);
    const demoState=structuredClone(state);demoState.posts[0].demo=true;assert.equal((await call('/api/workspace','PUT',{version:1,data:demoState})).status,400);
  }finally{const latest=await call('/api/workspace');assert.equal((await call('/api/workspace','PUT',{version:latest.data.version,data:original.data.data})).status,200);}
});
