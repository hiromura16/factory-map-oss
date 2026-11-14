import {ApiError} from '../core.mjs';
import {validateMap} from '../map-validation.mjs';
import {NotionConnector,NotionError,PollBudgetExceeded,notionId,plainText} from '../../connectors/notion/index.mjs';
import {decryptToken} from './credentials.mjs';
import {KINDS,LABELS,fields,systemFields,systemValues,schema,records,project,merge,applyProjection,canonical,toProperty,fromProperty} from './model.mjs';
const systemValue=(record,kind,state)=>canonical(systemValues(kind,record,state));
const now=()=>new Date().toISOString(),equal=(a,b)=>canonical(a)===canonical(b);
class Cancelled extends Error {}
// DBとNotionへのリクエスト数を合算して制限し、最後の再開位置の保存分を確保します。
function withQueryBudget(env,limit=32){
 let remaining=limit;const charge=n=>{if(remaining<n)throw new PollBudgetExceeded();remaining-=n;};
 return{outbound:()=>charge(1),env:{...env,DB:{prepare(sql){let statement=env.DB.prepare(sql);return{get raw(){return statement;},bind(...values){statement=statement.bind(...values);return this;},first(...args){charge(1);return statement.first(...args);},all(...args){charge(1);return statement.all(...args);},run(...args){charge(1);return statement.run(...args);}};},batch(statements){charge(statements.length);return env.DB.batch(statements.map(s=>s.raw));}}}};
}

