import { createHash } from 'node:crypto';
import { PLATFORM_KEYS, publicationAccount, lineTokenAccount, historicalAccount, metaGraphUrl } from './publish.mjs';
import { analyticsWindow, performanceMetrics, postSampleLimit, publicationReport } from './analytics-report.mjs';

const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const sum=(...values)=>values.every(value=>value!==null)?values.reduce((a,b)=>a+b,0):null;
const validId=value=>typeof value==='string'&&/^[0-9]+(?:_[0-9]+)?$/.test(value);
const graphMetric=(response,name)=>{
  const item=Array.isArray(response?.data)?response.data.find(m=>m.name===name):null;
  return count(item?.total_value?.value??item?.values?.at(-1)?.value);
};

function problem(status,code) {
  if(status===429||[4,17,32,613,80001,80002].includes(code))return 'rate_limit';
  if(status===401||code===190)return 'token';
  if(status===403||[10,200,283].includes(code))return 'permission';
  if([400,404].includes(status))return 'unavailable';
  return 'error';
}

async function mapLimited(items,limit,fn) {
  const result=[];
  let next=0;
  await Promise.all(Array.from({length:Math.min(items.length,limit)},async()=>{
    while(next<items.length) {
      const index=next++;
      result[index]=await fn(items[index]);
    }
  }));
  return result;
}

