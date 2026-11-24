import { useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, FileText, Plus, Upload } from 'lucide-react';
import { mediaUrl, platformNames, statusNames, type Post, type State, type Topic, type TopicSource } from './types';
import './topic-calendar.css';

type Call = <T=unknown>(url:string,method?:string,body?:Record<string,unknown>)=>Promise<T>;
type Action = (label:string,fn:()=>Promise<void>,success?:string)=>Promise<void>;
type TopicDraft = {id?:string;version?:number;title:string;startDate:string;endDate:string;range:boolean;postId:string;when:string;postVersion?:number;revision?:string|null};
const localDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',dateStyle:'short'});
const localTime = new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const inRange = (day:string,start:string,end:string) => day>=start && day<=end;
const timeLabel = (when:string) => `${localDate.format(new Date(when))} ${localTime.format(new Date(when))}`;
const stageNames:Record<string,string>={sources:'整理素材',plan:'規劃寫作方向',search:'確認公開參考資料',draft:'撰寫貼文',review:'獨立審稿',artwork:'製作圖卡',complete:'備稿完成'};

function slotTimes(settings:State['settings'], first:string, last:string) {
  if (!settings.weekdays.length||!settings.times.length) return [];
  const days:string[]=[];
  for (const day=new Date(`${first}T00:00:00Z`); day.getUTCFullYear()<=9999&&day.toISOString().slice(0,10)<=last&&days.length<120; day.setUTCDate(day.getUTCDate()+1)) {
    if (!settings.weekdays.includes(day.getUTCDay())) continue;
    for (const time of [...settings.times].sort()) days.push(new Date(`${day.toISOString().slice(0,10)}T${time}:00+08:00`).toISOString());
  }
  return days;
}

