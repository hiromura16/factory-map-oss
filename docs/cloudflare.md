# Cloudflare / D1 SaaS 基盤（開発段階）

このコードは既存の Rust / PostgreSQL デモとは別の **未デプロイ API 基盤** です。既存 UI の API をそのまま置き換える互換サーバーではありません。既存デモ、DB、Cloudflare 設定は変更していません。実際の SaaS 公開には下記の未完了項目を解消してください。

## 実装済み

- `cloudflare/migrations/0001_tenants.sql`: 個人ユーザー、組織、所属と owner/editor/viewer、無効化フラグ、組織ごとの状態、操作履歴。
- 固定した OIDC issuer/audience/JWKS で RS256 署名、有効期限、発行者、対象クライアントを検証。token の jku/x5u は参照しません。認証済み利用者だけ初回登録可能。
- 全組織 API で有効な所属を確認。組織 ID を変えても他組織のデータにアクセスできません。認証用 email はキーにせず issuer + subject を使用。
- 登録はデフォルト無効。署名検証済み ID token を Bearer で送る方式です。Cookie、共有パスワード、無署名の開発ヘッダーは受け付けません。
- Free: 図面3 / 設備100、Pro: 30 / 2000、Enterprise: 100 / 10000。API が上限を検証。カスタマイズは Pro 以上。
- プラン変更は **課金モックのみ**。課金額ゼロ、決済 SDK なし、実請求なし。設定を明示的に true にした場合のみ owner が操作可能。既存データが上限を超すダウングレードは拒否し、データは削除しません。
- revision と変更時点の plan を条件にした楽観ロック。監査記録と更新は D1 batch でトランザクション化。
- PostgreSQL 版の `GET /api/export` の JSON または state 本体を dry-run 検証し、点検履歴を維持して空ワークスペースへ取り込み。重複 ID/設備コード/参照不整合/件数超過を拒否。
- 添付参照がある場合はインポートを拒否。元の JSON export にファイル本体は含まれないため、成功したふりをしません。

## API

Bearer は設定した ID プロバイダーが発行した署名済みトークンです。すべて同一オリジンから呼び出します。ログや URL にトークンを入れないでください。

- `GET /health`: 開発段階表示
- `POST /api/v1/onboard` body `{"name":"My workspace"}`: 新しい個人アカウントと組織（登録有効時）
- `GET /api/v1/organizations`: 自分の所属組織
- `GET /api/v1/organizations/:id/state`, `export`: revision/state/plan/limits
- `PUT .../state`: `{"revision":0,"state":{...}}`
- `POST .../import-preview`: 旧 `{"revision":0,"state":{...}}`。書き込みなし
- `POST .../import`: 現在の revision と state。空ワークスペース限定、再取り込み拒否
- `GET/PUT .../customization`: accent/theme/density/brandName
- `GET/POST .../billing`: 明示したモックプラン切替のみ
- `GET .../audit`: owner 向け最近100件
- `.../scim`: **501 未実装**。成功応答するダミー SCIM ではありません

saas.html に Authorization Code + PKCE / state / nonce を使う管理コンソールを追加しました。モックによるフロー検証済みですが実 IdP 接続は未検証です。現段階で本番 SSO 完成とは扱わないでください。旧地図 UI と D1 API の統合は未完了です。

## ローカル検証

Node.js 18 以上と Python 3（標準 sqlite3）が必要です。テストは一時 SQLite DB のみを作り、本番 DB へ接続しません。

```sh
cd cloudflare
npm run check
npm test
# オフライン移行検証。書き込みは行わない
cd ..
node scripts/preview-d1-import.mjs exported-factory-map.json pro
```

テストは依存パッケージ不要。Worker 統合テストでは実際に RSA トークンを署名し、Web Crypto 検証を通し、D1 形式の SQL を標準 SQLite で実行します。これは Cloudflare 実環境での Wrangler / D1 / IdP 相互運用テストの代わりではありません。

## 帰宅後の準備（まだ実行していない）

1. Cloudflare アカウント、独自ドメイン、プランと上限を確認。
2. D1 を開発用に新規作成し、wrangler.jsonc の placeholder を実 ID に置き換える。既存 PostgreSQL は維持する。
3. 本番と開発の OIDC アプリを分離して作成し、issuer/audience/JWKS を設定。秘密値を Git に保存しない。
4. ローカル D1 migrations と開発環境で検証。公開前に IdP 実接続・トークン種別・失効/再認証/ログアウト・rate limit を設計、試験。
5. R2 へのファイル移行・アクセス制御・アップロード検証を実装後、DB バックアップから dry-run → 移行検証 → 切替。
6. 認証・組織選択と既存地図 UI を結線して E2E / tenant isolation / upload boundary / accessibility を検証。
7. レビュー後のみデプロイ。今ある public Sites / Quick Tunnel は無断で切り替えない。

