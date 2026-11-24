import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { defaultSettings } from './core.mjs';

const publicationDate=`CASE WHEN status='sent' THEN coalesce(json_extract(data,'$.publishedAt'),json_extract(data,'$.completedAt'),
  json_extract(data,'$.attemptedAt'),json_extract(data,'$.slotId'),json_extract(data,'$.createdAt'))
  ELSE coalesce(json_extract(data,'$.updatedAt'),json_extract(data,'$.createdAt')) END`;

export function openStore(directory) {
  mkdirSync(directory, {recursive:true, mode:0o700});
  try { chmodSync(directory,0o700); } catch { /* Windows ACLs are inherited. */ }
  const keyPath = path.join(directory, 'machine.key');
  if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), {mode:0o600, flag:'wx'});
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw new Error('Invalid machine key');
  const db = new DatabaseSync(path.join(directory, 'campus.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, url TEXT UNIQUE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS slots (id TEXT PRIMARY KEY, post_id TEXT, status TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS slot_bindings (
      post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
      slot_id TEXT NOT NULL UNIQUE,
      revision TEXT NOT NULL,
      review_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      post_id TEXT UNIQUE REFERENCES posts(id) ON DELETE SET NULL,
      version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS topic_materials (
      topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('article','media')),
      material_id TEXT NOT NULL,
      PRIMARY KEY(topic_id,kind,material_id)
    );
    CREATE TABLE IF NOT EXISTS publications (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(post_id,channel));
    CREATE TABLE IF NOT EXISTS generation_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS budget (id TEXT PRIMARY KEY, month TEXT NOT NULL, reserve REAL NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, started_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO workspace_revision VALUES (1,0);
  `);
  const tracked=['sources','articles','posts','media','slots','slot_bindings','topics','topic_materials','publications','generation_jobs','events','outbox','budget','secrets','kv'];
  for(const table of tracked)for(const action of ['INSERT','UPDATE','DELETE']){
    const row=action==='DELETE'?'OLD':'NEW';
    const filter=table==='kv'?`WHEN ${row}.key IN ('settings','settingsVersion','aiPaused','aiVerified','codexStatus','lineAccount')`:'';
    db.exec(`CREATE TRIGGER IF NOT EXISTS revision_${table}_${action} AFTER ${action} ON ${table}
      ${filter} BEGIN UPDATE workspace_revision SET revision=revision+1 WHERE id=1; END`);
  }
  db.function('fold_case',value=>String(value??'').toLocaleLowerCase());
  db.exec(`CREATE INDEX IF NOT EXISTS publications_analytics_date ON publications (julianday(${publicationDate}))
    WHERE status IN ('sent','failed','unknown')`);
  try { chmodSync(path.join(directory,'campus.sqlite'),0o600); } catch { /* Windows does not implement POSIX modes. */ }
  function kv(name, fallback = null) { const row=db.prepare('SELECT value FROM kv WHERE key=?').get(name); return row ? JSON.parse(row.value) : fallback; }
  function set(name, value) { db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(name,JSON.stringify(value)); }
  if (!kv('settings')) set('settings',defaultSettings());
  else {const prior=kv('settings'),updated={...defaultSettings(),...prior};if(JSON.stringify(prior)!==JSON.stringify(updated)){set('settings',updated);set('settingsVersion',kv('settingsVersion',1)+1);}}
  const tables = new Set(['sources','articles','posts','media','slots','publications','generation_jobs','outbox']);
  function list(table) { if(!tables.has(table))throw new Error('Unknown table');return db.prepare(`SELECT * FROM ${table}`).all().map(r=>({...JSON.parse(r.data),...(table==='posts'?{version:r.version}:{}),...(['slots','publications','generation_jobs','outbox'].includes(table)?{status:r.status}:{})})); }
  function get(table,id) {if(!tables.has(table))throw new Error('Unknown table');const r=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);return r?{...JSON.parse(r.data),...(table==='posts'?{version:r.version}:{}),...(['slots','publications','generation_jobs','outbox'].includes(table)?{status:r.status}:{})}:null;}
  function articleSummaries(){
    const rows=db.prepare("SELECT json_replace(data,'$.text',substr(json_extract(data,'$.text'),1,110)) AS data FROM articles").all();
    return rows.map(row=>JSON.parse(row.data));
  }
  function analyticsRows(platform,earliest,latest){
    const filters=platform==='all'?'':'AND channel=?';
    const rows=db.prepare(`SELECT id,post_id,channel,status,data FROM publications
      WHERE status IN ('sent','failed','unknown') AND julianday(${publicationDate}) BETWEEN julianday(?) AND julianday(?) ${filters}`)
      .all(earliest,latest,...(platform==='all'?[]:[platform]));
    const postIds=[...new Set(rows.map(row=>row.post_id))];
    const posts=[];
    for(let i=0;i<postIds.length;i+=400){
      const ids=postIds.slice(i,i+400);
      posts.push(...db.prepare(`SELECT id,json_extract(data,'$.title') AS title,json_extract(data,'$.category') AS category
        FROM posts WHERE id IN (${ids.map(()=>'?').join(',')})`).all(...ids));
    }
    return {publications:rows.map(row=>({...JSON.parse(row.data),status:row.status})),posts};
  }
  function put(table,item) {
    if(!['sources','articles','media','generation_jobs','outbox'].includes(table))throw new Error('Use transactional writer');
    if(table==='articles')db.prepare('INSERT INTO articles VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,data=excluded.data').run(item.id,item.url||null,JSON.stringify(item));
    else if(['generation_jobs','outbox'].includes(table))db.prepare(`INSERT INTO ${table} VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data`).run(item.id,item.status,JSON.stringify(item));
    else db.prepare(`INSERT INTO ${table} VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(item.id,JSON.stringify(item));
  }
  function transaction(fn) {db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}
  function encrypt(value) {const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');}
  function secret(name) {if(process.env[name])return process.env[name];const row=db.prepare('SELECT value FROM secrets WHERE key=?').get(name);if(!row)return '';const b=Buffer.from(row.value,'base64'),dec=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));dec.setAuthTag(b.subarray(12,28));return Buffer.concat([dec.update(b.subarray(28)),dec.final()]).toString('utf8');}
  function setSecret(name,value){if(value)db.prepare('INSERT INTO secrets VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(name,encrypt(value));else db.prepare('DELETE FROM secrets WHERE key=?').run(name);}
  function event(level,message){db.prepare('INSERT INTO events VALUES (?,?,?,?)').run(randomUUID(),new Date().toISOString(),level,message);db.exec('DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY created_at DESC LIMIT -1 OFFSET 500)');}
  function lease(name,owner,ttl=90000){const now=Date.now();return db.prepare('INSERT INTO leases VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE leases.expires_at<? OR leases.owner=excluded.owner').run(name,owner,now+ttl,now).changes===1;}
  function release(name,owner){db.prepare('DELETE FROM leases WHERE name=? AND owner=?').run(name,owner);}
  return {db,directory,kv,set,list,get,put,transaction,secret,setSecret,event,lease,release,articleSummaries,analyticsRows,
    workspaceRevision:()=>db.prepare('SELECT revision FROM workspace_revision WHERE id=1').get().revision,
    close:()=>db.close()};
}
