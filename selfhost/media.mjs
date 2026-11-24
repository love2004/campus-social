import { mkdir, writeFile, readFile, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AppError, cardInput } from './core.mjs';
import { fetchPublic } from './network.mjs';
import { reserveBudget } from './ai.mjs';
import { generateCodexImage } from './codex-image.mjs';
import { cardPreset, cardLayout, cardOverlay, cropPlacement } from './card-layout.mjs';

export async function saveImage(store,buffer,label='圖片') {
  if(buffer.length>10_000_000)throw new AppError('圖片請小於 10MB',413);
  const image=sharp(buffer,{limitInputPixels:40_000_000,animated:false});
  let metadata;try{metadata=await image.metadata();}catch{throw new AppError('無法辨識圖片，請使用 JPEG、PNG 或 WebP');}
  if(!['jpeg','png','webp','heif','avif'].includes(metadata.format))throw new AppError('請使用 JPEG、PNG 或 WebP 圖片');
  const bytes=await image.rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).flatten({background:'#fff'}).jpeg({quality:88}).toBuffer();
  const id=randomUUID(),dir=path.join(store.directory,'media');await mkdir(dir,{recursive:true,mode:0o700});
  await writeFile(path.join(dir,`${id}.jpg`),bytes,{mode:0o600});
  const dimensions=await sharp(bytes).metadata();
  const item={id,label:label.slice(0,150),width:dimensions.width,height:dimensions.height,bytes:bytes.length,public:false,createdAt:new Date().toISOString()};store.put('media',item);return item;
}
export async function importImage(store,url,label) {const r=await fetchPublic(url,{maxBytes:10_000_000,accept:'image/jpeg,image/png,image/webp,image/avif'});if(!/^image\//i.test(r.type))throw new AppError('來源沒有回傳圖片');return saveImage(store,r.bytes,label);}
export async function createCard(store,input) {
  const parsed=cardInput.parse(input),settings=store.kv('settings');
  const recipe={...cardPreset(parsed.layout,parsed.format),...parsed,label:parsed.label??settings.unitName};
  const {width,height,warnings}=cardLayout(recipe);
  if(warnings.length)throw new AppError(warnings.join('；'));
  const base=sharp({create:{width,height,channels:3,background:settings.brandColor}}),layers=[];
  if(recipe.mediaId){
    const item=store.get('media',recipe.mediaId);if(!item)throw new AppError('找不到原始圖片',404);
    const placement=cropPlacement(item.width,item.height,width,height,recipe.imageZoom,recipe.imageX,recipe.imageY);
    const photo=await sharp(await readFile(path.join(store.directory,'media',`${item.id}.jpg`))).resize(placement.width,placement.height).extract({left:placement.left,top:placement.top,width,height}).toBuffer();
    layers.push({input:photo,top:0,left:0});
  }
  layers.push({input:Buffer.from(cardOverlay(recipe)),top:0,left:0});
  if(settings.logoMediaId){const logo=store.get('media',settings.logoMediaId);if(logo){const size=Math.round(width*.09);layers.push({input:await sharp(await readFile(path.join(store.directory,'media',`${logo.id}.jpg`))).resize(size,size,{fit:'contain',background:'#fff'}).toBuffer(),left:width-size-Math.round(width*.06),top:Math.round(height*.05)});}}
  const bytes=await base.composite(layers).jpeg({quality:92}).toBuffer();
  const image=await saveImage(store,bytes,`圖卡：${recipe.title}`);
  const result={...image,kind:'card',cardRecipe:recipe,sourcePostId:recipe.postId||''};
  store.put('media',result);return result;
}
export async function mediaForPlatform(store,mediaIds,channel) {
  if(!mediaIds.length)return [];
  const base=process.env.PUBLIC_BASE_URL;
  const publicHttps=base?.startsWith('https://');
  const directUpload=channel==='facebook'&&!publicHttps;
  if(!directUpload&&!publicHttps)throw new AppError('發佈圖片前，請設定主機的公開 HTTPS 網址 PUBLIC_BASE_URL',503);
  const variants=[];
  for(const id of mediaIds){const item=store.get('media',id);if(!item)throw new AppError('貼文圖片已不存在');
    const bytes=await readFile(path.join(store.directory,'media',`${id}.jpg`));
    const size=channel==='instagram'?{width:1080,height:1350}:channel==='line'?{width:1024,height:1024}:{width:1080,height:1080};
    // Pad rather than crop approved information out of a title card or photograph.
    const render=()=>sharp(bytes).resize({...size,fit:'contain',background:'#ffffff'}).jpeg({quality:90}).toBuffer();
    if(directUpload){variants.push(new Blob([await render()],{type:'image/jpeg'}));continue;}
    const variant=`${id}-${channel}.jpg`,file=path.join(store.directory,'media',variant);
    let exists=false;try{await access(file);exists=true;}catch{}
    if(!exists){const temporary=path.join(store.directory,'media',`${randomUUID()}.tmp`);await writeFile(temporary,await render(),{mode:0o600});await rename(temporary,file);}
    store.put('media',{...item,public:true});variants.push(new URL(`/media/${variant}`,base).href);
  }
  return variants;
}
export async function generateImage(store,prompt,{postId='',style='柔和編輯插畫',fetchFn=fetch,codexImageFn=generateCodexImage}={}) {
  const settings=store.kv('settings');if(!settings.imageEnabled)throw new AppError('AI 生圖尚未啟用，請在「AI 與用量」啟用',409);
  const post=postId?store.get('posts',postId):null;
  if(postId&&!post)throw new AppError('找不到配圖對應的貼文',404);
  const theme=post?`主題：${post.title}。摘要：${post.cardSummary||post.variants.facebook.slice(0,500)}。`:'已由使用者指定的主題。';
  prompt=prompt?.trim()||post?.imagePrompt||'';
  if(!prompt?.trim()||prompt.length>3000)throw new AppError('請填寫 3000 字內的圖片描述');
  const imageBrief=`為圖文卡片製作符合主題的無字配圖。${theme} 視覺風格：${style}。${prompt}。畫面不含任何文字、字母、數字、標誌或浮水印；標題與摘要將在圖片編輯器另外加上。主體清楚，保留可加字的留白。不要對所有主題使用同一校園建築，不得假冒真實人物或活動現場。`;
  if((settings.imageProvider||'codex')==='codex'){
    const result=await codexImageFn(store,imageBrief);
    const image=await saveImage(store,result.bytes,`AI 配圖：${post?.title||'自訂主題'}`);
    const item={...image,kind:'ai',provider:'codex',sourcePostId:postId,prompt,style};
    store.put('media',item);store.set('imageVerified',{provider:'codex',at:new Date().toISOString()});return item;
  }
  const key=store.secret('OPENAI_API_KEY');if(!key)throw new AppError('尚未設定選用的 AI 生圖 API 金鑰',503);
  reserveBudget(store,settings.imageReserve);
  const res=await fetchFn('https://api.openai.com/v1/images/generations',{method:'POST',signal:AbortSignal.timeout(180000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:settings.imageModel,prompt:imageBrief,size:'1024x1024',n:1,output_format:'jpeg'})});
  if(!res.ok)throw new AppError(`AI 生圖服務回應 ${res.status}，本次沒有取得圖片`,502);
  const r=await res.json(),b64=r.data?.[0]?.b64_json;if(!b64)throw new AppError('AI 生圖未回傳圖片',502);
  const image=await saveImage(store,Buffer.from(b64,'base64'),`AI 配圖：${post?.title||'自訂主題'}`);
  const result={...image,kind:'ai',provider:'openai',sourcePostId:postId,prompt,style};store.put('media',result);return result;
}
