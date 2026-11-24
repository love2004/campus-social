import { z } from 'zod';
import { AppError, CATEGORIES } from './core.mjs';

export const categoryName = z.string().trim().min(1).max(40);
export const materialCategories = store => store.kv('materialCategories', CATEGORIES);

export function requireCategory(store, name) {
  if (!materialCategories(store).includes(name)) throw new AppError('此分類已變更，請重新選擇');
  return name;
}

export function saveMaterialCategory(store, previous, name) {
  return store.transaction(()=>{
    const categories=materialCategories(store);
    if(previous==='其他')throw new AppError('「其他」是預設分類');
    if(previous&&!categories.includes(previous))throw new AppError('找不到分類',404);
    if(name===previous)return categories;
    if(name&&(name.toLowerCase()==='all'||categories.some(item=>item.toLowerCase()===name.toLowerCase()&&item!==previous))) {
      throw new AppError('此分類名稱已使用或為保留名稱',409);
    }
    if(!previous&&categories.length>=50)throw new AppError('最多可設定 50 個分類');
    if(previous) {
      const replacement=name||'其他';
      for(const table of ['sources','articles','posts']) {
        store.db.prepare(`UPDATE ${table} SET data=json_set(data,'$.category',?) WHERE json_extract(data,'$.category')=?`)
          .run(replacement,previous);
      }
      for(const [table,field] of [['articles','assessment'],['posts','selection']]) {
        const path=`$.${field}.category`;
        store.db.prepare(`UPDATE ${table} SET data=json_set(data,?,?) WHERE json_extract(data,?)=?`)
          .run(path,replacement,path,previous);
      }
    }
    const next=previous?categories.flatMap(item=>item===previous?(name?[name]:[]):[item]):[...categories.slice(0,-1),name,'其他'];
    store.set('materialCategories',next);
    store.db.exec('UPDATE workspace_revision SET revision=revision+1 WHERE id=1');
    return next;
  });
}
