import {dueSlots, matchesRules, taipeiDate, weekStart} from './core.mjs';

export function articleExpiry(article,settings) {
  const reference=article.publishedAt||article.createdAt;
  const ageEnd=Date.parse(reference)+settings.sourceMaxAgeDays*86400000;
  const explicit=Date.parse(article.assessment?.expiresAt||'');
  const end=Number.isFinite(explicit)?Math.min(ageEnd,explicit):ageEnd;
  return Number.isFinite(end)?new Date(end).toISOString():'';
}

export function selectionCheck(article,settings,now=new Date()) {
  const reasons=[];
  if(article.archivedAt)reasons.push('素材已封存');
  if(article.duplicateOf)reasons.push('相同原文已存在素材庫');
  if(!matchesRules(article,settings))reasons.push('未符合主題／關鍵字，或命中排除詞');
  const expiresAt=articleExpiry(article,settings);
  if(expiresAt&&Date.parse(expiresAt)<=now.getTime())reasons.push('素材已超過選稿時效或活動期限');
  if((article.text||'').replace(/\s/g,'').length<settings.selectionMinChars)reasons.push(`原文少於 ${settings.selectionMinChars} 字，資訊不足`);
  return {eligible:reasons.length===0,reasons,expiresAt,dateBasis:article.publishedAt?'來源發佈日':'擷取日'};
}

const titleWords=new Intl.Segmenter('zh-Hant',{granularity:'word'});
function selectionProfile(article){
  const host=URL.canParse(article.url)?new URL(article.url).hostname.replace(/^www\./,''):'';
  const words=new Set(Array.from(titleWords.segment(article.title.normalize('NFKC').toLowerCase()))
    .filter(word=>word.isWordLike&&word.segment.length>=2&&!/^\d+$/.test(word.segment)).map(word=>word.segment));
  return {source:article.sourceId||'',host,category:article.category==='其他'?'':article.category,url:article.url,words};
}

export function diversifyArticles(candidates,recent,limit=candidates.length){
  const used=recent.map(selectionProfile);
  const pool=candidates.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(article=>({article,profile:selectionProfile(article)}));
  const ordered=[];
  while(pool.length&&ordered.length<limit){
    const score=({profile})=>used.reduce((total,previous)=>{
      const sameSource=(profile.host&&profile.host===previous.host)||(profile.source&&profile.source===previous.source);
      const sameCategory=profile.category&&profile.category===previous.category;
      const overlap=[...profile.words].filter(word=>previous.words.has(word)).length;
      const similar=overlap>=2&&overlap/Math.max(1,Math.min(profile.words.size,previous.words.size))>=.34;
      return total+(sameSource?3:0)+(sameCategory?2:0)+(similar?4:0)+(profile.url&&profile.url===previous.url?10:0);
    },0);
    const best=pool.reduce((best,item,index)=>{
      const value=score(item);
      return value<best.score?{index,score:value}:best;
    },{index:0,score:Infinity});
    const [chosen]=pool.splice(best.index,1);
    ordered.push(chosen.article);used.push(chosen.profile);
  }
  return ordered;
}

export function draftWindow(settings,lastRun,now=new Date()) {
  if(settings.draftMode!=='scheduled')return {due:true,slot:''};
  const from=new Date(lastRun||now.toISOString());
  const slots=dueSlots({...settings,scheduleEnabled:true,weekdays:settings.draftWeekdays,times:settings.draftTimes},from,now);
  const recent=slots.filter(slot=>now.getTime()-Date.parse(slot)<=15*60000);
  return {due:recent.length>0,slot:recent.at(-1)||''};
}

export function draftCapacity(jobs,settings,now=new Date()) {
  const counted=jobs.filter(job=>job.automatic&&job.status!=='cancelled');
  const today=taipeiDate(now),week=weekStart(now);
  const daily=counted.filter(job=>taipeiDate(new Date(job.createdAt))===today).length;
  const weekly=counted.filter(job=>taipeiDate(new Date(job.createdAt))>=week).length;
  return Math.max(0,Math.min(settings.dailyDraftLimit-daily,settings.weeklyLimit-weekly));
}

export function maintainArticles(store,now=new Date()) {
  const settings=store.kv('settings');
  const busy=new Set(store.list('generation_jobs').filter(job=>['pending','running'].includes(job.status)).map(job=>job.articleId));
  for(const article of store.list('articles')) {
    if(article.archivedAt||busy.has(article.id))continue;
    if(now.getTime()-Date.parse(article.createdAt)<settings.archiveAfterDays*86400000)continue;
    store.put('articles',{...article,archivedAt:now.toISOString()});
  }
}
