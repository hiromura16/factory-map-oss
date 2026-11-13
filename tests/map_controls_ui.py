"""Browser/SQLite regressions for equipment selection, work filters and tiny notes."""
import base64, os, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
server=subprocess.Popen([os.environ.get('FACTORY_MAP_NODE','node'),'tests/map-local-server.mjs'],cwd=ROOT,stdout=subprocess.PIPE,text=True)
try:
 url=server.stdout.readline().strip()
 assert url.startswith('http://127.0.0.1:'),url
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'))
  page=browser.new_page(viewport={'width':1440,'height':1100});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(url);page.wait_for_function('window.FactoryPreferences?.getPreferences')
  # Custom images and built-ins share the compact chooser. Explicit choices win over defaults.
  page.locator('#factory-customize').click()
  png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvDkAAAAASUVORK5CYII=')
  page.get_by_label('アイコン画像を追加').set_input_files({'name':'工場マーク.png','mimeType':'image/png','buffer':png})
  page.wait_for_function('FactoryPreferences.getPreferences().icons.length===1')
  custom=page.evaluate('FactoryPreferences.getPreferences().icons[0].id')
  page.get_by_label('空調・換気',exact=True).select_option(custom);page.evaluate('()=>FactoryPreferences.flush()');page.keyboard.press('Escape')
  asset=page.evaluate('factoryMap.state.assets[0]')
  page.evaluate('(id)=>factoryMap.openRecord("assets",id)',asset['id']);page.locator('#asset-edit').click()
  control=page.locator('#asset-dialog .equipment-icon-control')
  assert control.locator('.equipment-icon-current').bounding_box()['height']<70
  assert control.locator('.equipment-icon-preview img').count()==1
  assert page.locator('#asset-dialog .equipment-icon-picker').count()==0
  control.get_by_role('button',name='変更',exact=True).click()
  picker=page.locator('#equipment-icons-dialog');assert picker.locator('.equipment-icon-options button').count()==65
  picker.get_by_label('アイコンの分野').select_option('custom');picker.get_by_role('button',name='工場マーク.png',exact=True).click()
  assert control.locator('[name=icon]').input_value()==custom
  control.get_by_role('button',name='変更',exact=True).click();picker.get_by_label('アイコンの分野').select_option('production')
  picker.get_by_label('アイコンを検索').fill('ロボット');assert picker.locator('.equipment-icon-options button').count()==1
  picker.get_by_role('button',name='産業用ロボット',exact=True).click()
  assert control.locator('[name=icon]').input_value()=='robot'
  page.locator('#asset-dialog').get_by_role('button',name='保存する',exact=True).click();page.locator('#asset-dialog').wait_for(state='hidden')
  assert page.locator('[data-asset-id="'+asset['id']+'"] .symbol-robot').count()==1
  assert page.locator('[data-asset-id="'+asset['id']+'"] .factory-custom-marker').count()==0
  page.reload();page.wait_for_function('window.FactoryPreferences?.getPreferences')
  assert page.evaluate('(id)=>factoryMap.state.assets.find(a=>a.id===id).icon',asset['id'])=='robot'
  page.evaluate('(id)=>factoryMap.openRecord("assets",id)',asset['id']);page.locator('#asset-edit').click()
  control.get_by_role('button',name='変更',exact=True).click();picker.get_by_label('アイコンを検索').fill('存在しない設備xyz')
  assert picker.get_by_text('該当するアイコンがありません。検索語や分野を変えてください。').is_visible()
  page.keyboard.press('Escape');picker.wait_for(state='hidden');assert page.locator('#asset-dialog').is_visible();assert control.locator('[name=icon]').input_value()=='robot'
  control.get_by_role('button',name='変更',exact=True).click();page.screenshot(path='/tmp/factory-map-icon-picker.png',full_page=True)
  page.set_viewport_size({'width':390,'height':844});assert picker.bounding_box()['width']<=390
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  picker.get_by_label('アイコンの分野').select_option('fluid');picker.get_by_label('アイコンを検索').fill('圧力');assert picker.locator('.equipment-icon-options button').count()==2
  page.keyboard.press('Escape');picker.wait_for(state='hidden');page.locator('#asset-dialog .icon-close').click();page.set_viewport_size({'width':1440,'height':1100})
  # Select devices across filters; hidden selections and their saved IDs survive.
  work_id=page.evaluate('factoryMap.state.works[0].id')
  page.evaluate('async id=>{await FactoryAPI.request("/api/works/"+id,{method:"PATCH",body:{assetIds:[]}});await factoryMap.refresh();}',work_id)
  page.evaluate('(id)=>factoryMap.openRecord("works",id)',work_id);page.locator('#work-edit').click()
  devices=page.evaluate('factoryMap.state.assets.slice(0,2)')
  for device in devices:
   page.get_by_label('関連設備を検索').fill(device['code']);page.get_by_label('関連設備の分類').select_option(device['properties']['category'])
   assert page.locator('#work-asset-results input').count()==1
   page.locator('#work-asset-results input').check()
  boxes=page.locator('#work-asset-results .work-asset-option').first.evaluate('(row)=>{const a=row.querySelector("input").getBoundingClientRect(),b=row.querySelector("span").getBoundingClientRect();return {checkboxRight:a.right,textLeft:b.left,checkboxTop:a.top,textTop:b.top};}')
  assert boxes['checkboxRight']<=boxes['textLeft'] and abs(boxes['checkboxTop']-boxes['textTop'])<8,boxes
  assert page.locator('#work-assets-selected button').count()==2
  page.get_by_label('関連設備を検索').fill('該当なしxyz');assert page.locator('.work-asset-empty').is_visible()
  page.get_by_label('関連設備の図面').select_option('floor-a1');assert page.locator('#work-assets-selected button').count()==2
  page.get_by_role('button',name='条件をクリア',exact=True).click();assert page.locator('#work-asset-results input:checked').count()==2
  page.get_by_role('button',name=devices[0]['code']+'の関連付けを解除',exact=True).click();assert page.locator('#work-assets-selected button').count()==1
  page.get_by_label('関連設備を検索').fill(devices[0]['code']);page.locator('#work-asset-results input').check()
  page.locator('#work-assets-label').screenshot(path='/tmp/factory-map-work-equipment-filter.png')
  page.locator('#work-form').get_by_role('button',name='保存する',exact=True).click();page.locator('#work-dialog').wait_for(state='hidden')
  page.reload();page.wait_for_function('window.FactoryPreferences?.getPreferences')
  saved=page.evaluate('(id)=>factoryMap.state.works.find(w=>w.id===id).assetIds',work_id)
  assert set(saved)=={x['id'] for x in devices}
  page.evaluate('(id)=>factoryMap.openRecord("works",id)',work_id);page.locator('#work-edit').click();assert page.locator('#work-assets-selected button').count()==2
  assert page.evaluate('!factoryMap.map.getPane("workEditingPane").hidden')
  page.locator('#work-dialog .icon-close').click()
  assert page.evaluate('factoryMap.map.getPane("workEditingPane").hidden')
  page.locator('#work-add').click();assert page.evaluate('!factoryMap.map.getPane("workEditingPane").hidden')
  page.locator('#draw-cancel').click();assert page.evaluate('factoryMap.map.getPane("workEditingPane").hidden')
  # Small paper is covered by resize grips: a click must edit, a drag must resize.
  page.locator('#note-add').click();page.locator('#map').click(position={'x':360,'y':300})
  page.locator('#note-dialog textarea').fill('小さな付箋の編集テスト');page.locator('#note-size').fill('5')
  page.locator('#note-dialog [type=submit]').click();page.locator('#note-dialog').wait_for(state='hidden')
  note_id=page.evaluate('factoryMap.state.notes.find(n=>n.text==="小さな付箋の編集テスト").id')
  marker=page.locator('[data-note-id="'+note_id+'"]');paper=marker.locator('.sticky-note-paper');paper.scroll_into_view_if_needed();box=paper.bounding_box()
  target=page.evaluate('p=>document.elementFromPoint(p.x,p.y)?.closest("[data-note-id]")?.dataset.noteId',{'x':box['x']+box['width']/2,'y':box['y']+box['height']/2})
  if target!=note_id:
   page.screenshot(path='/tmp/note-ui-intercept.png',full_page=True)
   raise AssertionError((box,page.evaluate('p=>document.elementFromPoint(p.x,p.y)?.outerHTML',{'x':box['x']+box['width']/2,'y':box['y']+box['height']/2})))
  page.mouse.click(box['x']+box['width']/2,box['y']+box['height']/2);page.locator('#note-dialog').wait_for(state='visible')
  page.locator('#note-dialog textarea').fill('編集してDBに保存');page.locator('#note-dialog [type=submit]').click();page.locator('#note-dialog').wait_for(state='hidden')
  page.reload();page.wait_for_function('window.FactoryPreferences?.getPreferences')
  assert page.evaluate('(id)=>factoryMap.state.notes.find(n=>n.id===id).text',note_id)=='編集してDBに保存'
  marker.hover();marker.get_by_role('button',name='付箋を編集',exact=True).click();page.locator('#note-dialog').wait_for(state='visible')
  page.locator('#note-dialog .note-cancel').click()
  handle=marker.locator('[data-note-resize=se]');box=handle.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
  page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+25,y+15,steps=6);page.mouse.up()
  page.wait_for_function('(id)=>factoryMap.state.notes.find(n=>n.id===id).width>204',arg=note_id)
  assert page.locator('#note-dialog[open]').count()==0
  page.locator('#view-mode').click();page.wait_for_function('!factoryMap.editor')
  assert marker.locator('.note-edit-button').count()==0;assert marker.locator('[data-note-resize]').count()==0
  paper.click();page.locator('#note-dialog').wait_for(state='visible');assert page.locator('#note-dialog textarea').count()==0
  assert not errors,errors
  browser.close()
 print('PASS: 64 icons in compact searchable chooser; custom icons and explicit overrides; mobile; work device filters retain/save selection; tiny note edit, DB persistence, drag resize and viewer permissions')
finally:
 server.terminate();server.wait(timeout=10)
