import { categories, platforms, type State, type Post, type Media, type Settings, type Topic, type SlotBinding } from './types';
const id=()=>crypto.randomUUID();
function graphic(title:string,color='#23644e') {
  const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" fill="${color}"/><circle cx="850" cy="280" r="230" fill="#dce9b9" opacity=".13"/><path d="M-40 700Q240 400 530 700T1120 630V1080H0" fill="#e4efc7" opacity=".12"/><rect x="95" y="400" width="8" height="90" fill="#dce9b9"/><g font-family="sans-serif" fill="#f9f8ef"><text x="95" y="140" font-size="30" letter-spacing="4">CAMPUS STORIES</text><text x="135" y="480" font-size="58" font-weight="bold">${escape(title.slice(0,13))}</text><text x="135" y="565" font-size="58" font-weight="bold">${escape(title.slice(13,26))}</text><text x="95" y="960" font-size="27">示範圖卡 · 非實際活動</text></g></svg>`)}`;
}
export function demoMedia(title:string,color?:string):Media{return {id:id(),label:title,width:1080,height:1080,bytes:0,public:false,createdAt:new Date().toISOString(),preview:graphic(title,color)};}
function demoUpcoming(settings:Settings){const result:string[]=[],now=new Date(),day=new Date(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',dateStyle:'short'}).format(now)+'T12:00:00+08:00');for(let i=0;i<14;i++){if(settings.weekdays.includes(day.getUTCDay())){const text=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',dateStyle:'short'}).format(day);for(const time of settings.times){const when=new Date(`${text}T${time}:00+08:00`);if(when>now)result.push(when.toISOString());}}day.setUTCDate(day.getUTCDate()+1);}return result.sort();}
export function demoState():State {
  const now=new Date().toISOString(),images=[demoMedia('把課堂裡的想像，變成手中的作品'),demoMedia('在交流中，發現新的可能','#637460'),demoMedia('每一份努力，都值得被看見','#a37852')];
  const settings:Settings={draftMode:'after_scan',draftWeekdays:[1,2,3,4,5],draftTimes:['08:30','15:00'],dailyDraftLimit:2,archiveAfterDays:90,selectionMinChars:200,aiSelectionEnabled:false,selectionMinScore:70,selectionMinFacts:3,selectionRules:'依主題選擇事實足夠的單篇文章',autoArtwork:'manual',imageRules:'使用主題配圖，保留可編輯文字圖層',unitName:'範例單位',audience:'關心單位消息的學生與家長',tone:'親切、有活力，使用繁體中文',topics:'學習成果,校園生活',keywords:'',excludes:'',captionMinChars:200,captionMaxChars:300,weeklyLimit:5,scanMinutes:120,sourceMaxAgeDays:30,scheduleEnabled:true,weekdays:[1,3,5],times:['10:00'],channels:[...platforms],catchUpMinutes:30,notifyEmail:'editor@example.org',digestTime:'09:00',brandColor:'#23644e',logoMediaId:'',aiProvider:'codex',aiEnabled:true,apiTextModel:'gpt-4.1-mini',imageEnabled:false,imageProvider:'codex',imageModel:'gpt-image-2.5-sunburst',monthlyBudget:10,textReserve:.1,imageReserve:1};
  const titles=['把課堂裡的想像，變成手中的作品','在交流中，發現新的可能','每一份努力，都值得被看見'];
  const articles=titles.map((title,i)=>({id:`example-a${i}`,sourceId:'example-source',title,text:`示範素材：${title}。從討論、嘗試到分享，記錄學習中的每一個小小進展。這段內容僅供介面操作示範，並非真實新聞或活動公告。`,url:'https://example.org/news',imageUrls:[],mediaIds:[images[i].id],status:i===0?'available':'drafted',createdAt:now}));
  const posts:Post[]=titles.map((title,i)=>({id:`example-p${i}`,title,sourceId:articles[i].id,variants:Object.fromEntries(platforms.map(p=>[p,`${p==='threads'?'今天想分享一個小小的學習時刻。':title+' 🌿'}\n\n${articles[i].text}\n\n#學習日常 #單位故事`])) as Post['variants'],mediaIds:[images[i].id],channels:[...platforms],status:i===0?'draft':'approved',backup:i===2,expiresAt:'',imagePrompt:'以溫暖的綠色調描繪學習與交流的概念插畫。',reviewHash:'demo',queueOrder:i,createdAt:now,updatedAt:now,version:1}));
  const upcoming=demoUpcoming(settings);
  return {settings,settingsVersion:1,sources:[{id:'example-source',name:'單位消息（示範）',url:'https://example.org/news',kind:'website',enabled:true,articleSelector:'',linkPattern:'',createdAt:now,lastScanAt:now,lastNewCount:3}],articles,posts,media:images,publications:[],slots:[],jobs:[],events:[{id:id(),created_at:now,level:'info',message:'歡迎探索示範工作台，內容與圖片均為操作示意。'}],mail:[],upcoming,runtime:{channels:{facebook:{ready:false,missing:[]},instagram:{ready:false,missing:[]},threads:{ready:false,missing:[]},line:{ready:false,missing:[]}},secretStatus:{},environmentKeys:[],publicBaseUrl:'',codex:{ready:false,message:'示範模式不會呼叫 AI'},aiPaused:null,aiVerified:null,reserved:0}};
}
export function simulate(state:State,url:string,method:string,body:Record<string,unknown>={}):{state:State;result:unknown} {
  const next=structuredClone(state),now=new Date().toISOString();let result:unknown={ok:true};
  if(url==='/api/material-categories') {
    const options=next.categories??[...categories];
    const previous=method==='POST'?null:String(body.previous),name=method==='DELETE'?null:String(body.name).trim();
    if(previous==='其他'||(previous&&!options.includes(previous)))throw new Error('無法變更這個分類');
    if(name&&(name.toLowerCase()==='all'||options.some(option=>option!==previous&&option.toLowerCase()===name.toLowerCase())))throw new Error('此分類名稱已使用或為保留名稱');
    if(!previous&&options.length>=50)throw new Error('最多可設定 50 個分類');
    if(previous)for(const item of [...next.articles,...next.sources,...next.posts])if(item.category===previous)item.category=name||'其他';
    next.categories=previous?options.flatMap(option=>option===previous?(name?[name]:[]):[option]):[...options.slice(0,-1),name!,'其他'];
    result={categories:next.categories};
  }
  else if(url==='/api/topics'||/^\/api\/topics\/[^/]+$/.test(url)) {
    const topics=next.topics??=[],bindings=next.slotBindings??=[];
    const old=topics.find(topic=>topic.id===url.split('/')[3]);
    if(method==='PUT'&&old?.version!==body.version)throw new Error('主題已更新，請重新載入');
    const {title,startDate,endDate,schedule}=body as Pick<Topic,'title'|'startDate'|'endDate'> & {schedule?:Omit<SlotBinding,'revision'>&{revision:string|null;version:number}};
    if(!title.trim()||startDate>endDate)throw new Error('請確認主題名稱和日期');
    const postId=schedule?.postId??old?.postId??null;
    const binding=bindings.find(item=>item.postId===postId),when=schedule?.when??binding?.when;
    if(when){
      const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',dateStyle:'short'}).format(new Date(when));
      if(day<startDate||day>endDate)throw new Error('請選擇主題日期內的發文時段');
    }
    if(schedule){
      const post=next.posts.find(item=>item.id===postId);
      if(post?.status!=='approved'||post.version!==schedule.version||(binding?.revision??null)!==schedule.revision)throw new Error('貼文或時段綁定已變更');
      if(bindings.some(item=>item.when===schedule.when&&item.postId!==postId)||topics.some(topic=>topic.id!==old?.id&&topic.postId===postId))throw new Error('貼文或時段已被使用');
      next.slotBindings=[...bindings.filter(item=>item.postId!==postId),{postId:schedule.postId,when:schedule.when,revision:id()}];
    }
    const topic={...old,id:old?.id??id(),title:title.trim(),startDate,endDate,postId,version:(old?.version??0)+1,materials:old?.materials??[]};
    next.topics=[...topics.filter(item=>item.id!==topic.id),topic];result=topic;
  }
  else if(url==='/api/demo/topic-image') {
    const topic=next.topics?.find(item=>item.id===body.topicId);if(!topic)throw new Error('找不到主題');
    const media=demoMedia(String(body.label));next.media.unshift(media);topic.materials.push({kind:'media',id:media.id});result=media;
  }
  else if(url==='/api/settings'){next.settings=body.settings as Settings;next.settingsVersion++;next.upcoming=demoUpcoming(next.settings);result={version:next.settingsVersion};}
  else if(url==='/api/automation/preview'){result={at:now,lastScan:now,nextScan:new Date(Date.now()+Number((body.settings as Settings)?.scanMinutes||120)*60000).toISOString(),capacity:2,eligibleCount:0,candidates:[]};}
  else if(/^\/api\/articles\/[^/]+\/archive$/.test(url)){const key=url.split('/')[3];next.articles=next.articles.map(a=>a.id===key?{...a,archivedAt:body.archived?now:''}:a);}
  else if(/^\/api\/articles\/[^/]+\/category$/.test(url)){const key=url.split('/')[3];next.articles=next.articles.map(a=>a.id===key?{...a,category:String(body.category)}:a);}
  else if(url==='/api/sources'){const source={...body,id:id(),createdAt:now};next.sources.unshift(source as State['sources'][number]);result=source;}
  else if(/^\/api\/sources\//.test(url)){const key=url.split('/')[3];next.sources=next.sources.filter(s=>method==='DELETE'?s.id!==key:true);if(method==='PUT')next.sources=next.sources.map(s=>s.id===key?{...s,...body}:s);}
  else if(url==='/api/articles'||url==='/api/articles/import'){const article={id:id(),sourceId:'',title:String(body.title||'匯入文章（示範）'),text:String(body.text||'這是示範擷取結果，正式工作區會實際讀取指定的公開文章頁。'),url:String(body.url||''),imageUrls:[],mediaIds:[],status:'available',createdAt:now};next.articles.unshift(article);next.topics?.find(topic=>topic.id===body.topicId)?.materials.push({kind:'article',id:article.id});result=article;}
  else if(/^\/api\/articles\/[^/]+\/draft$/.test(url)){const article=next.articles.find(a=>a.id===url.split('/')[3]);if(article){const post={...next.posts[0],id:id(),title:article.title,sourceId:article.id,mediaIds:article.mediaIds,variants:Object.fromEntries(platforms.map(p=>[p,`${article.title}\n\n${article.text.slice(0,p==='threads'?350:2000)}\n\n（示範模板，未呼叫 AI）`])),status:'draft',backup:false,version:1,createdAt:now};next.posts.unshift(post as Post);result={id:id(),status:'completed'};}}
  else if(url==='/api/posts'){const post={...body,id:id(),status:'draft',reviewHash:'',queueOrder:Date.now(),createdAt:now,updatedAt:now,version:1};next.posts.unshift(post as Post);result=post;}
  else if(/^\/api\/posts\/[^/]+$/.test(url)){const key=url.split('/')[3],old=next.posts.find(p=>p.id===key);if(method==='DELETE'){if(!old)throw new Error('找不到貼文');if(next.publications.some(j=>j.postId===key))throw new Error('有送出紀錄的貼文需保留供核對');if(old.version!==body.version||old.status!=='draft')throw new Error('這篇內容已更新，請重新載入後再操作');next.posts=next.posts.filter(p=>p.id!==key);}else if(old){const post={...old,...body,version:old.version+1,status:'draft'} as Post;next.posts=next.posts.map(p=>p.id===key?post:p);result=post;}}
  else if(/^\/api\/posts\/[^/]+\//.test(url)){const key=url.split('/')[3],action=url.split('/')[4],old=next.posts.find(p=>p.id===key);if(old){if(action==='duplicate'){const post={...old,id:id(),status:'draft',backup:false,version:1} as Post;next.posts.unshift(post);result=post;}else{old.status=action==='approve'?'approved':action==='publish'?'published':'draft';old.version++;result=old;if(action==='publish')next.publications.push(...old.channels.map(channel=>({id:id(),postId:old.id,channel,slotId:now,status:'sent',phase:'completed',createdAt:now,updatedAt:now})));}}}
  else if(url==='/api/queue'){(body.ids as string[]).forEach((key,i)=>{const post=next.posts.find(p=>p.id===key);if(post)post.queueOrder=i;});}
  else if(url.startsWith('/api/media/')){const media=demoMedia(String(body.title||'新圖片（示範）'),next.settings.brandColor);if(url==='/api/media/card'){media.kind='card';media.cardRecipe=body as unknown as NonNullable<Media['cardRecipe']>;media.sourcePostId=String(body.postId||'');}else if(url==='/api/media/generate'){media.kind='ai';media.sourcePostId=String(body.postId||'');}next.media.unshift(media);result=media;}
  else if(url==='/api/ai/check')result={ready:false,message:'示範模式不會執行主機登入檢查'};
  else if(url==='/api/ai/resume')next.runtime.aiPaused=null;
  else if(url==='/api/secrets')for(const k of Object.keys(body))next.runtime.secretStatus[k]=!!body[k];
  else if(url.includes('/check'))result={message:'示範模式不會連線至真實帳號'};
  next.events.unshift({id:id(),created_at:now,level:'info',message:'示範操作已更新；沒有寫入正式工作區或對外發佈。'});
  return {state:next,result};
}
