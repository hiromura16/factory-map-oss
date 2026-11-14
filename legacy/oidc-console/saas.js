/**
 * 汎用OIDCの認可コードとPKCEを試す旧コンソール。現行のAccess認証とは別です。
 * ブラウザーでのクレーム確認は入力補助で、署名と利用権限はAPI側が最終判定します。
 */
(() => {
  'use strict';

  const TX = 'factory-map.oidc-transaction.v1';
  const MAX_AGE = 300000;
  const MAX_BYTES = 750000;
  const $ = (id) => document.getElementById(id);
  let config;
  let token = null;
  let expires = 0;
  let timer;
  let org = null;
  let snapshot = null;
  let fileState = null;
  let preview = null;
  let busy = false;
  let generation = 0;
  const encode = (bytes) =>
    btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
  const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
  function secureURL(value) {
    const u = new URL(value);
    if (
      u.username ||
      u.password ||
      u.hash ||
      !(
        u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
      )
    ) {
      throw new Error('接続先は HTTPS または localhost に限定しています。');
    }
    return u;
  }
  function validateConfig(c, origin = location.origin, path = location.pathname) {
    if (!c || c.enabled !== true) {
      throw new Error('公開設定が未構成です。');
    }
    for (const key of ['issuer', 'authorizationEndpoint', 'tokenEndpoint']) {
      secureURL(c[key]);
    }
    if (typeof c.clientId !== 'string' || !c.clientId || c.clientId.includes('REPLACE')) {
      throw new Error('clientId を設定してください。');
    }
    if (c.issuer.includes('REPLACE')) {
      throw new Error('issuer を設定してください。');
    }
    if (new URL(c.authorizationEndpoint).search || new URL(c.tokenEndpoint).search) {
      throw new Error('認証エンドポイントにクエリは指定できません。');
    }
    secureURL(origin);
    return {
      issuer: c.issuer,
      authorizationEndpoint: c.authorizationEndpoint,
      tokenEndpoint: c.tokenEndpoint,
      clientId: c.clientId,
      redirectUri: origin + path,
    };
  }
  function claims(jwt) {
    if (typeof jwt !== 'string' || jwt.length > 16384) {
      throw new Error('ID トークンが不正です。');
    }
    const parts = jwt.split('.');
    if (parts.length !== 3) {
      throw new Error('ID トークンが不正です。');
    }
    try {
      return JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(atob(parts[1].replaceAll('-', '+').replaceAll('_', '/')), (c) =>
            c.charCodeAt(0),
          ),
        ),
      );
    } catch {
      throw new Error('ID トークンを読み取れません。');
    }
  }
  function verifyClaims(c, tx, cfg = config) {
    const now = Date.now() / 1000;
    if (
      c.iss !== cfg.issuer ||
      c.nonce !== tx.nonce ||
      typeof c.sub !== 'string' ||
      !c.sub ||
      typeof c.exp !== 'number' ||
      !Number.isFinite(c.exp) ||
      c.exp <= now ||
      !(c.aud === cfg.clientId || (Array.isArray(c.aud) && c.aud.includes(cfg.clientId))) ||
      (Array.isArray(c.aud) && c.aud.length > 1 && c.azp !== cfg.clientId) ||
      (c.azp !== undefined && c.azp !== cfg.clientId)
    ) {
      throw new Error('ID トークンの発行元・対象・nonce・期限を確認できません。');
    }
  }
  function tell(text, error = false) {
    $('message').textContent = text;
    $('message').dataset.error = String(error);
  }
  function cleanURL() {
    const u = new URL(location.href);
    for (const k of ['code', 'state', 'error', 'error_description', 'iss', 'session_state']) {
      u.searchParams.delete(k);
    }
    history.replaceState(null, '', u.pathname + u.search);
  }
  function clearImport() {
    fileState = null;
    preview = null;
    $('import-file').value = '';
    $('preview').disabled = true;
    $('apply-import').disabled = true;
    $('preview-result').textContent = 'ファイルを選択してください。';
  }
  function signOut(message = 'このコンソールからログアウトしました。') {
    generation++;
    clearTimeout(timer);
    token = null;
    expires = 0;
    org = null;
    snapshot = null;
    sessionStorage.removeItem(TX);
    cleanURL();
    clearImport();
    $('console').hidden = true;
    $('workspace').hidden = true;
    $('logout').hidden = true;
    $('login').disabled = !config;
    $('auth-state').textContent = '未接続';
    $('org-select').replaceChildren(new Option('選択してください', ''));
    tell(message);
  }
  async function api(path, method = 'GET', body) {
    if (!token || expires <= Date.now()) {
      signOut('ログインの有効期限が切れました。再ログインしてください。');
      throw new Error('再ログインが必要です。');
    }
    const response = await fetch('/api/v1/' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body === undefined
          ? {}
          : {
              'Content-Type': 'application/json',
            }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        signOut('認証が失効しました。再ログインしてください。');
      }
      throw new Error(data.error || 'API の処理に失敗しました。');
    }
    return data;
  }
  async function action(fn) {
    if (busy) {
      return;
    }
    busy = true;
    document.body.setAttribute('aria-busy', 'true');
    const ticket = generation;
    try {
      await fn();
    } catch (e) {
      if (ticket === generation || token) {
        tell(e.message, true);
      }
    } finally {
      busy = false;
      document.body.removeAttribute('aria-busy');
    }
  }
  async function login() {
    const ticket = ++generation;
    token = null;
    clearTimeout(timer);
    sessionStorage.removeItem(TX);
    const tx = {
      state: random(),
      nonce: random(),
      verifier: random(),
      created: Date.now(),
      issuer: config.issuer,
      clientId: config.clientId,
      redirectUri: config.redirectUri,
    };
    const challenge = encode(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tx.verifier))),
    );
    if (ticket !== generation) {
      return;
    }
    sessionStorage.setItem(TX, JSON.stringify(tx));
    const url = new URL(config.authorizationEndpoint);
    for (const [k, v] of Object.entries({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: 'openid profile',
      state: tx.state,
      nonce: tx.nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })) {
      url.searchParams.set(k, v);
    }
    location.assign(url.href);
  }
  async function callback() {
    const u = new URL(location.href);
    if (!u.searchParams.has('code') && !u.searchParams.has('error')) {
      return false;
    }
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    const error = u.searchParams.get('error');
    const iss = u.searchParams.get('iss');
    const stored = sessionStorage.getItem(TX);
    sessionStorage.removeItem(TX);
    cleanURL();
    let tx;
    try {
      tx = JSON.parse(stored);
    } catch {}
    if (
      !tx ||
      state !== tx.state ||
      !Number.isFinite(tx.created) ||
      Date.now() - tx.created < 0 ||
      Date.now() - tx.created > MAX_AGE ||
      tx.issuer !== config.issuer ||
      tx.clientId !== config.clientId ||
      tx.redirectUri !== config.redirectUri ||
      (iss && iss !== config.issuer)
    ) {
      throw new Error('ログイン要求が失効または一致しません。ログインをやり直してください。');
    }
    if (error) {
      throw new Error('IdP でログインが取り消されたか、許可されませんでした。');
    }
    if (
      !code ||
      u.searchParams.getAll('code').length !== 1 ||
      u.searchParams.getAll('state').length !== 1
    ) {
      throw new Error('認証コードが不正です。');
    }
    const ticket = generation;
    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        code,
        code_verifier: tx.verifier,
      }),
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new Error('認証コードを交換できません。IdP の SPA/CORS/PKCE 設定を確認してください。');
    }
    const data = await response.json();
    const c = claims(data.id_token);
    verifyClaims(c, tx);
    if (ticket !== generation) {
      return false;
    }
    token = data.id_token;
    expires = c.exp * 1000;
    timer = setTimeout(
      () => signOut('ログインの有効期限が切れました。'),
      Math.min(expires - Date.now(), 2147483647),
    );
    // デコードした値だけではログインを確定しません。この要求でAPI側のRS256署名検証も通します。
    await listOrganizations(ticket);
    if (ticket !== generation) {
      return false;
    }
    $('console').hidden = false;
    $('logout').hidden = false;
    $('auth-state').textContent = '接続済み';
    $('login').disabled = false;
    tell('ログインしました。組織を選択するか、新規作成してください。');
    return true;
  }
  async function listOrganizations(ticket = generation) {
    const result = await api('organizations');
    if (ticket !== generation) {
      return;
    }
    const select = $('org-select');
    const selected = org?.id;
    select.replaceChildren(new Option('選択してください', ''));
    for (const item of result.items) {
      const option = new Option(item.name, item.id);
      option.dataset.role = item.role;
      select.add(option);
    }
    if (selected && result.items.some((i) => i.id === selected)) {
      select.value = selected;
    } else if (selected) {
      org = null;
      snapshot = null;
      clearImport();
      $('workspace').hidden = true;
    }
  }
  async function loadWorkspace(id) {
    const ticket = ++generation;
    org = null;
    snapshot = null;
    clearImport();
    $('workspace').hidden = true;
    if (!id) {
      return;
    }
    const option = $('org-select').selectedOptions[0];
    const selected = {
      id,
      role: option.dataset.role,
    };
    const data = await api('organizations/' + encodeURIComponent(id) + '/state');
    if (ticket !== generation) {
      return;
    }
    org = selected;
    snapshot = data;
    $('workspace').hidden = false;
    $('role').textContent = org.role;
    $('usage').replaceChildren();
    for (const [key, label] of [
      ['drawings', '図面'],
      ['assets', '設備'],
    ]) {
      const box = document.createElement('div');
      box.textContent = label;
      const value = document.createElement('strong');
      value.textContent =
        data.state[key].length.toLocaleString() + ' / ' + data.limits[key].toLocaleString();
      box.append(value);
      $('usage').append(box);
    }
    $('revision').textContent = 'revision ' + data.revision + ' · ' + data.plan;
    $('plan').value = data.plan;
    $('change-plan').disabled = org.role !== 'owner';
    $('import-file').disabled = !['owner', 'editor'].includes(org.role);
  }
  const orgPath = (op) => 'organizations/' + encodeURIComponent(org.id) + '/' + op;
  function download(data) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'factory-map-export.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (typeof document === 'undefined') {
    module.exports = {
      secureURL,
      validateConfig,
      claims,
      verifyClaims,
    };
    return;
  }
  $('login').onclick = () => action(login);
  $('cancel-login').onclick = () =>
    signOut('ログインを取り消しました。再開するにはログインを押してください。');
  $('logout').onclick = () => signOut();
  $('refresh').onclick = () => action(() => listOrganizations());
  $('org-select').onchange = () => {
    if (busy) {
      $('org-select').value = org?.id || '';
      return;
    }
    action(() => loadWorkspace($('org-select').value));
  };
  $('create-org').onsubmit = (e) => {
    e.preventDefault();
    action(async () => {
      const ticket = generation;
      const result = await api('onboard', 'POST', {
        name: $('org-name').value.trim(),
      });
      if (ticket !== generation) {
        return;
      }
      await listOrganizations(ticket);
      if (ticket !== generation) {
        return;
      }
      $('org-select').value = result.organizationId;
      $('org-name').value = '';
      await loadWorkspace(result.organizationId);
      tell('組織を作成しました。');
    });
  };
  $('billing').onsubmit = (e) => {
    e.preventDefault();
    action(async () => {
      if (!org) {
        return;
      }
      const id = org.id;
      const ticket = generation;
      await api(orgPath('billing'), 'POST', {
        revision: snapshot.revision,
        plan: $('plan').value,
      });
      if (ticket !== generation) {
        return;
      }
      await loadWorkspace(id);
      tell('モックプランを変更しました。請求はありません。');
    });
  };
  $('import-file').onchange = () => {
    if (busy) {
      clearImport();
      tell('処理中です。完了後にファイルを選び直してください。');
      return;
    }
    action(async () => {
      preview = null;
      fileState = null;
      $('apply-import').disabled = true;
      $('preview').disabled = true;
      const file = $('import-file').files[0];
      if (!file) {
        return;
      }
      if (file.size > MAX_BYTES) {
        throw new Error('JSON は750KB以下にしてください。');
      }
      const ticket = generation;
      const parsed = JSON.parse(await file.text());
      if (ticket !== generation) {
        return;
      }
      fileState = parsed;
      $('preview').disabled = false;
      $('preview-result').textContent = '読み込みました。検証を実行してください。';
    });
  };
  $('preview').onclick = () =>
    action(async () => {
      if (!org || !fileState) {
        return;
      }
      const ticket = generation;
      const result = await api(orgPath('import-preview'), 'POST', fileState);
      if (ticket !== generation) {
        return;
      }
      preview = result;
      $('preview-result').textContent = JSON.stringify(
        {
          counts: result.counts,
          history: result.history,
          conflicts: result.conflicts,
          attachmentIds: result.attachmentIds,
          warnings: result.warnings,
          canApply: result.canApply,
        },
        null,
        2,
      );
      $('apply-import').disabled = !result.canApply;
    });
  $('apply-import').onclick = () =>
    action(async () => {
      if (!org || !preview?.canApply) {
        return;
      }
      const ticket = generation;
      const id = org.id;
      $('apply-import').disabled = true;
      await api(orgPath('import'), 'POST', {
        revision: snapshot.revision,
        state: preview.state,
      });
      if (ticket !== generation) {
        return;
      }
      await loadWorkspace(id);
      tell('JSON を取り込みました。既存の地図画面への反映はまだ未接続です。');
    });
  $('export').onclick = () =>
    action(async () => {
      if (!org) {
        return;
      }
      const ticket = generation;
      const data = await api(orgPath('export'));
      if (ticket === generation) {
        download(data);
      }
    });
  (async () => {
    try {
      const r = await fetch('saas-config.json', {
        cache: 'no-store',
        credentials: 'omit',
      });
      if (!r.ok) {
        throw new Error('公開設定が未構成です。');
      }
      config = validateConfig(await r.json());
      $('login').disabled = false;
      await callback();
    } catch (e) {
      clearTimeout(timer);
      token = null;
      expires = 0;
      sessionStorage.removeItem(TX);
      cleanURL();
      $('setup').hidden = !!config;
      tell(e.message, true);
    }
  })();
})();
