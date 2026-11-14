import React, { useEffect, useRef, useState } from 'react';
const api = (...args) => window.FactoryAPI.request(...args);
export const downloadJSON = (name, data) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export function AssetImport({ state, onClose, onRefresh }) {
  const ref = useRef(null);
  const [text, setText] = useState('');
  const [mode, setMode] = useState('add');
  const [drawing, setDrawing] = useState(state.drawings[0]?.id || '');
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    const cancel = (e) => {
      e.preventDefault();
      if (!busy) {
        onClose();
      }
    };
    el.addEventListener('cancel', cancel);
    return () => el.removeEventListener('cancel', cancel);
  }, [busy]);
  const reset = () => {
    setPreview(null);
    setMessage('');
    setComplete(false);
  };
  const payload = () => {
    const value = JSON.parse(text);
    return {
      assets: Array.isArray(value) ? value : value.assets,
      mode,
      drawingId: drawing,
    };
  };
  const template = () => {
    const d = state.drawings.find((d) => d.id === drawing);
    const properties = {};
    for (const p of state.propertyDefinitions) {
      const value =
        p.type === 'checkbox'
          ? false
          : p.type === 'number'
            ? 0
            : p.type === 'date'
              ? '2026-11-13'
              : p.type === 'url'
                ? 'https://example.com'
                : p.type === 'select'
                  ? p.options?.[0]?.id
                  : p.type === 'multiselect'
                    ? p.options?.slice(0, 1).map((o) => o.id)
                    : 'サンプル';
      if (value !== undefined) {
        properties[p.id] = value;
      }
    }
    return {
      assets: [
        {
          code: 'EQ-NEW-001',
          name: '新しい設備のサンプル',
          drawingId: drawing,
          point: [(d.bounds[0][0] + d.bounds[1][0]) / 2, (d.bounds[0][1] + d.bounds[1][1]) / 2],
          location: '設置場所を入力',
          properties,
        },
      ],
    };
  };
  const validate = async () => {
    setBusy(true);
    setMessage('');
    try {
      const r = await api('/api/assets/import-preview', {
        method: 'POST',
        body: payload(),
      });
      setPreview(r);
    } catch (e) {
      setPreview(null);
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    setBusy(true);
    setMessage('');
    try {
      const r = await api('/api/assets/import', {
        method: 'POST',
        body: {
          ...payload(),
          revision: preview.revision,
          confirm: 'IMPORT_ASSETS',
        },
      });
      await onRefresh();
      setComplete(true);
      setPreview(null);
      setMessage(`${r.created}件を追加、${r.updated}件を更新しました。`);
    } catch (e) {
      setPreview(null);
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={ref}
      className="product-dialog asset-import-dialog"
      aria-labelledby="asset-import-title"
    >
      <div className="dialog-heading">
        <div>
          <h2 id="asset-import-title">設備をJSONで一括登録</h2>
        </div>
        <button aria-label="設備取り込みを閉じる" disabled={busy} onClick={onClose}>
          ×
        </button>
      </div>
      <p>
        このファイルに記載した設備だけを追加・更新します。工事・図面・ほかの設備はそのまま保持します。
      </p>
      <div className="asset-import-options">
        <label>
          取り込み方法
          <select
            aria-label="設備JSONの取り込み方法"
            value={mode}
            disabled={busy}
            onChange={(e) => {
              setMode(e.target.value);
              reset();
            }}
          >
            <option value="add">新規追加のみ</option>
            <option value="upsert">追加と更新（設備IDで照合）</option>
          </select>
        </label>
        <label>
          図面ID省略時の配置先
          <select
            aria-label="設備JSONの既定図面"
            value={drawing}
            disabled={busy}
            onChange={(e) => {
              setDrawing(e.target.value);
              reset();
            }}
          >
            {state.drawings.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}（{d.id}）
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="product-actions">
        <button
          disabled={busy}
          onClick={() => downloadJSON('plantdesk-equipment-template.json', template())}
        >
          テンプレートを保存
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setText(JSON.stringify(template(), null, 2));
            reset();
          }}
        >
          記入例を表示
        </button>
        <label className="import-file-button">
          JSONファイルを選択
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) {
                return;
              }
              reset();
              if (f.size > 900000) {
                setMessage('JSONは900KB以下にしてください。');
                return;
              }
              setText(await f.text());
            }}
          />
        </label>
      </div>
      <textarea
        className="asset-json-input"
        aria-label="設備JSON"
        value={text}
        disabled={busy}
        spellCheck="false"
        placeholder={
          '[ { "code": "AC-101", "name": "空調機", "point": [100, 200], "properties": {} } ]'
        }
        onChange={(e) => {
          setText(e.target.value);
          reset();
        }}
      />
      <details className="asset-import-help">
        <summary>JSONの書き方・プロパティIDを確認</summary>
        <p>
          配列、または {`{ "assets": [...] }`}{' '}
          を指定します。設備IDはcode、設備名はname。新規設備のpointは図面座標の[x,
          y]で必須です。選択式は表示名ではなく選択肢ID、数値は数値、チェックはtrue/falseで指定します。
        </p>
        <p>
          更新時は省略した項目・プロパティ・点検履歴・添付資料を保持します。history・attachments・locksの一括更新はできません。位置や属性がロックされた設備の変更はエラーになります。1回2,000件まで、エラーがあると全件保存しません。
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>プロパティ名</th>
                <th>ID</th>
                <th>型</th>
                <th>選択肢ID</th>
              </tr>
            </thead>
            <tbody>
              {state.propertyDefinitions.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    <code>{p.id}</code>
                  </td>
                  <td>
                    {p.type}
                    {p.required ? '（必須）' : ''}
                  </td>
                  <td>{p.options?.map((o) => o.label + ' = ' + o.id).join(' / ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className={complete ? 'import-success' : 'product-message'} role="status">
        {message}
      </p>
      {preview && (
        <section className="asset-import-preview">
          <h3>取り込み前の確認</h3>
          <p>
            {preview.total}件中：新規追加 {preview.created}件 / 更新 {preview.updated}件 / エラー{' '}
            {preview.errors.length}件
          </p>
          {preview.errors.length > 0 && (
            <ul className="import-errors">
              {preview.errors.map((e, i) => (
                <li key={i}>
                  {e.row ? '行' + e.row + ' ' : ''}
                  {e.code}：{e.message}
                </li>
              ))}
            </ul>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>行</th>
                  <th>処理</th>
                  <th>設備ID</th>
                  <th>設備名</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.action === 'create' ? '追加' : '更新'}</td>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="product-actions">
        <button className="primary-product" disabled={busy || !text.trim()} onClick={validate}>
          {busy ? '処理中…' : '内容を確認する'}
        </button>
        {preview && (
          <button className="primary-product" disabled={busy || !preview.canApply} onClick={apply}>
            この内容で設備を保存
          </button>
        )}
        <button disabled={busy} onClick={onClose}>
          閉じる
        </button>
      </div>
    </dialog>
  );
}
