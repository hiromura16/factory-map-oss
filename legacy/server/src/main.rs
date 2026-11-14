// 旧Rust / PostgreSQL版のAPI。現行SaaSは cloudflare/ を使います。
// 設定・配信物・デモ資料はリポジトリのルート基準で読み込みます。
use axum::{body::Body,extract::{State,Path,Query,Multipart,DefaultBodyLimit,ConnectInfo,Request},http::{StatusCode,HeaderMap,HeaderValue,Method},response::{Response,IntoResponse},routing::{get,post,put,delete},middleware::{self,Next},Json,Router};
use serde::Deserialize;
use serde_json::{Value,json};
use sqlx::{PgPool,Postgres,Transaction,Row,postgres::PgPoolOptions};
use argon2::{Argon2,PasswordHasher,PasswordVerifier,PasswordHash,password_hash::SaltString};
use rand_core::{OsRng,RngCore};
use sha2::{Sha256,Digest};
use std::{collections::{HashMap,HashSet},sync::{Arc,Mutex},path::PathBuf,net::SocketAddr,time::{SystemTime,UNIX_EPOCH},os::unix::fs::OpenOptionsExt,io::Write};
use uuid::Uuid;
use image::ImageDecoder;

#[derive(Clone)] struct App { pool:PgPool, root:PathBuf, attempts:Arc<Mutex<HashMap<String,(u32,u64)>>>, thumbnail_slots:Arc<tokio::sync::Semaphore> }
#[derive(Debug)] struct Error(StatusCode,String);
impl std::fmt::Display for Error { fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result{write!(f,"{}",self.1)} }
impl std::error::Error for Error {}
type Result<T> = std::result::Result<T,Error>;
impl IntoResponse for Error { fn into_response(self)->Response {(self.0,Json(json!({"error":self.1}))).into_response()} }
impl From<sqlx::Error> for Error { fn from(e:sqlx::Error)->Self {eprintln!("Database error: {e}");Self(StatusCode::INTERNAL_SERVER_ERROR,"データベース操作を完了できませんでした。".into())} }
fn bad(s:impl Into<String>)->Error{Error(StatusCode::UNPROCESSABLE_ENTITY,s.into())}
fn missing()->Error{Error(StatusCode::NOT_FOUND,"対象が見つかりません。".into())}
fn now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()}
fn random()->String{let mut b=[0u8;32];OsRng.fill_bytes(&mut b);b.iter().map(|v|format!("{v:02x}")).collect()}
fn hash(s:&str)->String{format!("{:x}",Sha256::digest(s.as_bytes()))}
fn session_token(h:&HeaderMap)->Option<String>{h.get("cookie")?.to_str().ok()?.split(';').find_map(|p|p.trim().strip_prefix("factory_session=").map(str::to_owned))}
async fn is_editor(a:&App,h:&HeaderMap)->bool{
 if let Some(token)=h.get("authorization").and_then(|v|v.to_str().ok()).and_then(|s|s.strip_prefix("Bearer ")) {
  return sqlx::query_scalar::<_,i64>("SELECT count(*) FROM api_tokens WHERE token_hash=$1 AND scope='editor' AND expires_at>now()").bind(hash(token)).fetch_one(&a.pool).await.unwrap_or(0)>0;
 }
 if let Some(token)=session_token(h){return sqlx::query_scalar::<_,i64>("SELECT count(*) FROM sessions WHERE token_hash=$1 AND expires_at>now()").bind(hash(&token)).fetch_one(&a.pool).await.unwrap_or(0)>0;}false
}
async fn can_view_facilities(a:&App,h:&HeaderMap)->bool {
 if let Some(token)=h.get("authorization").and_then(|v|v.to_str().ok()).and_then(|s|s.strip_prefix("Bearer ")) {
  return sqlx::query_scalar::<_,i64>("SELECT count(*) FROM api_tokens WHERE token_hash=$1 AND scope IN ('editor','viewer') AND expires_at>now()")
   .bind(hash(token)).fetch_one(&a.pool).await.unwrap_or(0)>0;
 }
 if let Some(token)=session_token(h) {
  return sqlx::query_scalar::<_,i64>("SELECT count(*) FROM sessions WHERE token_hash=$1 AND expires_at>now()")
   .bind(hash(&token)).fetch_one(&a.pool).await.unwrap_or(0)>0;
 }
 false
}
async fn require_facilities(a:&App,h:&HeaderMap)->Result<()> {
 if can_view_facilities(a,h).await {Ok(())} else {Err(Error(StatusCode::UNAUTHORIZED,"設備情報の閲覧には施設グループのログインが必要です。".into()))}
}
async fn require_editor(a:&App,h:&HeaderMap)->Result<()>{if is_editor(a,h).await{Ok(())}else{Err(Error(StatusCode::UNAUTHORIZED,"施設グループのパスワードでログインしてください。".into()))}}
async fn guard(req:Request,next:Next)->Response{
 if !matches!(*req.method(),Method::GET|Method::HEAD|Method::OPTIONS) {
  if req.headers().get("sec-fetch-site").and_then(|v|v.to_str().ok())==Some("cross-site"){return Error(StatusCode::FORBIDDEN,"別サイトからの更新は許可されていません。".into()).into_response();}
  if let Some(origin)=req.headers().get("origin").and_then(|v|v.to_str().ok()){
   let host=req.headers().get("host").and_then(|v|v.to_str().ok()).unwrap_or("");
   let valid=url::Url::parse(origin).ok().map(|u|{let authority=match u.port(){Some(p)=>format!("{}:{p}",u.host_str().unwrap_or("")),None=>u.host_str().unwrap_or("").to_owned()};authority.eq_ignore_ascii_case(host)}).unwrap_or(false);
   if !valid{return Error(StatusCode::FORBIDDEN,"リクエスト元を確認できませんでした。".into()).into_response();}
  }
 }
 let mut response=next.run(req).await;
 response.headers_mut().insert("x-content-type-options",HeaderValue::from_static("nosniff"));
 response.headers_mut().insert("referrer-policy",HeaderValue::from_static("same-origin"));
 response.headers_mut().insert("cache-control",HeaderValue::from_static("no-store"));
 response
}
#[derive(Deserialize)]struct Login {password:String}
async fn auth_status(State(a):State<App>,h:HeaderMap)->Json<Value>{Json(json!({"editor":is_editor(&a,&h).await,"expiresInSeconds":28800}))}
async fn login(State(a):State<App>,ConnectInfo(peer):ConnectInfo<SocketAddr>,h:HeaderMap,Json(input):Json<Login>)->Result<Response>{
 let key=peer.ip().to_string();{
  let mut attempts=a.attempts.lock().unwrap();let entry=attempts.entry(key.clone()).or_insert((0,now()));if now()-entry.1>900{*entry=(0,now());}if entry.0>=8{return Err(Error(StatusCode::TOO_MANY_REQUESTS,"入力回数の上限です。15分後に再試行してください。".into()));}entry.0+=1;
 }
 if input.password.len()>256{return Err(bad("パスワードが長すぎます。"));}
 let encoded=sqlx::query_scalar::<_,String>("SELECT value FROM settings WHERE key='admin_password_hash'").fetch_one(&a.pool).await?;
 let valid=tokio::task::spawn_blocking(move||PasswordHash::new(&encoded).ok().map(|p|Argon2::default().verify_password(input.password.as_bytes(),&p).is_ok()).unwrap_or(false)).await.unwrap_or(false);
 if !valid{return Err(Error(StatusCode::UNAUTHORIZED,"パスワードが違います。".into()));}
 a.attempts.lock().unwrap().remove(&key);
 let token=random();sqlx::query("INSERT INTO sessions(token_hash,expires_at) VALUES($1,now()+interval '8 hours')").bind(hash(&token)).execute(&a.pool).await?;
 sqlx::query("DELETE FROM sessions WHERE expires_at<now()").execute(&a.pool).await?;
 let secure=if h.get("x-forwarded-proto").and_then(|v|v.to_str().ok())==Some("https"){"; Secure"}else{""};
 let mut r=Json(json!({"editor":true})).into_response();r.headers_mut().insert("set-cookie",HeaderValue::from_str(&format!("factory_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800{secure}")).unwrap());Ok(r)
}
async fn logout(State(a):State<App>,h:HeaderMap)->Result<Response>{if let Some(t)=session_token(&h){sqlx::query("DELETE FROM sessions WHERE token_hash=$1").bind(hash(&t)).execute(&a.pool).await?;}let mut r=Json(json!({"editor":false})).into_response();r.headers_mut().insert("set-cookie",HeaderValue::from_static("factory_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"));Ok(r)}
#[derive(Deserialize)]#[serde(rename_all="camelCase")]struct PasswordChange{current_password:String,new_password:String}
async fn password_change(State(a):State<App>,h:HeaderMap,Json(input):Json<PasswordChange>)->Result<Json<Value>>{
 require_editor(&a,&h).await?;if input.new_password.chars().count()<10||input.new_password.len()>256{return Err(bad("新しいパスワードは10文字以上、256バイト以下にしてください。"));}
 let old=sqlx::query_scalar::<_,String>("SELECT value FROM settings WHERE key='admin_password_hash'").fetch_one(&a.pool).await?;
 let encoded=tokio::task::spawn_blocking(move||{let p=PasswordHash::new(&old).map_err(|_|())?;Argon2::default().verify_password(input.current_password.as_bytes(),&p).map_err(|_|())?;Argon2::default().hash_password(input.new_password.as_bytes(),&SaltString::generate(&mut OsRng)).map(|h|h.to_string()).map_err(|_|())}).await.unwrap().map_err(|_|Error(StatusCode::UNAUTHORIZED,"現在のパスワードが違います。".into()))?;
 let mut tx=a.pool.begin().await?;sqlx::query("UPDATE settings SET value=$1 WHERE key='admin_password_hash'").bind(encoded).execute(&mut *tx).await?;sqlx::query("DELETE FROM sessions WHERE token_hash<>$1").bind(hash(&session_token(&h).unwrap_or_default())).execute(&mut *tx).await?;tx.commit().await?;Ok(Json(json!({"ok":true})))
}
async fn load(tx:&mut Transaction<'_,Postgres>)->Result<Value>{
 let mut value=json!({"version":2});
 for (key,table) in [("drawings","drawings"),("works","works"),("assets","assets"),("propertyDefinitions","property_definitions"),("notes","notes")]{let rows=sqlx::query_scalar::<_,Value>(&format!("SELECT data FROM {table} ORDER BY id")).fetch_all(&mut **tx).await?;value[key]=json!(rows);}Ok(value)
}
async fn read_snapshot(a:&App)->Result<(i64,Value)>{let mut tx=a.pool.begin().await?;sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY").execute(&mut *tx).await?;let revision=sqlx::query_scalar::<_,i64>("SELECT revision FROM app_revision WHERE id=1").fetch_one(&mut *tx).await?;let state=load(&mut tx).await?;tx.commit().await?;Ok((revision,state))}
fn announcements_only(mut state:Value)->Value {
 let mut drawings:HashSet<String>=HashSet::from(["site".into()]);
 for record in items(&state,"works").iter().chain(items(&state,"notes")) {
  drawings.insert(field(record,"drawingId").into());
 }
 state["drawings"].as_array_mut().unwrap().retain(|d|drawings.contains(field(d,"id")));
 state["assets"]=json!([]);state["propertyDefinitions"]=json!([]);
 for work in state["works"].as_array_mut().unwrap(){work["assetIds"]=json!([]);}
 state
}
async fn visible_snapshot(a:&App,h:&HeaderMap)->Result<(i64,Value)> {
 let (revision,state)=read_snapshot(a).await?;
 Ok((revision,if can_view_facilities(a,h).await {state}else{announcements_only(state)}))
}
fn field<'a>(v:&'a Value,key:&str)->&'a str{v.get(key).and_then(Value::as_str).unwrap_or("")}
fn items<'a>(v:&'a Value,key:&str)->&'a [Value]{v.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])}
fn date(s:&str)->bool{let p:Vec<_>=s.split('-').collect();if p.len()!=3||p[0].len()!=4||p[1].len()!=2||p[2].len()!=2{return false;}let (Ok(y),Ok(m),Ok(d))=(p[0].parse::<i32>(),p[1].parse::<u32>(),p[2].parse::<u32>())else{return false;};let days=match m{1|3|5|7|8|10|12=>31,4|6|9|11=>30,2=>if y%4==0&&(y%100!=0||y%400==0){29}else{28},_=>0};y>0&&d>0&&d<=days}
fn xy(v:&Value)->bool{v.as_array().map(|p|p.len()==2&&p.iter().all(|x|x.as_f64().map(|f|f.is_finite()&&f.abs()<1e12).unwrap_or(false))).unwrap_or(false)}
fn empty(v:&Value)->bool{v.is_null()||v.as_str()==Some("")||v.as_array().map(Vec::is_empty).unwrap_or(false)}
fn property_valid(def:&Value,v:&Value)->bool{if empty(v){return !def.get("required").and_then(Value::as_bool).unwrap_or(false);}match field(def,"type"){
 "text"=>v.as_str().map(|s|s.len()<=10000).unwrap_or(false),"number"=>v.as_f64().map(f64::is_finite).unwrap_or(false),"date"=>v.as_str().map(date).unwrap_or(false),"checkbox"=>v.is_boolean(),"url"=>v.as_str().and_then(|s|url::Url::parse(s).ok()).map(|u|matches!(u.scheme(),"http"|"https")).unwrap_or(false),
 "select"=>v.as_str().map(|id|items(def,"options").iter().any(|o|field(o,"id")==id)).unwrap_or(false),
 "multiselect"=>v.as_array().map(|values|values.iter().all(|v|v.as_str().map(|id|items(def,"options").iter().any(|o|field(o,"id")==id)).unwrap_or(false))).unwrap_or(false),_=>false}}
