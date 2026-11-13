import './product.jsx';
import React,{useState,useEffect,useRef,useImperativeHandle,forwardRef,createRef} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';

function DeveloperMenu(){
  const [open,setOpen]=useState(false);const host=useRef(null);
  useEffect(()=>{
    const outside=event=>{if(!host.current?.contains(event.target))setOpen(false);};
    const escape=event=>{if(open&&event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);};
  },[open]);
  return <div className="developer-menu" ref={host}>
    <button type="button" className="developer-menu-toggle" aria-expanded={open} aria-controls="developer-links" onClick={()=>setOpen(!open)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/></svg><span>API / WebMCP</span><small>⌄</small>
    </button>
    {open&&<div id="developer-links" className="developer-links"><p>DEVELOPER TOOLS</p>
      <a href="/api-docs" target="_blank" rel="noopener" onClick={()=>setOpen(false)}><b>APIドキュメント</b><small>Swagger UIで確認・実行</small><span>↗</span></a>
      <a href="/api-docs#webmcp" target="_blank" rel="noopener" onClick={()=>setOpen(false)}><b>WebMCP</b><small>AI向けブラウザー操作</small><span>↗</span></a>
      <a href="/openapi.json" target="_blank" rel="noopener" onClick={()=>setOpen(false)}><b>OpenAPI仕様</b><small>連携用のJSON定義</small><span>↗</span></a>
    </div>}
  </div>;
}

const PhotoEditor=forwardRef(function PhotoEditor({record},ref){
  const [entries,setEntries]=useState(()=>FactoryMedia.photos(record).map((file,index)=>({key:'existing-'+index,file})));
  const [cover,setCover]=useState(()=>{const photos=FactoryMedia.photos(record);return photos.length?'existing-'+Math.max(0,photos.findIndex(file=>file.fileId===record.coverPhotoId)):'';});
  const [dragging,setDragging]=useState(false),[error,setError]=useState('');const input=useRef(null),urls=useRef([]);
  useEffect(()=>()=>urls.current.forEach(url=>URL.revokeObjectURL(url)),[]);
  function add(files){
    const additions=[];let message='';
    for(const file of files){
      if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)){message='JPEG・PNG・WebP・GIFの写真を選んでください。';continue;}
      if(!file.size||file.size>20*1024*1024){message='各写真は20MB以下にしてください。';continue;}
      if(entries.length+additions.length>=30){message='写真は30枚まで追加できます。';break;}
      const url=URL.createObjectURL(file);urls.current.push(url);additions.push({key:'new-'+crypto.getRandomValues(new Uint32Array(1))[0]+'-'+additions.length,file,url,upload:true});
    }
    setError(message);if(!additions.length)return;setEntries([...entries,...additions]);if(!cover)setCover(additions[0].key);
  }
  function remove(key){const next=entries.filter(entry=>entry.key!==key);setEntries(next);if(cover===key)setCover(next[0]?.key||'');}
  useImperativeHandle(ref,()=>({async read(){
    const uploaded=await FactoryAPI.upload(entries.filter(entry=>entry.upload).map(entry=>entry.file));let index=0;
    const mapped=entries.map(entry=>({key:entry.key,file:entry.upload?uploaded[index++]:entry.file}));
    return {attachments:mapped.map(entry=>entry.file),coverPhotoId:mapped.find(entry=>entry.key===cover)?.file.fileId||''};
  }}),[entries,cover]);
  return <section className="react-photo-editor" data-react-photo-editor="true">
    <div className="react-photo-heading"><span>PHOTOS</span><small>{entries.length}枚</small></div>
    {!!entries.length&&<div className="photo-editor-list react-photo-grid">{entries.map((entry,index)=><article className={'photo-editor-item react-photo-card '+(cover===entry.key?'is-cover':'')} key={entry.key}>
      <div className="react-photo-image"><img loading="lazy" decoding="async" src={entry.url||FactoryMedia.photoURL(entry.file)} alt={entry.file.name}/>{cover===entry.key&&<span className="react-cover-badge">代表写真</span>}
      <button type="button" className="react-photo-remove" aria-label="写真を外す" data-remove-photo={index} onClick={()=>remove(entry.key)}>×</button></div>
      <div className="react-photo-card-body"><span title={entry.file.name}>{entry.file.name}</span><button type="button" className={'photo-cover '+(cover===entry.key?'selected':'')} data-cover={index} onClick={()=>setCover(entry.key)}>{cover===entry.key?'✓ 代表写真':'代表にする'}</button></div>
    </article>)}</div>}
    <label className={'react-photo-dropzone '+(dragging?'drag-over':'')} onDragOver={event=>{event.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);add([...event.dataTransfer.files]);}}>
      <input ref={input} type="file" className="photo-input" multiple accept="image/jpeg,image/png,image/webp,image/gif" onChange={event=>{add([...event.target.files]);event.target.value='';}}/>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><circle cx="8" cy="10" r="2"/><path d="m4 18 5-5 4 4 3-3 5 5M16 3h6m-3-3v6"/></svg>
      <strong>写真をドラッグして追加</strong><span>またはクリックしてファイルを選択</span><small>JPEG・PNG・WebP・GIF ／ 各5MBまで</small>
    </label>
    {error&&<p className="photo-input-error" role="alert">{error}</p>}
    <p className="photo-help">代表写真が、地図にマウスを重ねたときの先頭画像になります。</p>
  </section>;
});

window.FactoryReactPhotos={mount(container,record,dialog){
  const root=createRoot(container),controller=createRef();flushSync(()=>root.render(<PhotoEditor ref={controller} record={record}/>));
  let mounted=true;
  if(dialog){const cleanup=()=>{if(!container.isConnected||!dialog.open){if(mounted){root.unmount();mounted=false;}dialog.removeEventListener('close',cleanup);}};dialog.addEventListener('close',cleanup);}
  return {read:()=>{if(!mounted)throw new Error('写真の編集画面を開き直してください。');return controller.current.read();}};
}};
const menu=document.getElementById('developer-tools-root');if(menu)flushSync(()=>createRoot(menu).render(<DeveloperMenu/>));
