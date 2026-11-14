/**
 * 同じホストのOpenAPI仕様をSwagger UIで表示する開発者向けの入口。
 * 認証情報の永続保存は無効にし、APIの権限判定は通常のリクエストと共通にします。
 */
window.addEventListener('DOMContentLoaded', () => {
  window.ui = SwaggerUIBundle({
    url: '/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    withCredentials: true,
    persistAuthorization: false,
    displayRequestDuration: true,
    defaultModelsExpandDepth: 0,
  });
});
