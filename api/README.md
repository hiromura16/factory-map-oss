# API仕様

`openapi.json` はOpenAPI 3.0.3を宣言する仕様ファイルです。ビルド時に `/openapi.json` へコピーし、Swagger UIの `/api-docs` から表示・操作します。

現行マップのAPI実装は `cloudflare/map-app.mjs`、Notion関連は `cloudflare/notion/routes.mjs`、全体の経路切り替えは `cloudflare/worker.mjs` にあります。画面からの呼び出しは `frontend/src/shared/api-client.js` を共用します。

APIを変更するときは、パス、認証、入力、正常・異常応答の仕様と、対応する回帰テストも更新します。機密情報や実際の利用者のデータを仕様の例へ入れないでください。

現時点では仕様ファイルから実装を自動生成しておらず、全APIの入出力が仕様と一致することを検査する契約テストも未導入です。[品質の確認範囲](../docs/code-quality.md)と[連携機能の説明](../docs/features.md)を参照してください。
