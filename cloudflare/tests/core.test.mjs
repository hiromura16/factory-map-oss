import test from 'node:test';
import assert from 'node:assert/strict';
import {validateState,importPreview,validateCustomization,requireRole} from '../core.mjs';
import {validateClaims,authenticate} from '../auth.mjs';
const state=()=>({version:1,drawings:[{id:'site'}],works:[],assets:[{id:'a1',drawingId:'site',code:'A1',history:[{id:'h1',result:'ok'}]}],propertyDefinitions:[],notes:[]});
test('legacy export envelope preserves history',()=>assert.equal(validateState({state:state()}).assets[0].history[0].result,'ok'));
test('copy does not mutate original',()=>{const s=state();validateState(s).assets[0].code='X';assert.equal(s.assets[0].code,'A1');});
test('duplicate ids rejected',()=>{const s=state();s.assets.push(s.assets[0]);assert.throws(()=>validateState(s),/duplicate/);});
test('dangling drawing rejected',()=>{const s=state();s.assets[0].drawingId='no';assert.throws(()=>validateState(s),/missing drawing/);});
test('duplicate history rejected',()=>{const s=state();s.assets[0].history.push({id:'h1'});assert.throws(()=>validateState(s),/history/);});
test('unknown version rejected',()=>assert.throws(()=>validateState({...state(),version:3}),/version/));
test('plan drawing quota enforced',()=>{const s=state();s.drawings=[1,2,3,4].map(x=>({id:String(x)}));s.assets=[];assert.throws(()=>validateState(s),/quota/);assert.equal(validateState(s,'pro').drawings.length,4);});
test('plan asset quota enforced',()=>{const s=state();s.assets=Array.from({length:101},(_,i)=>({id:'a'+i,drawingId:'site'}));assert.throws(()=>validateState(s),/quota/);});
test('import reports counts and conflicts',()=>{const s=state(),p=importPreview({state:s},s,'free');assert.equal(p.history,1);assert.equal(p.canApply,false);assert.equal(p.conflicts.length,2);});
test('attachments explicitly block incomplete import',()=>{const s=state();s.assets[0].history[0].attachments=['file-1'];const p=importPreview(s,{},'free');assert.equal(p.canApply,false);assert.deepEqual(p.attachmentIds,['file-1']);});
test('fresh import may proceed',()=>assert.equal(importPreview(state(),{},'free').canApply,true));
test('paid customization gate enforced',()=>assert.throws(()=>validateCustomization({accent:'#112233'},'free'),/Pro/));
test('CSS injection and unknown settings rejected',()=>{assert.throws(()=>validateCustomization({accent:'red;url(x)'},'pro'),/accent/);assert.throws(()=>validateCustomization({html:'<script>'},'pro'),/Unknown/);});
test('valid customization accepted',()=>assert.deepEqual(validateCustomization({accent:'#112233',theme:'dark'},'pro'),{accent:'#112233',theme:'dark'}));
test('viewer cannot mutate',()=>assert.throws(()=>requireRole('viewer',['owner','editor']),/role/));
test('OIDC claims bind issuer audience and expiration',()=>{const c={iss:'https://id',sub:'one',aud:'client',exp:200};assert.equal(validateClaims(c,'https://id','client',100).subject,'one');for(const bad of [{...c,iss:'evil'},{...c,aud:'evil'},{...c,exp:90},{...c,sub:''},{...c,nbf:500}])assert.throws(()=>validateClaims(bad,'https://id','client',100));});
test('unsigned identity cannot authenticate',async()=>{await assert.rejects(authenticate(new Request('https://app'),{}),/Bearer/);});
test('oversized snapshot rejected',()=>{const s=state();s.assets[0].notes='a'.repeat(800000);assert.throws(()=>validateState(s),/750/);});

test('actual legacy seed version and history import',async()=>{const fs=await import('node:fs');const legacy=JSON.parse(fs.readFileSync(new URL('../../server/seed.json',import.meta.url),'utf8'));assert.equal(legacy.version,2);const result=importPreview({revision:5,state:legacy},{},'pro');assert.equal(result.state.assets.length,legacy.assets.length);assert.equal(result.history,legacy.assets.reduce((n,a)=>n+(a.history?.length??0),0));assert.deepEqual(result.state,legacy);});

test('nonempty workspace blocks disjoint import in preview',()=>{const current=state();current.drawings[0].id='other';current.assets=[];const p=importPreview(state(),current,'pro');assert.equal(p.conflicts.length,0);assert.equal(p.workspaceEmpty,false);assert.equal(p.canApply,false);assert.match(p.warnings[0],/empty/);});
test('inherited property names are not plan identifiers',()=>{for(const p of ['__proto__','constructor','toString']){assert.throws(()=>validateState(state(),p),/Unknown plan/);assert.throws(()=>validateCustomization({},p),/Pro/);}});

test('multi audience requires authorized party',()=>{const c={iss:'https://id',sub:'one',aud:['client','other'],exp:200};assert.throws(()=>validateClaims(c,'https://id','client',100));assert.equal(validateClaims({...c,azp:'client'},'https://id','client',100).subject,'one');});
