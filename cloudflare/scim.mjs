const USER='urn:ietf:params:scim:schemas:core:2.0:User';
const ERROR='urn:ietf:params:scim:api:messages:2.0:Error';
const LIST='urn:ietf:params:scim:api:messages:2.0:ListResponse';
const PATCH='urn:ietf:params:scim:api:messages:2.0:PatchOp';
class ScimError extends Error { constructor(status,detail,type){super(detail);this.status=status;this.type=type;} }
const bad=(detail,type='invalidValue')=>{throw new ScimError(400,detail,type);};
function response(value,status=200,headers={}){return new Response(status===204?null:JSON.stringify(value),{status,headers:{'content-type':'application/scim+json','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});}
async function digest(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function authorize(request,env){
 if(!env.DB || !/^[a-f0-9]{64}$/i.test(env.SCIM_TOKEN_HASH??'') || !env.SCIM_ORGANIZATION_ID || !env.AUTH_ISSUER || env.AUTH_ISSUER.includes('REPLACE_')) throw new ScimError(503,'SCIM is disabled');
 if(!env.AUTH_ISSUER.startsWith('https://'))throw new ScimError(503,'SCIM identity issuer must use HTTPS');
 const token=request.headers.get('authorization')?.match(/^Bearer ([^ ]{32,4096})$/)?.[1];
 if(!token)throw new ScimError(401,'SCIM bearer token required');
 const actual=await digest(token),expected=env.SCIM_TOKEN_HASH.toLowerCase();let mismatch=0;
 for(let i=0;i<64;i++)mismatch|=actual.charCodeAt(i)^expected.charCodeAt(i);
 if(mismatch)throw new ScimError(401,'Invalid SCIM token');
 if(!await env.DB.prepare('SELECT id FROM organizations WHERE id=?').bind(env.SCIM_ORGANIZATION_ID).first())throw new ScimError(503,'SCIM organization is unavailable');
}
async function body(request){
 if(!/^(application\/scim\+json|application\/json)(;|$)/i.test(request.headers.get('content-type')??''))throw new ScimError(415,'SCIM JSON required');
 const reader=request.body?.getReader();if(!reader)bad('Body required');
 const chunks=[];let length=0;
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>32768){await reader.cancel();throw new ScimError(413,'Resource too large');}chunks.push(value);}
 const bytes=new Uint8Array(length);let i=0;for(const c of chunks){bytes.set(c,i);i+=c.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{bad('Malformed JSON','invalidSyntax');}
}
function text(value,name,max=255){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f]/.test(value))bad('Invalid '+name);return value.trim();}
function exactSubject(value){text(value,'externalId');if(value!==value.trim())bad('externalId must match OIDC sub exactly; surrounding whitespace is not allowed');return value;}
function shape(input){
 if(!input || typeof input!=='object'||Array.isArray(input))bad('Resource must be an object');
 if(!Array.isArray(input.schemas)||input.schemas.length!==1||input.schemas[0]!==USER)bad('Only core User schema is supported');
 const allowed=['schemas','externalId','userName','displayName','active'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))bad('Unsupported User attribute');
 const result={externalId:exactSubject(input.externalId),userName:text(input.userName,'userName'),displayName:input.displayName===undefined?'':text(input.displayName,'displayName'),active:input.active??true};
 if(typeof result.active!=='boolean')bad('active must be boolean');return result;
}
function resource(row,base){return {schemas:[USER],id:row.id,externalId:row.external_id,userName:row.user_name,displayName:row.display_name,active:!!row.active,meta:{resourceType:'User',created:row.created_at,lastModified:row.updated_at,version:'W/"'+row.version+'"',location:base+'/Users/'+row.id}};}
function list(items,total,start=1){return {schemas:[LIST],totalResults:total,startIndex:start,itemsPerPage:items.length,Resources:items};}
const attrs=[
 {name:'userName',type:'string',multiValued:false,required:true,caseExact:false,mutability:'readWrite',returned:'default',uniqueness:'server'},
 {name:'displayName',type:'string',multiValued:false,required:false,caseExact:false,mutability:'readWrite',returned:'default',uniqueness:'none'},
 {name:'active',type:'boolean',multiValued:false,required:false,mutability:'readWrite',returned:'default',uniqueness:'none'},
 {name:'externalId',type:'string',multiValued:false,required:true,caseExact:true,mutability:'immutable',returned:'default',uniqueness:'server'}
];
async function managed(env,id,includeDeleted=false){
 const row=await env.DB.prepare('SELECT s.*,m.role FROM scim_users s JOIN memberships m ON m.organization_id=s.organization_id AND m.user_id=s.user_id WHERE s.organization_id=? AND s.id=?').bind(env.SCIM_ORGANIZATION_ID,id).first();
 if(!row || (row.deleted && !includeDeleted))throw new ScimError(404,'User not found');
 return row;
}
function editable(row){if(row.role!=='viewer')throw new ScimError(403,'SCIM may only manage its provisioned viewer memberships; owner/editor changes are forbidden');}
function event(env,id,action,when){return env.DB.prepare('INSERT INTO scim_events(id,organization_id,resource_id,action,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),env.SCIM_ORGANIZATION_ID,id,action,when);}
export async function handleScim(request,env){
 try{
 await authorize(request,env);
 const url=new URL(request.url),base=url.origin+'/scim/v2',path=url.pathname.slice('/scim/v2'.length)||'/';
 const origin=request.headers.get('origin');if(origin&&origin!==url.origin)throw new ScimError(403,'Cross-origin requests not allowed');
 if(path==='/ServiceProviderConfig'&&request.method==='GET')return response({schemas:['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],patch:{supported:true},bulk:{supported:false,maxOperations:0,maxPayloadSize:0},filter:{supported:true,maxResults:100},changePassword:{supported:false},sort:{supported:false},etag:{supported:true},authenticationSchemes:[{type:'oauthbearertoken',name:'Scoped static bearer',description:'Separate SCIM token, restricted to one organization',specUri:'https://www.rfc-editor.org/rfc/rfc6750',primary:true}]});
 const schema={schemas:['urn:ietf:params:scim:schemas:core:2.0:Schema'],id:USER,name:'User',description:'Core User subset. externalId MUST be the exact OIDC sub from the configured issuer.',attributes:attrs};
 const rt={schemas:['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],id:'User',name:'User',endpoint:'/Users',schema:USER};
 if(path==='/Schemas'&&request.method==='GET')return response(list([schema],1));
 if(path==='/Schemas/'+USER&&request.method==='GET')return response(schema);
 if(path==='/ResourceTypes'&&request.method==='GET')return response(list([rt],1));
 if(path==='/ResourceTypes/User'&&request.method==='GET')return response(rt);
 if(path.startsWith('/Groups'))throw new ScimError(501,'Groups provisioning is not supported');
 if(path==='/Users'&&request.method==='GET'){
  const start=Number(url.searchParams.get('startIndex')??1),count=Number(url.searchParams.get('count')??100);
  if(!Number.isSafeInteger(start)||start<1||!Number.isSafeInteger(count)||count<0||count>100)bad('startIndex >= 1 and count 0..100 are required');
  const filter=url.searchParams.get('filter');let suffix=' AND deleted=0',args=[env.SCIM_ORGANIZATION_ID];
  if(filter){const m=filter.match(/^userName eq ("(?:[^"\\]|\\.)*")$/);if(!m)bad('Only userName eq "value" is supported','invalidFilter');let value;try{value=JSON.parse(m[1]);}catch{bad('Invalid filter','invalidFilter');}suffix+=' AND username_key=?';args.push(text(value,'filter userName').toLowerCase());}
  const total=await env.DB.prepare('SELECT count(*) AS n FROM scim_users WHERE organization_id=?'+suffix).bind(...args).first();
  const rows=await env.DB.prepare('SELECT * FROM scim_users WHERE organization_id=?'+suffix+' ORDER BY id LIMIT ? OFFSET ?').bind(...args,count,start-1).all();
  return response(list(rows.results.map(r=>resource(r,base)),total.n,start));
 }
 if(path==='/Users'&&request.method==='POST'){
  const input=shape(await body(request)),org=env.SCIM_ORGANIZATION_ID;
  const existing=await env.DB.prepare('SELECT id FROM scim_users WHERE organization_id=? AND external_id=?').bind(org,input.externalId).first();
  if(existing){const row=await managed(env,existing.id,true);editable(row);
    if(row.deleted){
      const when=new Date().toISOString();
      try{await env.DB.batch([
        env.DB.prepare("INSERT INTO scim_guard(value) SELECT CASE WHEN EXISTS (SELECT 1 FROM scim_users s JOIN memberships m ON m.organization_id=s.organization_id AND m.user_id=s.user_id WHERE s.id=? AND s.organization_id=? AND s.version=? AND s.deleted=1 AND m.role='viewer') THEN 1 ELSE NULL END").bind(row.id,org,row.version),
        env.DB.prepare('UPDATE scim_users SET user_name=?,username_key=?,display_name=?,active=?,deleted=0,version=version+1,updated_at=? WHERE id=? AND organization_id=?').bind(input.userName,input.userName.toLowerCase(),input.displayName,input.active?1:0,when,row.id,org),
        env.DB.prepare("UPDATE memberships SET active=? WHERE organization_id=? AND user_id=? AND role='viewer'").bind(input.active?1:0,org,row.user_id),
        event(env,row.id,'user.reprovision',when),
        env.DB.prepare('DELETE FROM scim_guard')
      ]);}catch{throw new ScimError(409,'Concurrent modification or duplicate userName','uniqueness');}
      return response(resource(await managed(env,row.id),base),201,{location:base+'/Users/'+row.id});
    }
    if(row.user_name!==input.userName||row.display_name!==input.displayName||!!row.active!==input.active)throw new ScimError(409,'externalId exists; use PATCH','uniqueness');return response(resource(row,base),200);
  }
  const user=await digest(JSON.stringify([env.AUTH_ISSUER,input.externalId]));
  const member=await env.DB.prepare('SELECT role FROM memberships WHERE organization_id=? AND user_id=?').bind(org,user).first();
  if(member)throw new ScimError(409,'Existing membership cannot be adopted by SCIM','uniqueness');
  const id=crypto.randomUUID(),when=new Date().toISOString();
  try{await env.DB.batch([
   env.DB.prepare('INSERT OR IGNORE INTO users(id,issuer,subject,created_at) VALUES(?,?,?,?)').bind(user,env.AUTH_ISSUER,input.externalId,when),
   env.DB.prepare("INSERT INTO memberships(organization_id,user_id,role,active) VALUES(?,?,'viewer',?)").bind(org,user,input.active?1:0),
   env.DB.prepare('INSERT INTO scim_users(id,organization_id,user_id,external_id,user_name,username_key,display_name,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,org,user,input.externalId,input.userName,input.userName.toLowerCase(),input.displayName,input.active?1:0,when,when),
   event(env,id,'user.provision',when)
  ]);}catch{throw new ScimError(409,'User or membership already exists','uniqueness');}
  return response(resource(await managed(env,id),base),201,{location:base+'/Users/'+id});
 }
 const match=path.match(/^\/Users\/([a-zA-Z0-9-]{1,80})$/);
 if(!match)throw new ScimError(404,'Resource not found');
 const row=await managed(env,match[1]);
 if(request.method==='GET')return response(resource(row,base),200,{etag:'W/"'+row.version+'"'});
 if(!['PATCH','DELETE'].includes(request.method))throw new ScimError(405,'Method not allowed');
 editable(row);
 if(request.headers.has('if-match')&&request.headers.get('if-match')!=='W/"'+row.version+'"')throw new ScimError(412,'Version mismatch');
 const values={userName:row.user_name,displayName:row.display_name,active:!!row.active};
 if(request.method==='DELETE')values.active=false;
 else{
  const input=await body(request);
  if(!Array.isArray(input.schemas)||input.schemas.length!==1||input.schemas[0]!==PATCH||!Array.isArray(input.Operations)||input.Operations.length<1||input.Operations.length>20)bad('Invalid PatchOp');
  for(const op of input.Operations){
   if(!op||!['replace','add'].includes(String(op.op).toLowerCase()))bad('Only add/replace are supported','mutability');
   const changes=op.path?{[op.path]:op.value}:op.value;
   if(!changes||typeof changes!=='object'||Array.isArray(changes))bad('Invalid patch value');
   for(const [key,val] of Object.entries(changes)){
    if(!['active','displayName','userName'].includes(key))bad('Attribute is immutable or unsupported','mutability');
    if(key==='active'){if(typeof val!=='boolean')bad('active must be boolean');values.active=val;}else values[key]=text(val,key);
   }
  }
 }
 // Update uses a transactional version guard. A conflict causes the entire batch to rollback.
 // The guard is an INSERT with a NOT NULL violation if state/role changed concurrently.
 const when=new Date().toISOString();
 try{
 const result=await env.DB.batch([
 env.DB.prepare("INSERT INTO scim_guard(value) SELECT CASE WHEN EXISTS (SELECT 1 FROM scim_users s JOIN memberships m ON m.organization_id=s.organization_id AND m.user_id=s.user_id WHERE s.id=? AND s.organization_id=? AND s.version=? AND m.role='viewer') THEN 1 ELSE NULL END").bind(row.id,env.SCIM_ORGANIZATION_ID,row.version),
 env.DB.prepare('UPDATE scim_users SET user_name=?,username_key=?,display_name=?,active=?,deleted=?,version=version+1,updated_at=? WHERE id=? AND organization_id=?').bind(values.userName,values.userName.toLowerCase(),values.displayName,values.active?1:0,request.method==='DELETE'?1:0,when,row.id,env.SCIM_ORGANIZATION_ID),
 env.DB.prepare("UPDATE memberships SET active=? WHERE organization_id=? AND user_id=? AND role='viewer'").bind(values.active?1:0,env.SCIM_ORGANIZATION_ID,row.user_id),
 event(env,row.id,request.method==='DELETE'?'user.delete':values.active?'user.update-or-reactivate':'user.deactivate',when),
 env.DB.prepare('DELETE FROM scim_guard')
 ]);
 }catch{throw new ScimError(409,'Concurrent modification or duplicate userName; reload before retrying','uniqueness');}
 return request.method==='DELETE'?response(null,204):response(resource(await managed(env,row.id),base));
 }catch(error){return response({schemas:[ERROR],status:String(error.status??500),detail:error instanceof ScimError?error.message:'SCIM internal error',...(error.type?{scimType:error.type}:{})},error.status??500);}
}
