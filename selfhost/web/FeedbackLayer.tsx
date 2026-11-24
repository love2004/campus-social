import {useLayoutEffect,useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {AlertCircle,CheckCircle2,LoaderCircle,X} from 'lucide-react';
import './feedback-layer.css';

type Props={busy:string;message:string;tone:'success'|'error';onDismiss:()=>void};

export default function FeedbackLayer({busy,message,tone,onDismiss}:Props){
  const [host,setHost]=useState<HTMLElement>(()=>document.body);
  const dialogs=useRef<HTMLDialogElement[]>([]);
  const [seconds,setSeconds]=useState(0);
  useLayoutEffect(()=>{
    // A modal dialog lives in the browser top layer. Render feedback inside the
    // most recently opened dialog so no page z-index or backdrop can cover it.
    dialogs.current=Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'));
    const updateHost=()=>{
      dialogs.current=dialogs.current.filter(dialog=>dialog.isConnected&&dialog.open);
      setHost(dialogs.current.at(-1)||document.body);
    };
    updateHost();
    const observer=new MutationObserver(records=>{
      for(const record of records){
        if(record.type==='attributes'&&record.target instanceof HTMLDialogElement){
          const dialog=record.target;
          dialogs.current=dialogs.current.filter(item=>item!==dialog);
          if(dialog.open)dialogs.current.push(dialog);
        }
        if(record.type==='childList')for(const node of record.addedNodes){
          if(!(node instanceof Element))continue;
          const added=node instanceof HTMLDialogElement?[node]:Array.from(node.querySelectorAll<HTMLDialogElement>('dialog[open]'));
          for(const dialog of added)if(dialog.open&&!dialogs.current.includes(dialog))dialogs.current.push(dialog);
        }
      }
      updateHost();
    });
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
    return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    setSeconds(0);if(!busy)return;
    const started=Date.now(),timer=setInterval(()=>setSeconds(Math.floor((Date.now()-started)/1000)),1000);
    return()=>clearInterval(timer);
  },[busy]);
  if(!busy&&!message)return null;
  return createPortal(<div className="feedback-layer">
    {busy&&<div className="feedback-card working" role="status" aria-live="polite"><LoaderCircle className="spin" size={20}/><div><strong>{busy}…</strong>{busy.includes('配圖')&&<><p>正在等待 AI 配圖，完成後會自動帶入背景。</p><small aria-live="off">已等待 {Math.floor(seconds/60)} 分 {seconds%60} 秒</small></>}</div></div>}
    {message&&<div className={`feedback-card ${tone}`} role={tone==='error'?'alert':'status'}>{tone==='error'?<AlertCircle size={20}/>:<CheckCircle2 size={20}/>}<div><strong>{tone==='error'?'操作未完成':'操作完成'}</strong><p>{message}</p></div><button type="button" onClick={onDismiss} aria-label="關閉狀態提示"><X size={18}/></button></div>}
  </div>,host);
}
