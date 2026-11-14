// Test-only loopback server. Injects a locally signed Access identity; never deploy this file.
import http from 'node:http';
import {webcrypto} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import worker from '../cloudflare/worker.mjs';
if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto});
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url))),directory=mkdtempSync(path.join(os.tmpdir(),'factory-browser-db-')),dbpath=path.join(directory,'test.sqlite');
const python=`import json,sqlite3,sys\ndb=sqlite3.connect(sys.argv[1]);db.execute('PRAGMA foreign_keys=ON');db.row_factory=sqlite3.Row\nx=json.load(sys.stdin)\nif 'schema' in x:db.executescript(x['schema']);db.commit();print('[]');sys.exit()\nr=[]\nwith db:\n for q in x['queries']:\n  c=db.execute(q['sql'],q['params']);r.append({'results':[dict(row)for row in c.fetchall()]if c.description else [],'meta':{'changes':max(c.rowcount,0)}})\nprint(json.dumps(r))`;
function execute(input){const r=spawnSync('python3',['-c',python,dbpath],{input:JSON.stringify(input),encoding:'utf8',timeout:10000});if(r.status!==0)throw new Error(r.stderr||String(r.error));return JSON.parse(r.stdout);}
for(const file of ['0001_tenants.sql','0002_scim.sql','0003_map_product.sql','0004_work_events.sql','0005_team_tasks.sql','0006_notion_sync.sql'])execute({schema:readFileSync(path.join(root,'cloudflare/migrations',file),'utf8')});
const DB={prepare(sql){return{sql,params:[],bind(...params){this.params=params;return this;},async all(){return execute({queries:[this]})[0];},async first(){return(await this.all()).results[0]??null;},async run(){return this.all();}};},async batch(queries){return execute({queries});}};
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='test-local';
const b64=x=>Buffer.from(x).toString('base64url'),unsigned=b64(JSON.stringify({alg:'RS256',kid:jwk.kid}))+'.'+b64(JSON.stringify({iss:'https://access.test',sub:'local-test-owner',aud:['map-test'],exp:Date.now()/1000+3600}));
const signed=unsigned+'.'+b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(unsigned)));
const originalFetch=globalThis.fetch;globalThis.fetch=async(url,...args)=>String(url)==='https://access.test/cdn-cgi/access/certs'?new Response(JSON.stringify({keys:[jwk]})):originalFetch(url,...args);
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wasm':'application/wasm','.png':'image/png'};
const ASSETS={async fetch(request){let p=decodeURIComponent(new URL(request.url).pathname);if(p==='/')p='/index.html';const file=path.resolve(root,'public','.'+p);if(!file.startsWith(root+'/public/'))return new Response('Not found',{status:404});try{return new Response(readFileSync(file),{headers:{'content-type':mime[path.extname(file)]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}}};
const env={DB,ASSETS,ACCESS_TEAM:'https://access.test',ACCESS_AUD:'map-test'};
const server=http.createServer(async(req,res)=>{try{const parts=[];for await(const data of req)parts.push(data);const headers=new Headers(req.headers);headers.set('cf-access-jwt-assertion',signed);const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(parts)}:{})});const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){console.error(e);res.writeHead(500);res.end('Test server error');}});
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));
process.on('SIGTERM',()=>{server.close();rmSync(directory,{recursive:true,force:true});process.exit(0);});
