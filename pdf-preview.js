/* Render PDFs in the app rather than depending on an installed browser PDF plug-in. */
window.FactoryPDF = (() => {
  let library, active = null;
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function pdfLibrary() {
    if (!library) library = import('/vendor/pdfjs/pdf.mjs').then(module => {
      module.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
      return module;
    });
    return library;
  }

  function dispose(state) {
    if (!state || state.disposed) return;
    state.disposed = true;state.observer?.disconnect();clearTimeout(state.resizeTimer);
    state.render?.cancel();
    void state.loading?.destroy().catch(() => {});
    state.dialog.querySelector('.pdf-page-stage')?.replaceChildren();
    if (active === state) active = null;
  }

  async function render(state) {
    if (active !== state || !state.document || state.disposed) return;
    const sequence = ++state.sequence;
    const status = state.dialog.querySelector('.pdf-status');
    status.textContent = 'ページを表示しています…';
    state.dialog.dataset.pdfReady = 'false';
    state.render?.cancel();
    try {
      const page = await state.document.getPage(state.page);
      if (active !== state || sequence !== state.sequence) return;
      const natural = page.getViewport({scale:1});
      const width = Math.max(160, state.dialog.querySelector('.pdf-page-stage').clientWidth-40);
      const viewport = page.getViewport({scale:Math.min(width,1000)/natural.width * state.zoom});
      const outputScale = Math.min(window.devicePixelRatio || 1,2,Math.sqrt(12000000/(viewport.width*viewport.height)));
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-label', `${state.name} ${state.page}ページ`);
      canvas.width = Math.max(1,Math.floor(viewport.width*outputScale));
      canvas.height = Math.max(1,Math.floor(viewport.height*outputScale));
      canvas.style.width = `${viewport.width}px`;canvas.style.height = `${viewport.height}px`;
      state.dialog.querySelector('.pdf-page-stage').replaceChildren(canvas);
      state.render = page.render({canvasContext:canvas.getContext('2d'),viewport,
        transform:outputScale === 1 ? null : [outputScale,0,0,outputScale,0,0]});
      await state.render.promise;
      if (active !== state || sequence !== state.sequence) return;
      state.dialog.querySelector('#pdf-page').value = state.page;
      state.dialog.querySelector('#pdf-page').max = state.document.numPages;
      state.dialog.querySelector('#pdf-page-total').textContent = `/ ${state.document.numPages}`;
      state.dialog.querySelector('#pdf-prev').disabled = state.page <= 1;
      state.dialog.querySelector('#pdf-next').disabled = state.page >= state.document.numPages;
      state.dialog.querySelector('#pdf-zoom-label').textContent = `${Math.round(state.zoom*100)}%`;
      status.textContent = '';state.dialog.dataset.pdfReady = 'true';
    } catch (error) {
      if (error.name === 'RenderingCancelledException' || active !== state || sequence !== state.sequence) return;
      status.textContent = 'このページを表示できませんでした。「ブラウザーで開く」かダウンロードをご利用ください。';
    }
  }

  async function open(fileId, name) {
    if (active) { active.dialog.close();dispose(active); }
    let dialog = $('file-preview');
    if (!dialog) { dialog = document.createElement('dialog');dialog.id = 'file-preview';document.body.append(dialog); }
    dialog.className = 'form-dialog preview-dialog pdf-preview-dialog';
    dialog.dataset.pdfReady = 'false';
    const source = '/api/files/'+encodeURIComponent(fileId);
    dialog.innerHTML = `<div class="dialog-heading"><h2>${escape(name)}</h2><button class="icon-close" type="button" aria-label="閉じる">×</button></div><div class="pdf-toolbar"><div class="pdf-paging"><button id="pdf-prev" type="button" disabled aria-label="前のページ">←</button><input id="pdf-page" type="number" min="1" value="1" aria-label="表示するページ"><span id="pdf-page-total">/ —</span><button id="pdf-next" type="button" disabled aria-label="次のページ">→</button></div><div class="pdf-zoom"><button id="pdf-zoom-out" type="button" aria-label="縮小">−</button><span id="pdf-zoom-label">100%</span><button id="pdf-zoom-in" type="button" aria-label="拡大">＋</button><button id="pdf-fit" type="button">幅に合わせる</button></div><div class="pdf-links"><a href="${source}?inline=1" target="_blank" rel="noopener">ブラウザーで開く ↗</a><a href="${source}" download>ダウンロード ↓</a></div></div><p class="pdf-status" role="status">PDFを読み込んでいます…</p><div class="pdf-page-stage"></div>`;
    const state = {dialog,name,page:1,zoom:1,sequence:0,disposed:false};active = state;
    dialog.querySelector('.icon-close').onclick = () => dialog.close();
    dialog.addEventListener('close', () => dispose(state), {once:true});
    dialog.showModal();
    dialog.querySelector('#pdf-prev').onclick = () => { if (state.page>1) {state.page--;void render(state);} };
    dialog.querySelector('#pdf-next').onclick = () => { if (state.page<state.document?.numPages) {state.page++;void render(state);} };
    dialog.querySelector('#pdf-page').onchange = event => {
      const value = Number(event.target.value);
      if (Number.isInteger(value) && value>=1 && value<=state.document?.numPages) {state.page=value;void render(state);}
      else event.target.value = state.page;
    };
    dialog.querySelector('#pdf-zoom-out').onclick = () => { state.zoom=Math.max(.25,state.zoom-.25);void render(state); };
    dialog.querySelector('#pdf-zoom-in').onclick = () => { state.zoom=Math.min(3,state.zoom+.25);void render(state); };
    dialog.querySelector('#pdf-fit').onclick = () => { state.zoom=1;void render(state); };
    try {
      const pdf = await pdfLibrary();
      if (active !== state || state.disposed) return;
      state.loading = pdf.getDocument({url:source+'?inline=1',withCredentials:true,isEvalSupported:false,
        cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',
        wasmUrl:'/vendor/pdfjs/wasm/'});
      state.document = await state.loading.promise;
      if (active !== state || state.disposed) return;
      await render(state);
      let width = dialog.querySelector('.pdf-page-stage').clientWidth;
      state.observer = new ResizeObserver(entries => {
        const next = entries[0].contentRect.width;
        if (Math.abs(next-width)<1) return;
        width=next;clearTimeout(state.resizeTimer);state.resizeTimer=setTimeout(() => void render(state),100);
      });
      state.observer.observe(dialog.querySelector('.pdf-page-stage'));
    } catch (error) {
      if (active !== state || state.disposed) return;
      dialog.querySelector('.pdf-status').textContent = error.name === 'PasswordException'
        ? 'このPDFはパスワードで保護されています。「ブラウザーで開く」から確認してください。'
        : 'PDFを読み込めませんでした。「ブラウザーで開く」かダウンロードをご利用ください。';
    }
  }

  function close() { if (active) { const state=active;state.dialog.close();dispose(state); } }
  window.addEventListener('factory-session-expired',close);
  window.addEventListener('factory-mode-changed',event => { if (!event.detail.editor) close(); });
  return {open};
})();
