import { randomBytes, scryptSync } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { openStore } from './store.mjs';
const email=z.string().email().parse(process.env.ADMIN_EMAIL||'').toLowerCase(),password=process.env.ADMIN_PASSWORD||'';
if(password.length<12)throw new Error('請先在主機設定 ADMIN_EMAIL 與至少 12 字元的 ADMIN_PASSWORD');
const store=openStore(path.resolve(process.env.DATA_DIR||fileURLToPath(new URL('../selfhost-data',import.meta.url))));
try{const salt=randomBytes(16).toString('hex');store.transaction(()=>{store.set('administrator',{email,hash:`${salt}:${scryptSync(password,salt,64).toString('hex')}`});store.db.exec('DELETE FROM sessions');});console.log('管理者已重設，所有登入工作階段已失效。');}finally{store.close();}
