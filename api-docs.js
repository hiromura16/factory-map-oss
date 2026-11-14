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
