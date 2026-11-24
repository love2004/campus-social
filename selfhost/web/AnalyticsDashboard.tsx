import { useEffect, useState } from 'react';
import { Activity, AlertCircle, ArrowRight, BarChart3, CalendarDays, Eye, RefreshCw, Send } from 'lucide-react';
import { performanceMetrics, postSampleLimit, publicationReport } from '../analytics-report.mjs';
import { platforms, platformNames, type Platform } from './types';
import './analytics.css';

type Selection='all'|Platform;
type Metric='views'|'reach'|'interactions'|'delivered'|'opened'|'clicked';
type Issue='unconfigured'|'unavailable'|'permission'|'token'|'rate_limit'|'missing_id'|'pending'|'error'|'account_unknown'|'account_changed';
type Account={channel:Platform;sent:number;accountSent?:number;previousSent:number;issues:number;followers:number|null;issue:Issue|null;asOf?:string};
type Row={id:string;postId:string;title:string;category:string;date:string;estimatedDate?:boolean;values:Partial<Record<Metric,number|null>>;issue:Issue|null};
type Report={platform:Selection;days:number;start:string;end:string;channels:Account[];daily:{date:string;sent:number}[];totalSent:number;posts:Row[]};

const metricNames:Record<Metric,string>={views:'觀看',reach:'觸及',interactions:'互動',delivered:'送達',opened:'開啟',clicked:'點擊'};
const notes:Record<Platform,string>={
  facebook:'互動為表情反應加留言；觸及為觀看貼文的不重複人數。',
  instagram:'互動採用 Instagram 的總互動數；觸及為不重複帳號數。',
  threads:'互動為喜歡、回覆、轉貼與引用的總和。',
  line:'開啟和點擊以不重複人數計；LINE 可能不回傳尚未結算或低於隱私門檻的數值。',
};
const issues:Record<Issue,string>={unconfigured:'尚未設定帳號',unavailable:'平台未提供完整數據',permission:'缺少分析權限',token:'憑證失效或未獲授權',rate_limit:'平台暫時限制查詢',missing_id:'缺少平台識別碼',pending:'平台仍在統計',error:'暫時無法讀取',account_unknown:'舊紀錄未保存帳號',account_changed:'其他帳號的紀錄'};
const scope:Partial<Record<Platform,string>>={facebook:'read_insights',instagram:'instagram_manage_insights',threads:'threads_manage_insights'};
const number=new Intl.NumberFormat('zh-TW');
const fmt=(n:number|null|undefined)=>n==null?'—':number.format(n);
const short=(s:string)=>s.slice(5).replace('-','/');
const formattedDate=(s:string)=>new Date(s).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
const metricKeys=(p:Platform)=>performanceMetrics[p] as Metric[];

function demoReport(platform:Selection,days:number):Report {
  const stories=[
    ['校園步道導覽上線','校園新聞'],
    ['開放日報名提醒','活動公告'],
    ['學生團隊分享研究成果','研究成果'],
    ['交換學生的校園日記','國際交流'],
  ];
  const posts=stories.map(([title,category],i)=>({id:'preview-'+i,title,category}));
  const now=new Date();
  const publications=platforms.flatMap((channel,n)=>[1,3,6,9,12,18,22,26,34,44,65].filter((_,i)=>(i+n)%4!==0).map((ago,i)=>{
    const id=`${channel}-${i}`,date=new Date(now.getTime()-ago*86_400_000).toISOString();
    return {channel,id,postId:posts[i%posts.length].id,status:'sent',completedAt:date};
  }));
  const {sent,channels,...data}=publicationReport(publications,posts,platform,days,now);
  return {...data,days,platform,totalSent:sent.length,channels:channels.map((account:Omit<Account,'followers'|'issue'>)=>({...account,followers:[2368,1420,865,1736][platforms.indexOf(account.channel)],issue:null})),
    posts:platform==='all'?[]:sent.map(({job:_job,...row}:Omit<Row,'values'|'issue'>&{job:unknown},i:number)=>({...row,issue:null,values:platform==='line'?{delivered:980-i*54,opened:542-i*39,clicked:84-i*8}:{views:2350-i*195,reach:1810-i*130,interactions:[186,92,156,86,133,63,74,26][i]??19}}))};
}

