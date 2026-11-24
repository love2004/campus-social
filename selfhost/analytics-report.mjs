const dayMs=86_400_000;
export const analyticsPlatforms=['facebook','instagram','threads','line'];
export const analyticsDays=[7,30,90];
export const postSampleLimit=20;
export const performanceMetrics={
  facebook:['views','reach','interactions'],
  instagram:['views','reach','interactions'],
  threads:['views','interactions'],
  line:['delivered','opened','clicked'],
};

export function analyticsWindow(days,now) {
  const today=new Date(now.getTime()+8*3_600_000).toISOString().slice(0,10);
  const end=Date.parse(today+'T00:00:00+08:00')+dayMs;
  const start=end-days*dayMs;
  return {today,start,previousStart:start-days*dayMs};
}
export function publicationReport(publications,posts,platform,days,now) {
  const {today,start,previousStart}=analyticsWindow(days,now);
  const reportFor=channel=>({channel,sent:0,previousSent:0,issues:0});
  const channels=(platform==='all'?analyticsPlatforms:[platform]).map(reportFor);
  const byChannel=new Map(channels.map(row=>[row.channel,row]));
  const postById=new Map(posts.map(post=>[post.id,post]));
  const daily=Array.from({length:days},(_,i)=>({date:new Date(start+i*dayMs+8*3_600_000).toISOString().slice(0,10),sent:0}));
  const sent=[];
  for(const job of publications) {
    const summary=byChannel.get(job.channel);
    if(!summary||!['sent','failed','unknown'].includes(job.status))continue;
    const actual=job.status==='sent'?(job.publishedAt||job.completedAt):null;
    const date=job.status==='sent'?(actual||job.attemptedAt||job.slotId||job.createdAt):(job.updatedAt||job.createdAt);
    const at=Date.parse(date);
    if(!Number.isFinite(at)||at<previousStart||at>now.getTime())continue;
    if(at<start) {
      if(job.status==='sent')summary.previousSent++;
      continue;
    }
    if(job.status!=='sent'){summary.issues++;continue;}
    summary.sent++;
    daily[Math.floor((at-start)/dayMs)].sent++;
    const post=postById.get(job.postId);
    sent.push({id:job.id,postId:job.postId,title:post?.title||'貼文紀錄',category:post?.category||'其他',date,estimatedDate:!actual,job});
  }
  sent.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||a.id.localeCompare(b.id));
  return {start:daily[0].date,end:today,channels,daily,sent};
}
