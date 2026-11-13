// Exercise JWT verification in workerd, where fetch redirect modes differ from Node.
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const cfRequire=createRequire(new URL('../cloudflare/package.json',import.meta.url));
const uiRequire=createRequire(new URL('../frontend/package.json',import.meta.url));
const {Miniflare}=cfRequire('miniflare'),{build}=uiRequire('esbuild');
const built=await build({stdin:{contents:`import {authenticate} from '../cloudflare/auth.mjs';export default {async fetch(request,env){try{return Response.json(await authenticate(request,env));}catch(e){return Response.json({error:e.message},{status:e.status||500});}}};`,resolveDir:fileURLToPath(new URL('.',import.meta.url))},bundle:true,format:'esm',write:false,platform:'browser',target:'es2022'});
const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='runtime-test';
const base64=x=>Buffer.from(x).toString('base64url');
const unsigned=base64(JSON.stringify({alg:'RS256',kid:jwk.kid}))+'.'+base64(JSON.stringify({iss:'https://issuer.example',aud:['factory'],sub:'test-user',exp:Date.now()/1000+300}));
const token=unsigned+'.'+base64(await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(unsigned)));
for(const redirect of [false,true]){
 let requests=0;
 const mf=new Miniflare({workers:[{
  config:{name:'auth-test',compatibilityDate:'2026-11-13',manifest:{mainModule:'auth.mjs',modules:{'auth.mjs':{type:'esm',contents:built.outputFiles[0].text}}},env:{AUTH_ISSUER:{type:'text',value:'https://issuer.example'},AUTH_AUDIENCE:{type:'text',value:'factory'},AUTH_JWKS_URL:{type:'text',value:'https://issuer.example/certs'}}},
  dev:{outboundService:{type:'fetcher',handler:async request=>{requests++;assert.equal(request.url,'https://issuer.example/certs');return redirect?new Response(null,{status:302,headers:{location:'https://untrusted.example/keys'}}):Response.json({keys:[jwk]});}}}
 }]});
 try{const response=await mf.dispatchFetch('https://app.example/',{headers:{authorization:'Bearer '+token}});const body=await response.json();assert.equal(response.status,redirect?401:200,JSON.stringify(body));assert.equal(requests,1,'A redirect must never fetch the untrusted destination');if(!redirect)assert.equal(body.subject,'test-user');}finally{await mf.dispose();}
}
console.log('PASS: workerd verifies signed JWT using fetched public key; provider redirect fails closed without following it');
