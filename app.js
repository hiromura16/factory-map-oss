/* Shared facility map; all writes are validated by the authenticated Rust API. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statusNames={active:'工事中',planned:'予定',done:'完了'};
  const colours={active:'#d79652',planned:'#779ed0',done:'#9aaf8a'};
  const uid=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const fmt=date=>date?date.replaceAll('-','.'):'—';
  const shortDate=date=>date?`${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`:'—';
  const ll=point=>[point[1],point[0]];
  let db,state,map,workGroup,assetGroup,baseGroup,scaleControl,currentDrawing='site',selectedId=null,tab='works',editor=false,pendingLayer=null,pendingPoints=null,impactOnly=false,toastTimer,searchTimer,drawingActive=false;
  const cadGroups={};
  let editingWorkId=null;
  const initialState=()=>({version:1,drawings:[{id:'site',name:'敷地全体図',type:'sample',asset:'assets/site-plan.svg',bounds:[[0,0],[1100,2000]],metres:true},{id:'floor-a1',name:'A棟 / 1F',type:'sample',asset:'assets/floor-plan.svg',bounds:[[0,0],[480,800]],metres:false}],works:[
    {id:'w1',code:'WK-001',drawingId:'site',title:'A棟南側 配管更新工事',location:'A棟 南側通路',start:'2026-11-09',end:'2026-11-20',status:'active',impacts:['通行止め','騒音'],notes:'老朽化した給水配管の更新を行います。\n作業中は南側通路を通行できません。A棟北側の通路へ迂回してください。\n\n作業時間：8:30〜17:00（土日を除く）',contact:'施設グループ 設備担当',phone:'2101',points:[[310,595],[765,595],[765,655],[310,655]],updatedAt:'2026-11-11T05:30:00Z',attachments:[]},
    {id:'w2',code:'WK-002',drawingId:'site',title:'B棟東側 外壁補修',location:'B棟 東側外周',start:'2026-11-10',end:'2026-11-27',status:'active',impacts:['車両通行'],notes:'外壁の補修に伴い、作業車両が出入りします。\n誘導員の案内に従って通行してください。',contact:'施設グループ 建築担当',phone:'2102',points:[[1435,675],[1490,675],[1490,895],[1435,895]],updatedAt:'2026-11-10T00:10:00Z',attachments:[]},
    {id:'w3',code:'WK-003',drawingId:'site',title:'構内中央通路 舗装補修',location:'中央通路 交差点付近',start:'2026-11-12',end:'2026-11-14',status:'active',impacts:['通行止め'],notes:'段差解消のため舗装を補修します。\n西側・東側の指定迂回路をご利用ください。',contact:'施設グループ 土木担当',phone:'2103',points:[[800,535],[935,535],[935,625],[800,625]],updatedAt:'2026-11-11T08:00:00Z',attachments:[]},
    {id:'w4',code:'WK-004',drawingId:'site',title:'動力棟 空調設備の更新',location:'動力棟 南側',start:'2026-11-16',end:'2026-11-18',status:'planned',impacts:['騒音'],notes:'空調設備の入れ替えを予定しています。\n詳細な作業時間は確定後に追記します。',contact:'施設グループ 設備担当',phone:'2101',points:[[1560,645],[1800,645],[1800,685],[1560,685]],updatedAt:'2026-11-10T04:00:00Z',attachments:[]},
    {id:'w5',code:'WK-005',drawingId:'site',title:'C棟 搬入口の補修',location:'C棟 南側搬入口',start:'2026-11-02',end:'2026-11-06',status:'done',impacts:[],notes:'補修は完了しました。通常どおり通行できます。',contact:'施設グループ 建築担当',phone:'2102',points:[[440,225],[610,225],[610,265],[440,265]],updatedAt:'2026-11-06T08:00:00Z',attachments:[]},
    {id:'w6',code:'WK-006',drawingId:'floor-a1',title:'空調機フィルター交換',location:'A棟1F 空調機械室',start:'2026-11-13',end:'2026-11-13',status:'planned',impacts:[],notes:'空調機の定期保守を行います。',contact:'施設グループ 設備担当',phone:'2101',points:[[600,260],[735,260],[735,410],[600,410]],updatedAt:'2026-11-11T02:00:00Z',attachments:[]}
  ],assets:[
    {id:'a1',drawingId:'site',name:'A棟 空調室外機',code:'AC-A-001',location:'A棟 北側',point:[550,900],model:'サンプル型式 AC-100',installed:'2021-04-01',history:[{date:'2026-10-05',text:'定期点検・フィルター清掃'},{date:'2026-04-02',text:'冷媒漏れ点検'}],attachments:[]},
    {id:'a2',drawingId:'site',name:'受変電盤',code:'EL-001',location:'受変電設備',point:[1670,380],model:'サンプル型式 EL-200',installed:'2019-03-15',history:[{date:'2026-09-20',text:'年次点検'}],attachments:[]},
    {id:'a3',drawingId:'site',name:'給水ポンプ',code:'WP-001',location:'動力棟 南側',point:[1700,620],model:'サンプル型式 WP-300',installed:'2023-06-01',history:[{date:'2026-11-02',text:'圧力・振動確認'}],attachments:[]},
    {id:'a4',drawingId:'floor-a1',name:'空調機 AHU-01',code:'AHU-A-001',location:'A棟1F 空調機械室',point:[675,345],model:'サンプル型式 AHU-01',installed:'2021-04-01',history:[{date:'2026-10-05',text:'定期点検'}],attachments:[]}
  ]});

  function openDB(){return new Promise((resolve,reject)=>{const request=indexedDB.open('factory-map-local',1);request.onupgradeneeded=()=>request.result.createObjectStore('app');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  function readState(){return new Promise((resolve,reject)=>{const req=db.transaction('app').objectStore('app').get('state');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  async function writeState(){await FactoryAPI.save(state);}
  async function changeState(fn){const previous=structuredClone(state);try{fn();await writeState();}catch(error){state=previous;throw error;}}
  function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?8000:4500);}
  function fail(error){console.error(error);toast(error.message||'操作を完了できませんでした。',true);}
  function openDialog(id){$(id).showModal();}
  function closeDialog(id){$(id).close();if(id==='work-dialog')clearPending();}
  function current(){return state.drawings.find(x=>x.id===currentDrawing);}
  function getRecord(){return(tab==='works'?state.works:state.assets).find(x=>x.id===selectedId&&x.drawingId===currentDrawing);}
  function workMatches(record){
    if(record.drawingId!==currentDrawing)return false;
    const query=$('search').value.trim().toLocaleLowerCase();
    if(query&&![record.title,record.location,record.contact,record.notes,record.code].join(' ').toLocaleLowerCase().includes(query))return false;
    const status=$('status-filter').value;
    if(status!=='all'&&record.status!==status)return false;
    if(impactOnly&&(record.status==='done'||(!record.impacts.includes('通行止め')&&!record.impacts.includes('車両通行'))))return false;
    if($('date-toggle').getAttribute('aria-pressed')==='true'){
      const date=$('date-filter').value;
      if(!date||record.start>date||record.end<date)return false;
    }
    return true;
  }
  function records(){if(tab==='works'){const order={active:0,planned:1,done:2};return state.works.filter(workMatches).sort((a,b)=>order[a.status]-order[b.status]||a.start.localeCompare(b.start));}const q=$('search').value.trim().toLocaleLowerCase();return state.assets.filter(a=>a.drawingId===currentDrawing&&(!$('asset-category').value||a.properties?.category===$('asset-category').value)&&(!q||[a.name,a.code,a.location,...state.propertyDefinitions.map(d=>FactoryFeatures.displayValue(d,a.properties?.[d.id]))].join(' ').toLocaleLowerCase().includes(q)));}
  function updateSummary(){const works=state.works.filter(x=>x.drawingId===currentDrawing);$('total-count').textContent=works.length;$('active-count').textContent=works.filter(x=>x.status==='active').length;$('planned-count').textContent=works.filter(x=>x.status==='planned').length;$('impact-count').textContent=works.filter(x=>x.status!=='done'&&(x.impacts.includes('通行止め')||x.impacts.includes('車両通行'))).length;}
  function renderList(){
    const items=records();$('list-count').textContent=state.works.filter(x=>x.drawingId===currentDrawing).length;
    $('list-caption').textContent=tab==='works'?`${items.length}件の工事`:`${items.length}件の設備`;
    $('record-list').innerHTML=items.length?items.map(r=>tab==='works'?`<button class="record-card ${r.id===selectedId?'selected':''}" data-id="${escapeHTML(r.id)}" aria-pressed="${r.id===selectedId}"><div class="record-top"><span class="status status-${r.status}">${statusNames[r.status]}</span><span class="record-number">${escapeHTML(r.code)}</span></div><h3>${escapeHTML(r.title)}</h3><p>場所 ${escapeHTML(r.location||'場所未入力')}</p><p>◷ ${fmt(r.start)} — ${fmt(r.end)}</p><div>${r.impacts.map(x=>`<span class="impact-tag ${x==='騒音'?'quiet':''}">${escapeHTML(x)}</span>`).join('')}</div></button>`:`<button class="record-card ${r.id===selectedId?'selected':''}" data-id="${escapeHTML(r.id)}"><div class="record-top"><span class="status status-planned">設備</span><span class="record-number">${escapeHTML(r.code)}</span></div><h3>${escapeHTML(r.name)}</h3><p>場所 ${escapeHTML(r.location)}</p><p>最終点検 ${escapeHTML(r.history[0]?.date||'未登録')}</p></button>`).join(''):`<div class="empty-state"><strong>${tab==='works'?'該当する工事がありません':'設備がありません'}</strong>${tab==='works'?'条件を変更するか、この図面に工事を登録してください。':'この図面の設備台帳はまだ登録されていません。'}</div>`;
    $('record-list').querySelectorAll('[data-id]').forEach(el=>el.addEventListener('click',()=>selectRecord(el.dataset.id,true)));
  }
  function attachmentsHTML(record){return FactoryFeatures.filesHTML(record);}
  function renderDetail(){
    const record=getRecord(),pane=$('detail-pane');
    if(!record){pane.classList.add('collapsed');pane.innerHTML='<div class="detail-titlebar">詳細情報</div><div class="detail-placeholder"><span>⌖</span>図面上の範囲やマーク、<br>一覧の項目を選んでください。</div>';return;}
    if(pane.dataset.recordId!==record.id){pane.scrollTop=0;pane.dataset.recordId=record.id;}
    pane.classList.remove('collapsed');
    const titlebar=`<div class="detail-titlebar">${tab==='works'?'工事の詳細':'設備の詳細'}<button id="detail-close" aria-label="詳細を閉じる">×</button></div>`;
    if(tab==='works'){
      pane.innerHTML=titlebar+`<div><span class="status status-${record.status}">${statusNames[record.status]}</span></div><h2>${escapeHTML(record.title)}</h2><p class="detail-location">場所 ${escapeHTML(record.location||'場所未入力')}</p><div class="detail-period"><small>◷ 工事期間</small><strong>${fmt(record.start)}<br>— ${fmt(record.end)}</strong></div><h3>周囲への影響</h3><div class="detail-impact">${record.impacts.length?record.impacts.map(x=>`<span class="impact-tag">${escapeHTML(x)}</span>`).join(''):'<span class="detail-description">登録なし</span>'}</div>${record.impacts.includes('通行止め')?'<div class="notice-box">⚑ 通行止めの範囲をご確認ください。<br>迂回については工事内容をご覧ください。</div>':''}<h3>工事内容・注意事項</h3><p class="detail-description">${escapeHTML(record.notes||'詳細は担当者へお問い合わせください。')}</p><h3>担当・お問い合わせ</h3><div class="detail-contact">${escapeHTML(record.contact||'未登録')}<br><b>${record.phone?'内線 '+escapeHTML(record.phone):''}</b></div>${FactoryMedia.gallery(record)}<h3>関連資料</h3>${attachmentsHTML({attachments:(record.attachments||[]).filter(file=>!FactoryMedia.isPhoto(file))})}<div class="detail-actions editor-only"><button class="button secondary" id="work-edit">情報を編集</button><button class="button secondary" id="geometry-edit">範囲を描き直す</button></div><div class="detail-meta">${escapeHTML(record.code)}<br>更新 ${escapeHTML(new Date(record.updatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}))} JST</div>`;
      pane.insertAdjacentHTML('beforeend',FactoryFeatures.workRelations(record));FactoryFeatures.bindWork(record);
      if(editor){$('work-edit').onclick=()=>openWorkForm(record);$('geometry-edit').onclick=()=>startDraw(record.id);}
    }else{
      pane.innerHTML=titlebar+FactoryFeatures.assetHTML(record);FactoryFeatures.bindAsset(record);
    }
    $('detail-close').onclick=()=>{selectedId=null;render();};
  }
  function renderMapRecords(){
    workGroup.clearLayers();assetGroup.clearLayers();
    const visibleWorks=tab==='works'?records():state.works.filter(x=>x.drawingId===currentDrawing);
    for(const work of visibleWorks){
      if(work.id===editingWorkId)continue;
      const selected=work.id===selectedId&&tab==='works';
      const polygon=L.polygon(work.points.map(ll),{color:colours[work.status],weight:selected?3:1.6,fillColor:colours[work.status],fillOpacity:selected ? .25 : .13,dashArray:work.status==='planned'?'6 5':undefined,pmIgnore:true});
      FactoryMedia.bindHover(polygon,work,work.title,{permanent:true,direction:'top',className:`work-label ${work.status==='active'?'active-label':''}`,opacity:.97});
      polygon.on('click',()=>{if(drawingActive)return;switchTab('works',false);selectRecord(work.id,false);});
      workGroup.addLayer(polygon);if(selected)polygon.bringToFront();
    }
    const visibleAssets=editor?(tab==='assets'?records():state.assets.filter(x=>x.drawingId===currentDrawing)):[];
    for(const asset of visibleAssets){
      const marker=L.marker(ll(asset.point),{draggable:editor&&!asset.locks?.position,autoPan:true,
        title:asset.name+(asset.locks?.position?'：位置はロック中':'：ドラッグで位置を変更'),
        icon:L.divIcon({className:'asset-marker '+(asset.locks?.position?'position-locked':''),html:FactoryEquipment.markerHTML(asset),iconSize:[32,32],iconAnchor:[16,16]}),pmIgnore:true});
      marker.on('add',()=>{marker.getElement().dataset.assetId=asset.id;marker.getElement().setAttribute('aria-label',asset.name+'：ドラッグで移動');});
      FactoryMedia.bindHover(marker,asset,asset.name);
      marker.on('click',()=>{if(drawingActive)return;switchTab('assets',false);selectRecord(asset.id,false);});
      marker.on('dragend',async()=>{
        const point=marker.getLatLng();
        try{
          await changeState(()=>{
            if(!editor)throw new Error('施設グループのパスワードでログインしてください。');
            const current=state.assets.find(item=>item.id===asset.id);
            if(!current)throw new Error('設備が見つかりません。最新の情報を読み込んでください。');
            if(current.locks?.position)throw new Error('位置のロックを解除してから移動してください。');
            current.point=[Number(point.lng.toFixed(6)),Number(point.lat.toFixed(6))];current.updatedAt=new Date().toISOString();
          });
          render();toast('設備の位置を保存しました。');
        }catch(error){render();fail(error);}
      });
      assetGroup.addLayer(marker);
    }
    if($('show-works').checked){if(!map.hasLayer(workGroup))workGroup.addTo(map);}else map.removeLayer(workGroup);
    if(editor&&$('show-assets').checked){if(!map.hasLayer(assetGroup))assetGroup.addTo(map);}else map.removeLayer(assetGroup);
  }
  function render(){FactoryEquipment.refresh();updateSummary();renderList();renderDetail();renderMapRecords();FactoryNotes.render();FactoryFeatures.filters();$('asset-category').hidden=tab!=='assets';}
  function selectRecord(id,zoom){selectedId=id;render();const record=getRecord();if(zoom&&record){if(tab==='works')map.fitBounds(L.latLngBounds(record.points.map(ll)).pad(1.8),{maxZoom:2,animate:true});else map.panTo(ll(record.point));}}
  function fitMap(){const compact=window.matchMedia('(max-width:680px)').matches;if(current())map.fitBounds(current().bounds,{padding:compact?[15,45]:[45,65],animate:false});}
  function setDrawing(id){
    clearPending();currentDrawing=id;selectedId=null;baseGroup.clearLayers();Object.keys(cadGroups).forEach(x=>delete cadGroups[x]);$('drawing-select').value=id;
    const drawing=current();
    if(drawing.type==='sample'){
      L.imageOverlay(drawing.asset,drawing.bounds,{interactive:false,pmIgnore:true}).addTo(baseGroup);$('cad-layers').innerHTML='';$('map-source').textContent=id==='site'?'サンプル配置図 · 約2km × 1km':'A棟1F · サンプル平面図';
    }else{
      for(const layer of drawing.cad.layers){cadGroups[layer]=L.layerGroup().addTo(baseGroup);}
      for(const feature of drawing.cad.features){
        const points=feature.points.map(ll);let layer;
        if(feature.kind==='text')layer=L.marker(points[0],{icon:L.divIcon({className:'cad-text',html:escapeHTML(feature.text),iconSize:null}),interactive:false,pmIgnore:true});
        else if(feature.kind==='point')layer=L.circleMarker(points[0],{radius:2,color:'#7c9270',weight:1,pmIgnore:true});
        else if(feature.kind==='polygon')layer=L.polygon(points,{color:'#9aad8b',fillColor:'#dce6d1',fillOpacity:.2,weight:1.2,interactive:false,pmIgnore:true});
        else layer=L.polyline(points,{color:'#9aad8b',weight:1.15,interactive:false,pmIgnore:true});
        layer.addTo(cadGroups[feature.layer]);
      }
      $('cad-layers').innerHTML='<h4>CADレイヤー</h4>'+drawing.cad.layers.map((name,i)=>`<label class="cad-layer"><input type="checkbox" checked data-layer-index="${i}">${escapeHTML(name)}</label>`).join('');
      $('cad-layers').querySelectorAll('[data-layer-index]').forEach(el=>el.onchange=()=>{const group=cadGroups[drawing.cad.layers[Number(el.dataset.layerIndex)]];if(el.checked)baseGroup.addLayer(group);else baseGroup.removeLayer(group);});
      $('map-source').textContent=`DXF · ${drawing.cad.features.length.toLocaleString()}要素 · ${drawing.cad.layers.length}レイヤー${drawing.cad.metres?' · m換算':' · 単位指定なし'}`;
    }
    if(scaleControl){scaleControl.remove();scaleControl=null;}
    if(drawing.metres)scaleControl=L.control.scale({position:'bottomleft',imperial:false,maxWidth:90}).addTo(map);
    updateDrawingSelect();render();fitMap();
  }
  function updateDrawingSelect(){$('drawing-select').innerHTML=state.drawings.map(d=>`<option value="${escapeHTML(d.id)}">${escapeHTML(d.name)}</option>`).join('');$('drawing-select').value=currentDrawing;}
  function switchTab(next,doRender=true){if(next==='assets'&&!editor)next='works';tab=next;$('show-assets').checked=next==='assets';selectedId=null;$('works-tab').classList.toggle('selected',next==='works');$('assets-tab').classList.toggle('selected',next==='assets');$('works-tab').setAttribute('aria-selected',String(next==='works'));$('assets-tab').setAttribute('aria-selected',String(next==='assets'));$('search').placeholder=next==='works'?'工事名・場所で検索':'設備名・設備IDで検索';$('search').setAttribute('aria-label',$('search').placeholder);$('status-filter').disabled=next!=='works';$('date-toggle').disabled=next!=='works';if(doRender)render();}

  function clearPending(){
    const wasEditing=editingWorkId!==null;editingWorkId=null;document.body.classList.remove('work-form-open');$('drawing-select').disabled=false;
    if($('work-dialog').open)$('work-dialog').close();$('work-dialog').classList.remove('work-edit-panel');
    window.FactoryFeatures?.cancelPlacement();window.FactoryNotes?.cancel();
    if(map?.pm){map.pm.disableDraw();}
    if(pendingLayer){const layer=pendingLayer;pendingLayer=null;layer.pm?.disable();map.removeLayer(layer);}
    pendingPoints=null;drawingActive=false;map?._container.classList.remove('drawing-now');$('draw-instruction').hidden=true;if(wasEditing&&map&&state)renderMapRecords();
  }
  let redrawId=null;
  function startDraw(existingId=null){if(!editor)return;clearPending();redrawId=existingId;drawingActive=true;$('draw-instruction').hidden=false;$('layers-panel').hidden=true;$('layers-toggle').setAttribute('aria-expanded','false');map.pm.enableDraw('Polygon',{allowSelfIntersection:false,snappable:true,templineStyle:{color:'#238873'},hintlineStyle:{color:'#238873',dashArray:'5 5'},pathOptions:{color:'#238873',fillOpacity:.14}});}
  function openWorkForm(record=null){
    if($('work-dialog').open)closeDialog('work-dialog');
    $('work-form').reset();$('form-error').textContent='';$('work-id').value=record?.id||'';$('form-title').textContent=record?'工事情報を編集':'工事を登録';$('field-title').value=record?.title||'';$('field-location').value=record?.location||'';$('field-start').value=record?.start||today();$('field-end').value=record?.end||today();$('field-status').value=record?.status||'planned';$('field-notes').value=record?.notes||'';$('field-contact').value=record?.contact||'施設グループ';$('field-phone').value=record?.phone||'';document.querySelectorAll('[name=impact]').forEach(el=>el.checked=record?.impacts.includes(el.value)||false);$('geometry-message').textContent=pendingPoints?'地図上に指定した範囲を、この工事に保存します。':'登録済みの工事範囲を保持して、情報を更新します。';FactoryFeatures.workPrepare(record);
    const points=pendingPoints||record?.points;
    if(points){
      editingWorkId=record?.id||'__new__';pendingPoints=structuredClone(points);
      if(!pendingLayer)pendingLayer=L.polygon(points.map(ll),{pane:'workEditingPane',color:'#238873',weight:3,fillOpacity:.18,pmIgnore:false}).addTo(map);
      const capture=()=>{if(pendingLayer)pendingPoints=pendingLayer.getLatLngs()[0].map(point=>[point.lng,point.lat]);};
      pendingLayer.on('pm:edit pm:change pm:update',capture);
      pendingLayer.pm.enable({allowSelfIntersection:false,snappable:true,allowRemoval:false});
      $('geometry-message').textContent='地図上の頂点をドラッグして範囲を変更できます。工事情報と範囲は「保存する」でまとめて確定します。';
      $('work-dialog').classList.add('work-edit-panel');document.body.classList.add('work-form-open');$('drawing-select').disabled=true;
      renderMapRecords();$('work-dialog').show();
    }else openDialog('work-dialog');
  }
  function fileAsDataURL(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('添付資料を読み込めませんでした。'));reader.readAsDataURL(file);});}
  async function saveWork(event){
    event.preventDefault();if(!editor)return;
    const start=$('field-start').value,end=$('field-end').value,title=$('field-title').value.trim();
    if(!title){$('form-error').textContent='工事名を入力してください。';return;}
    if(end<start){$('form-error').textContent='終了日は開始日以降にしてください。';return;}
    const existing=state.works.find(w=>w.id===$('work-id').value);
    if(pendingLayer)pendingPoints=pendingLayer.getLatLngs()[0].map(point=>[point.lng,point.lat]);
    if(!pendingPoints&&!existing){$('form-error').textContent='地図上で工事範囲を指定してください。';return;}
    const submit=$('work-form').querySelector('[type=submit]');submit.disabled=true;
    try{
      const media=await FactoryFeatures.workFiles();const attachments=media.attachments;
      const record={id:existing?.id||uid(),code:existing?.code||`WK-${String(state.works.length+1).padStart(3,'0')}`,drawingId:currentDrawing,title,location:$('field-location').value.trim(),start,end,status:$('field-status').value,notes:$('field-notes').value.trim(),contact:$('field-contact').value.trim(),phone:$('field-phone').value.trim(),impacts:[...document.querySelectorAll('[name=impact]:checked')].map(x=>x.value),points:pendingPoints||existing.points,updatedAt:new Date().toISOString(),attachments,coverPhotoId:media.coverPhotoId,assetIds:[...$('work-asset-ids').selectedOptions].map(o=>o.value)};
      await changeState(()=>{if(existing)state.works[state.works.findIndex(w=>w.id===existing.id)]=record;else state.works.push(record);});
      $('work-dialog').close();clearPending();switchTab('works',false);$('status-filter').value='all';$('search').value='';$('date-toggle').setAttribute('aria-pressed','false');$('date-filter-wrap').hidden=true;impactOnly=false;document.querySelectorAll('[data-summary]').forEach(x=>x.classList.toggle('active',x.dataset.summary==='all'));selectedId=record.id;render();toast(existing?'工事情報を更新しました。':'工事を登録しました。');
    }catch(error){$('form-error').textContent=`保存できませんでした。${error.message||'サーバーとの接続を確認してください。'}`;}finally{submit.disabled=false;}
  }
  async function importDXF(file){
    if(!file)return;
    if(!/\.dxf$/i.test(file.name))throw new Error('この試作ではDXF形式に対応しています。DWGはDXFに変換して読み込んでください。');
    if(file.size>10*1024*1024)throw new Error('DXFは10MBまでです。図面を分割してください。');
    $('import-message').textContent='図面を解析しています…';$('sample-import').disabled=true;
    try{
      await new Promise(resolve=>setTimeout(resolve,40));
      const raw=await file.text(),cad=FactoryCAD.parse(raw);
      const drawing={id:uid(),name:file.name.replace(/\.dxf$/i,''),type:'dxf',bounds:cad.bounds,metres:cad.metres,cad,rawSource:raw,filename:file.name};
      await changeState(()=>state.drawings.push(drawing));
      $('import-dialog').close();$('import-message').textContent='';setDrawing(drawing.id);switchTab('works');$('search').value='';
      const skipped=Object.entries(cad.skipped).map(([type,count])=>`${type}: ${count}件`).join('、');
      toast(`${cad.features.length}要素を読み込みました。${skipped?'未対応・省略：'+skipped:'この図面に工事を登録できます。'}`,!!skipped);
    }finally{$('sample-import').disabled=false;$('cad-file').value='';}
  }
  function download(name,blob){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function setEditor(value){
    editor=value;document.body.classList.toggle('read-only',!value);
    $('view-mode').setAttribute('aria-pressed',String(value));
    $('view-mode').textContent=value?'施設担当モード':'閲覧モード';
    $('page-heading').textContent=value?'工事と施設を、ひとつの図面で。':'構内の工事とお知らせ。';
    $('page-subtitle').textContent=value?'構内の作業予定や設備の情報を、場所から確認できます。':'工事範囲や作業予定、お知らせを確認できます。';
    clearPending();
    if(!value){
      state.assets=[];state.propertyDefinitions=[];
      for(const work of state.works)work.assetIds=[];
      const ids=new Set(['site',...state.works.map(w=>w.drawingId),...(state.notes||[]).map(n=>n.drawingId)]);
      state.drawings=state.drawings.filter(d=>ids.has(d.id));
      switchTab('works',false);$('show-assets').checked=false;
      setDrawing(state.drawings.find(d=>d.id==='site')?.id||state.drawings[0].id);
    }else render();
    window.dispatchEvent(new CustomEvent('factory-mode-changed',{detail:{editor:value}}));
    toast(value?'施設担当モードに切り替えました。':'閲覧モードに切り替えました。');
  }
  function bindEvents(){
    document.querySelectorAll('[data-close]').forEach(el=>el.onclick=()=>closeDialog(el.dataset.close));
    document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog(dialog.id);}}));
    $('work-dialog').addEventListener('cancel',()=>{clearPending();renderMapRecords();});$('work-dialog').addEventListener('close',()=>{if(!$('work-dialog').open&&(editingWorkId||pendingLayer)){clearPending();renderMapRecords();}});
    $('map-nav').onclick=fitMap;$('plan-open').onclick=()=>openDialog('plan-dialog');$('import-open').onclick=()=>{$('import-message').textContent='';openDialog('import-dialog');};$('work-add').onclick=()=>startDraw();$('draw-cancel').onclick=clearPending;$('work-form').onsubmit=saveWork;$('view-mode').onclick=()=>setEditor(!editor);
    $('drawing-select').onchange=e=>setDrawing(e.target.value);$('fit-map').onclick=fitMap;
    $('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{selectedId=null;render();},120);};$('status-filter').onchange=()=>{impactOnly=false;selectedId=null;document.querySelectorAll('[data-summary]').forEach(x=>x.classList.remove('active'));render();};
    $('date-toggle').onclick=()=>{const value=$('date-toggle').getAttribute('aria-pressed')!=='true';$('date-toggle').setAttribute('aria-pressed',String(value));$('date-filter-wrap').hidden=!value;selectedId=null;render();};$('date-filter').onchange=()=>{selectedId=null;render();};
    $('works-tab').onclick=()=>switchTab('works');$('assets-tab').onclick=()=>switchTab('assets');
    document.querySelectorAll('[data-summary]').forEach(el=>el.onclick=()=>{switchTab('works',false);impactOnly=el.dataset.summary==='impact';$('status-filter').value=['active','planned'].includes(el.dataset.summary)?el.dataset.summary:'all';document.querySelectorAll('[data-summary]').forEach(x=>x.classList.toggle('active',x===el));render();});
    $('layers-toggle').onclick=()=>{const value=$('layers-panel').hidden;$('layers-panel').hidden=!value;$('layers-toggle').setAttribute('aria-expanded',String(value));};$('show-works').onchange=renderMapRecords;$('show-assets').onchange=renderMapRecords;
    $('cad-file').onchange=async e=>{try{await importDXF(e.target.files[0]);}catch(error){$('import-message').textContent=error.message;}};
    $('sample-import').onclick=async()=>{try{const response=await fetch('samples/factory-layout.dxf');if(!response.ok)throw new Error('サンプル図面を取得できませんでした。');await importDXF(new File([await response.text()],'factory-layout.dxf',{type:'application/dxf'}));}catch(error){$('import-message').textContent=error.message;}};
    for(const type of ['dragenter','dragover'])$('upload-zone').addEventListener(type,e=>{e.preventDefault();$('upload-zone').classList.add('drag-over');});
    $('upload-zone').addEventListener('dragleave',()=>$('upload-zone').classList.remove('drag-over'));
    $('upload-zone').addEventListener('drop',async e=>{e.preventDefault();$('upload-zone').classList.remove('drag-over');try{await importDXF(e.dataTransfer.files[0]);}catch(error){$('import-message').textContent=error.message;}});
    $('backup-export').onclick=()=>{download(`factory-map-${today()}.json`,new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));toast('図面と登録データを書き出しました。');};
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('work-dialog').open){e.preventDefault();closeDialog('work-dialog');renderMapRecords();}else if(e.key==='Escape'&&drawingActive)clearPending();if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();$('search').focus();}});
    map.on('pm:create',e=>{if(!editor){map.removeLayer(e.layer);return;}pendingLayer=e.layer;pendingPoints=e.layer.getLatLngs()[0].map(p=>[p.lng,p.lat]);drawingActive=false;$('draw-instruction').hidden=true;map.pm.disableDraw();const existing=redrawId?state.works.find(x=>x.id===redrawId):null;openWorkForm(existing);});
  }
  async function init(){
    try{
      state=await FactoryAPI.load();const auth=await FactoryAPI.request('/api/auth/status');editor=auth.editor;document.body.classList.toggle('read-only',!editor);$('view-mode').textContent=editor?'施設担当モード':'閲覧モード';$('view-mode').setAttribute('aria-pressed',String(editor));$('page-heading').textContent=editor?'工事と施設を、ひとつの図面で。':'構内の工事とお知らせ。';$('page-subtitle').textContent=editor?'構内の作業予定や設備の情報を、場所から確認できます。':'工事範囲や作業予定、お知らせを確認できます。';
      map=L.map('map',{crs:L.CRS.Simple,minZoom:-12,maxZoom:8,zoomSnap:.25,attributionControl:true,preferCanvas:true});
      map.createPane('workEditingPane').style.zIndex=685;map.createPane('workEditVerticesPane').style.zIndex=695;map.pm.setGlobalOptions({panes:{vertexPane:'workEditVerticesPane',layerPane:'workEditingPane',markerPane:'workEditVerticesPane'}});
      map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
      baseGroup=L.layerGroup().addTo(map);workGroup=L.layerGroup().addTo(map);assetGroup=L.layerGroup().addTo(map);
      window.factoryMap={get state(){return state;},get map(){return map;},get editor(){return editor;},get currentDrawing(){return currentDrawing;},importDXF,changeState,render,setEditor,toast,fail,today,clearPending,
        async refresh(){state=await FactoryAPI.load();if(!state.drawings.some(d=>d.id===currentDrawing))currentDrawing=state.drawings[0].id;updateDrawingSelect();render();},
        openRecord(kind,id){if(kind==='assets'&&!editor)throw new Error('施設グループのパスワードでログインしてください。');const r=state[kind]?.find(r=>r.id===id);if(!r)throw new Error('対象が見つかりません。');if(r.drawingId!==currentDrawing)setDrawing(r.drawingId);if(kind==='notes'){$('show-notes').checked=true;FactoryNotes.render();map.panTo(ll(r.point));return;}switchTab(kind,false);selectRecord(id,true);},
        setDrawing(id){if(!state.drawings.some(d=>d.id===id))throw new Error('図面が見つかりません。');setDrawing(id);}
      };
      bindEvents();FactoryFeatures.setup();FactoryEquipment.setup();FactoryNotes.setup();setDrawing(state.drawings.some(d=>d.id==='site')?'site':state.drawings[0].id);selectedId=window.matchMedia('(max-width:950px)').matches?null:state.works.find(w=>w.drawingId==='site'&&w.status==='active')?.id||null;render();
      let resizeTimer;
      new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{map.invalidateSize({pan:false});if(!drawingActive&&!editingWorkId)fitMap();},80);}).observe($('map'));
      if(window.FactoryWebMCP)await FactoryWebMCP.register();
    }catch(error){$('record-list').innerHTML='<div class="empty-state"><strong>初期化できませんでした</strong>サーバーとデータベースの接続を確認して再読み込みしてください。</div>';fail(error);}
  }
  init();
})();
