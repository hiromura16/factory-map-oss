# ソースの配置

ルートにはREADME、ライセンス、パッケージ管理と品質チェックの設定を置きます。アプリのJS・JSX・CSS・HTMLは、用途ごとのディレクトリに置きます。

## 編集する場所

| 変更したいもの                                 | 編集先                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ダッシュボード、タスク、台帳、Notion同期の画面 | [`frontend/src/console/`](../frontend/src/console/)                                              |
| 敷地マップ、設備、工事、付箋、レイヤー、CAD    | [`frontend/src/map/`](../frontend/src/map/)                                                      |
| APIクライアント、写真・PDF、表示設定、WebMCP   | [`frontend/src/shared/`](../frontend/src/shared/)                                                |
| 画面のスタイル                                 | [`frontend/src/styles/`](../frontend/src/styles/)                                                |
| HTMLとAPIドキュメント画面                      | [`frontend/pages/`](../frontend/pages/)、[`frontend/src/developer/`](../frontend/src/developer/) |
| 画像、図面サンプル、同梱ライブラリー           | [`frontend/static/`](../frontend/static/)                                                        |
| HTTP API、認証、権限、保存、Notion同期         | [`cloudflare/`](../cloudflare/)                                                                  |
| 画面とAPIで共用する表示設定・レイヤー処理      | [`shared/`](../shared/)                                                                          |
| サンプル台帳とPDF                              | [`shared/demo/`](../shared/demo/)                                                                |
| REST APIの仕様                                 | [`api/openapi.json`](../api/openapi.json)                                                        |
| 汎用Notionコネクター                           | [`connectors/notion/`](../connectors/notion/)                                                    |
| 開発・ビルド・チェック・撮影                   | [`scripts/`](../scripts/)                                                                        |
| テスト                                         | [`tests/`](../tests/)、[`cloudflare/tests/`](../cloudflare/tests/)                               |
| 旧実装                                         | [`legacy/`](../legacy/)                                                                          |

`frontend/src/shared/` はブラウザー専用です。APIからも使う処理はルート側の `shared/` に置き、画面・DOM・通信への依存を持たせません。現行APIは旧Rust版のディレクトリを参照しません。

Reactの部品はJSXのモジュール、地図の既存スクリプトはIIFEとして扱います。地図側の公開インターフェースと読み込み順は維持しています。Nodeからも読む共通処理はCommonJSに対応し、ビルド用のESMは `.mjs` で明示します。

## ソースと配信ファイル

`npm run build` は次の順に実行します。

1. `frontend/build.mjs` がReactの入口 `src/console/ui.jsx` をビルドし、`frontend/.build/vendor/` にバンドルとライセンスを生成します。
2. `scripts/build.mjs` がWorkerを `cloudflare/dist/worker.mjs` にビルドします。
3. `frontend/entries.mjs` の対応表に従って、HTML・自作スクリプト・CSS・OpenAPI仕様を `public/` にコピーします。`frontend/static/` と生成済みReactバンドルも合流します。
4. 配置用のファイル一覧とハッシュを `.deploy/` に生成します。

たとえば `frontend/src/map/app.js` は `/app.js`、`shared/appearance.js` は `/appearance.js`、`api/openapi.json` は `/openapi.json` として配信します。ソースの階層を変えてもブラウザーのURLとブックマークを保てます。

新しいブラウザースクリプトやページを追加したら、対応表とHTMLの読み込みを更新します。`frontend/static/` はそのまま配信するファイル専用です。ソース、設定、認証情報を入れないでください。

## 生成物

`public/`、`frontend/.build/`、`cloudflare/dist/`、`.deploy/` はGitに含めません。`node_modules/` も依存関係から再生成します。同梱する第三者ライブラリーの原本とライセンスは `frontend/static/vendor/` に保持し、生成したReactバンドルと分けます。

開発サーバーは `npm run dev`、静的ファイルだけの確認は `python3 scripts/serve-static.py` を使います。どちらも事前にビルドが必要です。静的サーバーには保存・認証・APIの機能がありません。

[開発・検証の手順](development.md) · [アーキテクチャ](architecture.md)
