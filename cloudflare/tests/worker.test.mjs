import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import worker from '../worker.mjs';
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const temp=mkdtempSync(path.join(os.tmpdir(),'factory-d1-test-'));
const dbpath=path.join(temp,'test.sqlite');
const python=`import sqlite3,json,sys
db=sqlite3.connect(sys.argv[1])
db.execute('PRAGMA foreign_keys = ON')
db.row_factory=sqlite3.Row
data=json.load(sys.stdin)
if 'schema' in data:
 db.executescript(data['schema']);db.commit();print('[]');sys.exit()
results=[]
try:
 with db:
  for q in data['queries']:
   cursor=db.execute(q['sql'],q['params'])
   rows=[dict(r) for r in cursor.fetchall()] if cursor.description else []
   results.append({'results':rows,'meta':{'changes':max(cursor.rowcount,0)}})
 print(json.dumps(results))
except Exception as e:
 print(str(e),file=sys.stderr);sys.exit(1)
`;
function execute(input) {
 const r=spawnSync('python3',['-c',python,dbpath],{input:JSON.stringify(input),encoding:'utf8'});
 if(r.status!==0)throw Error(r.stderr);
 return JSON.parse(r.stdout);
}
execute({schema:readFileSync(new URL('../migrations/0001_tenants.sql',import.meta.url),'utf8')});
execute({schema:readFileSync(new URL('../migrations/0002_scim.sql',import.meta.url),'utf8')});
const DB={
 prepare(sql){return {sql,params:[],bind(...params){this.params=params;return this;},async all(){return execute({queries:[this]})[0];},async first(){return (await this.all()).results[0]??null;}};},
 async batch(queries){return execute({queries});}
};
const keypair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await crypto.subtle.exportKey('jwk',keypair.publicKey);jwk.kid='test-key';
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{assert.equal(String(url),'https://id.example/jwks');return new Response(JSON.stringify({keys:[jwk]}));};
const b64=x=>Buffer.from(x).toString('base64url');
async function token(sub,override={}) {
 const header=b64(JSON.stringify({alg:'RS256',kid:'test-key'}));
 const payload=b64(JSON.stringify({iss:'https://id.example',aud:'factory',sub,exp:Date.now()/1000+300,...override}));
 const signed=header+'.'+payload;
 return signed+'.'+b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keypair.privateKey,new TextEncoder().encode(signed)));
}
const env={DB,AUTH_ISSUER:'https://id.example',AUTH_AUDIENCE:'factory',AUTH_JWKS_URL:'https://id.example/jwks',ALLOW_REGISTRATION:'true',MOCK_BILLING:'true'};
async function call(sub,url,method='GET',body,envOverride={}) {
 const headers={authorization:'Bearer '+await token(sub)};
 if(body!==undefined)headers['content-type']='application/json';
 return worker.fetch(new Request('https://app.example'+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),{...env,...envOverride});
}
let orgA,orgB;
test('signed OIDC onboarding and isolation with real SQLite',async()=>{
 let r=await call('alice','/api/v1/onboard','POST',{name:'Alpha'});assert.equal(r.status,201);orgA=(await r.json()).organizationId;
 r=await call('bob','/api/v1/onboard','POST',{name:'Beta'});assert.equal(r.status,201);orgB=(await r.json()).organizationId;
 const a=await (await call('alice','/api/v1/organizations')).json();assert.equal(a.items.length,1);assert.equal(a.items[0].id,orgA);
 assert.equal((await call('bob','/api/v1/organizations/'+orgA+'/state')).status,404);
});
test('registration off blocks self-service',async()=>assert.equal((await call('carol','/api/v1/onboard','POST',{name:'Blocked'},{ALLOW_REGISTRATION:'false'})).status,403));
test('quota, CAS, downgrade and audit persist atomically',async()=>{
 const url='/api/v1/organizations/'+orgA;
 const state={version:1,drawings:[{id:'site'}],works:[],assets:[],propertyDefinitions:[],notes:[]};
 assert.equal((await call('alice',url+'/state','PUT',{revision:0,state})).status,200);
 assert.equal((await call('alice',url+'/state','PUT',{revision:0,state})).status,409);
 assert.equal((await call('alice',url+'/customization','PUT',{revision:1,customization:{accent:'#112233'}})).status,403);
 assert.equal((await call('alice',url+'/billing','POST',{revision:1,plan:'pro'})).status,200);
 assert.equal((await call('alice',url+'/customization','PUT',{revision:2,customization:{accent:'#112233'}})).status,200);
 assert.equal((await call('alice',url+'/billing','POST',{revision:3,plan:'free'})).status,409);
 const current=await (await call('alice',url+'/state')).json();assert.equal(current.revision,3);assert.equal(current.plan,'pro');
 const audit=await (await call('alice',url+'/audit')).json();assert.equal(audit.items.length,3);
});
test('import history and repeated import safety',async()=>{
 const url='/api/v1/organizations/'+orgB;
 const state={version:1,drawings:[{id:'site'}],works:[],assets:[{id:'asset',drawingId:'site',history:[{id:'h1',notes:'old history'}]}],propertyDefinitions:[],notes:[]};
 const p=await (await call('bob',url+'/import-preview','POST',{state})).json();assert.equal(p.history,1);assert.equal(p.canApply,true);
 assert.equal((await call('bob',url+'/import','POST',{revision:0,state})).status,200);
 assert.equal((await call('bob',url+'/import','POST',{revision:1,state})).status,409);
 const current=await (await call('bob',url+'/export')).json();assert.equal(current.state.assets[0].history[0].notes,'old history');
});
test('deactivated member cannot access organization',async()=>{
 execute({queries:[{sql:'UPDATE memberships SET active=0 WHERE organization_id=?',params:[orgB]}]});
 assert.equal((await call('bob','/api/v1/organizations/'+orgB+'/state')).status,404);
});
test('wrong audience and forged signature rejected',async()=>{
 const bad=await token('alice',{aud:'other'});
 let r=await worker.fetch(new Request('https://app.example/api/v1/organizations',{headers:{authorization:'Bearer '+bad}}),env);assert.equal(r.status,401);
 const valid=await token('alice');const parts=valid.split('.');parts[1]=b64(JSON.stringify({iss:'https://id.example',aud:'factory',sub:'bob',exp:Date.now()/1000+500}));
 r=await worker.fetch(new Request('https://app.example/api/v1/organizations',{headers:{authorization:'Bearer '+parts.join('.')}}),env);assert.equal(r.status,401);
});
test('SCIM explicitly unimplemented, not a successful mock',async()=>assert.equal((await call('alice','/api/v1/organizations/'+orgA+'/scim')).status,501));
test('cross-origin request rejected',async()=>{
 const r=await worker.fetch(new Request('https://app.example/api/v1/organizations',{headers:{origin:'https://evil.example',authorization:'Bearer '+await token('alice')}}),env);assert.equal(r.status,403);
});
test.after(()=>{globalThis.fetch=originalFetch;rmSync(temp,{recursive:true,force:true});});

