import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {mkdtempSync,rmSync} from 'node:fs';
import {createApp} from '../server.mjs';

test('local preview accepts its own origin when PUBLIC_BASE_URL points at another local port, while rejecting foreign origins',async t=>{
  const previous=process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL='http://127.0.0.1:5180';
  const directory=mkdtempSync(path.join(os.tmpdir(),'campus-origin-test-'));
  const app=await createApp({directory,startWorker:false,bootstrapEmail:'origin@example.org',bootstrapPassword:'origin-fixture-2026'});
  const server=http.createServer(app.handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await app.close();
    if(previous===undefined)delete process.env.PUBLIC_BASE_URL;else process.env.PUBLIC_BASE_URL=previous;
    const resolved=path.resolve(directory);
    if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'campus-origin-test-'))throw new Error('Unsafe test cleanup');
    rmSync(directory,{recursive:true,force:true});
  });
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'origin@example.org',password:'origin-fixture-2026'})});
  assert.equal(login.status,200,`same-origin local login was rejected: ${await login.text()}`);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const request=origin=>fetch(base+'/api/automation/preview',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:'{}'});
  assert.equal((await request(base)).status,200);
  for(const origin of ['https://attacker.invalid','http://127.0.0.1:9999','null',base+'.attacker.invalid'])assert.equal((await request(origin)).status,403,origin);
  // The explicit public deployment origin remains valid.
  assert.equal((await request(process.env.PUBLIC_BASE_URL)).status,200);
  // A configured production domain does not broaden its allowlist to loopback.
  process.env.PUBLIC_BASE_URL='https://social.example.edu.tw';
  assert.equal((await request(base)).status,403);
  assert.equal((await request('https://social.example.edu.tw')).status,200);
});
