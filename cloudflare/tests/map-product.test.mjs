import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import worker from '../worker.mjs';
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto});
const directory=mkdtempSync(path.join(os.tmpdir(),'factory-map-product-')),dbpath=path.join(directory,'test.sqlite');
const python=`import json,sqlite3,sys\ndb=sqlite3.connect(sys.argv[1]);db.execute('PRAGMA foreign_keys=ON');db.row_factory=sqlite3.Row\nx=json.load(sys.stdin)\nif 'schema' in x:db.executescript(x['schema']);db.commit();print('[]');sys.exit()\nr=[]\nwith db:\n for q in x['queries']:\n  c=db.execute(q['sql'],q['params']);r.append({'results':[dict(row)for row in c.fetchall()]if c.description else [],'meta':{'changes':max(c.rowcount,0)}})\nprint(json.dumps(r))`;
function execute(input){const r=spawnSync('python3',['-c',python,dbpath],{input:JSON.stringify(input),encoding:'utf8',timeout:10000,maxBuffer:16*1024*1024});if(r.status!==0)throw new Error(r.stderr||String(r.error));return JSON.parse(r.stdout);}
for(const file of ['0001_tenants.sql','0002_scim.sql','0003_map_product.sql','0004_work_events.sql'])execute({schema:readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8')});
const DB={prepare(sql){return{sql,params:[],bind(...params){this.params=params;return this;},async all(){return execute({queries:[this]})[0];},async first(){return(await this.all()).results[0]??null;},async run(){return this.all();}};},async batch(queries){return execute({queries});}};
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='map-test';
const oldFetch=globalThis.fetch;globalThis.fetch=async url=>{assert.equal(String(url),'https://access.example/cdn-cgi/access/certs');return new Response(JSON.stringify({keys:[jwk]}));};
const base64=x=>Buffer.from(x).toString('base64url');
async function token(subject){const signed=base64(JSON.stringify({alg:'RS256',kid:jwk.kid}))+'.'+base64(JSON.stringify({iss:'https://access.example',sub:subject,aud:['map-aud'],exp:Date.now()/1000+300}));return signed+'.'+base64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(signed)));}
const env={DB,ACCESS_TEAM:'https://access.example',ACCESS_AUD:'map-aud'};
async function call(path,method='GET',body,profile='pro',subject='alice',cookie=''){const headers={'cf-access-jwt-assertion':await token(subject),'x-factory-profile':profile,cookie};if(body!==undefined&&!(body instanceof FormData)){headers['content-type']='application/json';body=JSON.stringify(body);}return worker.fetch(new Request('https://map.example'+path,{method,headers,body}),env);}
let iconFile,proOrg;
test('SSO is required and creates exactly two isolated demo accounts',async()=>{
 assert.equal((await worker.fetch(new Request('https://map.example/api/state'),env)).status,401);
 const pro=await(await call('/api/session')).json(),free=await(await call('/api/session','GET',undefined,'free')).json();proOrg=pro.organization.id;
 assert.equal(pro.plan,'pro');assert.equal(pro.role,'owner');assert.equal(free.plan,'free');assert.equal(free.role,'editor');assert.notEqual(free.organization.id,pro.organization.id);
 assert.equal((await(await call('/api/state')).json()).state.assets.length,64);assert.equal((await(await call('/api/state','GET',undefined,'free')).json()).state.assets.length,12);
 await call('/api/session');const count=execute({queries:[{sql:'SELECT count(*) AS n FROM organizations',params:[]} ]})[0].results[0].n;assert.equal(count,2);
});
test('separate SSO users never share demo data',async()=>{const bob=await(await call('/api/session','GET',undefined,'pro','bob')).json();assert.notEqual(bob.organization.id,proOrg);});
test('map edits persist and stale revisions do not overwrite',async()=>{const current=await(await call('/api/state')).json();current.state.assets[0].name='Updated unit';let r=await call('/api/state','PUT',current);assert.equal(r.status,200);assert.equal((await(await call('/api/state')).json()).state.assets[0].name,'Updated unit');assert.equal((await call('/api/state','PUT',current)).status,409);assert.notEqual((await(await call('/api/state','GET',undefined,'free')).json()).state.assets[0].name,'Updated unit');});
test('paid customization is persisted and rejected by free API',async()=>{assert.equal((await call('/api/preferences','PUT',{theme:'dark',accent:'#224466'})).status,200);assert.equal((await(await call('/api/preferences')).json()).preferences.theme,'dark');assert.equal((await call('/api/preferences','PUT',{theme:'dark'},'free')).status,403);assert.equal((await call('/api/preferences','PUT',{left:true},'free')).status,200);});
test('files, thumbnails and custom icons have account ownership',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvDkAAAAASUVORK5CYII=','base64'),f=new FormData();f.append('file',new Blob([png],{type:'image/png'}),'later.png');f.append('thumbnail-0',new Blob([png],{type:'image/png'}),'thumbnail.png');
 const r=await call('/api/files','POST',f);assert.equal(r.status,201);iconFile=(await r.json()).files[0].fileId;
 assert.equal((await call('/api/preferences','PUT',{icons:[{id:'icon-added-later',name:'Later',fileId:iconFile}],categoryIcons:{hvac:'icon-added-later'}})).status,200);
 const data=await call('/api/files/'+iconFile+'/thumbnail');assert.equal(data.status,200);assert.deepEqual(Buffer.from(await data.arrayBuffer()),png);
 assert.equal((await call('/api/files/'+iconFile,'GET',undefined,'free')).status,404);assert.equal((await call('/api/files/'+iconFile,'GET',undefined,'pro','bob')).status,404);
 assert.equal((await call('/api/files/'+iconFile,'DELETE')).status,409);
});
test('equipment locks apply to direct APIs and unlock plus move cannot bypass',async()=>{const a=(await(await call('/api/assets')).json()).items[0];assert.equal((await call('/api/assets/'+a.id,'PATCH',{locks:{position:true,attributes:false}})).status,200);assert.equal((await call('/api/assets/'+a.id,'PATCH',{point:[1,2],locks:{position:false,attributes:false}})).status,423);assert.equal((await call('/api/assets/'+a.id,'PATCH',{locks:{position:false,attributes:false}})).status,200);});
test('viewer projection hides assets and equipment files',async()=>{const r=await(await call('/api/state','GET',undefined,'pro','alice','factory_mode=viewer')).json();assert.equal(r.state.assets.length,0);assert.equal(r.state.propertyDefinitions.length,0);assert.equal((await call('/api/assets','GET',undefined,'pro','alice','factory_mode=viewer')).status,403);assert.equal((await call('/api/files/'+iconFile,'GET',undefined,'pro','alice','factory_mode=viewer')).status,404);assert.equal((await call('/api/state','PUT',{state:r.state,revision:r.revision},'pro','alice','factory_mode=viewer')).status,403);});
test('free drawing quota is enforced on the server',async()=>{const r=await(await call('/api/state','GET',undefined,'free')).json();r.state.drawings.push({...r.state.drawings[0],id:'third'},{...r.state.drawings[0],id:'fourth'});assert.equal((await call('/api/state','PUT',r,'free')).status,409);});
test('backup restore, audit and free feature gates',async()=>{const r=await call('/api/snapshots','POST',{name:'Before inspection'});assert.equal(r.status,201);const{id}=await r.json(),current=await(await call('/api/state')).json();current.state.assets[0].name='Changed again';assert.equal((await call('/api/state','PUT',current)).status,200);const fresh=await(await call('/api/state')).json();assert.equal((await call('/api/snapshots/'+id+'/restore','POST',{revision:fresh.revision})).status,200);assert.equal((await(await call('/api/state')).json()).state.assets[0].name,'Updated unit');assert.equal((await call('/api/snapshots','GET',undefined,'free')).status,403);assert.equal((await call('/api/audit','GET',undefined,'free')).status,403);assert.ok((await(await call('/api/audit')).json()).items.some(x=>x.action==='snapshot.restore'));});
test('cross-site writes, bad properties and foreign file refs are rejected',async()=>{const r=new Request('https://map.example/api/state',{method:'PUT',headers:{'cf-access-jwt-assertion':await token('alice'),origin:'https://evil.example'},body:'{}'});assert.equal((await worker.fetch(r,env)).status,403);const current=await(await call('/api/state')).json();current.state.assets[0].attachments=[{fileId:'foreign'}];assert.equal((await call('/api/state','PUT',current)).status,422);});
test('custom categories, icon mappings and equipment reassignment persist atomically',async()=>{
 const current=await(await call('/api/state')).json(),definition=current.state.propertyDefinitions.find(d=>d.id==='category'),id='category-'+crypto.randomUUID(),asset=current.state.assets[0],original=structuredClone(asset);
 definition.options.push({id,label:'生産設備'},{id:'category-second',label:'計測機器'});
 asset.properties.category=id;
 assert.equal((await call('/api/state','PUT',current)).status,200);
 assert.equal((await call('/api/preferences','PUT',{icons:[{id:'icon-custom',fileId:iconFile,name:'Custom'}],categoryIcons:{[id]:'icon-custom'}})).status,200);
 assert.equal((await(await call('/api/preferences')).json()).preferences.categoryIcons[id],'icon-custom');
 const invalid=await(await call('/api/state')).json();invalid.state.propertyDefinitions.find(d=>d.id==='category').options=definition.options.filter(o=>o.id!==id);
 assert.equal((await call('/api/state','PUT',invalid)).status,422);
 assert.equal((await(await call('/api/state')).json()).state.propertyDefinitions.find(d=>d.id==='category').options.length,14);
 invalid.state.assets[0].properties.category='category-second';
 assert.equal((await call('/api/assets/'+asset.id,'PATCH',{locks:{attributes:true,position:false}})).status,200);
 invalid.revision=(await(await call('/api/state')).json()).revision;
 assert.equal((await call('/api/state','PUT',invalid)).status,423);
 assert.equal((await call('/api/assets/'+asset.id,'PATCH',{locks:{attributes:false,position:false}})).status,200);
 invalid.revision=(await(await call('/api/state')).json()).revision;
 assert.equal((await call('/api/state','PUT',invalid)).status,200);
 const saved=(await(await call('/api/state')).json()).state;
 assert.equal(saved.assets[0].properties.category,'category-second');assert.deepEqual(saved.assets[0].history,original.history);assert.deepEqual(saved.assets[0].point,original.point);assert.equal(saved.assets.length,current.state.assets.length);
});
test('maximum-sized file round trip stays within a single small D1 batch',async()=>{const data=new Uint8Array(5*1024*1024);data[0]=101;data[data.length-1]=99;const form=new FormData();form.append('file',new Blob([data]),'large.bin');const upload=await call('/api/files','POST',form);assert.equal(upload.status,201);const f=(await upload.json()).files[0];const current=await(await call('/api/state')).json();current.state.assets[0].attachments=[f];assert.equal((await call('/api/state','PUT',current)).status,200);const response=await call('/api/files/'+f.fileId);assert.equal(response.status,200);const actual=new Uint8Array(await response.arrayBuffer());assert.equal(actual.length,data.length);assert.equal(actual[0],101);assert.equal(actual[actual.length-1],99);const chunks=execute({queries:[{sql:'SELECT count(*) AS n FROM map_file_chunks WHERE file_id=?',params:[f.fileId]}]})[0].results[0].n;assert.ok(chunks<=27);});
test.after(()=>{globalThis.fetch=oldFetch;rmSync(directory,{recursive:true,force:true});});
test('appearance and register preferences persist, invalid sizes are rejected',async()=>{
 const p={appearance:{iconSize:48,iconScale:'fixed',workLabelSize:16,workScale:'gentle',minimumScale:50,coordinates:true},tableViews:{equipment:{columns:['name','code','prop:maker'],sort:'name',descending:true,pageSize:20,filters:{category:'hvac',query:'空調'}}}};
 assert.equal((await call('/api/preferences','PUT',p)).status,200);const saved=(await(await call('/api/preferences')).json()).preferences;
 assert.equal((await call('/api/preferences','PUT',{appearance:{iconSize:40}},'free')).status,200);assert.equal((await call('/api/preferences','PUT',{appearance:{background:'#112233'}},'free')).status,403);
 assert.equal(saved.appearance.iconSize,48);assert.equal(saved.appearance.iconScale,'fixed');assert.deepEqual(saved.tableViews.equipment.columns,['name','code','prop:maker']);assert.equal(saved.tableViews.equipment.filters.category,'hvac');
 assert.equal((await call('/api/preferences','PUT',{appearance:{iconSize:-10}})).status,422);assert.equal((await call('/api/preferences','PUT',{appearance:{background:'url(evil)'}})).status,422);
});
test('mixed layers protect private announcements and locked equipment assignments',async()=>{
 const layer={id:'private-utilities',name:'施設用',color:'#224466',audience:'facility'};
 assert.equal((await call('/api/layers','POST',layer)).status,201);const s=await(await call('/api/state')).json();s.state.assets[0].layerId=layer.id;s.state.works[0].layerId=layer.id;s.state.notes.push({id:'private-note',drawingId:'site',point:[10,10],text:'施設内部メモ',layerId:layer.id});assert.equal((await call('/api/state','PUT',s)).status,200);
 const viewer=(await(await call('/api/state','GET',undefined,'pro','alice','factory_mode=viewer')).json()).state;assert.ok(!viewer.layers.some(x=>x.id===layer.id));assert.ok(!viewer.works.some(x=>x.id===s.state.works[0].id));assert.ok(!viewer.notes.some(x=>x.id==='private-note'));
 const id=s.state.assets[0].id;assert.equal((await call('/api/assets/'+id,'PATCH',{locks:{position:true,attributes:true}})).status,200);assert.equal((await call('/api/layers/'+layer.id,'DELETE')).status,423);assert.equal((await call('/api/assets/'+id,'PATCH',{locks:{position:false,attributes:false}})).status,200);assert.equal((await call('/api/layers/'+layer.id,'DELETE')).status,200);assert.equal((await(await call('/api/assets/'+id)).json()).record.layerId,undefined);
});
test('drawing hierarchy validates targets and cycles, exposes only public links',async()=>{
 const link={id:'area-a',drawingId:'site',targetDrawingId:'floor-a1',name:'A棟へ',audience:'facility',points:[[100,100],[200,100],[200,200],[100,200]]};assert.equal((await call('/api/drawingLinks','POST',link)).status,201);
 assert.equal((await call('/api/drawingLinks','POST',{...link,id:'back-loop',drawingId:'floor-a1',targetDrawingId:'site'})).status,422);
 let viewer=(await(await call('/api/drawingLinks','GET',undefined,'pro','alice','factory_mode=viewer')).json()).items;assert.equal(viewer.length,0);
 assert.equal((await call('/api/drawingLinks/area-a','PATCH',{audience:'public'})).status,200);viewer=(await(await call('/api/drawingLinks','GET',undefined,'pro','alice','factory_mode=viewer')).json()).items;assert.equal(viewer.length,1);
 assert.equal((await call('/api/drawingLinks/area-a','PATCH',{targetDrawingId:'missing'})).status,422);
});
test('work history retains snapshots and attachments through edits, stale saves and deletion',async()=>{
 const f=new FormData();f.append('file',new Blob(['%PDF-1.4\nwork report'],{type:'application/pdf'}),'before.pdf');const uploaded=(await(await call('/api/files','POST',f)).json()).files[0];
 const source=(await(await call('/api/works')).json()).items[0],id='history-'+crypto.randomUUID(),work={...source,id,code:'HISTORY-001',title:'履歴の対象工事',attachments:[uploaded],layerId:undefined};
 assert.equal((await call('/api/works','POST',work)).status,201);const stale=await(await call('/api/state')).json();
 assert.equal((await call('/api/works/'+id,'PATCH',{title:'工事名を更新',attachments:[]})).status,200);assert.equal((await call('/api/state','PUT',stale)).status,409);
 let history=(await(await call('/api/works/'+id+'/history')).json()).items;assert.deepEqual(history.map(e=>e.action),['updated','created']);assert.equal(history[0].before.title,'履歴の対象工事');assert.equal(history[0].after.title,'工事名を更新');
 assert.equal((await call('/api/works/'+id,'DELETE')).status,200);history=(await(await call('/api/works/'+id+'/history')).json()).items;assert.deepEqual(history.map(e=>e.action),['deleted','updated','created']);assert.equal(history[0].after,null);
 const page=await(await call('/api/works/'+id+'/history?limit=1')).json();assert.equal(page.items.length,1);assert.ok(page.nextCursor);const older=await(await call('/api/works/'+id+'/history?limit=1&before='+page.nextCursor)).json();assert.equal(older.items[0].action,'updated');
 assert.ok((await(await call('/api/work-register')).json()).deleted.some(w=>w.id===id));assert.equal((await call('/api/files/'+uploaded.fileId,'DELETE')).status,409);assert.equal((await call('/api/files/'+uploaded.fileId)).status,200);
 for(const path of ['/api/work-register','/api/works/'+id+'/history','/api/dashboard'])assert.equal((await call(path,'GET',undefined,'pro','alice','factory_mode=viewer')).status,403);
 assert.equal((await call('/api/works/'+id+'/history','GET',undefined,'pro','bob')).status,404);
});
