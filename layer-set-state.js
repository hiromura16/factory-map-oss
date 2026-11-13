/* Shared browser/API layer visibility operations. Public projection happens before this runs. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.FactoryLayerSetState=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>({
 apply(state,prefs,input){
  const ids=input.ids;if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length)throw new Error('レイヤーセットを1〜100個選択してください。');
  const sets=ids.map(id=>{const s=(state.layerSets||[]).find(x=>x.id===id);if(!s)throw new Error('利用できないレイヤーセットです。');return s;});
  const op=input.operation||'saved';if(!['saved','show','hide','isolate','intersection'].includes(op))throw new Error('表示操作が不正です。');
  const known=new Set(state.layers.map(l=>l.id)),hidden=new Set(prefs.hiddenLayerIds||[]);
  if(['isolate','intersection'].includes(op)){for(const id of known)hidden.add(id);const members=op==='intersection'?sets[0].rules.filter(r=>r.visible&&sets.every(s=>s.rules.some(x=>x.layerId===r.layerId&&x.visible))).map(r=>r.layerId):sets.flatMap(s=>s.rules.filter(r=>r.visible).map(r=>r.layerId));for(const id of members)hidden.delete(id);}
  else for(const set of sets){if(op==='saved'&&set.mode==='replace')for(const id of known)hidden.add(id);for(const r of set.rules){if(op==='hide'||op==='saved'&&!r.visible)hidden.add(r.layerId);else hidden.delete(r.layerId);}}
  return{hiddenLayerIds:[...hidden],...(op==='hide'?{}:{mapTypes:{works:true,assets:true,notes:true}})};
 }
}));
