/* Browser-local presentation preferences. Never grants server entitlements. */
(() => {
  'use strict';
  const KEY='factory-map.preferences.v1', MAX_ICONS=12;
  const DEFAULTS={theme:'system',accent:'#167566',density:'comfortable',left:false,right:false,focus:false,plan:'free',icons:[],categoryIcons:{}};
  const CATEGORIES={hvac:'空調',water:'給排水',pipe:'配管',power:'電気',air:'圧縮空気',fire:'防災',heat:'熱源',cool:'冷却',building:'建築',handling:'搬送',effluent:'排水処理',safety:'安全'};
  const PLANS={free:{name:'Community',drawings:3,assets:100},pro:{name:'Team',drawings:30,assets:2000},enterprise:{name:'Enterprise',drawings:100,assets:10000}};
  const validImage=v=>typeof v==='string' && v.length<=90000 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(v);
  function normalize(raw={}) {
    const o=raw && typeof raw==='object'?raw:{};
    const icons=Array.isArray(o.icons)?o.icons.filter(x=>x && typeof x.id==='string' && /^icon-[a-z0-9-]{1,50}$/.test(x.id) && validImage(x.data)).slice(0,MAX_ICONS).map(x=>({id:x.id,name:String(x.name||'アイコン').slice(0,40),data:x.data})):[];
    const categoryIcons={};
    for(const key of Object.keys(CATEGORIES)) if(icons.some(x=>x.id===o.categoryIcons?.[key])) categoryIcons[key]=o.categoryIcons[key];
    return {...DEFAULTS,theme:['light','dark','system'].includes(o.theme)?o.theme:'system',accent:/^#[0-9a-f]{6}$/i.test(o.accent)?o.accent:DEFAULTS.accent,density:o.density==='compact'?'compact':'comfortable',left:o.left===true,right:o.right===true,focus:o.focus===true,plan:Object.hasOwn(PLANS,o.plan)?o.plan:'free',icons,categoryIcons};
  }
  const api={normalize,validImage,PLANS};
  if(typeof window==='undefined'){if(typeof module!=='undefined')module.exports=api;return;}
  window.FactoryPreferences=api;
  if(typeof document==='undefined')return;
  let prefs=normalize(), dialog, temporaryURL, uploadPending=false;
  try{prefs=normalize(JSON.parse(localStorage.getItem(KEY)||'{}'));}catch{}
  const $=s=>document.querySelector(s);
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const toast=message=>window.factoryMap?.toast(message);
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(prefs));return true;}catch{toast('ブラウザーに保存できません。設定はこの画面を閉じるまで有効です。');return false;}}
  function apply(){
    const dark=prefs.theme==='dark'||(prefs.theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.dataset.factoryTheme=dark?'dark':'light';
    document.body.dataset.factoryDensity=prefs.density;
    document.body.style.setProperty('--factory-accent',prefs.accent);
    document.body.classList.toggle('factory-hide-left',prefs.left);
    document.body.classList.toggle('factory-hide-right',prefs.right);
    document.body.classList.toggle('factory-focus',prefs.focus);
    for(const [id,key,label] of [['factory-left-toggle','left','一覧'],['factory-right-toggle','right','詳細'],['factory-focus-toggle','focus','集中表示']]){
      const button=document.getElementById(id);if(!button)continue;
      button.setAttribute('aria-pressed',String(prefs[key]));
      if(key!=='focus')button.setAttribute('aria-expanded',String(!prefs[key]));
      button.textContent=key==='focus'?(prefs.focus?'通常表示':'集中表示'):(prefs[key]?label+'を開く':label+'を畳む');
    }
    requestAnimationFrame(()=>window.factoryMap?.map.invalidateSize({pan:false}));
  }
  function set(key,value){prefs=normalize({...prefs,[key]:value});persist();apply();}
  function select(label,value,choices,onchange){
    const row=el('label',label),control=el('select');control.setAttribute('aria-label',label);
    for(const [v,t] of Object.entries(choices)){const option=el('option',t);option.value=v;control.append(option);}
    control.value=value;control.addEventListener('change',()=>onchange(control.value));row.append(control);return row;
  }
  function fieldset(title){const f=el('fieldset');f.append(el('legend',title));return f;}
  function updateIcons(){
    const list=$('#factory-icon-list');list.replaceChildren();
    for(const icon of prefs.icons){
      const row=el('div',undefined,'factory-icon-row'),img=el('img');img.src=icon.data;img.alt='';img.width=32;img.height=32;
      const remove=el('button','削除');remove.type='button';remove.setAttribute('aria-label',icon.name+'を削除');
      remove.onclick=()=>{prefs.icons=prefs.icons.filter(x=>x.id!==icon.id);prefs=normalize(prefs);persist();updateIcons();window.factoryMap?.render();};
      row.append(img,el('span',icon.name),remove);list.append(row);
    }
    if(!prefs.icons.length)list.append(el('p','まだカスタムアイコンはありません。'));
    const mapping=$('#factory-icon-mapping');mapping.replaceChildren();
    for(const [key,label] of Object.entries(CATEGORIES))mapping.append(select(label,prefs.categoryIcons[key]||'',{'':'標準の図形',...Object.fromEntries(prefs.icons.map(x=>[x.id,x.name]))},value=>{
      prefs.categoryIcons[key]=value;prefs=normalize(prefs);persist();window.factoryMap?.render();
    }));
  }
  async function addRaster(file){
    if(!file)return;
    if(uploadPending)return;
    if(prefs.icons.length>=MAX_ICONS)throw new Error('アイコンは12個までです。不要なものを削除してください。');
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>1024*1024)throw new Error('1MB以下のPNG・JPEG・WebPを選んでください。SVGは読み込みません。');
    uploadPending=true;
    try{
      const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
      const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
      const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
      const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
      if(!png&&!jpeg&&!webp)throw new Error('画像形式を確認できません。PNG・JPEG・WebPのみ対応しています。');
      temporaryURL=URL.createObjectURL(file);
      const img=new Image();img.src=temporaryURL;await img.decode();
      if(img.naturalWidth>4096||img.naturalHeight>4096)throw new Error('画像は4096×4096ピクセル以内にしてください。');
      const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
      const scale=Math.min(64/img.naturalWidth,64/img.naturalHeight),w=img.naturalWidth*scale,h=img.naturalHeight*scale;
      canvas.getContext('2d').drawImage(img,(64-w)/2,(64-h)/2,w,h);
      const data=canvas.toDataURL('image/png');if(!validImage(data))throw new Error('画像を小さくして再度お試しください。');
      prefs.icons.push({id:'icon-'+crypto.randomUUID(),name:file.name.slice(0,40),data});
      persist();updateIcons();toast('アイコンを追加しました。分類に割り当てると地図に反映されます。');
    }finally{if(temporaryURL)URL.revokeObjectURL(temporaryURL);temporaryURL=undefined;uploadPending=false;}
  }
  function usage(container){
    container.replaceChildren();
    const state=window.factoryMap?.state,plan=PLANS[prefs.plan];
    for(const [label,key] of [['図面','drawings'],['設備','assets']]){
      const value=state?.[key]?.length;
      container.append(el('p',label+': '+(value===undefined?'未取得':value)+' / '+plan[key].toLocaleString()+' （プラン案）'));
    }
    container.append(el('small','このプラン切替は課金モックです。請求・制限の強制・権限変更は行いません。実際のプラン制御はサーバー側で実装します。'));
  }
  function init(){
    const tools=el('div',undefined,'factory-workspace-controls');tools.setAttribute('aria-label','表示設定');
    for(const [id,key,controls] of [['factory-left-toggle','left','record-list'],['factory-right-toggle','right','detail-pane'],['factory-focus-toggle','focus','']]){
      const button=el('button');button.id=id;button.type='button';if(controls)button.setAttribute('aria-controls',controls);button.onclick=()=>set(key,!prefs[key]);tools.append(button);
    }
    const customize=el('button','表示をカスタマイズ');customize.type='button';customize.id='factory-customize';tools.append(customize);
    $('.workspace').before(tools);
    dialog=el('dialog',undefined,'form-dialog factory-custom-dialog');dialog.id='factory-custom-dialog';dialog.setAttribute('aria-labelledby','factory-custom-title');
    const heading=el('div',undefined,'dialog-heading'),title=el('h2','自分に合った構内マップ');title.id='factory-custom-title';
    const close=el('button','×','icon-close');close.type='button';close.setAttribute('aria-label','閉じる');close.onclick=()=>dialog.close();
    heading.append(title,close);dialog.append(heading,el('p','表示設定・アイコンはこのブラウザーだけに保存されます。設備台帳や他の利用者の表示は変更しません。','factory-help'));
    const look=fieldset('見やすさ');
    look.append(select('テーマ',prefs.theme,{system:'端末に合わせる',light:'ライト',dark:'ダーク'},v=>set('theme',v)),select('情報の密度',prefs.density,{comfortable:'ゆったり',compact:'コンパクト'},v=>set('density',v)));
    const accentLabel=el('label','アクセントカラー'),accent=el('input');accent.type='color';accent.value=prefs.accent;accent.oninput=()=>set('accent',accent.value);accentLabel.append(accent);look.append(accentLabel);dialog.append(look);
    const iconField=fieldset('カスタムアイコン · Team機能のプレビュー');
    iconField.append(el('p','PNG / JPEG / WebP、1MBまで。64pxのPNGに変換して保存します。最大12個。SVG・アニメーション・外部URLは保存しません。'));
    const label=el('label','アイコン画像を追加'),input=el('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.onchange=async()=>{err.textContent='';try{await addRaster(input.files[0]);}catch(e){$('#factory-icon-error').textContent=e.message;}finally{input.value='';}};
    label.append(input);const err=el('p');err.id='factory-icon-error';err.setAttribute('role','alert');const list=el('div');list.id='factory-icon-list';const mapping=el('div',undefined,'factory-icon-mapping');mapping.id='factory-icon-mapping';
    iconField.append(label,err,list,el('h3','設備分類ごとの表示'),mapping);dialog.append(iconField);
    const billing=fieldset('プランシミュレーター · 課金なし'),meter=el('div');meter.id='factory-plan-usage';
    billing.append(select('デモプラン',prefs.plan,{free:'Community',pro:'Team',enterprise:'Enterprise'},v=>{set('plan',v);usage(meter);}),meter);dialog.append(billing);
    const reset=el('button','表示設定を初期化','button secondary');reset.type='button';reset.onclick=()=>{prefs=normalize();persist();apply();window.factoryMap?.render();dialog.close();toast('このブラウザーの表示設定とカスタムアイコンを初期化しました。');};
    dialog.append(reset);document.body.append(dialog);
    customize.onclick=()=>{dialog.querySelectorAll('select').forEach(s=>{if(s.parentElement.firstChild.textContent==='テーマ')s.value=prefs.theme;if(s.parentElement.firstChild.textContent==='情報の密度')s.value=prefs.density;if(s.parentElement.firstChild.textContent==='デモプラン')s.value=prefs.plan;});accent.value=prefs.accent;err.textContent='';updateIcons();usage(meter);dialog.showModal();};
    const original=FactoryEquipment.markerHTML;
    FactoryEquipment.markerHTML=asset=>{
      const custom=prefs.icons.find(x=>x.id===prefs.categoryIcons[asset.properties?.category]);
      if(!custom)return original(asset);
      const marker=el('div',undefined,'equipment-symbol factory-custom-marker'),img=el('img');img.src=custom.data;img.alt='';marker.append(img);
      if(asset.locks?.position)marker.append(el('span','▣','equipment-lock-dot'));
      return marker.outerHTML;
    };
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change',apply);
    window.addEventListener('storage',e=>{if(e.key===KEY){try{prefs=normalize(JSON.parse(e.newValue||'{}'));apply();window.factoryMap?.render();}catch{}}});
    apply();api.getPreferences=()=>structuredClone(prefs);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
