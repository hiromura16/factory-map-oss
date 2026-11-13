/* Trusted SVG symbols and persisted equipment locks. */
window.FactoryEquipment = (() => {
  const symbols = {
    generic:['標準','<circle cx="12" cy="12" r="7"/><path d="M9 12h6m-3-3v6"/>'],
    aircon:['空調','<rect x="3" y="5" width="18" height="11" rx="2"/><path d="M6 9h12M6 13h12m-10 5v3m4-3v3m4-3v3"/>'],
    fan:['換気・ファン','<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 10C4 3 6 15 10 12m4 0c10 0 0-10-2-2m-1 4c-4 9 9 3 3-2"/>'],
    pipe:['配管','<path d="M3 8h7V3h5v10H8v8H3zM1 8h9m5-7v8M1 17h9"/>'],
    valve:['バルブ','<path d="M3 10l8 5V5l-8 5zm18 0l-8 5V5l8 5zM12 5V2m-4 0h8M2 10h2m16 0h2"/>'],
    pump:['ポンプ','<circle cx="12" cy="12" r="7"/><path d="M2 9h4m12 6h4M8 20h8M10 9l6 3-6 3z"/>'],
    electric:['電気・盤','<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M13 5l-5 8h5l-2 6 6-9h-5z"/>'],
    water:['給排水','<path d="M12 2C9 7 4 11 4 15a8 8 0 0016 0c0-4-5-8-8-13zM8 15c0 3 2 4 4 4"/>'],
    fire:['防災・消火','<path d="M13 2c2 6-4 6-1 10 0-3 3-4 4-6 5 7 7 15-4 16C1 21 4 12 7 9c-1 6 3 7 3 3-1-4 0-6 3-10z"/>'],
    boiler:['ボイラー・熱源','<rect x="4" y="6" width="16" height="13" rx="3"/><path d="M8 6V2m8 4V2M7 22v-3m10 3v-3M2 11h2m16 3h2"/><circle cx="12" cy="12" r="3"/>'],
    compressor:['圧縮空気','<rect x="3" y="7" width="18" height="12" rx="5"/><path d="M6 22v-3m12 3v-3M8 7V3h8v4m-4 4v4m-2-2h4"/>'],
    chiller:['冷却設備','<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 3 3-3m-6 16l3-3 3 3M4 10l4-1-1-4m13 9l-4 1 1 4M4 14l4 1-1 4m13-9l-4-1 1-4"/>'],
    building:['建物・建築','<path d="M3 22V4h12v18m0-14h6v14M1 22h22M6 8h2m3 0h1m-6 4h2m3 0h1m-6 4h2m3 0h1m6-4h2m-2 4h2"/>'],
    crane:['搬送・荷役','<path d="M4 22V3h13m-13 4h17M8 3l-4 4 4 4m9-4v8m0 0v3a3 3 0 01-6 0M2 22h7"/>'],
    safety:['安全・環境','<path d="M12 2l9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6zM8 12l3 3 5-6"/>'],
    drain:['排水処理','<path d="M3 5h18v14H3zM3 14c3-4 6 4 9 0s6 4 9 0M8 5V2m8 3V2M7 22v-3m10 3v-3"/>']
  };
  const categories={hvac:'aircon',water:'water',pipe:'pipe',power:'electric',air:'compressor',fire:'fire',heat:'boiler',cool:'chiller',building:'building',handling:'crane',effluent:'drain',safety:'safety'};
  const app=()=>window.factoryMap;
  function iconId(asset){const id=!asset.icon||asset.icon==='auto'?categories[asset.properties?.category]:asset.icon;return Object.hasOwn(symbols,id)?id:'generic';}
  function svg(id){return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${(Object.hasOwn(symbols,id)?symbols[id]:symbols.generic)[1]}</svg>`;}
  function markerHTML(asset){return `<div class="equipment-symbol symbol-${iconId(asset)}">${svg(iconId(asset))}${asset.locks?.position?'<span class="equipment-lock-dot" aria-hidden="true">▣</span>':''}</div>`;}
  function picker(asset){return `<fieldset class="equipment-icon-picker"><legend>地図のアイコン</legend><label><input type="radio" name="icon" value="auto" ${!asset?.icon||asset.icon==='auto'?'checked':''}><span>${svg(categories[asset?.properties?.category]||'generic')}<small>分類から自動</small></span></label>${Object.entries(symbols).map(([id,[label]])=>`<label><input type="radio" name="icon" value="${id}" ${asset?.icon===id?'checked':''}><span>${svg(id)}<small>${label}</small></span></label>`).join('')}</fieldset>`;}
  function locksHTML(asset){return `<fieldset class="equipment-lock-controls editor-only"><legend>設備の編集ロック</legend><label><input type="checkbox" data-equipment-lock="position" ${asset.locks?.position?'checked':''}>位置をロック</label><label><input type="checkbox" data-equipment-lock="attributes" ${asset.locks?.attributes?'checked':''}>属性・写真をロック</label><small>点検履歴はロック中でも記録できます。</small></fieldset>`;}
  function bindLocks(asset){
    document.querySelectorAll('[data-equipment-lock]').forEach(input=>input.onchange=async()=>{
      const controls=[...document.querySelectorAll('[data-equipment-lock]')];controls.forEach(el=>el.disabled=true);
      try{await FactoryAPI.request('/api/assets/'+encodeURIComponent(asset.id),{method:'PATCH',body:{locks:{position:!!asset.locks?.position,attributes:!!asset.locks?.attributes,[input.dataset.equipmentLock]:input.checked}}});await app().refresh();app().toast('設備のロック設定を保存しました。');}
      catch(error){input.checked=!input.checked;app().fail(error);}finally{controls.forEach(el=>el.disabled=false);}
    });
  }
  function refresh(){const button=document.getElementById('equipment-lock-all');if(!button)return;const assets=app().state.assets;const all=assets.length&&assets.every(a=>a.locks?.position&&a.locks?.attributes);button.textContent=all?'設備のロックを解除':'全設備をロック';button.dataset.locked=String(!!all);button.disabled=!assets.length;}
  function setup(){document.getElementById('equipment-lock-all').onclick=async()=>{
    const button=document.getElementById('equipment-lock-all'),lock=button.dataset.locked!=='true';button.disabled=true;
    try{await app().changeState(()=>{for(const asset of app().state.assets)asset.locks={position:lock,attributes:lock};});app().render();app().toast(lock?'全設備の位置・属性をロックしました。':'全設備のロックを解除しました。');}catch(error){app().fail(error);}finally{refresh();}
  };refresh();}
  return {iconId,svg,markerHTML,picker,locksHTML,bindLocks,setup,refresh};
})();
