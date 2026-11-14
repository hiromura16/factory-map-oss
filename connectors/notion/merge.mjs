/**
 * 直前の同期値・アプリ側・Notion側を比較する、項目単位の3方向マージ。
 * 同じ項目の異なる変更は競合として返し、解決の選択と保存は呼び出し元が担当します。
 */
export const canonical = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );
const equal = (a, b) => canonical(a ?? null) === canonical(b ?? null);
/**
 * 直前の同期値から片側だけが変わった項目は採用し、両側が別の値へ変わった項目を競合にします。
 * 比較元がない初回の相違も競合として返し、指定された同期方向や解決方法がある場合だけ優先します。
 * @param {object|null} base 直前に両側で一致していた同期対象の値。
 * @param {object} local アプリ側の現在値。
 * @param {object} remote Notion側の現在値。
 * @returns {{value: object|null, conflicts: string[]}} 反映候補と、利用者の選択が必要な項目名。
 */
export function threeWayMerge(base, local, remote, { direction = 'both', prefer = null } = {}) {
  if (prefer === 'local' || direction === 'push') {
    return {
      value: structuredClone(local),
      conflicts: [],
    };
  }
  if (prefer === 'notion' || direction === 'pull') {
    return {
      value: structuredClone(remote),
      conflicts: [],
    };
  }
  const keys = [...new Set([...Object.keys(local), ...Object.keys(remote)])];
  if (!base) {
    if (equal(local, remote)) {
      return {
        value: structuredClone(local),
        conflicts: [],
      };
    }
    return {
      value: null,
      conflicts: keys.filter((k) => !equal(local[k], remote[k])),
    };
  }
  const value = {};
  const conflicts = [];
  for (const key of keys) {
    const l = local[key];
    const r = remote[key];
    const b = base[key];
    if (!equal(l, b) && !equal(r, b) && !equal(l, r)) {
      conflicts.push(key);
    }
    value[key] = !equal(r, b) ? r : l;
  }
  return {
    value,
    conflicts,
  };
}
