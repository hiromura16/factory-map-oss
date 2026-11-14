import { ApiError } from '../core.mjs';
const enc = new TextEncoder();
const b64 = (bytes) => {
  let s = '';
  for (const v of bytes) {
    s += String.fromCharCode(v);
  }
  return btoa(s);
};
const un64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function key(env) {
  try {
    const bytes = un64(env.NOTION_TOKEN_KEY || '');
    if (bytes.length !== 32) {
      throw 0;
    }
    return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch {
    throw new ApiError(503, 'サーバーのNotionトークン暗号化キーが未設定です。');
  }
}
export const credentialsReady = (env) =>
  typeof env.NOTION_TOKEN_KEY === 'string' && env.NOTION_TOKEN_KEY.length >= 43;
export async function encryptToken(env, organizationId, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: enc.encode(organizationId),
    },
    await key(env),
    enc.encode(token),
  );
  return JSON.stringify({
    v: 1,
    iv: b64(iv),
    data: b64(new Uint8Array(cipher)),
  });
}
export async function decryptToken(env, organizationId, value) {
  try {
    const p = JSON.parse(value);
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: un64(p.iv),
          additionalData: enc.encode(organizationId),
        },
        await key(env),
        un64(p.data),
      ),
    );
  } catch (e) {
    if (e instanceof ApiError) {
      throw e;
    }
    throw new ApiError(503, 'Notionの接続トークンを再設定してください。');
  }
}
