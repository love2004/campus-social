import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, taipeiDate } from './core.mjs';
import { writeSlotBinding } from './engine.mjs';
import { invalidateTopicDraft } from './topic-drafts.mjs';

const date = z.string().date();
export const topicInput = z.object({
  title: z.string().trim().min(1).max(120),
  startDate: date,
  endDate: date,
  version: z.number().int().positive().optional(),
  schedule: z.object({
    postId: z.string().min(1).max(80),
    when: z.string().datetime({offset:true}),
    version: z.number().int().positive(),
    revision: z.string().uuid().nullable(),
  }).optional(),
}).refine(topic => topic.startDate <= topic.endDate, '結束日期須在開始日期當天或之後');

const topicColumns = 'id,title,start_date AS startDate,end_date AS endDate,post_id AS postId,version';

export function listTopics(store) {
  const topics = store.db.prepare(`SELECT ${topicColumns} FROM topics ORDER BY start_date,title`).all();
  const materials = store.db.prepare('SELECT topic_id AS topicId,kind,material_id AS id FROM topic_materials').all();
  const jobs=store.db.prepare(`SELECT jobs.status,json_object('topicId',topics.id,'topicVersion',json_extract(jobs.data,'$.topicVersion'),
    'id',jobs.id,'stage',json_extract(jobs.data,'$.stage'),'plan',json_extract(jobs.data,'$.plan'),
    'postId',json_extract(jobs.data,'$.postId'),'basePostId',json_extract(jobs.data,'$.basePostId'),
    'error',json_extract(jobs.data,'$.error'),'searchNote',json_extract(jobs.data,'$.searchNote'),
    'replacementReason',json_extract(jobs.data,'$.replacementReason')) AS data
    FROM generation_jobs jobs JOIN topics ON topics.id=json_extract(jobs.data,'$.topicId')
    WHERE (topics.post_id IS NULL AND topics.version=json_extract(jobs.data,'$.topicVersion')) OR topics.post_id=json_extract(jobs.data,'$.postId')
      OR (topics.post_id=json_extract(jobs.data,'$.basePostId') AND topics.version=json_extract(jobs.data,'$.topicVersion'))
    ORDER BY jobs.rowid`).all();
  const latest=new Map();
  for(const row of jobs) {
    const {topicId,topicVersion,id,stage,plan,postId,basePostId,error,searchNote,replacementReason}=JSON.parse(row.data);
    latest.set(topicId,{topicVersion,id,stage,plan,postId,basePostId,error,searchNote,replacementReason,status:row.status});
  }
  return topics.map(topic => {
    const job=latest.get(topic.id);
    const draft=job&&(topic.postId?(job.postId||job.basePostId)===topic.postId:job.topicVersion===topic.version)?job:null;
    return {...topic,draft,materials:materials.filter(item => item.topicId === topic.id).map(({kind,id}) => ({kind,id}))};
  });
}

export function listSlotBindings(store) {
  return store.db.prepare('SELECT post_id AS postId,slot_id AS "when",revision FROM slot_bindings ORDER BY slot_id').all();
}

export function saveTopic(store, id, input, now = new Date()) {
  const {title,startDate,endDate,schedule,version} = input;
  return store.transaction(() => {
    const current = id ? store.db.prepare(`SELECT ${topicColumns} FROM topics WHERE id=?`).get(id) : null;
    if (id && !current) throw new AppError('找不到主題',404);
    if (current && current.version !== version) throw new AppError('主題已更新，請重新載入',409);
    const postId = schedule?.postId ?? current?.postId ?? null;
    if (current?.postId && current.postId !== postId) throw new AppError('改期請使用原本綁定的貼文',409);
    if (schedule && store.db.prepare('SELECT id FROM topics WHERE post_id=? AND id!=?').get(postId,id ?? '')) {
      throw new AppError('此貼文已綁定其他主題',409);
    }
    const binding = postId && store.db.prepare('SELECT slot_id AS "when",revision FROM slot_bindings WHERE post_id=?').get(postId);
    const when = schedule?.when ?? binding?.when;
    const timestamp = when && Date.parse(when);
    if (when && !Number.isFinite(timestamp)) throw new AppError('發文時段無效');
    if (when) {
      const day = taipeiDate(new Date(timestamp));
      if (day < startDate || day > endDate) throw new AppError('請選擇主題日期內的發文時段');
    }
    if (schedule) writeSlotBinding(store,postId,schedule,now);

    const topicId = id ?? randomUUID();
    if (current) {
      store.db.prepare('UPDATE topics SET title=?,start_date=?,end_date=?,post_id=?,version=version+1 WHERE id=?')
        .run(title,startDate,endDate,postId,topicId);
      if(current.title!==title)invalidateTopicDraft(store,topicId,now);
    } else {
      store.db.prepare('INSERT INTO topics (id,title,start_date,end_date,post_id) VALUES (?,?,?,?,?)')
        .run(topicId,title,startDate,endDate,postId);
    }
    return {id:topicId,title,startDate,endDate,postId,version:(current?.version ?? 0)+1};
  });
}

export function requireTopic(store, id) {
  if (!store.db.prepare('SELECT 1 FROM topics WHERE id=?').get(id)) throw new AppError('找不到主題',404);
  return id;
}

export function linkTopicMaterial(store, topicId, kind, material) {
  if (topicId&&store.db.prepare('INSERT OR IGNORE INTO topic_materials VALUES (?,?,?)').run(topicId,kind,material.id).changes) {
    store.db.prepare('UPDATE topics SET version=version+1 WHERE id=?').run(topicId);
    if(kind==='article')invalidateTopicDraft(store,topicId);
  }
  return material;
}
