/* Workspace presentation preferences; API permissions are the authority. */
(() => {
  'use strict';
  const KEY='factory-map.preferences.v1', MAX_ICONS=50;
  const DEFAULTS={theme:'system',accent:'#167566',density:'comfortable',left:false,right:false,focus:false,plan:'free',icons:[],categoryIcons:{}};
  const PLANS={free:{name:'Community',drawings:3,assets:100},pro:{name:'Team',drawings:30,assets:2000},enterprise:{name:'Enterprise',drawings:100,assets:10000}};
  const validImage=v=>typeof v==='string' && v.length<=90000 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(v);
  function normalize(raw={}) {
    const o=raw && typeof raw==='object'?raw:{};
    const icons=Array.isArray(o.icons)?o.icons.filter(x=>x && typeof x.id==='string' && /^icon-[a-z0-9-]{1,50}$/.test(x.id) && (validImage(x.data)||typeof x.fileId==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(x.fileId))).slice(0,MAX_ICONS).map(x=>({id:x.id,name:String(x.name||'アイコン').slice(0,40),...(x.fileId?{fileId:x.fileId}:{data:x.data})})):[];
    const categoryIcons={};
    for(const [key,value] of Object.entries(o.categoryIcons||{})) if(/^[a-zA-Z0-9_.:-]{1,100}$/.test(key)&&icons.some(x=>x.id===value)) categoryIcons[key]=value;
    return {...DEFAULTS,brandName:typeof o.brandName==='string'?o.brandName.slice(0,60):'',theme:['light','dark','system'].includes(o.theme)?o.theme:'system',accent:/^#[0-9a-f]{6}$/i.test(o.accent)?o.accent:DEFAULTS.accent,density:o.density==='compact'?'compact':'comfortable',left:o.left===true,right:o.right===true,focus:o.focus===true,plan:Object.hasOwn(PLANS,o.plan)?o.plan:'free',icons,categoryIcons};
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
  let saveChain=Promise.resolve(),server=false;
  function persist(){
    if(server){const value=structuredClone(prefs);delete value.plan;saveChain=saveChain.catch(()=>{}).then(async()=>{try{await FactoryAPI.request('/api/preferences',{method:'PUT',body:value});document.dispatchEvent(new CustomEvent('factory-preferences-saved'));}catch(error){toast(error.message);const current=await FactoryAPI.request('/api/preferences');prefs=normalize({...current.preferences,plan:FactoryAPI.session.plan});apply();window.factoryMap?.render();throw error;}});saveChain.catch(()=>{});return saveChain;}
    try{localStorage.setItem(KEY,JSON.stringify(prefs));return Promise.resolve();}catch{toast('ブラウザーに保存できません。');return Promise.reject(new Error('保存できません。'));}
  }
  const iconURL=icon=>icon.fileId?'/api/files/'+encodeURIComponent(icon.fileId)+'?inline=1':icon.data;
  function apply(){
    const dark=prefs.theme==='dark'||(prefs.theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.dataset.factoryTheme=dark?'dark':'light';
    document.body.dataset.factoryDensity=prefs.density;
    document.body.style.setProperty('--factory-accent',prefs.accent);
    if(prefs.brandName)document.querySelector('.brand>span:last-child').firstChild.textContent=prefs.brandName;
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
      const row=el('div',undefined,'factory-icon-row'),img=el('img');img.src=iconURL(icon);img.alt='';img.width=32;img.height=32;
      const remove=el('button','削除');remove.type='button';remove.setAttribute('aria-label',icon.name+'を削除');
      remove.onclick=()=>{prefs.icons=prefs.icons.filter(x=>x.id!==icon.id);prefs=normalize(prefs);persist();updateIcons();window.factoryMap?.render();};
      row.append(img,el('span',icon.name),remove);list.append(row);
    }
    if(!prefs.icons.length)list.append(el('p','まだカスタムアイコンはありません。'));
    const mapping=$('#factory-icon-mapping');mapping.replaceChildren();
    for(const {id:key,label} of window.factoryMap?.state.propertyDefinitions.find(d=>d.id==='category')?.options||[])mapping.append(select(label,prefs.categoryIcons[key]||'',{'':'標準の図形',...Object.fromEntries(prefs.icons.map(x=>[x.id,x.name]))},value=>{
      prefs.categoryIcons[key]=value;prefs=normalize(prefs);persist();window.factoryMap?.render();
    }));
  }
  async function addRaster(file){
    if(!file)return;
    if(uploadPending)return;
    if(server&&!FactoryAPI.session.limits.customization)throw new Error('独自アイコンはProの機能です。有料管理者デモに切り替えてお試しください。');
    if(prefs.icons.length>=MAX_ICONS)throw new Error('アイコンは50個までです。不要なものを削除してください。');
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
      let ref={data};
      if(server){const blob=await(await fetch(data)).blob();const [uploaded]=await FactoryAPI.upload([new File([blob],file.name.replace(/\.[^.]+$/,'')+'.png',{type:'image/png'})]);ref={fileId:uploaded.fileId};}
      prefs.icons.push({id:'icon-'+crypto.randomUUID(),name:file.name.slice(0,40),...ref});
      await persist();updateIcons();toast('アイコンを保存しました。分類や個々の設備に割り当てられます。');
    }finally{if(temporaryURL)URL.revokeObjectURL(temporaryURL);temporaryURL=undefined;uploadPending=false;}
  }
  async function init(){
    for(let i=0;i<100&&!window.factoryMap;i++)await new Promise(r=>setTimeout(r,50));
    server=!!window.FactoryAPI?.saas;
    if(server)prefs=normalize({...FactoryAPI.session.preferences,plan:FactoryAPI.session.plan});
    const tools=el('div',undefined,'factory-workspace-controls');tools.setAttribute('aria-label','表示設定');
    for(const [id,key,controls] of [['factory-left-toggle','left','record-list'],['factory-right-toggle','right','detail-pane'],['factory-focus-toggle','focus','']]){
      const button=el('button');button.id=id;button.type='button';if(controls)button.setAttribute('aria-controls',controls);button.onclick=()=>set(key,!prefs[key]);tools.append(button);
    }
    const customize=el('button','表示をカスタマイズ');customize.type='button';customize.id='factory-customize';tools.append(customize);
    $('.workspace').before(tools);
    dialog=el('dialog',undefined,'form-dialog factory-custom-dialog');dialog.id='factory-custom-dialog';dialog.setAttribute('aria-labelledby','factory-custom-title');
    const heading=el('div',undefined,'dialog-heading'),title=el('h2','自分に合った構内マップ');title.id='factory-custom-title';
    const close=el('button','×','icon-close');close.type='button';close.setAttribute('aria-label','閉じる');close.onclick=()=>dialog.close();
    heading.append(title,close);dialog.append(heading,el('p',server?'表示設定と追加アイコンは、このデモアカウントのデータベースに保存します。':'表示設定はこのブラウザーに保存されます。','factory-help'));
    const look=fieldset('見やすさ');
    look.append(select('テーマ',prefs.theme,{system:'端末に合わせる',light:'ライト',dark:'ダーク'},v=>set('theme',v)),select('情報の密度',prefs.density,{comfortable:'ゆったり',compact:'コンパクト'},v=>set('density',v)));
    const accentLabel=el('label','アクセントカラー'),accent=el('input');accent.type='color';accent.value=prefs.accent;accent.oninput=()=>set('accent',accent.value);accentLabel.append(accent);look.append(accentLabel);dialog.append(look);
    const brand=el('label','ワークスペースの表示名'),brandInput=el('input');brandInput.type='text';brandInput.maxLength=60;brandInput.value=prefs.brandName||'';brandInput.onchange=()=>set('brandName',brandInput.value);brand.append(brandInput);look.append(brand);
    const iconField=fieldset('カスタムアイコン · Pro');
    iconField.append(el('p','後から画像を追加・削除できます。PNG / JPEG / WebP、1MBまで。64pxに変換して保存。最大50個。'));
    const label=el('label','アイコン画像を追加'),input=el('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.onchange=async()=>{err.textContent='';try{await addRaster(input.files[0]);}catch(e){$('#factory-icon-error').textContent=e.message;}finally{input.value='';}};
    label.append(input);const err=el('p');err.id='factory-icon-error';err.setAttribute('role','alert');const list=el('div');list.id='factory-icon-list';const mapping=el('div',undefined,'factory-icon-mapping');mapping.id='factory-icon-mapping';
    iconField.append(label,err,list,el('h3','設備分類ごとの表示'),mapping);dialog.append(iconField);
    const reset=el('button','表示設定を初期化','button secondary');reset.type='button';reset.onclick=()=>{prefs=normalize({plan:FactoryAPI.session?.plan||'free'});persist();apply();window.factoryMap?.render();dialog.close();toast('表示設定を初期化しました。');};
    dialog.append(reset);document.body.append(dialog);
    customize.onclick=()=>{dialog.querySelectorAll('select').forEach(s=>{if(s.parentElement.firstChild.textContent==='テーマ')s.value=prefs.theme;if(s.parentElement.firstChild.textContent==='情報の密度')s.value=prefs.density;});accent.value=prefs.accent;err.textContent='';updateIcons();dialog.showModal();};
    FactoryEquipment.configureIcons({icons:()=>prefs.icons.map(icon=>({id:icon.id,label:icon.name,url:iconURL(icon)})),categoryIcon:category=>prefs.categoryIcons[category]||''});
    if(server&&!FactoryAPI.session.limits.customization){look.querySelector('[aria-label="テーマ"]').disabled=true;accent.disabled=true;brandInput.disabled=true;input.disabled=true;look.append(el('p','配色・ブランド名・独自アイコンはProの機能です。有料管理者デモでお試しください。'));}
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change',apply);
    window.addEventListener('storage',e=>{if(e.key===KEY){try{prefs=normalize(JSON.parse(e.newValue||'{}'));apply();window.factoryMap?.render();}catch{}}});
    apply();window.factoryMap?.render();api.getPreferences=()=>structuredClone(prefs);api.flush=()=>saveChain;window.dispatchEvent(new Event('factory-preferences-ready'));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
