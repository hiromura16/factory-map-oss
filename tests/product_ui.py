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
  png=page.evaluate("()=>{const c=document.createElement('canvas');c.width=c.height=16;c.getContext('2d').fillRect(0,0,16,16);return c.toDataURL('image/png').split(',')[1]}")
  page.get_by_label('アイコン画像を追加').set_input_files({'name':'追加アイコン.png','mimeType':'image/png','buffer':base64.b64decode(png)})
  page.wait_for_function('FactoryPreferences.getPreferences().icons.length===1 && FactoryPreferences.getPreferences().icons[0].fileId')
  icon=page.evaluate('FactoryPreferences.getPreferences().icons[0].id');page.get_by_label('空調',exact=True).select_option(icon)
  page.evaluate('()=>FactoryPreferences.flush()');page.keyboard.press('Escape')
  page.reload();page.wait_for_function('window.FactoryPreferences?.getPreferences')
  assert page.evaluate('FactoryPreferences.getPreferences().theme')=='dark'
  assert page.evaluate('FactoryPreferences.getPreferences().icons.length')==1
  assert page.locator('.list-pane').is_hidden()
  page.locator('#factory-left-toggle').click();page.locator('#factory-right-toggle').click()
  page.get_by_role('button',name='施設担当モード',exact=True).click()
  page.wait_for_function('!factoryMap.editor && factoryMap.state.assets.length===0')
  assert page.locator('#assets-tab').is_hidden();assert page.evaluate('factoryMap.state.assets.length')==0
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
  page.get_by_role('button',name='プラン比較',exact=True).first.click();page.get_by_role('heading',name='Enterprise',exact=True).wait_for()
  page.screenshot(path='/tmp/factory-map-saas-plans.png',full_page=True)
  page.get_by_label('デモアカウント',exact=True).select_option('free')
  page.wait_for_function('window.FactoryAPI?.session?.profile==="free"');page.get_by_role('heading',name='Enterprise',exact=True).wait_for()
  page.goto(url);page.wait_for_function('window.factoryMap && window.FactoryPreferences?.getPreferences')
  assert page.evaluate('factoryMap.state.assets.length')==12
  page.locator('#factory-customize').click();assert page.get_by_label('テーマ',exact=True).is_disabled();assert page.get_by_label('アイコン画像を追加').is_disabled()
  page.keyboard.press('Escape');page.set_viewport_size({'width':390,'height':844})
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.goto(url+'/console.html#plans');page.get_by_role('heading',name='Enterprise',exact=True).wait_for();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert not errors,errors
  browser.close()
 print('PASS: real Worker/SQLite browser flows: shared customization and uploaded icons survive reload; panels; SSO mode; accounts; backup; CSV history import; audit; plans; mobile; no browser errors')
finally:
 server.terminate();server.wait(timeout=10)
