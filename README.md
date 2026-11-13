# Factory Map OSS (development)

[OSS/SaaS roadmap](docs/oss-roadmap.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT License](LICENSE)

Cloudflare SaaS integration is in development; the existing PostgreSQL demo is not yet a production multi-tenant SaaS. Billing is mock-only.

# 構内マップ

約2kmの工場敷地を想定した、React / Leaflet + Rust/Axum + PostgreSQLの共有アプリです。
React 19.3.1で写真編集と右上の開発メニューを実装しています。地図・図面編集はLeafletと連携するJavaScriptで実装しています。
工事周知と設備台帳を同じ図面から操作できます。サンプルの工場・設備・履歴は架空です。

## 実装した機能

- 付箋：図面をクリックしてテキストを貼付（2000文字まで）。編集・削除・ドラッグ移動、表示切り替え、共有DBへの保存。図面に連動して付箋と文字も拡大縮小。サイズ1〜300%・6色パレット＋任意色を変更可能。施設モードで付箋の4辺・4隅をドラッグすると幅・高さを別々に変更し、縦横比を保存。フォント（ゴシック・明朝・等幅）、文字サイズ6〜120px、文字色と自動配色を指定可能
- 工事の「情報を編集」中は入力パネルを開いたまま、地図の頂点をドラッグして範囲を調整。保存で確定、キャンセルで取り消し。
- 全体図と棟内図の切り替え、工事の範囲描画・登録・編集、状態・期間・キーワードでの絞り込み
- ASCII DXF取り込み、レイヤーの切り替え、未対応要素の通知。DWGはDXFに変換して読み込み
- 設備マークを直接ドラッグして移動・保存。設備ごとのアイコン選択、位置・属性/写真の個別ロックと全設備の一括ロック。ロックはAPI・一括操作にも適用し、点検履歴は記録可能。
- 設備・工事への写真添付、代表写真の選択、地図上のホバーサムネイル。最大320×240の画像をRustで生成しPostgreSQLにキャッシュ。設備写真は未ログインでは取得不可。
- 設備を地図上のクリックで追加、設備ID・位置・場所を編集、設備と工事の相互リンク
- Notion形式のプロパティ追加・変更・削除。テキスト、数値、日付、チェック、選択、複数選択、URL
- 設備の点検・保守履歴の追加・編集・削除、実施者・結果・次回点検日・資料
- 工事・設備・点検への複数添付（各20MB、1回30ファイル）。マニュアル・点検用紙・点検履歴のPDFをアプリ内で描画し、ページ送り・拡大縮小・ダウンロードに対応。画像もプレビュー可能
- 閲覧が初期状態。施設グループはパスワードでログイン。サーバーでも全更新操作を認証
- Argon2パスワードハッシュ、HttpOnly/SameSiteセッション、CSRF検査、試行回数制限
- 登録データ、型定義、図面原本、履歴、資料本体（BYTEA）をPostgreSQLに保存
- 更新リビジョンによる競合検出、操作履歴、APIトークン、一括操作のトランザクション
- `/api-docs` にSwagger UI、`/openapi.json` に48操作のAPI定義
- 対応ブラウザーの `document.modelContext` に29個のネイティブWebMCPツール。認証・入力検証はREST APIと共通
- 12分類64台のサンプル設備、125件の点検履歴、PDF資料

## UIのビルド

写真アップロードはReactコンポーネントで、複数写真・ドラッグ＆ドロップ・代表写真の選択に対応します。API / WebMCPメニューは右上に配置しています。ビルド済みJSは `vendor/factory-ui.js` に含まれます。UIソースを変更した場合はNode.js環境で `cd frontend && npm ci && npm run build` を実行し、配信対象のpublicディレクトリーにも反映してください。

## 起動

このPCでは専用データベース `factory_map` と専用ユーザーを用意済みです。接続先は `.runtime/config.json` に保存しています。認証情報のある `.runtime/` は公開・配布に含めません。

Rustが利用できる環境では以下でビルド・起動します。

```sh
cargo build --manifest-path server/Cargo.toml
./server/target/debug/factory-map-server
```

