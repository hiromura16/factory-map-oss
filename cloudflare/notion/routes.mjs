/**
 * Notionの接続保存、同期要求、停止、競合解決と状態取得のAPI。
 * トークンは暗号化保存し、画面へ返す要約から平文と暗号文を除外します。
 */
import { ApiError } from '../core.mjs';
import { NotionConnector, NotionError, notionId } from '../../connectors/notion/index.mjs';
import { credentialsReady, encryptToken, decryptToken } from './credentials.mjs';
import { KINDS, LABELS, records } from './model.mjs';
const now = () => new Date().toISOString();
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
const get = (env, c) =>
  env.DB.prepare('SELECT * FROM map_notion_connections WHERE organization_id=?')
    .bind(c.org.id)
    .first();
const active = (r) => r?.lease_until && r.lease_until > now();
/**
 * 画面表示に必要な状態だけを返し、保存済みの接続トークンは応答に含めません。
 * 入力欄を空に戻しても、サーバー側の保存済みトークンは維持されます。
 */
async function summary(env, c, row) {
  const counts = await env.DB.prepare(
    'SELECT state,count(*) AS count FROM map_notion_links WHERE organization_id=? GROUP BY state',
  )
    .bind(c.org.id)
    .all();
  const states = Object.fromEntries(counts.results.map((r) => [r.state, r.count]));
  return {
    revision: c.org.revision,
    serverReady: credentialsReady(env),
    configured: !!row?.token_cipher,
    homePageId: row?.home_page_id || '',
    homeUrl: row?.home_page_id
      ? 'https://www.notion.so/' + row.home_page_id.replaceAll('-', '')
      : null,
    intervalMinutes: row?.interval_minutes || 15,
    direction: row?.direction || 'both',
    enabled: row?.enabled === 1,
    status: row?.status || 'disconnected',
    running: !!active(row),
    requested: !!row?.requested,
    lastRunAt: row?.last_run_at,
    lastSuccessAt: row?.last_success_at,
    nextRunAt: row?.next_run_at,
    lastError: row?.last_error || '',
    sources: Object.entries(JSON.parse(row?.sources_json || '{}')).map(([kind, s]) => ({
      kind,
      name: LABELS[kind],
      id: s.id,
      url: s.databaseId ? 'https://www.notion.so/' + s.databaseId.replaceAll('-', '') : null,
    })),
    counts: states,
    counters: JSON.parse(row?.counters_json || '{}'),
    progress: row?.job_json
      ? (() => {
          const j = JSON.parse(row.job_json);
          return j.runId
            ? {
                kind: KINDS[j.kindIndex] || '',
                phase: j.phase,
                startedAt: j.startedAt,
              }
            : null;
        })()
      : null,
  };
}
export async function notionRoutes(request, env, c, { readJSON, commit, mutate }) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');
    const method = request.method;
    const row = await get(env, c);
    if (path === '/api/notion/status' && method === 'GET') {
      return json(await summary(env, c, row));
    }
    if (path === '/api/notion/config' && method === 'PUT') {
      const input = await readJSON(request, 10000);
      if (!credentialsReady(env)) {
        throw new ApiError(503, 'Notionトークン暗号化キーが未設定です。');
      }
      if (active(row)) {
        throw new ApiError(409, '同期処理中です。停止後に接続設定を変更してください。');
      }
      const interval = Number(input.intervalMinutes);
      if (
        ![5, 15, 30, 60].includes(interval) ||
        !['both', 'push', 'pull'].includes(input.direction)
      ) {
        throw new ApiError(422, '同期方向と間隔を選択してください。');
      }
      const home = notionId(input.homePageId || row?.home_page_id);
      const inUse = await env.DB.prepare(
        'SELECT organization_id FROM map_notion_connections WHERE home_page_id=? AND organization_id!=?',
      )
        .bind(home, c.org.id)
        .first();
      if (inUse) {
        throw new ApiError(
          409,
          'このNotionページは別ワークスペースの同期先です。別のページを指定してください。',
        );
      }
      if (row?.home_page_id && home !== row.home_page_id) {
        throw new ApiError(409, '同期先の変更は、現在の接続を切断してから行ってください。');
      }
      let cipher = row?.token_cipher;
      if (input.token) {
        if (
          typeof input.token !== 'string' ||
          input.token.length < 20 ||
          input.token.length > 500 ||
          /\s/.test(input.token)
        ) {
          throw new ApiError(422, 'Notionの接続トークンを確認してください。');
        }
        const client = new NotionConnector({
          token: input.token,
          maxRequests: 3,
        });
        await client.testConnection();
        await client.getPage(home);
        cipher = await encryptToken(env, c.org.id, input.token);
      }
      if (!cipher) {
        throw new ApiError(422, 'Notionの接続トークンを入力してください。');
      }
      await env.DB.prepare(
        "INSERT INTO map_notion_connections(organization_id,actor_id,token_cipher,home_page_id,interval_minutes,direction,enabled,requested,status,next_run_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,'queued',?,?,?) ON CONFLICT(organization_id) DO UPDATE SET actor_id=excluded.actor_id,token_cipher=excluded.token_cipher,interval_minutes=excluded.interval_minutes,direction=excluded.direction,enabled=excluded.enabled,requested=map_notion_connections.requested+1,status='queued',job_json='{}',generation=map_notion_connections.generation+1,next_run_at=excluded.next_run_at,last_error=NULL,updated_at=excluded.updated_at",
      )
        .bind(
          c.org.id,
          c.user.id,
          cipher,
          home,
          interval,
          input.direction,
          input.enabled === true ? 1 : 0,
          now(),
          now(),
          now(),
        )
        .run();
      return json(await summary(env, c, await get(env, c)));
    }
    if (path === '/api/notion/run' && method === 'POST') {
      if (!row?.token_cipher) {
        throw new ApiError(422, '先にNotion接続を設定してください。');
      }
      const input = await readJSON(request, 1000);
      const job = JSON.parse(row.job_json || '{}');
      if (input.full === true && !active(row) && !job.runId) {
        job.forceProbe = true;
      }
      await env.DB.prepare(
        "UPDATE map_notion_connections SET requested=requested+1,next_run_at=?,status=CASE WHEN lease_token IS NULL THEN 'queued' ELSE status END,job_json=?,updated_at=? WHERE organization_id=?",
      )
        .bind(now(), JSON.stringify(job), now(), c.org.id)
        .run();
      return json(
        {
          queued: true,
          ...(await summary(env, c, await get(env, c))),
        },
        202,
      );
    }
    if (path === '/api/notion/pause' && method === 'POST') {
      if (row) {
        await env.DB.prepare(
          "UPDATE map_notion_connections SET enabled=0,requested=0,generation=generation+1,status=CASE WHEN lease_token IS NULL THEN 'paused' ELSE 'stopping' END,job_json='{}',updated_at=? WHERE organization_id=?",
        )
          .bind(now(), c.org.id)
          .run();
      }
      return json(await summary(env, c, await get(env, c)));
    }
    if (path === '/api/notion/config' && method === 'DELETE') {
      if (active(row)) {
        throw new ApiError(409, '同期を停止し、処理が終わってから切断してください。');
      }
      await env.DB.batch([
        env.DB.prepare('DELETE FROM map_notion_links WHERE organization_id=?').bind(c.org.id),
        env.DB.prepare('DELETE FROM map_notion_connections WHERE organization_id=?').bind(c.org.id),
      ]);
      return json({
        disconnected: true,
      });
    }
    if (path === '/api/notion/issues' && method === 'GET') {
      const r = await env.DB.prepare(
        "SELECT kind,local_id,page_id,state,issue_json,updated_at FROM map_notion_links WHERE organization_id=? AND state NOT IN ('active','deleted') ORDER BY updated_at DESC LIMIT 100",
      )
        .bind(c.org.id)
        .all();
      return json({
        revision: c.org.revision,
        items: r.results.map((r) => ({
          ...r,
          ...JSON.parse(r.issue_json || '{}'),
          issue_json: undefined,
          name:
            records(r.kind, c.state).find((x) => x.id === r.local_id)?.name ||
            records(r.kind, c.state).find((x) => x.id === r.local_id)?.title ||
            r.local_id,
          pageUrl: /^[a-f\d-]{36}$/i.test(r.page_id)
            ? 'https://www.notion.so/' + r.page_id.replaceAll('-', '')
            : null,
        })),
      });
    }
    if (path === '/api/notion/resolve' && method === 'POST') {
      const input = await readJSON(request, 5000);
      if (
        !['local', 'notion'].includes(input.source) ||
        !KINDS.includes(input.kind) ||
        input.revision !== c.org.revision
      ) {
        throw new ApiError(409, '最新のデータから選び直してください。');
      }
      if (active(row)) {
        throw new ApiError(409, '同期処理の完了後に選び直してください。');
      }
      const link = await env.DB.prepare(
        'SELECT * FROM map_notion_links WHERE organization_id=? AND kind=? AND local_id=?',
      )
        .bind(c.org.id, input.kind, input.localId)
        .first();
      if (!link || link.updated_at !== input.updatedAt) {
        throw new ApiError(409, '同期状態が更新されています。再読み込みしてください。');
      }
      if (
        (link.state === 'remote_deleted' && input.source === 'notion') ||
        (link.state === 'local_deleted' && input.source === 'local')
      ) {
        if (input.confirm !== 'DELETE_REVIEWED') {
          throw new ApiError(422, '削除内容の確認が必要です。');
        }
        if (link.state === 'remote_deleted') {
          const next = structuredClone(c.state);
          if (input.kind === 'inspections') {
            const original = records('inspections', next).find((r) => r.id === link.local_id);
            const asset = next.assets.find((a) => a.id === original?.assetId);
            if (asset) {
              asset.history = asset.history.filter((h) => h.id !== original.historyId);
            }
          } else {
            mutate(next, input.kind, link.local_id, 'DELETE', {});
          }
          await commit(env, c, next, 'notion.review-delete', input.revision);
        } else {
          const token = await decryptToken(env, c.org.id, row.token_cipher);
          await new NotionConnector({
            token,
            maxRequests: 2,
          }).updatePage(
            link.page_id,
            {},
            {
              in_trash: true,
            },
          );
        }
        await env.DB.prepare(
          "UPDATE map_notion_links SET state='deleted',resolution=NULL,issue_json=NULL,updated_at=? WHERE organization_id=? AND kind=? AND local_id=?",
        )
          .bind(now(), c.org.id, input.kind, input.localId)
          .run();
        return json({
          resolved: true,
        });
      }
      if (link.state === 'remote_deleted' && input.source === 'local') {
        const token = await decryptToken(env, c.org.id, row.token_cipher);
        await new NotionConnector({
          token,
          maxRequests: 2,
        }).updatePage(
          link.page_id,
          {},
          {
            in_trash: false,
          },
        );
      }
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE map_notion_links SET state='pending',resolution=?,updated_at=? WHERE organization_id=? AND kind=? AND local_id=?",
        ).bind(input.source, now(), c.org.id, input.kind, input.localId),
        env.DB.prepare(
          "UPDATE map_notion_connections SET requested=requested+1,next_run_at=?,status='queued',updated_at=? WHERE organization_id=?",
        ).bind(now(), now(), c.org.id),
      ]);
      return json(
        {
          queued: true,
        },
        202,
      );
    }
    if (path === '/api/notion/runs' && method === 'GET') {
      const r = await env.DB.prepare(
        'SELECT id,started_at,finished_at,status,counters_json,error FROM map_notion_runs WHERE organization_id=? ORDER BY started_at DESC LIMIT 20',
      )
        .bind(c.org.id)
        .all();
      return json({
        items: r.results.map((r) => ({
          ...r,
          counters: JSON.parse(r.counters_json),
          counters_json: undefined,
        })),
      });
    }
    throw new ApiError(404, 'Notion同期APIがありません。');
  } catch (e) {
    if (e instanceof NotionError) {
      throw new ApiError(e.status, e.message);
    }
    throw e;
  }
}
