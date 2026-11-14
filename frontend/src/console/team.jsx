import { TaskBoard, TaskList, TaskWeek } from './task-views.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { Projects } from './team-projects.jsx';
import { TaskDialog, useTaskEditor } from './team-task.jsx';
import { InspectionRecords } from './team-inspections.jsx';
import { Plans } from './team-plans.jsx';
import {
  api,
  today,
  addDays,
  statusNames,
  priorityNames,
  kindNames,
  openTask,
  compareTasks,
  assigneeName,
  Modal,
  Person,
  TaskBadges,
  writeFile,
  dependencyBlockers,
} from './team-shared.jsx';
const defaultView = {
  query: '',
  assignee: '',
  priority: '',
  status: 'open',
  range: '',
  layout: 'list',
  drawing: '',
  myMember: '',
  project: '',
  readiness: '',
  kind: '',
  sort: 'priority',
};
function useReport(state) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    api('/api/team/report')
      .then((r) => {
        if (current) {
          setReport(r);
          setError('');
        }
      })
      .catch((e) => {
        if (current) {
          setError(e.message);
        }
      });
    return () => {
      current = false;
    };
  }, [state]);
  return [report, error];
}
export function TeamWorkspace({ state, session, onRefresh, focusId, initialFocus }) {
  const [edit, setEdit, editorGuard] = useTaskEditor();
  const [tab, setTab] = useState(
    ['projects', 'plans', 'history', 'members', 'handover'].includes(
      new URL(location.href).searchParams.get('teamTab'),
    )
      ? new URL(location.href).searchParams.get('teamTab')
      : 'board',
  );
  const [view, setView] = useState(defaultView);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [week, setWeek] = useState(today());
  const [limit, setLimit] = useState(50);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [report, reportError] = useReport(state);
  const prefsQueue = useRef(Promise.resolve());
  useEffect(() => {
    const key = (e) => {
      if (
        document.querySelector('dialog[open]') ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      ) {
        return;
      }
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setEdit({});
      }
      if (e.key === '/') {
        e.preventDefault();
        document.querySelector('[aria-label="チームの作業を検索"]')?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  const saveView = (next) => {
    prefsQueue.current = prefsQueue.current
      .catch(() => {})
      .then(async () => {
        const p = await api('/api/preferences');
        await api('/api/preferences', {
          method: 'PUT',
          body: {
            ...p.preferences,
            teamBoard: next,
          },
        });
      })
      .catch((e) => setMessage(e.message));
  };
  useEffect(() => {
    let valid = true;
    api('/api/preferences')
      .then((r) => {
        if (!valid) {
          return;
        }
        const saved = {
          ...defaultView,
          ...r.preferences.teamBoard,
        };
        const linked = new URL(location.href).searchParams.get('project');
        if (linked && state.projects?.some((p) => p.id === linked)) {
          Object.assign(saved, {
            project: linked,
            status: 'open',
            range: '',
            readiness: '',
            assignee: '',
            kind: '',
            query: '',
          });
          setTab('board');
        }
        if (initialFocus) {
          setTab('board');
          saved.query = '';
          saved.range = ['overdue', 'unassigned'].includes(initialFocus) ? initialFocus : '';
          saved.status =
            initialFocus === 'waiting' ? 'waiting' : initialFocus === 'done' ? 'done' : 'open';
          saved.assignee = initialFocus.startsWith('member:') ? initialFocus.slice(7) : '';
          saved.kind = '';
          saved.project = '';
          saved.readiness = '';
          if (initialFocus === 'members') {
            setTab('members');
          }
          if (initialFocus === 'inspections') {
            setTab('history');
          }
        }
        setView(saved);
        setReady(true);
      })
      .catch((e) => setMessage(e.message));
    return () => {
      valid = false;
    };
  }, [session.profile, initialFocus]);
  useEffect(() => {
    if (!ready) {
      return;
    }
    const timer = setTimeout(() => saveView(view), 400);
    return () => clearTimeout(timer);
  }, [view, ready]);
  useEffect(() => {
    if (focusId) {
      const t = state.tasks.find((t) => t.id === focusId);
      if (t) {
        setEdit({
          record: t,
        });
      }
    }
  }, [focusId]);
  useEffect(() => {
    const url = new URL(location.href);
    const asset = url.searchParams.get('newTaskAsset');
    const work = url.searchParams.get('newTaskWork');
    const task = url.searchParams.get('task');
    if (asset || work) {
      const a = state.assets.find((a) => a.id === asset);
      const w = state.works.find((w) => w.id === work);
      setEdit({
        initial: {
          assetId: a?.id || '',
          workId: w?.id || '',
          drawingId: a?.drawingId || w?.drawingId || '',
          title: a ? a.name + 'の確認' : w ? w.title + 'の調整' : '',
        },
      });
    } else if (task) {
      const t = state.tasks.find((t) => t.id === task);
      if (t) {
        setEdit({
          record: t,
        });
      }
    }
    if (asset || work || task) {
      for (const k of ['newTaskAsset', 'newTaskWork', 'task']) {
        url.searchParams.delete(k);
      }
      history.replaceState(null, '', url);
    }
  }, []);
  const update = (patch) => {
    setView((v) => ({
      ...v,
      ...patch,
    }));
    setLimit(50);
    setSelected(new Set());
  };
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
  const filtered = state.tasks
    .filter((t) => {
      if (
        view.kind &&
        (view.kind === 'maintenance'
          ? !['inspection', 'repair'].includes(t.kind)
          : t.kind !== view.kind)
      ) {
        return false;
      }
      if (view.project && t.projectId !== view.project) {
        return false;
      }
      if (
        (view.readiness === 'blocked' && !dependencyBlockers(state, t).length) ||
        (view.readiness === 'ready' &&
          (dependencyBlockers(state, t).length || !openTask(t) || t.status === 'waiting'))
      ) {
        return false;
      }
      if (
        (view.status === 'open' && !openTask(t)) ||
        (view.status === 'only_open' && t.status !== 'open') ||
        (view.status &&
          view.status !== 'open' &&
          view.status !== 'only_open' &&
          view.status !== 'all' &&
          t.status !== view.status)
      ) {
        return false;
      }
      if (
        view.assignee &&
        (view.assignee === '__none' ? !!t.assigneeId : t.assigneeId !== view.assignee)
      ) {
        return false;
      }
      if (view.priority && t.priority !== view.priority) {
        return false;
      }
      if (view.drawing && t.drawingId !== view.drawing) {
        return false;
      }
      if (
        (view.range === 'overdue' && (!openTask(t) || !t.dueDate || t.dueDate >= today())) ||
        (view.range === 'today' && t.dueDate !== today()) ||
        (view.range === 'week' &&
          (!t.dueDate || t.dueDate < today() || t.dueDate > addDays(today(), 7))) ||
        (view.range === 'unassigned' && !!t.assigneeId) ||
        (view.range === 'unscheduled' && !!t.dueDate)
      ) {
        return false;
      }
      const a = state.assets.find((a) => a.id === t.assetId);
      const w = state.works.find((w) => w.id === t.workId);
      const text = [
        t.title,
        t.description,
        t.blocker,
        t.requestor,
        t.acceptanceCriteria,
        state.projects?.find((p) => p.id === t.projectId)?.name,
        a?.name,
        a?.code,
        w?.title,
        assigneeName(state, t.assigneeId),
      ]
        .join(' ')
        .normalize('NFKC')
        .toLocaleLowerCase();
      return view.query
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase()
        .split(/\s+/)
        .every((q) => text.includes(q));
    })
    .sort(
      view.sort === 'due'
        ? (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
        : view.sort === 'title'
          ? (a, b) => a.title.localeCompare(b.title, 'ja')
          : compareTasks,
    );
  const move = (task, status) => {
    if (busy || edit || task.inspectionId) {
      return;
    }
    if (status === task.status) {
      return;
    }
    if (status === 'waiting') {
      setEdit({
        record: {
          ...task,
          status: 'waiting',
        },
      });
      return;
    }
    if (status === 'done') {
      setEdit({
        record: task,
        complete: true,
      });
      return;
    }
    run(async () => {
      await api('/api/tasks/' + task.id, {
        method: 'PATCH',
        body: {
          revision: window.FactoryAPI.revision,
          record: {
            status,
          },
        },
      });
      await onRefresh();
    });
  };
  const bulk = (record) =>
    run(async () => {
      if (selected.size > 100) {
        throw new Error('一括変更は100件までです。');
      }
      await api('/api/batch', {
        method: 'POST',
        body: {
          revision: window.FactoryAPI.revision,
          operations: [...selected].map((id) => ({
            kind: 'tasks',
            id,
            method: 'PATCH',
            record,
          })),
        },
      });
      setSelected(new Set());
      await onRefresh();
      setMessage('選択した作業を更新しました。');
    });
  const exportCSV = () => {
    const rows = [
      [
        '作業名',
        '種類',
        '状態',
        '優先度',
        '担当者',
        '期限',
        '見積時間（分）',
        '対象設備',
        '手配待ちの理由',
      ],
      ...filtered.map((t) => [
        t.title,
        kindNames[t.kind],
        statusNames[t.status],
        priorityNames[t.priority],
        assigneeName(state, t.assigneeId),
        t.dueDate,
        t.estimatedMinutes,
        state.assets.find((a) => a.id === t.assetId)?.code || '',
        t.blocker,
      ]),
    ];
    writeFile(
      'チームの作業-' + today() + '.csv',
      '\uFEFF' +
        rows
          .map((row) =>
            row
              .map(
                (v) =>
                  '"' +
                  (/^[=+@-]/.test(String(v)) ? "'" : '') +
                  String(v ?? '').replaceAll('"', '""') +
                  '"',
              )
              .join(','),
          )
          .join('\r\n'),
      'text/csv;charset=utf-8',
    );
  };
  const open = (t) =>
    setEdit({
      record: t,
    });
  const patchTask = (t, record) =>
    run(async () => {
      await api('/api/tasks/' + t.id, {
        method: 'PATCH',
        body: {
          revision: window.FactoryAPI.revision,
          record,
        },
      });
      await onRefresh();
    });
  const quickAdd = (e) => {
    e.preventDefault();
    if (!quickTitle.trim() || busy || edit) {
      return;
    }
    if (view.kind === 'maintenance' || view.kind === 'inspection') {
      setEdit({
        initial: {
          title: quickTitle.trim(),
          kind: 'inspection',
        },
      });
      setQuickTitle('');
      return;
    }
    run(async () => {
      await api('/api/tasks', {
        method: 'POST',
        body: {
          revision: window.FactoryAPI.revision,
          record: {
            title: quickTitle.trim(),
            kind: ['task', 'inspection', 'repair', 'coordination'].includes(view.kind)
              ? view.kind
              : 'task',
            assigneeId: view.assignee && view.assignee !== '__none' ? view.assignee : '',
            projectId: view.project || '',
            dueDate: view.range === 'today' ? today() : '',
          },
        },
      });
      setQuickTitle('');
      update({
        status: 'open',
        range: '',
        query: '',
      });
      await onRefresh();
    });
  };
  const quickViews = [
    [
      '未完了',
      {
        status: 'open',
        range: '',
        kind: '',
        assignee: '',
      },
    ],
    [
      '今日',
      {
        status: 'open',
        range: 'today',
        kind: '',
        assignee: '',
      },
    ],
    [
      '期限超過',
      {
        status: 'open',
        range: 'overdue',
        kind: '',
        assignee: '',
      },
    ],
    [
      '担当未定',
      {
        status: 'open',
        range: 'unassigned',
        kind: '',
        assignee: '',
      },
    ],
    [
      '点検・保守',
      {
        status: 'open',
        range: '',
        kind: 'maintenance',
        assignee: '',
      },
    ],
    [
      '完了',
      {
        status: 'done',
        range: '',
        kind: '',
        assignee: '',
      },
    ],
  ];
  return (
    <div className={'task-workspace ' + (edit ? 'has-task-pane' : '')}>
      <div className="team-hero">
        <p className="work-page-purpose">
          担当・期限を決め、作業を進めます。点検・保守もここで管理します。
        </p>
        <button
          className="primary-product"
          onClick={() =>
            setEdit({
              initial: {
                kind: view.kind === 'maintenance' ? 'inspection' : view.kind || 'task',
              },
            })
          }
        >
          ＋ 仕事を登録
        </button>
      </div>
      <nav className="team-tabs" aria-label="チーム管理のメニュー">
        {[
          ['board', '作業一覧'],
          ['projects', '案件・改善'],
          ['plans', '点検計画'],
          ['history', '点検予定・履歴'],
          ['members', '担当者・負荷'],
          ['handover', '朝会・引き継ぎ'],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            className={tab === id ? 'selected' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {(message || reportError) && (
        <p className="team-error" role="status">
          {message || reportError}
        </p>
      )}
      {tab === 'board' && (
        <>
          <nav className="team-queue-tabs" aria-label="タスクのビュー">
            {quickViews.map(([label, patch]) => (
              <button
                key={label}
                aria-pressed={Object.entries(patch).every(([k, v]) => view[k] === v)}
                onClick={() =>
                  update({
                    ...patch,
                    project: '',
                    readiness: '',
                    priority: '',
                    drawing: '',
                    query: '',
                  })
                }
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => {
                if (view.myMember) {
                  update({
                    assignee: view.myMember,
                    status: 'open',
                    range: '',
                    project: '',
                    kind: '',
                  });
                } else {
                  setTab('members');
                  setMessage('担当者の「自分として表示」を選んでください。');
                }
              }}
            >
              自分の担当
            </button>
          </nav>
          <section className="product-card team-board-card">
            <div className="team-board-toolbar">
              <input
                aria-label="チームの作業を検索"
                placeholder="作業・設備・担当・引き継ぎ内容で検索"
                value={view.query}
                onChange={(e) =>
                  update({
                    query: e.target.value,
                  })
                }
              />
              <div className="team-layout-switch" aria-label="作業の表示形式">
                {[
                  ['board', 'ボード'],
                  ['list', '一覧'],
                  ['week', '週間予定'],
                ].map(([id, name]) => (
                  <button
                    key={id}
                    aria-pressed={view.layout === id}
                    onClick={() =>
                      update({
                        layout: id,
                      })
                    }
                  >
                    {name}
                  </button>
                ))}
              </div>
              <button onClick={exportCSV}>CSV保存</button>
              <button
                className="team-filter-toggle"
                aria-expanded={filtersExpanded}
                onClick={() => setFiltersExpanded((v) => !v)}
              >
                絞り込み {filtersExpanded ? '−' : '＋'}
              </button>
            </div>
            <div className="team-board-filters" hidden={!filtersExpanded}>
              <label>
                担当
                <select
                  aria-label="作業一覧の担当"
                  value={view.assignee}
                  onChange={(e) =>
                    update({
                      assignee: e.target.value,
                    })
                  }
                >
                  <option value="">全員</option>
                  <option value="__none">未割り当て</option>
                  {state.teamMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.active ? '' : '（休止）'}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                種類
                <select
                  aria-label="作業一覧の種類"
                  value={view.kind || ''}
                  onChange={(e) =>
                    update({
                      kind: e.target.value,
                    })
                  }
                >
                  <option value="">すべての種類</option>
                  <option value="maintenance">点検・保守</option>
                  {Object.entries(kindNames).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                状態
                <select
                  aria-label="作業一覧の状態"
                  value={view.status}
                  onChange={(e) =>
                    update({
                      status: e.target.value,
                    })
                  }
                >
                  <option value="open">未完了すべて</option>
                  <option value="all">すべて（完了・中止も含む）</option>
                  {Object.entries(statusNames).map(([id, name]) => (
                    <option key={id} value={id === 'open' ? 'only_open' : id}>
                      {id === 'open' ? '未着手のみ' : name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                優先度
                <select
                  aria-label="作業一覧の優先度"
                  value={view.priority}
                  onChange={(e) =>
                    update({
                      priority: e.target.value,
                    })
                  }
                >
                  <option value="">すべて</option>
                  {Object.entries(priorityNames).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                絞り込み
                <select
                  aria-label="作業一覧の期限条件"
                  value={view.range}
                  onChange={(e) =>
                    update({
                      range: e.target.value,
                    })
                  }
                >
                  <option value="">指定なし</option>
                  {Object.entries({
                    overdue: '期限超過',
                    today: '今日が期限',
                    week: '7日以内',
                    unassigned: '未割り当て',
                    unscheduled: '期限未設定',
                  }).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                案件
                <select
                  aria-label="作業一覧の案件"
                  value={view.project || ''}
                  onChange={(e) =>
                    update({
                      project: e.target.value,
                    })
                  }
                >
                  <option value="">すべての案件</option>
                  {state.projects?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                着手条件
                <select
                  aria-label="作業一覧の着手条件"
                  value={view.readiness || ''}
                  onChange={(e) =>
                    update({
                      readiness: e.target.value,
                    })
                  }
                >
                  <option value="">指定なし</option>
                  <option value="blocked">先行作業待ち</option>
                  <option value="ready">着手できる仕事</option>
                </select>
              </label>
              <label>
                図面
                <select
                  aria-label="作業一覧の図面"
                  value={view.drawing}
                  onChange={(e) =>
                    update({
                      drawing: e.target.value,
                    })
                  }
                >
                  <option value="">すべて</option>
                  {state.drawings.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => {
                  if (view.myMember) {
                    update({
                      assignee: view.myMember,
                      status: 'open',
                      range: '',
                    });
                  } else {
                    setTab('members');
                    setMessage(
                      '名簿の「自分として表示」を選ぶと、自分の担当へすぐ切り替えられます。',
                    );
                  }
                }}
              >
                自分の担当
              </button>
              <button
                onClick={() =>
                  update({
                    ...defaultView,
                    myMember: view.myMember,
                    layout: view.layout,
                  })
                }
              >
                条件をクリア
              </button>
            </div>
            <div className="work-list-meta">
              <span>
                {filtered.length}件{view.query && ' · 検索中'}
                {view.project &&
                  ' · ' + (state.projects.find((p) => p.id === view.project)?.name || '案件')}
              </span>
              <label>
                並び順
                <select
                  aria-label="タスクの並び順"
                  value={view.sort || 'priority'}
                  onChange={(e) =>
                    update({
                      sort: e.target.value,
                    })
                  }
                >
                  <option value="priority">期限超過・優先度</option>
                  <option value="due">期限が近い順</option>
                  <option value="title">タスク名順</option>
                </select>
              </label>
              <small>N：追加 /：検索{view.layout === 'board' ? ' · ドラッグで状態変更' : ''}</small>
            </div>
            {view.layout === 'board' && (
              <TaskBoard state={state} filtered={filtered} limit={limit} move={move} open={open} />
            )}
            {view.layout === 'list' && (
              <TaskList
                state={state}
                filtered={filtered}
                limit={limit}
                selected={selected}
                setSelected={setSelected}
                bulkAssignee={bulkAssignee}
                setBulkAssignee={setBulkAssignee}
                busy={busy}
                bulk={bulk}
                edit={edit}
                open={open}
                move={move}
                patchTask={patchTask}
                quickAdd={quickAdd}
                quickTitle={quickTitle}
                setQuickTitle={setQuickTitle}
              />
            )}
            {view.layout === 'week' && (
              <TaskWeek
                state={state}
                filtered={filtered}
                week={week}
                setWeek={setWeek}
                setEdit={setEdit}
                open={open}
              />
            )}
            {filtered.length > limit && view.layout !== 'week' && (
              <button className="team-load-more" onClick={() => setLimit(limit + 50)}>
                さらに50件表示
              </button>
            )}
            {!filtered.length && (
              <div className="team-empty">
                <strong>条件に合う作業はありません。</strong>
                <p>仕事を追加するか、表示条件を変えて確認してください。</p>
              </div>
            )}
          </section>
        </>
      )}
      {tab === 'projects' && (
        <Projects
          state={state}
          onRefresh={onRefresh}
          onShowTasks={(id) => {
            update({
              project: id,
              status: 'open',
              range: '',
              readiness: '',
              assignee: '',
              kind: '',
              query: '',
            });
            setTab('board');
          }}
          onNewTask={(initial) =>
            setEdit({
              initial,
            })
          }
        />
      )}
      {tab === 'history' && (
        <InspectionRecords
          state={state}
          onOpenTask={open}
          onNewTask={(initial) =>
            setEdit({
              initial,
            })
          }
        />
      )}
      {tab === 'plans' && <Plans state={state} onRefresh={onRefresh} onOpenTask={open} />}
      {tab === 'members' && (
        <Members
          state={state}
          report={report}
          onRefresh={onRefresh}
          myMember={view.myMember}
          onUse={(id) => {
            update({
              myMember: id,
              assignee: id,
              status: 'open',
              range: '',
            });
            setTab('board');
          }}
          onFilter={(id) => {
            update({
              assignee: id || '__none',
              status: 'open',
              range: '',
            });
            setTab('board');
          }}
        />
      )}
      {tab === 'handover' && <Handover />}
      {!state.tasks.length && !state.teamMembers.length && !state.inspectionPlans.length && (
        <section className="team-demo-banner">
          <div>
            <strong>チーム管理をサンプルで試す</strong>
            <p>架空の担当者4人・作業8件・点検計画1件を追加します。既存の設備と工事は保持します。</p>
          </div>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api('/api/team/demo', {
                  method: 'POST',
                  body: {
                    revision: window.FactoryAPI.revision,
                  },
                });
                await onRefresh();
                setMessage('サンプルの仕事を追加しました。');
              })
            }
          >
            サンプル作業を追加
          </button>
        </section>
      )}
      {edit && (
        <TaskDialog
          key={edit.editorKey}
          state={state}
          record={edit.record}
          initial={edit.initial}
          startComplete={edit.complete}
          guardRef={editorGuard}
          onClose={(force) => setEdit(null, force)}
          onRefresh={onRefresh}
          onOpenTask={(t) =>
            setEdit({
              record: t,
            })
          }
          onAddChild={(initial) =>
            setEdit({
              initial,
            })
          }
        />
      )}
    </div>
  );
}
function Members({ state, report, onRefresh, myMember, onUse, onFilter }) {
  const [edit, setEdit] = useState(null);
  const error = '';
  return (
    <>
      <div className="team-section-heading">
        <div>
          <h2>担当者・作業負荷</h2>
          <p>未完了の件数と見積時間です。実際の稼働時間ではありません。</p>
        </div>
        <button className="primary-product" onClick={() => setEdit({})}>
          ＋ 担当者を追加
        </button>
      </div>
      <p className="team-help">
        この名簿は作業の担当を決めるためのものです。SSOのアカウント追加・招待・権限変更は行いません。
      </p>
      <p className="team-error">{error}</p>
      <div className="team-member-grid">
        {[
          ...state.teamMembers,
          {
            id: '',
            name: '未割り当て',
            specialty: '担当者が設定されていない作業',
            color: '#87998e',
            active: true,
          },
        ].map((m) => {
          const load = report?.loads.find((x) => x.id === m.id);
          return (
            <article className="team-member-card" key={m.id || 'none'}>
              <div className="team-member-title">
                <i
                  style={{
                    background: m.color,
                  }}
                >
                  {m.name.slice(0, 1)}
                </i>
                <div>
                  <h3>{m.name}</h3>
                  <small>
                    {m.active ? '' : '休止中 · '}
                    {m.specialty}
                  </small>
                </div>
              </div>
              <div className="team-member-metrics">
                <span>
                  <strong>{load?.count || 0}</strong>件
                </span>
                <span>
                  <strong>{load?.minutes || 0}</strong>分
                </span>
                <span className={load?.overdue ? 'task-overdue' : ''}>
                  超過 {load?.overdue || 0}件
                </span>
              </div>
              {m.contact && <p>{m.contact}</p>}
              <div className="product-actions">
                <button onClick={() => onFilter(m.id)}>担当の仕事を見る</button>
                {m.id && (
                  <>
                    <button onClick={() => setEdit(m)}>編集</button>
                    <button aria-pressed={myMember === m.id} onClick={() => onUse(m.id)}>
                      {myMember === m.id ? '自分として表示中' : '自分として表示'}
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {edit && (
        <MemberDialog
          record={edit.id ? edit : null}
          onRefresh={onRefresh}
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}
function MemberDialog({ record, onRefresh, onClose }) {
  const [draft, setDraft] = useState({
    ...{
      name: '',
      specialty: '',
      contact: '',
      active: true,
      color: '#287f91',
    },
    ...record,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(window.FactoryAPI.revision);
  const set = (k, v) =>
    setDraft((d) => ({
      ...d,
      [k]: v,
    }));
  return (
    <Modal
      title={record ? '担当者を編集' : '担当者を追加'}
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <div className="team-plan-fields">
        <label>
          担当者名
          <input
            aria-label="担当者名"
            value={draft.name}
            maxLength="80"
            onChange={(e) => set('name', e.target.value)}
          />
        </label>
        <label>
          専門・役割
          <input
            aria-label="担当者の専門"
            value={draft.specialty}
            maxLength="150"
            onChange={(e) => set('specialty', e.target.value)}
          />
        </label>
        <label>
          内線・連絡メモ
          <input
            aria-label="担当者の連絡先"
            value={draft.contact}
            maxLength="150"
            onChange={(e) => set('contact', e.target.value)}
          />
        </label>
        <label>
          表示色
          <input
            aria-label="担当者の色"
            type="color"
            value={draft.color}
            onChange={(e) => set('color', e.target.value)}
          />
        </label>
        <label className="team-checkbox">
          <input
            type="checkbox"
            aria-label="担当者を有効にする"
            checked={draft.active}
            onChange={(e) => set('active', e.target.checked)}
          />
          割り当て候補に表示する
        </label>
        <p className="team-help">休止しても、過去の担当や進行中の作業は保持します。</p>
      </div>
      <p className="team-error" role="alert">
        {error}
      </p>
      <button
        className="primary-product"
        disabled={busy || !draft.name.trim()}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await api('/api/teamMembers' + (record ? '/' + record.id : ''), {
              method: record ? 'PATCH' : 'POST',
              body: {
                revision: revision.current,
                record: Object.fromEntries(
                  ['name', 'specialty', 'contact', 'active', 'color'].map((k) => [k, draft[k]]),
                ),
              },
            });
            await onRefresh();
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        担当者を保存
      </button>
    </Modal>
  );
}
function Handover() {
  const [day, setDay] = useState(today());
  const [report, setReport] = useState(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    if (day) {
      api('/api/team/report?date=' + day)
        .then((r) => {
          if (live) {
            setReport(r);
          }
        })
        .catch((e) => {
          if (live) {
            setMessage(e.message);
          }
        });
    }
    return () => {
      live = false;
    };
  }, [day]);
  return (
    <section className="product-card team-handover">
      <div className="team-section-heading">
        <div>
          <h2>引き継ぎレポート</h2>
          <p>期限超過・手配待ち・未割り当て・直近の完了と引き継ぎコメントをまとめます。</p>
        </div>
        <input
          aria-label="引き継ぎの基準日"
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
      </div>
      <p className="team-error" role="status">
        {message}
      </p>
      {report && (
        <>
          <div className="product-actions">
            <button
              className="primary-product"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(report.markdown);
                  setMessage('引き継ぎ内容をコピーしました。');
                } catch {
                  setMessage(
                    'コピーできませんでした。本文を選択するか、ファイルを保存してください。',
                  );
                }
              }}
            >
              引き継ぎ内容をコピー
            </button>
            <button
              onClick={() => writeFile('施設グループ引き継ぎ-' + day + '.md', report.markdown)}
            >
              引き継ぎファイルを保存
            </button>
            <button
              onClick={() =>
                api('/api/team/report?date=' + day)
                  .then(setReport)
                  .catch((e) => setMessage(e.message))
              }
            >
              最新の情報に更新
            </button>
          </div>
          <textarea aria-label="引き継ぎレポート" readOnly value={report.markdown} />
          <p className="team-help">
            送信は行いません。コピーした内容を、朝会や普段使っているチャットで共有できます。基準日は期限判定と完了期間に使用し、過去時点の状態を復元するものではありません。
          </p>
        </>
      )}
    </section>
  );
}
