import {ApiError} from './core.mjs';
import {validateMap} from './map-validation.mjs';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const allowed=new Set(['id','code','name','drawingId','point','location','properties','layerId','icon','iconId','locks','attachments','history']);
// This import only changes listed equipment. Omitted history, files and fields survive.
export function previewAssets(input,current,plan){
 const rows=Array.isArray(input)?input:input?.assets,mode=input?.mode||'add';
 if(!Array.isArray(rows)||!rows.length||rows.length>2000)throw new ApiError(422,'assets配列に1〜2,000件の設備を指定してください。');
 if(!['add','upsert'].includes(mode))throw new ApiError(422,'modeはaddかupsertです。');
 const next=structuredClone(current),items=[],errors=[],codes=new Set(),ids=new Set();let created=0,updated=0;
 for(let index=0;index<rows.length;index++){
  const row=rows[index];try{
   if(!object(row)||typeof row.code!=='string'||!row.code.trim())throw new Error('設備ID（code）が必要です。');
   if(Object.keys(row).some(k=>!allowed.has(k)))throw new Error('未定義の項目があります。プロパティはproperties内に指定してください。');
   if(codes.has(row.code))throw new Error('ファイル内で設備IDが重複しています。');codes.add(row.code);
   if(row.properties!==undefined&&(!object(row.properties)||Object.keys(row.properties).some(id=>!current.propertyDefinitions.some(d=>d.id===id))))throw new Error('propertiesには登録済みのプロパティIDと値を指定してください。');
   const existing=current.assets.find(a=>a.code===row.code);
   if(existing&&mode==='add')throw new Error('登録済みの設備IDです。更新するには「追加と更新」を選択してください。');
   if(row.id&&existing&&row.id!==existing.id)throw new Error('設備IDと内部ID（id）が一致しません。');
   if(!existing&&row.id&&current.assets.some(a=>a.id===row.id))throw new Error('内部IDが別の設備で使われています。');
   if(existing&&['history','attachments','locks'].some(k=>Object.hasOwn(row,k)))throw new Error('既存設備のhistory・attachments・locksは一括更新できません。省略すると現在の内容を保持します。');
   const record=existing?{...existing,...row,id:existing.id,properties:{...existing.properties,...row.properties}}:{history:[],attachments:[],properties:{},...row,id:row.id||crypto.randomUUID(),drawingId:row.drawingId||input?.drawingId};
   if(ids.has(record.id))throw new Error('内部IDが重複しています。');ids.add(record.id);
   const candidate={...current,assets:[record],works:[],tasks:[],inspectionPlans:[]};
   validateMap(candidate,plan,{assets:existing?[existing]:[]});
   record.updatedAt=new Date().toISOString();if(existing){next.assets[next.assets.findIndex(a=>a.id===record.id)]=record;updated++;}else{next.assets.push(record);created++;}
   items.push({row:index+1,code:row.code,name:record.name,action:existing?'update':'create',id:record.id});
  }catch(e){errors.push({row:index+1,code:object(row)?row.code||'':'',message:e.message});}
 }
 if(!errors.length)try{validateMap(next,plan,current);}catch(e){errors.push({row:null,code:'',message:e.message});}
 return{next,created,updated,items,errors,canApply:errors.length===0,total:rows.length,mode};
}
