import React from 'react';
import {
  today,
  addDays,
  openTask,
  statusNames,
  priorityNames,
  kindNames,
  Person,
  TaskBadges,
  dependencyBlockers,
} from './team-shared.jsx';

export function TaskBoard({ state, filtered, limit, move, open }) {
  return (
    <div className="team-kanban">
      {Object.keys(statusNames)
        .filter((s) => s !== 'cancelled' || filtered.some((t) => t.status === s))
        .map((status) => (
          <section
            className={'team-kanban-column ' + status}
            key={status}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              const t = state.tasks.find((t) => t.id === e.dataTransfer.getData('text/plain'));
              if (t) {
                move(t, status);
              }
            }}
          >
            <div className="team-column-heading">
              <h3>{statusNames[status]}</h3>
              <span>{filtered.filter((t) => t.status === status).length}</span>
            </div>
            {filtered
              .filter((t) => t.status === status)
              .slice(0, limit)
              .map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  state={state}
                  onOpen={() => open(t)}
                  onMove={(status) => move(t, status)}
                />
              ))}
            {!filtered.some((t) => t.status === status) && (
              <p className="team-column-empty">ここに作業を置けます</p>
            )}
          </section>
        ))}
    </div>
  );
}

export function TaskList({
  state,
  filtered,
  limit,
  selected,
  setSelected,
  bulkAssignee,
  setBulkAssignee,
  busy,
  bulk,
  edit,
  open,
  move,
  patchTask,
  quickAdd,
  quickTitle,
  setQuickTitle,
}) {
  return (
    <>
      {selected.size > 0 && (
        <div className="register-bulk">
          <strong>{selected.size}件を選択</strong>
          <select
            aria-label="一括変更する担当者"
            value={bulkAssignee}
            onChange={(e) => setBulkAssignee(e.target.value)}
          >
            <option value="">未割り当て</option>
            {state.teamMembers
              .filter((m) => m.active)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
          <button
            disabled={busy}
            onClick={() =>
              bulk({
                assigneeId: bulkAssignee,
              })
            }
          >
            担当を変更
          </button>
          <button
            disabled={busy}
            onClick={() =>
              bulk({
                priority: 'high',
              })
            }
          >
            優先度を高に
          </button>
          <button
            disabled={busy}
            onClick={() =>
              bulk({
                dueDate: addDays(today(), 1),
              })
            }
          >
            期限を明日に
          </button>
          <button onClick={() => setSelected(new Set())}>選択解除</button>
        </div>
      )}
      <div className="table-scroll">
        <table className="team-task-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="表示中の作業を選択"
                  checked={
                    !!filtered.slice(0, limit).length &&
                    filtered.slice(0, limit).every((t) => selected.has(t.id))
                  }
                  onChange={(e) => {
                    const next = new Set(selected);
                    for (const t of filtered.slice(0, limit)) {
                      if (e.target.checked) {
                        next.add(t.id);
                      } else {
                        next.delete(t.id);
                      }
                    }
                    setSelected(next);
                  }}
                />
              </th>
              <th>作業・設備</th>
              <th>状態</th>
              <th>担当者</th>
              <th>期限</th>
              <th>優先度</th>
              <th>見積</th>
              <th>確認</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((t) => (
              <tr key={t.id} data-task-row={t.id} aria-selected={edit?.record?.id === t.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={t.title + 'を選択'}
                    checked={selected.has(t.id)}
                    onChange={(e) => {
                      const n = new Set(selected);
                      if (e.target.checked) {
                        n.add(t.id);
                      } else {
                        n.delete(t.id);
                      }
                      setSelected(n);
                    }}
                  />
                </td>
                <td>
                  <div className="task-list-name">
                    <button
                      className={'task-complete-circle ' + (t.status === 'done' ? 'is-done' : '')}
                      aria-label={t.title + 'を完了'}
                      disabled={busy || !!edit || !openTask(t) || !!t.inspectionId}
                      onClick={() => move(t, 'done')}
                    >
                      {t.status === 'done' ? '✓' : '○'}
                    </button>
                    <div>
                      <button className="task-title-button" onClick={() => open(t)}>
                        {t.title}
                      </button>
                      <small>
                        {kindNames[t.kind]}
                        {t.assetId
                          ? ' · ' + (state.assets.find((a) => a.id === t.assetId)?.code || '')
                          : ''}
                      </small>
                    </div>
                  </div>
                </td>
                <td>
                  <select
                    aria-label={t.title + 'の状態'}
                    value={t.status}
                    disabled={busy || !!edit || !!t.inspectionId}
                    onChange={(e) => move(t, e.target.value)}
                  >
                    {Object.entries(statusNames).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="task-inline-person"
                    aria-label={t.title + 'の担当者'}
                    value={t.assigneeId}
                    disabled={busy || !!edit || !!t.inspectionId}
                    onChange={(e) =>
                      patchTask(t, {
                        assigneeId: e.target.value,
                      })
                    }
                  >
                    <option value="">未割り当て</option>
                    {state.teamMembers
                      .filter((m) => m.active || m.id === t.assigneeId)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </td>
                <td>
                  <input
                    className={
                      openTask(t) && t.dueDate && t.dueDate < today() ? 'task-overdue' : ''
                    }
                    type="date"
                    aria-label={t.title + 'の期限'}
                    value={t.dueDate || ''}
                    disabled={busy || !!edit || !!t.inspectionId}
                    onChange={(e) =>
                      patchTask(t, {
                        dueDate: e.target.value,
                      })
                    }
                  />
                </td>
                <td>
                  <select
                    aria-label={t.title + 'の優先度'}
                    value={t.priority}
                    disabled={busy || !!edit || !!t.inspectionId}
                    onChange={(e) =>
                      patchTask(t, {
                        priority: e.target.value,
                      })
                    }
                  >
                    {Object.entries(priorityNames).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{t.estimatedMinutes}分</td>
                <td>
                  {t.checklist.filter((c) => c.done).length}/{t.checklist.length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="task-quick-add" onSubmit={quickAdd}>
        <span aria-hidden="true">＋</span>
        <input
          aria-label="タスクをすばやく追加"
          placeholder="タスク名を入力して Enter で追加"
          maxLength="150"
          value={quickTitle}
          disabled={busy || !!edit}
          onChange={(e) => setQuickTitle(e.target.value)}
        />
        <button disabled={busy || !!edit || !quickTitle.trim()}>追加</button>
      </form>
    </>
  );
}

export function TaskWeek({ state, filtered, week, setWeek, setEdit, open }) {
  return (
    <>
      <div className="team-week-toolbar">
        <button onClick={() => setWeek(addDays(week, -7))}>前の7日</button>
        <input
          aria-label="週間予定の開始日"
          type="date"
          value={week}
          onChange={(e) => {
            if (e.target.value) {
              setWeek(e.target.value);
            }
          }}
        />
        <button onClick={() => setWeek(today())}>今日から</button>
        <button onClick={() => setWeek(addDays(week, 7))}>次の7日</button>
      </div>
      {filtered.some((t) => !t.dueDate || t.dueDate < week) && (
        <p className="team-help">期限未設定・表示期間より前の作業は「一覧」から確認できます。</p>
      )}
      <div className="team-week-grid">
        {Array.from(
          {
            length: 7,
          },
          (_, i) => addDays(week, i),
        ).map((day) => (
          <section key={day}>
            <div className="team-column-heading">
              <h3>
                {day.slice(5)}{' '}
                <small>
                  {new Date(day + 'T12:00:00Z').toLocaleDateString('ja-JP', {
                    weekday: 'short',
                    timeZone: 'Asia/Tokyo',
                  })}
                </small>
              </h3>
              <button
                aria-label={day + 'の仕事を追加'}
                onClick={() =>
                  setEdit({
                    initial: {
                      dueDate: day,
                    },
                  })
                }
              >
                ＋
              </button>
            </div>
            {filtered
              .filter((t) => t.dueDate === day)
              .slice(0, 40)
              .map((t) => (
                <TaskCard key={t.id} task={t} state={state} onOpen={() => open(t)} />
              ))}
          </section>
        ))}
      </div>
    </>
  );
}

function TaskCard({ task: t, state, onOpen, onMove }) {
  const a = state.assets.find((a) => a.id === t.assetId);
  return (
    <article
      data-task-card={t.id}
      className={'team-task-card priority-' + t.priority}
      draggable={!t.inspectionId}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
    >
      <TaskBadges task={t} />
      <button className="task-title-button" onClick={onOpen}>
        {t.title}
      </button>
      {a && (
        <small className="task-asset-code">
          {a.code} · {a.location}
        </small>
      )}
      {state.projects?.find((p) => p.id === t.projectId) && (
        <small className="task-project-label">
          {state.projects.find((p) => p.id === t.projectId).name}
        </small>
      )}
      {t.parentId && (
        <small className="task-parent-label">
          ↳ {state.tasks.find((p) => p.id === t.parentId)?.title}
        </small>
      )}
      {dependencyBlockers(state, t).length > 0 && (
        <p className="task-dependency-badge">
          先行作業 {dependencyBlockers(state, t).length}件の完了待ち
        </p>
      )}
      {t.status === 'waiting' && <p className="task-blocker">{t.blocker}</p>}
      <Person state={state} id={t.assigneeId} />
      <div className="task-card-footer">
        <small>
          {t.estimatedMinutes}分
          {t.checklist.length
            ? ' · ✓ ' + t.checklist.filter((c) => c.done).length + '/' + t.checklist.length
            : ''}
          {t.attachments.length ? ' · 添付 ' + t.attachments.length : ''}
        </small>
        {onMove && t.status === 'open' && (
          <button aria-label={t.title + 'を開始'} onClick={() => onMove('in_progress')}>
            開始 →
          </button>
        )}
        {onMove && t.status === 'in_progress' && (
          <button aria-label={t.title + 'を完了'} onClick={() => onMove('done')}>
            完了 ✓
          </button>
        )}
      </div>
    </article>
  );
}
