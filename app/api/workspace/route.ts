import { owner, database, body, apiError, ApiError } from "@/lib/server";
import { initialData, publicationReviewKey, workspaceSchema, type WorkspaceData } from "@/lib/campus";

export async function GET(){
  try{
    const id=await owner(),db=database();
    await db.prepare("INSERT OR IGNORE INTO workspaces (owner,version,data) VALUES (?,0,?)").bind(id,JSON.stringify(initialData())).run();
    const row=await db.prepare("SELECT version,data FROM workspaces WHERE owner=?").bind(id).first<{version:number,data:string}>();
    const data=workspaceSchema.parse(JSON.parse(row!.data));
    data.posts=await Promise.all(data.posts.map(async post=>({
      ...post,reviewed:post.reviewed&&!!post.reviewKey&&post.reviewKey===await publicationReviewKey(post,data),
    })));
    const jobs=await db.prepare("SELECT post_id,channel,status,result,created_at FROM publications WHERE owner=? ORDER BY created_at DESC LIMIT 100").bind(id).all();
    return Response.json({version:row!.version,data,publications:jobs.results},{headers:{"Cache-Control":"no-store"}});
  }catch(error){return apiError(error);}
}

export async function PUT(req:Request){
  try{
    const id=await owner(),input=await body(req),data=workspaceSchema.parse(input.data),db=database();
    if(data.posts.some(p=>p.demo)||data.sources.some(s=>s.demo)||data.metrics.some(m=>m.demo))throw new ApiError("示範資料不可寫入正式工作區");
    if(!Number.isInteger(input.version)||input.version<0)throw new ApiError("版本無效");
    const previous=await db.prepare("SELECT data FROM workspaces WHERE owner=? AND version=?").bind(id,input.version).first<{data:string}>();
    if(!previous)throw new ApiError("工作區已在另一個視窗變更，請重新載入後再操作",409);
    const previousPosts=new Map((JSON.parse(previous.data) as WorkspaceData).posts.map(post=>[post.id,post]));
    data.posts=await Promise.all(data.posts.map(async ({reviewKey:_clientKey,...post})=>{
      if(!post.reviewed)return post;
      const key=await publicationReviewKey(post,data);
      const prior=previousPosts.get(post.id);
      const confirmed=input.reviewPostId===post.id||(prior?.reviewed&&prior.reviewKey===key);
      return confirmed?{...post,reviewKey:key}:{...post,reviewed:false};
    }));
    const result=await db.prepare("UPDATE workspaces SET data=?,version=version+1 WHERE owner=? AND version=?")
      .bind(JSON.stringify(data),id,input.version).run();
    if(!result.meta.changes)throw new ApiError("工作區已在另一個視窗變更，請重新載入後再操作",409);
    return Response.json({version:input.version+1,data});
  }catch(error){return apiError(error);}
}
