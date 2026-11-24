import { generateDraft, planTopicDraft, reviewTopicDraft } from './ai.mjs';
import { taipeiDate } from './core.mjs';
import { isRecentTaiwanMemeSource } from './network.mjs';
import { searchArticles } from './codex-web.mjs';
import { checkEvidence } from './topic-drafts.mjs';

function snapshot(article,id,kind){
  return {id,kind,title:article.title,text:article.text.slice(0,12000),url:article.url,publishedAt:article.publishedAt||'',
    extraction:article.extraction,excerpts:article.excerpts};
}

async function researchedArticles(queries,kind,article,now,deps){
  if(!queries.length)return {references:[],candidateCount:0};
  const articles=await (deps.searchArticles||searchArticles)({queries,kind,excludeUrl:article.url,max:5,
    since:taipeiDate(new Date(now.getTime()-(kind==='meme'?90:45)*86400000))},{runner:deps.runner});
  const filtered=articles.filter(item=>item.url!==article.url&&item.title!==article.title&&
    (kind!=='meme'||isRecentTaiwanMemeSource(item,now)));
  const unique=[...new Map(filtered.map(item=>[item.url,item])).values()];
  return {references:unique.slice(0,5).map((item,i)=>snapshot(item,`${kind==='meme'?'meme':'public'}-${i+1}`,kind)),
    candidateCount:articles.length};
}

function verifiedMeme(review,source,facebook) {
  const meme=review.meme;
  if(source?.kind!=='meme'||!meme?.name||meme.sourceId!==source.id||!meme.quote||!meme.usageQuote||
    !/聲量|排行|觀看|瀏覽|流行|翻拍|接龍|熱潮|瘋傳|爆紅|洗版|熱門|轉發|模仿|\d[\d,]*\s*(?:筆|次|個讚|則留言)/u.test(meme.popularityQuote||''))return null;
  const prose=facebook.replace(/https:\/\/[^\s<>）)]+/g,'');
  const exactQuotes=new Set(review.facts.filter(fact=>fact.sourceId===source.id&&fact.sourcePart==='text').map(fact=>fact.quote));
  return exactQuotes.has(meme.quote)&&exactQuotes.has(meme.popularityQuote)&&meme.usageQuote.length>=6&&prose.includes(meme.usageQuote)?meme:null;
}

export async function draftFromPublicArticle(store,article,brief,now,deps={}){
  const generate=deps.generateDraft||generateDraft;
  const plan=await (deps.planTopicDraft||planTopicDraft)(store,{
    articleResearch:true,topic:{title:article.title},publicExcerpt:article.text.slice(0,2200),slots:[],
  },deps);
  const query=/^[\p{L}\p{N} -]{2,120}$/u.test(plan.query)?plan.query:'';
  const short=query.split(/\s+/).slice(0,2).join(' ');
  const dated=short&&!/\b20\d{2}\b/.test(short)?`${short} ${taipeiDate(now).slice(0,4)}`:short;
  const queries=query?[...new Set([dated,query,short])]:[];
  const namedMemes=(plan.memeQueries||[]).filter(term=>/^[\p{L}\p{N}][\p{L}\p{N} '?!.:’,-]{1,99}$/u.test(term));
  const memeQueries=[...new Set([...namedMemes.map(term=>`台灣 ${term} 網路梗`),...(short?[`台灣 ${short} 迷因 流行語`]:[])])];
  const results=await Promise.allSettled([researchedArticles(memeQueries,'meme',article,now,deps),researchedArticles(queries,'news',article,now,deps)]);
  const completed=results.map(result=>result.status==='fulfilled'?result.value:{references:[],candidateCount:0});
  const [{references:memeReferences,candidateCount:memeCandidateCount},{references:newsReferences,candidateCount}]=completed;
  const failedSearches=results.flatMap((result,index)=>result.status==='rejected'?[index===0?'台灣熱門梗':'時事']:[]);
  const main=snapshot(article,article.id,'material');
  const references=[...memeReferences,...newsReferences.filter(news=>!memeReferences.some(meme=>meme.url===news.url)).slice(0,memeReferences.length?3:5)];
  const research={queries,candidateCount,memeQueries,memeCandidateCount,failedSearches,
    sources:references.map(({id,kind,title,url,publishedAt})=>({id,kind,title,url,publishedAt})),status:'no_source'};
  const context={angle:plan.angle,now:taipeiDate(now),publicReferences:references};
  const contextual={...article,articleContext:context};
  if(!references.length)return {result:await generate(store,contextual,brief,deps),research};
  const draft=await generate(store,contextual,brief,deps);
  const facebookLinks=draft.variants.facebook.match(/https:\/\/[^\s<>）)]+/g)||[];
  const used=references.filter(source=>facebookLinks.includes(source.url));
  const sources=[main,...references];
  const review=checkEvidence(await (deps.reviewTopicDraft||reviewTopicDraft)(store,{
    articleResearch:true,topic:{title:article.title},purpose:plan.purpose,when:context.now,candidate:draft,sources,
  },deps),sources);
  const verified=used.length===1&&review.facts.some(fact=>fact.sourceId===used[0].id&&fact.sourcePart==='text');
  const meme=verifiedMeme(review,used[0],draft.variants.facebook);
  const anyExternal=review.facts.some(fact=>fact.sourceId!==main.id);
  if(review.verdict==='pass'&&(!review.meme?.name||meme)&&((verified&&(used[0].kind!=='meme'||meme))||(!used.length&&!anyExternal))){
    return {result:draft,research:{...research,status:verified?'used':'not_used',adopted:verified?used[0].id:null,review,...(meme?{meme}:{})}};
  }
  const correction=`\n依原始素材修正可核對的問題：${review.reason}。草稿只使用原始素材，不引用搜尋候選。`;
  const result=await generate(store,{...article,articleContext:{...context,publicReferences:[]}},brief+correction,deps);
  return {result,research:{...research,status:'discarded',review}};
}
