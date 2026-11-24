import path from 'node:path';
import { mkdir, copyFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';

const directory=path.resolve(process.env.DATA_DIR||fileURLToPath(new URL('../selfhost-data',import.meta.url)));
const destination=path.resolve(process.argv[2]||path.join(path.dirname(directory),'backups'),new Date().toISOString().replace(/[:.]/g,'-'));
if(destination===directory||destination.startsWith(directory+path.sep))throw new Error('備份目錄必須在正式資料目錄之外');
await mkdir(destination,{recursive:true,mode:0o700});
const store=openStore(directory);
try {
  store.db.prepare('VACUUM INTO ?').run(path.join(destination,'campus.sqlite'));
  await copyFile(path.join(directory,'machine.key'),path.join(destination,'machine.key'));
  if(existsSync(path.join(directory,'media')))await cp(path.join(directory,'media'),path.join(destination,'media'),{recursive:true,force:false});
  console.log(`備份完成：${destination}（包含加密資料所需的 machine.key，請保護整個備份目錄）`);
}finally{store.close();}
