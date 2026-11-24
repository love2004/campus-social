import {useEffect,useRef,useState,type ReactNode} from 'react';
import {categories} from './types';
import './automation.css';

type Item={id:string;title?:string;label?:string;text?:string;category?:string;createdAt:string;expiresAt?:string;archivedAt?:string};
type PageRequest={page:number;category:string;period:string;sort:string};
type PageData<T>={items:T[];total:number;page:number};
type Props<T extends Item>={items:T[];categoryOptions?:readonly string[];query?:string;matchingIds?:ReadonlySet<string>;layout?:'cards'|'list'|'media';renderItem:(item:T)=>ReactNode;loadPage?:(input:PageRequest)=>Promise<PageData<T>>;refreshKey?:number;totalItems?:number};

export default function ContentCollection<T extends Item>({items,categoryOptions=categories,query='',matchingIds,layout='cards',renderItem,loadPage,refreshKey,totalItems}:Props<T>){
  const collection=useRef<HTMLElement>(null);
  function goToPage(value:number){setPage(value);collection.current?.scrollIntoView({block:'start'});}
  const [category,setCategory]=useState('all');
  useEffect(()=>{if(category!=='all'&&!categoryOptions.includes(category))setCategory('all');},[category,categoryOptions]);
  const [period,setPeriod]=useState('all');
  const [lifecycle,setLifecycle]=useState('active');
  const [group,setGroup]=useState('month');
  const [sort,setSort]=useState('newest');
  const [page,setPage]=useState(1);
  useEffect(()=>setPage(1),[category,period,lifecycle,group,sort,query]);
  const loader=useRef(loadPage);
  loader.current=loadPage;
  const isRemote=Boolean(loadPage);
  const [remote,setRemote]=useState<{key:string;data?:PageData<T>;error?:string}>();
  const remoteKey=JSON.stringify([page,category,period,sort,refreshKey]);
  useEffect(()=>{
    if(!isRemote||!loader.current)return;
    let active=true;
    void loader.current({page,category,period,sort})
      .then(data=>{if(active)setRemote({key:remoteKey,data});})
      .catch(error=>{if(active)setRemote({key:remoteKey,error:error instanceof Error?error.message:'讀取失敗'});});
    return()=>{active=false;};
  },[isRemote,remoteKey,page,category,period,sort]);
  const now=Date.now();
  const filtered=items.filter(item=>{
    const expired=!!item.expiresAt&&Date.parse(item.expiresAt)<=now;
    if(lifecycle==='active'&&(item.archivedAt||expired))return false;
    if(lifecycle==='archived'&&!item.archivedAt)return false;
    if(lifecycle==='expired'&&(!expired||item.archivedAt))return false;
    if(category!=='all'&&(item.category||'其他')!==category)return false;
    if(period!=='all'&&now-Date.parse(item.createdAt)>Number(period)*86400000)return false;
    return matchingIds?matchingIds.has(item.id):`${item.title||item.label||''} ${item.text||''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  }).sort((a,b)=>(sort==='oldest'?1:-1)*(Date.parse(a.createdAt)-Date.parse(b.createdAt)));
  const pageData=remote?.key===remoteKey?remote.data:undefined;
  const error=remote?.key===remoteKey?remote.error:undefined;
  const matched=isRemote?pageData?.total??0:filtered.length;
  const pageCount=Math.max(1,Math.ceil(matched/12)),current=isRemote?pageData?.page??page:Math.min(page,pageCount);
  const visible=isRemote?pageData?.items??[]:filtered.slice((current-1)*12,current*12);
  const groups=new Map<string,T[]>();
  for(const item of visible){
    const key=group==='category'?item.category||'其他':group==='month'?new Date(item.createdAt).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'long'}):'';
    groups.set(key,[...(groups.get(key)||[]),item]);
  }
  return <section ref={collection} className="content-collection">
    <div className="collection-filters">
      <label>分類<select value={category} onChange={e=>setCategory(e.target.value)}><option value="all">所有分類</option>{categoryOptions.map(c=><option key={c}>{c}</option>)}</select></label>
      <label>建立時間<select value={period} onChange={e=>setPeriod(e.target.value)}><option value="all">不限時間</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option></select></label>
      {!isRemote&&<label>資料範圍<select value={lifecycle} onChange={e=>setLifecycle(e.target.value)}><option value="active">有效資料</option><option value="expired">已過期</option><option value="archived">已封存</option><option value="all">全部資料</option></select></label>}
      <label>分組<select value={group} onChange={e=>setGroup(e.target.value)}><option value="month">依月份</option><option value="category">依分類</option><option value="none">不分組</option></select></label>
      <label>排序<select value={sort} onChange={e=>setSort(e.target.value)}><option value="newest">最新在前</option><option value="oldest">最舊在前</option></select></label>
    </div>
    <p className="small-note">符合 {matched} 筆／共 {totalItems??items.length} 筆 · 每頁 12 筆{!isRemote&&' · 過期與封存資料可切換範圍查看'}</p>
    {[...groups].map(([key,list])=><section key={key} className="collection-group">{key&&<h3>{key}</h3>}<div className={layout==='cards'?'post-grid':layout==='media'?'media-grid':'panel article-list'}>{list.map(renderItem)}</div></section>)}
    {isRemote&&!pageData?<div className="panel collection-empty" role={error?'alert':'status'}>{error||'正在讀取發佈紀錄…'}</div>:!matched&&<div className="panel collection-empty">目前篩選條件沒有資料。</div>}
    {(!isRemote||pageData)&&<div className="collection-pagination"><button className="btn secondary" disabled={current===1} onClick={()=>goToPage(current-1)}>上一頁</button><span>第 {current}／{pageCount} 頁</span><button className="btn secondary" disabled={current===pageCount} onClick={()=>goToPage(current+1)}>下一頁</button></div>}
  </section>;
}