const SCHEMA='urn:ietf:params:scim:schemas:core:2.0:User';
const PATCH_SCHEMA='urn:ietf:params:scim:api:messages:2.0:PatchOp';
// Fixed synthetic test token only. No operational token is generated or stored.
const testToken='test-only-scim-token-not-for-production-0001';
const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(testToken))).toString('hex');
async function scim(url,method='GET',value,override={},headers={}) {
 return worker.fetch(new Request('https://app.example/scim/v2'+url,{method,headers:{authorization:'Bearer '+testToken,'content-type':'application/scim+json',...headers},body:value===undefined?undefined:JSON.stringify(value)}),{...env,SCIM_TOKEN_HASH:hash,SCIM_ORGANIZATION_ID:orgA,...override});
}
let scimId;
test('SCIM default disabled and token auth separate from OIDC',async()=>{
 assert.equal((await scim('/Users','GET',undefined,{SCIM_TOKEN_HASH:''})).status,503);
 assert.equal((await scim('/Users','GET',undefined,{}, {authorization:'Bearer wrong'})).status,401);
 assert.equal((await scim('/Users','GET',undefined,{}, {authorization:'Bearer '+await token('alice')})).status,401);
 assert.equal((await worker.fetch(new Request('https://app.example/api/v1/organizations',{headers:{authorization:'Bearer '+testToken}}),env)).status,401);
});
test('SCIM discovery advertises supported core User subset and rejects Groups',async()=>{
 for(const endpoint of ['/ServiceProviderConfig','/Schemas','/ResourceTypes','/ResourceTypes/User'])assert.equal((await scim(endpoint)).status,200);
 const config=await (await scim('/ServiceProviderConfig')).json();assert.equal(config.bulk.supported,false);
 assert.equal((await scim('/Groups')).status,501);
});
test('SCIM provisions only a viewer and maps externalId to exact OIDC subject',async()=>{
 const input={schemas:[SCHEMA],externalId:'scim-person',userName:'person@example.test',displayName:'Demo User',active:true};
 const r=await scim('/Users','POST',input);assert.equal(r.status,201);const u=await r.json();scimId=u.id;
 const repeat=await scim('/Users','POST',input);assert.equal(repeat.status,200);assert.equal((await repeat.json()).id,scimId);
 const orgs=await (await call('scim-person','/api/v1/organizations')).json();assert.equal(orgs.items[0].role,'viewer');assert.equal(orgs.items[0].id,orgA);
 assert.equal((await call('scim-person','/api/v1/organizations/'+orgA+'/state')).status,200);
 assert.equal((await call('scim-person','/api/v1/organizations/'+orgA+'/state','PUT',{revision:3,state:{}})).status,403);
});
test('SCIM filter pagination and empty page',async()=>{
 let r=await (await scim('/Users?filter='+encodeURIComponent('userName eq "PERSON@example.test"'))).json();assert.equal(r.totalResults,1);assert.equal(r.Resources[0].id,scimId);
 r=await (await scim('/Users?count=0')).json();assert.equal(r.totalResults,1);assert.equal(r.itemsPerPage,0);
 r=await (await scim('/Users?startIndex=2&count=1')).json();assert.equal(r.totalResults,1);assert.equal(r.Resources.length,0);
 const bad=await scim('/Users?filter='+encodeURIComponent('active eq true'));assert.equal(bad.status,400);assert.equal((await bad.json()).scimType,'invalidFilter');
 assert.equal((await scim('/Users?count=-1')).status,400);
});
test('SCIM deprovision immediately revokes valid bearer membership and reactivation restores',async()=>{
 const patch=active=>({schemas:[PATCH_SCHEMA],Operations:[{op:'Replace',path:'active',value:active}]});
 assert.equal((await scim('/Users/'+scimId,'PATCH',patch(false))).status,200);
 assert.equal((await call('scim-person','/api/v1/organizations/'+orgA+'/state')).status,404);
 assert.equal((await scim('/Users/'+scimId,'PATCH',patch(true))).status,200);
 assert.equal((await call('scim-person','/api/v1/organizations/'+orgA+'/state')).status,200);
 const edit={schemas:[PATCH_SCHEMA],Operations:[{op:'replace',value:{userName:'renamed@example.test',displayName:'Renamed'}}]};
 assert.equal((await scim('/Users/'+scimId,'PATCH',edit)).status,200);
 assert.equal((await (await scim('/Users/'+scimId)).json()).externalId,'scim-person');
});
test('SCIM cannot mutate subject, role, existing owner or another organization',async()=>{
 const make={schemas:[SCHEMA],externalId:'alice',userName:'alice@example.test'};
 assert.equal((await scim('/Users','POST',make)).status,409);
 for(const path of ['externalId','roles','groups','organizationId']) {
 const r=await scim('/Users/'+scimId,'PATCH',{schemas:[PATCH_SCHEMA],Operations:[{op:'replace',path,value:'anything'}]});assert.equal(r.status,400);assert.equal((await r.json()).scimType,'mutability');
 }
 assert.equal((await scim('/Users/'+scimId,'GET',undefined,{SCIM_ORGANIZATION_ID:orgB})).status,404);
});
test('SCIM duplicate names, optimistic version and atomic patch rollback',async()=>{
 const duplicate={schemas:[SCHEMA],externalId:'another-person',userName:'RENAMED@example.test'};
 assert.equal((await scim('/Users','POST',duplicate)).status,409);
 const members=await (await call('another-person','/api/v1/organizations')).json();assert.equal(members.items.length,0);
 const before=await (await scim('/Users/'+scimId)).json();
 const p={schemas:[PATCH_SCHEMA],Operations:[{op:'replace',path:'active',value:false}]};
 assert.equal((await scim('/Users/'+scimId,'PATCH',p,{}, {'if-match':'W/"0"'})).status,412);
 const after=await (await scim('/Users/'+scimId)).json();assert.equal(after.active,true);assert.equal(after.meta.version,before.meta.version);
});
test('SCIM refuses deactivation after promotion including final owner',async()=>{
 execute({queries:[{sql:"UPDATE memberships SET role='owner' WHERE organization_id=? AND user_id=(SELECT user_id FROM scim_users WHERE id=?)",params:[orgA,scimId]}]});
 assert.equal((await scim('/Users/'+scimId,'DELETE')).status,403);
 execute({queries:[{sql:"UPDATE memberships SET role='viewer' WHERE organization_id=? AND user_id=(SELECT user_id FROM scim_users WHERE id=?)",params:[orgA,scimId]}]});
 assert.equal((await scim('/Users/'+scimId,'DELETE')).status,204);
 assert.equal((await scim('/Users/'+scimId,'DELETE')).status,404);
 assert.equal((await call('scim-person','/api/v1/organizations/'+orgA+'/state')).status,404);
 const events=execute({queries:[{sql:'SELECT * FROM scim_events WHERE organization_id=? AND resource_id=?',params:[orgA,scimId]}]})[0].results;
 assert.equal(events.length,5);assert.ok(events.every(e=>e.actor==='scim-service'));
});

