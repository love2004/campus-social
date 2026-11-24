import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { createEngine } from './engine.mjs';
import { bindExistingPublicationAccounts } from './publish.mjs';

const directory=process.env.DATA_DIR||fileURLToPath(new URL('../selfhost-data',import.meta.url));
const store=openStore(path.resolve(directory)),engine=createEngine(store);
bindExistingPublicationAccounts(store);
engine.start();console.log('Campus Social 背景工作已啟動；同一資料庫的各工作由租約協調。');
const keepAlive=setInterval(()=>{},60000);
let stopping=false;
async function stop(){if(stopping)return;stopping=true;clearInterval(keepAlive);await engine.stop();store.close();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
