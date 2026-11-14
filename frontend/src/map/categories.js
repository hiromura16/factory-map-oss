/**
 * 設備分類の追加・変更・削除と、使用中の設備の分類変更をまとめる画面。
 * 分類定義と参照する設備を同じ台帳更新に含め、片方だけが変わる状態を避けます。
 */
window.FactoryCategories = (() => {
  const app = () => window.factoryMap;
  const esc = (value) =>
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
  function open() {
    if (!app()?.editor) {
      return;
    }
    const definition = app().state.propertyDefinitions.find((d) => d.id === 'category');
    if (definition && definition.type !== 'select') {
      app().toast('分類プロパティの種類を「選択」にしてください。', true);
      return;
    }
    let rows = structuredClone(definition?.options || []);
    const removed = new Map();
    let dialog = document.getElementById('categories-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'categories-dialog';
      dialog.className = 'form-dialog categories-dialog';
      document.body.append(dialog);
    }
    dialog.innerHTML =
      '<div class="dialog-heading"><div><p class="eyebrow">EQUIPMENT CATEGORIES</p><h2>設備分類を管理</h2></div><button type="button" class="icon-close" aria-label="閉じる">×</button></div><p class="form-context">工場に合わせて分類を追加・名前変更・削除できます。保存すると、設備の選択欄・絞り込み・分類別アイコンに反映します。</p><form><div class="category-rows"></div><button type="button" class="button secondary category-add">＋ 分類を追加</button><div class="category-removals"></div><p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button secondary category-cancel">キャンセル</button><button type="submit" class="button primary">変更を保存</button></div></form>';
    dialog.querySelector('.icon-close').onclick = dialog.querySelector('.category-cancel').onclick =
      () => dialog.close();
    const count = (id) => app().state.assets.filter((a) => a.properties?.category === id).length;
    function drawRemovals() {
      const root = dialog.querySelector('.category-removals');
      root.innerHTML = [...removed.values()]
        .filter((row) => count(row.id))
        .map(
          (row) =>
            `<label class="category-removal">「${esc(row.label)}」の設備 ${count(row.id)}台を移動<select data-replace="${esc(row.id)}" aria-label="${esc(row.label)}の移動先">${definition?.required ? '' : '<option value="">未設定にする</option>'}${rows.map((x) => `<option value="${esc(x.id)}">${esc(x.label || '名称未入力')}</option>`).join('')}</select></label>`,
        )
        .join('');
      root.querySelectorAll('[data-replace]').forEach((select) => {
        const row = removed.get(select.dataset.replace);
        if ([...select.options].some((option) => option.value === row.replacement)) {
          select.value = row.replacement;
        }
        row.replacement = select.value;
        select.onchange = () => {
          row.replacement = select.value;
        };
      });
    }
    function draw() {
      const root = dialog.querySelector('.category-rows');
      root.innerHTML = rows
        .map(
          (row, i) =>
            `<div class="category-row"><span class="category-number">${i + 1}</span><input aria-label="分類名 ${i + 1}" data-category-name="${esc(row.id)}" value="${esc(row.label)}" required maxlength="80" placeholder="例：生産設備"><small>${count(row.id)}台</small><button type="button" data-category-remove="${esc(row.id)}" aria-label="分類 ${esc(row.label || String(i + 1))}を削除">削除</button></div>`,
        )
        .join('');
      if (!rows.length) {
        root.innerHTML =
          '<p class="form-context">分類はまだありません。「分類を追加」から登録できます。</p>';
      }
      root.querySelectorAll('[data-category-name]').forEach(
        (input) =>
          (input.oninput = () => {
            rows.find((row) => row.id === input.dataset.categoryName).label = input.value;
            drawRemovals();
          }),
      );
      root.querySelectorAll('[data-category-remove]').forEach(
        (button) =>
          (button.onclick = () => {
            const row = rows.find((row) => row.id === button.dataset.categoryRemove);
            removed.set(row.id, {
              ...row,
              replacement: '',
            });
            rows = rows.filter((x) => x.id !== row.id);
            draw();
          }),
      );
      drawRemovals();
    }
    dialog.querySelector('.category-add').onclick = () => {
      rows.push({
        id: 'category-' + crypto.randomUUID(),
        label: '',
      });
      draw();
      dialog.querySelector('.category-rows .category-row:last-child input').focus();
    };
    dialog.querySelector('form').onsubmit = async (event) => {
      event.preventDefault();
      const button = dialog.querySelector('[type=submit]');
      const error = dialog.querySelector('.form-error');
      button.disabled = true;
      error.textContent = '';
      try {
        const options = rows.map((row) => ({
          id: row.id,
          label: row.label.trim(),
        }));
        if (options.some((row) => !row.label)) {
          throw new Error('分類名を入力してください。');
        }
        if (new Set(options.map((row) => row.label)).size !== options.length) {
          throw new Error('同じ名前の分類があります。名前を変えてください。');
        }
        if (definition?.required && !options.length) {
          throw new Error('必須の分類には、分類を1つ以上残してください。');
        }
        await app().changeState(() => {
          for (const asset of app().state.assets) {
            const row = removed.get(asset.properties?.category);
            if (!row) {
              continue;
            }
            if (asset.locks?.attributes) {
              throw new Error(asset.name + 'の属性ロックを解除してから分類を削除してください。');
            }
            if (row.replacement) {
              if (!options.some((option) => option.id === row.replacement)) {
                throw new Error('削除する分類の移動先を選んでください。');
              }
              asset.properties.category = row.replacement;
            } else if (definition?.required) {
              throw new Error('削除する分類の移動先を選んでください。');
            } else {
              delete asset.properties.category;
            }
          }
          const current = app().state.propertyDefinitions.find((d) => d.id === 'category');
          if (current) {
            current.options = options;
          } else {
            app().state.propertyDefinitions.push({
              id: 'category',
              name: '設備分類',
              type: 'select',
              required: false,
              options,
            });
          }
        });
        app().render();
        dialog.close();
        app().toast('設備分類を保存しました。');
      } catch (failure) {
        error.textContent = failure.message;
      } finally {
        button.disabled = false;
      }
    };
    draw();
    dialog.showModal();
  }
  return {
    open,
  };
})();
