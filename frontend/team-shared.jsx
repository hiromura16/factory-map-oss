import React, { useEffect, useRef } from 'react';
export const api = (...args) => window.FactoryAPI.request(...args);
export const today = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const addDays = (day, n) => {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const statusNames = {
    open: '未着手',
    in_progress: '進行中',
    waiting: '確認・手配待ち',
    done: '完了',
    cancelled: '中止',
  },
  priorityNames = {
    urgent: '最優先',
    high: '高',
    normal: '通常',
    low: '低',
  },
  kindNames = {
    task: '一般作業',
    inspection: '点検',
    repair: '修理・対応',
    coordination: '工事調整',
  };
export const openTask = (t) => !['done', 'cancelled'].includes(t.status);
export const assigneeName = (state, id) =>
  state.teamMembers?.find((m) => m.id === id)?.name || '未割り当て';
export const compareTasks = (a, b) =>
  (a.dueDate && a.dueDate < today() ? 0 : 1) - (b.dueDate && b.dueDate < today() ? 0 : 1) ||
  Object.keys(priorityNames).indexOf(a.priority) - Object.keys(priorityNames).indexOf(b.priority) ||
  (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
export const taskFields = [
  'title',
  'description',
  'kind',
  'status',
  'priority',
  'dueDate',
  'assigneeId',
  'assetId',
  'workId',
  'drawingId',
  'estimatedMinutes',
  'blocker',
  'checklist',
  'attachments',
  'projectId',
  'parentId',
  'dependsOnIds',
  'startDate',
  'requestor',
  'acceptanceCriteria',
  'acceptanceConfirmed',
];
export const taskBody = (t) => Object.fromEntries(taskFields.map((k) => [k, t[k]]));
export const newTask = () => ({
  title: '',
  description: '',
  kind: 'task',
  status: 'open',
  priority: 'normal',
  dueDate: today(),
  assigneeId: '',
  assetId: '',
  workId: '',
  drawingId: '',
  estimatedMinutes: 30,
  blocker: '',
  checklist: [],
  attachments: [],
  projectId: '',
  parentId: '',
  dependsOnIds: [],
  startDate: '',
  requestor: '',
  acceptanceCriteria: '',
  acceptanceConfirmed: false,
});
export const writeFile = (name, value, type = 'text/plain;charset=utf-8') => {
  const u = URL.createObjectURL(
    new Blob([value], {
      type,
    }),
  );
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
};
export function Modal({ title, onClose, children, wide = false, drawer = false }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const e = ref.current;
    const previous = document.activeElement;
    drawer ? e.show() : e.showModal();
    const close = (event) => {
      event.preventDefault();
      closeRef.current();
    };
    const escape = (event) => {
      if (drawer && event.key === 'Escape' && !document.querySelector('dialog:modal')) {
        event.preventDefault();
        closeRef.current();
      }
    };
    e.addEventListener('cancel', close);
    document.addEventListener('keydown', escape);
    return () => {
      e.removeEventListener('cancel', close);
      document.removeEventListener('keydown', escape);
      if (previous?.isConnected) {
        previous.focus({
          preventScroll: true,
        });
      }
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={
        'product-dialog team-dialog ' +
        (wide ? 'team-dialog-wide ' : '') +
        (drawer ? 'task-pane' : '')
      }
      aria-label={title}
    >
      <div className="dialog-heading">
        <div>
          <small>{drawer ? 'タスク' : '詳細'}</small>
          <h2>{title}</h2>
        </div>
        <button type="button" aria-label={title + 'を閉じる'} onClick={() => onClose()}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Person({ state, id }) {
  const m = state.teamMembers?.find((m) => m.id === id);
  return (
    <span className="team-person">
      <i
        style={{
          background: m?.color || '#98a89e',
        }}
      />
      {m?.name || '未割り当て'}
      {m?.active === false ? '（休止）' : ''}
    </span>
  );
}
export function TaskBadges({ task }) {
  return (
    <div className="task-badges">
      <span className={'task-priority ' + task.priority}>{priorityNames[task.priority]}</span>
      <span className="task-kind">{kindNames[task.kind]}</span>
      {task.dueDate && (
        <time className={openTask(task) && task.dueDate < today() ? 'task-overdue' : ''}>
          {task.dueDate === today() ? '今日' : task.dueDate}
        </time>
      )}
    </div>
  );
}
export function RecordSelect({
  label,
  value,
  onChange,
  records,
  nameKey = 'name',
  empty = '指定なし',
}) {
  const [query, Q] = React.useState('');
  const shown = records
    .filter(
      (r) =>
        r.id === value ||
        [r[nameKey], r.code, r.location]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    )
    .slice(0, 100);
  if (value && !shown.some((r) => r.id === value)) {
    const current = records.find((r) => r.id === value);
    if (current) {
      shown.unshift(current);
    }
  }
  return (
    <label>
      {label}
      <input
        type="search"
        aria-label={label + 'を検索'}
        value={query}
        onChange={(e) => Q(e.target.value)}
        placeholder="名前・設備ID・場所で絞り込み"
      />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{empty}</option>
        {shown.map((r) => (
          <option key={r.id} value={r.id}>
            {r.code ? r.code + ' · ' : ''}
            {r[nameKey]}
          </option>
        ))}
      </select>
      {records.length > 100 && <small>検索で絞り込んで選択（最大100件表示）</small>}
    </label>
  );
}
export function ChecklistEditor({ value, onChange }) {
  const canonical = value.map((c) => c.text).join('\n');
  const [raw, T] = React.useState(canonical);
  useEffect(() => {
    if (
      raw
        .split('\n')
        .filter((x) => x.trim())
        .join('\n') !== canonical
    ) {
      T(canonical);
    }
  }, [canonical]);
  return (
    <>
      <div className="task-checklist">
        {value.map((c, i) => (
          <label key={c.id}>
            <input
              type="checkbox"
              checked={c.done === true}
              onChange={(e) =>
                onChange(
                  value.map((x, j) =>
                    j === i
                      ? {
                          ...x,
                          done: e.target.checked,
                        }
                      : x,
                  ),
                )
              }
            />
            <span>{c.text}</span>
          </label>
        ))}
      </div>
      <details>
        <summary>チェック項目を編集</summary>
        <textarea
          aria-label="チェック項目（1行に1項目）"
          value={raw}
          onChange={(e) => {
            T(e.target.value);
            onChange(
              e.target.value
                .split('\n')
                .filter((x) => x.trim())
                .map((text, i) =>
                  value[i]?.text === text
                    ? value[i]
                    : {
                        id: crypto.randomUUID(),
                        text,
                        done: false,
                      },
                ),
            );
          }}
        />
      </details>
    </>
  );
}
export const dependencyBlockers = (state, t) =>
  (t.dependsOnIds || [])
    .map((id) => state.tasks.find((t) => t.id === id))
    .filter((t) => t && t.status !== 'done');
export const projectStatusNames = {
  planning: '計画中',
  active: '進行中',
  on_hold: '保留',
  done: '完了',
  cancelled: '中止',
};
