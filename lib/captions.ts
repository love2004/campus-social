import {trackingUrl,type Channel,type Post,type WorkspaceData} from "./campus";
export function platformCaption(post:Post,data:WorkspaceData,channel:Channel){
  const url=trackingUrl(data.admissionUrl,channel,post.id,post.variant);
  if(channel==="x"){let weight=0,short="";for(const char of post.body.replace(/https?:\/\/\S+/g,"")){const cost=char.codePointAt(0)!>0x10ff?2:1;if(weight+cost>240)break;short+=char;weight+=cost;}return `${short}\n${url}`;}
  return `${post.body}\n\n認識${data.school} → ${url}`;
}
