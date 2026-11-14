/**
 * 設備・工事の一覧、独自プロパティ列、絞り込み、履歴表示を担当します。
 * 表示列と順序は個人設定、台帳の更新と権限・ロックの検証はAPI側で扱います。
 */
import { ColumnPicker } from './column-picker.jsx';
import { AssetImport, downloadJSON } from './asset-import.jsx';
import React, { useEffect, useMemo, useRef, useState } from 'react';
const api = (...args) => window.FactoryAPI.request(...args);
const today = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const statusNames = {
  active: '工事中',
  planned: '予定',
  done: '完了',
};
const latest = (a) => [...(a.history || [])].sort((x, y) => y.date.localeCompare(x.date))[0];
const nextDate = (a) => a.properties?.nextInspection || latest(a)?.nextDate || '';
const normalize = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase();
const propertyValue = (d, value) =>
  value == null || value === ''
    ? ''
    : d.type === 'checkbox'
      ? value
        ? 'はい'
        : 'いいえ'
      : ['select', 'multiselect'].includes(d.type)
        ? (Array.isArray(value) ? value : [value])
            .map((v) => d.options?.find((o) => o.id === v)?.label || v)
            .join('、')
        : String(value) + (d.unit ? ' ' + d.unit : '');
/**
 * 基本列と独自プロパティを同じ列定義として扱い、値の取り出し・表示・検索に使います。
 * 保存する表示設定は列IDを持つため、名前が変わっても同じ項目を参照できます。
 */
