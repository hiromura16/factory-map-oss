/* Native WebMCP. Authentication is always enforced again by the Rust server. */
window.FactoryWebMCP = (() => {
  const lifecycle=new AbortController();
  let registered=false;
  const object=properties=>({type:'object',properties,additionalProperties:false});
  const string={type:'string',minLength:1};
  function validate(schema,input){
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('オブジェクトを指定してください。');
    for(const key of schema.required||[])if(!(key in input))throw new Error(key+'が必要です。');
    for(const [key,value]of Object.entries(input)){
      const rule=schema.properties[key];if(!rule)throw new Error('未定義の項目です: '+key);
      if(rule.type==='object'&&(!value||typeof value!=='object'||Array.isArray(value)))throw new Error(key+'はオブジェクトが必要です。');
      if(rule.type==='string'&&(typeof value!=='string'||(rule.minLength&&value.length<rule.minLength)))throw new Error(key+'は空でない文字列が必要です。');
      if(rule.enum&&!rule.enum.includes(value))throw new Error(key+'の値が正しくありません。');
      if(rule.type==='boolean'&&typeof value!=='boolean')throw new Error(key+'はオン・オフで指定してください。');
      if(rule.type==='array'&&!Array.isArray(value))throw new Error(key+'は配列が必要です。');
    }
    return input;
  }
  async function register(){
    const registry=document.modelContext;if(registered||typeof registry?.registerTool!=='function')return;
    const app=window.factoryMap,request=FactoryAPI.request;
    async function add(name,description,schema,execute,readOnly=false){
      await registry.registerTool({name,description,inputSchema:schema,annotations:{readOnlyHint:readOnly,untrustedContentHint:true},async execute(input){const result=await execute(validate(schema,input));return result;}},{signal:lifecycle.signal});
    }
    try{
      for(const [kind,label]of [['works','工事'],['assets','設備'],['drawings','図面'],['properties','設備プロパティ'],['notes','付箋'],['layers','レイヤー'],['drawingLinks','図面リンク']]){
        await add('list_'+kind,label+'を検索・一覧取得します。',object({q:{type:'string'},drawingId:string}),async input=>request('/api/'+kind+'?'+new URLSearchParams({...input,limit:'1000'})),true);
        const idSchema={...object({id:string}),required:['id']};
        await add('get_'+kind,label+'の詳細を取得します。',idSchema,input=>request('/api/'+kind+'/'+encodeURIComponent(input.id)),true);
        if(kind==='drawings')continue;
        for(const [action,method]of [['create','POST'],['update','PATCH'],['delete','DELETE']]){
          const schema={...object({...(action==='create'?{}:{id:string}),...(action==='delete'?{}:{record:{type:'object'}})}),required:[...(action==='create'?[]:['id']),...(action==='delete'?[]:['record'])]};
          await add(action+'_'+kind,label+'を'+{create:'登録',update:'更新',delete:'削除'}[action]+'します。施設グループのログインが必要です。',schema,async input=>{
            const response=await request('/api/'+kind+(input.id?'/'+encodeURIComponent(input.id):''),{method,...(input.record?{body:input.record}:{})});await app.refresh();if(action!=='delete'&&['works','assets','notes'].includes(kind))app.openRecord(kind,response.record.id);return response;
          });
        }
      }
      await add('search_site','工事・設備・図面・付箋を横断検索します。',object({q:{type:'string'}}),input=>request('/api/search?'+new URLSearchParams(input)),true);
      await add('get_site_stats','設備・工事・点検・添付資料の件数を取得します。',object({}),()=>request('/api/stats'),true);
      await add('open_record','指定した設備・工事を画面に表示します。',{...object({kind:{type:'string',enum:['works','assets','notes']},id:string}),required:['kind','id']},async input=>{app.openRecord(input.kind,input.id);return{opened:input.id,drawingId:app.currentDrawing};},true);
      await add('set_drawing','表示図面を切り替えます。',{...object({id:string}),required:['id']},async input=>{app.setDrawing(input.id);return{drawingId:app.currentDrawing};},true);
      await add('list_inspections','設備の点検・保守履歴を取得します。',{...object({assetId:string}),required:['assetId']},input=>request('/api/assets/'+encodeURIComponent(input.assetId)+'/maintenance'),true);
      await add('add_inspection','点検・保守履歴を保存します。施設グループのログインが必要です。',{...object({assetId:string,record:{type:'object'}}),required:['assetId','record']},async input=>{const r=await request('/api/assets/'+encodeURIComponent(input.assetId)+'/maintenance',{method:'POST',body:input.record});await app.refresh();app.openRecord('assets',input.assetId);return r;});
      await add('batch_update','最大100件の登録・更新・削除を一括保存します。すべて成功する場合のみ反映します。',{...object({operations:{type:'array'}}),required:['operations']},async input=>{const r=await request('/api/batch',{method:'POST',body:input});await app.refresh();return r;});
      await add('list_work_register','施設担当モード専用の工事一覧と削除済み工事を取得します。',object({}),()=>request('/api/work-register'),true);
      await add('get_work_history','工事の登録・変更・削除履歴を取得します。施設担当モード専用です。',{...object({id:string}),required:['id']},input=>request('/api/works/'+encodeURIComponent(input.id)+'/history'),true);
      await add('get_display_preferences','表示サイズ・ズーム連動・レイヤー表示・プリセットなどの設定を取得します。',object({}),()=>request('/api/preferences'),true);
      await add('update_display_preferences','表示設定を更新し、このアカウントに保存します。',{...object({preferences:{type:'object'}}),required:['preferences']},async input=>{const current=FactoryPreferences.getPreferences();await FactoryPreferences.update({...input.preferences,...(input.preferences.appearance?{appearance:{...current.appearance,...input.preferences.appearance}}:{})});return {preferences:FactoryPreferences.getPreferences()};});
      await add('set_layer_visibility','追加レイヤーの表示・非表示を切り替え、保存します。',{...object({id:string,visible:{type:'boolean'}}),required:['id','visible']},async input=>{if(!app.state.layers.some(l=>l.id===input.id))throw new Error('レイヤーがありません。');const ids=new Set(FactoryPreferences.getPreferences().hiddenLayerIds);if(input.visible)ids.delete(input.id);else ids.add(input.id);await FactoryPreferences.update({hiddenLayerIds:[...ids]});return {id:input.id,visible:input.visible};});
      registered=true;window.dispatchEvent(new Event('factory-webmcp-ready'));
    }catch(error){console.error('WebMCP registration:',error);}
  }
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  return {register};
})();
