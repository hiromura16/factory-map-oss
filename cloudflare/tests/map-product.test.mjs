/**
 * 現行APIを一時SQLiteで実行し、利用者分離・権限・保存・同時更新・業務ルールを検証します。
 * 外部の本番DBや実在の工場データは利用しません。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import worker from '../worker.mjs';
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
  });
}
const directory = mkdtempSync(path.join(os.tmpdir(), 'factory-map-product-'));
const dbpath = path.join(directory, 'test.sqlite');
const python = `import json,sqlite3,sys\ndb=sqlite3.connect(sys.argv[1]);db.execute('PRAGMA foreign_keys=ON');db.row_factory=sqlite3.Row\nx=json.load(sys.stdin)\nif 'schema' in x:db.executescript(x['schema']);db.commit();print('[]');sys.exit()\nr=[]\nwith db:\n for q in x['queries']:\n  c=db.execute(q['sql'],q['params']);r.append({'results':[dict(row)for row in c.fetchall()]if c.description else [],'meta':{'changes':max(c.rowcount,0)}})\nprint(json.dumps(r))`;
function execute(input) {
  const r = spawnSync('python3', ['-c', python, dbpath], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(r.stderr || String(r.error));
  }
  return JSON.parse(r.stdout);
}
for (const file of [
  '0001_tenants.sql',
  '0002_scim.sql',
  '0003_map_product.sql',
  '0004_work_events.sql',
  '0005_team_tasks.sql',
  '0006_notion_sync.sql',
]) {
  execute({
    schema: readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'),
  });
}
const DB = {
  prepare(sql) {
    return {
      sql,
      params: [],
      bind(...params) {
        this.params = params;
        return this;
      },
      async all() {
        return execute({
          queries: [this],
        })[0];
      },
      async first() {
        return (await this.all()).results[0] ?? null;
      },
      async run() {
        return this.all();
      },
    };
  },
  async batch(queries) {
    return execute({
      queries,
    });
  },
};
const keys = await crypto.subtle.generateKey(
  {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  true,
  ['sign', 'verify'],
);
const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
jwk.kid = 'map-test';
const oldFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  assert.equal(String(url), 'https://access.example/cdn-cgi/access/certs');
  return new Response(
    JSON.stringify({
      keys: [jwk],
    }),
  );
};
const base64 = (x) => Buffer.from(x).toString('base64url');
async function token(subject) {
  const signed =
    base64(
      JSON.stringify({
        alg: 'RS256',
        kid: jwk.kid,
      }),
    ) +
    '.' +
    base64(
      JSON.stringify({
        iss: 'https://access.example',
        sub: subject,
        aud: ['map-aud'],
        exp: Date.now() / 1000 + 300,
      }),
    );
  return (
    signed +
    '.' +
    base64(
      await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        keys.privateKey,
        new TextEncoder().encode(signed),
      ),
    )
  );
}
const env = {
  DB,
  ACCESS_TEAM: 'https://access.example',
  ACCESS_AUD: 'map-aud',
};
async function call(path, method = 'GET', body, profile = 'pro', subject = 'alice', cookie = '') {
  const headers = {
    'cf-access-jwt-assertion': await token(subject),
    'x-factory-profile': profile,
    cookie,
  };
  if (body !== undefined && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  return worker.fetch(
    new Request('https://map.example' + path, {
      method,
      headers,
      body,
    }),
    env,
  );
}
let iconFile;
let proOrg;
test('SSO is required and creates exactly two isolated demo accounts', async () => {
  assert.equal((await worker.fetch(new Request('https://map.example/api/state'), env)).status, 401);
  const pro = await (await call('/api/session')).json();
  const free = await (await call('/api/session', 'GET', undefined, 'free')).json();
  proOrg = pro.organization.id;
  assert.equal(pro.plan, 'pro');
  assert.equal(pro.role, 'owner');
  assert.equal(free.plan, 'free');
  assert.equal(free.role, 'editor');
  assert.notEqual(free.organization.id, pro.organization.id);
  assert.equal((await (await call('/api/state')).json()).state.assets.length, 64);
  assert.equal(
    (await (await call('/api/state', 'GET', undefined, 'free')).json()).state.assets.length,
    12,
  );
  await call('/api/session');
  const count = execute({
    queries: [
      {
        sql: 'SELECT count(*) AS n FROM organizations',
        params: [],
      },
    ],
  })[0].results[0].n;
  assert.equal(count, 2);
});
test('separate SSO users never share demo data', async () => {
  const bob = await (await call('/api/session', 'GET', undefined, 'pro', 'bob')).json();
  assert.notEqual(bob.organization.id, proOrg);
});
test('map edits persist and stale revisions do not overwrite', async () => {
  const current = await (await call('/api/state')).json();
  current.state.assets[0].name = 'Updated unit';
  const r = await call('/api/state', 'PUT', current);
  assert.equal(r.status, 200);
  assert.equal((await (await call('/api/state')).json()).state.assets[0].name, 'Updated unit');
  assert.equal((await call('/api/state', 'PUT', current)).status, 409);
  assert.notEqual(
    (await (await call('/api/state', 'GET', undefined, 'free')).json()).state.assets[0].name,
    'Updated unit',
  );
});
test('paid customization is persisted and rejected by free API', async () => {
  assert.equal(
    (
      await call('/api/preferences', 'PUT', {
        theme: 'dark',
        accent: '#224466',
      })
    ).status,
    200,
  );
  assert.equal((await (await call('/api/preferences')).json()).preferences.theme, 'dark');
  assert.equal(
    (
      await call(
        '/api/preferences',
        'PUT',
        {
          theme: 'dark',
        },
        'free',
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        '/api/preferences',
        'PUT',
        {
          left: true,
        },
        'free',
      )
    ).status,
    200,
  );
});
test('files, thumbnails and custom icons have account ownership', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvDkAAAAASUVORK5CYII=',
    'base64',
  );
  const f = new FormData();
  f.append(
    'file',
    new Blob([png], {
      type: 'image/png',
    }),
    'later.png',
  );
  f.append(
    'thumbnail-0',
    new Blob([png], {
      type: 'image/png',
    }),
    'thumbnail.png',
  );
  const r = await call('/api/files', 'POST', f);
  assert.equal(r.status, 201);
  iconFile = (await r.json()).files[0].fileId;
  assert.equal(
    (
      await call('/api/preferences', 'PUT', {
        icons: [
          {
            id: 'icon-added-later',
            name: 'Later',
            fileId: iconFile,
          },
        ],
        categoryIcons: {
          hvac: 'icon-added-later',
        },
      })
    ).status,
    200,
  );
  const data = await call('/api/files/' + iconFile + '/thumbnail');
  assert.equal(data.status, 200);
  assert.deepEqual(Buffer.from(await data.arrayBuffer()), png);
  assert.equal((await call('/api/files/' + iconFile, 'GET', undefined, 'free')).status, 404);
  assert.equal((await call('/api/files/' + iconFile, 'GET', undefined, 'pro', 'bob')).status, 404);
  assert.equal((await call('/api/files/' + iconFile, 'DELETE')).status, 409);
});
test('equipment locks apply to direct APIs and unlock plus move cannot bypass', async () => {
  const a = (await (await call('/api/assets')).json()).items[0];
  assert.equal(
    (
      await call('/api/assets/' + a.id, 'PATCH', {
        locks: {
          position: true,
          attributes: false,
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call('/api/assets/' + a.id, 'PATCH', {
        point: [1, 2],
        locks: {
          position: false,
          attributes: false,
        },
      })
    ).status,
    423,
  );
  assert.equal(
    (
      await call('/api/assets/' + a.id, 'PATCH', {
        locks: {
          position: false,
          attributes: false,
        },
      })
    ).status,
    200,
  );
});
test('viewer projection hides assets and equipment files', async () => {
  const r = await (
    await call('/api/state', 'GET', undefined, 'pro', 'alice', 'factory_mode=viewer')
  ).json();
  assert.equal(r.state.assets.length, 0);
  assert.equal(r.state.propertyDefinitions.length, 0);
  assert.equal(
    (await call('/api/assets', 'GET', undefined, 'pro', 'alice', 'factory_mode=viewer')).status,
    403,
  );
  assert.equal(
    (await call('/api/files/' + iconFile, 'GET', undefined, 'pro', 'alice', 'factory_mode=viewer'))
      .status,
    404,
  );
  assert.equal(
    (
      await call(
        '/api/state',
        'PUT',
        {
          state: r.state,
          revision: r.revision,
        },
        'pro',
        'alice',
        'factory_mode=viewer',
      )
    ).status,
    403,
  );
});
test('free drawing quota is enforced on the server', async () => {
  const r = await (await call('/api/state', 'GET', undefined, 'free')).json();
  r.state.drawings.push(
    {
      ...r.state.drawings[0],
      id: 'third',
    },
    {
      ...r.state.drawings[0],
      id: 'fourth',
    },
  );
  assert.equal((await call('/api/state', 'PUT', r, 'free')).status, 409);
});
test('backup restore, audit and free feature gates', async () => {
  const r = await call('/api/snapshots', 'POST', {
    name: 'Before inspection',
  });
  assert.equal(r.status, 201);
  const { id } = await r.json();
  const current = await (await call('/api/state')).json();
  current.state.assets[0].name = 'Changed again';
  assert.equal((await call('/api/state', 'PUT', current)).status, 200);
  const fresh = await (await call('/api/state')).json();
  assert.equal(
    (
      await call('/api/snapshots/' + id + '/restore', 'POST', {
        revision: fresh.revision,
      })
    ).status,
    200,
  );
  assert.equal((await (await call('/api/state')).json()).state.assets[0].name, 'Updated unit');
  assert.equal((await call('/api/snapshots', 'GET', undefined, 'free')).status, 403);
  assert.equal((await call('/api/audit', 'GET', undefined, 'free')).status, 403);
  assert.ok(
    (await (await call('/api/audit')).json()).items.some((x) => x.action === 'snapshot.restore'),
  );
});
test('cross-site writes, bad properties and foreign file refs are rejected', async () => {
  const r = new Request('https://map.example/api/state', {
    method: 'PUT',
    headers: {
      'cf-access-jwt-assertion': await token('alice'),
      origin: 'https://evil.example',
    },
    body: '{}',
  });
  assert.equal((await worker.fetch(r, env)).status, 403);
  const current = await (await call('/api/state')).json();
  current.state.assets[0].attachments = [
    {
      fileId: 'foreign',
    },
  ];
  assert.equal((await call('/api/state', 'PUT', current)).status, 422);
});
test('custom categories, icon mappings and equipment reassignment persist atomically', async () => {
  const current = await (await call('/api/state')).json();
  const definition = current.state.propertyDefinitions.find((d) => d.id === 'category');
  const id = 'category-' + crypto.randomUUID();
  const asset = current.state.assets[0];
  const original = structuredClone(asset);
  definition.options.push(
    {
      id,
      label: '生産設備',
    },
    {
      id: 'category-second',
      label: '計測機器',
    },
  );
  asset.properties.category = id;
  assert.equal((await call('/api/state', 'PUT', current)).status, 200);
  assert.equal(
    (
      await call('/api/preferences', 'PUT', {
        icons: [
          {
            id: 'icon-custom',
            fileId: iconFile,
            name: 'Custom',
          },
        ],
        categoryIcons: {
          [id]: 'icon-custom',
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await call('/api/preferences')).json()).preferences.categoryIcons[id],
    'icon-custom',
  );
  const invalid = await (await call('/api/state')).json();
  invalid.state.propertyDefinitions.find((d) => d.id === 'category').options =
    definition.options.filter((o) => o.id !== id);
  assert.equal((await call('/api/state', 'PUT', invalid)).status, 422);
  assert.equal(
    (await (await call('/api/state')).json()).state.propertyDefinitions.find(
      (d) => d.id === 'category',
    ).options.length,
    14,
  );
  invalid.state.assets[0].properties.category = 'category-second';
  assert.equal(
    (
      await call('/api/assets/' + asset.id, 'PATCH', {
        locks: {
          attributes: true,
          position: false,
        },
      })
    ).status,
    200,
  );
  invalid.revision = (await (await call('/api/state')).json()).revision;
  assert.equal((await call('/api/state', 'PUT', invalid)).status, 423);
  assert.equal(
    (
      await call('/api/assets/' + asset.id, 'PATCH', {
        locks: {
          attributes: false,
          position: false,
        },
      })
    ).status,
    200,
  );
  invalid.revision = (await (await call('/api/state')).json()).revision;
  assert.equal((await call('/api/state', 'PUT', invalid)).status, 200);
  const saved = (await (await call('/api/state')).json()).state;
  assert.equal(saved.assets[0].properties.category, 'category-second');
  assert.deepEqual(saved.assets[0].history, original.history);
  assert.deepEqual(saved.assets[0].point, original.point);
  assert.equal(saved.assets.length, current.state.assets.length);
});
test('maximum-sized file round trip stays within a single small D1 batch', async () => {
  const data = new Uint8Array(5 * 1024 * 1024);
  data[0] = 101;
  data[data.length - 1] = 99;
  const form = new FormData();
  form.append('file', new Blob([data]), 'large.bin');
  const upload = await call('/api/files', 'POST', form);
  assert.equal(upload.status, 201);
  const f = (await upload.json()).files[0];
  const current = await (await call('/api/state')).json();
  current.state.assets[0].attachments = [f];
  assert.equal((await call('/api/state', 'PUT', current)).status, 200);
  const response = await call('/api/files/' + f.fileId);
  assert.equal(response.status, 200);
  const actual = new Uint8Array(await response.arrayBuffer());
  assert.equal(actual.length, data.length);
  assert.equal(actual[0], 101);
  assert.equal(actual[actual.length - 1], 99);
  const chunks = execute({
    queries: [
      {
        sql: 'SELECT count(*) AS n FROM map_file_chunks WHERE file_id=?',
        params: [f.fileId],
      },
    ],
  })[0].results[0].n;
  assert.ok(chunks <= 27);
});
test.after(() => {
  globalThis.fetch = oldFetch;
  rmSync(directory, {
    recursive: true,
    force: true,
  });
});
test('appearance and register preferences persist, invalid sizes are rejected', async () => {
  const p = {
    teamBoard: {
      kind: 'maintenance',
      sort: 'due',
      layout: 'list',
    },
    appearance: {
      iconSize: 48,
      iconScale: 'fixed',
      workLabelSize: 16,
      workScale: 'gentle',
      minimumScale: 50,
      coordinates: true,
    },
    tableViews: {
      equipment: {
        columns: ['name', 'code', 'prop:maker'],
        sort: 'name',
        descending: true,
        pageSize: 20,
        filters: {
          category: 'hvac',
          query: '空調',
        },
      },
    },
  };
  assert.equal((await call('/api/preferences', 'PUT', p)).status, 200);
  const saved = (await (await call('/api/preferences')).json()).preferences;
  assert.equal(
    (
      await call(
        '/api/preferences',
        'PUT',
        {
          appearance: {
            iconSize: 40,
          },
        },
        'free',
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        '/api/preferences',
        'PUT',
        {
          appearance: {
            background: '#112233',
          },
        },
        'free',
      )
    ).status,
    403,
  );
  assert.equal(saved.teamBoard.kind, 'maintenance');
  assert.equal(saved.teamBoard.sort, 'due');
  assert.equal(saved.teamBoard.layout, 'list');
  assert.equal(saved.appearance.iconSize, 48);
  assert.equal(saved.appearance.iconScale, 'fixed');
  assert.deepEqual(saved.tableViews.equipment.columns, ['name', 'code', 'prop:maker']);
  assert.equal(saved.tableViews.equipment.filters.category, 'hvac');
  assert.equal(
    (
      await call('/api/preferences', 'PUT', {
        appearance: {
          iconSize: -10,
        },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await call('/api/preferences', 'PUT', {
        appearance: {
          background: 'url(evil)',
        },
      })
    ).status,
    422,
  );
});
test('mixed layers protect private announcements and locked equipment assignments', async () => {
  const layer = {
    id: 'private-utilities',
    name: '施設用',
    color: '#224466',
    audience: 'facility',
  };
  assert.equal((await call('/api/layers', 'POST', layer)).status, 201);
  const s = await (await call('/api/state')).json();
  s.state.assets[0].layerId = layer.id;
  s.state.works[0].layerId = layer.id;
  s.state.notes.push({
    id: 'private-note',
    drawingId: 'site',
    point: [10, 10],
    text: '施設内部メモ',
    layerId: layer.id,
  });
  assert.equal((await call('/api/state', 'PUT', s)).status, 200);
  const viewer = (
    await (await call('/api/state', 'GET', undefined, 'pro', 'alice', 'factory_mode=viewer')).json()
  ).state;
  assert.ok(!viewer.layers.some((x) => x.id === layer.id));
  assert.ok(!viewer.works.some((x) => x.id === s.state.works[0].id));
  assert.ok(!viewer.notes.some((x) => x.id === 'private-note'));
  const id = s.state.assets[0].id;
  assert.equal(
    (
      await call('/api/assets/' + id, 'PATCH', {
        locks: {
          position: true,
          attributes: true,
        },
      })
    ).status,
    200,
  );
  assert.equal((await call('/api/layers/' + layer.id, 'DELETE')).status, 423);
  assert.equal(
    (
      await call('/api/assets/' + id, 'PATCH', {
        locks: {
          position: false,
          attributes: false,
        },
      })
    ).status,
    200,
  );
  assert.equal((await call('/api/layers/' + layer.id, 'DELETE')).status, 200);
  assert.equal((await (await call('/api/assets/' + id)).json()).record.layerId, undefined);
});
test('drawing hierarchy validates targets and cycles, exposes only public links', async () => {
  const link = {
    id: 'area-a',
    drawingId: 'site',
    targetDrawingId: 'floor-a1',
    name: 'A棟へ',
    audience: 'facility',
    points: [
      [100, 100],
      [200, 100],
      [200, 200],
      [100, 200],
    ],
  };
  assert.equal((await call('/api/drawingLinks', 'POST', link)).status, 201);
  assert.equal(
    (
      await call('/api/drawingLinks', 'POST', {
        ...link,
        id: 'back-loop',
        drawingId: 'floor-a1',
        targetDrawingId: 'site',
      })
    ).status,
    422,
  );
  let viewer = (
    await (
      await call('/api/drawingLinks', 'GET', undefined, 'pro', 'alice', 'factory_mode=viewer')
    ).json()
  ).items;
  assert.equal(viewer.length, 0);
  assert.equal(
    (
      await call('/api/drawingLinks/area-a', 'PATCH', {
        audience: 'public',
      })
    ).status,
    200,
  );
  viewer = (
    await (
      await call('/api/drawingLinks', 'GET', undefined, 'pro', 'alice', 'factory_mode=viewer')
    ).json()
  ).items;
  assert.equal(viewer.length, 1);
  assert.equal(
    (
      await call('/api/drawingLinks/area-a', 'PATCH', {
        targetDrawingId: 'missing',
      })
    ).status,
    422,
  );
});
test('work history retains snapshots and attachments through edits, stale saves and deletion', async () => {
  const f = new FormData();
  f.append(
    'file',
    new Blob(['%PDF-1.4\nwork report'], {
      type: 'application/pdf',
    }),
    'before.pdf',
  );
  const uploaded = (await (await call('/api/files', 'POST', f)).json()).files[0];
  const source = (await (await call('/api/works')).json()).items[0];
  const id = 'history-' + crypto.randomUUID();
  const work = {
    ...source,
    id,
    code: 'HISTORY-001',
    title: '履歴の対象工事',
    attachments: [uploaded],
    layerId: undefined,
  };
  assert.equal((await call('/api/works', 'POST', work)).status, 201);
  const stale = await (await call('/api/state')).json();
  assert.equal(
    (
      await call('/api/works/' + id, 'PATCH', {
        title: '工事名を更新',
        attachments: [],
      })
    ).status,
    200,
  );
  assert.equal((await call('/api/state', 'PUT', stale)).status, 409);
  let history = (await (await call('/api/works/' + id + '/history')).json()).items;
  assert.deepEqual(
    history.map((e) => e.action),
    ['updated', 'created'],
  );
  assert.equal(history[0].before.title, '履歴の対象工事');
  assert.equal(history[0].after.title, '工事名を更新');
  assert.equal((await call('/api/works/' + id, 'DELETE')).status, 200);
  history = (await (await call('/api/works/' + id + '/history')).json()).items;
  assert.deepEqual(
    history.map((e) => e.action),
    ['deleted', 'updated', 'created'],
  );
  assert.equal(history[0].after, null);
  const page = await (await call('/api/works/' + id + '/history?limit=1')).json();
  assert.equal(page.items.length, 1);
  assert.ok(page.nextCursor);
  const older = await (
    await call('/api/works/' + id + '/history?limit=1&before=' + page.nextCursor)
  ).json();
  assert.equal(older.items[0].action, 'updated');
  assert.ok((await (await call('/api/work-register')).json()).deleted.some((w) => w.id === id));
  assert.equal((await call('/api/files/' + uploaded.fileId, 'DELETE')).status, 409);
  assert.equal((await call('/api/files/' + uploaded.fileId)).status, 200);
  for (const path of ['/api/work-register', '/api/works/' + id + '/history', '/api/dashboard']) {
    assert.equal(
      (await call(path, 'GET', undefined, 'pro', 'alice', 'factory_mode=viewer')).status,
      403,
    );
  }
  assert.equal(
    (await call('/api/works/' + id + '/history', 'GET', undefined, 'pro', 'bob')).status,
    404,
  );
});
test('layer sets allow overlapping membership, saved states, unions and intersections without publishing private layers', async () => {
  const call2 = (p, m = 'GET', b, cookie = '') => call(p, m, b, 'pro', 'sets-user', cookie);
  for (const [id, audience] of [
    ['ls-a', 'public'],
    ['ls-b', 'public'],
    ['ls-private', 'facility'],
  ]) {
    assert.equal(
      (
        await call2('/api/layers', 'POST', {
          id,
          name: id,
          color: '#224466',
          audience,
        })
      ).status,
      201,
    );
  }
  const one = {
    id: 'set-one',
    name: '空調巡回',
    color: '#224466',
    description: '巡回用',
    audience: 'public',
    mode: 'merge',
    rules: [
      {
        layerId: 'ls-a',
        visible: true,
      },
      {
        layerId: 'ls-b',
        visible: false,
      },
      {
        layerId: 'ls-private',
        visible: true,
      },
    ],
  };
  const two = {
    ...one,
    id: 'set-two',
    name: '工事確認',
    rules: [
      {
        layerId: 'ls-a',
        visible: true,
      },
      {
        layerId: 'ls-b',
        visible: true,
      },
    ],
  };
  assert.equal((await call2('/api/layerSets', 'POST', one)).status, 201);
  assert.equal((await call2('/api/layerSets', 'POST', two)).status, 201);
  let r = await (
    await call2('/api/layer-sets/apply', 'POST', {
      ids: ['set-one'],
      operation: 'saved',
    })
  ).json();
  assert.ok(r.preferences.hiddenLayerIds.includes('ls-b'));
  assert.ok(!r.preferences.hiddenLayerIds.includes('ls-a'));
  assert.equal(r.preferences.mapTypes.assets, true);
  r = await (
    await call2('/api/layer-sets/apply', 'POST', {
      ids: ['set-one', 'set-two'],
      operation: 'intersection',
    })
  ).json();
  assert.ok(!r.preferences.hiddenLayerIds.includes('ls-a'));
  assert.ok(r.preferences.hiddenLayerIds.includes('ls-b'));
  assert.ok(r.preferences.hiddenLayerIds.includes('ls-private'));
  r = await (
    await call2('/api/layer-sets/apply', 'POST', {
      ids: ['set-one', 'set-two'],
      operation: 'isolate',
    })
  ).json();
  assert.ok(!r.preferences.hiddenLayerIds.includes('ls-b'));
  const viewer = (await (await call2('/api/state', 'GET', undefined, 'factory_mode=viewer')).json())
    .state;
  assert.equal(viewer.layerSets.length, 2);
  assert.ok(!JSON.stringify(viewer).includes('ls-private'));
  assert.equal(viewer.layerSets[0].rules.length, 2);
  assert.equal(
    (
      await call2('/api/layerSets', 'POST', {
        ...one,
        id: 'bad-set',
        rules: [
          {
            layerId: 'missing',
            visible: true,
          },
        ],
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await call2('/api/layerSets/set-one', 'PATCH', {
        rules: [one.rules[0], one.rules[0]],
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await call2('/api/layerSets', 'POST', {
        ...one,
        id: 'staff-set',
        audience: 'facility',
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await call2(
        '/api/layer-sets/apply',
        'POST',
        {
          ids: ['staff-set'],
        },
        'factory_mode=viewer',
      )
    ).status,
    422,
  );
  assert.equal((await call2('/api/layers/ls-a', 'DELETE')).status, 200);
  assert.ok(
    (await (await call2('/api/layerSets/set-one')).json()).record.rules.every(
      (r) => r.layerId !== 'ls-a',
    ),
  );
});
test('equipment-only JSON import previews errors and applies atomically without replacing records or histories', async () => {
  const call2 = (p, m = 'GET', b, cookie = '') => call(p, m, b, 'pro', 'import-user', cookie);
  const get = async () => await (await call2('/api/state')).json();
  let s = await get();
  const a = s.state.assets[0];
  const before = structuredClone(a);
  const data = {
    mode: 'upsert',
    assets: [
      {
        code: a.code,
        name: 'JSONで更新',
        properties: {
          model: 'NEW MODEL',
        },
      },
      {
        code: 'JSON-NEW-1',
        name: '冷却ポンプ',
        drawingId: 'site',
        point: [150, 220],
        properties: {
          category: 'cool',
        },
      },
    ],
  };
  let r = await (await call2('/api/assets/import-preview', 'POST', data)).json();
  assert.equal(r.canApply, true);
  assert.equal(r.created, 1);
  assert.equal(r.updated, 1);
  assert.equal((await get()).revision, s.revision);
  assert.equal(
    (
      await call2('/api/assets/import', 'POST', {
        ...data,
        revision: r.revision,
        confirm: 'IMPORT_ASSETS',
      })
    ).status,
    200,
  );
  s = await get();
  let updated = s.state.assets.find((x) => x.id === a.id);
  assert.equal(updated.name, 'JSONで更新');
  assert.deepEqual(updated.history, before.history);
  assert.deepEqual(updated.attachments, before.attachments);
  assert.equal(updated.properties.category, before.properties.category);
  assert.deepEqual(updated.point, before.point);
  assert.equal(s.state.assets.length, 65);
  assert.equal(s.state.works.length, 6);
  assert.equal(
    (
      await call2('/api/assets/import', 'POST', {
        ...data,
        revision: r.revision,
        confirm: 'IMPORT_ASSETS',
      })
    ).status,
    409,
  );
  const bad = {
    assets: [
      {
        code: 'GOOD-1',
        name: 'Good',
        drawingId: 'site',
        point: [1, 2],
        properties: {},
      },
      {
        code: 'BAD-1',
        name: 'Missing position',
        drawingId: 'site',
        properties: {},
      },
    ],
  };
  r = await (await call2('/api/assets/import-preview', 'POST', bad)).json();
  assert.equal(r.canApply, false);
  assert.equal(r.errors[0].row, 2);
  assert.equal(
    (
      await call2('/api/assets/import', 'POST', {
        ...bad,
        revision: s.revision,
        confirm: 'IMPORT_ASSETS',
      })
    ).status,
    422,
  );
  assert.ok(!(await get()).state.assets.some((x) => x.code === 'GOOD-1'));
  r = await (
    await call2('/api/assets/import-preview', 'POST', {
      assets: [
        {
          code: a.code,
          name: 'Duplicate',
          point: [1, 2],
          properties: {},
        },
      ],
    })
  ).json();
  assert.equal(r.canApply, false);
  assert.equal(
    (
      await call2('/api/assets/' + a.id, 'PATCH', {
        locks: {
          position: true,
          attributes: true,
        },
      })
    ).status,
    200,
  );
  for (const patch of [
    {
      name: 'locked',
    },
    {
      point: [1, 2],
    },
    {
      locks: {
        position: false,
        attributes: false,
      },
    },
    {
      history: [],
    },
    {
      attachments: [],
    },
    {
      properties: {
        unknown: 'bad',
      },
    },
  ]) {
    r = await (
      await call2('/api/assets/import-preview', 'POST', {
        mode: 'upsert',
        assets: [
          {
            code: a.code,
            ...patch,
          },
        ],
      })
    ).json();
    assert.equal(r.canApply, false, JSON.stringify(patch));
  }
  assert.equal(
    (await call2('/api/assets/import-preview', 'POST', data, 'factory_mode=viewer')).status,
    403,
  );
  r = await (
    await call2('/api/assets/import-preview', 'POST', {
      assets: [
        {
          code: 'FOREIGN-FILE',
          name: 'Bad ref',
          drawingId: 'site',
          point: [1, 2],
          properties: {},
          attachments: [
            {
              fileId: iconFile,
            },
          ],
        },
      ],
    })
  ).json();
  assert.equal(r.canApply, false);
  updated = (await get()).state.assets.find((x) => x.id === a.id);
  assert.equal(updated.locks.attributes, true);
  assert.equal(updated.name, 'JSONで更新');
});
test('team workboard retains assignments, blockers, comments and optimistic revisions', async () => {
  const team = (p, m = 'GET', b, cookie = '') => call(p, m, b, 'pro', 'team-user', cookie);
  const snapshot = async () => await (await team('/api/state')).json();
  let current = await snapshot();
  assert.equal(
    (
      await team('/api/team/demo', 'POST', {
        revision: current.revision,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await team('/api/team/demo', 'POST', {
        revision: (await snapshot()).revision,
      })
    ).status,
    409,
  );
  current = await snapshot();
  assert.equal(current.state.tasks.length, 8);
  assert.equal(current.state.teamMembers.length, 4);
  const task = current.state.tasks.find((t) => t.status === 'open' && t.kind === 'task');
  let r = await team('/api/tasks/' + task.id, 'PATCH', {
    revision: current.revision,
    record: {
      assigneeId: current.state.teamMembers[1].id,
      priority: 'urgent',
      status: 'waiting',
      blocker: '部品の到着を待つ',
    },
  });
  assert.equal(r.status, 200);
  assert.equal(
    (
      await team('/api/tasks/' + task.id, 'PATCH', {
        revision: current.revision,
        record: {
          title: 'stale',
        },
      })
    ).status,
    409,
  );
  current = await snapshot();
  r = await team('/api/tasks/' + task.id + '/comments', 'POST', {
    revision: current.revision,
    text: '明日の朝会で納期を確認します。',
  });
  assert.equal(r.status, 201);
  const history = await (await team('/api/tasks/' + task.id + '/history')).json();
  assert.equal(history.items[0].action, 'comment');
  assert.ok(history.items[0].comment.includes('朝会'));
  assert.ok(history.items.some((e) => e.action === 'created'));
  assert.ok(history.items.some((e) => e.action === 'updated'));
  current = await snapshot();
  assert.equal(
    (
      await team('/api/tasks/' + task.id, 'PATCH', {
        revision: current.revision,
        record: {
          assigneeId: 'foreign-member',
        },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await team('/api/tasks/' + task.id, 'PATCH', {
        record: {
          title: 'no revision',
        },
      })
    ).status,
    422,
  );
  const report = await (await team('/api/team/report')).json();
  assert.ok(report.waiting >= 2);
  assert.ok(report.unassigned >= 1);
  assert.ok(report.loads.some((m) => m.minutes > 0));
  assert.ok(report.markdown.includes('部品の到着'));
  assert.ok(report.markdown.includes('明日の朝会で納期を確認'));
  for (const path of [
    '/api/tasks',
    '/api/teamMembers',
    '/api/inspectionPlans',
    '/api/team/report',
    '/api/tasks/' + task.id + '/history',
  ]) {
    assert.equal((await team(path, 'GET', undefined, 'factory_mode=viewer')).status, 403);
  }
  const view = (await (await team('/api/state', 'GET', undefined, 'factory_mode=viewer')).json())
    .state;
  for (const k of ['tasks', 'teamMembers', 'inspectionPlans']) {
    assert.deepEqual(view[k], []);
  }
  assert.equal(
    (await call('/api/tasks/' + task.id, 'GET', undefined, 'pro', 'other-team-user')).status,
    404,
  );
});
test('inspection planning creates one task per equipment and cycle with stale and duplicate guards', async () => {
  const team = (p, m = 'GET', b) => call(p, m, b, 'pro', 'team-user');
  const snapshot = async () => await (await team('/api/state')).json();
  let current = await snapshot();
  const plan = current.state.inspectionPlans[0];
  let preview = await (await team('/api/inspectionPlans/' + plan.id + '/preview')).json();
  assert.equal(preview.created, 3);
  const applied = await team('/api/inspectionPlans/' + plan.id + '/generate', 'POST', {
    revision: preview.revision,
    cycleDate: preview.cycleDate,
  });
  assert.equal(applied.status, 201);
  assert.equal(
    (
      await team('/api/inspectionPlans/' + plan.id + '/generate', 'POST', {
        revision: preview.revision,
        cycleDate: preview.cycleDate,
      })
    ).status,
    409,
  );
  current = await snapshot();
  const generated = current.state.tasks.filter((t) => t.origin?.planId === plan.id);
  assert.equal(generated.length, 3);
  assert.equal(new Set(generated.map((t) => t.assetId)).size, 3);
  assert.equal(current.state.inspectionPlans[0].nextDue, preview.nextDue);
  assert.equal(
    (
      await team('/api/inspectionPlans/' + plan.id, 'PATCH', {
        revision: current.revision,
        record: {
          nextDue: preview.cycleDate,
        },
      })
    ).status,
    200,
  );
  preview = await (await team('/api/inspectionPlans/' + plan.id + '/preview')).json();
  assert.equal(preview.created, 0);
  assert.equal(preview.skipped, 3);
  assert.equal(
    (
      await team('/api/inspectionPlans/' + plan.id + '/generate', 'POST', {
        revision: preview.revision,
        cycleDate: preview.cycleDate,
      })
    ).status,
    201,
  );
  assert.equal(
    (await snapshot()).state.tasks.filter((t) => t.origin?.planId === plan.id).length,
    3,
  );
});
test('completing inspection is atomic, checks required items, preserves locks and records history once', async () => {
  const team = (p, m = 'GET', b) => call(p, m, b, 'pro', 'team-user');
  const snapshot = async () => await (await team('/api/state')).json();
  let current = await snapshot();
  const t = current.state.tasks.find((t) => t.origin && t.status === 'open');
  const a = current.state.assets.find((a) => a.id === t.assetId);
  const day = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
  }).format(new Date());
  const completion = {
    date: day,
    result: 'attention',
    text: '振動あり。修理の手配が必要。',
    createFollowup: true,
    followupDueDate: day,
    nextDate: '2027-01-01',
    updateNextDate: true,
  };
  assert.equal(
    (
      await team('/api/tasks/' + t.id + '/complete', 'POST', {
        ...completion,
        revision: current.revision,
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await team('/api/tasks/' + t.id, 'PATCH', {
        revision: current.revision,
        record: {
          status: 'done',
        },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await team('/api/assets/' + a.id, 'PATCH', {
        locks: {
          attributes: true,
          position: true,
        },
      })
    ).status,
    200,
  );
  current = await snapshot();
  const checked = t.checklist.map((c) => ({
    id: c.id,
    done: true,
  }));
  assert.equal(
    (
      await team('/api/tasks/' + t.id + '/complete', 'POST', {
        ...completion,
        revision: current.revision,
        checklist: checked,
      })
    ).status,
    423,
  );
  assert.equal(
    (await snapshot()).state.assets.find((x) => x.id === a.id).history.length,
    a.history.length,
  );
  assert.equal(
    (
      await team('/api/tasks/' + t.id + '/complete', 'POST', {
        ...completion,
        updateNextDate: false,
        revision: current.revision,
        checklist: checked,
      })
    ).status,
    200,
  );
  current = await snapshot();
  const asset = current.state.assets.find((x) => x.id === a.id);
  const done = current.state.tasks.find((x) => x.id === t.id);
  const h = asset.history.find((h) => h.taskId === t.id);
  assert.equal(current.state.tasks.filter((x) => x.followupFor === t.id).length, 1);
  assert.ok(done.followupTaskId);
  assert.equal(done.status, 'done');
  assert.equal(h.result, 'attention');
  assert.equal(h.inspector, '空調・熱源担当');
  assert.equal(asset.history.length, a.history.length + 1);
  assert.equal(asset.properties.nextInspection, a.properties.nextInspection);
  assert.equal(
    (
      await team('/api/tasks/' + t.id + '/complete', 'POST', {
        ...completion,
        revision: current.revision,
        checklist: checked,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await team('/api/tasks/' + t.id, 'PATCH', {
        revision: current.revision,
        record: {
          status: 'open',
        },
      })
    ).status,
    422,
  );
  assert.equal((await team('/api/assets/' + a.id + '/maintenance/' + h.id, 'DELETE')).status, 422);
});
test('task attachments remain available in immutable history after task deletion', async () => {
  const team = (p, m = 'GET', b) => call(p, m, b, 'pro', 'team-files');
  const snapshot = async () => await (await team('/api/state')).json();
  let current = await snapshot();
  const form = new FormData();
  form.append(
    'file',
    new Blob(['%PDF-1.4\nTask evidence'], {
      type: 'application/pdf',
    }),
    'task.pdf',
  );
  const f = (await (await team('/api/files', 'POST', form)).json()).files[0];
  const r = await team('/api/tasks', 'POST', {
    revision: current.revision,
    record: {
      title: '添付資料のある仕事',
      attachments: [f],
    },
  });
  assert.equal(r.status, 201);
  const task = (await r.json()).record;
  current = await snapshot();
  assert.equal(
    (
      await team('/api/tasks/' + task.id, 'DELETE', {
        revision: current.revision,
      })
    ).status,
    200,
  );
  assert.equal((await team('/api/files/' + f.fileId, 'DELETE')).status, 409);
  assert.equal((await team('/api/files/' + f.fileId + '?inline=1')).status, 200);
  const history = await (await team('/api/tasks/' + task.id + '/history')).json();
  assert.ok(history.items.some((e) => e.action === 'deleted'));
  assert.ok(history.items.some((e) => e.after?.attachments?.length));
});
test('equipment import remains valid when tasks and inspection plans reference other equipment', async () => {
  const team = (p, m = 'GET', b) => call(p, m, b, 'pro', 'team-user');
  const s = await (await team('/api/state')).json();
  const a = s.state.assets[5];
  const payload = {
    mode: 'upsert',
    assets: [
      {
        code: a.code,
        location: '作業管理開始後に取り込み',
      },
    ],
  };
  const preview = await (await team('/api/assets/import-preview', 'POST', payload)).json();
  assert.equal(preview.canApply, true, JSON.stringify(preview.errors));
  assert.equal(
    (
      await team('/api/assets/import', 'POST', {
        ...payload,
        revision: preview.revision,
        confirm: 'IMPORT_ASSETS',
      })
    ).status,
    200,
  );
  const next = (await (await team('/api/state')).json()).state;
  assert.equal(next.tasks.length, s.state.tasks.length);
  assert.equal(next.inspectionPlans.length, s.state.inspectionPlans.length);
  assert.equal(next.assets[5].location, '作業管理開始後に取り込み');
});
test('projects and task sequencing enforce dependencies, parent completion and explicit acceptance across all APIs', async () => {
  const request = (p, m = 'GET', body, cookie = '') =>
    call(p, m, body, 'pro', 'workflow-user', cookie);
  const snapshot = async () => await (await request('/api/state')).json();
  let current = await snapshot();
  const r = await request('/api/projects', 'POST', {
    revision: current.revision,
    record: {
      name: '配管更新',
      goal: '受入まで確認する',
    },
  });
  assert.equal(r.status, 201);
  const project = (await r.json()).record;
  const create = async (record) => {
    const s = await snapshot();
    const r = await request('/api/tasks', 'POST', {
      revision: s.revision,
      record: {
        projectId: project.id,
        ...record,
      },
    });
    assert.equal(r.status, 201, await r.clone().text());
    return (await r.json()).record;
  };
  const first = await create({
    title: '隔離を確認',
    acceptanceCriteria: '隔離手順を現場で確認',
  });
  const parent = await create({
    title: '配管更新を受け入れる',
    dependsOnIds: [first.id],
  });
  const child = await create({
    title: '漏れ検査',
    parentId: parent.id,
  });
  current = await snapshot();
  for (const record of [
    {
      status: 'in_progress',
    },
    {
      status: 'done',
    },
  ]) {
    assert.equal(
      (
        await request('/api/tasks/' + parent.id, 'PATCH', {
          revision: current.revision,
          record,
        })
      ).status,
      422,
    );
  }
  assert.equal(
    (
      await request('/api/tasks/' + first.id + '/complete', 'POST', {
        revision: current.revision,
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request('/api/tasks/' + first.id + '/complete', 'POST', {
        revision: current.revision,
        record: {
          acceptanceConfirmed: true,
        },
      })
    ).status,
    200,
  );
  current = await snapshot();
  assert.equal(
    (
      await request('/api/tasks/' + parent.id, 'PATCH', {
        revision: current.revision,
        record: {
          status: 'in_progress',
        },
      })
    ).status,
    200,
  );
  current = await snapshot();
  assert.equal(
    (
      await request('/api/tasks/' + parent.id + '/complete', 'POST', {
        revision: current.revision,
      })
    ).status,
    422,
    'open child blocks parent completion',
  );
  assert.equal(
    (
      await request('/api/projects/' + project.id, 'PATCH', {
        revision: current.revision,
        record: {
          status: 'done',
        },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request('/api/tasks/' + child.id + '/complete', 'POST', {
        revision: current.revision,
      })
    ).status,
    200,
  );
  current = await snapshot();
  assert.equal(
    (
      await request('/api/tasks/' + parent.id + '/complete', 'POST', {
        revision: current.revision,
      })
    ).status,
    200,
  );
  current = await snapshot();
  assert.equal(
    (
      await request('/api/projects/' + project.id, 'PATCH', {
        revision: current.revision,
        record: {
          status: 'done',
        },
      })
    ).status,
    200,
  );
  const stats = (await (await request('/api/team/projects')).json()).items.find(
    (p) => p.id === project.id,
  ).stats;
  assert.equal(stats.progress, 100);
  assert.equal(stats.total, 3);
  current = await snapshot();
  assert.equal(
    (
      await request('/api/tasks/' + first.id, 'PATCH', {
        revision: current.revision,
        record: {
          status: 'open',
        },
      })
    ).status,
    422,
    'reopening a prerequisite must not invalidate finished dependent work',
  );
  for (const path of ['/api/projects', '/api/projects/' + project.id, '/api/team/projects']) {
    assert.equal((await request(path, 'GET', undefined, 'factory_mode=viewer')).status, 403);
  }
  assert.deepEqual(
    (await (await request('/api/state', 'GET', undefined, 'factory_mode=viewer')).json()).state
      .projects,
    [],
  );
  assert.equal(
    (await call('/api/projects/' + project.id, 'GET', undefined, 'pro', 'other-workflow-user'))
      .status,
    404,
  );
});
test('workflow relationships reject missing references and cycles without partial writes; demo preserves facility records', async () => {
  const request = (p, m = 'GET', body) => call(p, m, body, 'pro', 'workflow-demo-user');
  const snapshot = async () => await (await request('/api/state')).json();
  let current = await snapshot();
  const before = structuredClone(current.state);
  assert.equal(
    (
      await request('/api/team/workflow-demo', 'POST', {
        revision: current.revision,
      })
    ).status,
    201,
  );
  current = await snapshot();
  assert.equal(current.state.projects.length, 3);
  assert.equal(current.state.tasks.length, 16);
  assert.deepEqual(current.state.assets, before.assets);
  assert.deepEqual(current.state.works, before.works);
  assert.equal(
    (
      await request('/api/team/workflow-demo', 'POST', {
        revision: current.revision,
      })
    ).status,
    409,
  );
  const task = current.state.tasks.find((t) => t.id === 'demo-pipe-survey');
  assert.equal(
    (
      await request('/api/tasks/' + task.id, 'PATCH', {
        revision: current.revision,
        record: {
          dependsOnIds: ['demo-pipe-install'],
        },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request('/api/tasks/' + task.id, 'PATCH', {
        revision: current.revision,
        record: {
          parentId: 'missing',
        },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await request('/api/projects/' + task.projectId, 'DELETE', {
        revision: current.revision,
      })
    ).status,
    422,
  );
  const invalid = structuredClone(current);
  invalid.state.tasks.find((t) => t.id === task.id).dependsOnIds = ['demo-pipe-install'];
  assert.equal((await request('/api/state', 'PUT', invalid)).status, 422);
  assert.equal((await snapshot()).revision, current.revision);
});
