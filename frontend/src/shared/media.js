/* Shared photo editing and previews for equipment and construction notices. */
window.FactoryMedia = (() => {
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
  const isPhoto = (file) =>
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file?.mime);
  const photoURL = (file, thumbnail = true) =>
    '/api/files/' +
    encodeURIComponent(file.fileId || file.id) +
    (thumbnail ? '/thumbnail' : '?inline=1');
  function photos(record) {
    const list = (record.attachments || []).filter(isPhoto);
    const cover = list.findIndex((file) => file.fileId === record.coverPhotoId);
    if (cover > 0) {
      list.unshift(...list.splice(cover, 1));
    }
    return list;
  }
  function gallery(record) {
    const list = photos(record);
    return list.length
      ? '<h3>写真</h3><div class="photo-gallery">' +
          list
            .map(
              (file) =>
                `<button type="button" data-preview="${esc(file.fileId)}" data-name="${esc(file.name)}" data-mime="${esc(file.mime)}"><img loading="lazy" src="${photoURL(file)}" alt="${esc(file.name)}"><span>${esc(file.name)}</span></button>`,
            )
            .join('') +
          '</div>'
      : '';
  }
  function tooltip(record, title) {
    const node = document.createElement('div');
    node.className = 'record-photo-tooltip';
    const heading = document.createElement('strong');
    heading.textContent = title;
    node.append(heading);
    const list = photos(record);
    if (list.length) {
      const strip = document.createElement('div');
      strip.className = 'photo-hover-strip';
      for (const file of list.slice(0, 3)) {
        const img = document.createElement('img');
        img.src = photoURL(file);
        img.alt = file.name;
        img.dataset.photoFileId = file.fileId;
        img.onerror = () => {
          img.classList.add('photo-unavailable');
          img.alt = '写真を表示できません';
        };
        strip.append(img);
      }
      node.append(strip);
      if (list.length > 3) {
        const text = document.createElement('small');
        text.textContent = `ほか${list.length - 3}枚`;
        node.append(text);
      }
    }
    return node;
  }
  function bindHover(layer, record, title, options = {}) {
    if (options.permanent || options.kind === 'work') {
      layer.bindTooltip(esc(title), options);
      if (photos(record).length) {
        layer.on('mouseover', () => {
          layer.setTooltipContent(tooltip(record, title));
          layer.getTooltip()?.getElement()?.classList.add('has-photo-preview');
        });
        layer.on('mouseout', () => {
          layer.setTooltipContent(esc(title));
          layer.getTooltip()?.getElement()?.classList.remove('has-photo-preview');
        });
      }
    } else {
      layer.bindTooltip(() => tooltip(record, title), {
        direction: 'top',
        className: 'equipment-photo-tooltip',
        opacity: 1,
        ...options,
      });
    }
  }
  function editor(container, record = {}, dialog) {
    if (window.FactoryReactPhotos) {
      return FactoryReactPhotos.mount(container, record, dialog);
    }
    const entries = photos(record).map((file, i) => ({
      key: 'existing-' + i,
      file,
    }));
    let cover =
      entries.find((entry) => entry.file.fileId === record.coverPhotoId)?.key ||
      entries[0]?.key ||
      '';
    const urls = [];
    container.innerHTML =
      '<div class="photo-editor-list"></div><label>写真を追加<input type="file" class="photo-input" multiple accept="image/jpeg,image/png,image/webp,image/gif"><small>JPEG・PNG・WebP・GIF、各5MBまで。代表写真をホバー表示の先頭に使います。</small></label>';
    const draw = () => {
      container.querySelector('.photo-editor-list').innerHTML = entries
        .map(
          (entry, i) =>
            `<div class="photo-editor-item"><img loading="lazy" decoding="async" src="${entry.url || photoURL(entry.file)}" alt="${esc(entry.file.name)}"><span>${esc(entry.file.name)}</span><button type="button" class="photo-cover ${entry.key === cover ? 'selected' : ''}" data-cover="${i}">${entry.key === cover ? '✓ 代表写真' : '代表にする'}</button><button type="button" data-remove-photo="${i}" aria-label="写真を外す">×</button></div>`,
        )
        .join('');
      container.querySelectorAll('[data-cover]').forEach(
        (button) =>
          (button.onclick = () => {
            cover = entries[Number(button.dataset.cover)].key;
            draw();
          }),
      );
      container.querySelectorAll('[data-remove-photo]').forEach(
        (button) =>
          (button.onclick = () => {
            const removed = entries.splice(Number(button.dataset.removePhoto), 1)[0];
            if (cover === removed.key) {
              cover = entries[0]?.key || '';
            }
            draw();
          }),
      );
    };
    container.querySelector('.photo-input').onchange = (event) => {
      for (const file of event.target.files) {
        const url = URL.createObjectURL(file);
        urls.push(url);
        entries.push({
          key: crypto.getRandomValues(new Uint32Array(1))[0] + '-' + entries.length,
          file,
          url,
          upload: true,
        });
      }
      if (!cover) {
        cover = entries[0]?.key || '';
      }
      event.target.value = '';
      draw();
    };
    if (dialog) {
      const cleanup = () => {
        if (!dialog.open) {
          urls.forEach((url) => URL.revokeObjectURL(url));
          dialog.removeEventListener('close', cleanup);
        }
      };
      dialog.addEventListener('close', cleanup);
    }
    draw();
    return {
      async read() {
        const uploaded = await FactoryAPI.upload(
          entries.filter((entry) => entry.upload).map((entry) => entry.file),
        );
        let index = 0;
        const mapped = entries.map((entry) => ({
          key: entry.key,
          file: entry.upload ? uploaded[index++] : entry.file,
        }));
        return {
          attachments: mapped.map((entry) => entry.file),
          coverPhotoId: mapped.find((entry) => entry.key === cover)?.file.fileId || '',
        };
      },
    };
  }
  return {
    isPhoto,
    photoURL,
    photos,
    gallery,
    bindHover,
    editor,
  };
})();
