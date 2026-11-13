import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import worker from '../worker.mjs';
globalThis.crypto=webcrypto;
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
