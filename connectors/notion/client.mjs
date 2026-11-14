export const NOTION_VERSION='2026-03-11';
export class NotionError extends Error {
 constructor(code,message,{status=502,retryAfter=0}={}){super(message);this.name='NotionError';this.code=code;this.status=status;this.retryAfter=retryAfter;}
}
export class PollBudgetExceeded extends Error {constructor(){super('Continue from the saved polling cursor');this.name='PollBudgetExceeded';}}
export function notionId(value){const s=String(value||'').trim();let match;if(/^[a-f\d]{32}$/i.test(s))match=s;else if(/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(s))match=s.replaceAll('-','');else{let url;try{url=new URL(s);}catch{throw new NotionError('invalid_id','NotionのページURLまたはIDを入力してください。',{status:422});}if(!['www.notion.so','notion.so','www.notion.com','notion.com','app.notion.com'].includes(url.hostname))throw new NotionError('invalid_id','NotionのページURLを入力してください。',{status:422});match=url.pathname.match(/[a-f\d]{32}(?:\/|$)/i)?.[0]?.replace('/','');}if(!match)throw new NotionError('invalid_id','Notion IDを確認してください。',{status:422});return match.toLowerCase().replace(/^(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})$/,'$1-$2-$3-$4-$5');}
export const richText=value=>{const s=String(value||''),parts=[];if(s.length>90000)throw new NotionError('value_too_large','Notionへ送るテキストが大きすぎます。',{status:422});for(let i=0;i<s.length;i+=1800)parts.push({type:'text',text:{content:s.slice(i,i+1800)}});return parts;};
export const plainText=value=>(value||[]).map(v=>v.plain_text??v.text?.content??'').join('');
export class NotionConnector {
 #token; #fetch; #last=0;
 constructor({token,fetch:fetcher=globalThis.fetch,minIntervalMs=400,maxRequests=32}={}){if(typeof token!=='string'||!token.trim())throw new NotionError('missing_token','Notionの接続トークンが必要です。',{status:422});this.#token=token;this.#fetch=fetcher;this.minIntervalMs=minIntervalMs;this.remaining=maxRequests;}
 async request(method,path,body){
  if(this.remaining<=0)throw new PollBudgetExceeded();if(!/^\/(?:users|pages|databases|data_sources|blocks)(?:\/|$)/.test(path)||path.includes('..'))throw new NotionError('invalid_path','Notion APIのパスが不正です。',{status:422});this.remaining--;
  const wait=this.#last+this.minIntervalMs-Date.now();if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));this.#last=Date.now();
  let response;try{response=await this.#fetch('https://api.notion.com/v1'+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:'Bearer '+this.#token,'Notion-Version':NOTION_VERSION,...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});}catch{throw new NotionError('network','Notionへの通信を完了できませんでした。次回に再確認します。');}
  const retryAfter=Math.max(1,Math.min(3600,Number(response.headers.get('retry-after'))||60));
  if(!response.ok){await response.body?.cancel();const messages={401:'Notion接続トークンが無効です。',403:'Notionの読み取り・更新・作成権限を確認してください。',404:'Notionのページ共有・接続設定、または削除状態を確認してください。',400:'Notionの列設定・型・入力値を確認してください。',406:'Notionワークスペースの保存上限です。',429:'NotionのAPI上限です。指定時間後に再開します。'};throw new NotionError('http_'+response.status,messages[response.status]||'Notionが一時的に利用できません。',{status:response.status===429?429:502,retryAfter:response.status===429?retryAfter:60});}
  const reader=response.body?.getReader();let size=0;const parts=[];if(!reader)throw new NotionError('empty_response','Notionの応答が空です。');while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>3000000){await reader.cancel();throw new NotionError('response_too_large','Notionの応答が大きすぎます。');}parts.push(value);}const all=new Uint8Array(size);let offset=0;for(const p of parts){all.set(p,offset);offset+=p.length;}try{return JSON.parse(new TextDecoder().decode(all));}catch{throw new NotionError('invalid_response','Notionの応答を読み取れませんでした。');}
 }
 testConnection(){return this.request('GET','/users/me');}
 getPage(id){return this.request('GET','/pages/'+notionId(id));}
 updatePage(id,properties,extra={}){return this.request('PATCH','/pages/'+notionId(id),{properties,...extra});}
 createPage(dataSourceId,properties){return this.request('POST','/pages',{parent:{type:'data_source_id',data_source_id:notionId(dataSourceId)},properties});}
 getDataSource(id){return this.request('GET','/data_sources/'+notionId(id));}
 updateDataSource(id,properties){return this.request('PATCH','/data_sources/'+notionId(id),{properties});}
 getDatabase(id){return this.request('GET','/databases/'+notionId(id));}
 createDatabase(parentId,title,properties){return this.request('POST','/databases',{parent:{type:'page_id',page_id:notionId(parentId)},title:richText(title),initial_data_source:{properties}});}
 queryPage(id,{cursor,pageSize=25,filter,sorts}={}){return this.request('POST','/data_sources/'+notionId(id)+'/query',{page_size:Math.max(1,Math.min(100,pageSize)),...(cursor?{start_cursor:cursor}:{}),...(filter?{filter}:{}),...(sorts?{sorts}:{})});}
 propertyPage(pageId,propertyId,cursor){const property=encodeURIComponent(decodeURIComponent(propertyId));return this.request('GET','/pages/'+notionId(pageId)+'/properties/'+property+'?page_size=100'+(cursor?'&start_cursor='+encodeURIComponent(cursor):''));}
}
