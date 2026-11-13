/* Same-origin shared API; the server is the authority for permissions and data. */
window.FactoryAPI = (() => {
  let revision = 0;
  async function request(path, options = {}) {
    const headers = new Headers(options.headers);
    if (options.body && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
      options.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, {...options, headers, credentials:'same-origin'});
    const value = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new Event('factory-session-expired'));
      const error = new Error(value.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return value;
  }
  async function load() { const result = await request('/api/state'); revision = result.revision; return result.state; }
  async function save(state) { const r = await request('/api/state', {method:'PUT',body:{revision,state}}); revision = r.revision; }
  async function upload(files) {
    if (!files.length) return [];
    if (files.length > 30) throw new Error('一度に30ファイルまでです。');
    for (const file of files) if (!file.size || file.size > 20*1024*1024) throw new Error('各ファイルは空でない20MB以下にしてください。');
    const form = new FormData(); for (const file of files) form.append('file',file);
    return (await request('/api/files',{method:'POST',body:form})).files;
  }
  return {request,load,save,upload,get revision(){return revision;}};
})();