fn collect_files(v:&Value,out:&mut HashSet<String>){if let Some(o)=v.as_object(){for (k,v) in o{if k=="attachments"{for item in v.as_array().into_iter().flatten(){if let Some(id)=item.get("fileId").and_then(Value::as_str){out.insert(id.into());}}}else{collect_files(v,out);}}}else if let Some(a)=v.as_array(){for x in a{collect_files(x,out);}}}
fn validate(s:&Value)->Result<()>{
 for key in ["drawings","works","assets","propertyDefinitions","notes"]{let a=s.get(key).and_then(Value::as_array).ok_or_else(||bad(format!("{key}は配列が必要です。")))?;if a.len()>20000{return Err(bad("登録件数の上限を超えています。"));}let mut ids=HashSet::new();for r in a{let id=field(r,"id");if id.is_empty()||id.len()>100||!ids.insert(id){return Err(bad(format!("{key}のIDが空または重複しています。")));}}}
 let drawing_ids:HashSet<_>=items(s,"drawings").iter().map(|x|field(x,"id")).collect();let asset_ids:HashSet<_>=items(s,"assets").iter().map(|x|field(x,"id")).collect();
 for note in items(s,"notes") {
  let text=field(note,"text");
  if text.trim().is_empty()||text.chars().count()>2000{return Err(bad("付箋のテキストは1〜2000文字で入力してください。"));}
  if !drawing_ids.contains(field(note,"drawingId"))||!xy(&note["point"]){return Err(bad("付箋の図面・位置が正しくありません。"));}
  if let Some(value)=note.get("color") {
   let color=value.as_str().unwrap_or("");
   if color.len()!=7||!color.starts_with('#')||!color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit){return Err(bad("付箋の色は#RRGGBB形式で指定してください。"));}
  }
  if let Some(value)=note.get("size") {
   if !value.as_u64().is_some_and(|n|(1..=300).contains(&n)){return Err(bad("付箋のサイズは1〜300%の整数で指定してください。"));}
  }
  for key in ["width","height"] {
   if let Some(value)=note.get(key) {
    if !value.as_f64().is_some_and(|n|n.is_finite()&&(40.0..=100000.0).contains(&n)){return Err(bad("付箋の幅・高さは40〜100000の数値で指定してください。"));}
   }
  }
  if let Some(value)=note.get("fontFamily") {if !["sans","serif","mono"].contains(&value.as_str().unwrap_or("")){return Err(bad("付箋のフォントを確認してください。"));}}
  if let Some(value)=note.get("fontSize") {if !value.as_u64().is_some_and(|n|(6..=120).contains(&n)){return Err(bad("文字サイズは6〜120の整数で指定してください。"));}}
  if let Some(value)=note.get("fontColor") {if !value.is_null(){let color=value.as_str().unwrap_or("");if color.len()!=7||!color.starts_with('#')||!color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit){return Err(bad("文字色は#RRGGBB形式で指定してください。"));}}}
  if let Some(value)=note.get("referenceZoom") {
   if !value.as_f64().is_some_and(|n|n.is_finite()&&(-12.0..=8.0).contains(&n)){return Err(bad("付箋の基準ズームが正しくありません。"));}
  }
 }
 let defs=items(s,"propertyDefinitions");let mut names=HashSet::new();
 for d in defs{if field(d,"name").trim().is_empty()||field(d,"name").len()>240||!names.insert(field(d,"name")){return Err(bad("プロパティ名は空または重複にできません。"));}if !["text","number","date","checkbox","url","select","multiselect"].contains(&field(d,"type")){return Err(bad("未対応のプロパティ型です。"));}let mut options=HashSet::new();for o in items(d,"options"){if field(o,"id").is_empty()||field(o,"label").trim().is_empty()||!options.insert(field(o,"id")){return Err(bad("選択肢のID・表示名を確認してください。"));}}}
 let mut codes=HashSet::new();
 for a in items(s,"assets"){
  validate_media(a)?;
  if let Some(icon)=a.get("icon") {if !["auto","generic","aircon","fan","pipe","valve","pump","electric","water","fire","boiler","compressor","chiller","building","crane","safety","drain"].contains(&icon.as_str().unwrap_or("")){return Err(bad("設備アイコンを確認してください。"));}}
  if let Some(locks)=a.get("locks") {let values=locks.as_object().ok_or_else(||bad("設備のロック設定が正しくありません。"))?;if values.iter().any(|(key,value)|!["position","attributes"].contains(&key.as_str())||!value.is_boolean()){return Err(bad("設備のロックは位置・属性ごとにtrue/falseで指定してください。"));}}

  if field(a,"name").trim().is_empty()||field(a,"code").trim().is_empty()||!codes.insert(field(a,"code")){return Err(bad("設備名・設備IDを確認してください。設備IDは重複できません。"));}
  if !drawing_ids.contains(field(a,"drawingId"))||!xy(&a["point"]){return Err(bad("設備の図面・位置が正しくありません。"));}
  let properties=a.get("properties").and_then(Value::as_object).ok_or_else(||bad("設備のプロパティはオブジェクトが必要です。"))?;
  for key in properties.keys(){if !defs.iter().any(|d|field(d,"id")==key){return Err(bad(format!("未定義のプロパティです: {key}")));}}
  for def in defs{let value=properties.get(field(def,"id")).unwrap_or(&Value::Null);if !property_valid(def,value){return Err(bad(format!("設備「{}」のプロパティ「{}」の値が型と一致しません。",field(a,"name"),field(def,"name"))));}}
  let mut hids=HashSet::new();for h in items(a,"history"){if !date(field(h,"date"))||field(h,"text").trim().is_empty()||field(h,"id").is_empty()||!hids.insert(field(h,"id")){return Err(bad("点検・保守履歴の日付・内容・IDを確認してください。"));}let next=field(h,"nextDate");if !next.is_empty()&&!date(next){return Err(bad("次回点検日の形式が正しくありません。"));}}
 }
 for w in items(s,"works"){validate_media(w)?;if field(w,"title").trim().is_empty()||!date(field(w,"start"))||!date(field(w,"end"))||field(w,"end")<field(w,"start"){return Err(bad("工事名と期間を確認してください。"));}if !["active","planned","done"].contains(&field(w,"status"))||!drawing_ids.contains(field(w,"drawingId")){return Err(bad("工事の状態・図面が正しくありません。"));}let points=items(w,"points");if points.len()<3||points.len()>10000||!points.iter().all(xy){return Err(bad("工事範囲は3点以上の有効な座標が必要です。"));}if items(w,"assetIds").iter().any(|id|!id.as_str().map(|id|asset_ids.contains(id)).unwrap_or(false)){return Err(bad("関連設備が見つかりません。"));}}
 Ok(())
}
fn same_value(a:&Value,b:&Value)->bool {
 match (a,b) {
  (Value::Number(_),Value::Number(_))=>a.as_f64()==b.as_f64(),
  (Value::Array(a),Value::Array(b))=>a.len()==b.len()&&a.iter().zip(b).all(|(a,b)|same_value(a,b)),
  (Value::Object(a),Value::Object(b))=>a.len()==b.len()&&a.iter().all(|(key,value)|b.get(key).is_some_and(|other|same_value(value,other))),
  _=>a==b
 }
}
fn locked(asset:&Value,key:&str)->bool {asset["locks"][key].as_bool().unwrap_or(false)}
fn enforce_locks(previous:&Value,next:&Value)->Result<()> {
 for old in items(previous,"assets") {
  let position=locked(old,"position");let attributes=locked(old,"attributes");
  if !position&&!attributes{continue;}
  let new=items(next,"assets").iter().find(|item|field(item,"id")==field(old,"id"));
  let Some(new)=new else{return Err(Error(StatusCode::LOCKED,format!("設備「{}」のロックを解除してから削除してください。",field(old,"name"))));};
  if position&&["point","drawingId"].iter().any(|key|!same_value(&old[*key],&new[*key])) {
   return Err(Error(StatusCode::LOCKED,format!("設備「{}」は位置がロックされています。先に位置ロックを解除してください。",field(old,"name"))));
  }
  if attributes&&["name","code","location","icon","properties","attachments","coverPhotoId"].iter().any(|key|!same_value(&old[*key],&new[*key])) {
   return Err(Error(StatusCode::LOCKED,format!("設備「{}」は属性がロックされています。先に属性ロックを解除してください。",field(old,"name"))));
  }
 }
 Ok(())
}
fn validate_media(record:&Value)->Result<()> {
 if let Some(value)=record.get("coverPhotoId") {
  let id=value.as_str().ok_or_else(||bad("代表写真のIDを確認してください。"))?;
  if !id.is_empty()&&!items(record,"attachments").iter().any(|file|field(file,"fileId")==id&&["image/jpeg","image/png","image/gif","image/webp"].contains(&field(file,"mime"))) {
   return Err(bad("代表写真は添付したJPEG・PNG・GIF・WebPの写真から選んでください。"));
  }
 }
 Ok(())
}
async fn persist(tx:&mut Transaction<'_,Postgres>,s:&Value,action:&str,detail:Value)->Result<i64>{
 let previous=load(tx).await?;enforce_locks(&previous,s)?;validate(s)?;let mut refs=HashSet::new();collect_files(s,&mut refs);if !refs.is_empty(){let ids:Vec<String>=refs.into_iter().collect();let count=sqlx::query_scalar::<_,i64>("SELECT count(*) FROM attachments WHERE id=ANY($1)").bind(&ids).fetch_one(&mut **tx).await?;if count!=ids.len() as i64{return Err(bad("添付資料の参照が正しくありません。"));}}
 for (key,table) in [("drawings","drawings"),("works","works"),("assets","assets"),("propertyDefinitions","property_definitions"),("notes","notes")]{sqlx::query(&format!("DELETE FROM {table}")).execute(&mut **tx).await?;for r in items(s,key){sqlx::query(&format!("INSERT INTO {table}(id,data) VALUES($1,$2)")).bind(field(r,"id")).bind(r).execute(&mut **tx).await?;}}
 let rev=sqlx::query_scalar::<_,i64>("UPDATE app_revision SET revision=revision+1 WHERE id=1 RETURNING revision").fetch_one(&mut **tx).await?;
 sqlx::query("INSERT INTO audit_events(action,detail) VALUES($1,$2)").bind(action).bind(detail).execute(&mut **tx).await?;Ok(rev)
}
async fn state_get(State(a):State<App>,h:HeaderMap)->Result<Json<Value>>{let(r,s)=visible_snapshot(&a,&h).await?;Ok(Json(json!({"revision":r,"state":s})))}
#[derive(Deserialize)]struct Snapshot{revision:i64,state:Value}
async fn state_put(State(a):State<App>,h:HeaderMap,Json(mut input):Json<Snapshot>)->Result<Json<Value>>{require_editor(&a,&h).await?;let mut tx=a.pool.begin().await?;let rev=sqlx::query_scalar::<_,i64>("SELECT revision FROM app_revision WHERE id=1 FOR UPDATE").fetch_one(&mut *tx).await?;if rev!=input.revision{return Err(Error(StatusCode::CONFLICT,"別の更新が先に保存されました。内容を再読み込みしてから再度保存してください。入力内容は画面に残っています。".into()));}if !input.state.is_object(){return Err(bad("stateはJSONオブジェクトが必要です。"));}let stored=load(&mut tx).await?;
 if input.state.get("notes").is_none(){input.state["notes"]=stored["notes"].clone();}
 else if let Some(notes)=input.state["notes"].as_array_mut(){
  for note in notes {
   if let Some(old)=items(&stored,"notes").iter().find(|old|field(old,"id")==field(note,"id")) {
    for key in ["color","size","referenceZoom","width","height","fontFamily","fontSize","fontColor"]{if note.get(key).is_none(){if let Some(value)=old.get(key){note[key]=value.clone();}}}
   }
  }
 }
 if let Some(assets)=input.state["assets"].as_array_mut(){for asset in assets{if let Some(old)=items(&stored,"assets").iter().find(|old|field(old,"id")==field(asset,"id")){for key in ["locks","icon","coverPhotoId"]{if asset.get(key).is_none(){if let Some(value)=old.get(key){asset[key]=value.clone();}}}}}}
 if let Some(works)=input.state["works"].as_array_mut(){for work in works{if work.get("coverPhotoId").is_none(){if let Some(value)=items(&stored,"works").iter().find(|old|field(old,"id")==field(work,"id")).and_then(|old|old.get("coverPhotoId")){work["coverPhotoId"]=value.clone();}}}}
 let r=persist(&mut tx,&input.state,"state.update",json!({"previousRevision":rev})).await?;tx.commit().await?;Ok(Json(json!({"revision":r})))}
