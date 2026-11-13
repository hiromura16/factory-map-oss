# SaaS管理画面

`console.html` / `frontend/product.jsx` が現在の管理画面です。Cloudflare Accessで認証し、`/api/session` と同じデモアカウントのAPIに接続します。旧 `saas.html` へのアクセスもこの管理画面に送ります。

無料デモは編集者、有料デモは管理者。設備台帳、点検期限、CSVとJSONの移行、資料整理、Proバックアップ、管理者の操作履歴、プラン比較を利用できます。決済はありません。

以前の `saas.js` にある汎用OIDC / PKCEのコンソール実装は実験用として保持しています。今回のAccessメールSSOの実行経路では使いません。
