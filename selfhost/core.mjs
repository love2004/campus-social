import { createHash } from 'node:crypto';
import { z } from 'zod';

export const PLATFORMS = ['facebook', 'instagram', 'threads', 'line'];
export const NAMES = { facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads', line: 'LINE 官方帳號' };
export const CATEGORIES = ['校園新聞','活動公告','研究成果','招生資訊','國際交流','其他'];
export class AppError extends Error {
  constructor(message, status = 400, code = 'invalid_request') { super(message); this.status = status; this.code = code; }
}
const unique = (values) => new Set(values).size === values.length;
export const sourceInput = z.object({
  name: z.string().trim().min(1).max(100), url: z.string().url().max(2000),
  kind: z.enum(['website', 'feed']).default('website'), enabled: z.boolean().default(true),
  articleSelector: z.string().max(200).default(''), linkPattern: z.string().max(200).default(''),
  category:z.string().trim().min(1).max(40).default('其他'),
});
export const manualSourceInput = z.object({
  title: z.string().trim().min(1).max(200), text: z.string().trim().min(20).max(24000),
  url: z.union([z.literal(''), z.string().url().max(2000)]).default(''),
  category:z.string().trim().min(1).max(40).default('其他'),
});
export const settingsInput = z.object({
  unitName: z.string().trim().min(1).max(100).default('我的單位'),
  audience: z.string().max(300).default('關心本單位消息的讀者'),
  tone: z.string().max(300).default('親切、清楚、專業，使用繁體中文'),
  topics: z.string().max(1000).default(''), keywords: z.string().max(1000).default(''), excludes: z.string().max(1000).default(''),
  captionMinChars: z.number().int().min(80).max(400).default(200),
  captionMaxChars: z.number().int().min(80).max(400).default(300),
  weeklyLimit: z.number().int().min(1).max(100).default(5), scanMinutes: z.number().int().min(15).max(1440).default(120),
  sourceMaxAgeDays: z.number().int().min(1).max(365).default(30),
  draftMode:z.enum(['after_scan','scheduled']).default('after_scan'),
  draftWeekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(unique).default([1,2,3,4,5]),
  draftTimes:z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(8).refine(unique).default(['08:30','15:00']),
  dailyDraftLimit:z.number().int().min(1).max(20).default(2),
  archiveAfterDays:z.number().int().min(30).max(730).default(90),
  selectionMinChars:z.number().int().min(80).max(5000).default(200),
  aiSelectionEnabled:z.boolean().default(false),
  selectionMinScore:z.number().int().min(0).max(100).default(70),
  selectionMinFacts:z.number().int().min(1).max(6).default(3),
  selectionRules:z.string().max(3000).default('優先選擇與本單位讀者相關、能核對來源與具體事實的單篇文章。排除只有標題的列表頁、重複消息、已截止的活動、廣告與資訊不足的內容。日期不明時標註待核對。'),
  autoArtwork:z.enum(['manual','template','source','ai']).default('manual'),
  articleCardCount:z.union([z.literal(1),z.literal(3),z.literal(4),z.literal(5)]).default(1),
  topicCardCount:z.union([z.literal(1),z.literal(3),z.literal(4),z.literal(5)]).default(1),
  topicResearchEnabled:z.boolean().default(false),
  imageRules:z.string().max(2000).default('優先使用與單篇文章直接相關且經確認可使用的照片。AI 圖像使用主題概念插畫，文字另行排版，不假造活動現場、人物、數據或標誌。'),
  scheduleEnabled: z.boolean().default(false),
  topicAutoPublish: z.boolean().default(false),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).refine(unique).default([1, 3, 5]),
  times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(8).refine(unique).default(['10:00']),
  channels: z.array(z.enum(PLATFORMS)).min(1).max(4).refine(unique).default(PLATFORMS),
  catchUpMinutes: z.number().int().min(1).max(180).default(30),
  notifyEmail: z.union([z.literal(''), z.string().email().max(254)]).default(''),
  digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:00'),
  brandColor: z.string().regex(/^#[0-9a-f]{6}$/i).default('#23644e'),
  logoMediaId: z.string().max(80).default(''),
  aiProvider: z.enum(['codex', 'openai']).default('codex'),
  aiEnabled: z.boolean().default(false), apiTextModel: z.string().min(1).max(100).default('gpt-4.1-mini'),
  imageEnabled: z.boolean().default(false), imageProvider:z.enum(['codex','openai']).default('codex'), imageModel: z.string().min(1).max(100).default('gpt-image-2.5-sunburst'),
  // Reservations are conservative local ceilings, never claims about upstream invoices.
  monthlyBudget: z.number().min(0).max(10000).default(10),
  textReserve: z.number().min(0.01).max(10).default(0.1), imageReserve: z.number().min(0.1).max(100).default(1),
}).refine(s=>s.captionMinChars<=s.captionMaxChars,'文章最少字數不可大於最多字數');
export const defaultSettings = () => settingsInput.parse({});
export const postInput = z.object({
  title: z.string().trim().min(1).max(200),
  variants: z.object(Object.fromEntries(PLATFORMS.map(p => [p, z.string().max(p === 'threads' ? 500 : p === 'instagram' ? 2200 : p === 'line' ? 5000 : 12000)]))),
  mediaIds: z.array(z.string().min(1).max(80)).max(10).refine(unique),
  channels: z.array(z.enum(PLATFORMS)).max(4).refine(unique),
  category:z.string().trim().min(1).max(40).default('其他'),
  backup: z.boolean().default(false), expiresAt: z.string().max(40).default(''),
  sourceId: z.string().max(80).default(''), imagePrompt: z.string().max(3000).default(''),
  cardTitle:z.string().max(90).default(''),cardSummary:z.string().max(160).default(''),
}).superRefine((p, ctx) => {
  for (const channel of p.channels) if (!p.variants[channel].trim()) ctx.addIssue({ code: 'custom', message: `${NAMES[channel]} 內容不可空白`, path: ['variants', channel] });
  if (p.expiresAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(p.expiresAt)) ctx.addIssue({code:'custom', message:'有效期限必須含時區',path:['expiresAt']});
  if (p.expiresAt && !Number.isFinite(Date.parse(p.expiresAt))) ctx.addIssue({code:'custom', message:'有效期限無效',path:['expiresAt']});
});
export const cardInput=z.object({
  mediaId:z.string().max(80).default(''),postId:z.string().max(80).default(''),
  title:z.string().trim().min(1).max(150),subtitle:z.string().max(180).default(''),label:z.string().max(100).optional(),
  layout:z.enum(['photo','minimal']).default('photo'),format:z.enum(['square','portrait','landscape']).default('square'),
  titleX:z.number().min(0).max(95).optional(),titleY:z.number().min(0).max(95).optional(),
  subtitleX:z.number().min(0).max(95).optional(),subtitleY:z.number().min(0).max(95).optional(),
  labelX:z.number().min(0).max(95).optional(),labelY:z.number().min(0).max(95).optional(),
  titleSize:z.number().min(24).max(110).optional(),subtitleSize:z.number().min(18).max(70).optional(),labelSize:z.number().min(18).max(60).optional(),
  textColor:z.string().regex(/^#[0-9a-f]{6}$/i).optional(),shadeOpacity:z.number().min(0).max(1).optional(),
  imageZoom:z.number().min(1).max(3).optional(),imageX:z.number().min(0).max(100).optional(),imageY:z.number().min(0).max(100).optional(),
  align:z.enum(['left','center']).optional(),
});
export function contentHash(p) {
  return createHash('sha256').update(JSON.stringify([p.title, p.variants, p.mediaIds, p.channels, p.sourceId, p.expiresAt])).digest('hex');
}
export function localParts(now = new Date()) {
  const iso = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'short' }).format(now);
  const date = iso.slice(0, 10), time = iso.slice(11, 16);
  return { date, time, weekday: new Date(`${date}T12:00:00+08:00`).getUTCDay() };
}
export function taipeiDate(now = new Date()) { return localParts(now).date; }
export function weekStart(now = new Date()) {
  const d = new Date(`${taipeiDate(now)}T12:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return taipeiDate(d);
}
export function dueSlots(settings, from, until) {
  if (!settings.scheduleEnabled || !settings.weekdays.length) return [];
  const slots = [], end = new Date(`${taipeiDate(until)}T12:00:00+08:00`);
  let day = new Date(`${taipeiDate(from)}T12:00:00+08:00`);
  for (let count = 0; day <= end && count < 370; count++, day = new Date(day.getTime() + 86400000)) {
    if (!settings.weekdays.includes(day.getUTCDay())) continue;
    for (const time of settings.times) {
      const slot = new Date(`${taipeiDate(day)}T${time}:00+08:00`);
      if (slot > from && slot <= until) slots.push(slot.toISOString());
    }
  }
  return slots.sort();
}
export function upcomingSlots(settings, now = new Date(), days = 14) {
  return dueSlots({...settings, scheduleEnabled:true}, now, new Date(now.getTime() + days * 86400000));
}
export function choosePost(posts, channels, now) {
  return posts.filter(p => p.status === 'approved' && p.reviewHash === contentHash(p) &&
    (!p.expiresAt || Date.parse(p.expiresAt) > now.getTime()) && channels.some(c => p.channels.includes(c)))
    .sort((a,b) => Number(a.backup) - Number(b.backup) || a.queueOrder - b.queueOrder || a.createdAt.localeCompare(b.createdAt))[0];
}
export function words(s) { return s.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean); }
export function matchesRules(article, settings) {
  const text = `${article.title}\n${article.text}`.toLocaleLowerCase();
  const includes = [...words(settings.topics),...words(settings.keywords)].map(s=>s.toLocaleLowerCase());
  const excludes = words(settings.excludes).map(s=>s.toLocaleLowerCase());
  return !excludes.some(k=>text.includes(k)) && (!includes.length || includes.some(k=>text.includes(k)));
}
export function canonicalUrl(value) {
  const u = new URL(value); u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort(); return u.href;
}