初期状態は `http://127.0.0.1:18017` です。`FACTORY_MAP_BIND` で変更できます。
初期パスワードは初回起動時にランダム生成し `.runtime/initial-admin-password.txt`（所有者のみ閲覧可）に保存します。画面の「閲覧モード」からログインし、「パスワード変更」で変更できます。

別環境での接続設定例（値は自身の専用DB接続先に置き換え、ファイルの権限を600に設定）：

```json
{"database_url":"postgresql://APP_USER:APP_PASSWORD@DATABASE_HOST:5432/APP_DATABASE"}
```

## 公開

SitesのWorkerが、HTTPSトンネルを経由してこのPCのRustサーバーに接続します。
Cloudflareのアカウントやルーターのポート開放は不要です。PC、PostgreSQL、Rustサーバー、トンネルが稼働している必要があります。
無料のQuick Tunnelは再起動でURLが変わります。変わった場合は同じSitesプロジェクトの `UPSTREAM_ORIGIN` を更新して再配信します。継続運用では固定トンネル・監視・社内認証を整備してください。

閲覧モードは工事範囲・お知らせ・付箋のみ表示します。設備の位置・台帳・属性・点検履歴・設備専用添付は施設グループのログイン後に表示します。APIの一覧・検索・集計・ファイル取得にも同じ制限を適用します。工事のお知らせとその添付は公開されます。

## API

設備閲覧（要認証）の例：`GET /api/assets?q=空調`、`GET /api/assets/a1/maintenance`、`GET /api/stats`。
更新はログインのセッションCookie、または `Authorization: Bearer …` の編集トークンが必要です。
`POST /api/tokens` で30日間のトークンを発行できます。viewerトークンで更新はできません。
`POST /api/batch` は最大100操作を一括確定し、途中で失敗した場合は反映しません。
添付は `POST /api/files` の戻り値を対象レコードの `attachments` に保存します。未参照のファイルは外部から取得できません。
`GET /api/export` はJSONデータと添付参照IDの出力です。ファイル本体を含む完全バックアップにはPostgreSQLのバックアップが必要です。

WebMCPは対応ブラウザーでマップ画面を開いた間に利用できます。通常ブラウザーで利用できない場合も画面操作とREST APIは動作します。

## 検証

`tests/shared_integration.py` は実APIと専用DBで、認証・型・日付・参照・添付・競合・一括操作を検証します。
`tests/shared_ui.py` は実Chromiumで設備追加、属性追加、点検、複数添付、PDF表示、DXF、スマホ、Swagger UIとネイティブWebMCP呼び出しを検証します。
`tests/manipulation_and_pdf.py` は付箋の縁・角リサイズ、反対側の辺の固定、Escでの取り消し、設備ドラッグ、実際の2ページPDF描画・ページ送り・拡大と閲覧権限を検証します。PDF描画はローカル配布のMozilla PDF.js 6.5.438を使用します。
`tests/note_appearance.py` は付箋と図面の実寸比、アニメーション付きズーム、色・サイズの永続化、ドラッグ、異なる画面幅での表示を検証します。検証用パスワードファイルは `FACTORY_MAP_TEST_PASSWORD_FILE` で指定できます。
Python PlaywrightとChromiumが必要です。現在のテストURLは `FACTORY_MAP_TEST_URL` で変更できます。初期パスワード変更後はテスト用ログイン方法も更新してください。
旧 `tests/ui_smoke.py` はブラウザー内保存版に対する過去の確認です。

## 制限と運用上の確認事項

- DXFは2D/ASCII形式。寸法・ハッチングなどの完全なCAD再現、DWG直接読み込み、図面改訂管理は未対応
- 共有パスワード方式。個人アカウント・SSO・ユーザーごとの権限は未実装
- 小規模デモ向けに、更新時は図面・台帳の整合性をまとめて検証。数千人の同時利用の負荷試験は未実施
- ブラウザー内保存だった旧版のIndexedDBは削除していません。共有DBへの自動移行は行いません
- 既存PostgreSQLコンテナーの内部IPで接続中。コンテナー再作成時は専用接続設定の更新が必要になる場合があります
- 添付を一覧から外してもDBのバイナリは保持。運用時には保管期間と不要ファイルの整理を決めてください
