# Cloudflare SaaS デモの配置

## リソース

- Worker: `factory-map-saas`
- 仮URL: `https://factory-map-saas.pirosea-demo.workers.dev`
- D1: `factory-map-saas-demo` / binding `DB`
- 静的ファイル: `public/` / binding `ASSETS`。Workerを先に実行。
- 認証: Cloudflare Access。Worker全体を保護し、許可したメールアドレスのみ。
- 認証用公開値: `ACCESS_TEAM` と `ACCESS_AUD`。

D1のIDとAccessのAUDは公開設定であり、秘密のトークンではありません。OAuthトークン、APIトークン、メールコードはコードに書き込まないでください。

## 別アカウントへの配置

1. CloudflareでD1を作り、`cloudflare/wrangler.jsonc` のIDを新しいものに置き換えます。
2. `npm ci --prefix frontend`、`npm ci --prefix cloudflare`、`node frontend/build.mjs`、`node scripts/build-saas.mjs`。
3. `wrangler d1 migrations apply factory-map-saas-demo --remote --config cloudflare/wrangler.jsonc`。
4. Workerを作成し、AccessアプリのdestinationにこのWorkerのIDを指定します。全トラフィックを保護し、メール認証と許可ポリシーを設定します。
5. アプリのAUDとチームURLを `ACCESS_AUD` / `ACCESS_TEAM` に設定します。
6. `wrangler deploy --dry-run --config cloudflare/wrangler.jsonc` で確認後、`wrangler deploy --config cloudflare/wrangler.jsonc`。
7. 未ログインでSSO画面に移ること、許可していないメールでアクセスできないこと、許可メールで2つのデモが作成されることを確認します。

Wranglerは `cloudflare/node_modules/.bin/wrangler` または対応するnpm execから実行します。APIで静的ファイルを配置する場合は、公式のassets-upload-session → assets/upload → Worker uploadの順を使います。`scripts/upload-assets.py` はAPIが返す短時間有効のアップロード用JWTを隠した標準入力で受け取り、ローカルの認証情報を読みません。

## 独自ドメイン

仮URLで使えるため、現時点でドメイン取得は不要です。独自ドメインを用意した後、WorkersのCustom Domainを追加します。AccessはWorker全体に適用しているため、新ドメインも同じ保護の対象になります。接続後はDNS、TLS、SSOの戻り先、APIの同一オリジン動作を再確認してください。

## 保存と制限

D1 migrations 0001〜0003が、利用者、組織、権限、デモアカウント、台帳、設定、資料・チャンク、操作履歴、バックアップを作成します。登録時はSSOのissuerとsubjectを基準にし、メール文字列だけをアカウントキーには使いません。

Free / Proの台帳、表示設定、資料は分離されます。サーバーがプラン・権限・参照先・ロックを検査し、リビジョンで同時更新を拒否します。未使用資料を整理すると保存枠を空けられます。

台帳全体750KB、添付は各5MB・1回合計5MBまで。デモの資料はD1にチャンク保存するためR2の有効化は不要です。商用化ではR2、台帳の正規化、ページング、レート制御、バックアップ運用などを追加してください。

`/api/v1` とSCIMの汎用OIDC基盤は実験的な別経路です。SSOメールで利用する地図・管理画面は `/api/session` などのSaaS用APIに接続しています。本番IdPとSCIMの相互運用、SCIM Groups、実決済は今回の完成範囲に含めません。
