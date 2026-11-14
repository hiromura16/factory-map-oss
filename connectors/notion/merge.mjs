export const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const equal=(a,b)=>canonical(a??null)===canonical(b??null);
/** 管理対象の項目だけをマージします。競合した項目の解決方法は呼び出し元で決めます。 */
export function threeWayMerge(base,local,remote,{direction='both',prefer=null}={}){
 if(prefer==='local'||direction==='push')return{value:structuredClone(local),conflicts:[]};if(prefer==='notion'||direction==='pull')return{value:structuredClone(remote),conflicts:[]};
 const keys=[...new Set([...Object.keys(local),...Object.keys(remote)])];if(!base){if(equal(local,remote))return{value:structuredClone(local),conflicts:[]};return{value:null,conflicts:keys.filter(k=>!equal(local[k],remote[k]))};}
 const value={},conflicts=[];for(const key of keys){const l=local[key],r=remote[key],b=base[key];if(!equal(l,b)&&!equal(r,b)&&!equal(l,r))conflicts.push(key);value[key]=!equal(r,b)?r:l;}return{value,conflicts};
}