export function Register({ kind, state, session, onRefresh, exportRows, initialCondition }) {
  const equipment = kind === 'equipment';
  const defs = state.propertyDefinitions || [];
  const categoryDef = defs.find((d) => d.id === 'category');
  const drawingName = (id) => state.drawings.find((d) => d.id === id)?.name || '';
  const layerName = (id) => state.layers?.find((l) => l.id === id)?.name || '標準（未分類）';
  const related = (w) =>
    (w.assetIds || []).map((id) => state.assets.find((a) => a.id === id)).filter(Boolean);
  const aggregate = (w, fn) =>
    [
      ...new Set(
        related(w)
          .map(fn)
          .filter((v) => v !== '' && v !== undefined && v !== null),
      ),
    ].join(' / ');
  const columns = useMemo(
    () =>
      equipment
        ? [
            {
              id: 'code',
              name: '設備ID',
              value: (a) => a.code,
            },
            {
              id: 'name',
              name: '設備名',
              value: (a) => a.name,
            },
            {
              id: 'category',
              name: '設備分類',
              value: (a) => propertyValue(categoryDef || {}, a.properties?.category),
            },
            {
              id: 'location',
              name: '場所',
              value: (a) => a.location,
            },
            {
              id: 'drawing',
              name: '図面',
              value: (a) => drawingName(a.drawingId),
            },
            {
              id: 'layer',
              name: 'レイヤー',
              value: (a) => layerName(a.layerId),
            },
            {
              id: 'nextDate',
              name: '次回点検日',
              value: nextDate,
            },
            {
              id: 'lastDate',
              name: '最終点検日',
              value: (a) => latest(a)?.date || '',
            },
            {
              id: 'inspection',
              name: '点検状況',
              value: (a) =>
                latest(a)?.result === 'attention'
                  ? '要対応'
                  : nextDate(a) && nextDate(a) < today()
                    ? '期限超過'
                    : latest(a)
                      ? '点検済み'
                      : '未点検',
            },
            {
              id: 'historyCount',
              name: '点検回数',
              value: (a) => a.history?.length || 0,
            },
            {
              id: 'files',
              name: '添付数',
              value: (a) => a.attachments?.length || 0,
            },
            {
              id: 'locks',
              name: 'ロック',
              value: (a) =>
                a.locks?.position && a.locks?.attributes
                  ? '位置・属性'
                  : a.locks?.position
                    ? '位置'
                    : a.locks?.attributes
                      ? '属性'
                      : 'なし',
            },
            {
              id: 'x',
              name: 'X座標',
              group: '位置・管理情報',
              value: (a) => a.point?.[0],
              raw: (a) => a.point?.[0],
            },
            {
              id: 'y',
              name: 'Y座標',
              group: '位置・管理情報',
              value: (a) => a.point?.[1],
              raw: (a) => a.point?.[1],
            },
            {
              id: 'icon',
              name: 'アイコン',
              group: '位置・管理情報',
              value: (a) => a.icon || '標準',
            },
            {
              id: 'fileNames',
              name: '添付ファイル名',
              group: '点検・資料',
              value: (a) => (a.attachments || []).map((f) => f.name).join(' / '),
            },
            {
              id: 'lastInspector',
              name: '最終点検の担当者',
              group: '点検・資料',
              value: (a) => latest(a)?.inspector || '',
            },
            {
              id: 'lastText',
              name: '最終点検の内容',
              group: '点検・資料',
              value: (a) => latest(a)?.text || '',
            },
            {
              id: 'updatedAt',
              name: '更新日時',
              group: '位置・管理情報',
              value: (a) => a.updatedAt || '',
            },
            ...defs
              .filter((d) => d.id !== 'category')
              .map((d) => ({
                id: 'prop:' + d.id,
                name: d.name,
                group: '設備プロパティ',
                type: d.type,
                value: (a) => propertyValue(d, a.properties?.[d.id]),
                raw: (a) => a.properties?.[d.id],
              })),
          ]
        : [
            {
              id: 'code',
              name: '工事ID',
              value: (w) => w.code,
            },
            {
              id: 'title',
              name: '工事名',
              value: (w) => w.title,
            },
            {
              id: 'status',
              name: '状態',
              value: (w) => (w.deleted ? '削除済み' : statusNames[w.status]),
            },
            {
              id: 'location',
              name: '場所',
              value: (w) => w.location,
            },
            {
              id: 'drawing',
              name: '図面',
              value: (w) => drawingName(w.drawingId),
            },
            {
              id: 'layer',
              name: 'レイヤー',
              value: (w) => layerName(w.layerId),
            },
            {
              id: 'start',
              name: '開始日',
              value: (w) => w.start,
            },
            {
              id: 'end',
              name: '終了日',
              value: (w) => w.end,
            },
            {
              id: 'contact',
              name: '担当',
              value: (w) => w.contact,
            },
            {
              id: 'phone',
              name: '内線',
              value: (w) => w.phone,
            },
            {
              id: 'impacts',
              name: '周囲への影響',
              value: (w) => (w.impacts || []).join('、'),
            },
            {
              id: 'assets',
              name: '関連設備数',
              value: (w) => w.assetIds?.length || 0,
            },
            {
              id: 'files',
              name: '添付数',
              value: (w) => w.attachments?.length || 0,
            },
            {
              id: 'notes',
              name: '工事内容',
              value: (w) => w.notes,
            },
            {
              id: 'updatedAt',
              name: '更新日時',
              value: (w) => w.updatedAt?.slice(0, 16).replace('T', ' ') || '',
            },
            {
              id: 'assetCodes',
              name: '関連設備ID',
              group: '関連設備',
              value: (w) => aggregate(w, (a) => a.code),
            },
            {
              id: 'assetNames',
              name: '関連設備名',
              group: '関連設備',
              value: (w) => aggregate(w, (a) => a.name),
            },
            {
              id: 'assetLocations',
              name: '関連設備の場所',
              group: '関連設備',
              value: (w) => aggregate(w, (a) => a.location),
            },
            {
              id: 'assetNextDate',
              name: '関連設備の次回点検日',
              group: '関連設備',
              value: (w) => aggregate(w, nextDate),
            },
            {
              id: 'fileNames',
              name: '添付ファイル名',
              group: '工事の資料・履歴',
              value: (w) => (w.attachments || []).map((f) => f.name).join(' / '),
            },
            {
              id: 'deletedAt',
              name: '削除日時',
              group: '工事の資料・履歴',
              value: (w) => w.deletedAt || '',
            },
            ...defs.map((d) => ({
              id: 'assetProp:' + d.id,
              name: '関連設備：' + d.name,
              group: '関連設備のプロパティ',
              type: d.type,
              value: (w) => aggregate(w, (a) => propertyValue(d, a.properties?.[d.id])),
            })),
          ],
    [kind, state],
  );
  const defaults = equipment
    ? ['code', 'name', 'category', 'location', 'nextDate', 'locks']
    : ['code', 'title', 'status', 'location', 'start', 'end', 'contact'];
  const [view, setView] = useState({
    columns: defaults,
    sort: equipment ? 'code' : 'start',
    descending: false,
    filters: {},
    pageSize: 50,
  });
  const [, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [deleted, setDeleted] = useState([]);
  const [deletedOffset, setDeletedOffset] = useState(null);
  const [history, setHistory] = useState(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(new Set());
  const [targetLayer, setTargetLayer] = useState('');
  const [bulkStatus, setBulkStatus] = useState('done');
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const saveChain = useRef(Promise.resolve());
  const saveVersion = useRef(0);
  useEffect(() => {
    let valid = true;
    api('/api/preferences')
      .then((r) => {
        if (!valid) {
          return;
        }
        const saved = r.preferences.tableViews?.[kind];
        if (saved) {
          setView((v) => ({
            ...v,
            ...saved,
            columns: saved.columns?.length ? saved.columns : defaults,
            filters: {
              ...(saved.filters || {}),
              ...(initialCondition
                ? {
                    condition: initialCondition,
                  }
                : {}),
            },
          }));
        } else if (initialCondition) {
          setView((v) => ({
            ...v,
            filters: {
              condition: initialCondition,
            },
          }));
        }
        setReady(true);
      })
      .catch((e) => setMessage(e.message));
    if (!equipment) {
      api('/api/work-register')
        .then((r) => {
          if (valid) {
            setDeleted(r.deleted);
            setDeletedOffset(r.nextOffset);
          }
        })
        .catch((e) => setMessage(e.message));
    }
    return () => {
      valid = false;
    };
  }, [kind, session.profile]);
  useEffect(() => {
    const id = new URL(location.href).searchParams.get('work');
    if (!equipment && id) {
      setHistory(
        state.works.find((w) => w.id === id) || {
          id,
          title: '工事の履歴',
        },
      );
    }
  }, [kind]);
  const persist = (next) => {
    const version = ++saveVersion.current;
    setMessage('一覧の表示設定を保存しています…');
    saveChain.current = saveChain.current
      .catch(() => {})
      .then(async () => {
        const current = await api('/api/preferences');
        await api('/api/preferences', {
          method: 'PUT',
          body: {
            ...current.preferences,
            tableViews: {
              ...current.preferences.tableViews,
              [kind]: next,
            },
          },
        });
        if (version === saveVersion.current) {
          setMessage('一覧の表示設定を保存しました。');
        }
      })
      .catch((e) => setMessage(e.message));
  };
  const update = (patch, save = true) => {
    const next = {
      ...view,
      ...patch,
    };
    setView(next);
    setPage(0);
    if (save) {
      persist(next);
    }
  };
  const filter = (key, value, save = true) =>
    update(
      {
        filters: {
          ...view.filters,
          [key]: value,
        },
      },
      save,
    );
  const f = view.filters || {};
  const dateNow = today();
  const rows = (equipment ? state.assets : [...state.works, ...deleted]).filter((row) => {
    if (
      !equipment &&
      (((!f.deleted || f.deleted === 'current') && row.deleted) ||
        (f.deleted === 'deleted' && !row.deleted))
    ) {
      return false;
    }
    if (f.drawing && row.drawingId !== f.drawing) {
      return false;
    }
    if (f.layer && (f.layer === '__unset' ? !!row.layerId : row.layerId !== f.layer)) {
      return false;
    }
    if (equipment && f.category && row.properties?.category !== f.category) {
      return false;
    }
    if (!equipment && f.status && row.status !== f.status) {
      return false;
    }
    if (!equipment && f.condition) {
      const week = new Date(dateNow + 'T00:00:00Z');
      week.setUTCDate(week.getUTCDate() + 7);
      const conditions = {
        late: row.status !== 'done' && row.end < dateNow,
        upcoming: row.status === 'planned' && row.start <= week.toISOString().slice(0, 10),
        traffic: row.impacts?.some((x) => ['通行止め', '車両通行'].includes(x)),
      };
      if (!conditions[f.condition]) {
        return false;
      }
    }
    if (f.from && (equipment ? nextDate(row) : row.start) < f.from) {
      return false;
    }
    if (f.to && (equipment ? nextDate(row) : row.start) > f.to) {
      return false;
    }
    if (equipment && f.condition) {
      const h = latest(row);
      const locked = row.locks?.position || row.locks?.attributes;
      const conditions = {
        due: !!nextDate(row) && nextDate(row) <= dateNow,
        attention: h?.result === 'attention',
        uninspected: !h,
        locked,
        unlocked: !locked,
        photos: row.attachments?.some((a) => a.mime?.startsWith('image/')),
        noFiles: !row.attachments?.length,
      };
      if (!conditions[f.condition]) {
        return false;
      }
    }
    if (equipment && f.property && f.value) {
      const d = defs.find((d) => d.id === f.property);
      if (
        !normalize(propertyValue(d || {}, row.properties?.[f.property])).includes(
          normalize(f.value),
        )
      ) {
        return false;
      }
    }
    const words = normalize(f.query).trim().split(/\s+/).filter(Boolean);
    return words.every((word) =>
      normalize(columns.map((c) => c.value(row)).join(' ')).includes(word),
    );
  });
  const sortColumn = columns.find((c) => c.id === view.sort) || columns[0];
  rows.sort((a, b) => {
    const x = sortColumn.raw?.(a) ?? sortColumn.value(a);
    const y = sortColumn.raw?.(b) ?? sortColumn.value(b);
    const compare =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x ?? '').localeCompare(String(y ?? ''), 'ja', {
            numeric: true,
          });
    return view.descending ? -compare : compare;
  });
  const chosen = view.columns.map((id) => columns.find((c) => c.id === id)).filter(Boolean);
  const pageSize = [20, 50, 100].includes(view.pageSize) ? view.pageSize : 50;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const perform = async (fn) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      await onRefresh();
      if (!equipment) {
        const r = await api('/api/work-register');
        setDeleted(r.deleted);
        setDeletedOffset(r.nextOffset);
      }
      setSelected(new Set());
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };
  const batch = (record) =>
    perform(async () => {
      if (selected.size > 100) {
        throw new Error('一括操作は100件ずつ実行してください。');
      }
      await api('/api/batch', {
        method: 'POST',
        body: {
          operations: [...selected].map((id) => ({
            kind: equipment ? 'assets' : 'works',
            id,
            method: 'PATCH',
            record,
          })),
        },
      });
      setMessage(selected.size + '件を更新しました。');
    });
  const openMap = (row) =>
    (location.href =
      'index.html?' + (equipment ? 'asset' : 'work') + '=' + encodeURIComponent(row.id));
  return (
    <>
      <p className="section-intro">
        {equipment
          ? '設備を、分類・図面・点検状況から管理。追加したプロパティも一覧の列にできます。'
          : '工事と関連設備のプロパティを、選んだ列でまとめて確認。複数設備の値は「 / 」で並べて表示します。'}
      </p>
      <section className="product-card register-card">
        <div className="section-heading">
          <h2>{equipment ? '設備一覧' : '工事一覧'}</h2>
          <div className="product-actions">
            <button
              onClick={() =>
                exportRows((equipment ? '設備' : '工事') + '一覧-' + dateNow + '.csv', [
                  chosen.map((c) => c.name),
                  ...rows.map((row) => chosen.map((c) => c.value(row))),
                ])
              }
            >
              絞り込んだ一覧をCSV保存
            </button>
            {equipment && (
              <>
                <button onClick={() => setImporting(true)}>JSONで一括登録</button>
                <button
                  onClick={() =>
                    downloadJSON('plantdesk-equipment.json', {
                      assets: rows.map((a) =>
                        Object.fromEntries(
                          Object.entries(a).filter(([k]) =>
                            [
                              'code',
                              'name',
                              'drawingId',
                              'point',
                              'location',
                              'properties',
                              'layerId',
                              'icon',
                            ].includes(k),
                          ),
                        ),
                      ),
                    })
                  }
                >
                  設備JSONを保存
                </button>
              </>
            )}
            <ColumnPicker
              columns={columns}
              chosen={view.columns}
              defaults={defaults}
              onChange={(columns) =>
                update({
                  columns,
                })
              }
            />
          </div>
        </div>
        <div className="register-filters">
          <label className="register-search">
            検索
            <input
              aria-label={equipment ? '設備一覧を検索' : '工事一覧を検索'}
              value={f.query || ''}
              placeholder="名前・ID・場所・属性を検索"
              onChange={(e) => filter('query', e.target.value, false)}
              onBlur={() => persist(view)}
            />
          </label>
          {equipment ? (
            <label>
              設備分類
              <select
                aria-label="一覧の設備分類"
                value={f.category || ''}
                onChange={(e) => filter('category', e.target.value)}
              >
                <option value="">すべて</option>
                {categoryDef?.options?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              状態
              <select
                aria-label="一覧の工事状態"
                value={f.status || ''}
                onChange={(e) => filter('status', e.target.value)}
              >
                <option value="">すべて</option>
                {Object.entries(statusNames).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            図面
            <select
              aria-label="一覧の図面"
              value={f.drawing || ''}
              onChange={(e) => filter('drawing', e.target.value)}
            >
              <option value="">すべての図面</option>
              {state.drawings.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            レイヤー
            <select
              aria-label="一覧のレイヤー"
              value={f.layer || ''}
              onChange={(e) => filter('layer', e.target.value)}
            >
              <option value="">すべて</option>
              <option value="__unset">標準（未分類）</option>
              {state.layers?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          {equipment ? (
            <label>
              管理上の条件
              <select
                aria-label="設備の管理条件"
                value={f.condition || ''}
                onChange={(e) => filter('condition', e.target.value)}
              >
                <option value="">すべて</option>
                {Object.entries({
                  due: '点検期限を迎えた設備',
                  attention: '点検で要対応',
                  uninspected: '点検記録なし',
                  locked: 'ロック中',
                  unlocked: 'ロックなし',
                  photos: '写真あり',
                  noFiles: '添付資料なし',
                }).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              削除済み工事
              <select
                aria-label="削除済み工事の表示"
                value={f.deleted || 'current'}
                onChange={(e) => filter('deleted', e.target.value)}
              >
                <option value="current">現在の工事</option>
                <option value="all">削除済みも含む</option>
                <option value="deleted">削除済みのみ</option>
              </select>
            </label>
          )}
          {!equipment && (
            <label>
              管理上の条件
              <select
                aria-label="工事の管理条件"
                value={f.condition || ''}
                onChange={(e) => filter('condition', e.target.value)}
              >
                <option value="">すべて</option>
                <option value="late">終了予定を超過</option>
                <option value="upcoming">7日以内の予定</option>
                <option value="traffic">通行への影響あり</option>
              </select>
            </label>
          )}
          <label>
            {equipment ? '次回点検日' : '開始日'}・以降
            <input
              type="date"
              aria-label="一覧の日付の始まり"
              value={f.from || ''}
              onChange={(e) => filter('from', e.target.value)}
            />
          </label>
          <label>
            以前
            <input
              type="date"
              aria-label="一覧の日付の終わり"
              value={f.to || ''}
              onChange={(e) => filter('to', e.target.value)}
            />
          </label>
          {equipment && (
            <>
              <label>
                プロパティ
                <select
                  aria-label="一覧のプロパティ条件"
                  value={f.property || ''}
                  onChange={(e) => filter('property', e.target.value)}
                >
                  <option value="">追加条件なし</option>
                  {defs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                含む値
                <input
                  aria-label="一覧のプロパティの値"
                  disabled={!f.property}
                  value={f.value || ''}
                  onChange={(e) => filter('value', e.target.value, false)}
                  onBlur={() => persist(view)}
                />
              </label>
            </>
          )}
          <button
            className="register-reset"
            onClick={() =>
              update({
                filters: {},
              })
            }
          >
            条件をクリア
          </button>
        </div>
        <p className="register-message" role="status">
          {message || '表示列と条件は自動保存されます。'}
        </p>
        {selected.size > 0 && (
          <div className="register-bulk">
            <strong>{selected.size}件を選択</strong>
            {equipment ? (
              <>
                <button
                  disabled={busy}
                  onClick={() =>
                    batch({
                      locks: {
                        position: true,
                        attributes: true,
                      },
                    })
                  }
                >
                  ロック
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    batch({
                      locks: {
                        position: false,
                        attributes: false,
                      },
                    })
                  }
                >
                  ロック解除
                </button>
                <select
                  aria-label="一括移動先のレイヤー"
                  value={targetLayer}
                  onChange={(e) => setTargetLayer(e.target.value)}
                >
                  <option value="">標準（未分類）</option>
                  {state.layers?.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <button
                  disabled={busy}
                  onClick={() =>
                    batch({
                      layerId: targetLayer,
                    })
                  }
                >
                  レイヤーへ移動
                </button>
              </>
            ) : (
              <>
                <select
                  aria-label="一括変更する工事状態"
                  value={bulkStatus}
                  onChange={(e) => setBulkStatus(e.target.value)}
                >
                  {Object.entries(statusNames).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  disabled={busy}
                  onClick={() =>
                    batch({
                      status: bulkStatus,
                      updatedAt: new Date().toISOString(),
                    })
                  }
                >
                  状態を更新
                </button>
              </>
            )}
            <button onClick={() => setSelected(new Set())}>選択解除</button>
          </div>
        )}
        <div className="table-scroll register-table">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="表示中の行を選択"
                    checked={
                      !!visible.filter((r) => !r.deleted).length &&
                      visible.filter((r) => !r.deleted).every((r) => selected.has(r.id))
                    }
                    onChange={(e) => {
                      const next = new Set(selected);
                      for (const row of visible.filter((r) => !r.deleted)) {
                        if (e.target.checked) {
                          next.add(row.id);
                        } else {
                          next.delete(row.id);
                        }
                      }
                      setSelected(next);
                    }}
                  />
                </th>
                {chosen.map((c) => (
                  <th
                    key={c.id}
                    aria-sort={
                      view.sort === c.id ? (view.descending ? 'descending' : 'ascending') : 'none'
                    }
                  >
                    <button
                      onClick={() =>
                        update({
                          sort: c.id,
                          descending: view.sort === c.id ? !view.descending : false,
                        })
                      }
                    >
                      {c.name}
                      {view.sort === c.id ? (view.descending ? ' ↓' : ' ↑') : ''}
                    </button>
                  </th>
                ))}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.id}
                  data-register-row={row.id}
                  className={row.deleted ? 'register-deleted' : ''}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={row.code + 'を選択'}
                      disabled={row.deleted}
                      checked={selected.has(row.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) {
                          next.add(row.id);
                        } else {
                          next.delete(row.id);
                        }
                        setSelected(next);
                      }}
                    />
                  </td>
                  {chosen.map((c) => (
                    <td
                      key={c.id}
                      className={c.id === 'name' || c.id === 'title' ? 'register-title' : ''}
                    >
                      {c.value(row) === undefined || c.value(row) === null || c.value(row) === ''
                        ? '—'
                        : c.value(row)}
                    </td>
                  ))}
                  <td>
                    <div className="register-row-actions">
                      {!row.deleted && (
                        <>
                          <button onClick={() => openMap(row)}>地図 ↗</button>
                          <button
                            onClick={() =>
                              (location.href =
                                'console.html?' +
                                (equipment ? 'newTaskAsset' : 'newTaskWork') +
                                '=' +
                                encodeURIComponent(row.id) +
                                '#tasks')
                            }
                          >
                            仕事を依頼
                          </button>
                        </>
                      )}
                      {equipment ? (
                        <button
                          disabled={busy}
                          onClick={() =>
                            perform(async () => {
                              const locked = !(row.locks?.position && row.locks?.attributes);
                              await api('/api/assets/' + row.id, {
                                method: 'PATCH',
                                body: {
                                  locks: {
                                    position: locked,
                                    attributes: locked,
                                  },
                                },
                              });
                            })
                          }
                        >
                          {row.locks?.position && row.locks?.attributes ? '解除' : 'ロック'}
                        </button>
                      ) : (
                        <>
                          <button onClick={() => setHistory(row)}>変更履歴</button>
                          {!row.deleted && (
                            <button
                              disabled={busy}
                              onClick={() => {
                                if (
                                  confirm(
                                    '工事「' + row.title + '」を削除しますか？変更履歴は残ります。',
                                  )
                                ) {
                                  perform(() =>
                                    api('/api/works/' + encodeURIComponent(row.id), {
                                      method: 'DELETE',
                                    }),
                                  );
                                }
                              }}
                            >
                              削除
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && (
            <p className="empty-product">条件に合う{equipment ? '設備' : '工事'}がありません。</p>
          )}
        </div>
        <div className="register-pagination">
          <span>
            {rows.length}件中 {rows.length ? currentPage * pageSize + 1 : 0}〜
            {Math.min((currentPage + 1) * pageSize, rows.length)}件
          </span>
          <label>
            表示件数
            <select
              aria-label="一覧の表示件数"
              value={pageSize}
              onChange={(e) =>
                update({
                  pageSize: Number(e.target.value),
                })
              }
            >
              {[20, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
            前へ
          </button>
          <span>
            {currentPage + 1} / {totalPages}
          </span>
          <button disabled={currentPage + 1 >= totalPages} onClick={() => setPage(currentPage + 1)}>
            次へ
          </button>
        </div>
        {!equipment && deletedOffset !== null && (
          <button
            onClick={async () => {
              try {
                const r = await api('/api/work-register?offset=' + deletedOffset);
                setDeleted((v) => [...v, ...r.deleted]);
                setDeletedOffset(r.nextOffset);
              } catch (e) {
                setMessage(e.message);
              }
            }}
          >
            過去に削除した工事をさらに読み込む
          </button>
        )}
      </section>
      {importing && (
        <AssetImport state={state} onClose={() => setImporting(false)} onRefresh={onRefresh} />
      )}{' '}
      {history && <WorkHistory work={history} state={state} onClose={() => setHistory(null)} />}
    </>
  );
}
function WorkHistory({ work, state, onClose }) {
  const ref = useRef(null);
  const [events, setEvents] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [message, setMessage] = useState('');
  const load = async (before) => {
    try {
      const r = await api(
        '/api/works/' +
          encodeURIComponent(work.id) +
          '/history' +
          (before ? '?before=' + before : ''),
      );
      setEvents((v) => (before ? [...v, ...r.items] : r.items));
      setCursor(r.nextCursor);
    } catch (e) {
      setMessage(e.message);
    }
  };
  useEffect(() => {
    ref.current.showModal();
    load();
  }, [work.id]);
  const labels = {
    title: '工事名',
    code: '工事ID',
    status: '状態',
    location: '場所',
    start: '開始日',
    end: '終了日',
    notes: '内容・注意事項',
    contact: '担当',
    phone: '内線',
    impacts: '周囲への影響',
    drawingId: '図面',
    layerId: 'レイヤー',
    points: '工事範囲',
    assetIds: '関連設備',
    attachments: '添付資料',
    coverPhotoId: '代表写真',
  };
  const value = (key, v) =>
    v == null || v === ''
      ? '未設定'
      : key === 'status'
        ? statusNames[v]
        : key === 'drawingId'
          ? state.drawings.find((d) => d.id === v)?.name || v
          : key === 'layerId'
            ? state.layers?.find((l) => l.id === v)?.name || '削除されたレイヤー'
            : key === 'points'
              ? v.length + '頂点の範囲'
              : key === 'assetIds'
                ? v.length + '台'
                : key === 'attachments'
                  ? v.map((f) => f.name || '資料').join('、') || 'なし'
                  : Array.isArray(v)
                    ? v.join('、')
                    : String(v);
  return (
    <dialog
      ref={ref}
      className="work-history-dialog"
      aria-labelledby="work-history-title"
      onClose={onClose}
    >
      <div className="dialog-heading">
        <div>
          <h2 id="work-history-title">工事の変更履歴</h2>
          <p>
            {work.code} · {work.title}
          </p>
        </div>
        <button
          className="icon-close"
          aria-label="履歴を閉じる"
          onClick={() => ref.current.close()}
        >
          ×
        </button>
      </div>
      <p className="product-note">
        登録・変更・削除を記録します。履歴機能の導入前の変更は復元できないため、導入時点の台帳を最初の記録として残しています。
      </p>
      {message && <p role="alert">{message}</p>}
      <div className="work-history-timeline">
        {events.map((e) => (
          <article key={e.id}>
            <div className="work-history-meta">
              <b>
                {
                  {
                    baseline: '初期記録',
                    created: '登録',
                    updated: '変更',
                    deleted: '削除',
                  }[e.action]
                }
              </b>
              <time>
                {new Date(e.createdAt).toLocaleString('ja-JP', {
                  timeZone: 'Asia/Tokyo',
                })}
              </time>
              <small>
                {e.actor} · 更新 #{e.revision}
              </small>
            </div>
            <dl>
              {Object.entries(labels)
                .filter(([key]) => {
                  const a = e.before?.[key];
                  const b = e.after?.[key];
                  return (
                    !((a == null || a === '') && (b == null || b === '')) &&
                    JSON.stringify(a) !== JSON.stringify(b)
                  );
                })
                .map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {e.before && <del>{value(key, e.before[key])}</del>}
                      {e.after && <span>{value(key, e.after[key])}</span>}
                      {key === 'points' && e.before && e.after && <small>位置・形状を変更</small>}
                    </dd>
                  </div>
                ))}
            </dl>
            {[
              ...new Map(
                [...(e.before?.attachments || []), ...(e.after?.attachments || [])].map((f) => [
                  f.fileId || f.id,
                  f,
                ]),
              ).values(),
            ].map((f) => (
              <a
                key={f.fileId || f.id}
                href={'/api/files/' + encodeURIComponent(f.fileId || f.id)}
                target="_blank"
                rel="noreferrer"
              >
                {f.name} ↗
              </a>
            ))}
          </article>
        ))}
      </div>
      {cursor !== null && (
        <button className="button secondary" onClick={() => load(cursor)}>
          以前の履歴を読み込む
        </button>
      )}
      {!events.length && !message && <p>履歴を読み込んでいます…</p>}
    </dialog>
  );
}
