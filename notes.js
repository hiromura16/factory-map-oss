/* Plain text sticky notes, stored with the shared map and scoped to one drawing. */
window.FactoryNotes = (() => {
  const $ = (id) => document.getElementById(id);
  const app = () => window.factoryMap;
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  const uid = () =>
    [...crypto.getRandomValues(new Uint8Array(16))]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  const palette = [
    ['黄色', '#fff2ad'],
    ['ピンク', '#ffd6df'],
    ['水色', '#d9eeff'],
    ['緑', '#d9efcb'],
    ['紫', '#eadfff'],
    ['白', '#fffdf3'],
  ];
  const fonts = {
    sans: ['ゴシック', '"Noto Sans JP","Yu Gothic","Hiragino Kaku Gothic ProN",sans-serif'],
    serif: ['明朝', '"Noto Serif JP","Yu Mincho","Hiragino Mincho ProN",serif'],
    mono: ['等幅', '"Noto Sans Mono CJK JP",Consolas,monospace'],
  };
  const markers = new Map();
  const resizeEdges = {
    n: '上',
    e: '右',
    s: '下',
    w: '左',
    ne: '右上',
    se: '右下',
    sw: '左下',
    nw: '左上',
  };
  let group;
  let placing = false;
  let activeResize = null;
  let resizeSaving = false;
  function legacyZoom(drawingId) {
    const drawing = app().state.drawings.find((item) => item.id === drawingId);
    const bounds = drawing?.bounds;
    const width = bounds ? Math.abs(bounds[1][1] - bounds[0][1]) : 800;
    return Math.max(-12, Math.min(8, Math.log2(800 / Math.max(width, 0.000001))));
  }
  function colors(value) {
    const color = /^#[0-9a-f]{6}$/i.test(value || '') ? value.toLowerCase() : '#fff2ad';
    const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    const linear = rgb.map((n) => {
      const v = n / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    const light = luminance < 0.179;
    const edge =
      '#' +
      rgb
        .map((n) =>
          Math.round(n * 0.82 + (light ? 255 * 0.18 : 0))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
    return {
      color,
      ink: light ? '#ffffff' : '#17231c',
      edge,
    };
  }
  function applyColors(element, color) {
    const values = colors(color);
    element.style.setProperty('--note-color', values.color);
    element.style.setProperty('--note-ink', values.ink);
    element.style.setProperty('--note-edge', values.edge);
  }
  function applyTypography(element, note) {
    element.style.fontFamily = (
      Object.hasOwn(fonts, note.fontFamily) ? fonts[note.fontFamily] : fonts.sans
    )[1];
    element.style.fontSize = `${note.fontSize ?? 13}px`;
    if (typeof note.fontColor === 'string' && /^#[0-9a-f]{6}$/i.test(note.fontColor)) {
      element.style.setProperty('--note-ink', note.fontColor);
    }
  }
  function scaleMarker(marker, note, zoom = app().map.getZoom()) {
    note =
      activeResize?.marker === marker ? activeResize.preview : (markers.get(note.id)?.note ?? note);
    const element = marker.getElement();
    if (!element || !Number.isFinite(zoom)) {
      return;
    }
    const paper = element.querySelector('.sticky-note-paper');
    const reference = note.referenceZoom ?? legacyZoom(note.drawingId);
    const scale = ((note.size ?? 100) / 100) * app().map.getZoomScale(zoom, reference);
    const width = note.width ?? 204;
    paper.style.width = `${width}px`;
    paper.style.height = note.height === undefined ? '' : `${note.height}px`;
    paper.classList.toggle('fixed-note-height', note.height !== undefined);
    paper.style.paddingLeft = paper.style.paddingRight = `${Math.min(14, width / 8)}px`;
    paper.style.paddingTop = note.height === undefined ? '' : `${Math.min(18, note.height / 8)}px`;
    paper.style.paddingBottom =
      note.height === undefined ? '' : `${Math.min(14, note.height / 8)}px`;
    paper.style.transform = `scale(${scale})`;
    element.style.width = `${Math.max(24, width * scale)}px`;
    element.style.height = `${Math.max(24, paper.offsetHeight * scale)}px`;
    element.style.marginLeft = `${-14 * scale}px`;
    element.style.marginTop = `${-14 * scale}px`;
  }
  function scaleAll(zoom) {
    for (const { marker, note } of markers.values()) {
      scaleMarker(marker, note, zoom);
    }
  }
  function cancel() {
    if (activeResize) {
      finishResize(false);
    }
    placing = false;
    app()?.map.getContainer().classList.remove('note-placing');
    if ($('note-instruction')) {
      $('note-instruction').hidden = true;
    }
  }
  function beginResize(marker, note, handle, event, pointer = true) {
    if (!app().editor || placing || activeResize || resizeSaving) {
      return;
    }
    note = app().state.notes.find((item) => item.id === note.id) ?? note;
    const map = app().map;
    const paper = marker.getElement().querySelector('.sticky-note-paper');
    const scale =
      ((note.size ?? 100) / 100) *
      map.getZoomScale(map.getZoom(), note.referenceZoom ?? legacyZoom(note.drawingId));
    const handlers = [
      'dragging',
      'touchZoom',
      'scrollWheelZoom',
      'doubleClickZoom',
      'boxZoom',
      'keyboard',
    ].map((name) => ({
      handler: map[name],
      enabled: map[name]?.enabled(),
    }));
    const context = {
      marker,
      note,
      handle,
      edge: handle.dataset.noteResize,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: note.width ?? paper.offsetWidth,
      height: note.height ?? paper.offsetHeight,
      scale,
      anchor: map.project([note.point[1], note.point[0]], map.getZoom()),
      preview: structuredClone(note),
      handlers,
      dragging: marker.dragging?.enabled(),
      changed: false,
      lifecycle: new AbortController(),
    };
    activeResize = context;
    handlers.forEach(({ handler }) => handler?.disable());
    marker.dragging?.disable();
    marker.getElement().classList.add('note-resizing');
    if (pointer) {
      handle.setPointerCapture(event.pointerId);
      const options = {
        signal: context.lifecycle.signal,
      };
      handle.addEventListener(
        'pointermove',
        (e) => {
          if (e.pointerId !== context.pointerId) {
            return;
          }
          e.preventDefault();
          moveResize(e.clientX - context.startX, e.clientY - context.startY);
        },
        options,
      );
      handle.addEventListener(
        'pointerup',
        (e) => {
          if (e.pointerId !== context.pointerId) {
            return;
          }
          e.preventDefault();
          moveResize(e.clientX - context.startX, e.clientY - context.startY);
          finishResize(true);
        },
        options,
      );
      handle.addEventListener('pointercancel', () => finishResize(false), options);
      handle.addEventListener('lostpointercapture', () => finishResize(false), options);
    }
    return context;
  }
  function moveResize(screenX, screenY) {
    const context = activeResize;
    if (!context) {
      return;
    }
    const { width, height, edge, scale, anchor, marker } = context;
    const distance = Math.hypot(/[ew]/.test(edge) ? screenX : 0, /[ns]/.test(edge) ? screenY : 0);
    if (!context.changed && distance < 2) {
      return;
    }
    const clamp = (value) => Math.max(40, Math.min(100000, value));
    const nextWidth = clamp(
      width + (edge.includes('w') ? -screenX : edge.includes('e') ? screenX : 0) / scale,
    );
    const nextHeight = clamp(
      height + (edge.includes('n') ? -screenY : edge.includes('s') ? screenY : 0) / scale,
    );
    const point = app().map.unproject(
      L.point(
        anchor.x + (edge.includes('w') ? width - nextWidth : 0) * scale,
        anchor.y + (edge.includes('n') ? height - nextHeight : 0) * scale,
      ),
      app().map.getZoom(),
    );
    context.preview = {
      ...context.note,
      width: Number(nextWidth.toFixed(6)),
      height: Number(nextHeight.toFixed(6)),
      referenceZoom: context.note.referenceZoom ?? legacyZoom(context.note.drawingId),
      point: [Number(point.lng.toFixed(6)), Number(point.lat.toFixed(6))],
    };
    context.changed = true;
    marker.setLatLng([point.lat, point.lng]);
    scaleMarker(marker, context.preview);
  }
  async function finishResize(save) {
    const context = activeResize;
    if (!context) {
      return;
    }
    activeResize = null;
    context.lifecycle.abort();
    if (context.pointerId !== undefined && context.handle.hasPointerCapture(context.pointerId)) {
      context.handle.releasePointerCapture(context.pointerId);
    }
    context.handlers.forEach(({ handler, enabled }) => {
      if (enabled) {
        handler.enable();
      }
    });
    if (context.dragging && app().editor) {
      context.marker.dragging?.enable();
    }
    context.marker.getElement()?.classList.remove('note-resizing');
    if (!save || !context.changed || !app().editor) {
      context.marker.setLatLng([context.note.point[1], context.note.point[0]]);
      scaleMarker(context.marker, context.note);
      return;
    }
    const entry = markers.get(context.note.id);
    if (entry) {
      entry.note = context.preview;
    }
    resizeSaving = true;
    try {
      await app().changeState(() => {
        const current = app().state.notes.find((note) => note.id === context.note.id);
        if (!current) {
          throw new Error('付箋が見つかりません。最新の情報を読み込んでください。');
        }
        Object.assign(current, {
          width: context.preview.width,
          height: context.preview.height,
          point: context.preview.point,
          referenceZoom: context.preview.referenceZoom,
          updatedAt: new Date().toISOString(),
        });
      });
      app().render();
      app().toast('付箋の縦横サイズを保存しました。');
      if (context.pointerId === undefined) {
        const el = markers.get(context.note.id)?.marker.getElement();
        el?.querySelector(`[data-note-resize="${context.edge}"]`)?.focus();
      }
    } catch (error) {
      app().render();
      app().fail(error);
    } finally {
      resizeSaving = false;
    }
  }
  function bindResizeHandles(marker, note) {
    marker
      .getElement()
      .querySelectorAll('[data-note-resize]')
      .forEach((handle) => {
        let interaction = null;
        L.DomEvent.disableClickPropagation(handle);
        handle.addEventListener('pointerdown', (event) => {
          if (event.button !== 0 || !event.isPrimary) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          interaction = beginResize(marker, note, handle, event);
        });
        // At small zoom levels a grip can cover the entire paper. A click still edits;
        // a drag resizes, without also opening the editor on pointer release.
        handle.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (
            (event.detail === 0 || !interaction?.changed) &&
            !resizeSaving &&
            app().editor &&
            !placing
          ) {
            open(app().state.notes.find((item) => item.id === note.id) ?? note);
          }
        });
        handle.addEventListener('keydown', (event) => {
          const delta = {
            ArrowLeft: [-10, 0],
            ArrowRight: [10, 0],
            ArrowUp: [0, -10],
            ArrowDown: [0, 10],
          }[event.key];
          if (!delta) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const edge = handle.dataset.noteResize;
          if (!(delta[0] && /[ew]/.test(edge)) && !(delta[1] && /[ns]/.test(edge))) {
            return;
          }
          if (
            beginResize(
              marker,
              note,
              handle,
              {
                clientX: 0,
                clientY: 0,
              },
              false,
            )
          ) {
            moveResize(
              delta[0] * (event.shiftKey ? 0.2 : 1),
              delta[1] * (event.shiftKey ? 0.2 : 1),
            );
            finishResize(true);
          }
        });
      });
  }
  function start() {
    if (!app().editor) {
      return;
    }
    app().clearPending();
    placing = true;
    $('show-notes').checked = true;
    render();
    app().map.getContainer().classList.add('note-placing');
    $('note-instruction').hidden = false;
    app().toast('付箋を貼りたい場所をクリックしてください。');
  }
  function open(note = null, point = null) {
    const editor = app().editor;
    if (activeResize || (!editor && !note)) {
      return;
    }
    const appearance = colors(note?.color);
    const size =
      Number.isInteger(note?.size) && note.size >= 1 && note.size <= 300 ? note.size : 100;
    const fontSize =
      Number.isInteger(note?.fontSize) && note.fontSize >= 6 && note.fontSize <= 120
        ? note.fontSize
        : 13;
    const hasFontColor =
      typeof note?.fontColor === 'string' && /^#[0-9a-f]{6}$/i.test(note.fontColor);
    const fontColor = hasFontColor ? note.fontColor : appearance.ink;
    const referenceZoom =
      note?.referenceZoom ?? (note ? legacyZoom(note.drawingId) : app().map.getZoom());
    let dialog = $('note-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'note-dialog';
      dialog.className = 'form-dialog sticky-note-dialog';
      document.body.append(dialog);
    }
    dialog.innerHTML =
      `<div class="dialog-heading"><h2>${editor ? (note ? '付箋を編集' : '付箋を貼る') : '付箋'}</h2><button class="icon-close" type="button" aria-label="閉じる">×</button></div>` +
      (editor
        ? `<form><label>テキスト<textarea name="text" rows="6" maxlength="2000" required placeholder="例：こちらの通路をご利用ください">${escape(note?.text || '')}</textarea></label><div class="note-appearance"><label for="note-size">サイズ</label><div class="note-size-controls"><input id="note-size-slider" type="range" min="1" max="300" step="1" value="${size}" aria-label="付箋のサイズ"><input id="note-size" name="size" type="number" min="1" max="300" step="1" value="${size}" required aria-label="付箋のサイズ（パーセント）"><span>%</span></div><div class="note-color-heading"><label for="note-color">色</label><input id="note-color" name="color" type="color" value="${appearance.color}" aria-label="付箋の色を自由に選ぶ"></div><div class="note-palette">${palette.map(([name, color]) => `<button type="button" data-note-color="${color}" aria-label="${name}" aria-pressed="${appearance.color === color}" style="--swatch:${color}"><span></span></button>`).join('')}</div></div><div class="note-font-controls"><label>フォント<select name="fontFamily" id="note-font-family">${Object.entries(
            fonts,
          )
            .map(
              ([id, [label]]) =>
                `<option value="${id}" ${(note?.fontFamily || 'sans') === id ? 'selected' : ''}>${label}</option>`,
            )
            .join(
              '',
            )}</select></label><label>文字サイズ<input id="note-font-size" name="fontSize" type="number" min="6" max="120" step="1" value="${fontSize}" required><small>6〜120px（付箋サイズ100%時）</small></label><label>文字色<input id="note-font-color" type="color" name="fontColor" value="${fontColor}"></label><label class="checkbox-property"><input id="note-font-auto" type="checkbox" ${hasFontColor ? '' : 'checked'}>背景に合わせて文字色を自動調整</label></div><div id="note-font-preview" class="note-font-preview"></div>${FactoryOrganization.layerInput(note?.layerId)}<p class="form-context">付箋と文字は図面の拡大・縮小に連動します。本文をドラッグで移動、縁や角をドラッグで縦横のサイズを変更できます。</p><p class="form-error" role="alert"></p><div class="dialog-actions">${note ? '<button class="text-link danger note-delete" type="button">付箋を削除</button>' : ''}<button class="button secondary note-cancel" type="button">キャンセル</button><button class="button primary" type="submit">${note ? '保存する' : '貼り付ける'}</button></div></form>`
        : `<p class="sticky-note-fulltext">${escape(note.text)}</p>`);
    dialog.querySelector('.icon-close').onclick = () => dialog.close();
    if (editor) {
      const slider = dialog.querySelector('#note-size-slider');
      const number = dialog.querySelector('#note-size');
      slider.oninput = () => {
        number.value = slider.value;
      };
      number.oninput = () => {
        if (number.validity.valid) {
          slider.value = number.value;
        }
      };
      const colorInput = dialog.querySelector('#note-color');
      const highlight = () =>
        dialog
          .querySelectorAll('[data-note-color]')
          .forEach((button) =>
            button.setAttribute(
              'aria-pressed',
              String(button.dataset.noteColor === colorInput.value),
            ),
          );
      const preview = () => {
        const node = dialog.querySelector('#note-font-preview');
        const sample = {
          color: colorInput.value,
          fontFamily: dialog.querySelector('#note-font-family').value,
          fontSize: Number(dialog.querySelector('#note-font-size').value) || 13,
          fontColor: dialog.querySelector('#note-font-auto').checked
            ? null
            : dialog.querySelector('#note-font-color').value,
        };
        node.textContent = dialog.querySelector('textarea').value || '付箋の文字プレビュー';
        applyColors(node, sample.color);
        applyTypography(node, sample);
      };
      colorInput.oninput = () => {
        highlight();
        preview();
      };
      dialog.querySelectorAll('[data-note-color]').forEach((button) => {
        button.onclick = () => {
          colorInput.value = button.dataset.noteColor;
          highlight();
          preview();
        };
      });
      for (const selector of [
        '#note-font-family',
        '#note-font-size',
        '#note-font-auto',
        'textarea',
      ]) {
        dialog.querySelector(selector).addEventListener('input', preview);
      }
      dialog.querySelector('#note-font-color').oninput = () => {
        dialog.querySelector('#note-font-auto').checked = false;
        preview();
      };
      preview();
      dialog.querySelector('.note-cancel').onclick = () => dialog.close();
      dialog.querySelector('form').onsubmit = async (event) => {
        event.preventDefault();
        const form = new FormData(event.target);
        const text = form.get('text').trim();
        const error = dialog.querySelector('.form-error');
        if (!text) {
          error.textContent = 'テキストを入力してください。';
          return;
        }
        const submit = dialog.querySelector('[type=submit]');
        submit.disabled = true;
        try {
          if (!app().editor) {
            throw new Error('施設グループのパスワードでログインしてください。');
          }
          const record = {
            ...note,
            id: note?.id || uid(),
            drawingId: note?.drawingId || app().currentDrawing,
            point: note?.point || point,
            text,
            layerId: form.get('layerId') || undefined,
            color: form.get('color'),
            size: Number(form.get('size')),
            referenceZoom,
            fontFamily: form.get('fontFamily'),
            fontSize: Number(form.get('fontSize')),
            fontColor: dialog.querySelector('#note-font-auto').checked
              ? null
              : form.get('fontColor'),
            updatedAt: new Date().toISOString(),
          };
          await app().changeState(() => {
            const notes = app().state.notes;
            const index = notes.findIndex((item) => item.id === record.id);
            if (index === -1) {
              notes.push(record);
            } else {
              notes[index] = record;
            }
          });
          dialog.close();
          app().render();
          app().toast(note ? '付箋を更新しました。' : '付箋を貼りました。');
        } catch (e) {
          error.textContent = e.message;
        } finally {
          submit.disabled = false;
        }
      };
      if (note) {
        dialog.querySelector('.note-delete').onclick = async () => {
          if (!confirm('この付箋を削除しますか？')) {
            return;
          }
          const button = dialog.querySelector('.note-delete');
          button.disabled = true;
          try {
            await app().changeState(() => {
              app().state.notes = app().state.notes.filter((item) => item.id !== note.id);
            });
            dialog.close();
            app().render();
            app().toast('付箋を削除しました。');
          } catch (e) {
            dialog.querySelector('.form-error').textContent = e.message;
          } finally {
            button.disabled = false;
          }
        };
      }
    } else {
      const text = dialog.querySelector('.sticky-note-fulltext');
      applyColors(text, note.color);
      applyTypography(text, note);
    }
    dialog.showModal();
    dialog.querySelector('textarea')?.focus();
  }
  function render() {
    if (!group) {
      return;
    }
    if (activeResize) {
      finishResize(false);
    }
    const map = app().map;
    group.clearLayers();
    markers.clear();
    for (const note of app().state.notes || []) {
      if (note.drawingId !== app().currentDrawing || !FactoryOrganization.visible(note)) {
        continue;
      }
      const editable = app().editor;
      const marker = L.marker([note.point[1], note.point[0]], {
        pane: 'stickyNotesPane',
        draggable: editable,
        autoPan: true,
        pmIgnore: true,
        title: editable
          ? '付箋：クリックで編集。本文をドラッグで移動、縁や角をドラッグでサイズ変更'
          : '付箋：クリックで全文を表示',
        icon: L.divIcon({
          className: 'sticky-note-marker' + (editable ? ' editable' : ''),
          html:
            `<div class="sticky-note-paper"><span class="sticky-note-text">${escape(note.text)}</span></div>` +
            (editable
              ? '<button type="button" class="note-edit-button" aria-label="付箋を編集" title="付箋を編集">✎ 編集</button>' +
                Object.entries(resizeEdges)
                  .map(
                    ([edge, label]) =>
                      `<button type="button" class="note-resize-handle resize-${edge}" data-note-resize="${edge}" aria-label="付箋の${label}をドラッグしてサイズ変更" title="ドラッグでサイズ変更（矢印キーでも調整）"></button>`,
                  )
                  .join('')
              : ''),
          iconSize: null,
          iconAnchor: [14, 14],
        }),
      });
      marker.on('add', () => {
        const element = marker.getElement();
        element.dataset.noteId = note.id;
        element.setAttribute('aria-label', '付箋：' + note.text);
        L.DomEvent.disableScrollPropagation(element);
        const paper = element.querySelector('.sticky-note-paper');
        applyColors(paper, note.color);
        applyTypography(paper, note);
        scaleMarker(marker, note);
        if (editable) {
          bindResizeHandles(marker, note);
          const edit = element.querySelector('.note-edit-button');
          L.DomEvent.disableClickPropagation(edit);
          edit.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!placing) {
              open(app().state.notes.find((item) => item.id === note.id) ?? note);
            }
          };
        }
        const observer = new ResizeObserver(() => scaleMarker(marker, note));
        observer.observe(paper);
        marker.once('remove', () => observer.disconnect());
      });
      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        if (!placing) {
          open(note);
        }
      });
      marker.on('dragend', async () => {
        const position = marker.getLatLng();
        try {
          await app().changeState(() => {
            const current = app().state.notes.find((item) => item.id === note.id);
            if (!current) {
              throw new Error('付箋が見つかりません。最新の情報を読み込んでください。');
            }
            current.point = [Number(position.lng.toFixed(2)), Number(position.lat.toFixed(2))];
            current.updatedAt = new Date().toISOString();
          });
          app().render();
          app().toast('付箋を移動しました。');
        } catch (e) {
          app().render();
          app().fail(e);
        }
      });
      markers.set(note.id, {
        marker,
        note,
      });
      group.addLayer(marker);
    }
    if ($('show-notes').checked) {
      if (!map.hasLayer(group)) {
        group.addTo(map);
      }
    } else {
      map.removeLayer(group);
    }
  }
  function setup() {
    const map = app().map;
    map.createPane('stickyNotesPane').style.zIndex = 675;
    group = L.layerGroup();
    map.on('zoom zoomend viewreset', () => scaleAll(map.getZoom()));
    map.on('zoomanim', (event) => scaleAll(event.zoom));
    $('note-add').onclick = start;
    $('note-cancel').onclick = cancel;
    $('show-notes').onchange = render;
    map.on('click', (event) => {
      if (!placing || !app().editor) {
        return;
      }
      const point = [Number(event.latlng.lng.toFixed(2)), Number(event.latlng.lat.toFixed(2))];
      cancel();
      open(null, point);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        cancel();
      }
    });
  }
  return {
    setup,
    render,
    cancel,
  };
})();
