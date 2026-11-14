# Notionコネクター

Node.js 22以降とCloudflare Workersで使える、標準Fetch APIによるNotionクライアントです。PlantDeskのポーリング同期で使用しています。PlantDeskのデータベース、Cloudflareのバインディング、認証情報の保存方式に依存せず、別のアプリでも利用できます。

Notion APIのバージョンは `2026-03-11` に固定しています。接続確認、データソースの操作、カーソルによるページ送り、ページの作成・更新、型に応じたプロパティ変換、リクエスト数の制限、API利用上限の通知、項目ごとの3方向マージに対応します。

## 利用例

接続トークンとデータソースIDは環境変数から読み込みます。`savedCursor` には前回保存したカーソルを渡します。初回は `null` を指定してください。

マージに使う `lastSyncedFields` は前回同期時、`localFields` は呼び出し元の現在の値、`notionFields` はNotionから取得した値を持つオブジェクトです。

```js
import {NotionConnector, threeWayMerge} from './index.mjs';

const notion = new NotionConnector({
  token: process.env.NOTION_TOKEN,
  maxRequests: 30,
  minIntervalMs: 400
});
const batch = await notion.queryPage(process.env.NOTION_DATA_SOURCE_ID, {
  pageSize: 25,
  cursor: savedCursor
});
// batch.resultsを処理してから、batch.next_cursorをDBなどへ保存します。
const merge = threeWayMerge(lastSyncedFields, localFields, notionFields);
if (merge.conflicts.length) {
  // 競合した項目は利用者に採用する側を確認します。
}
```

## 再開と通信エラー

`PollBudgetExceeded` が発生した場合は、呼び出し元で処理位置とカーソルを保存し、次の定期実行で再開してください。`NotionError.retryAfter` には、API利用上限に達したときの待機秒数が入ります。

通信エラー後の書き込みは自動再試行しません。作成が成功して応答だけ失われた可能性があるため、再作成する前に、呼び出し元で固定の外部IDを検索して重複を防いでください。

## プロパティの変換

`propertySchema`、`encodeProperty`、`decodeProperty` は、テキスト・タイトル、数値、日付、チェックボックス、単一選択・複数選択、URL、リレーション、リッチテキストに保存するJSONに対応します。

リレーションの変換には、呼び出し元が用意するIDの対応付け関数を渡します。管理対象外のプロパティやページ本文は、呼び出し元で扱います。

## PlantDeskとの役割分担

このパッケージはAPIクライアント、プロパティの変換関数、マージ関数を提供します。トークンの保存、Webhookの登録、定期実行の設定は含みません。

PlantDeskでは、[`cloudflare/notion/`](../../cloudflare/notion/) と [`frontend/notion-sync.jsx`](../../frontend/notion-sync.jsx) が、認証情報の暗号化保存、組織ごとのデータ分離、同期処理の排他制御、再開位置の保存、レコードの対応付け、競合の確認、設定画面を担当します。

ソースはGitHubで公開しています。npmには公開していません。
