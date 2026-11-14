export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const PLANS = Object.freeze({
  free: { drawings: 3, assets: 100, customization: false },
  pro: { drawings: 30, assets: 2000, customization: true },
  enterprise: { drawings: 100, assets: 10000, customization: true }
});
export const KINDS = ['drawings', 'works', 'assets', 'propertyDefinitions', 'notes', 'layers', 'drawingLinks', 'layerSets', 'tasks', 'teamMembers', 'inspectionPlans', 'projects'];
export const MAX_BYTES = 750000; // Below D1's per-row limit. R2 stores binaries, not this JSON.
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function fail(message) { throw new ApiError(422, message); }
export function validateState(input, plan = 'free') {
  const state = input?.state ?? input;
  if (!isObject(state)) fail('state must be an object');
  if (![1, 2].includes(state.version)) fail('Unsupported state version');
  if (!Object.hasOwn(PLANS, plan)) fail('Unknown plan');
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > MAX_BYTES) fail('Snapshot exceeds 750 KB; split the workspace before importing');
  for (const kind of KINDS) {
    if (['layers','drawingLinks','layerSets','tasks','teamMembers','inspectionPlans','projects'].includes(kind) && state[kind]===undefined) continue;
    if (!Array.isArray(state[kind])) fail(kind + ' must be an array');
    if (state[kind].length > 20000) fail(kind + ' exceeds safety limit');
    const ids = new Set();
    for (const record of state[kind]) {
      if (!isObject(record) || typeof record.id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(record.id)) fail(kind + ' has invalid id');
      if (ids.has(record.id)) fail(kind + ' has duplicate id: ' + record.id);
      ids.add(record.id);
    }
  }
  const drawings = new Set(state.drawings.map(x => x.id));
  for (const kind of ['works', 'assets', 'notes']) {
    for (const record of state[kind]) {
      if (!drawings.has(record.drawingId)) fail(kind + ' references missing drawing');
      if (kind === 'assets' && record.history !== undefined) {
        if (!Array.isArray(record.history)) fail('asset history must be an array');
        const ids = new Set();
        for (const item of record.history) {
          if (!isObject(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id)) fail('invalid or duplicate history id');
          ids.add(item.id);
        }
      }
    }
  }
  const codes = state.assets.map(x => x.code).filter(Boolean);
  if (new Set(codes).size !== codes.length) fail('Duplicate equipment code');
  const limits = PLANS[plan];
  if (state.drawings.length > limits.drawings || state.assets.length > limits.assets) throw new ApiError(409, 'Plan quota exceeded');
  return structuredClone(state);
}
export function importPreview(payload, current, plan) {
  const state = validateState(payload, plan);
  const existing = new Set(KINDS.flatMap(k => (current?.[k] ?? []).map(x => k + ':' + x.id)));
  const conflicts = KINDS.flatMap(k => (state[k]||[]).filter(x => existing.has(k + ':' + x.id)).map(x => k + ':' + x.id));
  const attachmentIds = new Set();
  function scan(value) {
    if (Array.isArray(value)) { value.forEach(scan); return; }
    if (!isObject(value)) return;
    for (const [key, val] of Object.entries(value)) {
      if (key === 'attachments' && Array.isArray(val)) {
        for (const ref of val) attachmentIds.add(typeof ref === 'string' ? ref : ref?.id ?? '(unknown)');
      }
      scan(val);
    }
  }
  scan(state);
  return {
    state, counts: Object.fromEntries(KINDS.map(k => [k, (state[k]||[]).length])),
    history: state.assets.reduce((n,a) => n + (a.history?.length ?? 0), 0),
    conflicts, attachmentIds: [...attachmentIds],
    canApply: existing.size === 0 && conflicts.length === 0 && attachmentIds.size === 0,
    workspaceEmpty: existing.size === 0,
    mode: 'empty-workspace-only',
    warnings: [...(existing.size ? ['Workspace must be empty; import never overwrites existing records.'] : []), ...(attachmentIds.size ? ['Attachment references are present. This JSON export does not contain file bytes. R2 migration must be completed separately; apply is blocked.'] : [])]
  };
}
export function validateCustomization(input, plan) {
  if (!Object.hasOwn(PLANS, plan) || !PLANS[plan].customization) throw new ApiError(403, 'Customization requires Pro or Enterprise');
  if (!isObject(input)) fail('customization must be an object');
  const allowed = ['accent', 'theme', 'density', 'brandName'];
  if (Object.keys(input).some(k => !allowed.includes(k))) fail('Unknown customization field');
  if (input.accent !== undefined && !/^#[0-9a-f]{6}$/i.test(input.accent)) fail('Invalid accent');
  if (input.theme !== undefined && !['light','dark','system'].includes(input.theme)) fail('Invalid theme');
  if (input.density !== undefined && !['comfortable','compact'].includes(input.density)) fail('Invalid density');
  if (input.brandName !== undefined && (typeof input.brandName !== 'string' || input.brandName.length > 80)) fail('Invalid brandName');
  return structuredClone(input);
}
export function requireRole(role, allowed) {
  if (!allowed.includes(role)) throw new ApiError(403, 'Insufficient role');
}