## 重要な未完了項目

- 本番公開に必要な rate limiting、メール確認/招待、パスワード再設定（パスワード認証自体を採用していません）、管理コンソールの実 IdP 検証。
- SCIM Groups、PUT/full replacement、bulk、複雑なfilter、IdP conformance test。新しい /scim/v2 の実装範囲は下記参照。SSO と SCIM は別機能です。
- R2 添付・図面バイナリ、PostgreSQL BYTEA と既存 IndexedDB の移行。現インポーターは JSON のみで、添付参照があれば停止します。
- 既存 UI / REST 48操作との互換アダプター、WebMCP 統合、重い CAD 処理と写真サムネイル生成。
- 現基盤は JSON snapshot 1行・最大750 KB。大規模設備の運用は各 entity の正規化とページングが必要。プラン件数上限だけで容量を保証しません。
- 課金価格、契約、決済、Webhook、請求書は未実装。mock flag を本番決済として使用しない。
- JWKS は5分キャッシュ。鍵ローテーション時の即時再取得/失効と運用監視の改善が必要。

OSS 公開前は `.runtime`、パスワード、既存 DB、実施設データ、秘密を含むスクリーンショットやアーカイブを除外してください。

## SCIM 2.0 Users（追加実装・未デプロイ）

cloudflare/scim.mjs と 0002_scim.sql に、組織を固定した User provisioning を実装しました。**設定がない初期状態では503で停止**します。通常の OIDC Bearer と SCIM Bearer は別物で、互いの認証には使えません。旧APIの /api/v1/organizations/:id/scim は501のままですが、下記の独立エンドポイントで実処理を行います。

必要な設定（この作業では設定も実トークン生成も実行していません）：

- SCIM_ORGANIZATION_ID: 既存の対象組織1件だけ。
- SCIM_TOKEN_HASH: 運用担当者が管理する長いランダムBearerトークンの SHA-256（64桁hex）のみ。平文トークンをGit、wrangler設定、ログへ保存しない。
- AUTH_ISSUER: その組織に使うOIDC issuer。ユーザーの externalId は **このissuerが発行する sub と完全一致**させる。メールアドレスを代用しない。前後空白は暗黙に削除せず拒否します。

対応：

- GET /scim/v2/ServiceProviderConfig, /Schemas, /ResourceTypes（各User詳細も対応）
- GET /scim/v2/Users: userName eq filter（名前は大文字小文字非区別）、startIndex 1起点、count 0〜100。複雑なfilterは invalidFilter で拒否。
- POST /scim/v2/Users: schemas/externalId/userName必須、active/displayName任意。viewerとして登録。同じ内容の再送は同じIDを返す。
- GET /scim/v2/Users/:id
- PATCH /scim/v2/Users/:id: add/replaceの active / userName / displayName。externalId、roles、groups、組織は変更不可。
- DELETE /scim/v2/Users/:id: 内部soft-delete＋membership無効化。その後GET404、一覧/filterから除外。再POSTは同じOIDC主体・同じresource IDとして復帰。PATCH active=false は削除せず停止し、PATCH trueで再有効化。
- GETのETagとPATCH/DELETEのIf-Match。変更はversion/role確認を含むトランザクション。競合時は409/412で停止。
- scim_events にサービス主体で監査記録。再送の同一POSTは監査を増やさない。
- membership active を通常OIDC APIも毎回検証するため、SCIM停止直後から当該組織への既発行Bearerアクセスも拒否。

安全境界：

SCIMが新規作成した **viewer** のみ変更可能です。既存owner/editor/viewerの所属を勝手に取り込めず、管理者がowner/editorへ昇格したユーザーの変更・削除も拒否します。したがって最後のownerをSCIMが停止することはできません。組織固定トークンで別組織のUser IDを指定しても404です。他組織の独立した所属やIdP自体のアカウントは変更しません。

Groupsは501、PUT、bulk、password変更、任意属性、複雑なfilterは未対応です。SCIMベンダーによって必須属性・PATCH方式が異なるため、Entra ID/Okta等との実接続検証完了までは本番利用不可。SCIM rate limiting・トークンローテーション運用・監査閲覧UIは別途必要です。

## 同一オリジンのコンソール配信

Wrangler設定に ASSETS / ../public / run_worker_first:true を準備しました。/ は /saas.html へ遷移、静的ファイルはASSETSで配信。未設定なら503です。/api と /scim 以下は静的fallbackに流しません。/health だけは無認証で稼働段階を確認できます。既存地図UIの旧Rust APIをD1へ接続する互換処理は、この配信設定によって完成するわけではありません。
