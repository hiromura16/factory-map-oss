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
    drain:['排水処理','<path d="M3 5h18v14H3zM3 14c3-4 6 4 9 0s6 4 9 0M8 5V2m8 3V2M7 22v-3m10 3v-3"/>'],
    ahu:['空調機（AHU）','<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M8 5v14m7-14v14M4 9h2m-2 4h2m11-4h3m-3 4h3"/><circle cx="11.5" cy="12" r="2"/>'],
    ventilation:['排気ファン','<path d="M3 3h18v18H3zM6 6l12 12M6 18L18 6"/><circle cx="12" cy="12" r="6"/>'],
    duct:['ダクト','<path d="M2 8h10V3h8v13H9v5H2zM12 8l8 8M2 12h7m7-9v5"/>'],
    damper:['ダンパー','<path d="M2 6h20v12H2zM7 8l10 8M12 6V2m-3 0h6M12 18v4"/>'],
    'cooling-tower':['冷却塔','<path d="M6 4h12l-2 8 4 8H4l4-8zM8 4V2h8v2M5 16h14M8 20v2m8-2v2"/><circle cx="12" cy="9" r="2"/>'],
    'heat-exchanger':['熱交換器','<rect x="5" y="4" width="14" height="16" rx="3"/><path d="M2 7h3m14 10h3M9 7v10m3-10v10m3-10v10M2 17h3m14-10h3"/>'],
    heater:['ヒーター','<path d="M3 7h18v13H3zM7 10v7m5-7v7m5-7v7M7 2v3m5-3v3m5-3v3M6 20v2m12-2v2"/>'],
    humidifier:['加湿器','<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 8C4 5 12 5 8 2m4 6c-4-3 4-3 0-6m4 6c-4-3 4-3 0-6M8 17h8"/>'],
    tank:['タンク・貯槽','<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 15c0 4 16 4 16 0"/>'],
    'pressure-vessel':['圧力容器','<rect x="6" y="3" width="12" height="17" rx="6"/><path d="M9 20v2m6-2v2M12 3V1M3 10h3m12 6h3"/>'],
    flowmeter:['流量計','<path d="M2 9h5m10 6h5M2 6v6m20 0v6M8 15l7-7m-4 0h4v4"/><circle cx="12" cy="12" r="7"/>'],
    'pressure-gauge':['圧力計','<circle cx="12" cy="10" r="8"/><path d="M12 18v4m-4 0h8M12 10l4-4M6 10h1m10 0h1M12 4v1"/>'],
    strainer:['ストレーナー','<path d="M2 5h20v6H2zM8 11l6 10 6-3-4-7M12 12l5 7M12 21l9-5"/>'],
    filter:['フィルター','<path d="M5 3h14v18H5zM1 12h4m14 0h4M8 6l8 12M8 10l6 9M10 5l6 9"/>'],
    cylinder:['ガスボンベ','<rect x="7" y="5" width="10" height="17" rx="4"/><path d="M10 5V2h4v3M9 2h6M7 17h10"/>'],
    'water-treatment':['水処理装置','<path d="M2 7h6v14H2zM10 7h6v14h-6M8 11h2m6 6h6V4h-9v3M3 3h4m-2 0v4M12 10v7"/>'],
    transformer:['変圧器','<path d="M2 4h20v16H2zM5 8c4-4 4 12 0 8m14-8c-4-4-4 12 0 8M10 6v12m4-12v12M6 20v2m12-2v2"/>'],
    generator:['発電機','<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M5 6V3h6v3M5 10h4v5H5zM15 8l-3 6h4l-2 4M5 19v3m14-3v3"/>'],
    ups:['無停電電源（UPS）','<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 5h8v4H8zM13 12l-4 5h4l-2 4M8 12h1"/>'],
    battery:['蓄電池','<path d="M2 6h18v12H2zM20 10h2v4h-2M6 10v4m-2-2h4m6 0h3"/>'],
    motor:['モーター','<path d="M4 7h13v12H4zM17 10h5v6h-5M7 7V4h7v3M2 10h2m-2 6h2M7 19v3m7-3v3M8 10v6m5-6v6"/>'],
    inverter:['インバーター','<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M7 10l10-5M7 5h3m4 5h3M7 16c2-5 3 5 5 0s3 5 5 0"/>'],
    outlet:['コンセント','<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8v5m8-5v5m-4 3v2"/>'],
    solar:['太陽光発電','<path d="M4 9h16l2 10H2zM8 9l-1 10m9-10 1 10M3 14h18M12 19v3m-4 0h8M12 2v2m-5 0 1 2m9-2-1 2"/>'],
    machine:['工作機械','<path d="M3 3h18v18H3zM6 7h9v9H6zM10 7v5h3m5-5v2m0 3v2M6 21v1m12-1v1"/>'],
    cnc:['CNC・加工機','<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M5 6h10v11H5zM10 6v5m-3 3h6M18 6h1m-1 4h1m-1 4h1M5 19h10"/>'],
    press:['プレス機','<path d="M3 3h18v4H3zM5 7v14m14-14v14M2 21h20M10 7v5h4V7M7 16h10M9 18h6"/>'],
    robot:['産業用ロボット','<circle cx="8" cy="13" r="3"/><circle cx="15" cy="5" r="2"/><path d="M6 16l-2 6h9l-3-6M10 11l4-4M17 5h4v5l-3 2m3-2 2 2M2 22h13"/>'],
    welding:['溶接機','<rect x="2" y="9" width="11" height="12" rx="2"/><path d="M5 9V6h5v3M5 13h5M13 17h3l3-8m-3-4 3 2 3-3M20 13v3m1-5h2"/>'],
    furnace:['工業炉','<path d="M4 5h16v16H4zM8 5V2h4v3M7 9h10v8H7zM9 17c-2-4 3-3 2-6 4 3 5 5 2 6M7 21v1m10-1v1"/>'],
    mixer:['撹拌機・ミキサー','<path d="M5 7h14v11c0 5-14 5-14 0V7M9 7V2h6v5M12 7v11m-4-4 8 4m-8 0 8-4"/>'],
    scale:['計量器・はかり','<path d="M4 9h16l2 12H2zM3 6h18M12 6V2M7 13h10v5H7zM10 16h4"/>'],
    conveyor:['コンベヤー','<rect x="2" y="10" width="20" height="8" rx="4"/><circle cx="6" cy="14" r="1"/><circle cx="12" cy="14" r="1"/><circle cx="18" cy="14" r="1"/><path d="M5 18v4m14-4v4M8 10V4h8v6"/>'],
    forklift:['フォークリフト','<path d="M3 15V7h9v9H3M7 7V3h7v13M17 2v17h6M3 11h9"/><circle cx="6" cy="19" r="3"/><circle cx="14" cy="19" r="2"/>'],
    lift:['昇降機・エレベーター','<path d="M3 2h18v20H3zM6 8h12v14M12 8v14M7 5l2-2 2 2m2-2 2 2 2-2"/>'],
    rack:['保管ラック','<path d="M3 2v20M21 2v20M3 10h18M3 20h18M6 4h5v6H6zM14 4h4v6h-4zM7 13h10v7H7z"/>'],
    door:['シャッター','<path d="M2 22V3h20v19M5 22V6h14v16M5 10h14M5 14h14M5 18h14M10 21h4"/>'],
    dock:['荷捌き場','<path d="M2 16h20v6H2zM3 16V3h12v13M5 6h8m-8 4h8M17 8h5v8h-5zM19 8V5"/>'],
    extinguisher:['消火器','<rect x="7" y="7" width="10" height="15" rx="3"/><path d="M10 7V3h5M9 3h7m-1 2h4v8h2M10 11h4v6h-4z"/>'],
    hydrant:['消火栓','<path d="M7 8h10v13H7zM5 21h14M7 12H3V8h4m10 4h4V8h-4M9 8V5h6v3M8 5l4-3 4 3"/>'],
    alarm:['警報器・回転灯','<path d="M5 18h14l-2-10H7zM3 18h18v4H3zM12 1v3M3 5l2 2m16-2-2 2M9 11h6"/>'],
    detector:['煙・ガス検知器','<ellipse cx="12" cy="8" rx="9" ry="5"/><path d="M3 8v4c0 7 18 7 18 0V8M7 11v3m5-2v3m5-4v3M10 20h4"/>'],
    camera:['監視カメラ','<path d="M2 6h13l5 4-5 4H2zM20 9h2v3h-2M7 14v5h10v-3M5 9h3"/>'],
    'emergency-exit':['非常口','<path d="M3 22V2h12v20M1 22h16M7 7h3v7H7zM18 8l4 4-4 4m-5-4h9"/>'],
    thermometer:['温度計','<path d="M9 14V5a3 3 0 016 0v9a5 5 0 11-6 0M12 9v10m6-14h3m-3 4h2"/><circle cx="12" cy="18" r="1"/>'],
    sensor:['センサー','<circle cx="12" cy="12" r="3"/><path d="M7 7a7 7 0 000 10m10-10a7 7 0 010 10M4 4a11 11 0 000 16M20 4a11 11 0 010 16M12 15v7"/>'],
    network:['通信・ネットワーク','<path d="M3 2h18v7H3zM12 9v6M4 15h16M4 15v3m8-3v3m8-3v3M2 18h4v4H2zM10 18h4v4h-4zM18 18h4v4h-4zM6 5h1m3 0h1"/>'],
    lighting:['照明','<path d="M8 14a7 7 0 118 0l-1 3H9zM9 20h6m-5 2h4M12 7v6m-3-3 3 3 3-3"/>']
  };
  const families = [
    ['building','建物・共用',['generic','building','door','dock','lighting','network']],
    ['climate','空調・熱源・圧縮空気',['aircon','fan','ahu','ventilation','duct','damper','boiler','compressor','chiller','cooling-tower','heat-exchanger','heater','humidifier']],
    ['fluid','配管・給排水',['pipe','valve','pump','water','drain','tank','pressure-vessel','flowmeter','pressure-gauge','strainer','filter','cylinder','water-treatment']],
    ['power','電気・動力',['electric','transformer','generator','ups','battery','motor','inverter','outlet','solar']],
    ['production','生産・加工',['machine','cnc','press','robot','welding','furnace','mixer','scale']],
    ['logistics','搬送・保管',['crane','conveyor','forklift','lift','rack']],
    ['safety','防災・安全',['fire','safety','extinguisher','hydrant','alarm','detector','camera','emergency-exit']],
    ['instruments','計測・監視',['thermometer','sensor']]
  ];
  let customIcons=()=>[], categoryIcon=()=>'';
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function configureIcons(providers){customIcons=providers.icons;categoryIcon=providers.categoryIcon;}
  const categories={hvac:'aircon',water:'water',pipe:'pipe',power:'electric',air:'compressor',fire:'fire',heat:'boiler',cool:'chiller',building:'building',handling:'crane',effluent:'drain',safety:'safety'};
  const app=()=>window.factoryMap;
  function iconId(asset){const id=!asset.icon||asset.icon==='auto'?(categoryIcon(asset.properties?.category)||categories[asset.properties?.category]):asset.icon;return Object.hasOwn(symbols,id)||customIcons().some(x=>x.id===id)?id:'generic';}
  function svg(id){return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${(Object.hasOwn(symbols,id)?symbols[id]:symbols.generic)[1]}</svg>`;}
  function graphic(id){const custom=customIcons().find(x=>x.id===id);return custom?`<img src="${escape(custom.url)}" alt="">`:svg(id);}
  function label(id){return customIcons().find(x=>x.id===id)?.label||(Object.hasOwn(symbols,id)?symbols[id][0]:'標準');}
  function markerHTML(asset){const id=iconId(asset),family=families.find(x=>x[2].includes(id))?.[0]||'building';return `<div class="equipment-symbol symbol-${escape(id)} icon-family-${family}${id.startsWith('icon-')?' factory-custom-marker':''}">${graphic(id)}${asset.locks?.position?'<span class="equipment-lock-dot" aria-hidden="true">▣</span>':''}</div>`;}
  function currentHTML(value,category){const id=iconId({icon:value,properties:{category}});return `<span class="equipment-icon-preview">${graphic(id)}</span><span class="equipment-icon-description"><b>${escape(value==='auto'?'分類から自動':label(id))}</b><small>${value==='auto'?escape(label(id)):'地図に表示するアイコン'}</small></span><button type="button" class="button secondary" data-equipment-icon-open aria-haspopup="dialog">変更</button>`;}
  function picker(asset){const value=asset?.icon||'auto',category=asset?.properties?.category||'';return `<fieldset class="equipment-icon-control" data-equipment-category="${escape(category)}"><legend>地図のアイコン</legend><input type="hidden" name="icon" value="${escape(value)}"><div class="equipment-icon-current">${currentHTML(value,category)}</div></fieldset>`;}
  function openPicker(control){
    let dialog=document.getElementById('equipment-icons-dialog');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='equipment-icons-dialog';dialog.className='equipment-icons-dialog';document.body.append(dialog);}
    const input=control.querySelector('[name=icon]'),custom=customIcons(),category=control.dataset.equipmentCategory;
    const options=families.flatMap(([family,group,ids])=>ids.map(id=>({id,label:symbols[id][0],family,group}))).concat(custom.map(x=>({...x,family:'custom',group:'追加した画像'})));
    dialog.innerHTML=`<div class="dialog-heading"><div><p class="eyebrow">EQUIPMENT ICONS</p><h2 id="equipment-icons-title">地図アイコンを選ぶ</h2></div><button type="button" class="icon-close" aria-label="アイコン選択を閉じる">×</button></div><div class="equipment-icon-search"><label>名前で検索<input type="search" aria-label="アイコンを検索" placeholder="例：タンク、ロボット、温度"></label><label>設備の分野<select aria-label="アイコンの分野"><option value="">すべての分野</option>${families.map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}${custom.length?'<option value="custom">追加した画像</option>':''}</select></label></div><button type="button" class="equipment-icon-auto" data-icon-choice="auto" aria-pressed="${input.value==='auto'}">${graphic(iconId({icon:'auto',properties:{category}}))}<span><b>分類から自動</b><small>設備分類に合わせて表示</small></span></button><p class="equipment-icon-count" role="status"></p><div class="equipment-icon-options"></div><p class="equipment-icon-help">選択すると編集画面に戻ります。「保存する」で設備に反映します。</p>`;
    dialog.setAttribute('aria-labelledby','equipment-icons-title');
    dialog.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dialog.close();}};
    const choose=id=>{input.value=id;control.querySelector('.equipment-icon-current').innerHTML=currentHTML(id,category);input.dispatchEvent(new Event('change',{bubbles:true}));dialog.close();control.querySelector('[data-equipment-icon-open]').focus();};
    dialog.querySelector('.icon-close').onclick=()=>dialog.close();dialog.querySelector('[data-icon-choice=auto]').onclick=()=>choose('auto');
    const search=dialog.querySelector('input[type=search]'),filter=dialog.querySelector('select');
    const draw=()=>{const q=search.value.normalize('NFKC').toLocaleLowerCase().trim(),visible=options.filter(x=>(!filter.value||x.family===filter.value)&&[x.label,x.id,x.group].join(' ').normalize('NFKC').toLocaleLowerCase().includes(q));dialog.querySelector('.equipment-icon-count').textContent=`${visible.length}件 / 標準${Object.keys(symbols).length}種類${custom.length?'・追加画像'+custom.length+'件':''}`;const grid=dialog.querySelector('.equipment-icon-options');grid.innerHTML=visible.length?visible.map(x=>`<button type="button" data-icon-choice="${escape(x.id)}" aria-pressed="${input.value===x.id}" title="${escape(x.label)}">${graphic(x.id)}<span>${escape(x.label)}</span></button>`).join(''):'<p class="equipment-icon-empty">該当するアイコンがありません。検索語や分野を変えてください。</p>';grid.querySelectorAll('[data-icon-choice]').forEach(button=>button.onclick=()=>choose(button.dataset.iconChoice));};
    search.oninput=filter.onchange=draw;draw();dialog.showModal();search.focus();
  }
  function locksHTML(asset){return `<fieldset class="equipment-lock-controls editor-only"><legend>この設備のロック</legend><button type="button" class="equipment-item-lock button secondary" id="equipment-item-lock">${asset.locks?.position&&asset.locks?.attributes?'この設備のロックを解除':'この設備をまとめてロック'}</button><label><input type="checkbox" data-equipment-lock="position" ${asset.locks?.position?'checked':''}>位置をロック</label><label><input type="checkbox" data-equipment-lock="attributes" ${asset.locks?.attributes?'checked':''}>属性・写真をロック</label><small>点検履歴はロック中でも記録できます。</small></fieldset>`;}
  function bindLocks(asset){
    document.getElementById('equipment-item-lock').onclick=async()=>{const locked=!(asset.locks?.position&&asset.locks?.attributes);try{await FactoryAPI.request('/api/assets/'+encodeURIComponent(asset.id),{method:'PATCH',body:{locks:{position:locked,attributes:locked}}});await app().refresh();app().toast(locked?'この設備の位置と属性をロックしました。':'この設備のロックを解除しました。');}catch(error){app().fail(error);}};
    document.querySelectorAll('[data-equipment-lock]').forEach(input=>input.onchange=async()=>{
      const controls=[...document.querySelectorAll('[data-equipment-lock]')];controls.forEach(el=>el.disabled=true);
      try{await FactoryAPI.request('/api/assets/'+encodeURIComponent(asset.id),{method:'PATCH',body:{locks:{position:!!asset.locks?.position,attributes:!!asset.locks?.attributes,[input.dataset.equipmentLock]:input.checked}}});await app().refresh();app().toast('設備のロック設定を保存しました。');}
      catch(error){input.checked=!input.checked;app().fail(error);}finally{controls.forEach(el=>el.disabled=false);}
    });
  }
  function refresh(){const button=document.getElementById('equipment-lock-all');if(!button)return;const assets=app().state.assets;const all=assets.length&&assets.every(a=>a.locks?.position&&a.locks?.attributes);button.textContent=all?'設備のロックを解除':'全設備をロック';button.dataset.locked=String(!!all);button.disabled=!assets.length;}
  function setup(){
    document.addEventListener('click',event=>{const button=event.target.closest('[data-equipment-icon-open]');if(button)openPicker(button.closest('.equipment-icon-control'));});
    document.addEventListener('change',event=>{if(event.target.name!=='prop-category')return;const control=event.target.closest('form')?.querySelector('.equipment-icon-control');if(control){control.dataset.equipmentCategory=event.target.value;control.querySelector('.equipment-icon-current').innerHTML=currentHTML(control.querySelector('[name=icon]').value,event.target.value);}});
    document.getElementById('equipment-lock-all').onclick=async()=>{
    const button=document.getElementById('equipment-lock-all'),lock=button.dataset.locked!=='true';button.disabled=true;
    try{await app().changeState(()=>{for(const asset of app().state.assets)asset.locks={position:lock,attributes:lock};});app().render();app().toast(lock?'全設備の位置・属性をロックしました。':'全設備のロックを解除しました。');}catch(error){app().fail(error);}finally{refresh();}
  };refresh();}
  return {iconId,svg,markerHTML,picker,configureIcons,locksHTML,bindLocks,setup,refresh};
})();
