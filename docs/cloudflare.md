# Cloudflareへの配置

## 構成

| 項目         | このデモの設定                                |
| ------------ | --------------------------------------------- |
| Worker       | `plantdesk`                                   |
| 独自ドメイン | `plantdesk.chaoslab.fyi`                      |
| D1           | `factory-map-saas-demo` / binding `DB`        |
| 静的ファイル | `public/` / binding `ASSETS`                  |
| 認証         | Cloudflare AccessのWorker単位保護とメール認証 |
| 定期同期     | 毎分Cronが同期要求・次回予定を確認            |

D1名は既存データを引き継ぐため維持しています。リポジトリ名変更でDBを作り直しません。D1のIDとAccessのAUDは公開設定ですが、APIトークン・Notionトークン・暗号化キーは秘密情報です。

## 別アカウントへ配置する

1. Node.js 22.13以上で `npm ci`、`npm ci --prefix frontend`、`npm ci --prefix cloudflare` を実行します。
2. D1を作成し、`cloudflare/wrangler.jsonc` のDB名・IDを自分の環境へ変更します。`routes` のホスト名も変更します。
3. `npm run build` を実行します。
4. 必要なDBにマイグレーションを適用します。

```sh
npm exec --prefix cloudflare -- wrangler d1 migrations apply factory-map-saas-demo --remote --config cloudflare/wrangler.jsonc
```

5. Worker単位のAccessアプリを作り、メール認証と許可ポリシーを設定します。アプリのWorker destinationを対象WorkerのIDに関連付け、`ACCESS_TEAM` と `ACCESS_AUD` を設定します。
6. Notion同期を使う場合は `NOTION_TOKEN_KEY` をWorkerのsecretとして登録します。接続済み環境のキーを変更すると保存済みトークンを復号できなくなるため、既存キーを保持します。
7. dry runを確認してから配置します。

```sh
npm exec --prefix cloudflare -- wrangler deploy --dry-run --config cloudflare/wrangler.jsonc
npm exec --prefix cloudflare -- wrangler deploy --config cloudflare/wrangler.jsonc
```

マイグレーションは `0001`〜`0006` すべてを対象にします。工事・作業履歴とNotion同期にも専用テーブルが必要です。新規環境の初期化と、既存DBへの更新を混同しないでください。

## 独自ドメインと旧URL

独自ドメインは既存のCloudflareゾーンへWorkerのCustom Domainとして接続します。サブドメインのために親ドメインを再購入したり、子ゾーンをオンボードする必要はありません。

1. 対象アカウント、親ゾーン、Worker、ホスト名の既存設定を確認します。
2. Custom Domainを追加します。APIは `PUT /accounts/{account_id}/workers/domains`、本文は `hostname`・`service`・対象の `zone_id` です。必要な権限は [Workers Scripts Write](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/) です。
3. DNS解決、HTTPS、Accessへの遷移を確認し、許可した利用者がマップ・管理画面・APIを開けることを確認します。
4. 確認後に `POST /accounts/{account_id}/workers/scripts/{script_name}/subdomain` で `enabled: false` と `previews_enabled: false` を設定します。
5. Wranglerにも `workers_dev: false`、`preview_urls: false` を残し、次回配置で旧URLが復活しないようにします。

Worker単位のAccessは新しいCustom Domainにも適用されます。公開範囲を広げるためにAccessを解除しません。新URLが未接続の場合、旧URLは先に停止しません。

公式資料：[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)、[workers.devの無効化](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)、[Worker単位のAccess](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)。

## API・MCPの認証

手動MCP、管理されたCloudflareプラグイン、APIトークンは別の接続です。接続名・アカウント・リソース・必要scopeを分けて確認します。読み取り成功だけで書き込み可能とは判断しません。

403では不足scopeや対象リソースの権限を確認します。同じ不足権限のまま再認証を繰り返しません。401でも直ちに接続を削除せず、クライアントの更新・再接続を確認します。OAuthの保存・更新は正式なクライアントの機構に任せ、認証情報を別チャットやホストへコピーしません。

APIトークンを使う場合は、Git管理外の秘密ストアや環境変数から供給します。共有設定を整理するために既存接続を勝手に削除したり、操作承認を弱めたりしません。

## 配置後の確認と復旧

- 新しいURLのDNS・TLS・SSO、無料／有料デモのデータ分離、閲覧モードの公開範囲を確認します。
- D1 binding、AccessのAUD、Notion暗号化キー、Cronが保持されていることを確認します。
- タスクの保存・完了とNotionの前回正常完了日時を確認します。自動テストと本番連携の確認は分けて記録します。
- 問題があれば直前のWorkerバージョンへ戻します。DBを変更する場合はバックアップと互換性を先に確認します。URL切替に失敗した場合は新URLを直すか、確認済みの旧ルートを復旧します。

## 保存と制限

台帳全体750KB、添付は各5MB・1回合計5MBまでです。資料はD1のチャンクに保存します。大規模運用ではR2、台帳の正規化、ページング、レート制御、監視・復旧運用を追加してください。

`/api/v1` とSCIMの汎用OIDC基盤は実験的な別経路です。メールSSOで使うマップ・管理画面は `/api/session` などのSaaS APIへ接続します。実決済、組織への招待、本番IdPとのSCIM相互運用は完成範囲に含めていません。
