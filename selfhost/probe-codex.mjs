import { codexStatus, codexDraft } from './ai.mjs';
import { defaultSettings } from './core.mjs';
const status=await codexStatus();
if(!status.ready){console.error(status.message);process.exitCode=1;}
else {
  console.log('以明確標示的測試素材驗證主機私有產稿；不會發文或改用 API 計費。');
  const result=await codexDraft({title:'產稿連線測試（非真實公告）',text:'這是一則測試素材，僅用於驗證社群草稿的格式。沒有真實活動、日期、人物或招生資訊。請將各平台文案標記為測試，不得當作真實新聞。',url:''},{...defaultSettings(),unitName:'測試單位'});
  console.log(JSON.stringify({completed:true,title:result.title,platformLengths:Object.fromEntries(Object.entries(result.variants).map(([key,value])=>[key,Array.from(value).length]))},null,2));
}
