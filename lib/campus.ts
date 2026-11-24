import { z } from "zod";
export const channelIds=["facebook","instagram","line","threads","linkedin","x","tiktok","youtube","pinterest"] as const;
export type Channel=typeof channelIds[number];
export const channels:{id:Channel;name:string;symbol:string;color:string;detail:string;supported:boolean;docs:string}[]=[
{id:"facebook",name:"Facebook",symbol:"f",color:"#1877f2",detail:"粉絲專頁・文字／圖片貼文",supported:true,docs:"https://developers.facebook.com/docs/pages-api/posts/"},
{id:"instagram",name:"Instagram",symbol:"◎",color:"#d55486",detail:"專業帳號・圖片貼文",supported:true,docs:"https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/"},
{id:"line",name:"LINE 官方帳號",symbol:"LINE",color:"#08b85a",detail:"Messaging API・好友群發",supported:true,docs:"https://developers.line.biz/en/reference/messaging-api/#send-broadcast-message"},
{id:"threads",name:"Threads",symbol:"@",color:"#252a28",detail:"Threads API・文字／圖片貼文",supported:true,docs:"https://developers.facebook.com/docs/threads/"},
{id:"linkedin",name:"LinkedIn",symbol:"in",color:"#0a66c2",detail:"Posts API・文字貼文",supported:true,docs:"https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api"},
{id:"x",name:"X",symbol:"𝕏",color:"#252a28",detail:"X API・文字貼文",supported:true,docs:"https://docs.x.com/x-api/posts/create-post"},
{id:"tiktok",name:"TikTok",symbol:"♪",color:"#252a28",detail:"規劃中・需獨立影音製作流程",supported:false,docs:"https://developers.tiktok.com/doc/content-posting-api-get-started"},
{id:"youtube",name:"YouTube",symbol:"▶",color:"#eb4545",detail:"規劃中・影片上傳，非社群圖文",supported:false,docs:"https://developers.google.com/youtube/v3/docs/videos/insert"},
{id:"pinterest",name:"Pinterest",symbol:"P",color:"#bd2744",detail:"規劃中・Pin 與看板授權",supported:false,docs:"https://developers.pinterest.com/docs/api/v5/"}];
const sourceSchema=z.object({id:z.string().max(100),title:z.string().min(1).max(500),url:z.string().url().max(2000),text:z.string().max(30000),category:z.string().max(80),createdAt:z.string().max(50),demo:z.boolean().default(false)});
const postSchema=z.object({id:z.string().max(100),title:z.string().min(1).max(300),body:z.string().max(12000),sourceId:z.string().max(100),channels:z.array(z.enum(channelIds)).max(9),status:z.enum(["draft","planned"]),date:z.string().max(50),imageUrl:z.string().max(2000),imagePrompt:z.string().max(4000),variant:z.enum(["story","question","benefit"]),reviewed:z.boolean(),reviewKey:z.string().regex(/^[a-f0-9]{64}$/).optional(),demo:z.boolean().default(false)});
export const metricSchema=z.object({id:z.string().max(100),postId:z.string().max(100),channel:z.enum(channelIds),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),impressions:z.number().int().min(0).max(1e10),clicks:z.number().int().min(0).max(1e10),leads:z.number().int().min(0).max(1e10),variant:z.enum(["story","question","benefit"]),demo:z.boolean().default(false)}).refine(m=>m.clicks<=m.impressions&&m.leads<=m.clicks,"需符合 曝光 ≥ 點擊 ≥ 諮詢／報名");
export const workspaceSchema=z.object({school:z.string().min(1).max(100),admissionUrl:z.string().url().max(2000).refine(x=>x.startsWith("https://")),sources:z.array(sourceSchema).max(100),posts:z.array(postSchema).max(300),metrics:z.array(metricSchema).max(3000)});
export type Source=z.infer<typeof sourceSchema>;export type Post=z.infer<typeof postSchema>;export type Metric=z.infer<typeof metricSchema>;export type WorkspaceData=z.infer<typeof workspaceSchema>;
export async function publicationReviewKey(post:Post,data:WorkspaceData){
  const source=data.sources.find(source=>source.id===post.sourceId);
  const snapshot=[post.title,post.body,post.imageUrl,post.sourceId,source?.url,source?.text,post.channels,post.variant,data.school,data.admissionUrl];
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(snapshot)));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
}
export function taipeiDay(d=new Date()){return d.toLocaleDateString("en-CA",{timeZone:"Asia/Taipei"});}
export const variantNames={story:"故事開場",question:"提問開場",benefit:"亮點先行"};
export function initialData():WorkspaceData{return {school:"大葉大學",admissionUrl:"https://enroll.dyu.edu.tw/",sources:[],posts:[],metrics:[]};}
export function demoData():WorkspaceData{
const day=taipeiDay();const sources:Source[]=[
{id:"demo-1",title:"把課堂的想像，變成真實的作品",url:"https://www.dyu.edu.tw/",text:"示範素材：從課堂討論到親手實作，每一份作品，都記錄著學習與成長。歡迎探索大葉大學的校園生活與學習環境。此段為操作示範，並非官網新聞。",category:"學習亮點",createdAt:day,demo:true},
{id:"demo-2",title:"走進校園，找到自己的下一步",url:"https://enroll.dyu.edu.tw/",text:"示範素材：探索學系、認識校園，從你感興趣的領域開始了解大學生活。實際招生資訊請以大葉大學招生網站公告為準。",category:"招生資訊",createdAt:day,demo:true},
{id:"demo-3",title:"那些讓大學生活發光的日常",url:"https://www.dyu.edu.tw/",text:"示範素材：學習以外，也有很多值得記住的時刻。分享校園中的交流與成長故事。",category:"校園生活",createdAt:day,demo:true}];
const posts:Post[]=sources.map((s,i)=>({id:`demo-p${i}`,title:s.title,body:`${s.title} 🌿\n\n${s.text}\n\n認識大葉，從這裡開始 → https://enroll.dyu.edu.tw/\n\n#大葉大學 #校園日常 #探索你的可能`,sourceId:s.id,channels:i===1?["facebook","line"]:["facebook","instagram"],status:i===1?"planned":"draft",date:i===1?`${day}T18:00`:"",imageUrl:"",imagePrompt:"清新溫暖的大學學習空間插畫，綠色植物、自然採光，不使用真實校園或學生照片，不含文字",variant:(["story","question","benefit"] as const)[i],reviewed:false,demo:true}));
const metrics:Metric[]=Array.from({length:21},(_,i)=>{const d=new Date();d.setUTCDate(d.getUTCDate()-(20-i));const variant=(["story","question","benefit"] as const)[i%3];const impressions=2600+i*165,clicks=Math.round(impressions*({story:.032,question:.046,benefit:.039}[variant]));return{id:`demo-m${i}`,postId:posts[i%3].id,channel:(["facebook","instagram","line"] as const)[i%3],date:taipeiDay(d),impressions,clicks,leads:Math.round(clicks*.08),variant,demo:true};});return{...initialData(),sources,posts,metrics};}
export function feedback(metrics:Metric[]){const groups=(["story","question","benefit"] as const).map(variant=>{const rows=metrics.filter(m=>m.variant===variant),impressions=rows.reduce((n,m)=>n+m.impressions,0),clicks=rows.reduce((n,m)=>n+m.clicks,0);return{variant,impressions,clicks,rate:impressions?clicks/impressions:0,score:(clicks+2)/(impressions+100)};}).filter(g=>g.impressions>=200).sort((a,b)=>b.score-a.score);return{groups,best:groups[0],text:groups.length>=2?`歷史觀察中「${variantNames[groups[0].variant]}」點擊率較高（${(groups[0].rate*100).toFixed(1)}%），下一輪可優先測試；不同平台與受眾可能影響比較，尚非因果結論。`:"目前資料不足。先測試不同開場，每組累積至少 200 次曝光，再比較點擊率與招生轉換。"};}
export function trackingUrl(base:string,channel:Channel,postId:string,variant:string){const u=new URL(base);u.searchParams.set("utm_source",channel);u.searchParams.set("utm_medium","social");u.searchParams.set("utm_campaign",`dyu_${postId}`);u.searchParams.set("utm_content",variant);return u.toString();}