export default function TopicCalendar({state,call,action,busy,demo,onOpenPost}:{
  state:State;call:Call;action:Action;busy:string;demo:boolean;onOpenPost:(post:Post)=>void;
}) {
  const today=localDate.format(new Date());
  const [month,setMonth]=useState(today.slice(0,7));
  const [day,setDay]=useState(today);
  const [selectedSlot,setSelectedSlot]=useState('');
  const [activeId,setActiveId]=useState('');
  const [draft,setDraft]=useState<TopicDraft|null>(null);
  const [materialMode,setMaterialMode]=useState<'file'|'text'|'url'>('file');
  const [drag,setDrag]=useState(false);
  const [fileErrors,setFileErrors]=useState<string[]>([]);
  const [evidence,setEvidence]=useState<{topicId:string;revision?:string;sources:TopicSource[]}|null>(null);
  const fileInput=useRef<HTMLInputElement>(null);
  const topics=state.topics??[], bindings=state.slotBindings??[];
  const active=topics.find(topic=>topic.id===activeId);
  const first=new Date(`${month}-01T00:00:00Z`);
  const next=new Date(first);next.setUTCMonth(first.getUTCMonth()+1);
  const last=new Date(next.getTime()-86400000).toISOString().slice(0,10);
  const days=Array.from({length:Number(last.slice(-2))},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);
  const recurring=slotTimes(state.settings,`${month}-01`,last).filter(when=>Date.parse(when)>Date.now());
  const allSlots=[...new Set([...recurring,...bindings.map(b=>b.when),...state.slots.map(s=>s.id)])].sort();
  const daySlots=allSlots.filter(when=>localDate.format(new Date(when))===day);
  const dayTopics=topics.filter(topic=>inRange(day,topic.startDate,topic.endDate));
  const binding=bindings.find(item=>item.when===selectedSlot);
  const history=state.slots.find(item=>item.id===selectedSlot);
  function suggestedTopics(when:string) {
    if(!when||!recurring.includes(when))return [];
    const date=localDate.format(new Date(when));
    return topics.filter(topic=>topic.postId&&topic.draft?.plan?.when===when&&inRange(date,topic.startDate,topic.endDate)&&!bindings.some(item=>item.postId===topic.postId));
  }
  const suggestions=suggestedTopics(selectedSlot);
  const slotPost=state.posts.find(post=>post.id===(history?history.postId:binding?.postId));
  const slotTopic=slotPost&&topics.find(topic=>topic.postId===slotPost.id);
  const activePost=state.posts.find(post=>post.id===active?.postId);
  const activeEvidence=evidence&&evidence.topicId===active?.id&&evidence.revision===activePost?.topicDraftJobId?evidence:null;
  const activeBinding=bindings.find(item=>item.postId===activePost?.id);
  const canRefresh=!!activeBinding&&Date.parse(activeBinding.when)-Date.now()>86400000&&state.settings.topicAutoPublish;
  const activeSuggestion=active?.draft?.plan?.when;
  const hasActiveSuggestion=!!activeSuggestion&&Date.parse(activeSuggestion)>Date.now()&&!!active&&inRange(localDate.format(new Date(activeSuggestion)),active.startDate,active.endDate)&&
    state.settings.weekdays.includes(new Date(`${localDate.format(new Date(activeSuggestion))}T00:00:00Z`).getUTCDay())&&
    state.settings.times.includes(localTime.format(new Date(activeSuggestion)))&&!bindings.some(item=>item.when===activeSuggestion);
  const draftEnd=draft?.range?draft.endDate:draft?.startDate;
  const draftSlots=draft&&draftEnd&&/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate)&&/^\d{4}-\d{2}-\d{2}$/.test(draftEnd)&&draftEnd>=draft.startDate
    ? slotTimes(state.settings,[draft.startDate,today].sort()[1],draftEnd).filter(when=>Date.parse(when)>Date.now()) : [];
  const currentBinding=draft?.postId ? bindings.find(item=>item.postId===draft.postId) : undefined;
  const keepsBinding=Boolean(draft&&draftEnd&&currentBinding&&inRange(localDate.format(new Date(currentBinding.when)),draft.startDate,draftEnd));
  const choices=state.posts.filter(post=>post.id===draft?.postId||(post.status==='approved'&&!topics.some(topic=>topic.postId===post.id)));

  function selectDay(value:string) {
    setDay(value);setSelectedSlot('');setActiveId('');setFileErrors([]);
  }
  function navigateMonth(offset:number) {
    const target=new Date(first);target.setUTCMonth(first.getUTCMonth()+offset);
    const value=target.toISOString().slice(0,7);setMonth(value);selectDay(value===today.slice(0,7)?today:`${value}-01`);
  }
  function editTopic(topic?:Topic) {
    const post=state.posts.find(item=>item.id===topic?.postId);
    const reserved=bindings.find(item=>item.postId===post?.id);
    const proposed=topic?.draft?.plan?.when??'';
    const when=topic&&!reserved&&post?.status==='approved'&&suggestedTopics(proposed).some(item=>item.id===topic.id)&&!bindings.some(item=>item.when===proposed)?proposed:'';
    setDraft({id:topic?.id,version:topic?.version,title:topic?.title??'',startDate:topic?.startDate??day,endDate:topic?.endDate??day,
      range:!!topic&&topic.startDate!==topic.endDate,postId:post?.id??'',when,postVersion:post?.version,revision:reserved?.revision??null});
  }
  function selectTopic(id:string) {
    setActiveId(id);setFileErrors([]);setMaterialMode('file');
  }
  async function saveDraft(form:TopicDraft) {
    const payload:Record<string,unknown>={title:form.title,startDate:form.startDate,endDate:form.range?form.endDate:form.startDate,version:form.version};
    const linked=topics.find(topic=>topic.id===form.id)?.postId;
    const when=form.when||(!linked&&form.postId?currentBinding?.when:'');
    if (when) payload.schedule={postId:form.postId,when,version:form.postVersion,revision:form.revision};
    const topic=await call<Topic>(form.id?`/api/topics/${form.id}`:'/api/topics',form.id?'PUT':'POST',payload);
    const focus=when?localDate.format(new Date(when)):topic.startDate;
    setMonth(focus.slice(0,7));selectDay(focus);setSelectedSlot(when||'');selectTopic(topic.id);setDraft(null);
  }
  async function importFiles(files:FileList|null) {
    if (!active||!files?.length||busy) return;
    const selected=Array.from(files);
    setFileErrors([]);
    await action('匯入主題素材',async()=>{
      const errors:string[]=[];
      for (const file of selected) {
        try {
          if (/\.txt$/i.test(file.name)) {
            if (file.size>100_000) throw new Error('文字檔上限為 100 KB');
            const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()).trim();
            if (text.length<20||text.length>24000) throw new Error('文字需介於 20 到 24,000 字元');
            await call('/api/articles','POST',{topicId:active.id,title:file.name.slice(0,200),text});
          } else if (/\.(jpe?g|png|webp)$/i.test(file.name)) {
            if (file.size>10_000_000) throw new Error('圖片上限為 10 MB');
            if (demo) await call('/api/demo/topic-image','POST',{topicId:active.id,label:file.name});
            else {
              const res=await fetch(`/api/media/upload?topicId=${encodeURIComponent(active.id)}`,{
                method:'POST',headers:{'Content-Type':file.type,'X-File-Name':encodeURIComponent(file.name)},body:file,
              });
              if(!res.ok) {
                const error=await res.json() as {error?:string};
                throw new Error(error.error||'圖片匯入失敗');
              }
            }
          } else throw new Error('請使用 TXT、JPG、PNG 或 WebP');
        } catch(error) {
          errors.push(`${file.name}：${error instanceof Error?error.message:'匯入失敗'}`);
        }
      }
      setFileErrors(errors);
    },'');
  }

  return <section className="panel topic-calendar" aria-label="主題日曆">
    <div className="panel-heading topic-heading">
      <h2><CalendarDays size={19}/>主題日曆</h2>
      <button className="btn primary" onClick={()=>editTopic()} disabled={!!busy}><Plus size={16}/>新增主題</button>
    </div>
    <div className="topic-calendar-layout">
      <div className="topic-month">
        <div className="topic-month-nav">
          <button className="icon-btn" aria-label="上個月" onClick={()=>navigateMonth(-1)}><ChevronLeft size={20}/></button>
          <strong>{month.slice(0,4)} 年 {Number(month.slice(5))} 月</strong>
          <button className="icon-btn" aria-label="下個月" onClick={()=>navigateMonth(1)}><ChevronRight size={20}/></button>
        </div>
        <div className="topic-grid">
          {['一','二','三','四','五','六','日'].map(label=><span className="topic-weekday" key={label}>{label}</span>)}
          {Array.from({length:(first.getUTCDay()+6)%7},(_,i)=><span key={`empty-${i}`}/>)}
          {days.map(value=>{
            const count=topics.filter(topic=>inRange(value,topic.startDate,topic.endDate)).length;
            const slots=allSlots.filter(when=>localDate.format(new Date(when))===value).length;
            return <button key={value} className={value===day?'selected':''} aria-pressed={value===day} aria-current={value===today?'date':undefined}
              aria-label={`${value}，${count} 個主題，${slots} 個發文時段`} onClick={()=>selectDay(value)}>
              {Number(value.slice(-2))}<span className="topic-dots">{count>0&&<i/>}{slots>0&&<i className="slot-dot"/>}</span>
            </button>;
          })}
        </div>
        <p className="topic-legend"><span><i/>主題</span><span><i className="slot-dot"/>發文時段</span><span>台北時間</span></p>
      </div>
      <div className="topic-agenda">
        <h3>{day}</h3>
        {dayTopics.map(topic=><button className="topic-agenda-row" key={topic.id} onClick={()=>selectTopic(topic.id)} aria-pressed={active?.id===topic.id}>
          <strong>{topic.title}</strong><small>{topic.startDate===topic.endDate?'單日主題':`${topic.startDate} ～ ${topic.endDate}`}</small>
        </button>)}
        {daySlots.map(when=>{
          const planned=bindings.find(item=>item.when===when);
          const record=state.slots.find(item=>item.id===when);
          const post=state.posts.find(item=>item.id===(record?record.postId:planned?.postId));
          const suggested=suggestedTopics(when).length;
          return <button className="topic-agenda-row" key={when} aria-pressed={when===selectedSlot} onClick={()=>setSelectedSlot(when)}>
            <strong>{localTime.format(new Date(when))}　{post?.title??(record?.status?statusNames[record.status]:'共用發文時段')}</strong>
            <small>{record?.status?statusNames[record.status]:planned?'已綁定稿件':'依一般佇列選稿'}{suggested>0&&` · ${suggested} 篇主題建議稿`}</small>
          </button>;
        })}
        {!dayTopics.length&&!daySlots.length&&<p>這一天沒有主題或發文時段。</p>}
        {selectedSlot&&<div className="topic-detail">
          <h4>{timeLabel(selectedSlot)}</h4>
          {slotPost?<><strong>{slotPost.title}</strong><p>{statusNames[slotPost.status]} · {slotPost.channels.map(channel=>platformNames[channel]).join('、')}</p>
            {slotPost.approvedBy==='ai'&&slotPost.status==='approved'&&<p>{state.settings.topicAutoPublish?'AI 已核准':'AI 自動發文已停用'}</p>}
            <button className="btn secondary" onClick={()=>onOpenPost(slotPost)}>檢視稿件</button>
            {slotTopic&&<button className="btn secondary" disabled={!!busy} onClick={()=>{selectTopic(slotTopic.id);editTopic(slotTopic);}}>編輯主題或改期</button>}
          </>:<p>{history?.message||'尚未綁定稿件。'}</p>}
          {suggestions.map(topic=>{
            const post=state.posts.find(item=>item.id===topic.postId);
            return post&&<div key={topic.id} className="topic-suggestion"><strong>{post.title}</strong><p>AI 建議時段 · {post.status==='approved'?'待排定':'待人工核准'}</p>
              <button className="btn secondary" onClick={()=>onOpenPost(post)}>檢視建議稿</button>
              <button className="btn secondary" disabled={!!busy} onClick={()=>selectTopic(topic.id)}>查看備稿與來源</button>
            </div>;
          })}
        </div>}
      </div>
    </div>

    {draft&&<form className="topic-editor" onSubmit={event=>{event.preventDefault();void action('儲存主題',()=>saveDraft(draft),'主題已儲存');}}>
      <h3>{draft.id?'編輯主題':'新增主題'}</h3>
      <label>主題名稱<input autoFocus required maxLength={120} value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></label>
      <div className="topic-form-grid">
        <label>日期類型<select value={draft.range?'range':'single'} onChange={event=>setDraft({...draft,range:event.target.value==='range',when:''})}><option value="single">單日</option><option value="range">日期區間</option></select></label>
        <label>{draft.range?'開始日期':'主題日期'}<input type="date" min="0001-01-01" max="9999-12-31" required value={draft.startDate} onChange={event=>setDraft({...draft,startDate:event.target.value,when:''})}/></label>
        {draft.range&&<label>結束日期<input type="date" required min={draft.startDate} max="9999-12-31" value={draft.endDate} onChange={event=>setDraft({...draft,endDate:event.target.value,when:''})}/></label>}
      </div>
      <label>綁定核准稿（選填）<select value={draft.postId} disabled={Boolean(topics.find(topic=>topic.id===draft.id)?.postId)} onChange={event=>{
        const post=state.posts.find(item=>item.id===event.target.value),reserved=bindings.find(item=>item.postId===post?.id);
        setDraft({...draft,postId:post?.id??'',postVersion:post?.version,revision:reserved?.revision??null,when:''});
      }}><option value="">稍後綁定</option>{choices.map(post=><option key={post.id} value={post.id}>{post.title}</option>)}</select></label>
      {draft.postId&&(currentBinding||state.posts.find(post=>post.id===draft.postId)?.status==='approved')&&<label>發文時段<select value={draft.when} required={!keepsBinding} onChange={event=>setDraft({...draft,when:event.target.value})}>
        <option value="">{keepsBinding&&currentBinding?`沿用 ${timeLabel(currentBinding.when)}`:'請選擇既有的發文時段'}</option>
        {draftSlots.filter(when=>!bindings.some(item=>item.when===when&&item.postId!==draft.postId)).map(when=><option key={when} value={when}>{timeLabel(when)}</option>)}
      </select>{!keepsBinding&&!draftSlots.length&&<small>所選日期內沒有未來的發文時段。</small>}
        {draftSlots.length>=120&&<small>顯示最早的可選時段。可縮短日期區間查看較晚的時段。</small>}
        {currentBinding&&draft.when&&draft.when!==currentBinding.when&&<small>儲存後發文時段會從 {timeLabel(currentBinding.when)} 移至 {timeLabel(draft.when)}。</small>}
      </label>}
      <div className="topic-actions"><button type="button" className="btn secondary" onClick={()=>setDraft(null)}>取消</button><button className="btn primary" disabled={!!busy}>儲存主題</button></div>
    </form>}

    {active&&<section className="topic-materials" aria-label="主題素材">
      <div className="topic-material-heading"><h3>{active.title} · 素材</h3><button className="btn secondary" disabled={!!busy} onClick={()=>editTopic(active)}>編輯主題或改期</button></div>
      <div className="topic-detail topic-draft-status" aria-live="polite">
        <strong>{active.draft ? stageNames[active.draft.stage] : activePost?'已有主題稿':!state.settings.aiEnabled?'AI 產稿尚未啟用':active.materials.some(item=>item.kind==='article')?'等待備稿':'匯入文字或文章後開始備稿'}</strong>
        {active.draft?.error&&<p>{active.draft.error}</p>}
        {activePost?.topicNeedsReview&&<p>關鍵資料有變更，舊稿已停用，請重新核對。</p>}
        {activePost?.topicReview&&!activePost.topicNeedsReview&&<p>{activePost.topicReview.verdict==='pass'?'AI 審核通過':activePost.topicReview.verdict==='conflict'?'來源資訊衝突：需人工確認':'AI 審核未通過'} · {activePost.topicReview.reason}</p>}
        {active.draft?.replacementReason&&<p>換稿原因：{active.draft.replacementReason}</p>}
        {state.runtime.aiPaused&&!activePost&&<p>{state.runtime.aiPaused.reason}</p>}
        {active.draft?.plan&&<><p>發文目的：{active.draft.plan.purpose}</p><p>切入點：{active.draft.plan.angle}</p>
          {!bindings.some(item=>item.postId===active.postId)&&<p>{hasActiveSuggestion?`建議時段：${timeLabel(activeSuggestion)}`:'目前沒有可用的建議時段'}</p>}
        </>}
        {active.draft?.searchNote&&<p>{active.draft.searchNote}</p>}
        {active.draft?.status==='failed'&&<button className="btn secondary" disabled={!!busy} onClick={()=>void action('重試主題備稿',async()=>{await call(`/api/topics/${active.id}/draft`);},'已加入備稿工作')}>重試備稿</button>}
        {activePost&&<button className="btn secondary" onClick={()=>onOpenPost(activePost)}>檢視主題稿</button>}
        {activePost?.topicDraftJobId&&<button className="btn secondary" disabled={!!busy} onClick={()=>void action('讀取備稿來源',async()=>{
          const result=await call<{revision:string;sources:TopicSource[]}>(`/api/topics/${active.id}/draft`,'GET');setEvidence({topicId:active.id,revision:result.revision,sources:result.sources});
        },'')}>查看備稿來源</button>}
        {activePost?.topicDraftJobId&&['draft','approved'].includes(activePost.status)&&!demo&&<button className="btn secondary" aria-pressed={!!activePost.topicDraftLocked} disabled={!!busy} onClick={()=>void action('更新鎖稿狀態',async()=>{
          await call(`/api/topics/${active.id}/lock`,'POST',{locked:!activePost.topicDraftLocked,version:activePost.version});
        },activePost.topicDraftLocked?'已解除鎖稿':'已鎖稿')}>{activePost.topicDraftLocked?'解除鎖稿':'鎖定稿件'}</button>}
        {activePost?.topicDraftJobId&&canRefresh&&!activePost.topicDraftLocked&&!demo&&<button className="btn secondary" disabled={!!busy||active.draft?.status==='running'||active.draft?.status==='pending'} onClick={()=>void action('安排新版',async()=>{
          await call(`/api/topics/${active.id}/refresh`);
        },'已安排新版備稿與審核')}>重新備稿</button>}
        {activeEvidence&&activePost?.topicReview?.facts.map((fact,index)=><p key={index}>
          <strong>{fact.field}</strong>{' · '}<a href={`#topic-source-${fact.sourceId}`} onClick={()=>{
            const source=document.getElementById(`topic-source-${fact.sourceId}`);
            if(source instanceof HTMLDetailsElement)source.open=true;
          }}>{activeEvidence.sources.find(source=>source.id===fact.sourceId)?.title}</a><br/>{fact.quote}
        </p>)}
        {activeEvidence?.sources.map(source=><details key={source.id} id={`topic-source-${source.id}`}>
          <summary>{source.kind==='web'?'公開參考':'主題素材'} · {source.title}</summary>
          {source.url&&<a href={source.url} target="_blank" rel="noreferrer">開啟來源</a>}
          <p>擷取時間：{timeLabel(source.capturedAt)}</p><p className="original-text">{source.text}</p>
        </details>)}
      </div>
      <div className="tabs">{(['file','text','url'] as const).map((mode,i)=><button key={mode} className={materialMode===mode?'active':''} onClick={()=>setMaterialMode(mode)}>{['上傳檔案','貼上文字','匯入網址'][i]}</button>)}</div>
      {materialMode==='file'?<>
        <input hidden ref={fileInput} type="file" multiple accept=".txt,.jpg,.jpeg,.png,.webp" onChange={event=>{void importFiles(event.target.files);event.target.value='';}}/>
        <button className={`topic-drop ${drag?'drag':''}`} disabled={!!busy} onClick={()=>fileInput.current?.click()}
          onDragOver={event=>{event.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={event=>{event.preventDefault();setDrag(false);void importFiles(event.dataTransfer.files);}}>
          <Upload size={21}/>拖放檔案或點選上傳<small>UTF-8 TXT、JPG、PNG、WebP</small>
        </button>
      </>:<form key={`${active.id}-${materialMode}`} onSubmit={event=>{
        event.preventDefault();const form=event.currentTarget,data=new FormData(form);
        void action('匯入主題素材',async()=>{
          await call(materialMode==='url'?'/api/articles/import':'/api/articles','POST',{...Object.fromEntries(data),topicId:active.id});form.reset();
        },'已加入主題素材');
      }}>
        {materialMode==='url'?<label>公開文章網址<input name="url" type="url" required maxLength={2000}/></label>:<><label>素材標題<input name="title" required maxLength={200}/></label><label>原文<textarea name="text" required minLength={20} maxLength={24000} rows={4}/></label></>}
        <button className="btn primary" disabled={!!busy}>加入主題素材</button>
      </form>}
      {fileErrors.length>0&&<ul className="alert" role="alert">{fileErrors.map((error,i)=><li key={i}>{error}</li>)}</ul>}
      <div className="topic-material-list">{active.materials.map(item=>{
        if(item.kind==='media') {
          const photo=state.media.find(media=>media.id===item.id);
          return photo&&<div key={item.id}><img src={mediaUrl(photo)} alt=""/><span>{photo.label}</span></div>;
        }
        const article=state.articles.find(source=>source.id===item.id);
        return article&&<TopicArticle key={item.id} article={article} demo={demo} call={call}/>;
      })}</div>
    </section>}
  </section>;
}

function TopicArticle({article,demo,call}:{article:State['articles'][number];demo:boolean;call:Call}){
  const [original,setOriginal]=useState(demo?article.text:undefined);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  return <details onToggle={event=>{
    if(!event.currentTarget.open||original!==undefined||loading)return;
    setLoading(true);setError('');
    void call<State['articles'][number]>(`/api/articles/${article.id}`,'GET')
      .then(result=>setOriginal(result.text))
      .catch(error=>setError(error instanceof Error?error.message:'無法讀取原文'))
      .finally(()=>setLoading(false));
  }}>
    <summary><FileText size={16}/>{article.title}</summary>
    {article.url&&<a href={article.url} target="_blank" rel="noreferrer">開啟來源</a>}
    <p className="original-text">{original??(error||'正在讀取原文…')}</p>
  </details>;
}
