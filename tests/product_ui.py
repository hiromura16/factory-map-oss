import base64,os,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
node=os.environ.get('FACTORY_MAP_NODE','node')
server=subprocess.Popen([node,'tests/map-local-server.mjs'],cwd=ROOT,stdout=subprocess.PIPE,text=True)
try:
 url=server.stdout.readline().strip()
 assert url.startswith('http://127.0.0.1:'),url
 with sync_playwright()as p:
  browser=p.chromium.launch(executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'),args=['--enable-features=WebMCP'])
  page=browser.new_page(viewport={'width':1536,'height':1100});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(url);page.wait_for_function('window.factoryMap && window.FactoryPreferences?.getPreferences && window.FactoryAPI.saas')
  assert page.get_by_label('デモアカウント',exact=True).input_value()=='pro'
  page.locator('#factory-left-toggle').click();assert page.locator('.list-pane').is_hidden()
  page.locator('#factory-right-toggle').click();assert page.locator('#detail-pane').is_hidden()
  page.locator('#factory-customize').click();page.get_by_label('テーマ',exact=True).select_option('dark')
  page.wait_for_function('document.body.dataset.factoryTheme==="dark"')
  assert page.locator('#factory-custom-dialog').get_by_text('プランシミュレーター',exact=False).count()==0
  png=page.evaluate("()=>{const c=document.createElement('canvas');c.width=c.height=16;c.getContext('2d').fillRect(0,0,16,16);return c.toDataURL('image/png').split(',')[1]}")
  page.get_by_label('アイコン画像を追加').set_input_files({'name':'追加アイコン.png','mimeType':'image/png','buffer':base64.b64decode(png)})
  page.wait_for_function('FactoryPreferences.getPreferences().icons.length===1 && FactoryPreferences.getPreferences().icons[0].fileId')
  icon=page.evaluate('FactoryPreferences.getPreferences().icons[0].id');page.get_by_label('空調・換気',exact=True).select_option(icon)
  page.evaluate('()=>FactoryPreferences.flush()');page.keyboard.press('Escape')
  page.reload();page.wait_for_function('window.FactoryPreferences?.getPreferences')
  assert page.evaluate('FactoryPreferences.getPreferences().theme')=='dark'
  assert page.evaluate('FactoryPreferences.getPreferences().icons.length')==1
  assert page.locator('.list-pane').is_hidden()
  page.locator('#factory-left-toggle').click();page.locator('#factory-right-toggle').click()
  # Classification edits are persisted with equipment references in the same DB revision.
  page.locator('#categories-open').click()
  page.get_by_label('分類名 1',exact=True).fill('空調・換気・冷房')
  page.get_by_role('button',name='＋ 分類を追加',exact=True).click();page.get_by_label('分類名 13',exact=True).fill('生産設備')
  page.get_by_role('button',name='＋ 分類を追加',exact=True).click();page.get_by_label('分類名 14',exact=True).fill('計測機器')
  page.get_by_role('button',name='変更を保存',exact=True).click();page.wait_for_function('!document.querySelector("#categories-dialog").open')
  page.reload();page.wait_for_function('window.FactoryPreferences?.getPreferences')
  assert page.evaluate('factoryMap.state.propertyDefinitions.find(d=>d.id==="category").options.length')==14
  page.locator('#factory-customize').click();page.get_by_label('生産設備',exact=True).select_option(icon);page.evaluate('()=>FactoryPreferences.flush()');page.keyboard.press('Escape')
  asset_id=page.evaluate('factoryMap.state.assets[0].id')
  page.evaluate('(id)=>factoryMap.openRecord("assets",id)',asset_id);page.get_by_role('button',name='設備を編集',exact=True).click()
  page.locator('#asset-dialog').get_by_label('設備分類',exact=True).select_option(label='生産設備')
  page.locator('#asset-dialog').get_by_role('button',name='保存する',exact=True).click();page.wait_for_function('!document.querySelector("#asset-dialog").open')
  page.locator('#categories-open').click();page.get_by_role('button',name='分類 生産設備を削除',exact=True).click()
  page.get_by_label('生産設備の移動先',exact=True).select_option(label='計測機器')
  page.get_by_role('button',name='変更を保存',exact=True).click();page.wait_for_function('!document.querySelector("#categories-dialog").open')
  page.reload();page.wait_for_function('window.FactoryPreferences?.getPreferences')
  assert page.evaluate('()=>{const d=factoryMap.state.propertyDefinitions.find(d=>d.id==="category");return d.options.length===13&&!d.options.some(o=>o.label==="生産設備")&&factoryMap.state.assets[0].properties.category===d.options.find(o=>o.label==="計測機器").id}')
  page.locator('#assets-tab').click();page.get_by_label('設備分類',exact=True).select_option(label='計測機器');assert page.locator('#record-list .record-card').count()==1
  page.locator('#categories-open').click();page.get_by_role('button',name='分類 計測機器を削除',exact=True).click()
  page.get_by_label('計測機器の移動先',exact=True).select_option('')
  page.get_by_role('button',name='変更を保存',exact=True).click();page.wait_for_function('!document.querySelector("#categories-dialog").open')
  assert page.get_by_label('設備分類',exact=True).input_value()==''
  assert page.evaluate('factoryMap.state.assets.length')==64
  assert page.evaluate('factoryMap.state.assets[0].properties.category') is None
  nav_boxes=page.locator('.app-header nav').locator('a,button').evaluate_all('(nodes)=>nodes.filter(n=>!n.hidden).map(n=>({y:n.getBoundingClientRect().y,h:n.getBoundingClientRect().height}))')
  assert max(b['y'] for b in nav_boxes)-min(b['y'] for b in nav_boxes)<1
  assert max(b['h'] for b in nav_boxes)-min(b['h'] for b in nav_boxes)<1
  page.get_by_role('button',name='施設担当モード',exact=True).click()
  page.wait_for_function('!factoryMap.editor && factoryMap.state.assets.length===0')
  assert page.locator('#assets-tab').is_hidden();assert page.locator('#categories-open').is_hidden();assert page.evaluate('factoryMap.state.assets.length')==0
  page.get_by_role('button',name='閲覧モード',exact=True).click();page.wait_for_function('factoryMap.editor&&factoryMap.state.assets.length===64')
  page.locator('#factory-customize').click();page.get_by_label('テーマ',exact=True).select_option('light');page.evaluate('()=>FactoryPreferences.flush()');page.keyboard.press('Escape')
  page.screenshot(path='/tmp/factory-map-saas-map.png',full_page=True)
  page.goto(url+'/console.html');page.get_by_role('heading',name='設備台帳',exact=True).wait_for()
  page.get_by_role('button',name='バックアップ',exact=True).click();page.get_by_label('バックアップ名').fill('UIテスト保存')
  page.get_by_role('button',name='現在の台帳を保存').click();page.get_by_text('UIテスト保存',exact=True).wait_for()
  page.get_by_role('button',name='データ移行',exact=True).click()
  csv='設備ID,点検日,内容,結果,実施者\r\nAC-A-001,2026-11-13,CSVから点検履歴を移行,異常なし,テスト担当\r\n'
  page.get_by_label('点検履歴CSVを取り込む').set_input_files({'name':'history.csv','mimeType':'text/csv','buffer':csv.encode()})
  page.get_by_role('heading',name='取り込み内容の確認').wait_for();page.on('dialog',lambda dialog:dialog.accept())
  page.get_by_role('button',name='確認して取り込む').click();page.get_by_text('データを取り込みました。',exact=True).wait_for()
  page.get_by_role('button',name='操作履歴',exact=True).click();page.get_by_text('data.import',exact=True).wait_for()
  assert page.get_by_text('プラン比較',exact=True).count()==0
  page.get_by_role('link',name='← 敷地マップに戻る',exact=True).click();page.locator('#plans-open').click();page.get_by_role('heading',name='Enterprise',exact=True).wait_for()
  page.screenshot(path='/tmp/factory-map-saas-plans.png',full_page=True)
  page.locator('.plans-dialog').get_by_role('button',name='Freeデモを使う',exact=True).click()
  page.wait_for_function('window.FactoryAPI?.session?.profile==="free"');page.get_by_role('heading',name='Enterprise',exact=True).wait_for()
  page.goto(url);page.wait_for_function('window.factoryMap && window.FactoryPreferences?.getPreferences')
  assert page.evaluate('factoryMap.state.assets.length')==12
  page.locator('#factory-customize').click();assert page.get_by_label('テーマ',exact=True).is_disabled();assert page.get_by_label('アイコン画像を追加').is_disabled()
  page.keyboard.press('Escape');page.set_viewport_size({'width':390,'height':844})
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.locator('#plans-open').click();page.get_by_role('heading',name='Enterprise',exact=True).wait_for();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.keyboard.press('Escape');page.locator('.plans-dialog').wait_for(state='detached')
  page.goto(url+'/console.html#plans');page.get_by_role('heading',name='Enterprise',exact=True).wait_for();assert '/index.html?plans=1' in page.url
  assert not errors,errors
  browser.close()
 print('PASS: real Worker/SQLite browser flows: categories add/rename/delete with reassignment and clear; shared icons; aligned header; map plan dialog; panels; SSO mode; accounts; backup; CSV history import; audit; plans; mobile; no browser errors')
finally:
 server.terminate();server.wait(timeout=10)
