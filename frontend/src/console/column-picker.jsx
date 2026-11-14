import React, { useState } from 'react';
export function ColumnPicker({ columns, chosen, defaults, onChange }) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const groups = [...new Set(columns.map((c) => c.group || '基本項目'))];
  const ordered = [
    ...chosen.map((id) => columns.find((c) => c.id === id)).filter(Boolean),
    ...columns.filter((c) => !chosen.includes(c.id)),
  ];
  const shown = ordered.filter(
    (c) =>
      (group === 'all' || (c.group || '基本項目') === group) &&
      (c.name + ' ' + c.id).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const addAll = () => onChange([...new Set([...chosen, ...shown.map((c) => c.id)])].slice(0, 100));
  const move = (id, delta) => {
    const next = [...chosen];
    const i = next.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= next.length) {
      return;
    }
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <details className="register-column-picker">
      <summary>
        表示列・並び順{' '}
        <span>{chosen.filter((id) => columns.some((c) => c.id === id)).length}列</span>
      </summary>
      <div className="register-column-panel">
        <b>表示するプロパティと左右の順番</b>
        <p>追加したプロパティも選択できます。列が多いときは台帳を横にスクロールできます。</p>
        <div className="column-picker-filters">
          <input
            type="search"
            aria-label="表示項目を検索"
            placeholder="プロパティ名・IDで検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="表示項目の種類"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="all">すべての項目</option>
            {groups.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </div>
        <div className="column-picker-actions">
          <button onClick={addAll}>検索結果をすべて追加</button>
          <button
            onClick={() => {
              const next = chosen.filter((id) => !shown.some((c) => c.id === id));
              onChange(next.length ? next : [columns[0].id]);
            }}
          >
            検索結果を外す
          </button>
          <button onClick={() => onChange(defaults)}>列を初期化</button>
        </div>
        <div className="column-picker-scroll">
          {shown.map((c) => (
            <div className="register-column-row" key={c.id}>
              <label>
                <input
                  type="checkbox"
                  aria-label={
                    columns.filter((x) => x.name === c.name).length > 1
                      ? c.name + '（' + c.id + '）'
                      : c.name
                  }
                  checked={chosen.includes(c.id)}
                  disabled={
                    (chosen.length === 1 && chosen.includes(c.id)) ||
                    (!chosen.includes(c.id) && chosen.length >= 100)
                  }
                  onChange={(e) =>
                    onChange(
                      e.target.checked ? [...chosen, c.id] : chosen.filter((id) => id !== c.id),
                    )
                  }
                />
                <span>
                  {c.name}
                  <small>
                    {c.group || '基本項目'}
                    {c.type ? ' · ' + c.type + ' · ' + c.id : ''}
                  </small>
                </span>
              </label>
              <span className="column-position">
                {chosen.includes(c.id) ? chosen.indexOf(c.id) + 1 : '—'}
              </span>
              <button
                disabled={!chosen.includes(c.id) || chosen[0] === c.id}
                aria-label={c.name + 'を左へ'}
                onClick={() => move(c.id, -1)}
              >
                ↑
              </button>
              <button
                disabled={!chosen.includes(c.id) || chosen.at(-1) === c.id}
                aria-label={c.name + 'を右へ'}
                onClick={() => move(c.id, 1)}
              >
                ↓
              </button>
            </div>
          ))}
        </div>
        <small>最大100列。列と順番はアカウントごとに保存されます。</small>
      </div>
    </details>
  );
}
