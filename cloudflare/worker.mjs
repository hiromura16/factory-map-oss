import { handleScim } from './scim.mjs';
import { ApiError, PLANS, MAX_BYTES, KINDS, validateState, importPreview, validateCustomization, requireRole } from './core.mjs';
import { authenticate } from './auth.mjs';
const JSON_HEADERS = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
function json(data, status=200) { return new Response(JSON.stringify(data), {status,headers:JSON_HEADERS}); }
async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415,'JSON required');
  if (Number(request.headers.get('content-length') || 0) > MAX_BYTES) throw new ApiError(413,'Payload too large');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400,'Body required');
  const chunks=[]; let size=0;
  while (true) {
    const {done,value}=await reader.read(); if(done) break;
    size += value.byteLength;
    if(size>MAX_BYTES){await reader.cancel();throw new ApiError(413,'Payload too large');}
    chunks.push(value);
  }
  const all=new Uint8Array(size); let offset=0;
  for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(all));}catch{throw new ApiError(400,'Malformed JSON');}
}
async function userId(identity) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([identity.issuer,identity.subject])));
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function revision(input, current) {
  if (!Number.isSafeInteger(input.revision) || input.revision !== current.revision) throw new ApiError(409,'Revision conflict; reload before retrying');
}
async function save(env, org, actor, data, action) {
  // The plan is included in CAS so a simultaneous downgrade cannot bypass quotas.
  const when=new Date().toISOString();
  const result=await env.DB.batch([
    env.DB.prepare('INSERT INTO audit_events(id,organization_id,actor_id,action,revision,created_at) SELECT ?,id,?,?,revision+1,? FROM organizations WHERE id=? AND revision=? AND plan=?')
      .bind(crypto.randomUUID(),actor,action,when,org.id,org.revision,org.plan),
    env.DB.prepare('UPDATE organizations SET state_json=?,customization_json=?,plan=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND plan=?')
      .bind(JSON.stringify(data.state ?? JSON.parse(org.state_json)), JSON.stringify(data.customization ?? JSON.parse(org.customization_json)), data.plan ?? org.plan,when,org.id,org.revision,org.plan)
  ]);
  if(result[1].meta.changes !== 1) throw new ApiError(409,'Concurrent modification; reload');
  return json({revision:org.revision+1});
}
export default {
 async fetch(request,env) {
  try {
   const url=new URL(request.url);
   if(url.pathname === '/scim/v2' || url.pathname.startsWith('/scim/v2/')) return handleScim(request,env);
   if(!/^\/(api|scim)(\/|$)/.test(url.pathname) && url.pathname!=='/health') {
     if(!['GET','HEAD'].includes(request.method)) throw new ApiError(405,'Method not allowed');
     if(!env.ASSETS) throw new ApiError(503,'Static assets are not configured');
     if(url.pathname==='/') return Response.redirect(url.origin+'/saas.html',302);
     return env.ASSETS.fetch(request);
   }
   if(url.pathname==='/health' && request.method==='GET') return json({status:'ok',stage:'development-foundation',billing:'mock-only',legacyUiCompatible:false});
   // No CORS, no cookies, no session fallback: every business request verifies a bearer identity.
   const origin=request.headers.get('origin');
   if(origin && origin!==url.origin) throw new ApiError(403,'Cross-origin requests are not allowed');
   if(!env.DB) throw new ApiError(503,'D1 is not configured');
   const identity=await authenticate(request,env);
   const actor=await userId(identity);
   if(url.pathname==='/api/v1/onboard' && request.method==='POST') {
     if(env.ALLOW_REGISTRATION!=='true') throw new ApiError(403,'Registration is disabled');
     const input=await body(request);
     if(typeof input.name!=='string' || input.name.trim().length<1 || input.name.length>80) throw new ApiError(422,'Organization name required (1–80 characters)');
     const id=crypto.randomUUID(), when=new Date().toISOString();
     await env.DB.batch([
       env.DB.prepare('INSERT OR IGNORE INTO users(id,issuer,subject,created_at) VALUES(?,?,?,?)').bind(actor,identity.issuer,identity.subject,when),
       env.DB.prepare('INSERT INTO organizations(id,name,updated_at) VALUES(?,?,?)').bind(id,input.name.trim(),when),
       env.DB.prepare("INSERT INTO memberships(organization_id,user_id,role) VALUES(?,?,'owner')").bind(id,actor)
     ]);
     return json({organizationId:id,role:'owner'},201);
   }
   if(url.pathname==='/api/v1/organizations' && request.method==='GET') {
     const result=await env.DB.prepare('SELECT o.id,o.name,o.plan,o.revision,m.role FROM organizations o JOIN memberships m ON m.organization_id=o.id WHERE m.user_id=? AND m.active=1').bind(actor).all();
     return json({items:result.results});
   }
   const match=url.pathname.match(/^\/api\/v1\/organizations\/([a-zA-Z0-9-]{1,80})\/(state|export|import-preview|import|customization|billing|audit|scim)$/);
   if(!match) throw new ApiError(404,'Not found');
   const [,id,operation]=match;
   const org=await env.DB.prepare('SELECT o.*,m.role FROM organizations o JOIN memberships m ON m.organization_id=o.id WHERE o.id=? AND m.user_id=? AND m.active=1').bind(id,actor).first();
   if(!org) throw new ApiError(404,'Organization not found');
   const state=JSON.parse(org.state_json);
   if(['state','export'].includes(operation) && request.method==='GET') return json({revision:org.revision,state,plan:org.plan,limits:PLANS[org.plan]});
   if(operation==='customization' && request.method==='GET') return json({revision:org.revision,customization:JSON.parse(org.customization_json)});
   if(operation==='billing' && request.method==='GET') return json({mock:true,enabled:env.MOCK_BILLING==='true',plan:org.plan,plans:PLANS,charges:0});
   if(operation==='scim') {
     requireRole(org.role,['owner']);
     return json({error:'SCIM provisioning is not implemented. Do not configure an identity provider against this endpoint.'},501);
   }
   if(operation==='audit' && request.method==='GET') {
     requireRole(org.role,['owner']);
     const result=await env.DB.prepare('SELECT action,revision,created_at FROM audit_events WHERE organization_id=? ORDER BY created_at DESC LIMIT 100').bind(id).all();
     return json({items:result.results});
   }
   if(!['POST','PUT'].includes(request.method)) throw new ApiError(405,'Method not allowed');
   requireRole(org.role,operation==='billing'?['owner']:['owner','editor']);
   const input=await body(request);
   if(operation==='import-preview') {
     return json(importPreview(input,state,org.plan));
   }
   revision(input,org);
   if(operation==='state') {
     const next=validateState(input.state,org.plan);
     const preview=importPreview(next,{},org.plan);
     if(preview.attachmentIds.length) throw new ApiError(422,'Binary attachment support is not yet connected to R2');
     return save(env,org,actor,{state:next},'state.update');
   }
   if(operation==='import') {
     const preview=importPreview(input.state,state,org.plan);
     if(KINDS.some(k=>state[k].length) || !preview.canApply) throw new ApiError(409,'Import requires an empty workspace and no unresolved attachments; inspect import-preview');
     return save(env,org,actor,{state:preview.state},'legacy.import');
   }
   if(operation==='customization') {
     return save(env,org,actor,{customization:validateCustomization(input.customization,org.plan)},'customization.update');
   }
   if(operation==='billing') {
     if(env.MOCK_BILLING!=='true') throw new ApiError(403,'Billing simulation is disabled');
     if(!Object.hasOwn(PLANS,input.plan)) throw new ApiError(422,'Unknown plan');
     validateState(state,input.plan); // Never delete data on downgrade.
     if(!PLANS[input.plan].customization && Object.keys(JSON.parse(org.customization_json)).length) throw new ApiError(409,'Reset paid customization before downgrade');
     return save(env,org,actor,{plan:input.plan},'billing.mock-plan-change');
   }
   throw new ApiError(404,'Not found');
  } catch(error) {
   if(error instanceof ApiError) return json({error:error.message},error.status);
   return json({error:'Internal server error'},500);
  }
 }
};
