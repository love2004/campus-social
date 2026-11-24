import{owner,body,apiError}from"@/lib/server";import{parseSource}from"@/lib/sources";
export async function POST(req:Request){try{await owner();const input=await body(req);return Response.json(await parseSource(String(input.url||"")));}catch(e){return apiError(e);}}
