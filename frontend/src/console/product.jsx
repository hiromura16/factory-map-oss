import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { NotionSync, NotionStatus } from './notion-sync.jsx';
import { TeamWorkspace } from './team.jsx';
import { TeamDashboard } from './team-dashboard.jsx';
import { Register } from './registers.jsx';
const api = (...args) => window.FactoryAPI.request(...args);
const size = (n) =>
  n < 1024 * 1024 ? Math.ceil(n / 1024) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB';
const date = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
function save(name, content, type = 'application/json') {
  const a = document.createElement('a');
  const url = URL.createObjectURL(
    new Blob([content], {
      type,
    }),
  );
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvParse(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      if (quoted && s[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && s[i + 1] === '\n') {
        i++;
      }
      row.push(field);
      if (row.some(Boolean)) {
        rows.push(row);
      }
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (quoted) {
    throw new Error('CSVの引用符が閉じていません。');
  }
  row.push(field);
  if (row.some(Boolean)) {
    rows.push(row);
  }
  return rows;
}
function csvExport(rows) {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let s = String(value ?? '');
            if (/^[=+@-]/.test(s)) {
              s = "'" + s;
            }
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n')
  );
}
function csvHistory(text, state) {
  const rows = csvParse(text);
  const headers = rows.shift() || [];
  const need = ['設備ID', '点検日', '内容'];
  if (!need.every((x) => headers.includes(x))) {
    throw new Error('設備ID・点検日・内容の列が必要です。');
  }
  const next = structuredClone(state);
  let count = 0;
  for (const row of rows) {
    const get = (key) => row[headers.indexOf(key)] || '';
    const asset = next.assets.find((a) => a.code === get('設備ID'));
    if (!asset) {
      throw new Error('設備IDが見つかりません: ' + get('設備ID'));
    }
    if (!/^\d{4}-\d\d-\d\d$/.test(get('点検日')) || !get('内容')) {
      throw new Error('点検日と内容を確認してください。');
    }
    asset.history.unshift({
      id: crypto.randomUUID(),
      date: get('点検日'),
      text: get('内容'),
      kind: get('種類') || '移行した点検',
      result:
        {
          異常なし: 'normal',
          要対応: 'attention',
          補修済み: 'repaired',
        }[get('結果')] || 'normal',
      inspector: get('実施者'),
      nextDate: get('次回点検日'),
      attachments: [],
    });
    count++;
  }
  return {
    state: next,
    count,
  };
}
async function switchProfile(profile) {
  await window.FactoryPreferences?.flush?.();
  await api('/api/demo/profile', {
    method: 'POST',
    body: {
      profile,
    },
  });
  location.reload();
}
function Account({ session }) {
  return (
    <div className="product-account">
      <span className={'plan-pill ' + session.plan}>
        {session.plan === 'free' ? 'FREE' : 'PRO'} <small>DEMO</small>
      </span>
      <label>
        <span className="sr-only">デモアカウント</span>
        <select
          aria-label="デモアカウント"
          value={session.profile}
          onChange={(e) => switchProfile(e.target.value).catch((e) => alert(e.message))}
        >
          <option value="free">無料デモ</option>
          <option value="pro">有料管理者デモ</option>
        </select>
      </label>
      <span className="sso-label">✓ SSO</span>
    </div>
  );
}
function PlanComparison({ session, busy, run }) {
  return (
    <>
      <p className="section-intro">
        将来の料金プランを体験するサンプルです。実際の決済・カード登録・請求はありません。
      </p>
      <div className="plan-grid">
        {[
          {
            id: 'free',
            name: 'Free',
            items: [
              '図面 3枚',
              '設備 100台',
              '資料保存 10MB',
              '工事・付箋・点検履歴',
              'チーム作業・担当者名簿・点検計画',
              '設備分類の追加・変更・削除',
              '左右パネルの開閉・集中表示',
            ],
          },
          {
            id: 'pro',
            name: 'Pro',
            items: [
              '図面 30枚',
              '設備 2,000台',
              '資料保存 100MB',
              '独自アイコン 50個',
              '配色・テーマ・ブランド名',
              'バックアップ 10世代',
              '管理者の操作履歴',
            ],
          },
          {
            id: 'enterprise',
            name: 'Enterprise',
            tag: '将来のプラン案',
            items: [
              '図面 100枚 / 設備 10,000台',
              '資料保存 300MB',
              'アイコン 100個 / バックアップ30世代',
              '個別の運用設計を想定',
            ],
          },
        ].map((p) => (
          <article key={p.id} className={'plan-card ' + p.id}>
            {p.tag && <span className="eyebrow">{p.tag}</span>}
            <h2>{p.name}</h2>
            <div className="demo-price">
              料金未設定 <small>課金なしのデモ</small>
            </div>
            <ul>
              {p.items.map((x) => (
                <li key={x}>✓ {x}</li>
              ))}
            </ul>
            {p.id === 'enterprise' ? (
              <span className="muted">このサンプルの切替対象外</span>
            ) : (
              <button
                disabled={session.profile === p.id || busy}
                className={'button ' + (p.id === 'pro' ? 'primary' : 'secondary')}
                onClick={() => run(() => switchProfile(p.id))}
              >
                {session.profile === p.id ? '利用中のデモ' : p.name + 'デモを使う'}
              </button>
            )}
          </article>
        ))}
      </div>
      <p className="product-note">
        2つのデモは別のデータを保存します。切り替えても元のアカウントの登録データは残ります。
      </p>
    </>
  );
}
function PlansDialog({ session, onClose }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const run = async (fn) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog ref={ref} className="plans-dialog" aria-labelledby="plans-title" onClose={onClose}>
      <div className="plans-heading">
        <div>
          <h1 id="plans-title">プラン比較</h1>
        </div>
        <button
          type="button"
          className="icon-close"
          aria-label="閉じる"
          onClick={() => ref.current.close()}
        >
          ×
        </button>
      </div>
      {message && (
        <p className="product-message" role="alert">
          {message}
        </p>
      )}
      <PlanComparison session={session} busy={busy} run={run} />
    </dialog>
  );
}
function MapBar() {
  const session = window.FactoryAPI.session;
  const [editor, setEditor] = useState(window.factoryMap?.editor ?? session.editor);
  const [plans, setPlans] = useState(new URL(location.href).searchParams.get('plans') === '1');
  useEffect(() => {
    const mode = (e) => setEditor(e.detail.editor);
    window.addEventListener('factory-mode-changed', mode);
    return () => window.removeEventListener('factory-mode-changed', mode);
  }, []);
  useEffect(() => {
    const open = () => {
      const url = new URL(location.href);
      url.searchParams.set('plans', '1');
      history.replaceState(null, '', url);
      setPlans(true);
    };
    window.addEventListener('factory-plans-open', open);
    return () => window.removeEventListener('factory-plans-open', open);
  }, []);
  const close = () => {
    setPlans(false);
    const url = new URL(location.href);
    url.searchParams.delete('plans');
    history.replaceState(null, '', url);
    document.getElementById('plans-open')?.focus();
  };
  return (
    <>
      <div className="product-mapbar">
        <div>
          <b>{editor ? '施設管理' : '工事のお知らせ'}</b>
        </div>
        <div className="mapbar-account">
          {editor && <NotionStatus onChanged={() => window.factoryMap.refresh()} />}
          <Account session={session} />
        </div>
      </div>
      {plans && <PlansDialog session={session} onClose={close} />}
    </>
  );
}
const nav = [
  ['overview', '◫', 'ダッシュボード'],
  ['tasks', '☷', 'タスク'],
  ['equipment', '▦', '設備一覧'],
  ['works', '▧', '工事一覧'],
  ['data', '⇄', 'データ移行'],
  ['notion', '↔', 'Notion同期'],
  ['files', '▧', '資料ライブラリー'],
  ['backups', '◷', 'バックアップ'],
  ['audit', '≡', '操作履歴'],
];
function Console() {
  const [session, setSession] = useState(null);
  const [state, setState] = useState(null);
  const [tab, setTab] = useState(
    location.hash === '#inspections' ? 'tasks' : location.hash.slice(1) || 'overview',
  );
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState([]);
  const [backups, setBackups] = useState([]);
  const [audit, setAudit] = useState([]);
  const [preview, setPreview] = useState(null);
  const [importState, setImportState] = useState(null);
  const [backupName, setBackupName] = useState('');
  const [initialCondition, setInitialCondition] = useState('');
  const [focusTask, setFocusTask] = useState(null);
  const [taskCondition, setTaskCondition] = useState(
    location.hash === '#inspections' ? 'inspections' : '',
  );
  const run = async (fn) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };
  async function refresh() {
    await window.FactoryAPI.load();
    const current = await window.FactoryAPI.refreshSession();
    setSession(current);
    if (!current.editor) {
      return;
    }
    const r = await api('/api/state');
    setState(r.state);
  }
  useEffect(() => {
    run(refresh);
  }, []);
  useEffect(() => {
    const navigate = () => {
      const target = location.hash.slice(1);
      if (target === 'inspections') {
        setTaskCondition('inspections');
        setFocusTask(null);
        setTab('tasks');
      } else if (nav.some(([id]) => id === target)) {
        setTaskCondition('');
        setFocusTask(null);
        setTab(target);
      }
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useEffect(() => {
    const url = new URL(location.href);
    url.hash = tab;
    history.replaceState(null, '', url);
    if (!session?.editor) {
      return;
    }
    if (tab === 'files') {
      run(async () => setFiles((await api('/api/files')).items));
    }
    if (tab === 'backups' && session.limits.snapshots) {
      run(async () => setBackups((await api('/api/snapshots')).items));
    }
    if (tab === 'audit' && session.role === 'owner') {
      run(async () => setAudit((await api('/api/audit')).items));
    }
  }, [tab, session?.profile]);
  if (session && !session.editor) {
    return (
      <main className="product-loading">
        <span className="brand-mark">▦</span>
        <h1>施設担当モード専用です</h1>
        <p>設備・工事台帳と変更履歴は施設担当者の管理画面です。</p>
        <button
          className="button primary"
          onClick={() =>
            run(async () => {
              await api('/api/auth/login', {
                method: 'POST',
                body: {},
              });
              location.reload();
            })
          }
        >
          施設担当モードで開く
        </button>
        <p>
          <a href="index.html">構内のお知らせへ戻る</a>
        </p>
        {message && <p role="alert">{message}</p>}
      </main>
    );
  }
  if (!session || !state) {
    return (
      <main className="product-loading">
        <span className="brand-mark">▦</span>
        <h1>ワークスペースを開いています</h1>
        <p>{message || 'SSOとデータベースの接続を確認中…'}</p>
      </main>
    );
  }
  const clearTaskLink = () => {
    const url = new URL(location.href);
    for (const key of ['teamTab', 'project']) {
      url.searchParams.delete(key);
    }
    history.replaceState(null, '', url);
  };
  const openTasks = (id, condition) => {
    clearTaskLink();
    setFocusTask(id || null);
    setTaskCondition(condition || '');
    setTab('tasks');
  };
  const title = nav.find((x) => x[0] === tab)?.[2] || '概要';
  const exportEquipment = () =>
    save(
      '設備台帳-' + date() + '.csv',
      csvExport([
        ['設備ID', '設備名', '分類', '場所', '最終点検日', '次回点検日'],
        ...state.assets.map((a) => [
          a.code,
          a.name,
          a.properties?.category,
          a.location,
          a.history[0]?.date,
          a.properties?.nextInspection || a.history[0]?.nextDate,
        ]),
      ]),
      'text/csv;charset=utf-8',
    );
  const exportHistory = () =>
    save(
      '点検履歴-' + date() + '.csv',
      csvExport([
        ['設備ID', '点検日', '内容', '種類', '結果', '実施者', '次回点検日'],
        ...state.assets.flatMap((a) =>
          a.history.map((h) => [
            a.code,
            h.date,
            h.text,
            h.kind,
            {
              normal: '異常なし',
              attention: '要対応',
              repaired: '補修済み',
            }[h.result] || '',
            h.inspector,
            h.nextDate,
          ]),
        ),
      ]),
      'text/csv;charset=utf-8',
    );
  async function importFile(file, kind) {
    if (!file) {
      return;
    }
    if (file.size > 750000) {
      throw new Error('取り込みファイルは750KB以下にしてください。');
    }
    const text = await file.text();
    let value;
    if (kind === 'csv') {
      const r = csvHistory(text, state);
      value = r.state;
      setPreview({
        history: r.count,
        counts: {
          assets: value.assets.length,
        },
        warnings: ['現在の台帳に点検履歴を追加します。設備IDで照合します。'],
        canApply: true,
      });
    } else {
      const parsed = JSON.parse(text);
      value = parsed.state || parsed;
      setPreview(
        await api('/api/import-preview', {
          method: 'POST',
          body: {
            state: value,
          },
        }),
      );
    }
    setImportState(value);
  }
  return (
    <div className="console-shell">
      <aside className="console-sidebar">
        <a href="index.html" className="console-brand">
          <span className="brand-mark">▦</span>
          <span>{session.preferences?.brandName || 'PlantDesk'}</span>
        </a>
        <div className="workspace-name">{session.organization.name}</div>
        {[
          ['業務', nav.slice(0, 2)],
          ['台帳', nav.slice(2, 4)],
          ['設定・資料', nav.slice(4)],
        ].map(([group, items]) => (
          <nav key={group} aria-label={group} className="console-nav-group">
            <small className="console-nav-label">{group}</small>
            {items.map(([id, icon, label]) => (
              <button
                key={id}
                aria-current={tab === id ? 'page' : undefined}
                className={tab === id ? 'selected' : ''}
                onClick={() => {
                  clearTaskLink();
                  setInitialCondition('');
                  setFocusTask(null);
                  setTaskCondition('');
                  setTab(id);
                  setMessage('');
                }}
              >
                <span aria-hidden="true">{icon}</span>
                {label}
              </button>
            ))}
          </nav>
        ))}
        <a className="map-return" href="index.html">
          ← 敷地マップに戻る
        </a>
        <div className="console-sidebar-footer">
          施設管理チームのワークスペース
          <br />
          DEMO / 課金は発生しません
        </div>
      </aside>
      <main className="console-main">
        <header className="console-header">
          <div>
            <h1>{title}</h1>
          </div>
          <div className="console-header-account">
            <NotionStatus onChanged={refresh} />
            <Account session={session} />
          </div>
        </header>
        {message && (
          <div className="product-message" role="status">
            {message}
          </div>
        )}
        {busy && (
          <div className="product-progress" role="status">
            処理しています…
          </div>
        )}
        {tab === 'notion' && <NotionSync state={state} onRefresh={refresh} />}
        {tab === 'tasks' && (
          <TeamWorkspace
            state={state}
            session={session}
            onRefresh={refresh}
            focusId={focusTask}
            initialFocus={taskCondition}
          />
        )}
        {(tab === 'equipment' || tab === 'works') && (
          <Register
            key={tab}
            kind={tab}
            state={state}
            session={session}
            onRefresh={refresh}
            initialCondition={initialCondition}
            exportRows={(name, rows) => save(name, csvExport(rows), 'text/csv;charset=utf-8')}
          />
        )}
        {tab === 'overview' && (
          <TeamDashboard
            state={state}
            onTasks={openTasks}
            onInspections={() => openTasks(null, 'inspections')}
            onEquipment={(condition) => {
              setInitialCondition(condition);
              setTab('equipment');
            }}
            onWorks={(condition) => {
              setInitialCondition(condition);
              setTab('works');
            }}
          />
        )}
        {tab === 'data' && (
          <>
            <p className="section-intro">
              今の台帳からの移行や、以前の点検履歴の引き継ぎに。取り込み内容を確認してから保存します。
            </p>
            <div className="two-column">
              <section className="product-card">
                <h2>台帳をJSONで取り込む</h2>
                <p>
                  旧PostgreSQL版から書き出したJSONに対応。図面・工事・設備・属性・付箋・点検履歴をまとめて読み込みます。
                </p>
                <label className="product-upload">
                  JSONを選択
                  <input
                    aria-label="台帳JSONを取り込む"
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => run(() => importFile(e.target.files[0], 'json'))}
                  />
                </label>
                <small>
                  添付ファイル本体はJSONに含まれません。未移行の添付参照があれば保存を止めます。
                </small>
              </section>
              <section className="product-card">
                <h2>他システムの点検履歴をCSVで取り込む</h2>
                <p>設備IDで既存の設備を照合します。既存DBからCSVを書き出して利用できます。</p>
                <button
                  onClick={() =>
                    save(
                      '点検履歴テンプレート.csv',
                      csvExport([
                        ['設備ID', '点検日', '内容', '種類', '結果', '実施者', '次回点検日'],
                        [
                          'AC-A-001',
                          date(),
                          'フィルター清掃',
                          '定期点検',
                          '異常なし',
                          '担当者',
                          '',
                        ],
                      ]),
                      'text/csv;charset=utf-8',
                    )
                  }
                >
                  CSVテンプレート ↧
                </button>
                <label className="product-upload">
                  CSVを選択
                  <input
                    aria-label="点検履歴CSVを取り込む"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => run(() => importFile(e.target.files[0], 'csv'))}
                  />
                </label>
              </section>
            </div>
            {preview && (
              <section className="product-card import-preview">
                <h2>取り込み内容の確認</h2>
                <p>
                  設備 {preview.counts.assets}台 / 点検履歴 {preview.history}件
                </p>
                {preview.warnings.map((x) => (
                  <p className="product-note" key={x}>
                    {x}
                  </p>
                ))}
                <p>保存すると、現在の台帳をこの内容に置き換えます。</p>
                <button
                  className="button primary"
                  disabled={!preview.canApply || busy}
                  onClick={() =>
                    run(async () => {
                      if (!confirm('現在の台帳を、確認した取り込み内容に置き換えますか？')) {
                        return;
                      }
                      await api('/api/import', {
                        method: 'POST',
                        body: {
                          state: importState,
                          revision: window.FactoryAPI.revision,
                          confirm: 'REPLACE',
                        },
                      });
                      await refresh();
                      setPreview(null);
                      setMessage('データを取り込みました。');
                    })
                  }
                >
                  確認して取り込む
                </button>
              </section>
            )}
            <section className="product-card">
              <h2>データを書き出す</h2>
              <div className="product-actions">
                <button
                  onClick={() =>
                    run(async () =>
                      save(
                        '構内マップ-' + date() + '.json',
                        JSON.stringify(await api('/api/export'), null, 2),
                      ),
                    )
                  }
                >
                  全体をJSONで保存
                </button>
                <button onClick={exportEquipment}>設備台帳CSV</button>
                <button onClick={exportHistory}>点検履歴CSV</button>
              </div>
            </section>
          </>
        )}
        {tab === 'files' && (
          <section className="product-card">
            <h2>登録した資料・写真・アイコン</h2>
            <p>
              設備や工事から外したファイルもここで確認できます。未使用のファイルを削除すると保存容量が空きます。
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>ファイル</th>
                    <th>容量</th>
                    <th>使用状況</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <a
                          href={'/api/files/' + f.id + '?inline=1'}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {f.name} ↗
                        </a>
                      </td>
                      <td>{size(f.size)}</td>
                      <td>
                        {f.historyReferenced
                          ? '工事・作業履歴に保存'
                          : f.referenced
                            ? '使用中'
                            : '未使用'}
                      </td>
                      <td>
                        <button
                          disabled={f.referenced || busy}
                          onClick={() =>
                            run(async () => {
                              if (!confirm(f.name + 'を削除しますか？')) {
                                return;
                              }
                              await api('/api/files/' + f.id, {
                                method: 'DELETE',
                              });
                              setFiles((await api('/api/files')).items);
                              await refresh();
                            })
                          }
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!files.length && (
              <p className="empty-product">
                資料はまだありません。地図画面の工事や設備から添付できます。
              </p>
            )}
          </section>
        )}
        {tab === 'backups' &&
          (session.limits.snapshots ? (
            <section className="product-card">
              <h2>台帳のバックアップ</h2>
              <p>
                図面・設備・履歴を保存し、必要なときに復元できます。添付資料は同じアカウントの保存済みファイルを参照します。
              </p>
              <div className="product-actions">
                <input
                  aria-label="バックアップ名"
                  value={backupName}
                  onChange={(e) => setBackupName(e.target.value)}
                  placeholder="例：11月の点検前"
                />
                <button
                  disabled={busy}
                  className="button primary"
                  onClick={() =>
                    run(async () => {
                      await api('/api/snapshots', {
                        method: 'POST',
                        body: {
                          name: backupName || 'バックアップ ' + date(),
                        },
                      });
                      setBackups((await api('/api/snapshots')).items);
                      setBackupName('');
                    })
                  }
                >
                  現在の台帳を保存
                </button>
              </div>
              {backups.map((b) => (
                <div className="backup-row" key={b.id}>
                  <span>
                    <b>{b.name}</b>
                    <small>{new Date(b.created_at).toLocaleString('ja-JP')}</small>
                  </span>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        if (!confirm('このバックアップから台帳を復元しますか？')) {
                          return;
                        }
                        await api('/api/snapshots/' + b.id + '/restore', {
                          method: 'POST',
                          body: {
                            revision: window.FactoryAPI.revision,
                          },
                        });
                        await refresh();
                        setMessage('台帳を復元しました。');
                      })
                    }
                  >
                    復元
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        if (!confirm('バックアップを削除しますか？')) {
                          return;
                        }
                        await api('/api/snapshots/' + b.id, {
                          method: 'DELETE',
                        });
                        setBackups((await api('/api/snapshots')).items);
                      })
                    }
                  >
                    削除
                  </button>
                </div>
              ))}
            </section>
          ) : (
            <section className="product-card upgrade-card">
              <span>◇ PRO</span>
              <h2>バックアップ・復元</h2>
              <p>バックアップと復元は、有料版を想定した機能です。</p>
              <button className="button primary" onClick={() => run(() => switchProfile('pro'))}>
                有料管理者デモで試す
              </button>
            </section>
          ))}
        {tab === 'audit' &&
          (session.role === 'owner' ? (
            <section className="product-card">
              <h2>最近の操作</h2>
              <p>保存・取り込み・復元をサーバー側で記録します。</p>
              {audit.map((a, i) => (
                <div className="audit-row" key={i}>
                  <code>{a.action}</code>
                  <span>更新 #{a.revision}</span>
                  <time>{new Date(a.created_at).toLocaleString('ja-JP')}</time>
                </div>
              ))}
              {!audit.length && <p>操作履歴はまだありません。</p>}
            </section>
          ) : (
            <section className="product-card">
              <h2>管理者用の操作履歴</h2>
              <p>有料管理者デモに切り替えると確認できます。</p>
              <button onClick={() => run(() => switchProfile('pro'))}>
                有料管理者デモに切り替える
              </button>
            </section>
          ))}
        <footer className="console-footer">
          架空の工場データのSaaSサンプル · 台帳750KB / 添付は各5MBまで · 請求なし{' '}
          <a href="https://github.com/hiromura16/plantdesk" target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
        </footer>
      </main>
    </div>
  );
}
window.FactoryProduct = {
  mountMap: (element) => createRoot(element).render(<MapBar />),
  mountConsole: (element) => createRoot(element).render(<Console />),
  csvParse,
  csvHistory,
};
