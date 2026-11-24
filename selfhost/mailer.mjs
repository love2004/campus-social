import nodemailer from 'nodemailer';
import { AppError } from './core.mjs';

export function queueMail(store,id,subject,text,now=new Date()) {
  const email=store.kv('settings').notifyEmail;
  store.db.prepare('INSERT OR IGNORE INTO outbox VALUES (?,?,?)').run(id,'pending',JSON.stringify({id,status:'pending',to:email,subject,text,attempts:0,createdAt:now.toISOString(),nextAt:now.toISOString()}));
}
export function notify(store,key,message,now=new Date()) {
  store.event('warning',message);
  // One notification per condition per Taipei day, unless a publication has its own unique key.
  queueMail(store,key,`[社群工作台] ${message}`,`${message}\n\n請登入工作台處理：${process.env.PUBLIC_BASE_URL||'請使用已設定的工作台網址'}`,now);
}
export function transport(store) {
  const host=store.secret('SMTP_HOST'),port=Number(store.secret('SMTP_PORT')||587),user=store.secret('SMTP_USER'),pass=store.secret('SMTP_PASSWORD');
  if(!host||!store.secret('SMTP_FROM'))throw new AppError('尚未設定郵件伺服器與寄件人',503);
  return nodemailer.createTransport({host,port,secure:port===465,requireTLS:port!==465,auth:user?{user,pass}:undefined,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:25000,logger:false,debug:false});
}
export async function sendMailQueue(store,sendFn,now=new Date()) {
  for(const mail of store.list('outbox').filter(m=>m.status==='pending'&&m.nextAt<=now.toISOString()).slice(0,10)) {
    const to=mail.to||store.kv('settings').notifyEmail;
    if(!to||!store.secret('SMTP_HOST'))continue;
    const claimed=store.db.prepare("UPDATE outbox SET status='sending' WHERE id=? AND status='pending'").run(mail.id);if(!claimed.changes)continue;
    store.put('outbox',{...mail,status:'sending',startedAt:new Date().toISOString()});
    try {await (sendFn||((message)=>transport(store).sendMail(message)))({from:store.secret('SMTP_FROM'),to,subject:mail.subject,text:mail.text,messageId:`<${Buffer.from(mail.id).toString('hex').slice(0,160)}@campus-social.local>`});store.put('outbox',{...mail,to,status:'sent',sentAt:new Date().toISOString()});}
    catch {const attempts=mail.attempts+1;store.put('outbox',{...mail,to,status:attempts>=3?'failed':'pending',attempts,nextAt:new Date(Date.now()+attempts*300000).toISOString(),error:'郵件尚未送達，請確認 SMTP 設定與收件資訊'});}
  }
}