function Trend({report}:{report:Report}) {
  const size=report.days===90?7:1;
  const groups=report.daily.filter((_,i)=>i%size===0).map((first,i)=>{
    const entries=report.daily.slice(i*size,(i+1)*size);
    return {date:first.date,end:entries.at(-1)!.date,sent:entries.reduce((n,x)=>n+x.sent,0)};
  });
  const max=Math.max(1,...groups.map(g=>g.sent));
  return <section className="panel analytics-trend">
    <div className="panel-heading"><h2>發佈趨勢</h2><span>{size===1?'每日':'每 7 日'} · 依台北時間</span></div>
    <div className="analytics-chart" aria-label="期間內各日或各週的發佈數">
      {groups.map((group,i)=>{
        const caption=`${short(group.date)}${group.date===group.end?'':`–${short(group.end)}`}：${group.sent} 筆`;
        return <div className="analytics-column" key={group.date} title={caption} aria-label={caption} role="img">
          <span className="analytics-bar" style={{height:group.sent?100*group.sent/max+'%':'2px'}}/>
          {(i===0||i===groups.length-1||groups.length<=7||i%Math.ceil(groups.length/5)===0)&&<small aria-hidden="true">{short(group.date)}</small>}
        </div>;
      })}
    </div>
    <p className="analytics-chart-caption">每一則內容在每個平台的送出紀錄各算一筆。LINE 計入平台接受的群發請求。</p>
  </section>;
}

