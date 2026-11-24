import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
export const config=()=>env as unknown as Record<string,string|undefined>;
export class ApiError extends Error{constructor(message:string,public status=400){super(message);}}
export async function owner(){const user=await getChatGPTUser();if(!user)throw new ApiError("請先登入後操作工作台",401);return user.userId;}
export function database(){if(!env.DB)throw new ApiError("資料庫尚未啟用",503);return env.DB;}
export async function body(req:Request){if(req.headers.get("origin")&&req.headers.get("origin")!==new URL(req.url).origin)throw new ApiError("來源驗證失敗",403);const bytes=await req.arrayBuffer();if(bytes.byteLength>1_500_000)throw new ApiError("資料過大",413);try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new ApiError("JSON 格式錯誤");}}
export function apiError(e:unknown){if(e instanceof ApiError)return Response.json({error:e.message},{status:e.status});if(e&&typeof e==="object"&&"issues" in e)return Response.json({error:"資料格式不符，請檢查欄位與數字"},{status:400});console.error("Campus API failure",e instanceof Error?e.name:"unknown");return Response.json({error:"服務暫時無法完成，請稍後重試"},{status:500});}
export async function external(url:string,init:RequestInit={},timeout=25000){const res=await fetch(url,{...init,signal:AbortSignal.timeout(timeout)});if(!res.ok)throw new ApiError(`外部服務回應 ${res.status}；請確認權限、配額與 API 設定`,502);return res;}
export function secret(key:string){const v=config()[key];if(!v)throw new ApiError(`尚未設定 ${key}，目前無法執行真實 API`,503);return v;}
