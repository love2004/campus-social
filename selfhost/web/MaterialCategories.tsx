import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import type { Article } from './types';

export default function MaterialCategories({options,articles,busy,onSave,onRemove}:{
  options:string[];
  articles:Article[];
  busy:boolean;
  onSave:(name:string,previous?:string)=>Promise<void>;
  onRemove:(name:string)=>void;
}) {
  const [newName,setNewName]=useState('');
  const [edit,setEdit]=useState<{previous:string;name:string}|null>(null);
  return <section className="panel" aria-label="分類選項">
    <div className="panel-heading"><h2>分類選項</h2><span>{options.length} 個分類</span></div>
    <form className="panel-body" onSubmit={event=>{
      event.preventDefault();void onSave(newName.trim()).then(()=>setNewName(''),()=>{});
    }}>
      <label>新分類名稱<input value={newName} required maxLength={40} onChange={event=>setNewName(event.target.value)}/></label>
      <button className="btn primary" disabled={busy||!newName.trim()}><Plus size={16}/>新增分類</button>
    </form>
    {options.map(category=><div className="table-row" key={category}>
      {edit?.previous===category?<form onSubmit={event=>{
        event.preventDefault();void onSave(edit.name.trim(),category).then(()=>setEdit(null),()=>{});
      }}>
        <label>分類名稱<input autoFocus required maxLength={40} value={edit.name} onChange={event=>setEdit({...edit,name:event.target.value})}/></label>
        <button className="btn secondary" type="button" onClick={()=>setEdit(null)}>取消</button>{' '}
        <button className="btn primary" disabled={busy||!edit.name.trim()}>儲存名稱</button>
      </form>:<>
        <div><strong>{category}</strong><small>{articles.filter(article=>(article.category||'其他')===category).length} 篇文章{category==='其他'?' · 預設分類':''}</small></div>
        {category!=='其他'&&<div className="editor-buttons">
          <button className="btn secondary" disabled={busy} aria-label={`重新命名 ${category}`} onClick={()=>setEdit({previous:category,name:category})}><Pencil size={15}/>改名</button>
          <button className="btn secondary" disabled={busy} aria-label={`移除 ${category}`} onClick={()=>onRemove(category)}><Trash2 size={15}/>移除</button>
        </div>}
      </>}
    </div>)}
  </section>;
}
