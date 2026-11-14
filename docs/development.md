# 開発ガイド

## 必要なもの

- Node.js 22.13以上、npm
- Python 3.12以上。ローカルSQLiteとブラウザーテストに使用します。
- 画面の検証・撮影にはPython PlaywrightとChromium

```sh
npm ci
npm ci --prefix frontend
npm ci --prefix cloudflare
npm run build
npm run dev
```

`npm run dev` はループバック限定のサンプルサーバーです。一時SQLite、テスト専用の署名鍵とIDを使用し、Cloudflareの再認証は不要です。終了時に一時DBを削除します。このサーバーを外部公開に使わないでください。

Workersの環境を調べる場合は `npm run dev:worker` を使います。D1・Accessなどの設定は[配置ガイド](cloudflare.md)に従って用意します。

## コードの書き方

[ソース配置](source-layout.md)に用途ごとの編集先と、ビルド時の配信パスをまとめています。

- PythonはRuffで整形・静的解析します。
- JavaScript / JSX / CSS / HTML / MarkdownはPrettierで整形します。インデントは2スペース、JavaScriptの文字列はシングルクォートです。
- 状態は `draft` / `setDraft` のように役割を表します。状態更新関数を1文字に省略しません。
- 表示、API呼び出し、業務ルールを分けます。一覧・ボード・週間表示は `frontend/src/console/task-views.jsx`、保存や絞り込みはワークスペースが担当します。
- 既存の共有スクリプトはIIFEと `window.Factory...` の公開インターフェースを維持します。グローバル依存はESLint設定に明記します。
- 権限・テナント・型・参照・ロック・同時更新の検証を、画面の都合で省略しません。
- `public/` と `frontend/.build/vendor/factory-ui.js` は生成物です。第三者ライブラリーの `frontend/static/vendor/` は個別のライセンスを保持します。

```sh
npm run format
ruff format .
npm run check
ruff check .
ruff format --check .
npm test
npm run build
npm run test:runtime
```

ESLintは未定義参照・未使用変数・const・波括弧・比較・React Hooksを検査します。制御文字を意図的に拒否する正規表現は、理由付きの行単位例外を置いています。

## 実ブラウザーでの確認

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m playwright install chromium
PATH="$PWD/.venv/bin:$PATH" npm run test:ui
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` でインストール済みChromium、`FACTORY_MAP_NODE` で別のNodeを指定できます。

| 検証                           | 対象                                                            |
| ------------------------------ | --------------------------------------------------------------- |
| `task_workspace_ui.py`         | 2画面、一覧保存、非モーダル詳細、未保存保護、点検履歴、モバイル |
| `team_operations_ui.py`        | 担当、コメント、資料、定期点検、結果とフォロー作業の保存        |
| `workflow_ui.py`               | 案件、先行作業、子作業、完了条件                                |
| `product_ui.py`                | 地図の分類、アイコン、表示設定、資料                            |
| `notion-connector-runtime.mjs` | WorkersでのNotion通信とリダイレクト拒否                         |

テストは本番のD1、Notion、実在の工場データに接続しません。本番連携の確認は、検証レコードを明示して別途実施します。

## スクリーンショット

```sh
npm run build
PATH="$PWD/.venv/bin:$PATH" npm run screenshots
```

`scripts/capture-screenshots.py` がサンプルから `docs/images/` へマップ、ダッシュボード、タスク、詳細、点検履歴、モバイルの画像を保存します。バナーは `banner.svg` です。実際の顧客データや認証情報を撮影しないでください。