fn kind_key(k:&str)->Result<&'static str>{match k{"works"=>Ok("works"),"assets"=>Ok("assets"),"drawings"=>Ok("drawings"),"properties"=>Ok("propertyDefinitions"),"notes"=>Ok("notes"),_=>Err(missing())}}
#[derive(Deserialize,Default)]#[serde(rename_all="camelCase")]struct Filters{q:Option<String>,drawing_id:Option<String>,status:Option<String>,from:Option<String>,to:Option<String>,limit:Option<usize>,offset:Option<usize>,property_id:Option<String>,value:Option<String>}
fn matches_filter(v:&Value,q:&Filters)->bool{
 if let Some(query)=&q.q{if !v.to_string().to_lowercase().contains(&query.to_lowercase()){return false;}}
 if let Some(id)=&q.drawing_id{if field(v,"drawingId")!=id{return false;}}
 if let Some(st)=&q.status{if field(v,"status")!=st{return false;}}
 if let Some(from)=&q.from{if !field(v,"end").is_empty()&&field(v,"end")<from.as_str(){return false;}}
 if let Some(to)=&q.to{if !field(v,"start").is_empty()&&field(v,"start")>to.as_str(){return false;}}
 if let Some(key)=&q.property_id{let value=&v["properties"][key];if value.is_null(){return false;}if let Some(expected)=&q.value{if value.as_str().map(str::to_owned).unwrap_or_else(||value.to_string())!=*expected{return false;}}}true
}
async fn list_records(State(a):State<App>,h:HeaderMap,Path(kind):Path<String>,Query(q):Query<Filters>)->Result<Json<Value>>{let key=kind_key(&kind)?;if matches!(kind.as_str(),"assets"|"properties"){require_facilities(&a,&h).await?;}let(r,s)=visible_snapshot(&a,&h).await?;let matched:Vec<_>=items(&s,key).iter().filter(|v|matches_filter(v,&q)).cloned().collect();let total=matched.len();let limit=q.limit.unwrap_or(100).min(1000);let offset=q.offset.unwrap_or(0);Ok(Json(json!({"items":matched.into_iter().skip(offset).take(limit).collect::<Vec<_>>(),"total":total,"limit":limit,"offset":offset,"revision":r})))}
async fn get_record(State(a):State<App>,h:HeaderMap,Path((kind,id)):Path<(String,String)>)->Result<Json<Value>>{let key=kind_key(&kind)?;if matches!(kind.as_str(),"assets"|"properties"){require_facilities(&a,&h).await?;}let(_,s)=visible_snapshot(&a,&h).await?;Ok(Json(items(&s,key).iter().find(|v|field(v,"id")==id).cloned().ok_or_else(missing)?))}
fn apply(s:&mut Value,kind:&str,id:Option<&str>,method:&str,mut record:Value)->Result<Value>{
 let key=kind_key(kind)?;let id=id.map(str::to_owned).unwrap_or_else(||if field(&record,"id").is_empty(){Uuid::new_v4().to_string()}else{field(&record,"id").into()});
 if method=="delete"{
  if kind=="drawings"&&(items(s,"works").iter().chain(items(s,"assets")).chain(items(s,"notes")).any(|v|field(v,"drawingId")==id)){return Err(Error(StatusCode::CONFLICT,"工事・設備・付箋がひもづいた図面は削除できません。".into()));}
  let exists=items(s,key).iter().any(|v|field(v,"id")==id);if !exists{return Err(missing());}
  if kind=="properties"{for a in s["assets"].as_array_mut().unwrap(){if let Some(p)=a["properties"].as_object_mut(){p.remove(&id);}}}
  if kind=="assets"{for w in s["works"].as_array_mut().unwrap(){if let Some(ids)=w["assetIds"].as_array_mut(){ids.retain(|v|v.as_str()!=Some(&id));}}}
  s[key].as_array_mut().unwrap().retain(|v|field(v,"id")!=id);return Ok(json!({"id":id,"deleted":true}));
 }
 if !record.is_object(){return Err(bad("入力はJSONオブジェクトが必要です。"));}
 let a=s[key].as_array_mut().unwrap();if method=="create"{if a.iter().any(|v|field(v,"id")==id){return Err(Error(StatusCode::CONFLICT,"IDが重複しています。".into()));}record["id"]=json!(id);if kind=="assets"{if record.get("history").is_none(){record["history"]=json!([]);}if record.get("properties").is_none(){record["properties"]=json!({});}}a.push(record.clone());}else{let old=a.iter_mut().find(|v|field(v,"id")==id).ok_or_else(missing)?;for(k,v)in record.as_object().unwrap(){if k!="id"{old[k]=v.clone();}}record=old.clone();}Ok(record)
}
async fn mutate(a:&App,h:&HeaderMap,kind:&str,id:Option<&str>,method:&str,record:Value)->Result<Value>{require_editor(a,h).await?;let mut tx=a.pool.begin().await?;sqlx::query("SELECT revision FROM app_revision WHERE id=1 FOR UPDATE").fetch_one(&mut *tx).await?;let mut s=load(&mut tx).await?;let record=apply(&mut s,kind,id,method,record)?;let rev=persist(&mut tx,&s,&format!("{kind}.{method}"),json!({"id":record["id"]})).await?;tx.commit().await?;Ok(json!({"record":record,"revision":rev}))}
async fn create_record(State(a):State<App>,h:HeaderMap,Path(kind):Path<String>,Json(record):Json<Value>)->Result<(StatusCode,Json<Value>)>{Ok((StatusCode::CREATED,Json(mutate(&a,&h,&kind,None,"create",record).await?)))}
async fn update_record(State(a):State<App>,h:HeaderMap,Path((kind,id)):Path<(String,String)>,Json(record):Json<Value>)->Result<Json<Value>>{Ok(Json(mutate(&a,&h,&kind,Some(&id),"update",record).await?))}
async fn delete_record(State(a):State<App>,h:HeaderMap,Path((kind,id)):Path<(String,String)>)->Result<Json<Value>>{Ok(Json(mutate(&a,&h,&kind,Some(&id),"delete",json!({})).await?))}
async fn batch(State(a):State<App>,h:HeaderMap,Json(body):Json<Value>)->Result<Json<Value>>{require_editor(&a,&h).await?;let ops=body.get("operations").and_then(Value::as_array).ok_or_else(||bad("operations配列が必要です。"))?;if ops.len()>100{return Err(bad("一括操作は100件までです。"));}let mut tx=a.pool.begin().await?;sqlx::query("SELECT revision FROM app_revision WHERE id=1 FOR UPDATE").fetch_one(&mut *tx).await?;let mut s=load(&mut tx).await?;let mut results=vec![];for op in ops{let method=field(op,"op");if !["create","update","delete"].contains(&method){return Err(bad("opはcreate/update/deleteのいずれかです。"));}results.push(apply(&mut s,field(op,"kind"),op.get("id").and_then(Value::as_str),method,op.get("record").cloned().unwrap_or(json!({})))?);}let rev=persist(&mut tx,&s,"batch",json!({"count":ops.len()})).await?;tx.commit().await?;Ok(Json(json!({"results":results,"revision":rev})))}
async fn maintenance_list(State(a):State<App>,h:HeaderMap,Path(id):Path<String>)->Result<Json<Value>>{require_facilities(&a,&h).await?;let(_,s)=read_snapshot(&a).await?;let asset=items(&s,"assets").iter().find(|v|field(v,"id")==id).ok_or_else(missing)?;Ok(Json(json!({"items":items(asset,"history")})))}
async fn maintenance_mutate(a:&App,h:&HeaderMap,id:&str,hid:Option<&str>,method:&str,mut record:Value)->Result<Value>{
 require_editor(a,h).await?;let mut tx=a.pool.begin().await?;sqlx::query("SELECT revision FROM app_revision WHERE id=1 FOR UPDATE").fetch_one(&mut *tx).await?;let mut s=load(&mut tx).await?;
 let asset=s["assets"].as_array_mut().unwrap().iter_mut().find(|v|field(v,"id")==id).ok_or_else(missing)?;let mut history=items(asset,"history").to_vec();
 if method=="create"{if !record.is_object(){return Err(bad("履歴はオブジェクトが必要です。"));}record["id"]=json!(Uuid::new_v4().to_string());history.push(record.clone());}
 else{let index=history.iter().position(|v|field(v,"id")==hid.unwrap_or("")).ok_or_else(missing)?;if method=="delete"{record=history.remove(index);}else{if !record.is_object(){return Err(bad("履歴はオブジェクトが必要です。"));}for(k,v)in record.as_object().unwrap(){if k!="id"{history[index][k]=v.clone();}}record=history[index].clone();}}
 asset["history"]=json!(history);let rev=persist(&mut tx,&s,&format!("inspection.{method}"),json!({"assetId":id,"historyId":record["id"]})).await?;tx.commit().await?;Ok(json!({"record":record,"revision":rev}))
}
async fn maintenance_create(State(a):State<App>,h:HeaderMap,Path(id):Path<String>,Json(record):Json<Value>)->Result<Json<Value>>{Ok(Json(maintenance_mutate(&a,&h,&id,None,"create",record).await?))}
async fn maintenance_update(State(a):State<App>,h:HeaderMap,Path((id,hid)):Path<(String,String)>,Json(record):Json<Value>)->Result<Json<Value>>{Ok(Json(maintenance_mutate(&a,&h,&id,Some(&hid),"update",record).await?))}
async fn maintenance_delete(State(a):State<App>,h:HeaderMap,Path((id,hid)):Path<(String,String)>)->Result<Json<Value>>{Ok(Json(maintenance_mutate(&a,&h,&id,Some(&hid),"delete",json!({})).await?))}
async fn search(State(a):State<App>,h:HeaderMap,Query(q):Query<Filters>)->Result<Json<Value>>{let(r,s)=visible_snapshot(&a,&h).await?;let mut results=vec![];for k in ["works","assets","drawings","notes"]{for v in items(&s,k){if matches_filter(v,&q){results.push(json!({"kind":k,"record":v}));}}}let total=results.len();Ok(Json(json!({"items":results.into_iter().skip(q.offset.unwrap_or(0)).take(q.limit.unwrap_or(100).min(1000)).collect::<Vec<_>>(),"total":total,"revision":r})))}
async fn stats(State(a):State<App>,h:HeaderMap)->Result<Json<Value>>{let facilities=can_view_facilities(&a,&h).await;let(r,s)=visible_snapshot(&a,&h).await?;let mut status=json!({"active":0,"planned":0,"done":0});for w in items(&s,"works"){let k=field(w,"status");status[k]=json!(status[k].as_u64().unwrap_or(0)+1);}let mut refs=HashSet::new();collect_files(&s,&mut refs);let mut output=json!({"revision":r,"drawings":items(&s,"drawings").len(),"works":items(&s,"works").len(),"assets":items(&s,"assets").len(),"notes":items(&s,"notes").len(),"properties":items(&s,"propertyDefinitions").len(),"inspections":items(&s,"assets").iter().map(|a|items(a,"history").len()).sum::<usize>(),"attachments":refs.len(),"workStatus":status});if !facilities{let fields=output.as_object_mut().unwrap();for key in ["assets","properties","inspections"]{fields.remove(key);}}Ok(Json(output))}
fn detect_mime(bytes:&[u8])->&'static str{if bytes.starts_with(b"%PDF-"){"application/pdf"}else if bytes.starts_with(b"\x89PNG\r\n\x1a\n"){"image/png"}else if bytes.starts_with(&[0xff,0xd8,0xff]){"image/jpeg"}else if bytes.starts_with(b"GIF8"){"image/gif"}else if bytes.len()>=12&&&bytes[..4]==b"RIFF"&&&bytes[8..12]==b"WEBP"{"image/webp"}else{"application/octet-stream"}}
async fn upload(State(a):State<App>,h:HeaderMap,mut multipart:Multipart)->Result<(StatusCode,Json<Value>)>{require_editor(&a,&h).await?;let mut result=vec![];while let Some(field)=multipart.next_field().await.map_err(|_|bad("ファイルを読み取れませんでした。"))?{if field.name()!=Some("file"){continue;}let name=field.file_name().unwrap_or("file").replace(['\r','\n','/','\\'],"_");if name.len()>500{return Err(bad("ファイル名が長すぎます。"));}let bytes=field.bytes().await.map_err(|_|bad("ファイルを読み取れませんでした。"))?;if bytes.is_empty()||bytes.len()>20*1024*1024{return Err(bad("添付資料は空でない20MB以下のファイルにしてください。"));}let id=Uuid::new_v4().to_string();let mime=detect_mime(&bytes);sqlx::query("INSERT INTO attachments(id,name,mime,size,content) VALUES($1,$2,$3,$4,$5)").bind(&id).bind(&name).bind(mime).bind(bytes.len() as i64).bind(bytes.to_vec()).execute(&a.pool).await?;result.push(json!({"id":id,"fileId":id,"name":name,"mime":mime,"size":bytes.len()}));if result.len()>30{return Err(bad("一度に30ファイルまでです。"));}}if result.is_empty(){return Err(bad("fileフィールドに資料を指定してください。"));}Ok((StatusCode::CREATED,Json(json!({"files":result}))))}
async fn file_get(State(a):State<App>,h:HeaderMap,Path(id):Path<String>,Query(q):Query<HashMap<String,String>>)->Result<Response>{let(_,s)=visible_snapshot(&a,&h).await?;let mut refs=HashSet::new();collect_files(&s,&mut refs);if !refs.contains(&id){return Err(missing());}let row=sqlx::query("SELECT name,mime,content FROM attachments WHERE id=$1").bind(&id).fetch_optional(&a.pool).await?.ok_or_else(missing)?;let name:String=row.get("name");let mime:String=row.get("mime");let bytes:Vec<u8>=row.get("content");let inline=q.get("inline").is_some_and(|v|v=="1")&&(mime=="application/pdf"||mime.starts_with("image/"));let encoded=url::form_urlencoded::byte_serialize(name.as_bytes()).collect::<String>();let disposition=format!("{}; filename=\"file\"; filename*=UTF-8''{encoded}",if inline{"inline"}else{"attachment"});let mut r=Body::from(bytes).into_response();r.headers_mut().insert("content-type",HeaderValue::from_str(&mime).unwrap());r.headers_mut().insert("content-disposition",HeaderValue::from_str(&disposition).unwrap());Ok(r)}
async fn thumbnail_get(State(a):State<App>,h:HeaderMap,Path(id):Path<String>)->Result<Response> {
 let(_,state)=visible_snapshot(&a,&h).await?;let mut refs=HashSet::new();collect_files(&state,&mut refs);if !refs.contains(&id){return Err(missing());}
 let row=sqlx::query("SELECT mime,thumbnail FROM attachments WHERE id=$1").bind(&id).fetch_optional(&a.pool).await?.ok_or_else(missing)?;
 let mime:String=row.get("mime");if !["image/jpeg","image/png","image/gif","image/webp"].contains(&mime.as_str()){return Err(bad("このファイルは写真のサムネイルに対応していません。"));}
 let cached:Option<Vec<u8>>=row.get("thumbnail");
 let data=if let Some(data)=cached{data}else{
  let _permit=a.thumbnail_slots.acquire().await.map_err(|_|bad("写真の処理を完了できませんでした。"))?;
  let cached:Option<Vec<u8>>=sqlx::query_scalar("SELECT thumbnail FROM attachments WHERE id=$1").bind(&id).fetch_one(&a.pool).await?;
  if let Some(data)=cached{data}else{
   let original:Vec<u8>=sqlx::query_scalar("SELECT content FROM attachments WHERE id=$1").bind(&id).fetch_one(&a.pool).await?;
   let data=tokio::task::spawn_blocking(move||->std::result::Result<Vec<u8>,String>{
    let mut reader=image::ImageReader::new(std::io::Cursor::new(original)).with_guessed_format().map_err(|e|e.to_string())?;
    let mut limits=image::Limits::default();limits.max_alloc=Some(96*1024*1024);limits.max_image_width=Some(20000);limits.max_image_height=Some(20000);reader.limits(limits);
    let mut decoder=reader.into_decoder().map_err(|e|e.to_string())?;let orientation=decoder.orientation().map_err(|e|e.to_string())?;
    let mut image=image::DynamicImage::from_decoder(decoder).map_err(|e|e.to_string())?;image.apply_orientation(orientation);
    let mut output=std::io::Cursor::new(Vec::new());image.thumbnail(320,240).write_to(&mut output,image::ImageFormat::Png).map_err(|e|e.to_string())?;Ok(output.into_inner())
   }).await.map_err(|_|bad("写真の処理を完了できませんでした。"))?.map_err(|_|bad("写真を読み込めませんでした。画像の形式・大きさを確認してください。"))?;
   sqlx::query("UPDATE attachments SET thumbnail=$1 WHERE id=$2").bind(&data).bind(&id).execute(&a.pool).await?;data
  }
 };
 let mut response=Body::from(data).into_response();response.headers_mut().insert("content-type",HeaderValue::from_static("image/png"));Ok(response)
}
async fn export(State(a):State<App>,h:HeaderMap)->Result<Response>{require_editor(&a,&h).await?;let(r,s)=read_snapshot(&a).await?;let mut response=Json(json!({"revision":r,"state":s})).into_response();response.headers_mut().insert("content-disposition",HeaderValue::from_static("attachment; filename=\"factory-map.json\""));Ok(response)}
async fn audit(State(a):State<App>,h:HeaderMap,Query(q):Query<Filters>)->Result<Json<Value>>{require_editor(&a,&h).await?;let rows=sqlx::query("SELECT id,at::text,action,detail FROM audit_events ORDER BY id DESC LIMIT $1 OFFSET $2").bind(q.limit.unwrap_or(100).min(1000) as i64).bind(q.offset.unwrap_or(0) as i64).fetch_all(&a.pool).await?;Ok(Json(json!({"items":rows.iter().map(|r|json!({"id":r.get::<i64,_>("id"),"at":r.get::<String,_>("at"),"action":r.get::<String,_>("action"),"detail":r.get::<Value,_>("detail")})).collect::<Vec<_>>()})))}
async fn tokens_list(State(a):State<App>,h:HeaderMap)->Result<Json<Value>>{require_editor(&a,&h).await?;let rows=sqlx::query("SELECT id,name,scope,expires_at::text FROM api_tokens ORDER BY created_at DESC").fetch_all(&a.pool).await?;Ok(Json(json!({"items":rows.iter().map(|r|json!({"id":r.get::<String,_>("id"),"name":r.get::<String,_>("name"),"scope":r.get::<String,_>("scope"),"expiresAt":r.get::<String,_>("expires_at")})).collect::<Vec<_>>()})))}
async fn tokens_create(State(a):State<App>,h:HeaderMap,Json(body):Json<Value>)->Result<Json<Value>>{require_editor(&a,&h).await?;let name=field(&body,"name");let scope=field(&body,"scope");if name.trim().is_empty()||!["editor","viewer"].contains(&scope){return Err(bad("nameとscope(editor/viewer)を指定してください。"));}let token=random();let id=Uuid::new_v4().to_string();sqlx::query("INSERT INTO api_tokens(id,token_hash,name,scope,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 days')").bind(&id).bind(hash(&token)).bind(name).bind(scope).execute(&a.pool).await?;Ok(Json(json!({"id":id,"token":token,"scope":scope,"expiresInDays":30})))}
async fn tokens_delete(State(a):State<App>,h:HeaderMap,Path(id):Path<String>)->Result<Json<Value>>{require_editor(&a,&h).await?;sqlx::query("DELETE FROM api_tokens WHERE id=$1").bind(id).execute(&a.pool).await?;Ok(Json(json!({"ok":true})))}
async fn health(State(a):State<App>)->Result<Json<Value>>{sqlx::query("SELECT 1").execute(&a.pool).await?;Ok(Json(json!({"ok":true,"version":"0.2.0","database":"PostgreSQL"})))}
async fn capabilities()->Json<Value>{Json(json!({"version":"0.2.0","features":["works","assets","typed-properties","inspections","multi-attachments","password-sessions","api-tokens","audit","atomic-batch","revision-check","webmcp","sticky-notes"],"openapi":"/openapi.json","docs":"/api-docs","uploadLimitBytes":20971520,"publicSample":true}))}
async fn static_get(State(a):State<App>,req:Request)->Result<Response>{
 let mut path=req.uri().path().trim_start_matches('/').to_string();if path.is_empty(){path="index.html".into();}if path=="api-docs"||path=="api-docs/"{path="api-docs.html".into();}
 let allowed=["index.html","styles.css","app.js","cad.js","api-client.js","features.js","media.js","equipment.js","pdf-preview.js","notes.js","webmcp.js","api-docs.html","api-docs.js","openapi.json"];
 let valid=allowed.contains(&path.as_str())||["assets/","vendor/","samples/"].iter().any(|p|path.starts_with(p));
 if !valid||path.split('/').any(|s|s==".."||s.starts_with('.'))||path.contains('%')||path.contains('\\'){return Err(missing());}
 let file=a.root.join("public").join(&path);let canonical=tokio::fs::canonicalize(&file).await.map_err(|_|missing())?;let base=tokio::fs::canonicalize(a.root.join("public")).await.map_err(|_|missing())?;if !canonical.starts_with(base)||!canonical.is_file(){return Err(missing());}
 let bytes=tokio::fs::read(file).await.map_err(|_|missing())?;let mime=mime_guess::from_path(&path).first_or_octet_stream().to_string();let mut response=Body::from(bytes).into_response();response.headers_mut().insert("content-type",HeaderValue::from_str(&if mime.starts_with("text/")||["application/javascript","application/json","image/svg+xml"].contains(&mime.as_str()){format!("{mime}; charset=utf-8")}else{mime}).unwrap());Ok(response)
}
#[tokio::main]async fn main()->std::result::Result<(),Box<dyn std::error::Error>>{
 let root=std::env::var("FACTORY_MAP_ROOT").map(PathBuf::from).unwrap_or_else(|_|PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap().to_path_buf());
 let config:Value=serde_json::from_slice(&std::fs::read(root.join(".runtime/config.json"))?)?;
 let pool=PgPoolOptions::new().max_connections(10).connect(config["database_url"].as_str().ok_or("missing database_url")?).await?;
 sqlx::raw_sql(include_str!("../schema.sql")).execute(&pool).await?;
 if sqlx::query_scalar::<_,i64>("SELECT count(*) FROM settings WHERE key='admin_password_hash'").fetch_one(&pool).await?==0{
  let password=random();let encoded=Argon2::default().hash_password(password.as_bytes(),&SaltString::generate(&mut OsRng))?.to_string();
  sqlx::query("INSERT INTO settings(key,value) VALUES('admin_password_hash',$1)").bind(encoded).execute(&pool).await?;
  let path=root.join(".runtime/initial-admin-password.txt");let mut f=std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&path)?;f.write_all(password.as_bytes())?;println!("Initial password is stored privately at {}",path.display());
 }
 if sqlx::query_scalar::<_,i64>("SELECT count(*) FROM drawings").fetch_one(&pool).await?==0{
  let bytes=std::fs::read(root.join("shared/demo/demo.pdf"))?;
  sqlx::query("INSERT INTO attachments(id,name,mime,size,content) VALUES('demo-document','設備・点検サンプル.pdf','application/pdf',$1,$2) ON CONFLICT DO NOTHING").bind(bytes.len() as i64).bind(bytes).execute(&pool).await?;
  let seed:Value=serde_json::from_slice(&std::fs::read(root.join("shared/demo/seed.json"))?)?;let mut tx=pool.begin().await?;persist(&mut tx,&seed,"seed.initialize",json!({"sample":true})).await?;tx.commit().await?;
 }
 let a=App{pool,root,attempts:Arc::new(Mutex::new(HashMap::new())),thumbnail_slots:Arc::new(tokio::sync::Semaphore::new(2))};
 let router=Router::new().route("/api/health",get(health)).route("/api/capabilities",get(capabilities))
 .route("/api/auth/status",get(auth_status)).route("/api/auth/login",post(login)).route("/api/auth/logout",post(logout)).route("/api/auth/password",put(password_change))
 .route("/api/state",get(state_get).put(state_put)).route("/api/search",get(search)).route("/api/stats",get(stats)).route("/api/export",get(export)).route("/api/audit",get(audit)).route("/api/batch",post(batch))
 .route("/api/files",post(upload)).route("/api/files/{id}",get(file_get)).route("/api/files/{id}/thumbnail",get(thumbnail_get))
 .route("/api/tokens",get(tokens_list).post(tokens_create)).route("/api/tokens/{id}",delete(tokens_delete))
 .route("/api/assets/{id}/maintenance",get(maintenance_list).post(maintenance_create)).route("/api/assets/{id}/maintenance/{history_id}",delete(maintenance_delete).patch(maintenance_update))
 .route("/api/{kind}",get(list_records).post(create_record)).route("/api/{kind}/{id}",get(get_record).patch(update_record).delete(delete_record))
 .fallback(static_get).layer(DefaultBodyLimit::max(64*1024*1024)).layer(middleware::from_fn(guard)).with_state(a);
 let bind=std::env::var("FACTORY_MAP_BIND").unwrap_or_else(|_|"127.0.0.1:18017".into());let listener=tokio::net::TcpListener::bind(&bind).await?;println!("Factory Map Rust/PostgreSQL server: http://{bind}");
 axum::serve(listener,router.into_make_service_with_connect_info::<SocketAddr>()).await?;Ok(())
}
