import { ApiError, KINDS, importPreview } from './core.mjs';
import { authenticate } from './auth.mjs';
import { LIMITS, validateMap, visibleState, fileIds, preferences } from './map-validation.mjs';
import {
  TEAM_COLLECTIONS,
  ensureTeam,
  makeTask,
  planPreview,
  generatePlan,
  completeTask,
  teamReport,
  teamToday,
  validDate,
  addDemoTeam,
} from './team.mjs';
import layerSets from '../shared/layer-set-state.js';
import { previewAssets } from './asset-import.mjs';
import { addWorkflowDemo } from './workflow-demo.mjs';
import { makeProject, projectStats, taskBlockers } from './workflow.mjs';
import { notionRoutes } from './notion/routes.mjs';
import seed from '../shared/demo/seed.json' with { type: 'json' };
const now = () => new Date().toISOString();
const enc = new TextEncoder();
const json = (x, status = 200, extra = {}) =>
  new Response(JSON.stringify(x), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra,
    },
  });
const cookie = (name, value) =>
  name + '=' + value + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800';
const readCookie = (r, name) =>
  r.headers
    .get('cookie')
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(name + '='))
    ?.slice(name.length + 1);
const sha = async (s) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
const b64 = (a) => {
  let s = '';
  for (let i = 0; i < a.length; i += 8192) {
    s += String.fromCharCode(...a.slice(i, i + 8192));
  }
  return btoa(s);
};
const un64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function readJSON(request, max = 900000) {
  const bytes = await readBytes(request, max);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, 'JSON形式を確認してください。');
  }
}
async function readBytes(request, max) {
  if (Number(request.headers.get('content-length') || 0) > max) {
    throw new ApiError(413, 'ファイルまたはデータが大きすぎます。');
  }
  const reader = request.body?.getReader();
  if (!reader) {
    throw new ApiError(400, 'データがありません。');
  }
  const parts = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    length += value.byteLength;
    if (length > max) {
      await reader.cancel();
      throw new ApiError(413, 'ファイルまたはデータが大きすぎます。');
    }
    parts.push(value);
  }
  const all = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    all.set(p, offset);
    offset += p.length;
  }
  return all;
}
async function actor(request, env) {
  const access = request.headers.get('cf-access-jwt-assertion');
  let identity;
  if (access && env.ACCESS_AUD) {
    const r = new Request(request.url, {
      headers: {
        authorization: 'Bearer ' + access,
      },
    });
    identity = await authenticate(r, {
      AUTH_ISSUER: env.ACCESS_TEAM,
      AUTH_AUDIENCE: env.ACCESS_AUD,
      AUTH_JWKS_URL: env.ACCESS_TEAM + '/cdn-cgi/access/certs',
    });
  } else {
    throw new ApiError(401, 'Cloudflare Accessでログインしてください。');
  }
  const id = await sha(JSON.stringify([identity.issuer, identity.subject]));
  return {
    id,
    identity,
  };
}
function seedState(profile) {
  const s = {
    ...structuredClone(seed),
    layers: [],
    drawingLinks: [],
    layerSets: [],
  };
  if (profile === 'free') {
    s.assets = s.assets.slice(0, 12);
    const ids = new Set(s.assets.map((a) => a.id));
    s.works.forEach((w) => (w.assetIds = (w.assetIds || []).filter((id) => ids.has(id))));
  }
  function clean(x) {
    if (Array.isArray(x)) {
      return x.map(clean);
    }
    if (!x || typeof x !== 'object') {
      return x;
    }
    return Object.fromEntries(
      Object.entries(x).map(([k, v]) => [k, k === 'attachments' ? [] : clean(v)]),
    );
  }
  return clean(s);
}
async function bootstrap(env, user) {
  const uid = user.id;
  const when = now();
  await env.DB.prepare('INSERT OR IGNORE INTO users(id,issuer,subject,created_at) VALUES(?,?,?,?)')
    .bind(uid, user.identity.issuer, user.identity.subject, when)
    .run();
  for (const profile of ['free', 'pro']) {
    const id = 'demo-' + profile + '-' + uid.slice(0, 32);
    await env.DB.batch([
      env.DB.prepare(
        'INSERT OR IGNORE INTO organizations(id,name,plan,state_json,updated_at) VALUES(?,?,?,?,?)',
      ).bind(
        id,
        profile === 'pro' ? 'Pro 管理者デモ' : 'Free デモ',
        profile,
        JSON.stringify(seedState(profile)),
        when,
      ),
      env.DB.prepare(
        'INSERT OR IGNORE INTO memberships(organization_id,user_id,role) VALUES(?,?,?)',
      ).bind(id, uid, profile === 'pro' ? 'owner' : 'editor'),
      env.DB.prepare(
        'INSERT OR IGNORE INTO demo_profiles(user_id,profile,organization_id) VALUES(?,?,?)',
      ).bind(uid, profile, id),
      env.DB.prepare(
        "INSERT OR IGNORE INTO map_work_events(id,organization_id,work_id,action,actor_id,reason,revision,after_json,created_at) SELECT 'baseline:'||o.id||':'||json_extract(w.value,'$.id'),o.id,json_extract(w.value,'$.id'),'baseline',?,'デモ台帳の初期記録',o.revision,w.value,? FROM organizations o,json_each(o.state_json,'$.works') w WHERE o.id=?",
      ).bind(uid, when, id),
    ]);
  }
}
async function context(request, env) {
  if (!env.DB) {
    throw new ApiError(503, 'データベースが未設定です。');
  }
  const user = await actor(request, env);
  // Idempotent first login; workspaces are private to the authenticated SSO subject.
  const found = await env.DB.prepare('SELECT count(*) AS n FROM demo_profiles WHERE user_id=?')
    .bind(user.id)
    .first();
  if (found.n !== 2) {
    await bootstrap(env, user);
  }
  const requested =
    request.headers.get('x-factory-profile') || readCookie(request, 'factory_profile') || 'pro';
  const profile = requested === 'free' ? 'free' : 'pro';
  const org = await env.DB.prepare(
    'SELECT o.*,m.role FROM organizations o JOIN demo_profiles p ON p.organization_id=o.id JOIN memberships m ON m.organization_id=o.id AND m.user_id=p.user_id WHERE p.user_id=? AND p.profile=? AND m.active=1',
  )
    .bind(user.id, profile)
    .first();
  if (!org) {
    throw new ApiError(403, 'このデモにアクセスできません。');
  }
  const state = JSON.parse(org.state_json);
  state.layers ??= [];
  state.drawingLinks ??= [];
  state.layerSets ??= [];
  ensureTeam(state);
  return {
    user,
    org,
    state,
    profile,
    editor:
      readCookie(request, 'factory_mode') !== 'viewer' && ['owner', 'editor'].includes(org.role),
    limits: LIMITS[org.plan],
  };
}
function editable(c) {
  if (!c.editor || !['owner', 'editor'].includes(c.org.role)) {
    throw new ApiError(403, '施設担当モードに切り替えてください。');
  }
}
function owner(c) {
  if (c.org.role !== 'owner') {
    throw new ApiError(403, '管理者アカウントの機能です。');
  }
}
async function validateFiles(env, c, state) {
  for (const id of fileIds(state)) {
    const f = await env.DB.prepare('SELECT id FROM map_files WHERE id=? AND organization_id=?')
      .bind(id, c.org.id)
      .first();
    if (!f) {
      throw new ApiError(422, '添付ファイルが存在しないか、別アカウントに属しています。');
    }
  }
}
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
function taskChanges(previous, next) {
  const before = new Map((previous.tasks || []).map((t) => [t.id, t]));
  const after = new Map((next.tasks || []).map((t) => [t.id, t]));
  return [...new Set([...before.keys(), ...after.keys()])].flatMap((id) => {
    const a = before.get(id);
    const b = after.get(id);
    if (canonical(a) === canonical(b)) {
      return [];
    }
    return [
      {
        id: crypto.randomUUID(),
        taskId: id,
        action: !a ? 'created' : !b ? 'deleted' : 'updated',
        before: a || null,
        after: b || null,
        files: [...new Set([...fileIds(a), ...fileIds(b)])],
      },
    ];
  });
}
function workChanges(previous, next) {
  const before = new Map(previous.works.map((w) => [w.id, w]));
  const after = new Map(next.works.map((w) => [w.id, w]));
  return [...new Set([...before.keys(), ...after.keys()])].flatMap((id) => {
    const a = before.get(id);
    const b = after.get(id);
    if (canonical(a) === canonical(b)) {
      return [];
    }
    return [
      {
        id: crypto.randomUUID(),
        workId: id,
        action: !a ? 'created' : !b ? 'deleted' : 'updated',
        before: a || null,
        after: b || null,
        files: [...new Set([...fileIds(a), ...fileIds(b)])],
      },
    ];
  });
}
async function historyFileIds(env, c) {
  const r = await env.DB.prepare(
    "SELECT DISTINCT j.value AS id FROM (SELECT organization_id,file_ids FROM map_work_events UNION ALL SELECT organization_id,file_ids FROM map_task_events) e,json_each(e.file_ids) j WHERE e.organization_id=? AND j.type='text'",
  )
    .bind(c.org.id)
    .all();
  return r.results.map((x) => x.id);
}
export async function commit(
  env,
  c,
  next,
  action,
  expected = c.org.revision,
  extraTaskEvents = [],
) {
  if (expected !== c.org.revision) {
    throw new ApiError(409, 'ほかの更新があります。画面を更新してから保存してください。');
  }
  const state = validateMap(next, c.org.plan, c.state);
  await validateFiles(env, c, state);
  const when = now();
  const events = workChanges(c.state, state);
  const taskEvents = [...taskChanges(c.state, state), ...extraTaskEvents];
  const r = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO map_work_events(id,organization_id,work_id,action,actor_id,reason,revision,before_json,after_json,file_ids,created_at) SELECT json_extract(e.value,'$.id'),?,json_extract(e.value,'$.workId'),json_extract(e.value,'$.action'),?,?,?,json_extract(e.value,'$.before'),json_extract(e.value,'$.after'),json_extract(e.value,'$.files'),? FROM json_each(?) e WHERE EXISTS(SELECT 1 FROM organizations WHERE id=? AND revision=? AND plan=?)",
    ).bind(
      c.org.id,
      c.user.id,
      action,
      expected + 1,
      when,
      JSON.stringify(events),
      c.org.id,
      expected,
      c.org.plan,
    ),
    env.DB.prepare(
      "INSERT INTO map_task_events(id,organization_id,task_id,action,actor_id,reason,revision,before_json,after_json,comment,file_ids,created_at) SELECT json_extract(e.value,'$.id'),?,json_extract(e.value,'$.taskId'),json_extract(e.value,'$.action'),?,?,?,json_extract(e.value,'$.before'),json_extract(e.value,'$.after'),json_extract(e.value,'$.comment'),COALESCE(json_extract(e.value,'$.files'),'[]'),? FROM json_each(?) e WHERE EXISTS(SELECT 1 FROM organizations WHERE id=? AND revision=? AND plan=?)",
    ).bind(
      c.org.id,
      c.user.id,
      action,
      expected + 1,
      when,
      JSON.stringify(taskEvents),
      c.org.id,
      expected,
      c.org.plan,
    ),
    env.DB.prepare(
      'INSERT INTO audit_events(id,organization_id,actor_id,action,revision,created_at) SELECT ?,id,?,?,revision+1,? FROM organizations WHERE id=? AND revision=? AND plan=?',
    ).bind(crypto.randomUUID(), c.user.id, action, when, c.org.id, expected, c.org.plan),
    env.DB.prepare(
      'UPDATE organizations SET state_json=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND plan=?',
    ).bind(JSON.stringify(state), when, c.org.id, expected, c.org.plan),
  ]);
  if (r[r.length - 1].meta.changes !== 1) {
    throw new ApiError(409, '同時更新を検出しました。再読み込みしてください。');
  }
  return expected + 1;
}
function stats(state) {
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const latest = (a) => [...a.history].sort((a, b) => b.date.localeCompare(a.date))[0];
  const dueDate = (a) => a.properties?.nextInspection || latest(a)?.nextDate;
  const due = state.assets.filter((a) => dueDate(a) && dueDate(a) <= today);
  return {
    drawings: state.drawings.length,
    works: state.works.length,
    assets: state.assets.length,
    notes: state.notes.length,
    properties: state.propertyDefinitions.length,
    inspections: state.assets.reduce((n, a) => n + a.history.length, 0),
    attention: state.assets.filter((a) => latest(a)?.result === 'attention').length,
    due: due.map((a) => ({
      id: a.id,
      name: a.name,
      code: a.code,
      date: dueDate(a),
    })),
    activeWorks: state.works.filter((w) => w.status === 'active').length,
  };
}
async function settings(env, c) {
  const p = await env.DB.prepare(
    'SELECT value_json FROM map_preferences WHERE user_id=? AND organization_id=?',
  )
    .bind(c.user.id, c.org.id)
    .first();
  return p ? JSON.parse(p.value_json) : preferences({}, c.org.plan);
}
function mutate(state, kind, id, method, input) {
  const key = kind === 'properties' ? 'propertyDefinitions' : kind;
  const list = state[key];
  if (!list) {
    throw new ApiError(404, '対象がありません。');
  }
  let record;
  const index = list.findIndex((x) => x.id === id);
  if (method === 'POST' && ['tasks', 'projects'].includes(key)) {
    record = (key === 'tasks' ? makeTask : makeProject)(input);
    if (list.some((x) => x.id === record.id)) {
      throw new ApiError(409, 'IDが重複しています。');
    }
    list.push(record);
  } else if (method === 'POST') {
    record = {
      ...input,
      id: input.id || crypto.randomUUID(),
      updatedAt: now(),
    };
    if (list.some((x) => x.id === record.id)) {
      throw new ApiError(409, 'IDが重複しています。');
    }
    if (key === 'assets') {
      record.history ??= [];
      record.attachments ??= [];
      record.properties ??= {};
    }
    list.push(record);
  } else if (index < 0) {
    throw new ApiError(404, '対象が見つかりません。');
  } else if (method === 'PATCH' && ['tasks', 'projects'].includes(key)) {
    record = (key === 'tasks' ? makeTask : makeProject)(input, list[index]);
    list[index] = record;
  } else if (method === 'PATCH') {
    record = {
      ...list[index],
      ...input,
      id,
      updatedAt: now(),
    };
    list[index] = record;
  } else if (method === 'DELETE') {
    if (
      key === 'assets' &&
      (state.tasks.some((t) => t.assetId === id) ||
        state.inspectionPlans.some((p) => p.assetIds.includes(id)))
    ) {
      throw new ApiError(409, '作業・点検計画で使用中の設備です。先に関連を整理してください。');
    }
    if (key === 'works' && state.tasks.some((t) => t.workId === id)) {
      throw new ApiError(409, '作業から参照されています。先に関連工事の指定を外してください。');
    }
    if (
      key === 'teamMembers' &&
      (state.tasks.some((t) => t.assigneeId === id) ||
        state.inspectionPlans.some((p) => p.assigneeId === id))
    ) {
      throw new ApiError(
        409,
        '担当作業が残っています。担当者を休止するか、割り当てを変更してください。',
      );
    }
    record = list.splice(index, 1)[0];
    if (key === 'propertyDefinitions') {
      state.assets.forEach((a) => delete a.properties[id]);
    }
    if (key === 'assets') {
      state.works.forEach((w) => (w.assetIds = (w.assetIds || []).filter((x) => x !== id)));
    }
    if (key === 'layers') {
      for (const set of state.layerSets) {
        set.rules = set.rules.filter((r) => r.layerId !== id);
      }
    }
    if (key === 'layers') {
      for (const x of [...state.assets, ...state.works, ...state.notes, ...state.drawingLinks]) {
        if (x.layerId === id) {
          delete x.layerId;
        }
      }
    }
  } else {
    throw new ApiError(405, 'この操作に対応していません。');
  }
  return record;
}
function visibleFile(c, id, _prefs) {
  return c.editor || fileIds(visibleState(c.state, false)).includes(id);
}
async function upload(request, env, c) {
  editable(c);
  const bytes = await readBytes(request, 6 * 1024 * 1024);
  const form = await new Request(request.url, {
    method: 'POST',
    headers: {
      'content-type': request.headers.get('content-type') || '',
    },
    body: bytes,
  }).formData();
  const files = form.getAll('file');
  if (!files.length || files.length > 5) {
    throw new ApiError(422, '一度に1〜5ファイルを選んでください。');
  }
  const output = [];
  if (files.reduce((n, f) => n + (f.size || 0), 0) > 5 * 1024 * 1024) {
    throw new ApiError(413, '一度のアップロードは合計5MBまでです。分けて添付してください。');
  }
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (typeof f === 'string' || !f.size || f.size > 5 * 1024 * 1024) {
      throw new ApiError(413, '各ファイルは5MB以下にしてください。');
    }
    const data = new Uint8Array(await f.arrayBuffer());
    let mime = 'application/octet-stream';
    const declared = f.type;
    if (data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71) {
      mime = 'image/png';
    } else if (data[0] === 255 && data[1] === 216 && data[2] === 255) {
      mime = 'image/jpeg';
    } else if (String.fromCharCode(...data.slice(0, 4)) === 'GIF8') {
      mime = 'image/gif';
    } else if (
      String.fromCharCode(...data.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...data.slice(8, 12)) === 'WEBP'
    ) {
      mime = 'image/webp';
    } else if (String.fromCharCode(...data.slice(0, 5)) === '%PDF-') {
      mime = 'application/pdf';
    } else if (declared === 'text/plain' || /\.(csv|dxf|txt|json)$/i.test(f.name)) {
      mime = 'text/plain';
    }
    const thumbnail = form.get('thumbnail-' + i);
    let thumb = null;
    if (thumbnail && typeof thumbnail !== 'string' && thumbnail.size <= 150000) {
      const a = new Uint8Array(await thumbnail.arrayBuffer());
      if (a[0] === 137 && a[1] === 80 && a[2] === 78 && a[3] === 71) {
        thumb = b64(a);
      }
    }
    const id = crypto.randomUUID();
    const // 制御文字を除き、安全な添付ファイル名に正規化します。
      // eslint-disable-next-line no-control-regex
      name = f.name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) || 'file';
    const queries = [
      env.DB.prepare(
        'INSERT INTO map_files(id,organization_id,name,mime,size,thumbnail,created_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(size),0) FROM map_files WHERE organization_id=?) + ? <= ?',
      ).bind(id, c.org.id, name, mime, f.size, thumb, now(), c.org.id, f.size, c.limits.storage),
    ];
    for (let offset = 0, ordinal = 0; offset < data.length; offset += 196608, ordinal++) {
      queries.push(
        env.DB.prepare(
          'INSERT INTO map_file_chunks(file_id,ordinal,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM map_files WHERE id=?)',
        ).bind(id, ordinal, b64(data.slice(offset, offset + 196608)), id),
      );
    }
    const r = await env.DB.batch(queries);
    if (r[0].meta.changes !== 1) {
      throw new ApiError(
        409,
        '保存容量の上限です。不要なファイルを削除するか、Proデモをお試しください。',
      );
    }
    output.push({
      id,
      fileId: id,
      name,
      mime,
      size: f.size,
    });
  }
  return json(
    {
      files: output,
    },
    201,
  );
}
async function fileResponse(request, env, c, id, thumbnail) {
  const f = await env.DB.prepare('SELECT * FROM map_files WHERE id=? AND organization_id=?')
    .bind(id, c.org.id)
    .first();
  if (!f || !visibleFile(c, id, await settings(env, c))) {
    throw new ApiError(404, 'ファイルがありません。');
  }
  let data;
  let mime = f.mime;
  if (thumbnail && f.thumbnail) {
    data = un64(f.thumbnail);
    mime = 'image/png';
  } else {
    const chunks = await env.DB.prepare(
      'SELECT data FROM map_file_chunks WHERE file_id=? ORDER BY ordinal',
    )
      .bind(id)
      .all();
    data = new Uint8Array(f.size);
    let offset = 0;
    for (const row of chunks.results) {
      const part = un64(row.data);
      data.set(part, offset);
      offset += part.length;
    }
    if (offset !== f.size) {
      throw new ApiError(500, 'ファイルが不完全です。');
    }
  }
  const inline =
    ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime) &&
    (thumbnail || new URL(request.url).searchParams.has('inline'));
  return new Response(data, {
    headers: {
      'content-type': mime,
      'content-length': String(data.length),
      'content-disposition':
        (inline ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(f.name),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}
function routePath(url) {
  return url.pathname.replace(/\/$/, '') || '/';
}
export async function handleMap(request, env) {
  const url = new URL(request.url);
  const path = routePath(url);
  const method = request.method;
  const origin = request.headers.get('origin');
  if (
    !['GET', 'HEAD'].includes(method) &&
    ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site')
  ) {
    throw new ApiError(403, '別サイトからの変更は許可されていません。');
  }
  const c = await context(request, env);
  const state = c.state;
  if (path.startsWith('/api/notion/')) {
    editable(c);
    return notionRoutes(request, env, c, {
      readJSON,
      commit,
      mutate,
    });
  }
  if (path === '/api/session') {
    return json({
      saas: true,
      sso: 'Cloudflare Access',
      profile: c.profile,
      editor: c.editor,
      role: c.org.role,
      organization: {
        id: c.org.id,
        name: c.org.name,
      },
      plan: c.org.plan,
      limits: c.limits,
      mockBilling: true,
      profiles: [
        {
          id: 'free',
          name: '無料デモ',
          plan: 'free',
          role: 'editor',
        },
        {
          id: 'pro',
          name: '有料管理者デモ',
          plan: 'pro',
          role: 'owner',
        },
      ],
      preferences: await settings(env, c),
    });
  }
  if (path === '/api/demo/profile' && method === 'POST') {
    const input = await readJSON(request);
    if (!['free', 'pro'].includes(input.profile)) {
      throw new ApiError(422, 'アカウントを選択してください。');
    }
    return json(
      {
        profile: input.profile,
      },
      200,
      {
        'set-cookie': cookie('factory_profile', input.profile),
      },
    );
  }
  if (path === '/api/health') {
    return json({
      ok: true,
      database: 'Cloudflare D1',
      version: '2.4.0',
      billing: 'demo-no-payments',
    });
  }
  if (path === '/api/capabilities') {
    return json({
      version: '2.4.0',
      authentication: 'Cloudflare Access SSO',
      billing: 'demo-no-payments',
      webmcp: true,
      tools: 87,
      profile: c.profile,
      plan: c.org.plan,
      limits: c.limits,
      fileLimitBytes: 5 * 1024 * 1024,
      snapshotLimitBytes: 750000,
      features: [
        'works',
        'assets',
        'drawings',
        'properties',
        'notes',
        'inspection-history',
        'photo-thumbnails',
        'pdf-preview',
        'shared-icons',
        'shared-preferences',
        'csv-history-import',
        'json-import-export',
        'backups',
        'audit',
        'demo-accounts',
        'display-presets',
        'custom-layers',
        'drawing-hierarchy',
        'work-history',
        'configurable-registers',
        'layer-sets',
        'equipment-json-import',
        'team-workboard',
        'inspection-plans',
        'task-history',
        'handover-reports',
        'notion-polling-sync',
        'notion-connector',
        'team-projects',
        'task-dependencies',
        'task-subtasks',
        'acceptance-criteria',
      ],
    });
  }
  if (path === '/api/auth/status') {
    return json({
      editor: c.editor,
      role: c.org.role,
      sso: true,
    });
  }
  if (path === '/api/auth/login' && method === 'POST') {
    if (!['owner', 'editor'].includes(c.org.role)) {
      throw new ApiError(403, '施設担当者の権限が必要です。');
    }
    return json(
      {
        editor: true,
        sso: true,
      },
      200,
      {
        'set-cookie': cookie('factory_mode', 'facility'),
      },
    );
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    return json(
      {
        editor: false,
      },
      200,
      {
        'set-cookie': cookie('factory_mode', 'viewer'),
      },
    );
  }
  if (path === '/api/auth/password') {
    throw new ApiError(409, 'SSOを使用しています。パスワードの管理は不要です。');
  }
  if (path === '/api/preferences') {
    if (method === 'GET') {
      return json({
        preferences: await settings(env, c),
      });
    }
    const p = preferences(await readJSON(request), c.org.plan);
    for (const icon of p.icons) {
      const f = await env.DB.prepare(
        "SELECT id FROM map_files WHERE id=? AND organization_id=? AND mime='image/png'",
      )
        .bind(icon.fileId, c.org.id)
        .first();
      if (!f) {
        throw new ApiError(422, 'アイコン画像を先に登録してください。');
      }
    }
    await env.DB.prepare(
      'INSERT INTO map_preferences(user_id,organization_id,value_json) VALUES(?,?,?) ON CONFLICT(user_id,organization_id) DO UPDATE SET value_json=excluded.value_json',
    )
      .bind(c.user.id, c.org.id, JSON.stringify(p))
      .run();
    return json({
      preferences: p,
    });
  }
  if (path === '/api/state') {
    if (method === 'GET') {
      return json({
        state: visibleState(state, c.editor),
        revision: c.org.revision,
      });
    }
    editable(c);
    const input = await readJSON(request);
    const revision = await commit(env, c, input.state, 'state.update', input.revision);
    return json({
      revision,
    });
  }
  if (path === '/api/stats') {
    return json(stats(visibleState(state, c.editor)));
  }
  if (path === '/api/dashboard') {
    editable(c);
    const usage = await env.DB.prepare(
      'SELECT COALESCE(SUM(size),0) AS storage,count(*) AS files FROM map_files WHERE organization_id=?',
    )
      .bind(c.org.id)
      .first();
    return json({
      ...stats(visibleState(state, c.editor)),
      usage: {
        ...usage,
        drawings: state.drawings.length,
        assets: state.assets.length,
      },
      limits: c.limits,
      plan: c.org.plan,
    });
  }
  if (path === '/api/files' && method === 'POST') {
    return upload(request, env, c);
  }
  const file = path.match(/^\/api\/files\/([a-zA-Z0-9-]+)(\/thumbnail)?$/);
  if (file && method === 'GET') {
    return fileResponse(request, env, c, file[1], !!file[2]);
  }
  if (path === '/api/files' && method === 'GET') {
    editable(c);
    const r = await env.DB.prepare(
      'SELECT id,name,mime,size,created_at FROM map_files WHERE organization_id=? ORDER BY created_at DESC LIMIT 500',
    )
      .bind(c.org.id)
      .all();
    const retained = new Set(await historyFileIds(env, c));
    const used = new Set([
      ...fileIds(state),
      ...retained,
      ...(await settings(env, c)).icons.map((x) => x.fileId),
    ]);
    return json({
      items: r.results.map((x) => ({
        ...x,
        referenced: used.has(x.id),
        historyReferenced: retained.has(x.id),
      })),
    });
  }
  if (file && method === 'DELETE') {
    editable(c);
    const retained = new Set(await historyFileIds(env, c));
    if (retained.has(file[1])) {
      throw new ApiError(409, '工事・作業の変更履歴に保存された資料は削除できません。');
    }
    const ids = new Set([
      ...fileIds(state),
      ...(await settings(env, c)).icons.map((x) => x.fileId),
    ]);
    if (ids.has(file[1])) {
      throw new ApiError(409, '使用中の資料・アイコンは先に参照を外してください。');
    }
    await env.DB.batch([
      env.DB.prepare(
        'DELETE FROM map_file_chunks WHERE file_id IN (SELECT id FROM map_files WHERE id=? AND organization_id=?)',
      ).bind(file[1], c.org.id),
      env.DB.prepare('DELETE FROM map_files WHERE id=? AND organization_id=?').bind(
        file[1],
        c.org.id,
      ),
    ]);
    return json({
      deleted: true,
    });
  }
  if (path === '/api/export' && method === 'GET') {
    return json({
      state: visibleState(state, c.editor),
      revision: c.org.revision,
      exportedAt: now(),
      format: 'factory-map-json-v2',
    });
  }
  if (path === '/api/import-preview' && method === 'POST') {
    editable(c);
    const input = await readJSON(request);
    const imported = validateMap(input.state || input, c.org.plan);
    const p = importPreview(imported, {}, c.org.plan);
    return json({
      ...p,
      canApply: p.attachmentIds.length === 0,
      mode: 'replace-after-confirmation',
      existing: stats(state),
    });
  }
  if (path === '/api/import' && method === 'POST') {
    editable(c);
    const input = await readJSON(request);
    if (input.confirm !== 'REPLACE') {
      throw new ApiError(422, '置き換えの確認が必要です。');
    }
    return json({
      revision: await commit(env, c, input.state, 'data.import', input.revision),
    });
  }
  if (path === '/api/audit' && method === 'GET') {
    owner(c);
    const r = await env.DB.prepare(
      'SELECT action,revision,created_at FROM audit_events WHERE organization_id=? ORDER BY created_at DESC LIMIT 100',
    )
      .bind(c.org.id)
      .all();
    return json({
      items: r.results,
    });
  }
  if (path === '/api/snapshots') {
    editable(c);
    if (!c.limits.snapshots) {
      throw new ApiError(403, 'バックアップ・復元はProの機能です。');
    }
    if (method === 'GET') {
      const r = await env.DB.prepare(
        'SELECT id,name,created_at FROM map_snapshots WHERE organization_id=? ORDER BY created_at DESC',
      )
        .bind(c.org.id)
        .all();
      return json({
        items: r.results,
      });
    }
    const input = await readJSON(request);
    const count = await env.DB.prepare(
      'SELECT count(*) AS n FROM map_snapshots WHERE organization_id=?',
    )
      .bind(c.org.id)
      .first();
    if (count.n >= c.limits.snapshots) {
      throw new ApiError(409, 'バックアップの上限です。古いものを削除してください。');
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO map_snapshots(id,organization_id,name,state_json,created_at) VALUES(?,?,?,?,?)',
    )
      .bind(
        id,
        c.org.id,
        String(input.name || 'バックアップ').slice(0, 80),
        JSON.stringify(state),
        now(),
      )
      .run();
    return json(
      {
        id,
      },
      201,
    );
  }
  const snapshot = path.match(/^\/api\/snapshots\/([a-zA-Z0-9-]+)(\/restore)?$/);
  if (snapshot) {
    owner(c);
    editable(c);
    if (!c.limits.snapshots) {
      throw new ApiError(403, 'Proの機能です。');
    }
    const s = await env.DB.prepare('SELECT * FROM map_snapshots WHERE id=? AND organization_id=?')
      .bind(snapshot[1], c.org.id)
      .first();
    if (!s) {
      throw new ApiError(404, 'バックアップが見つかりません。');
    }
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM map_snapshots WHERE id=? AND organization_id=?')
        .bind(s.id, c.org.id)
        .run();
      return json({
        deleted: true,
      });
    }
    if (method === 'POST' && snapshot[2]) {
      const input = await readJSON(request);
      return json({
        revision: await commit(
          env,
          c,
          JSON.parse(s.state_json),
          'snapshot.restore',
          input.revision,
        ),
      });
    }
  }
  const requireRevision = (input) => {
    if (!Number.isSafeInteger(input.revision)) {
      throw new ApiError(422, '最新のrevisionが必要です。');
    }
    return input.revision;
  };
  if (path === '/api/team/report' && method === 'GET') {
    editable(c);
    const day = url.searchParams.get('date') || teamToday();
    if (!validDate(day)) {
      throw new ApiError(422, '日付が不正です。');
    }
    const report = teamReport(state, day);
    const comments = await env.DB.prepare(
      "SELECT task_id,comment,created_at FROM map_task_events WHERE organization_id=? AND action='comment' ORDER BY created_at DESC LIMIT 20",
    )
      .bind(c.org.id)
      .all();
    report.comments = comments.results.map((e) => ({
      ...e,
      title: state.tasks.find((t) => t.id === e.task_id)?.title || '削除済みの作業',
    }));
    report.markdown +=
      '\n\n## 最近の引き継ぎコメント（最新20件）\n' +
      (report.comments
        .map((e) => '- ' + e.title + '\n  ' + e.comment.replace(/\n/g, '\n  '))
        .join('\n') || '- なし');
    return json({
      ...report,
      revision: c.org.revision,
    });
  }
  if (path === '/api/team/projects' && method === 'GET') {
    editable(c);
    return json({
      items: state.projects.map((p) => ({
        ...p,
        stats: projectStats(state, p.id),
      })),
      blocked: state.tasks
        .filter(
          (t) =>
            !['done', 'cancelled'].includes(t.status) && taskBlockers(state, t).dependencies.length,
        )
        .map((t) => t.id),
      revision: c.org.revision,
    });
  }
  if (path === '/api/team/workflow-demo' && method === 'POST') {
    editable(c);
    const input = await readJSON(request);
    const next = structuredClone(state);
    const result = addWorkflowDemo(next);
    return json(
      {
        ...result,
        revision: await commit(env, c, next, 'team.workflow-demo', requireRevision(input)),
      },
      201,
    );
  }
  if (path === '/api/team/demo' && method === 'POST') {
    editable(c);
    const input = await readJSON(request);
    const next = structuredClone(state);
    const result = addDemoTeam(next);
    return json(
      {
        ...result,
        revision: await commit(env, c, next, 'team.demo', requireRevision(input)),
      },
      201,
    );
  }
  const taskAction = path.match(/^\/api\/tasks\/([^/]+)\/(complete|history|comments)$/);
  if (taskAction) {
    editable(c);
    const [, id, action] = taskAction;
    const t = state.tasks.find((t) => t.id === id);
    if (action === 'history' && method === 'GET') {
      const before = Math.max(
        1,
        Math.floor(Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER),
      );
      const rows = await env.DB.prepare(
        'SELECT id,action,actor_id,reason,revision,before_json,after_json,comment,created_at FROM map_task_events WHERE organization_id=? AND task_id=? AND revision<? ORDER BY revision DESC,created_at DESC LIMIT 31',
      )
        .bind(c.org.id, id, before)
        .all();
      if (!t && !rows.results.length) {
        throw new ApiError(404, '作業がありません。');
      }
      return json({
        items: rows.results.slice(0, 30).map((e) => ({
          ...e,
          actor: e.actor_id === c.user.id ? 'あなた' : '施設担当者',
          before: e.before_json ? JSON.parse(e.before_json) : null,
          after: e.after_json ? JSON.parse(e.after_json) : null,
          before_json: undefined,
          after_json: undefined,
        })),
        nextCursor: rows.results.length > 30 ? rows.results[29].revision : null,
      });
    }
    if (!t) {
      throw new ApiError(404, '作業がありません。');
    }
    if (method !== 'POST') {
      throw new ApiError(405, 'POSTで操作してください。');
    }
    const input = await readJSON(request);
    const expected = requireRevision(input);
    if (action === 'complete') {
      const next = structuredClone(state);
      if (input.record) {
        const i = next.tasks.findIndex((t) => t.id === id);
        next.tasks[i] = makeTask(input.record, next.tasks[i]);
      }
      const record = completeTask(next, id, input, '施設担当者');
      return json({
        record,
        revision: await commit(env, c, next, 'task.complete', expected),
      });
    }
    if (action === 'comments') {
      if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 3000) {
        throw new ApiError(422, '引き継ぎコメントは1〜3,000文字です。');
      }
      const event = {
        id: crypto.randomUUID(),
        taskId: id,
        action: 'comment',
        comment: input.text.trim(),
        files: [],
      };
      return json(
        {
          revision: await commit(env, c, state, 'task.comment', expected, [event]),
        },
        201,
      );
    }
  }
  const planAction = path.match(/^\/api\/inspectionPlans\/([^/]+)\/(preview|generate)$/);
  if (planAction) {
    editable(c);
    const plan = state.inspectionPlans.find((p) => p.id === planAction[1]);
    if (!plan) {
      throw new ApiError(404, '点検計画がありません。');
    }
    if (planAction[2] === 'preview' && method === 'GET') {
      return json({
        ...planPreview(state, plan),
        revision: c.org.revision,
      });
    }
    if (planAction[2] === 'generate' && method === 'POST') {
      const input = await readJSON(request);
      const next = structuredClone(state);
      const preview = generatePlan(
        next,
        next.inspectionPlans.find((p) => p.id === plan.id),
        input.cycleDate,
      );
      return json(
        {
          ...preview,
          revision: await commit(env, c, next, 'inspection-plan.generate', requireRevision(input)),
        },
        201,
      );
    }
    throw new ApiError(405, '対応していない操作です。');
  }
  const teamEntity = path.match(
    /^\/api\/(tasks|teamMembers|inspectionPlans|projects)(?:\/([^/]+))?$/,
  );
  if (teamEntity) {
    editable(c);
    const [, kind, id] = teamEntity;
    const list = state[kind];
    if (method === 'GET') {
      if (id) {
        const record = list.find((x) => x.id === id);
        if (!record) {
          throw new ApiError(404, '対象がありません。');
        }
        return json({
          record,
          revision: c.org.revision,
        });
      }
      const q = (url.searchParams.get('q') || '').toLocaleLowerCase();
      return json({
        items: list.filter((r) => !q || JSON.stringify(r).toLocaleLowerCase().includes(q)),
        revision: c.org.revision,
      });
    }
    const input = await readJSON(request);
    const next = structuredClone(state);
    const record = mutate(next, kind, id, method, input.record || {});
    return json(
      {
        record,
        revision: await commit(
          env,
          c,
          next,
          kind + '.' + method.toLowerCase(),
          requireRevision(input),
        ),
      },
      method === 'POST' ? 201 : 200,
    );
  }
  if (path === '/api/layer-sets/apply' && method === 'POST') {
    const input = await readJSON(request);
    const p = await settings(env, c);
    let patch;
    try {
      patch = layerSets.apply(visibleState(state, c.editor), p, input);
    } catch (e) {
      throw new ApiError(422, e.message);
    }
    const result = preferences(
      {
        ...p,
        ...patch,
      },
      c.org.plan,
    );
    await env.DB.prepare(
      'INSERT INTO map_preferences(user_id,organization_id,value_json) VALUES(?,?,?) ON CONFLICT(user_id,organization_id) DO UPDATE SET value_json=excluded.value_json',
    )
      .bind(c.user.id, c.org.id, JSON.stringify(result))
      .run();
    return json({
      preferences: result,
    });
  }
  if (['/api/assets/import-preview', '/api/assets/import'].includes(path) && method === 'POST') {
    editable(c);
    const input = await readJSON(request);
    const preview = previewAssets(input, state, c.org.plan);
    if (preview.canApply) {
      try {
        await validateFiles(env, c, preview.next);
      } catch (e) {
        preview.errors.push({
          row: null,
          code: '',
          message: e.message,
        });
        preview.canApply = false;
      }
    }
    const { next, ...result } = preview;
    if (path.endsWith('import-preview')) {
      return json({
        ...result,
        revision: c.org.revision,
      });
    }
    if (!Number.isSafeInteger(input.revision)) {
      throw new ApiError(422, 'プレビューで取得したrevisionが必要です。');
    }
    if (input.confirm !== 'IMPORT_ASSETS') {
      throw new ApiError(422, '設備取り込みの確認が必要です。');
    }
    if (!preview.canApply) {
      throw new ApiError(
        422,
        preview.errors.map((e) => (e.row ? '行' + e.row + ': ' : '') + e.message).join(' / '),
      );
    }
    return json({
      ...result,
      revision: await commit(env, c, next, 'assets.import', input.revision),
    });
  }
  if (path === '/api/work-register' && method === 'GET') {
    editable(c);
    const offset = Math.min(
      10000000,
      Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0)),
    );
    const limit = Math.min(
      200,
      Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || 100)),
    );
    const deleted = await env.DB.prepare(
      "SELECT e.work_id,e.before_json,e.created_at,e.revision FROM map_work_events e WHERE e.organization_id=? AND e.action='deleted' AND e.revision=(SELECT MAX(newer.revision) FROM map_work_events newer WHERE newer.organization_id=e.organization_id AND newer.work_id=e.work_id) ORDER BY e.created_at DESC LIMIT ? OFFSET ?",
    )
      .bind(c.org.id, limit + 1, offset)
      .all();
    return json({
      items: state.works,
      deleted: deleted.results.slice(0, limit).map((e) => ({
        ...JSON.parse(e.before_json),
        deleted: true,
        deletedAt: e.created_at,
      })),
      nextOffset: deleted.results.length > limit ? offset + limit : null,
      revision: c.org.revision,
    });
  }
  const workHistory = path.match(/^\/api\/works\/([^/]+)\/history$/);
  if (workHistory && method === 'GET') {
    editable(c);
    const requestedCursor = Number(url.searchParams.get('before'));
    const cursor =
      Number.isSafeInteger(requestedCursor) && requestedCursor > 0
        ? requestedCursor
        : Number.MAX_SAFE_INTEGER;
    const limit = Math.min(
      100,
      Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || 30)),
    );
    const r = await env.DB.prepare(
      'SELECT id,action,actor_id,reason,revision,before_json,after_json,created_at FROM map_work_events WHERE organization_id=? AND work_id=? AND revision<? ORDER BY revision DESC LIMIT ?',
    )
      .bind(c.org.id, workHistory[1], cursor, limit + 1)
      .all();
    if (!r.results.length && !state.works.some((w) => w.id === workHistory[1])) {
      const exists = await env.DB.prepare(
        'SELECT id FROM map_work_events WHERE organization_id=? AND work_id=? LIMIT 1',
      )
        .bind(c.org.id, workHistory[1])
        .first();
      if (!exists) {
        throw new ApiError(404, 'この工事の履歴はありません。');
      }
    }
    return json({
      items: r.results.slice(0, limit).map((e) => ({
        id: e.id,
        action: e.action,
        actorId: e.actor_id,
        actor:
          e.actor_id === 'migration'
            ? '導入時の記録'
            : e.actor_id === c.user.id
              ? 'あなた'
              : '施設担当者 ' + e.actor_id.slice(0, 8),
        reason: e.reason,
        revision: e.revision,
        before: e.before_json ? JSON.parse(e.before_json) : null,
        after: e.after_json ? JSON.parse(e.after_json) : null,
        createdAt: e.created_at,
      })),
      nextCursor: r.results.length > limit ? r.results[limit - 1].revision : null,
    });
  }
  if (path === '/api/search' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').toLocaleLowerCase();
    const s = visibleState(state, c.editor);
    const items = ['works', 'assets', 'drawings', 'notes'].flatMap((kind) =>
      s[kind]
        .filter((x) => JSON.stringify(x).toLocaleLowerCase().includes(q))
        .map((record) => ({
          kind,
          record,
        })),
    );
    return json({
      items: items.slice(0, 200),
      total: items.length,
    });
  }
  if (path === '/api/batch' && method === 'POST') {
    editable(c);
    const input = await readJSON(request);
    if (!Array.isArray(input.operations) || input.operations.length > 100) {
      throw new ApiError(422, '一括操作は100件までです。');
    }
    const next = structuredClone(state);
    const results = [];
    for (const o of input.operations) {
      const kind = o.kind || o.collection;
      const op = o.operation || o.action;
      const method =
        o.method ||
        {
          create: 'POST',
          update: 'PATCH',
          delete: 'DELETE',
        }[op];
      results.push(mutate(next, kind, o.id, method, o.record || o.data || {}));
    }
    if (
      input.operations.some((o) => TEAM_COLLECTIONS.includes(o.kind || o.collection)) &&
      !Number.isSafeInteger(input.revision)
    ) {
      throw new ApiError(422, 'revisionが必要です。');
    }
    return json({
      results,
      revision: await commit(env, c, next, 'batch.update', input.revision),
    });
  }
  const history = path.match(/^\/api\/assets\/([^/]+)\/maintenance(?:\/([^/]+))?$/);
  if (history) {
    editable(c);
    const next = structuredClone(state);
    const a = next.assets.find((x) => x.id === history[1]);
    if (!a) {
      throw new ApiError(404, '設備がありません。');
    }
    if (method === 'GET') {
      return json({
        items: a.history,
      });
    }
    const input = method === 'DELETE' ? {} : await readJSON(request);
    let record;
    const i = a.history.findIndex((h) => h.id === history[2]);
    if (method === 'POST') {
      record = {
        ...input,
        id: input.id || crypto.randomUUID(),
      };
      a.history.unshift(record);
    } else if (i < 0) {
      throw new ApiError(404, '点検履歴がありません。');
    } else if (method === 'PATCH') {
      record = {
        ...a.history[i],
        ...input,
        id: history[2],
      };
      a.history[i] = record;
    } else if (method === 'DELETE') {
      record = a.history.splice(i, 1)[0];
    }
    return json({
      record,
      revision: await commit(env, c, next, 'inspection.' + method.toLowerCase()),
    });
  }
  const entity = path.match(
    /^\/api\/(drawings|works|assets|properties|notes|layers|drawingLinks|layerSets)(?:\/([^/]+))?$/,
  );
  if (entity) {
    const [, kind, id] = entity;
    const key = kind === 'properties' ? 'propertyDefinitions' : kind;
    if (method === 'GET') {
      if (['assets', 'properties'].includes(kind) && !c.editor) {
        throw new ApiError(403, '施設担当モードに切り替えてください。');
      }
      let list = visibleState(state, c.editor)[key];
      if (id) {
        const record = list.find((x) => x.id === id);
        if (!record) {
          throw new ApiError(404, '対象が見つかりません。');
        }
        return json({
          record,
          revision: c.org.revision,
        });
      }
      const q = (url.searchParams.get('q') || '').toLocaleLowerCase();
      const drawing = url.searchParams.get('drawingId');
      list = list.filter(
        (x) =>
          (!drawing || x.drawingId === drawing) &&
          (!q || JSON.stringify(x).toLocaleLowerCase().includes(q)),
      );
      return json({
        items: list.slice(0, 1000),
        total: list.length,
      });
    }
    editable(c);
    const next = structuredClone(state);
    const input = method === 'DELETE' ? {} : await readJSON(request);
    const record = mutate(next, kind, id, method, input);
    return json(
      {
        record,
        revision: await commit(env, c, next, kind + '.' + method.toLowerCase()),
      },
      method === 'POST' ? 201 : 200,
    );
  }
  throw new ApiError(404, 'このAPIはありません。');
}
