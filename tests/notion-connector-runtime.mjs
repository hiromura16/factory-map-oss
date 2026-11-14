// Notion接続をworkerdで検証する。Nodeの模擬Fetchでは検出できない実行環境差を確認。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const cfRequire = createRequire(new URL('../cloudflare/package.json', import.meta.url));
const uiRequire = createRequire(new URL('../frontend/package.json', import.meta.url));
const { Miniflare } = cfRequire('miniflare');
const { build } = uiRequire('esbuild');
const pageId = '11111111-1111-1111-1111-111111111111';
const built = await build({
  stdin: {
    contents: `
 import {NotionConnector} from '../connectors/notion/index.mjs';
 export default {async fetch(){
  try {
   const client=new NotionConnector({token:'runtime-test-dummy-token',minIntervalMs:0});
   const user=await client.testConnection();
   const page=await client.getPage('${pageId}');
   return Response.json({userId:user.id,pageId:page.id});
  }catch(e){return Response.json({code:e.code,error:e.message},{status:e.status||500});}
 }};`,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
  },
  bundle: true,
  format: 'esm',
  write: false,
  platform: 'browser',
  target: 'es2022',
});
for (const mode of ['success', 'unauthorized', 'redirect']) {
  const calls = [];
  const mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'notion-test',
          compatibilityDate: '2026-11-13',
          manifest: {
            mainModule: 'notion.mjs',
            modules: {
              'notion.mjs': {
                type: 'esm',
                contents: built.outputFiles[0].text,
              },
            },
          },
        },
        dev: {
          outboundService: {
            type: 'fetcher',
            handler: async (request) => {
              calls.push(request.url);
              assert.equal(
                new URL(request.url).origin,
                'https://api.notion.com',
                '接続トークンを別ホストへ送らない',
              );
              assert.equal(request.headers.get('authorization'), 'Bearer runtime-test-dummy-token');
              assert.equal(request.headers.get('notion-version'), '2026-03-11');
              if (mode === 'redirect') {
                return new Response(null, {
                  status: 302,
                  headers: {
                    location: 'https://untrusted.example/collect',
                  },
                });
              }
              if (mode === 'unauthorized') {
                return Response.json(
                  {
                    message: 'invalid token',
                  },
                  {
                    status: 401,
                  },
                );
              }
              return Response.json({
                id: request.url.endsWith('/users/me') ? 'test-bot' : pageId,
              });
            },
          },
        },
      },
    ],
  });
  try {
    const response = await mf.dispatchFetch('https://plantdesk.example/');
    const body = await response.json();
    assert.equal(
      response.status,
      mode === 'success' ? 200 : 502,
      JSON.stringify({
        mode,
        body,
      }),
    );
    assert.equal(
      calls.length,
      mode === 'success' ? 2 : 1,
      'リダイレクト先を取得せず、設定したAPIだけに通信する',
    );
    if (mode === 'success') {
      assert.deepEqual(body, {
        userId: 'test-bot',
        pageId,
      });
    } else {
      assert.equal(body.code, mode === 'unauthorized' ? 'http_401' : 'http_302');
    }
  } finally {
    await mf.dispose();
  }
}
console.log('PASS: workerdでNotion接続とページ取得、無効トークンの通知、リダイレクト拒否を確認');
