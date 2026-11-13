/* Equipment register, typed fields, documents and inspection editing. */
window.FactoryFeatures = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => [...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const api = (...args) => FactoryAPI.request(...args);
  const app = () => window.factoryMap;
  const types = {text:'テキスト',number:'数値',date:'日付',checkbox:'チェックボックス',select:'選択',multiselect:'複数選択',url:'URL'};
  let pointMode = false, stagedWork = [], workPhotos = null;
  function open(id) { $(id).showModal(); }
  function dialog(id,title,body) {
    let el=$(id); if(!el){el=document.createElement('dialog');el.id=id;el.className='form-dialog';document.body.append(el);}
    el.innerHTML=`<div class="dialog-heading"><h2>${esc(title)}</h2><button type="button" class="icon-close" aria-label="閉じる">×</button></div>${body}`;
    el.querySelector('.icon-close').onclick=()=>el.close();open(id);return el;
  }
  function formDialog(id,title,body,save) {
    const el=dialog(id,title,`<form>${body}<p class="form-error" role="alert"></p><div class="dialog-actions"><button class="button primary" type="submit">保存する</button></div></form>`);
    el.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=el.querySelector('[type=submit]');b.disabled=true;try{await save(new FormData(e.target),el);el.close();app().render();app().toast('保存しました。');}catch(error){el.querySelector('.form-error').textContent=error.message;}finally{b.disabled=false;}};return el;
  }
  function field(label,name,value='',type='text',extra='') {return `<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}></label>`;}
  function filesHTML(record) {
    return (record.attachments||[]).map(a=>{
      const id=encodeURIComponent(a.fileId||a.id),canPreview=a.mime==='application/pdf'||a.mime?.startsWith('image/');
      return `<div class="document-card"><span class="attachment-icon">${a.mime==='application/pdf'?'PDF':'FILE'}</span><span class="document-name">${esc(a.name)}<small>${((a.size||0)/1024).toFixed(1)} KB</small></span>${canPreview?`<button class="text-link" data-preview="${esc(a.fileId||a.id)}" data-mime="${esc(a.mime)}" data-name="${esc(a.name)}">プレビュー</button>`:''}<a class="text-link" href="/api/files/${id}" download>↓</a></div>`;
    }).join('') || '<p class="detail-description">添付資料はありません。</p>';
  }
  function bindFiles(root=document) {
    root.querySelectorAll('[data-preview]').forEach(b=>b.onclick=()=>{
      if(b.dataset.mime==='application/pdf'){void FactoryPDF.open(b.dataset.preview,b.dataset.name);return;}
      const url='/api/files/'+encodeURIComponent(b.dataset.preview)+'?inline=1';
      const el=dialog('file-preview',b.dataset.name, b.dataset.mime==='application/pdf'?`<iframe title="PDFプレビュー" src="${url}"></iframe>`:`<img alt="${esc(b.dataset.name)}" src="${url}">`);el.className='form-dialog preview-dialog';
    });
  }
  function attachmentEditor(container,attachments=[]) {
    const staged=structuredClone(attachments);container.innerHTML='<div class="existing-files"></div><label>ファイルを添付<input class="new-files" type="file" multiple><small>PDF・画像・図面・その他の資料。各5MBまで / 一度に5ファイル。</small></label>';
    const draw=()=>{container.querySelector('.existing-files').innerHTML=staged.map((a,i)=>`<div class="file-row"><span>${esc(a.name)}</span><button type="button" data-remove="${i}" aria-label="${esc(a.name)}を外す">×</button></div>`).join('');container.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{staged.splice(Number(b.dataset.remove),1);draw();});};draw();
    return async()=>[...staged,...await FactoryAPI.upload([...container.querySelector('.new-files').files])];
  }
  async function mode() {
    if(app().editor){await api('/api/auth/logout',{method:'POST'});app().setEditor(false);await app().refresh();return;}
    if(FactoryAPI.saas){await api('/api/auth/login',{method:'POST',body:{}});await app().refresh();app().setEditor(true);return;}
    formDialog('login-dialog','施設グループ ログイン',`${field('パスワード','password','','password','required autocomplete="current-password"')}<p class="form-context">施設担当者だけが登録・編集できます。</p>`,async f=>{await api('/api/auth/login',{method:'POST',body:{password:f.get('password')}});await app().refresh();app().setEditor(true);});
    $('login-dialog').querySelector('input').focus();
  }
  function password() {
    formDialog('password-dialog','パスワードを変更',field('現在のパスワード','currentPassword','','password','required autocomplete="current-password"')+field('新しいパスワード（10文字以上）','newPassword','','password','required minlength="10" autocomplete="new-password"'),async f=>api('/api/auth/password',{method:'PUT',body:Object.fromEntries(f)}));
  }
  function displayValue(def,value) {
    if(value===undefined||value===null||value==='')return '—';
    if(def.type==='checkbox')return value?'✓ はい':'いいえ';
    if(def.type==='select'||def.type==='multiselect')return (Array.isArray(value)?value:[value]).map(v=>def.options?.find(o=>o.id===v)?.label||v).join('、')||'—';
    return String(value)+(def.unit?' '+def.unit:'');
  }
  function propertyInputs(asset) {
    return app().state.propertyDefinitions.map(d=>{
      const v=asset?.properties?.[d.id],name='prop-'+d.id,required=d.required?'required':'';
      if(d.type==='checkbox')return `<label class="checkbox-property"><input type="checkbox" name="${esc(name)}" ${v?'checked':''}>${esc(d.name)}</label>`;
      if(d.type==='select'||d.type==='multiselect')return `<label>${esc(d.name)}<select name="${esc(name)}" ${d.type==='multiselect'?'multiple size="3"':''} ${required}>${d.type==='select'?'<option value="">未設定</option>':''}${(d.options||[]).map(o=>`<option value="${esc(o.id)}" ${(Array.isArray(v)?v:[v]).includes(o.id)?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label>`;
      return field(d.name+(d.unit?' ('+d.unit+')':''),name,v??'',d.type==='number'?'number':d.type==='date'?'date':d.type==='url'?'url':'text',`${required} ${d.type==='number'?'step="any"':''}`);
    }).join('');
  }
  function propertyValues(f) {
    const values={};for(const d of app().state.propertyDefinitions){const name='prop-'+d.id,v=f.get(name);if(d.type==='checkbox')values[d.id]=f.has(name);else if(d.type==='multiselect')values[d.id]=f.getAll(name);else if(v!==''&&v!==null)values[d.id]=d.type==='number'?Number(v):v;}return values;
  }
  function assetForm(asset=null,point=null) {
    if(!app().editor)return;
    if(asset?.locks?.attributes){app().toast('属性のロックを解除してから編集してください。',true);return;}
    const p=point||asset?.point||[0,0];
    const body=field('設備名','name',asset?.name||'','text','required maxlength="150"')+field('設備ID（重複不可）','code',asset?.code||'','text','required maxlength="100"')+field('場所','location',asset?.location||'')+`<div class="form-columns">${field('図面上の X','x',p[0],'number','required step="any" '+(asset?.locks?.position?'disabled':''))}${field('図面上の Y','y',p[1],'number','required step="any" '+(asset?.locks?.position?'disabled':''))}</div>${FactoryEquipment.picker(asset)}<h3>写真</h3><div id="asset-photos"></div><h3>プロパティ</h3><div class="property-grid">${propertyInputs(asset)}</div><h3>マニュアル・点検用紙・関連資料</h3><div id="asset-files"></div>`;
    let readFiles, photoEditor;
    const editDialog=formDialog('asset-dialog',asset?'設備を編集':'設備を登録',body,async f=>{
      const photos=await photoEditor.read();
      const record={...asset,id:asset?.id||uid(),name:f.get('name').trim(),code:f.get('code').trim(),location:f.get('location'),drawingId:asset?.drawingId||app().currentDrawing,point:asset?.locks?.position?asset.point:[Number(f.get('x')),Number(f.get('y'))],icon:f.get('icon'),properties:propertyValues(f),history:asset?.history||[],attachments:[...await readFiles(),...photos.attachments],coverPhotoId:photos.coverPhotoId};
      await app().changeState(()=>{const list=app().state.assets,index=list.findIndex(a=>a.id===record.id);if(index<0)list.push(record);else list[index]=record;});app().openRecord('assets',record.id);
    });readFiles=attachmentEditor($('asset-files'),(asset?.attachments||[]).filter(file=>!FactoryMedia.isPhoto(file)));photoEditor=FactoryMedia.editor($('asset-photos'),asset||{},editDialog);
  }
  function cancelPlacement(){pointMode=false;app()?.map.getContainer().classList.remove('asset-placing');}
  function startAsset() {
    if(!app().editor)return;app().clearPending();pointMode=true;app().toast('地図上で設備を置く場所をクリックしてください。Escで中止できます。');app().map.getContainer().classList.add('asset-placing');
  }
  function inspectionForm(asset,history=null) {
    let readFiles;
    const body=`<p class="form-context">${esc(asset.name)}</p><div class="form-columns">${field('点検日','date',history?.date||app().today(),'date','required')}${field('次回点検日','nextDate',history?.nextDate||'','date')}</div>${field('点検・作業の種類','kind',history?.kind||'定期点検')}${field('実施者','inspector',history?.inspector||'')}<label>結果<select name="result"><option value="normal">異常なし</option><option value="attention" ${history?.result==='attention'?'selected':''}>要確認・要対応</option><option value="repaired" ${history?.result==='repaired'?'selected':''}>補修済み</option></select></label><label>内容<textarea name="text" rows="4" required>${esc(history?.text||'')}</textarea></label><div id="inspection-files"></div>`;
    formDialog('inspection-dialog',history?'点検・保守履歴を編集':'点検・保守履歴を追加',body,async f=>{
      const entry={...Object.fromEntries(f),id:history?.id||uid(),attachments:await readFiles()};
      await app().changeState(()=>{const a=app().state.assets.find(x=>x.id===asset.id);const i=a.history.findIndex(h=>h.id===entry.id);if(i<0)a.history.unshift(entry);else a.history[i]=entry;});
    });readFiles=attachmentEditor($('inspection-files'),history?.attachments);
  }
  function assetHTML(a) {
    const props=app().state.propertyDefinitions.map(d=>`<div><dt>${esc(d.name)}</dt><dd>${esc(displayValue(d,a.properties?.[d.id]))}</dd></div>`).join('');
    const history=[...(a.history||[])].sort((a,b)=>b.date.localeCompare(a.date));
    const related=app().state.works.filter(w=>w.assetIds?.includes(a.id));
    return `<div><span class="status status-planned">設備台帳</span></div><h2>${esc(a.name)}</h2><p class="detail-location">${esc(a.location)}</p><div class="detail-period"><small>設備ID</small><strong>${esc(a.code)}</strong></div>${FactoryEquipment.locksHTML(a)}<dl class="properties">${props}</dl><div class="detail-actions editor-only"><button class="button secondary" id="asset-edit" ${a.locks?.attributes?'disabled title="属性のロックを解除してください"':''}>設備を編集</button><button class="button secondary" id="asset-history-add">点検を記録</button></div>${FactoryMedia.gallery(a)}<h3>マニュアル・点検用紙・関連資料</h3>${filesHTML({attachments:(a.attachments||[]).filter(file=>!FactoryMedia.isPhoto(file))})}<h3>関連する工事</h3>${related.map(w=>`<button class="related-link" data-open-work="${esc(w.id)}">${esc(w.title)} ↗</button>`).join('')||'<p class="detail-description">登録なし</p>'}<h3>点検・保守履歴 <small>${history.length}件</small></h3>${history.map(h=>`<article class="history-card"><div><b>${esc(h.date)}</b><span class="history-result ${h.result==='attention'?'attention':''}">${esc({normal:'異常なし',attention:'要対応',repaired:'補修済み'}[h.result]||'記録')}</span></div><small>${esc(h.kind||'点検')} · ${esc(h.inspector||'実施者未登録')}</small><p>${esc(h.text)}</p>${h.nextDate?`<small>次回 ${esc(h.nextDate)}</small>`:''}${filesHTML(h)}<div class="history-actions editor-only"><button data-edit-history="${esc(h.id)}">編集</button><button data-delete-history="${esc(h.id)}">削除</button></div></article>`).join('')||'<p class="detail-description">点検履歴はまだありません。</p>'}<button class="text-link danger editor-only" id="asset-delete" ${a.locks?.position||a.locks?.attributes?'disabled title="設備のロックを解除してください"':''}>この設備を削除</button>`;
  }
  function bindAsset(a) {
    if(app().editor){FactoryEquipment.bindLocks(a);$('asset-edit').onclick=()=>assetForm(a);$('asset-history-add').onclick=()=>inspectionForm(a);$('asset-delete').onclick=async()=>{if(!confirm('設備「'+a.name+'」と点検履歴を削除しますか？'))return;try{await api('/api/assets/'+encodeURIComponent(a.id),{method:'DELETE'});await app().refresh();}catch(e){app().fail(e);}};
      document.querySelectorAll('[data-edit-history]').forEach(b=>b.onclick=()=>inspectionForm(a,a.history.find(h=>h.id===b.dataset.editHistory)));
      document.querySelectorAll('[data-delete-history]').forEach(b=>b.onclick=async()=>{if(!confirm('この点検履歴を削除しますか？'))return;try{await app().changeState(()=>{const asset=app().state.assets.find(x=>x.id===a.id);asset.history=asset.history.filter(h=>h.id!==b.dataset.deleteHistory);});app().render();}catch(e){app().fail(e);}});
    }
    document.querySelectorAll('[data-open-work]').forEach(b=>b.onclick=()=>app().openRecord('works',b.dataset.openWork));bindFiles($('detail-pane'));
  }
  function propertyManager() {
    const defs=app().state.propertyDefinitions;
    const el=dialog('properties-dialog','設備のプロパティ',`<p class="form-context">全設備で使う項目を追加・編集できます。既存データと合わない型への変更は保存時にお知らせします。</p><div class="property-list">${defs.map(d=>`<button data-property="${esc(d.id)}"><b>${esc(d.name)}</b><span>${esc(types[d.type])} ›</span></button>`).join('')}</div><div class="dialog-actions"><button id="property-add" class="button primary">＋ プロパティを追加</button></div>`);
    el.querySelectorAll('[data-property]').forEach(b=>b.onclick=()=>{el.close();propertyForm(defs.find(d=>d.id===b.dataset.property));});$('property-add').onclick=()=>{el.close();propertyForm();};
  }
  function propertyForm(def=null) {
    let options=structuredClone(def?.options||[]);
    const body=field('プロパティ名','name',def?.name||'','text','required maxlength="80"')+`<label>種類<select name="type">${Object.entries(types).map(([k,v])=>`<option value="${k}" ${def?.type===k?'selected':''}>${v}</option>`).join('')}</select></label>${field('単位（数値の場合、任意）','unit',def?.unit||'')}<label class="checkbox-property"><input type="checkbox" name="required" ${def?.required?'checked':''}>必須項目</label><div id="options-editor"><h3>選択肢</h3><div id="option-rows"></div><button type="button" class="text-link" id="option-add">＋ 選択肢を追加</button></div>${def?'<button type="button" class="text-link danger" id="property-delete">プロパティと各設備の値を削除</button>':''}`;
    const el=formDialog('property-dialog',def?'プロパティを編集':'プロパティを追加',body,async f=>{
      const record={id:def?.id||uid(),name:f.get('name').trim(),type:f.get('type'),required:f.has('required'),unit:f.get('unit').trim(),options:options.map(o=>({id:o.id,label:o.label.trim()}))};
      await api('/api/properties'+(def?'/'+encodeURIComponent(def.id):''),{method:def?'PATCH':'POST',body:record});await app().refresh();
    });
    const draw=()=>{const root=$('option-rows');root.innerHTML=options.map((o,i)=>`<div class="file-row"><input aria-label="選択肢 ${i+1}" value="${esc(o.label)}" data-option="${i}"><button type="button" data-remove-option="${i}" aria-label="選択肢を削除">×</button></div>`).join('');root.querySelectorAll('[data-option]').forEach(x=>x.oninput=()=>options[Number(x.dataset.option)].label=x.value);root.querySelectorAll('[data-remove-option]').forEach(x=>x.onclick=()=>{options.splice(Number(x.dataset.removeOption),1);draw();});};draw();
    $('option-add').onclick=()=>{options.push({id:uid(),label:''});draw();};
    const type=el.querySelector('[name=type]');const toggle=()=>$('options-editor').hidden=!['select','multiselect'].includes(type.value);type.onchange=toggle;toggle();
    if(def)$('property-delete').onclick=async()=>{if(!confirm('このプロパティと、全設備の対応する値を削除しますか？'))return;try{await api('/api/properties/'+encodeURIComponent(def.id),{method:'DELETE'});await app().refresh();el.close();}catch(e){el.querySelector('.form-error').textContent=e.message;}};
  }
  function workPrepare(record) {
    stagedWork=structuredClone((record?.attachments||[]).filter(file=>!FactoryMedia.isPhoto(file)));
    const input=$('field-attachment');input.multiple=true;input.removeAttribute('accept');
    let photoArea=$('work-photos');if(!photoArea){photoArea=document.createElement('div');photoArea.id='work-photos';input.closest('label').before(photoArea);}
    workPhotos=FactoryMedia.editor(photoArea,record||{},$('work-dialog'));
    let area=$('work-existing-files');if(!area){area=document.createElement('div');area.id='work-existing-files';input.closest('label').before(area);}
    const draw=()=>{area.innerHTML=stagedWork.map((a,i)=>`<div class="file-row"><span>${esc(a.name)}</span><button type="button" data-remove-work-file="${i}">×</button></div>`).join('');area.querySelectorAll('[data-remove-work-file]').forEach(b=>b.onclick=()=>{stagedWork.splice(Number(b.dataset.removeWorkFile),1);draw();});};draw();
    let label=$('work-assets-label');if(!label){label=document.createElement('label');label.id='work-assets-label';input.closest('label').before(label);}
    label.innerHTML='関連する設備（複数選択可）<select id="work-asset-ids" multiple size="4">'+app().state.assets.map(a=>`<option value="${esc(a.id)}" ${record?.assetIds?.includes(a.id)?'selected':''}>${esc(a.code+' / '+a.name)}</option>`).join('')+'</select>';
  }
  async function workFiles(){const photos=await workPhotos.read();return {attachments:[...stagedWork,...await FactoryAPI.upload([...$('field-attachment').files]),...photos.attachments],coverPhotoId:photos.coverPhotoId};}
  function workRelations(w) {if(!app().editor)return '';return '<h3>関連する設備</h3>'+ (w.assetIds||[]).map(id=>{const a=app().state.assets.find(a=>a.id===id);return a?`<button class="related-link" data-open-asset="${esc(id)}">${esc(a.name)} ↗</button>`:'';}).join('');}
  function bindWork(w){bindFiles($('detail-pane'));document.querySelectorAll('[data-open-asset]').forEach(b=>b.onclick=()=>app().openRecord('assets',b.dataset.openAsset));}
  function setup() {
    $('view-mode').onclick=()=>mode().catch(app().fail);$('password-open').onclick=password;$('asset-add').onclick=startAsset;$('properties-open').onclick=propertyManager;
    $('refresh-data').onclick=()=>app().refresh().then(()=>app().toast('最新の情報を読み込みました。')).catch(app().fail);
    $('asset-category').onchange=()=>app().render();
    app().map.on('click',e=>{if(!pointMode||!app().editor)return;pointMode=false;app().map.getContainer().classList.remove('asset-placing');assetForm(null,[Math.round(e.latlng.lng*100)/100,Math.round(e.latlng.lat*100)/100]);});
    window.addEventListener('factory-session-expired',()=>app().setEditor(false));
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){pointMode=false;app().map.getContainer().classList.remove('asset-placing');}});
  }
  function filters(){const sel=$('asset-category'),value=sel.value;const def=app().state.propertyDefinitions.find(d=>d.id==='category');sel.innerHTML='<option value="">すべての設備分類</option>'+(def?.options||[]).map(o=>`<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('');sel.value=value;}
  return {setup,cancelPlacement,filters,filesHTML,bindFiles,assetHTML,bindAsset,workPrepare,workFiles,workRelations,bindWork,displayValue};
})();
