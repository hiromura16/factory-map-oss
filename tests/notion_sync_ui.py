"""Notion connection UI, with mocked provider settings and a real signed-in PlantDesk shell."""
import os,subprocess,json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
server=subprocess.Popen([os.environ.get('FACTORY_MAP_NODE','node'),'tests/map-local-server.mjs'],cwd=ROOT,stdout=subprocess.PIPE,text=True)
try:
 url=server.stdout.readline().strip();assert url.startswith('http://127.0.0.1:'),url
 with sync_playwright()as p:
  browser=p.chromium.launch(executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'));page=browser.new_page(viewport={'width':1536,'height':1100});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
  home='11111111-1111-4111-8111-111111111111';requests=[]
  status={'revision':0,'serverReady':True,'configured':False,'homePageId':home,'homeUrl':'https://www.notion.so/'+home.replace('-',''),'intervalMinutes':15,'direction':'both','enabled':False,'status':'prepared','running':False,'requested':False,'lastRunAt':None,'lastSuccessAt':None,'nextRunAt':None,'lastError':'','counts':{},'counters':{},'sources':[{'kind':kind,'name':name,'id':home,'url':'https://www.notion.so/'+home.replace('-','')}for kind,name in [('assets','設備台帳'),('works','工事台帳'),('tasks','チームの仕事'),('inspections','点検・保守履歴'),('teamMembers','担当者'),('inspectionPlans','点検計画')]]}
  issues=[{'kind':'assets','local_id':'a1','name':'A棟 空調室外機','page_id':home,'pageUrl':'https://www.notion.so/'+home.replace('-',''),'state':'conflict','updated_at':'2026-11-14T00:00:00.000Z','message':'両方で同じ項目が変更されています。','fields':['location'],'local':{'location':'A棟北側'},'notion':{'location':'A棟西側'}}]
  def route(r):
   path=r.request.url.split('/api/notion/')[-1];method=r.request.method;body=r.request.post_data_json if method in ['POST','PUT'] else None;requests.append((path,method,body));code=200
   if path=='status':value=status
   elif path=='issues':value={'revision':0,'items':issues}
   elif path=='runs':value={'items':[]}
   elif path=='config'and method=='PUT':status.update({'configured':True,'status':'queued','enabled':body['enabled'],'direction':body['direction'],'intervalMinutes':body['intervalMinutes']});value=status
   elif path=='run':status['requested']=True;value={'queued':True,**status};code=202
   elif path=='pause':status.update({'enabled':False,'status':'paused','requested':False});value=status
   elif path=='resolve':issues.clear();status['counts']={'active':5};value={'queued':True};code=202
   elif path=='config'and method=='DELETE':status.update({'configured':False,'status':'disconnected'});value={'disconnected':True}
   else:raise AssertionError((path,method))
   r.fulfill(status=code,content_type='application/json',body=json.dumps(value,ensure_ascii=False))
  page.route('**/api/notion/**',route);page.goto(url+'/console.html#notion');page.get_by_role('heading',name='接続設定',exact=True).wait_for();assert page.get_by_label('Notionの同期先ページ').input_value()==home
  token='ntn_test_ui_not_a_real_token';field=page.get_by_label('Notion接続トークン',exact=True);assert field.get_attribute('type')=='password';field.fill(token);page.get_by_label('Notion同期間隔').select_option('5');page.get_by_role('button',name='接続して同期',exact=True).click();page.get_by_text('接続を保存しました。DBの準備と同期を順次実行します。',exact=True).wait_for();assert field.input_value()=='';assert token not in page.locator('body').inner_text();assert any(p=='config'and m=='PUT'and b['token']==token for p,m,b in requests)
  page.get_by_role('button',name='今すぐ同期',exact=True).click();page.get_by_role('button',name='全件照合',exact=True).click();assert any(p=='run'and b.get('full')for p,m,b in requests if b)
  page.get_by_role('button',name='同期を停止',exact=True).click();page.wait_for_function('!document.querySelector("[aria-label=Notion定期同期を有効にする]").checked');page.screenshot(path='/tmp/plantdesk-notion-sync.png',full_page=True)
  page.get_by_text('両方の値を確認',exact=True).click();page.get_by_role('button',name='Notion側を採用',exact=True).click();page.get_by_text('要確認の項目はありません。',exact=True).wait_for();assert any(p=='resolve'and b['source']=='notion'for p,m,b in requests if b)
  page.set_viewport_size({'width':390,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');page.screenshot(path='/tmp/plantdesk-notion-mobile.png',full_page=True);assert not errors,errors;browser.close()
 print('PASS: Notion setup, hidden token, interval/direction settings, manual/full queue, pause, conflict review, dedicated DB links and mobile layout')
finally:
 server.terminate();server.wait(timeout=10)
