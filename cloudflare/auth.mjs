import { ApiError } from './core.mjs';
const decoder = new TextDecoder();
const jwksCache = new Map();
function decode(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('base64url');
  return Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
export function validateClaims(claims, issuer, audience, now = Date.now()/1000) {
  if (!claims || claims.iss !== issuer || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 ||
      !(claims.aud === audience || (Array.isArray(claims.aud) && claims.aud.includes(audience))) ||
      (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== audience) ||
      (claims.azp !== undefined && claims.azp !== audience) ||
      typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= now ||
      (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now + 30))) {
    throw new ApiError(401, 'Invalid identity token');
  }
  return { issuer: claims.iss, subject: claims.sub };
}
export async function authenticate(request, env) {
  const token = request.headers.get('authorization')?.match(/^Bearer ([^ ]+)$/)?.[1];
  if (!token || token.length > 16384) throw new ApiError(401, 'Bearer identity token required');
  if (!env.AUTH_ISSUER || !env.AUTH_AUDIENCE || !env.AUTH_JWKS_URL || env.AUTH_ISSUER.includes('REPLACE_')) {
    throw new ApiError(503, 'OIDC identity provider is not configured');
  }
  try {
    const jwksUrl = new URL(env.AUTH_JWKS_URL);
    if (jwksUrl.protocol !== 'https:') throw new Error('JWKS must use HTTPS');
    // Only the configured provider URL is used; token-supplied jku/x5u never initiate requests.
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('invalid token');
    const header = JSON.parse(decoder.decode(decode(parts[0])));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit) throw new Error('unsupported header');
    let cached = jwksCache.get(jwksUrl.href);
    if (!cached || cached.until < Date.now()) {
      // Workers supports only follow/manual. Reject redirects without following them.
      const response = await fetch(jwksUrl.href, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('provider unavailable');
      const text = await response.text();
      if (text.length > 100000) throw new Error('oversized JWKS');
      const document = JSON.parse(text);
      if (!Array.isArray(document.keys) || document.keys.length > 50) throw new Error('invalid JWKS');
      cached = { keys: document.keys, until: Date.now()+300000 };
      jwksCache.set(jwksUrl.href, cached);
    }
    const key = cached.keys.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
    if (!key) throw new Error('unknown key');
    const publicKey = await crypto.subtle.importKey('jwk', key, {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decode(parts[2]), new TextEncoder().encode(parts[0]+'.'+parts[1]));
    if (!valid) throw new Error('invalid signature');
    return validateClaims(JSON.parse(decoder.decode(decode(parts[1]))), env.AUTH_ISSUER, env.AUTH_AUDIENCE);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, 'Identity verification failed');
  }
}