async function connection(env,id){return env.DB.prepare('SELECT * FROM map_notion_connections WHERE organization_id=?').bind(id).first();}
async function syncContext(env,config){const org=await env.DB.prepare("SELECT o.*,m.role FROM organizations o JOIN memberships m ON m.organization_id=o.id WHERE o.id=? AND m.user_id=? AND m.active=1 AND m.role IN ('owner','editor')").bind(config.organization_id,config.actor_id).first();if(!org)throw new ApiError(403,'同期設定者の施設担当権限が無効です。');return{org,state:validateMap(JSON.parse(org.state_json),org.plan),user:{id:config.actor_id},editor:true};}
async function saveJob(env,config,lease,job,sources){await env.DB.prepare('UPDATE map_notion_connections SET job_json=?,sources_json=?,updated_at=? WHERE organization_id=? AND lease_token=? AND generation=?').bind(JSON.stringify(job),JSON.stringify(sources),now(),config.organization_id,lease,config.generation).run();}
async function linksFor(env,id){return(await env.DB.prepare('SELECT * FROM map_notion_links WHERE organization_id=?').bind(id).all()).results;}
async function saveLink(env,config,links,data){const value={base_json:null,system_json:null,remote_edited_at:null,state:'pending',issue_json:null,resolution:null,...data,updated_at:now()};await env.DB.prepare('INSERT INTO map_notion_links(organization_id,kind,local_id,page_id,base_json,system_json,remote_edited_at,state,issue_json,resolution,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,kind,local_id) DO UPDATE SET page_id=excluded.page_id,base_json=excluded.base_json,system_json=excluded.system_json,remote_edited_at=excluded.remote_edited_at,state=excluded.state,issue_json=excluded.issue_json,resolution=excluded.resolution,updated_at=excluded.updated_at').bind(config.organization_id,value.kind,value.local_id,value.page_id,value.base_json,value.system_json,value.remote_edited_at,value.state,value.issue_json,value.resolution,value.updated_at).run();const i=links.findIndex(l=>l.kind===value.kind&&l.local_id===value.local_id);if(i<0)links.push(value);else links[i]=value;return value;}
function pageProperty(page,id,name){return Object.values(page.properties||{}).find(p=>p.id===id)||page.properties?.[name];}
function managedFields(kind,state){return [...fields(kind,state),...systemFields(kind)];}
async function ensureSchema(client,source,kind,state,sources){
 const remote=await client.getDataSource(source.id),properties=remote.properties||{},mapping={...source.properties},additions={};source.optionIds??={};
 for(const f of managedFields(kind,state)){
  let p=mapping[f.key]?Object.values(properties).find(p=>p.id===mapping[f.key]):properties[f.name];
  if(mapping[f.key]&&!p)throw new ApiError(422,LABELS[kind]+'の列「'+f.name+'」が削除されています。Notion側で復元してください。');
  if(p&&p.type!==f.type)throw new ApiError(422,LABELS[kind]+'の列「'+f.name+'」の型を確認してください。');
  if(!p){let name=f.name;if(properties[name]||additions[name])name+=' ['+f.key+']';additions[name]=schema(f,sources);}
  else{mapping[f.key]=p.id;if(f.options){const known=source.optionIds[f.key]||{},existing=p[f.type]?.options||[],options=structuredClone(existing);let changed=false;for(const [choice,name]of Object.entries(f.options)){let option=options.find(o=>o.id===known[choice])||options.find(o=>o.name===name);if(option){if(option.name!==name){option.name=name;changed=true;}known[choice]=option.id;}else{options.push({name,color:'default'});changed=true;}}source.optionIds[f.key]=known;if(changed)additions[p.id]={[f.type]:{options}};}}
 }
 let updated=remote;if(Object.keys(additions).length)updated=await client.updateDataSource(source.id,additions);
 for(const f of managedFields(kind,state))if(!mapping[f.key]){const p=updated.properties?.[f.name]||updated.properties?.[f.name+' ['+f.key+']'];if(!p)throw new ApiError(422,'Notionの列「'+f.name+'」を作成できませんでした。');mapping[f.key]=p.id;}
 for(const f of managedFields(kind,state))if(f.options){const p=Object.values(updated.properties||{}).find(p=>p.id===mapping[f.key]);source.optionIds[f.key]=Object.fromEntries(Object.entries(f.options).map(([key,name])=>[key,p?.[f.type]?.options?.find(o=>o.name===name)?.id]).filter(([,id])=>id));}source.properties=mapping;return source;
}
async function decode(client,page,kind,state,source,links){const p={};for(const f of fields(kind,state)){let value=pageProperty(page,source.properties[f.key],f.name);if(value?.has_more){let cursor,items=[];do{const r=await client.propertyPage(page.id,value.id,cursor);items.push(...r.results);cursor=r.has_more?r.next_cursor:null;}while(cursor);value={...value,[f.type]:items.map(v=>v[f.type]||v)};}p[f.key]=fromProperty(f,value,links);}return p;}
function encode(kind,state,source,projection,links,{id,record,origin,sync='同期済み'}={},keys=null){
 const properties={},automatic=systemValues(kind,record,state);
 for(const f of fields(kind,state))if(!keys||keys.includes(f.key))properties[source.properties[f.key]]=toProperty(f,projection[f.key],links);
 for(const f of systemFields(kind)){
  const values={_id:id,_sync:sync,_positionLock:!!record.locks?.position,_attributeLock:!!record.locks?.attributes,_progress:automatic.progress,_open:automatic.open,_overdue:automatic.overdue};
  let v=values[f.key];
  if(f.key==='_url')v=kind==='projects'?origin+'/console.html?teamTab=projects&project='+encodeURIComponent(id)+'#tasks':['teamMembers','inspectionPlans','tasks'].includes(kind)?origin+'/console.html'+(kind==='tasks'?'?task='+encodeURIComponent(id):'')+'#tasks':origin+'/index.html?'+(kind==='works'?'work=':'asset=')+encodeURIComponent(kind==='inspections'?record.assetId:id);
  properties[source.properties[f.key]]=toProperty(f,v,links);
 }return properties;
}
async function setup(client,env,config,lease,job,sources){
 let children;
 for(const kind of KINDS){if(!sources[kind]){
   if(!children){
    // 台帳をトグルやカラムへ整理していても、再接続時に同じDBを見つけます。
    job.discovery??={queue:[{id:notionId(config.home_page_id),cursor:null}],found:[],visited:[]};const scan=job.discovery;
    while(scan.queue.length){const item=scan.queue[0],r=await client.request('GET','/blocks/'+item.id+'/children?page_size=100'+(item.cursor?'&start_cursor='+encodeURIComponent(item.cursor):''));
     for(const b of r.results){if(b.type==='child_database')scan.found.push(b);else if(b.has_children&&['toggle','column_list','column','callout','heading_1','heading_2','heading_3'].includes(b.type)&&!scan.visited.includes(b.id)){scan.visited.push(b.id);scan.queue.push({id:b.id,cursor:null});if(scan.visited.length>300)throw new ApiError(422,'同期先ページの階層が多すぎます。台帳を含むページを指定してください。');}}
     if(r.has_more)item.cursor=r.next_cursor;else scan.queue.shift();await saveJob(env,config,lease,job,sources);
    }children=scan.found;
   }
   const found=children.filter(b=>b.type==='child_database'&&b.child_database?.title===LABELS[kind]);if(found.length>1)throw new ApiError(409,'Notionに同名の'+LABELS[kind]+'が複数あります。同期先ページを整理してください。');
   let database;if(found.length)database={id:found[0].id};else database=await client.createDatabase(config.home_page_id,LABELS[kind],{'名前':{title:{}},'PlantDesk ID':{rich_text:{}}});sources[kind]={databaseId:database.id,id:database.data_sources?.[0]?.id||'',properties:{}};await saveJob(env,config,lease,job,sources);
  }
  if(!sources[kind].id){const database=await client.getDatabase(sources[kind].databaseId);if(database.data_sources?.length!==1)throw new ApiError(422,LABELS[kind]+'のデータソースが1つになるよう確認してください。');sources[kind].id=database.data_sources[0].id;await saveJob(env,config,lease,job,sources);}
 }
 job.phase='remote';job.kindIndex=0;delete job.discovery;
}
async function issue(env,config,links,kind,id,page,local,remote,error,conflicts=[]){return saveLink(env,config,links,{...(links.find(l=>l.kind===kind&&l.local_id===id)||{}),kind,local_id:id,page_id:page.id,remote_edited_at:page.last_edited_time,state:conflicts.length?'conflict':'error',issue_json:JSON.stringify({message:error,fields:conflicts,local,notion:remote})});}
async function commitProjection(env,c,kind,id,p,commit){const candidate=structuredClone(c.state);applyProjection(candidate,kind,id,p,c.state);const valid=validateMap(candidate,c.org.plan,c.state);if(equal(valid,c.state))return;const revision=await commit(env,c,valid,'notion.pull',c.org.revision);c.state=valid;c.org={...c.org,revision};}
async function syncPair(ctx,page,kind,link=null){
 const {env,config,client,c,sources,links,counters,commit,origin}=ctx,source=sources[kind];
 let id=link?.local_id,p=null,local=null;
 try{
  const remoteId=plainText(pageProperty(page,source.properties._id,'PlantDesk ID')?.rich_text);
  if(link&&remoteId&&remoteId!==link.local_id)throw new ApiError(422,'PlantDesk IDを変更しないでください。');
  if(!link&&remoteId)link=links.find(l=>l.kind===kind&&l.local_id===remoteId);
  if(link&&link.page_id!==page.id)throw new ApiError(409,'PlantDesk IDが別のNotionページで重複しています。');
  id=link?.local_id||remoteId||'_page:'+page.id;
  let record=records(kind,c.state).find(r=>r.id===id);local=record?project(kind,record,c.state):null;
  if(link?.state==='deleted')return;
  if(page.in_trash){if(link)await saveLink(env,config,links,{...link,state:'remote_deleted',issue_json:JSON.stringify({message:'Notion側でゴミ箱に移動されています。PlantDeskのデータは保持しています。',local,notion:null})});return;}
  p=await decode(client,page,kind,c.state,source,links);
  if(!link||id.startsWith('_page:')){
   if(id.startsWith('_page:'))id=kind==='inspections'?p.assetId+'~notion-'+page.id:'notion-'+page.id;
   if(!/^[a-zA-Z0-9_.:~\-]{1,220}$/.test(id))throw new ApiError(422,'PlantDesk IDを変更しないでください。');
   record=records(kind,c.state).find(r=>r.id===id);local=record?project(kind,record,c.state):null;
   if(link?.local_id?.startsWith('_page:')){await env.DB.prepare('DELETE FROM map_notion_links WHERE organization_id=? AND kind=? AND local_id=?').bind(config.organization_id,kind,link.local_id).run();links.splice(links.indexOf(link),1);link=null;}
  }
  if(!record&&link?.base_json&&link.resolution!=='notion'){await saveLink(env,config,links,{...link,state:'local_deleted',issue_json:JSON.stringify({message:'PlantDesk側で削除されています。Notionのページは保持しています。',local:null,notion:p})});return;}
  if(!record&&config.direction==='push'&&link?.resolution!=='notion'){await issue(env,config,links,kind,id,page,null,p,'Notionで新規作成された行です。取り込みには双方向またはNotion→PlantDeskを選択してください。');return;}
  const resolution=link?.resolution,merged=record?merge(link?.base_json?JSON.parse(link.base_json):null,local,p,config.direction,resolution):{value:p,conflicts:[]};
  if(merged.conflicts.length){await issue(env,config,links,kind,id,page,local,p,'両方で同じ項目が変更されています。',merged.conflicts);counters.conflicts++;return;}
  const initial=!record;
  if((initial||!equal(local,merged.value))&&(config.direction!=='push'||resolution==='notion'))await commitProjection(env,c,kind,id,merged.value,commit);
  record=records(kind,c.state).find(r=>r.id===id);if(!record)return;const normalized=project(kind,record,c.state),changes=Object.keys(normalized).filter(k=>!equal(normalized[k],p[k]));
  if((config.direction!=='pull'||resolution==='local')&&(changes.length||!remoteId||link?.system_json!==systemValue(record,kind,c.state))){
   const fresh=await client.getPage(page.id);if(fresh.last_edited_time!==page.last_edited_time)throw new ApiError(409,'Notion側に新しい編集があります。次回に再確認します。');
   page=await client.updatePage(page.id,encode(kind,c.state,source,normalized,links,{id,record,origin},changes));counters.pushed++;
  }
  if(link?.state==='active'&&!link.resolution&&link.base_json===canonical(config.direction==='pull'?p:normalized)&&link.system_json===systemValue(record,kind,c.state)&&link.remote_edited_at===page.last_edited_time){link.updated_at=now();return;}
  await saveLink(env,config,links,{kind,local_id:id,page_id:page.id,base_json:canonical(config.direction==='pull'?p:normalized),system_json:systemValue(record,kind,c.state),remote_edited_at:page.last_edited_time,state:'active'});if(initial||!equal(local,normalized))counters.pulled++;
 }catch(e){if(e instanceof PollBudgetExceeded||e instanceof Cancelled||e instanceof NotionError&&['network','http_429'].includes(e.code))throw e;if(e instanceof ApiError&&e.status===409&&e.message.includes('更新'))throw e;if(kind==='tasks'&&!ctx.job.relationPass)ctx.job.retryTasks=true;await issue(env,config,links,kind,id||'_page:'+page.id,page,local,p,e.message);counters.errors++;}
}
async function syncLocal(ctx,kind,id,probe){
 const {client,c,links,sources,config,env,counters,origin}=ctx;let link=links.find(l=>l.kind===kind&&l.local_id===id),record=records(kind,c.state).find(r=>r.id===id),source=sources[kind];if(link?.state==='deleted')return;if(link?.page_id.startsWith('pending:'))link=null;
 if(!record){if(link&&['error','pending'].includes(link.state)&&kind==='tasks'&&ctx.job.relationPass&&/^[a-f0-9-]{36}$/i.test(link.page_id))return syncPair(ctx,await client.getPage(link.page_id),kind,link);if(link&&!id.startsWith('_page:')&&link.state!=='local_deleted')await saveLink(env,config,links,{...link,state:'local_deleted',issue_json:JSON.stringify({message:'PlantDesk側で削除されています。Notionのページは保持しています。',local:null,notion:link.base_json?JSON.parse(link.base_json):null})});return;}
 const local=project(kind,record,c.state);
 if(link){if(link.state==='active'&&link.base_json===canonical(local)&&link.system_json===systemValue(record,kind,c.state)&&(!probe||link.updated_at>=ctx.startedAt)&&!link.resolution)return;if(link.state!=='active'&&!link.resolution&&!ctx.job.refreshingProjects&&!(kind==='tasks'&&ctx.job.relationPass)&&(!probe||link.updated_at>=ctx.startedAt))return;try{return await syncPair(ctx,await client.getPage(link.page_id),kind,link);}catch(e){if(e instanceof NotionError&&e.code==='http_404'){await saveLink(env,config,links,{...link,state:'error',issue_json:JSON.stringify({message:e.message,local,notion:null})});counters.errors++;return;}throw e;}}
 if(config.direction==='pull')return;
 // 再作成の前に固定IDで検索し、作成の成否が不明な場合も重複を防ぎます。
 const matches=await client.queryPage(source.id,{filter:{property:source.properties._id,rich_text:{equals:id}},pageSize:2});
 if(matches.results.length>1){await issue(env,config,links,kind,id,matches.results[0],local,null,'同じPlantDesk IDのNotionページが複数あります。');counters.errors++;return;}
 if(matches.results.length)return syncPair(ctx,matches.results[0],kind);
 const sent=structuredClone(local);for(const f of fields(kind,c.state).filter(f=>f.type==='relation'&&f.target===kind)){const ids=f.many?sent[f.key]:sent[f.key]?[sent[f.key]]:[],known=ids.filter(id=>links.some(l=>l.kind===kind&&l.local_id===id&&/^[a-f0-9-]{36}$/i.test(l.page_id)));if(known.length!==ids.length){sent[f.key]=f.many?known:known[0]||'';ctx.job.deferred=true;}}
 const page=await client.createPage(source.id,encode(kind,c.state,source,sent,links,{id,record,origin}));await saveLink(env,config,links,{kind,local_id:id,page_id:page.id,base_json:canonical(sent),system_json:systemValue(record,kind,c.state),remote_edited_at:page.last_edited_time,state:'active'});counters.pushed++;
}
export async function runNotionConnection(env,organizationId,{commit,origin='https://plantdesk.pirosea-demo.workers.dev'}={}){
 const lease=crypto.randomUUID(),until=new Date(Date.now()+150000).toISOString();const claimed=await env.DB.prepare("UPDATE map_notion_connections SET lease_token=?,lease_until=?,status='running' WHERE organization_id=? AND token_cipher IS NOT NULL AND (enabled=1 OR requested>0) AND (lease_until IS NULL OR lease_until<?)").bind(lease,until,organizationId,now()).run();if(claimed.meta.changes!==1)return{skipped:true};
 const config=await connection(env,organizationId),sources=JSON.parse(config.sources_json),oldJob=JSON.parse(config.job_json||'{}');let job=oldJob,counters=oldJob.counters||{pushed:0,pulled:0,conflicts:0,errors:0},complete=false,failure=null,paused=false;
 if(!job.runId){job={runId:crypto.randomUUID(),phase:'setup',kindIndex:0,startedAt:now(),lastProbe:oldJob.lastProbe||'',fullProbe:oldJob.forceProbe||!oldJob.lastProbe||Date.now()-Date.parse(oldJob.lastProbe)>86400000,counters};await env.DB.prepare("INSERT INTO map_notion_runs(id,organization_id,started_at,status) VALUES(?,?,?,'running')").bind(job.runId,organizationId,job.startedAt).run();}
 try{
  const budget=withQueryBudget(env),workEnv=budget.env,c=await syncContext(workEnv,config),links=await linksFor(workEnv,organizationId),token=await decryptToken(env,organizationId,config.token_cipher);const client=new NotionConnector({token,minIntervalMs:env.NOTION_API_INTERVAL_MS===undefined?400:Number(env.NOTION_API_INTERVAL_MS),maxRequests:30});
  const rawRequest=client.request.bind(client),deadline=Date.now()+50000;client.request=async(...args)=>{if(Date.now()>deadline)throw new PollBudgetExceeded();const active=await connection(workEnv,organizationId);if(!active||active.generation!==config.generation||active.lease_token!==lease||!active.enabled&&!active.requested)throw new Cancelled();budget.outbound();return rawRequest(...args);};
  if(job.phase==='setup')await setup(client,workEnv,config,lease,job,sources);
  const ctx={job,env:workEnv,config,client,c,sources,links,counters,commit,origin,startedAt:job.startedAt};let processed=0;
  while(job.kindIndex<KINDS.length){
   const kind=KINDS[job.kindIndex];await ensureSchema(client,sources[kind],kind,c.state,sources);await saveJob(workEnv,config,lease,job,sources);
   if(job.phase==='remote'){
    while(true){if(!job.pages){const query=await client.queryPage(sources[kind].id,{cursor:job.cursor,pageSize:25,sorts:[{timestamp:'created_time',direction:'ascending'}]});job.pages=query.results;job.pageIndex=0;job.nextCursor=query.has_more?query.next_cursor:null;}
     while(job.pageIndex<job.pages.length){await syncPair(ctx,job.pages[job.pageIndex],kind,links.find(l=>l.page_id===job.pages[job.pageIndex].id));(job.seenPages??=[]).push(job.pages[job.pageIndex].id);job.pageIndex++;if(++processed>=150)throw new PollBudgetExceeded();}
     job.pages=null;job.cursor=job.nextCursor;job.nextCursor=null;if(!job.cursor)break;
    }job.phase='local';job.lastLocalId='';
   }
   const ids=[...new Set([...records(kind,c.state).map(r=>r.id),...links.filter(l=>l.kind===kind).map(l=>l.local_id)])].sort();
   for(const id of ids.filter(id=>!job.lastLocalId||id>job.lastLocalId)){try{await syncLocal(ctx,kind,id,job.fullProbe&&!job.seenPages?.includes(links.find(l=>l.kind===kind&&l.local_id===id)?.page_id));}catch(e){if(e instanceof PollBudgetExceeded||e instanceof Cancelled||e instanceof NotionError&&['network','http_429'].includes(e.code))throw e;if(e instanceof ApiError&&e.status===409)throw e;const link=links.find(l=>l.kind===kind&&l.local_id===id);if(link)await issue(workEnv,config,links,kind,id,{id:link.page_id},project(kind,records(kind,c.state).find(r=>r.id===id),c.state),null,e.message);else{const candidate=records(kind,c.state).find(r=>r.id===id);await saveLink(workEnv,config,links,{kind,local_id:id,page_id:'pending:'+kind+':'+id,state:'error',issue_json:JSON.stringify({message:e.message,local:candidate?project(kind,candidate,c.state):null,notion:null})});}counters.errors++;}job.lastLocalId=id;if(++processed>=250)throw new PollBudgetExceeded();}
   if(kind==='tasks'&&(job.deferred||job.retryTasks)&&!job.relationPass){job.relationPass=true;job.deferred=false;job.phase='local';job.lastLocalId='';continue;}
   job.kindIndex=job.refreshingProjects?KINDS.length:job.kindIndex+1;job.phase='remote';job.lastLocalId='';job.cursor=null;job.pages=null;job.seenPages=[];if(job.kindIndex===KINDS.length&&!job.refreshingProjects&&c.state.projects.length){job.refreshingProjects=true;job.kindIndex=KINDS.indexOf('projects');job.phase='local';}
  }complete=true;
 }catch(e){if(e instanceof Cancelled)paused=true;else if(!(e instanceof PollBudgetExceeded)){failure={message:e.message,retryAfter:e.retryAfter||60};if(e instanceof NotionError&&e.code==='network'){if(job.phase==='setup')delete job.discovery;else{job.pages=null;job.cursor=null;job.phase='remote';}}}}
 const current=await connection(env,organizationId);if(!current||current.generation!==config.generation||paused){await env.DB.prepare("UPDATE map_notion_connections SET lease_token=NULL,lease_until=NULL,status=CASE WHEN enabled=1 OR requested>0 THEN 'queued' ELSE 'paused' END WHERE organization_id=? AND lease_token=?").bind(organizationId,lease).run();return{cancelled:true};}
 if(complete){const remaining=await env.DB.prepare("SELECT COALESCE(SUM(state='conflict'),0) AS conflicts,COALESCE(SUM(state NOT IN ('active','deleted','conflict')),0) AS errors FROM map_notion_links WHERE organization_id=?").bind(organizationId).first();counters.conflicts=remaining.conflicts;counters.errors=remaining.errors;await env.DB.prepare('UPDATE map_notion_runs SET finished_at=?,status=?,counters_json=?,error=NULL WHERE id=? AND organization_id=?').bind(now(),counters.errors||counters.conflicts?'issues':'success',JSON.stringify(counters),job.runId,organizationId).run();job={lastProbe:job.fullProbe?now():job.lastProbe};}
 else if(failure)await env.DB.prepare("UPDATE map_notion_runs SET status='retrying',error=?,counters_json=? WHERE id=? AND organization_id=?").bind(failure.message,JSON.stringify(counters),job.runId,organizationId).run();
 // 続きの処理は次のCronで再開する。完了時刻から60秒待つと、毎分の実行を1回飛ばしてしまう。
 const status=failure?'error':complete?'idle':'continuing',next=new Date(Date.now()+(complete?config.interval_minutes*60000:failure?Math.max(60,failure.retryAfter||60)*1000:0)).toISOString();
 await env.DB.prepare('UPDATE map_notion_connections SET sources_json=?,job_json=?,counters_json=?,status=?,last_run_at=?,last_success_at=CASE WHEN ?=1 THEN ? ELSE last_success_at END,last_error=?,next_run_at=CASE WHEN requested>? AND ?=1 THEN ? ELSE ? END,requested=CASE WHEN requested=? AND ?=1 THEN 0 ELSE requested END,lease_token=NULL,lease_until=NULL,updated_at=? WHERE organization_id=? AND lease_token=? AND generation=?').bind(JSON.stringify(sources),JSON.stringify(job),JSON.stringify(counters),status,now(),complete&&!counters.errors&&!counters.conflicts?1:0,now(),failure?.message||null,config.requested,complete?1:0,now(),next,config.requested,complete?1:0,now(),organizationId,lease,config.generation).run();
 return{complete,status,counters};
}
export async function runNotionJobs(env,options){if(!env.DB)return;const rows=await env.DB.prepare('SELECT organization_id FROM map_notion_connections WHERE token_cipher IS NOT NULL AND (enabled=1 OR requested>0) AND (next_run_at IS NULL OR next_run_at<=?) AND (lease_until IS NULL OR lease_until<?) ORDER BY next_run_at LIMIT 1').bind(now(),now()).all();for(const r of rows.results)await runNotionConnection(env,r.organization_id,options);}
