"""PlantDesk presentation, layers, drawing navigation and private registers in a real browser."""
import os,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
server=subprocess.Popen([os.environ.get('FACTORY_MAP_NODE','node'),'tests/map-local-server.mjs'],cwd=ROOT,stdout=subprocess.PIPE,text=True)
try:
 url=server.stdout.readline().strip();assert url.startswith('http://127.0.0.1:'),url
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'),args=['--enable-features=WebMCP'])
  page=browser.new_page(viewport={'width':1536,'height':1100});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(url);page.wait_for_function('window.FactoryPreferences?.getPreferences')
  assert 'PlantDesk' in page.title()
  page.locator('#assets-tab').click();asset=page.evaluate('factoryMap.state.assets[0]');work=page.evaluate('factoryMap.state.works[0]')
  def settings(section):
   page.locator('#factory-customize').click();page.locator('.factory-settings-tabs').get_by_role('button',name=section,exact=True).click()
  settings('設備');page.get_by_label('設備アイコンのサイズ',exact=True).fill('48');page.get_by_label('設備アイコンのサイズ',exact=True).press('Tab');page.get_by_label('設備アイコンのズーム連動',exact=True).select_option('gentle')
  page.locator('.factory-settings-tabs').get_by_role('button',name='工事',exact=True).click();page.get_by_label('工事の吹き出しサイズ',exact=True).fill('16');page.get_by_label('工事の吹き出しサイズ',exact=True).press('Tab');page.get_by_label('工事の吹き出しのズーム連動',exact=True).select_option('gentle');page.evaluate('()=>FactoryPreferences.flush()');page.keyboard.press('Escape')
  marker=page.locator('[data-asset-id="'+asset['id']+'"]');base=page.evaluate('factoryMap.map.getZoom()');large=marker.bounding_box()['width'];font_before=page.locator('.work-label').last.evaluate('el=>parseFloat(getComputedStyle(el).fontSize)')
  page.evaluate('(z)=>factoryMap.map.setZoom(z,{animate:false})',base-2);page.wait_for_function('(before)=>parseFloat(getComputedStyle([...document.querySelectorAll(".work-label")].at(-1)).fontSize)<before*.8',arg=font_before);small=marker.bounding_box()['width'];font_after=page.locator('.work-label').last.evaluate('el=>parseFloat(getComputedStyle(el).fontSize)')
  assert .4<small/large<.8,(small,large);assert .4<font_after/font_before<.8,(font_before,font_after,base,page.evaluate('factoryMap.map.getZoom()'))
  settings('設備');page.get_by_label('設備アイコンのズーム連動',exact=True).select_option('fixed');page.locator('.factory-settings-tabs').get_by_role('button',name='工事',exact=True).click();page.get_by_label('工事の吹き出しのズーム連動',exact=True).select_option('fixed');page.locator('.factory-settings-tabs').get_by_role('button',name='プリセット',exact=True).click();page.get_by_label('表示プリセット名').fill('巡回の表示');page.get_by_role('button',name='現在の表示を保存',exact=True).click();page.evaluate('()=>FactoryPreferences.flush()');page.keyboard.press('Escape')
  fixed=marker.bounding_box()['width'];page.evaluate('(z)=>factoryMap.map.setZoom(z,{animate:false})',base-4);assert abs(marker.bounding_box()['width']-fixed)<.1
  page.reload();page.wait_for_function('window.FactoryPreferences?.getPreferences');assert page.evaluate('FactoryPreferences.getPreferences().appearance.iconSize')==48;assert page.evaluate('FactoryPreferences.getPreferences().appearance.iconScale')=='fixed';assert page.evaluate('FactoryPreferences.getPreferences().displayPresets[0].name')=='巡回の表示'
  settings('全般');page.get_by_label('表示設定を検索').fill('サイズ');assert page.get_by_label('設備アイコンのサイズ',exact=True).is_visible();page.screenshot(path='/tmp/plantdesk-settings.png',full_page=True);page.keyboard.press('Escape')
  # A private equipment layer and a public mixed-content layer.
  page.locator('#layers-toggle').click();page.locator('#layers-manage').click()
  def create_layer(name,public=False):
   form=page.locator('#layer-create');form.get_by_label('レイヤー名',exact=True).fill(name)
   if public:form.get_by_role('checkbox').check()
   form.get_by_role('button',name='レイヤーを追加').click();page.wait_for_function('(name)=>factoryMap.state.layers.some(l=>l.name===name)',arg=name)
  create_layer('空調管理');private_id=page.evaluate('factoryMap.state.layers.find(l=>l.name==="空調管理").id');page.locator('#layer-bulk-category').select_option(asset['properties']['category']);page.locator('#layer-bulk-target').select_option(private_id);page.locator('#layer-bulk-move').click();page.wait_for_function('(id)=>factoryMap.state.assets[0].layerId===id',arg=private_id)
  create_layer('工事とお知らせ',True);public_id=page.evaluate('factoryMap.state.layers.find(l=>l.name==="工事とお知らせ").id');page.locator('#map-layers-dialog .icon-close').click();page.locator('#layers-toggle').click()
  page.evaluate('(id)=>factoryMap.openRecord("works",id)',work['id']);page.locator('#work-edit').click();page.locator('#field-title').fill('履歴に残る工事');page.locator('#work-layer').select_option(public_id);page.locator('#work-form [type=submit]').click();page.locator('#work-dialog').wait_for(state='hidden')
  page.locator('#note-add').click();page.locator('#map').click(position={'x':370,'y':290});page.locator('#note-dialog textarea').fill('公開する案内');page.locator('#note-dialog').get_by_label('配置レイヤー',exact=True).select_option(public_id);page.locator('#note-dialog [type=submit]').click();page.locator('#note-dialog').wait_for(state='hidden');note_id=page.evaluate('factoryMap.state.notes[0].id')
  page.locator('#layers-toggle').click();toggle=page.locator('[data-map-layer="'+public_id+'"]');toggle.uncheck();page.evaluate('()=>FactoryPreferences.flush()');page.wait_for_function('document.querySelectorAll("[data-note-id]").length===0');page.wait_for_function('(id)=>![...document.querySelectorAll(".work-label")].some(el=>el.dataset.workId===id)',arg=work['id'])
  toggle.check();page.evaluate('()=>FactoryPreferences.flush()');page.wait_for_selector('[data-note-id="'+note_id+'"]');page.locator('#layers-toggle').click()
  # Per-equipment locks remain individually controllable.
  page.evaluate('(id)=>factoryMap.openRecord("assets",id)',asset['id']);page.locator('#equipment-item-lock').click();page.wait_for_function('factoryMap.state.assets[0].locks?.attributes===true');page.locator('#equipment-item-lock').click();page.wait_for_function('factoryMap.state.assets[0].locks?.attributes===false')
  # Mark an area, double-click to a child drawing, then use the breadcrumb back.
  page.locator('#fit-map').click();page.locator('#drawing-hierarchy-open').click();page.locator('#drawing-link-add').click()
  def click_map(point,double=False):
   page.locator('#map').scroll_into_view_if_needed();page.evaluate('p=>{factoryMap.map.stop();factoryMap.map.setView([p[1],p[0]],factoryMap.map.getZoom(),{animate:false,reset:true});}',point)
   pos=page.evaluate('p=>{const q=factoryMap.map.latLngToContainerPoint([p[1],p[0]]),r=document.getElementById("map").getBoundingClientRect();return {x:r.left+q.x,y:r.top+q.y}}',point)
   if double:
    page.mouse.dblclick(pos['x'],pos['y'])
   else:page.mouse.click(pos['x'],pos['y'])
  click_map([100,100]);click_map([300,300]);page.locator('#drawing-link-dialog [name=name]').fill('A棟1Fへ');page.get_by_label('移動先の図面',exact=True).select_option('floor-a1');page.locator('#drawing-link-dialog').get_by_role('checkbox').check();page.locator('#drawing-link-dialog [type=submit]').click();page.locator('#drawing-link-dialog').wait_for(state='hidden')
  area=page.evaluate('factoryMap.state.drawingLinks[0]');center=[sum(p[0] for p in area['points'])/len(area['points']),sum(p[1] for p in area['points'])/len(area['points'])]
  click_map(center,True);
  page.wait_for_function('factoryMap.currentDrawing==="floor-a1"');assert 'A棟 / 1F' in page.locator('#drawing-breadcrumb').inner_text();page.locator('#drawing-back').click();page.wait_for_function('factoryMap.currentDrawing==="site"')
  page.reload();page.wait_for_function('window.FactoryPreferences?.getPreferences');assert page.evaluate('factoryMap.state.drawingLinks.length')==1;assert page.evaluate('factoryMap.state.layers.length')==2
  # The register saves user-selected columns, order, filters and per-row locks.
  page.goto(url+'/console.html#equipment');page.locator('.console-header h1').wait_for();assert page.locator('.console-header h1').inner_text()=='設備一覧'
  page.locator('.register-column-picker summary').click();column_panel=page.locator('.register-column-panel');column_panel.get_by_role('checkbox',name='図面',exact=True).check();column_panel.get_by_role('button',name='設備名を左へ',exact=True).click();page.get_by_text('一覧の表示設定を保存しました。',exact=True).wait_for();page.locator('.register-column-picker summary').click()
  page.get_by_label('一覧の設備分類').select_option(asset['properties']['category']);page.get_by_label('設備一覧を検索').fill(asset['code']);page.get_by_label('設備一覧を検索').press('Tab');page.wait_for_function('document.querySelectorAll("[data-register-row]").length===1');page.get_by_text('一覧の表示設定を保存しました。',exact=True).wait_for();page.screenshot(path='/tmp/plantdesk-equipment.png',full_page=True)
  page.reload();page.locator('.console-header h1').wait_for();page.wait_for_function('document.querySelectorAll("[data-register-row]").length===1');assert '設備名' in page.locator('.register-table th').nth(1).inner_text();assert page.get_by_label('一覧の設備分類').input_value()==asset['properties']['category']
  row=page.locator('[data-register-row="'+asset['id']+'"]');row.get_by_role('button',name='ロック',exact=True).click();page.wait_for_function('document.querySelector("[data-register-row]").innerText.includes("位置・属性")');row.get_by_role('button',name='解除',exact=True).click()
  page.get_by_role('button',name='工事一覧',exact=True).click();page.get_by_label('工事一覧を検索').fill('履歴に残る工事');row=page.locator('[data-register-row="'+work['id']+'"]');row.get_by_role('button',name='変更履歴',exact=True).click();page.get_by_role('heading',name='工事の変更履歴',exact=True).wait_for();page.get_by_text('初期記録',exact=True).wait_for();assert '履歴に残る工事' in page.locator('.work-history-dialog').inner_text();page.screenshot(path='/tmp/plantdesk-work-history.png',full_page=True);page.get_by_role('button',name='履歴を閉じる').click()
  page.on('dialog',lambda d:d.accept());row.get_by_role('button',name='削除',exact=True).click();row.wait_for(state='detached');page.get_by_label('削除済み工事の表示').select_option('deleted');row.wait_for(state='visible');row.get_by_role('button',name='変更履歴',exact=True).click();page.get_by_role('heading',name='工事の変更履歴',exact=True).wait_for();page.locator('.work-history-meta b').filter(has_text='削除').wait_for();page.get_by_role('button',name='履歴を閉じる').click()
  # Viewer sees announcements and approved drawing links, never the registers/history API.
  page.goto(url);page.wait_for_function('window.FactoryPreferences?.getPreferences');page.locator('#view-mode').click();page.wait_for_function('!factoryMap.editor');assert page.locator('#assets-tab').is_hidden();assert page.locator('[data-note-id="'+note_id+'"]').is_visible()
  page.goto(url+'/console.html#works');page.get_by_role('heading',name='施設担当モード専用です',exact=True).wait_for();assert page.evaluate('async()=> (await fetch("/api/work-register")).status')==403
  assert not errors,errors
  browser.close()
 print('PASS: gentle/fixed zoom sizes; settings/presets persist; mixed layers; individual locks; child drawing double click/back; private configurable registers; work history/deletion; announcement-only viewer')
finally:
 server.terminate();server.wait(timeout=10)
