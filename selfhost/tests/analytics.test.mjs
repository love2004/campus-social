import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalytics } from '../analytics.mjs';
import { publicationReport } from '../analytics-report.mjs';
import { publicationAccount } from '../publish.mjs';

const now=new Date('2026-11-15T01:00:00+08:00');
const row=(id,channel,date,extra={})=>({id,postId:'p',channel,status:'sent',createdAt:date,updatedAt:date,...extra});
const post={id:'p',title:'校園開放日',category:'活動公告'};
const insight=(name,value)=>({name,values:[{value}]});

test('Taipei reporting boundaries, completed timestamps, previous period, and per-platform counts',()=>{
  const reports=publicationReport([
    row('latest','facebook','2026-11-09T06:00:00Z',{completedAt:'2026-11-14T16:00:00Z'}),
    row('start','instagram','2026-11-08T16:00:00Z'),
    row('prior','facebook','2026-11-08T15:59:59Z'),
    row('issue','line','2026-11-13T16:00:00Z',{status:'unknown'}),
    row('pending','threads','2026-11-14T16:00:00Z',{status:'pending'}),
    row('future','threads','2026-11-15T16:00:00Z'),
  ],[post],'all',7,now);
  assert.equal(reports.start,'2026-11-09');
  assert.equal(reports.end,'2026-11-15');
  assert.deepEqual(reports.daily.map(item=>item.sent),[1,0,0,0,0,0,1]);
  assert.deepEqual(reports.channels.map(({sent,previousSent,issues})=>[sent,previousSent,issues]),[[1,1,0],[1,0,0],[0,0,0],[0,0,1]]);
  assert.deepEqual(reports.sent.map(r=>[r.id,r.title]),[['latest',post.title],['start',post.title]]);
});

test('manual reconciliation uses platform time or the original attempt instead of the reconciliation date',()=>{
  const confirmed='2026-11-08T16:00:00Z',attempt='2026-11-13T16:00:00Z',resolved='2026-11-14T16:03:00Z';
  const report=publicationReport([
    row('confirmed','facebook',resolved,{publishedAt:confirmed,attemptedAt:attempt}),
    row('estimated','facebook',resolved,{attemptedAt:attempt}),
  ],[post],'facebook',7,now);
  assert.deepEqual(report.sent.map(row=>[row.date,row.estimatedDate]),[[attempt,true],[confirmed,false]]);
  assert.equal(report.daily.at(-1).sent,0);
});

test('read-only adapters preserve zero, privacy gaps and partial success, with credential-scoped caching',async()=>{
  const secrets={META_GRAPH_VERSION:'v27.0',FACEBOOK_PAGE_ID:'10',FACEBOOK_PAGE_TOKEN:'fixture-page-token',INSTAGRAM_USER_ID:'20',
    INSTAGRAM_INSIGHTS_TOKEN:'fixture-instagram-user-token',THREADS_USER_ID:'30',THREADS_TOKEN:'fixture-threads-token',LINE_CHANNEL_TOKEN:'fixture-line-token'};
  const date='2026-11-13T04:00:00Z';
  const publications=[
    row('fb','facebook',date,{result:{id:'10_11'}}),row('ig','instagram',date,{result:{id:'21'}}),
    row('th','threads',date,{result:{id:'31'}}),row('line','line',date,{result:{requestId:'req-line'}}),
    row('line-retry','line',date,{result:{requestId:'local-retry'},requestKey:'local-retry'}),
    row('ig-container','instagram',date,{result:{containerId:'22'}}),
  ];
  const calls=[];
  const fetchFn=async(url,options)=>{
    const {pathname,hostname,searchParams:params}=url;
    calls.push({url:url.href,token:options.headers.Authorization});
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');
    assert.equal(params.has('access_token'),false);
    if(hostname==='api.line.me') {
      if(pathname.endsWith('/followers'))return Response.json(params.get('date')==='20261114'?{status:'unready'}:{status:'ready',followers:123});
      assert.equal(params.get('requestId'),'req-line');
      return Response.json({overview:{delivered:43,uniqueImpression:null,uniqueClick:null}});
    }
    if(pathname.endsWith('/10_11/insights'))return Response.json({error:{code:200,message:'private details'}},{status:403});
    if(pathname.endsWith('/10_11'))return Response.json({reactions:{summary:{total_count:0}},comments:{summary:{total_count:4}}});
    if(pathname.endsWith('/21/insights'))return Response.json({data:[insight('views',100),insight('reach',70),insight('total_interactions',0)]});
    if(pathname.endsWith('/30/threads_insights'))return Response.json({data:[{name:'followers_count',total_value:{value:33}}]});
    if(pathname.endsWith('/31/insights'))return Response.json({data:[insight('views',22),insight('likes',3),insight('replies',4),insight('reposts',1),insight('quotes',2)]});
    return Response.json({followers_count:15});
  };
  const fixture={analyticsRows:()=>({publications,posts:[post]}),secret:key=>secrets[key],kv:()=>null};
  publications.forEach(job=>job.accountKey=publicationAccount(fixture,job.channel));
  const report=createAnalytics(fixture,{clock:()=>now,fetchFn});
  const get=platform=>report({platform,days:30});
  const all=await get('all');
  assert.deepEqual(all.channels.map(r=>r.followers),[15,15,33,123]);
  assert.equal(all.channels[3].asOf,'2026-11-13');
  assert.equal(all.totalSent,6);
  assert.equal(calls.length,5);
  const [fb,ig,threads,line]=await Promise.all(['facebook','instagram','threads','line'].map(get));
  assert.deepEqual(fb.posts[0].values,{views:null,reach:null,interactions:4});
  assert.equal(fb.posts[0].issue,'permission');
  assert.equal(ig.posts[0].values.interactions,0);
  assert.equal(ig.posts[1].issue,'missing_id');
  assert.equal(threads.posts[0].values.interactions,10);
  assert.deepEqual(line.posts[0].values,{delivered:43,opened:null,clicked:null});
  assert.equal(line.posts[1].issue,'missing_id');
  assert.ok(calls.some(c=>c.url.includes('/21/insights')&&c.token==='Bearer fixture-instagram-user-token'));
  for(const data of [fb,ig,threads,line])assert.doesNotMatch(JSON.stringify(data),/fixture-|private details|local-retry/);
  const first=calls.length;
  await get('line');
  assert.equal(calls.length,first);
  secrets.THREADS_TOKEN='replacement-token';
  await get('threads');
  assert.equal(calls.length,first+2);
  secrets.FACEBOOK_PAGE_ID='99';
  const changed=await get('facebook');
  assert.equal(changed.channels[0].accountSent,0);
  assert.equal(changed.totalSent,1);
  assert.equal(changed.posts[0].issue,'account_changed');
});

test('single-platform samples are bounded without limiting the publishing trend',async()=>{
  const publications=Array.from({length:25},(_,i)=>row(String(i),'facebook','2026-11-13T04:00:00Z'));
  const report=createAnalytics({analyticsRows:()=>({publications,posts:[post]}),secret:()=>''},{clock:()=>now,fetchFn:()=>assert.fail('No configured credentials')});
  const data=await report({platform:'facebook',days:30});
  assert.equal(data.posts.length,20);
  assert.equal(data.totalSent,25);
  assert.equal(data.daily.reduce((n,d)=>n+d.sent,0),25);
  assert.equal(data.channels[0].issue,'unconfigured');
});
