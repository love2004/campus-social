// No Node-only imports: the same SVG/text layout drives live preview and export.
export const CARD_FORMATS={square:{width:1080,height:1080,label:'方形 1:1'},portrait:{width:1080,height:1350,label:'直式 4:5'},landscape:{width:1200,height:630,label:'橫式 1.91:1'}};
export const CARD_DEFAULTS={mediaId:'',title:'',subtitle:'',label:'',layout:'photo',format:'square',titleX:9,titleY:56,subtitleX:9,subtitleY:81,labelX:6,labelY:7,titleSize:62,subtitleSize:29,labelSize:28,textColor:'#ffffff',shadeOpacity:.82,imageZoom:1,imageX:50,imageY:50,align:'left'};
export function cardPreset(layout='photo',format='square') {
  const landscape=format==='landscape';
  return {...CARD_DEFAULTS,layout,format,titleY:layout==='minimal'?28:landscape?39:56,subtitleY:layout==='minimal'?65:landscape?76:81,titleSize:landscape?52:62,subtitleSize:landscape?25:29,labelY:landscape?8:7};
}
export function cropPlacement(sourceWidth,sourceHeight,width,height,zoom=1,x=50,y=50) {
  const scale=Math.max(width/sourceWidth,height/sourceHeight)*zoom;
  const scaledWidth=Math.max(width,Math.ceil(sourceWidth*scale)),scaledHeight=Math.max(height,Math.ceil(sourceHeight*scale));
  return {width:scaledWidth,height:scaledHeight,left:Math.round((scaledWidth-width)*x/100),top:Math.round((scaledHeight-height)*y/100)};
}
const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function weight(char){return /^[\x20-\x7e]$/.test(char)?(/[MW@]/.test(char)?.8:.56):1;}
export function wrapCardText(text,units) {
  const lines=[];
  for(const paragraph of String(text).replace(/\r/g,'').split('\n')){
    const paragraphStart=lines.length;
    const segmenter=new Intl.Segmenter('zh-Hant',{granularity:'word'});
    const protectedSpan=/(「[^「」\n]{1,18}」|\d{1,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}\s*月\s*\d{1,2}\s*日|\d+(?:\.\d+)?[ \u3000]*[%％國人位場張項組隊]|人工智慧|報名|客服|化蛹)/u;
    const tokenize=value=>value.split(protectedSpan).flatMap((part,index)=>index%2?[part]:Array.from(segmenter.segment(part),x=>x.segment));
    const tokens=tokenize(paragraph);
    let line='',used=0;
    const sizeOf=s=>Array.from(s).reduce((n,c)=>n+weight(c),0);
    for(let token of tokens){
      while(token){
        let size=sizeOf(token);
        if(size>units){const chars=Array.from(token);let chunk='';while(chars.length&&sizeOf(chunk+chars[0])<=units)chunk+=chars.shift();token=chars.join('');if(!chunk){chunk=chars.shift()||token[0];token=chars.join('');}if(line){lines.push(line.trimEnd());line='';used=0;}line=chunk;used=sizeOf(chunk);continue;}
        if(line&&used+size>units){
          if(/^[，。！？、；：）】」』]/u.test(token)){
            const parts=tokenize(line);let moved='';while(parts.length&&sizeOf(parts.join('')+token)>units)moved=parts.pop()+moved;
            if(parts.length&&sizeOf(moved+token)<=units){lines.push(parts.join('').trimEnd());line=moved;used=sizeOf(line);}else{lines.push(line.trimEnd());line='';used=0;}
          }else{lines.push(line.trimEnd());line='';used=0;}
        }
        line+=token;used+=size;token='';
      }
    }
    if(sizeOf(line.trim())<=3&&lines.length>paragraphStart){
      const previous=tokenize(lines.at(-1));
      const tail=previous.pop();
      if(tail?.trim()&&previous.join('').trim()&&sizeOf(tail+line)<=units){
        lines[lines.length-1]=previous.join('').trimEnd();
        line=tail+line;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
export function cardLayout(recipe) {
  const r={...cardPreset(recipe.layout,recipe.format),...recipe},dimensions=CARD_FORMATS[r.format]||CARD_FORMATS.square;
  const {width,height}=dimensions,warnings=[],layers=[];
  for(const key of ['label','title','subtitle']){
    const text=r[key];if(!text)continue;
    const size=r[`${key}Size`],x=width*r[`${key}X`]/100,y=height*r[`${key}Y`]/100;
    const available=r.align==='center'&&key!=='label'?2*Math.min(x,width-x)-40:width-x-40;
    const lines=wrapCardText(text,Math.max(1,available/size)),lineHeight=size*1.35;
    if(available<size||y+lines.length*lineHeight>height-20)warnings.push(`${key==='title'?'標題':key==='subtitle'?'摘要':'單位名稱'}超出畫布，請縮小字級或移動文字`);
    layers.push({key,lines,size,x,y,lineHeight,align:key==='label'?'left':r.align,width:available});
  }
  return {recipe:r,width,height,layers,warnings};
}
export function cardPageInput(page,{mediaId='',label='',body=false}={}){
  if(!body)return {mediaId,label,title:page.title,subtitle:page.summary||''};
  const input={mediaId,label,title:page.summary,subtitle:'',align:'center',titleX:50,titleSize:45,shadeOpacity:.94};
  const {height,layers}=cardLayout({...input,titleY:0});
  const title=layers.find(layer=>layer.key==='title');
  return {...input,titleY:50-title.lines.length*title.lineHeight/height*50};
}
export function cardOverlay(recipe,{interactive=false}={}) {
  const {recipe:r,width,height,layers}=cardLayout(recipe);
  const shade=r.mediaId?`<defs><linearGradient id="card-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#10251e" stop-opacity="0.08"/><stop offset="1" stop-color="#10251e" stop-opacity="${r.shadeOpacity}"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#card-shade)"/>`:'';
  const texts=layers.map(layer=>`<g${interactive?` data-layer="${layer.key}" style="cursor:move"`:''}>${interactive?`<rect x="${layer.align==='center'?layer.x-layer.width/2:layer.x}" y="${layer.y}" width="${Math.max(layer.size,layer.width)}" height="${layer.lines.length*layer.lineHeight}" fill="transparent" stroke="#d8eab6" stroke-opacity=".55" stroke-dasharray="8 8" stroke-width="2"/>`:''}${layer.lines.map((line,i)=>`<text x="${layer.x}" y="${layer.y+layer.size+i*layer.lineHeight}" font-size="${layer.size}" font-weight="${layer.key==='title'?'700':'400'}" text-anchor="${layer.align==='center'?'middle':'start'}">${xml(line)}</text>`).join('')}</g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shade}<g font-family="Noto Sans CJK TC,Noto Sans TC,Microsoft JhengHei,sans-serif" fill="${r.textColor}">${texts}</g></svg>`;
}
