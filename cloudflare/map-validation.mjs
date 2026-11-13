import {ApiError, validateState} from './core.mjs';

export const LIMITS = {
  free:{name:'Free',drawings:3,assets:100,icons:0,storage:10*1024*1024,snapshots:0,customization:false},
  pro:{name:'Pro',drawings:30,assets:2000,icons:50,storage:100*1024*1024,snapshots:10,customization:true},
  enterprise:{name:'Enterprise',drawings:100,assets:10000,icons:100,storage:300*1024*1024,snapshots:30,customization:true}
};
const object=x=>x && typeof x==='object' && !Array.isArray(x);
const error=message=>{throw new ApiError(422,message);};
const point=x=>Array.isArray(x)&&x.length===2&&x.every(v=>Number.isFinite(v)&&Math.abs(v)<1e10);
const date=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\d$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
export const fileIds=value=>{
 const result=new Set();
 function scan(x){if(Array.isArray(x)){x.forEach(scan);return;}if(!object(x))return;for(const[k,v]of Object.entries(x)){if(k==='attachments'&&Array.isArray(v))for(const f of v){const id=typeof f==='string'?f:f?.fileId||f?.id;if(typeof id==='string')result.add(id);}scan(v);}}
 scan(value);return [...result];
};
export function protectLocks(previous,next){
 for(const a of previous.assets){const b=next.assets.find(x=>x.id===a.id);if(!b){if(a.locks?.position||a.locks?.attributes)throw new ApiError(423,'設備のロックを解除してから削除してください。');continue;}
  if(a.locks?.position&&JSON.stringify([a.point,a.drawingId])!==JSON.stringify([b.point,b.drawingId]))throw new ApiError(423,'設備の位置はロックされています。');
  if(a.locks?.attributes){const attributes=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['locks','history','point','drawingId','updatedAt'].includes(k)));if(JSON.stringify(attributes(a))!==JSON.stringify(attributes(b)))throw new ApiError(423,'設備の属性はロックされています。');}
 }
}
export function validateMap(input,plan,previous=null){
 const s=validateState(input,plan);
 if(!s.drawings.length)error('図面を1枚以上残してください。');
 for(const d of s.drawings){if(typeof d.name!=='string'||!d.name.trim()||d.name.length>150)error('図面名を確認してください。');if(!Array.isArray(d.bounds)||d.bounds.length!==2||!d.bounds.every(point))error('図面の座標範囲が不正です。');if(d.type==='sample'&&!['assets/site-plan.svg','assets/floor-plan.svg'].includes(d.asset))error('サンプル図面の参照先が不正です。');if(d.type!=='sample'){if(!object(d.cad)||!Array.isArray(d.cad.layers)||!Array.isArray(d.cad.features)||d.cad.features.length>20000||d.cad.layers.some(x=>typeof x!=='string'))error('CAD図面のデータが不正です。');for(const f of d.cad.features)if(!['line','polygon','text','point'].includes(f.kind)||!Array.isArray(f.points)||!f.points.every(point)||typeof f.layer!=='string')error('CAD要素の座標が不正です。');}}
 const types=['text','number','date','checkbox','select','multiselect','url'];
 for(const p of s.propertyDefinitions){if(!types.includes(p.type)||typeof p.name!=='string'||!p.name.trim())error('プロパティの名前・型を確認してください。');if(['select','multiselect'].includes(p.type)&&(!Array.isArray(p.options)||p.options.some(x=>!x.id||typeof x.label!=='string')||new Set(p.options.map(x=>x.id)).size!==p.options.length))error('選択肢のID・名前を確認してください。');}
 for(const a of s.assets){if(typeof a.name!=='string'||!a.name.trim()||typeof a.code!=='string'||!a.code.trim()||!point(a.point)||!object(a.properties)||!Array.isArray(a.history))error('設備名・設備ID・位置・プロパティを確認してください。');
  if(a.locks&&(!object(a.locks)||Object.values(a.locks).some(x=>typeof x!=='boolean')))error('設備ロックはオン・オフで指定してください。');
  for(const d of s.propertyDefinitions){const v=a.properties[d.id];if(v===undefined||v===null||v===''){if(d.required)error(a.code+': '+d.name+'は必須です。');continue;}let ok=true;if(d.type==='number')ok=typeof v==='number'&&Number.isFinite(v);else if(d.type==='checkbox')ok=typeof v==='boolean';else if(d.type==='date')ok=date(v);else if(d.type==='select')ok=d.options.some(x=>x.id===v);else if(d.type==='multiselect')ok=Array.isArray(v)&&v.every(y=>d.options.some(x=>x.id===y));else if(d.type==='url')ok=typeof v==='string'&&/^https?:\/\//i.test(v);else ok=typeof v==='string';if(!ok)error(a.code+': '+d.name+'の値が型に合いません。');}
  for(const h of a.history){if(!date(h.date)||typeof h.text!=='string'||!h.text.trim()||(h.nextDate&&!date(h.nextDate)))error('点検履歴の日付・内容を確認してください。');}
  a.history.sort((a,b)=>b.date.localeCompare(a.date));
 }
 for(const w of s.works){if(typeof w.title!=='string'||!w.title.trim()||!['active','planned','done'].includes(w.status)||!date(w.start)||!date(w.end)||w.start>w.end||!Array.isArray(w.points)||w.points.length<3||!w.points.every(point))error('工事名・期間・範囲を確認してください。');if((w.assetIds||[]).some(id=>!s.assets.some(a=>a.id===id)))error('関連する設備が存在しません。');}
 for(const n of s.notes){if(!point(n.point)||typeof n.text!=='string'||!n.text.trim()||n.text.length>2000)error('付箋の位置・テキストを確認してください。');if(n.fontColor!=null&&!/^#[\da-f]{6}$/i.test(n.fontColor))error('付箋の文字色が不正です。');if(n.fontSize!==undefined&&(!Number.isFinite(n.fontSize)||n.fontSize<6||n.fontSize>120))error('付箋の文字サイズは6〜120です。');if(n.fontFamily!==undefined&&!['sans','serif','mono'].includes(n.fontFamily))error('付箋のフォントが不正です。');}
 if(previous)protectLocks(previous,s);
 return s;
}
export function visibleState(s,editor){if(editor)return s;const state=structuredClone(s);state.assets=[];state.propertyDefinitions=[];state.works.forEach(w=>w.assetIds=[]);const ids=new Set(['site',...state.works.map(w=>w.drawingId),...state.notes.map(n=>n.drawingId)]);state.drawings=state.drawings.filter(d=>ids.has(d.id));return state;}
export function preferences(input,plan){
 if(!object(input))error('設定が不正です。');
 const result={left:input.left===true,right:input.right===true,focus:input.focus===true,density:input.density==='compact'?'compact':'comfortable'};
 if(!LIMITS[plan].customization&&((input.theme&&input.theme!=='system')||(input.accent&&input.accent!=='#167566')||input.brandName))throw new ApiError(403,'配色・ブランドの変更はProの機能です。');
 result.theme=['light','dark','system'].includes(input.theme)?input.theme:'system';result.accent=/^#[\da-f]{6}$/i.test(input.accent)?input.accent:'#167566';result.brandName=typeof input.brandName==='string'?input.brandName.slice(0,60):'';
 const icons=Array.isArray(input.icons)?input.icons:[];
 if(icons.length>LIMITS[plan].icons)throw new ApiError(403,'カスタムアイコンはProの機能です。');
 result.icons=icons.map(x=>{if(!object(x)||typeof x.id!=='string'||!/^icon-[\da-z-]{1,60}$/.test(x.id)||typeof x.fileId!=='string'||typeof x.name!=='string')error('アイコンの情報が不正です。');return{id:x.id,fileId:x.fileId,name:x.name.slice(0,60)};});
 if(new Set(result.icons.map(x=>x.id)).size!==result.icons.length)error('アイコンIDが重複しています。');
 result.categoryIcons={};for(const[k,v]of Object.entries(input.categoryIcons||{})){if(/^[a-z]{1,30}$/.test(k)&&result.icons.some(x=>x.id===v))result.categoryIcons[k]=v;}
 return result;
}