test('SCIM delete hides resource, reprovision restores exact identity',async()=>{
 assert.equal((await scim('/Users/'+scimId)).status,404);
 const page=await (await scim('/Users')).json();assert.equal(page.totalResults,0);
 const r=await scim('/Users','POST',{schemas:[SCHEMA],externalId:'scim-person',userName:'restored@example.test',active:true});
 assert.equal(r.status,201);assert.equal((await r.json()).id,scimId);
 assert.equal((await call('scim-person','/api/v1/organizations/'+orgA+'/state')).status,200);
});
test('SCIM rejects normalized identity subjects',async()=>{
 for(const externalId of [' alice','alice '])assert.equal((await scim('/Users','POST',{schemas:[SCHEMA],externalId,userName:'new@example.test'})).status,400);
});
test('static serving excludes API and SCIM namespaces',async()=>{
 assert.equal((await worker.fetch(new Request('https://app.example/saas.html'),{})).status,503);
 const ASSETS={fetch:async()=>new Response('static')};
 let r=await worker.fetch(new Request('https://app.example/'),{ASSETS});assert.equal(r.status,200);assert.equal(await r.text(),'static');
 r=await worker.fetch(new Request('https://app.example/saas.html'),{ASSETS});assert.equal(await r.text(),'static');
 assert.notEqual(await (await worker.fetch(new Request('https://app.example/api/nope'),{ASSETS})).text(),'static');
 assert.notEqual(await (await worker.fetch(new Request('https://app.example/scim/nope'),{ASSETS})).text(),'static');
});
