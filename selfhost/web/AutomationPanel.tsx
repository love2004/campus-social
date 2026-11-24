import {useState} from 'react';
import {type Settings,type State} from './types';
import './automation.css';

type Preview={at:string;lastScan:string|null;nextScan:string;capacity:number;eligibleCount:number;candidates:{id:string;title:string;eligible:boolean;reasons:string[];expiresAt:string;dateBasis:string}[]};
type Props={state:State;busy:string;action:(label:string,fn:()=>Promise<void>,success?:string)=>Promise<void>;call:<T=unknown>(url:string,method?:string,body?:Record<string,unknown>)=>Promise<T>};
const stamp=(s:string|null)=>s?new Date(s).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'尚未執行';

export default function AutomationPanel({state,busy,action,call}:Props){
  const [form,setForm]=useState<Settings>(()=>structuredClone(state.settings));
  const [version,setVersion]=useState(state.settingsVersion);
  const [preview,setPreview]=useState<Preview|null>(null);
  const dirty=JSON.stringify(form)!==JSON.stringify(state.settings);
  const patch=(value:Partial<Settings>)=>{setForm(f=>({...f,...value}));setPreview(null);};
  async function inspect(){setPreview(await call<Preview>('/api/automation/preview','POST',{settings:form}));}
  async function save(){const result=await call<{version:number}>('/api/settings','PUT',{settings:form,version});setVersion(result.version);setPreview(null);}
  return <section className="panel settings-panel automation-panel">
    <div className="panel-heading"><h2>自動選稿、產稿與作圖規則</h2><span>{dirty?'表單已修改，尚未儲存':'已儲存規則 · 產出仍需人工核准'}</span></div>
    <form className="panel-body" onSubmit={e=>{e.preventDefault();void action('儲存自動化規則',save,'自動化規則已儲存');}}>
      <div className="notice-box"><p>來源擷取、自動產稿與對外發佈分別排程。這裡設定擷取與產稿，對外發佈時間請到「週期與日曆」。所有時間採台北時區。</p></div>
      {!form.topics.trim()&&!form.keywords.trim()&&<div className="alert">目前關注主題與包含關鍵字皆為空白，所有來源主題都可能進入候選。可先在「單位與內容方向」填入校名、單位名稱與關注議題，再啟用語意選稿。</div>}
      <div className="form-grid three">
        <label>來源擷取間隔（分鐘）<input type="number" min={15} max={1440} value={form.scanMinutes} onChange={e=>patch({scanMinutes:Number(e.target.value)})}/></label>
        <label>每日自動選稿上限<input type="number" min={1} max={20} value={form.dailyDraftLimit} onChange={e=>patch({dailyDraftLimit:Number(e.target.value)})}/></label>
        <label>每週自動選稿上限<input type="number" min={1} max={100} value={form.weeklyLimit} onChange={e=>patch({weeklyLimit:Number(e.target.value)})}/></label>
      </div>
      <label>自動產稿時機<select value={form.draftMode} onChange={e=>patch({draftMode:e.target.value as Settings['draftMode']})}><option value="after_scan">每次來源整理完成後</option><option value="scheduled">指定每日產稿時段</option></select></label>
      {form.draftMode==='scheduled'&&<>
        <div className="field-label">產稿星期</div><div className="weekday-choices">{[1,2,3,4,5,6,0].map(day=><button type="button" key={day} className={form.draftWeekdays.includes(day)?'selected':''} onClick={()=>patch({draftWeekdays:form.draftWeekdays.includes(day)?form.draftWeekdays.filter(d=>d!==day):[...form.draftWeekdays,day]})}>{['日','一','二','三','四','五','六'][day]}</button>)}</div>
        <label>產稿時段（以逗號分隔）<input value={form.draftTimes.join(', ')} onChange={e=>patch({draftTimes:e.target.value.split(/[,，]/).map(v=>v.trim())})} placeholder="08:30, 15:00"/></label>
        <p className="small-note">主機在時段後 15 分鐘內可領取該批工作。錯過後等待下一個時段，避免恢復主機時大量補產。</p>
      </>}
      <div className="form-grid three">
        <label>素材選稿時效（天）<input type="number" min={1} max={365} value={form.sourceMaxAgeDays} onChange={e=>patch({sourceMaxAgeDays:Number(e.target.value)})}/></label>
        <label>擷取後自動封存（天）<input type="number" min={30} max={730} value={form.archiveAfterDays} onChange={e=>patch({archiveAfterDays:Number(e.target.value)})}/></label>
        <label>自動選稿原文最少字數<input type="number" min={80} max={5000} value={form.selectionMinChars} onChange={e=>patch({selectionMinChars:Number(e.target.value)})}/></label>
      </div>
      <p className="small-note">時效優先依來源發佈日，日期缺失時依擷取日。AI 確認的活動截止日可縮短期限。過期停止自動選稿，封存可還原；系統保留來源及發佈紀錄，不自動永久刪除。</p>
      <label className="check-field"><input type="checkbox" checked={form.aiSelectionEnabled} onChange={e=>patch({aiSelectionEnabled:e.target.checked})}/><span>在關鍵字與時效檢查後，啟用 AI 語意選稿</span></label>
      <label>可審查的選稿規則<textarea rows={5} maxLength={3000} value={form.selectionRules} onChange={e=>patch({selectionRules:e.target.value})}/></label>
      <div className="form-grid"><label>最低相關性分數<input type="number" min={0} max={100} value={form.selectionMinScore} onChange={e=>patch({selectionMinScore:Number(e.target.value)})}/></label><label>至少幾個可核對事實<input type="number" min={1} max={6} value={form.selectionMinFacts} onChange={e=>patch({selectionMinFacts:Number(e.target.value)})}/></label></div>
      <p className="small-note">啟用後會額外使用目前選用的文字 AI 判斷。採用／略過的原因、分數與事實清單會保留在素材中。略過與失敗也計入每日／每週嘗試上限，避免持續消耗額度。</p>
      <label className="check-field"><input type="checkbox" checked={form.topicResearchEnabled??false} onChange={e=>patch({topicResearchEnabled:e.target.checked})}/><span>主題備稿主動搜尋相關公開新聞或文化背景</span></label>
      <p className="small-note">只傳送 AI 擬定的一般公開關鍵字，避免包含私人資料；搜尋未找到可信且相關的內容時，僅使用素材，不會強行加入時事或熱梗。擷取與搜尋一律使用主機已登入的 Codex Web Search。</p>
      <label>自動作圖方式<select value={form.autoArtwork} onChange={e=>patch({autoArtwork:e.target.value as Settings['autoArtwork']})}><option value="manual">文案完成後，由承辦人選圖與製卡</option><option value="template">自動套版圖卡（品牌色底圖，照片另行挑選）</option><option value="source">以素材照片作底圖，再自動加字</option><option value="ai">AI 生成主題底圖，再自動加字</option></select></label>
      {form.autoArtwork!=='manual'&&<label>一般素材自動圖卡數<select value={form.articleCardCount??1} onChange={e=>patch({articleCardCount:Number(e.target.value) as 1|3|4|5})}><option value={1}>1 張</option><option value={3}>3 張</option><option value={4}>4 張</option><option value={5}>5 張</option></select><small>多張圖卡共用一張底圖，首張為封面，其餘使用置中內文。</small></label>}
      {form.autoArtwork==='source'&&<p className="small-note">使用素材第一張可用照片。沒有照片時使用品牌色。</p>}
      {form.autoArtwork!=='manual'&&<label>主題貼文自動圖卡數<select value={form.topicCardCount??1} onChange={e=>patch({topicCardCount:Number(e.target.value) as 1|3|4|5})}><option value={1}>1 張</option><option value={3}>3 張</option><option value={4}>4 張</option><option value={5}>5 張</option></select><small>多張圖卡共用主題底圖，內容會分頁並一併審核。</small></label>}
      <label>可審查的作圖規則<textarea rows={4} maxLength={2000} value={form.imageRules} onChange={e=>patch({imageRules:e.target.value})}/></label>
      {form.autoArtwork==='ai'&&<div className="alert">{(form.imageProvider||'codex')==='codex'?'AI 自動作圖使用 Codex 訂閱，需要在主機登入 ChatGPT 並啟用 AI 生圖；與文字產稿共用額度。':'AI 自動作圖使用 OpenAI API，需要啟用 AI 生圖並設定 API 金鑰，另外計費。'}生圖失敗時保留文案供人工補圖。</div>}
      <div className="rule-summary"><h3>四版本寫稿規則</h3><p>每版正文 {form.captionMinChars}～{form.captionMaxChars} 字，保留背景、來源重點與具體總結。</p><ul><li>Facebook：背景與影響、2～3 重點、總結與一個來源連結。</li><li>Instagram：主題首句、短段落、2～3 重點，搭配圖卡與 0～3 個相關標籤。</li><li>Threads：聚焦單一觀察、具體事實與總結，最多一個來源連結。</li><li>LINE：消息標題、可核對日期／對象／地點、單一行動與來源連結。</li></ul><p>文案與圖卡保留待審狀態，由你核准後才進入發佈。</p></div>
      <div className="automation-actions"><button type="button" className="btn secondary" disabled={!!busy} onClick={()=>void action('檢查規則與候選素材',inspect,'規則預覽已更新')}>先檢查規則與候選素材</button><button className="btn primary" disabled={!!busy}>儲存自動化規則</button></div>
    </form>
    {preview&&<div className="panel-body divided"><h3>依表單規則預覽</h3><p className="small-note">上次擷取 {stamp(preview.lastScan)} · 下次預計 {stamp(preview.nextScan)}<br/>本日與本週剩餘可排入 {preview.capacity} 篇，硬性條件通過 {preview.eligibleCount} 篇。此預覽不呼叫 AI。</p>{preview.candidates.map(item=><div className="rule-candidate" key={item.id}><strong>{item.title}</strong><span>{item.eligible?(form.aiSelectionEnabled?'條件通過，等待 AI 判斷':'條件通過'):item.reasons.join('；')}</span><small>{item.dateBasis} · 有效至 {stamp(item.expiresAt)}</small></div>)}</div>}
  </section>;
}