export function createAnalytics(store,{fetchFn=fetch,clock=()=>new Date()}={}) {
  const cache=new Map();
  function get(url,token,ttl=5*60_000) {
    const key=createHash('sha256').update(JSON.stringify([url.href,token])).digest('hex');
    const old=cache.get(key);
    if(old&&old.expires>Date.now())return old.promise;
    const entry={expires:Infinity,promise:null};
    entry.promise=(async()=>{
      const checkedAt=clock().toISOString();
      let result;
      try {
        const res=await fetchFn(url,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(4_000)});
        const body=await res.json().catch(()=>null);
        result=!res.ok||body?.error?{issue:problem(res.status,body?.error?.code)}:body?{body}:{issue:'error'};
      } catch {
        result={issue:'error'};
      }
      entry.expires=Date.now()+(result.issue&&ttl<30*60_000?60_000:ttl);
      return {...result,checkedAt};
    })();
    cache.set(key,entry);
    if(cache.size>512) {
      const settled=[...cache].find(([,value])=>Number.isFinite(value.expires));
      if(settled)cache.delete(settled[0]);
    }
    return entry.promise;
  }

  function connection(channel) {
    const keys=PLATFORM_KEYS[channel],values=keys.map(key=>store.secret(key));
    if(channel==='instagram'&&store.secret('INSTAGRAM_INSIGHTS_TOKEN'))values[2]=store.secret('INSTAGRAM_INSIGHTS_TOKEN');
    if(!values.every(Boolean))return null;
    const version=values[0],id=channel==='threads'?values[0]:values[1];
    if(channel!=='line'&&(!validId(id)||(channel!=='threads'&&!/^v\d+\.\d+$/.test(version))))return null;
    const base=channel==='line'?'https://api.line.me/v2/bot/insight/':channel==='threads'?'https://graph.threads.com/v1.0/':`https://graph.facebook.com/${version}/`;
    const accountKey=publicationAccount(store,channel);
    const accountKeys=new Set([accountKey,...(channel==='line'?[lineTokenAccount(store)]:[])].filter(Boolean));
    return {id,accountKeys,read:(path,params={},ttl)=>{
      const url=new URL(base+path);
      url.search=new URLSearchParams(params).toString();
      const token=values.at(-1);
      const usesPageToken=channel==='facebook'||(channel==='instagram'&&!store.secret('INSTAGRAM_INSIGHTS_TOKEN'));
      return get(usesPageToken?new URL(metaGraphUrl(store,url,token)):url,token,ttl);
    }};
  }

  async function account(channel,link,now) {
    if(!link)return {followers:null,issue:'unconfigured'};
    const {id,read}=link;
    if(channel==='line') {
      for(const daysAgo of [1,2,3]) {
        const date=new Date(now.getTime()+9*3_600_000-daysAgo*86_400_000).toISOString().slice(0,10);
        const response=await read('followers',{date:date.replaceAll('-','')},30*60_000);
        if(response.issue)return {followers:null,issue:response.issue};
        if(response.body.status==='ready') {
          const followers=count(response.body.followers);
          return {followers,issue:followers===null?'unavailable':null,asOf:date,checkedAt:response.checkedAt};
        }
      }
      return {followers:null,issue:'pending'};
    }
    const response=channel==='threads'
      ?await read(id+'/threads_insights',{metric:'followers_count'})
      :await read(id,{fields:'followers_count'});
    const followers=channel==='threads'?graphMetric(response.body,'followers_count'):count(response.body?.followers_count);
    return {followers,issue:response.issue||(followers===null?'unavailable':null),checkedAt:response.body?response.checkedAt:null};
  }

  async function postPerformance(channel,link,job) {
    const keys=performanceMetrics[channel];
    const empty=issue=>({values:Object.fromEntries(keys.map(key=>[key,null])),issue,checkedAt:null});
    if(!link)return empty('unconfigured');
    const accountKey=historicalAccount(job);
    if(!accountKey)return empty('account_unknown');
    if(!link.accountKeys.has(accountKey))return empty('account_changed');
    const id=channel==='line'?job.result?.requestId:job.result?.id;
    // A LINE retry key is local and cannot be used to query event statistics.
    if(channel==='line'?typeof id!=='string'||!/^[\w-]{1,100}$/.test(id)||id===job.requestKey:!validId(id))return empty('missing_id');
    const {read}=link;
    let values,responses;
    if(channel==='line') {
      const res=await read('message/event',{requestId:id},30*60_000);
      const overview=res.body?.overview;
      responses=[res];
      values={delivered:count(overview?.delivered),opened:count(overview?.uniqueImpression),clicked:count(overview?.uniqueClick)};
    } else if(channel==='facebook') {
      const [insights,post]=await Promise.all([
        read(id+'/insights',{metric:'post_media_view,post_total_media_view_unique'}),
        read(id,{fields:'reactions.limit(0).summary(true),comments.limit(0).summary(true)'}),
      ]);
      responses=[insights,post];
      values={views:graphMetric(insights.body,'post_media_view'),reach:graphMetric(insights.body,'post_total_media_view_unique'),
        interactions:sum(count(post.body?.reactions?.summary?.total_count),count(post.body?.comments?.summary?.total_count))};
    } else if(channel==='instagram') {
      const res=await read(id+'/insights',{metric:'views,reach,total_interactions'});
      responses=[res];
      values={views:graphMetric(res.body,'views'),reach:graphMetric(res.body,'reach'),interactions:graphMetric(res.body,'total_interactions')};
    } else {
      const res=await read(id+'/insights',{metric:'views,likes,replies,reposts,quotes'});
      responses=[res];
      values={views:graphMetric(res.body,'views'),interactions:sum(...['likes','replies','reposts','quotes'].map(name=>graphMetric(res.body,name)))};
    }
    const received=responses.filter(res=>res.body).map(res=>res.checkedAt).sort()[0]||null;
    return {values,issue:responses.find(res=>res.issue)?.issue||(Object.values(values).includes(null)?'unavailable':null),checkedAt:received};
  }

  return async ({days,platform})=>{
    const now=clock();
    const {previousStart}=analyticsWindow(days,now);
    const {publications,posts:metadata}=store.analyticsRows(platform,new Date(previousStart).toISOString(),now.toISOString());
    const {sent,channels,...report}=publicationReport(publications,metadata,platform,days,now);
    const links=new Map(channels.map(row=>[row.channel,connection(row.channel)]));
    const [accounts,posts]=await Promise.all([
      Promise.all(channels.map(async row=>{
        const link=links.get(row.channel);
        const accountSent=sent.filter(({job})=>job.channel===row.channel&&link?.accountKeys.has(historicalAccount(job))).length;
        return {...row,accountSent,...await account(row.channel,link,now)};
      })),
      platform==='all'?[]:mapLimited(sent.slice(0,postSampleLimit),5,async({job,...post})=>({...post,...await postPerformance(platform,links.get(platform),job)})),
    ]);
    return {...report,days,platform,channels:accounts,totalSent:sent.length,posts};
  };
}
