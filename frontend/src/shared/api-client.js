/**
 * 同じホストのAPI呼び出し、台帳のリビジョン、添付アップロードを共用します。
 * 権限とデータの正否はサーバーが判定し、認証切れは共通イベントで画面へ通知します。
 */
window.FactoryAPI = (() => {
  let revision = 0;
  let session = null;
  async function request(path, options = {}) {
    const headers = new Headers(options.headers);
    if (options.body && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
      options.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, {
      ...options,
      headers,
      credentials: 'same-origin',
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        window.dispatchEvent(new Event('factory-session-expired'));
      }
      const error = new Error(value.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return value;
  }
  async function load() {
    if (session === null) {
      try {
        session = await request('/api/session');
        if (!session.saas) {
          session = false;
        }
      } catch (error) {
        if (error.status === 404) {
          session = false;
        } else {
          throw error;
        }
      }
    }
    const result = await request('/api/state');
    revision = result.revision;
    return result.state;
  }
  async function save(state) {
    const r = await request('/api/state', {
      method: 'PUT',
      body: {
        revision,
        state,
      },
    });
    revision = r.revision;
  }
  async function upload(files) {
    if (!files.length) {
      return [];
    }
    const limit = session ? 5 : 30;
    const bytes = session ? 5 : 20;
    if (files.length > limit) {
      throw new Error('一度に' + limit + 'ファイルまでです。');
    }
    for (const file of files) {
      if (!file.size || file.size > bytes * 1024 * 1024) {
        throw new Error('各ファイルは空でない' + bytes + 'MB以下にしてください。');
      }
    }
    if (session && files.reduce((n, f) => n + f.size, 0) > 5 * 1024 * 1024) {
      throw new Error('一度の添付は合計5MBまでです。分けて追加してください。');
    }
    const form = new FormData();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      form.append('file', file);
      if (session && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
        try {
          const bitmap = await createImageBitmap(file);
          if (bitmap.width > 12000 || bitmap.height > 12000) {
            bitmap.close();
            throw new Error('画像は12000px以内にしてください。');
          }
          const scale = Math.min(1, 320 / bitmap.width, 240 / bitmap.height);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close();
          const thumbnail = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
          if (thumbnail) {
            form.append('thumbnail-' + i, thumbnail, 'thumbnail.png');
          }
        } catch (error) {
          // サムネイル生成だけの失敗なら原本を送ります。寸法の上限超過はそのまま拒否します。
          if (error.message.includes('12000')) {
            throw error;
          }
        }
      }
    }
    return (
      await request('/api/files', {
        method: 'POST',
        body: form,
      })
    ).files;
  }
  return {
    request,
    load,
    save,
    upload,
    get revision() {
      return revision;
    },
    get session() {
      return session;
    },
    get saas() {
      return !!session?.saas;
    },
    async refreshSession() {
      session = await request('/api/session');
      return session;
    },
  };
})();