export default function AnalyticsDashboard({demo,onChannels,onPost}:{demo:boolean;onChannels:()=>void;onPost:(id:string)=>void}) {
  const [selection,setSelection]=useState<Selection>('all');
  const [days,setDays]=useState(30);
  const [sort,setSort]=useState<'date'|Metric>('date');
  const [revision,refresh]=useState(0);
  const [result,setResult]=useState<{key:string;data?:Report;error?:string}>();
  const key=`${selection}/${days}/${revision}/${demo}`;
  useEffect(()=>{
    if(demo)return;
    const controller=new AbortController();
    void (async()=>{
      try {
        const response=await fetch(`/api/analytics?platform=${selection}&days=${days}`,{signal:controller.signal});
        if(!response.ok){
          const {error}=await response.json() as {error?:string};
          throw new Error(error||'暫時無法載入分析');
        }
        const data=await response.json() as Report;
        if(!controller.signal.aborted)setResult({key,data});
      } catch(error) {
        if(!controller.signal.aborted)setResult({key,error:error instanceof Error ? error.message : '暫時無法載入分析'});
      }
    })();
    return()=>controller.abort();
  },[demo,days,selection,key]);

  const data=demo?demoReport(selection,days):result?.key===key?result.data:undefined;
  const error=result?.key===key?result.error:undefined;
  const select=(p:Selection)=>{setSelection(p);setSort('date');};
  const prior=data?.channels.reduce((n,row)=>n+row.previousSent,0)??0;
  const delta=(data?.totalSent??0)-prior;
  const needsSetup=data?.channels.some(row=>row.issue==='unconfigured'||row.issue==='token'||row.issue==='permission');
  const keys=selection==='all'?[]:metricKeys(selection);
  const rows=data?[...data.posts].sort((a,b)=>sort==='date'?0:(b.values[sort]??-1)-(a.values[sort]??-1)):[];
  const measured=rows.filter(row=>keys.some(k=>row.values[k]!=null)).length;
  const postAuth=rows.some(row=>row.issue==='permission'||row.issue==='token');
  return <div className="analytics-dashboard">
    <div className="analytics-controls">
      <div className="analytics-platforms" role="group" aria-label="篩選平台">
        <button aria-pressed={selection==='all'} onClick={()=>select('all')}>總覽</button>
        {platforms.map(p=><button key={p} aria-pressed={selection===p} onClick={()=>select(p)}>{p==='line'?'LINE':platformNames[p]}</button>)}
      </div>
      <div className="analytics-period">
        <label><CalendarDays size={16}/><select aria-label="分析期間" value={days} onChange={e=>setDays(Number(e.target.value))}><option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option></select></label>
        {!demo&&<button className="btn secondary" disabled={!data&&!error} onClick={()=>refresh(n=>n+1)}><RefreshCw size={15}/>重新整理</button>}
      </div>
    </div>
    {demo&&<div className="notice-box"><Eye size={17}/><p>以下為示範數據，未呼叫社群平台 API。</p></div>}
    {error&&<div className="alert" role="alert">{error}</div>}
    {!data&&!error&&<div className="panel analytics-empty" role="status"><Activity size={19}/>正在讀取發佈與平台數據…</div>}
    {data&&<>
      <div className="analytics-kpis">
        <article className="panel analytics-kpi"><span><Send size={17}/>已送出</span><strong>{fmt(data.totalSent)}</strong><small>{data.start} 至 {data.end}</small></article>
        <article className="panel analytics-kpi"><span><Activity size={17}/>較前一期</span><strong>{delta>0?'+':''}{fmt(delta)}</strong><small>前 {days} 天送出 {fmt(prior)} 筆</small></article>
        <article className="panel analytics-kpi"><span><AlertCircle size={17}/>需核對</span><strong>{fmt(data.channels.reduce((n,row)=>n+row.issues,0))}</strong><small>期間內失敗或結果未明</small></article>
      </div>
      <Trend report={data}/>
      <section aria-label="平台帳號概況" className={selection==='all'?'analytics-accounts':'analytics-accounts single'}>
        {data.channels.map(row=><article className="panel analytics-account" key={row.channel}>
          <div className="analytics-account-title"><i className={row.channel}/><h2>{platformNames[row.channel]}</h2></div>
          <dl><div><dt>{row.channel==='line'?'好友總數':'追蹤人數'}</dt><dd>{fmt(row.followers)}</dd></div><div><dt>此帳號期間送出</dt><dd>{fmt(row.accountSent??row.sent)}</dd></div></dl>
          {!demo&&row.accountSent!==undefined&&row.sent>row.accountSent&&<p>另有 {fmt(row.sent-row.accountSent)} 筆屬舊帳號或未保存帳號。</p>}
          {row.issue?<p>{issues[row.issue]}</p>:<p>{row.asOf?`統計日期：${row.asOf}（日本時間）`:'最新可取得的帳號數據'}</p>}
          {selection==='all'&&<button className="text-button" onClick={()=>select(row.channel)}>查看貼文成效 <ArrowRight size={14}/></button>}
        </article>)}
      </section>
      {!demo&&(needsSetup||postAuth)&&<div className="notice-box"><AlertCircle size={18}/><p><button className="inline-button" onClick={onChannels}>前往社群帳號</button>確認憑證{selection!=='all'&&scope[selection]?`，並核對 ${scope[selection]} 權限`:''}。</p></div>}
      {selection!=='all'&&<section className="panel analytics-posts">
        <div className="panel-heading"><div><h2>貼文成效</h2><p>{notes[selection]}</p></div>
          {rows.length>0&&<select aria-label="貼文排序" value={sort} onChange={e=>setSort(e.target.value as typeof sort)}><option value="date">最新發佈</option>{keys.map(metric=><option key={metric} value={metric}>依{metricNames[metric]}排序</option>)}</select>}
        </div>
        {rows.length?<><dl className="analytics-metric-means" aria-label="每篇平均成效">
          {keys.map(metric=>{
            const values=rows.flatMap(row=>row.values[metric]==null?[]:[row.values[metric]!]);
            return <div key={metric}><dt>每篇平均{metricNames[metric]}</dt><dd>{fmt(values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):null)} <small>／ {values.length} 篇有資料</small></dd></div>;
          })}
        </dl><p className="analytics-coverage">列出最近 {rows.length} 筆{data.totalSent>rows.length?`（期間共 ${data.totalSent} 筆，上限 ${postSampleLimit} 筆）`:''}，{measured} 筆有成效數據。日期依送出時間篩選，數值為每篇截至查詢時的累計；「—」表示未取得。</p>
          <div className="analytics-table-wrap" role="region" aria-label="貼文成效資料表" tabIndex={0}><table>
            <thead><tr><th scope="col">貼文</th><th scope="col" aria-sort={sort==='date'?'descending':undefined}>送出時間</th>{keys.map(k=><th scope="col" key={k} aria-sort={sort===k?'descending':undefined}>{metricNames[k]}</th>)}{selection==='line'&&<th scope="col">開啟率</th>}<th scope="col">資料狀態</th></tr></thead>
            <tbody>{rows.map(row=><tr key={row.id}>
              <th scope="row">{demo?<strong>{row.title}</strong>:<button className="inline-button" onClick={()=>onPost(row.postId)}>{row.title}</button>}<small>{row.category}</small></th>
              <td>{formattedDate(row.date)}{row.estimatedDate&&'（估計）'}</td>{keys.map(k=><td key={k}>{fmt(row.values[k])}</td>)}
              {selection==='line'&&<td>{row.values.delivered&&row.values.opened!=null?`${(100*row.values.opened/row.values.delivered).toFixed(1)}%`:'—'}</td>}
              <td>{row.issue?issues[row.issue]:'已取得'}</td>
            </tr>)}</tbody>
          </table></div>
        </>:<div className="analytics-empty"><BarChart3 size={22}/>所選期間還沒有這個平台的送出紀錄。</div>}
      </section>}
      <p className="analytics-footnote">成效僅涵蓋此工作台送出的內容，未納入在社群平台直接發佈的貼文。為避免頻繁查詢，平台數據可沿用短期快取。</p>
    </>}
  </div>;
}
