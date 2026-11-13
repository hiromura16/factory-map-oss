# SaaS 管理コンソール（開発版）

旧地図アプリと独立した /saas.html です。新しい /api/v1 と同一 origin に静的ファイルを配信します。旧地図の48 APIとの互換性はありません。旧地図に組織のデータが表示されるとは扱わないでください。

## 帰宅後の設定（まだ実行していません）
1. Cloudflare D1 の migration と Worker の AUTH_ISSUER / AUTH_AUDIENCE / AUTH_JWKS_URL を設定します。
2. OIDC Provider に public SPA client を作り Authorization Code + PKCE S256 を有効化。client secret は不要・配置禁止。利用する IdP は token endpoint のブラウザー CORS と RS256 ID token をサポートする必要があります。
3. redirect URI は正確な https://your-domain/saas.html を登録。ローカル開発のみ localhost / 127.0.0.1 HTTPを許可します。認証endpointは明示設定のみ使い、任意の発見URLへ接続しません。
4. saas-config.example.json を saas-config.json としてコピーし、issuer / authorizationEndpoint / tokenEndpoint / clientId を入力、enabled を true にします。全て公開値で、秘密情報は禁止です。public/配信にも同ファイルが必要です。
5. 登録は ALLOW_REGISTRATION=true、課金シミュレーターは MOCK_BILLING=true が必要です。本番公開前に運用判断してください。

## 認証の境界
ログインボタンでのみ IdP へ移動します。state / nonce / 256-bit verifier を生成し、S256 challengeを使います。一時状態は sessionStorage に5分以内・1回のみ保存し、callbackを処理する際に削除します。callbackのcode/state/errorはURLから除去します。
ID token はメモリのみに保持し、localStorage / sessionStorageには保存しません。refresh token は要求・保存しません。再読込や期限切れ時は再ログインします。
フロントの JWT decode と nonce/issuer/audience/expiry/azp 検査は署名検証ではありません。API の RS256/JWKS 検証と組織所属・ロール検証がセキュリティ境界です。APIで検証成功する前にコンソールを接続済みと表示しません。
この開発APIは ID token を認証証明として使う構成です。一般の任意APIへ ID token を送る実装ではなく、このサーバーの AUTH_AUDIENCE が SPA clientId と一致する必要があります。実 IdP での相互運用・セキュリティ確認は未実施です。
ログアウトはローカルトークンを破棄するだけで、IdPのSSOセッション失効やサーバー側トークン取消を行いません。このコンソールにはSCIM管理画面はありません。SCIM Users APIの限定実装は docs/cloudflare.md を参照してください。実IdP互換性は未検証です。

## データ操作
組織一覧/選択/新規作成、利用枠、課金モック変更、JSON import-preview/apply/export。更新はrevisionを送り、競合は上書きせずエラー表示します。取り込みは空組織のみ、添付参照が残る場合はブロックします。JSON exportは添付本体を含みません。リアル課金はありません。

## ローカル検証
node tests/saas.cjs
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome python tests/saas_ui.py

ブラウザQAは一時HTTPサーバーとモックOIDC・APIだけで実行します。本番D1やIdPに接続しません。実D1/IdPの検証とは区別してください。
