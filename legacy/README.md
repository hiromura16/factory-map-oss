# 旧実装

現在のPlantDeskは `frontend/` と `cloudflare/` で動きます。このディレクトリは旧実装の参照と検証用です。

- `server/`: Rust / Axum / PostgreSQL版。`cargo build --manifest-path legacy/server/Cargo.toml` でビルドします。リポジトリのルートを基準に `public/`、`.runtime/config.json`、`shared/demo/` を使います。`FACTORY_MAP_ROOT` でルートを明示できます。現行SaaSへの自動移行は行いません。
- `oidc-console/`: 汎用OIDC / PKCEの実験用コンソール。現行のCloudflare Access認証とは別です。互換性のため既存の配信パスを残していますが、現行Workerは `/saas.html` を管理画面へ案内します。

新しい業務機能は現行実装に追加してください。[ソース配置](../docs/source-layout.md)と[旧Rust版の起動方法](../docs/features.md)を参照してください。
