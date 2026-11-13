/* Connect the SaaS identity and workspace controls to the map. */
(() => {
 async function start(){
  if(document.getElementById('console-root')){if(location.hash==='#plans'){location.replace('index.html?plans=1');return;}FactoryProduct.mountConsole(document.getElementById('console-root'));return;}
  for(let i=0;i<200&&!window.factoryMap;i++)await new Promise(r=>setTimeout(r,50));
  if(!window.factoryMap||!FactoryAPI.saas)return;
  const plans=document.getElementById('plans-open');plans.hidden=false;plans.onclick=event=>{event.preventDefault();window.dispatchEvent(new Event('factory-plans-open'));};
  const root=document.createElement('div');root.id='product-map-root';document.querySelector('.app-header').after(root);FactoryProduct.mountMap(root);
  document.getElementById('password-open').hidden=true;document.getElementById('password-open').classList.remove('editor-only');
  document.querySelector('.demo-indicator').textContent=FactoryAPI.session.profile==='pro'?'Pro 管理者デモ':'Free デモ';
  const id=new URL(location.href).searchParams.get('asset');if(id){if(!factoryMap.editor){await FactoryAPI.request('/api/auth/login',{method:'POST',body:{}});await factoryMap.refresh();factoryMap.setEditor(true);}try{factoryMap.openRecord('assets',id);}catch(error){factoryMap.fail(error);}}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>start().catch(e=>console.error(e)),{once:true});else start().catch(e=>console.error(e));
})();
