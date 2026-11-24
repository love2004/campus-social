import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { openStore } from '../store.mjs';
import { saveImage, createCard, mediaForPlatform } from '../media.mjs';
import { mailTick } from '../engine.mjs';
import { queueMail, sendMailQueue } from '../mailer.mjs';

function fixture(t){const dir=mkdtempSync(path.join(os.tmpdir(),'campus-media-test-')),store=openStore(dir);t.after(()=>{store.close();if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'campus-media-test-'))throw new Error('Unsafe cleanup');rmSync(dir,{recursive:true,force:true});});return store;}
test('photo upload, Chinese brand template and public platform variants preserve private originals',async t=>{
  const store=fixture(t),input=await sharp({create:{width:500,height:300,channels:4,background:'#abc8a6'}}).png().toBuffer();
  const media=await saveImage(store,input,'真實照片');assert.equal(media.public,false);assert.equal((await sharp(readFileSync(path.join(store.directory,'media',`${media.id}.jpg`))).metadata()).format,'jpeg');
  store.set('settings',{...store.kv('settings'),unitName:'測試單位',logoMediaId:media.id});
  const card=await createCard(store,{mediaId:media.id,title:'學習成果與交流分享',subtitle:'經人工核對的圖卡文字',layout:'photo'});assert.equal(card.width,1080);assert.equal(card.height,1080);assert.equal(card.public,false);
  const before=readFileSync(path.join(store.directory,'media',`${media.id}.jpg`));
  const oldBase=process.env.PUBLIC_BASE_URL;process.env.PUBLIC_BASE_URL='https://social.example.org';
  try{const urls=await mediaForPlatform(store,[media.id],'instagram');assert.match(urls[0],/^https:\/\/social\.example\.org\/media\//);const variant=await sharp(readFileSync(path.join(store.directory,'media',`${media.id}-instagram.jpg`))).metadata();assert.equal(variant.width,1080);assert.equal(variant.height,1350);assert.deepEqual(readFileSync(path.join(store.directory,'media',`${media.id}.jpg`)),before);assert.equal(store.get('media',media.id).public,true);}finally{if(oldBase===undefined)delete process.env.PUBLIC_BASE_URL;else process.env.PUBLIC_BASE_URL=oldBase;}
});
test('daily digest is deduplicated, unconfigured SMTP keeps pending mail and successful send changes status',async t=>{
  const store=fixture(t),now=new Date('2026-11-04T02:00:00Z');store.set('settings',{...store.kv('settings'),notifyEmail:'editor@example.org',digestTime:'09:00'});
  await mailTick(store,now);await mailTick(store,now);assert.equal(store.list('outbox').length,1);assert.equal(store.list('outbox')[0].status,'pending');
  store.setSecret('SMTP_HOST','fixture.invalid');store.setSecret('SMTP_FROM','fixture@example.org');let sends=0;
  await sendMailQueue(store,async msg=>{sends++;assert.equal(msg.to,'editor@example.org');},now);await sendMailQueue(store,async()=>{sends++;},now);assert.equal(sends,1);assert.equal(store.list('outbox')[0].status,'sent');
});
test('interrupted mail is visible as uncertain and is not automatically resent',async t=>{
  const store=fixture(t);queueMail(store,'test-interruption','主旨','內文',new Date('2026-11-03T00:00:00Z'));const mail=store.get('outbox','test-interruption');store.put('outbox',{...mail,status:'sending',startedAt:'2026-11-03T00:00:00Z'});
  await mailTick(store,new Date('2026-11-04T00:00:00Z'),{sendMailQueue:async()=>{}});assert.equal(store.get('outbox','test-interruption').status,'unknown');
});
test('backup snapshot restores encrypted settings with the matching machine key',t=>{
  const base=mkdtempSync(path.join(os.tmpdir(),'campus-backup-test-')),live=path.join(base,'live'),out=path.join(base,'backups'),store=openStore(live);
  try{store.setSecret('BACKUP_TEST_SECRET','fixture-recoverable-value');store.set('test-marker','snapshot-created');
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../backup.mjs',import.meta.url)),out],{env:{...process.env,DATA_DIR:live},encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    const restored=openStore(path.join(out,readdirSync(out)[0]));try{assert.equal(restored.kv('test-marker'),'snapshot-created');assert.equal(restored.secret('BACKUP_TEST_SECRET'),'fixture-recoverable-value');}finally{restored.close();}
  }finally{store.close();if(!path.resolve(base).startsWith(path.resolve(os.tmpdir())+path.sep+'campus-backup-test-'))throw new Error('Unsafe cleanup');rmSync(base,{recursive:true,force:true});}
});
