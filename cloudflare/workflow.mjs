import { ApiError } from './core.mjs';
export const PROJECT_STATUS = {
  planning: '計画中',
  active: '進行中',
  on_hold: '保留',
  done: '完了',
  cancelled: '中止',
};
const open = (t) => !['done', 'cancelled'].includes(t.status);
const text = (v, n, required = false) =>
  typeof v === 'string' && v.length <= n && (!required || !!v.trim());
const date = (v) =>
  typeof v === 'string' &&
  /^\d{4}-\d\d-\d\d$/.test(v) &&
  Number.isFinite(Date.parse(v + 'T00:00:00Z')) &&
  new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const fail = (message) => {
  throw new ApiError(422, message);
};
export function makeProject(input, previous = null) {
  const defaults = {
    name: '',
    description: '',
    goal: '',
    status: 'planning',
    ownerId: '',
    startDate: '',
    dueDate: '',
    color: '#287f91',
  };
  if (Object.keys(input).some((k) => !Object.hasOwn(defaults, k) && k !== 'id')) {
    fail('案件の未定義項目は変更できません。');
  }
  const when = new Date().toISOString();
  return {
    ...defaults,
    ...previous,
    ...input,
    id: previous?.id || input.id || crypto.randomUUID(),
    createdAt: previous?.createdAt || when,
    updatedAt: when,
  };
}
export function taskBlockers(state, task) {
  return {
    dependencies: (task.dependsOnIds || [])
      .map((id) => state.tasks.find((t) => t.id === id))
      .filter((t) => t && t.status !== 'done'),
    children: state.tasks.filter((t) => t.parentId === task.id && open(t)),
  };
}
export function projectStats(
  state,
  id,
  today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()),
) {
  const tasks = state.tasks.filter((t) => t.projectId === id);
  const active = tasks.filter((t) => t.status !== 'cancelled');
  const done = active.filter((t) => t.status === 'done');
  const pending = active.filter(open);
  return {
    total: active.length,
    done: done.length,
    open: pending.length,
    progress: active.length ? Math.round((done.length / active.length) * 100) : 0,
    overdue: pending.filter((t) => t.dueDate && t.dueDate < today).length,
    blocked: pending.filter((t) => taskBlockers(state, t).dependencies.length).length,
    minutes: pending.reduce((n, t) => n + t.estimatedMinutes, 0),
  };
}
export function validateWorkflow(state) {
  const projects = state.projects || [];
  const tasks = state.tasks;
  const members = new Set(state.teamMembers.map((m) => m.id));
  const projectIds = new Set(projects.map((p) => p.id));
  const taskIds = new Set(tasks.map((t) => t.id));
  if (projects.length > 200) {
    fail('案件は200件までです。');
  }
  for (const p of projects) {
    if (
      !text(p.name, 150, true) ||
      !text(p.description, 5000) ||
      !text(p.goal, 2000) ||
      !Object.hasOwn(PROJECT_STATUS, p.status) ||
      !text(p.ownerId, 100) ||
      (p.ownerId && !members.has(p.ownerId)) ||
      !text(p.startDate, 10) ||
      (p.startDate && !date(p.startDate)) ||
      !text(p.dueDate, 10) ||
      (p.dueDate && !date(p.dueDate)) ||
      (p.startDate && p.dueDate && p.startDate > p.dueDate) ||
      !/^#[a-f\d]{6}$/i.test(p.color)
    ) {
      fail('案件の名前・責任者・期間・完了条件を確認してください。');
    }
    if (p.status === 'done' && tasks.some((t) => t.projectId === p.id && open(t))) {
      fail('未完了の作業が残っている案件は完了にできません。');
    }
  }
  for (const t of tasks) {
    if (
      !text(t.projectId, 100) ||
      (t.projectId && !projectIds.has(t.projectId)) ||
      !text(t.parentId, 100) ||
      (t.parentId && !taskIds.has(t.parentId)) ||
      t.parentId === t.id ||
      !Array.isArray(t.dependsOnIds) ||
      t.dependsOnIds.length > 50 ||
      new Set(t.dependsOnIds).size !== t.dependsOnIds.length ||
      t.dependsOnIds.some((id) => typeof id !== 'string' || !taskIds.has(id) || id === t.id) ||
      !text(t.startDate, 10) ||
      (t.startDate && !date(t.startDate)) ||
      (t.startDate && t.dueDate && t.startDate > t.dueDate) ||
      !text(t.requestor, 150) ||
      !text(t.acceptanceCriteria, 2000) ||
      typeof t.acceptanceConfirmed !== 'boolean'
    ) {
      fail('作業の案件・親作業・先行作業・期間・完了条件を確認してください。');
    }
    const parent = tasks.find((p) => p.id === t.parentId);
    if (parent && parent.projectId !== t.projectId) {
      fail('親作業と子作業は同じ案件に所属させてください。');
    }
  }
  const visited = new Set();
  const stack = new Set();
  function visit(id, depth = 0) {
    if (stack.has(id)) {
      fail('親子作業・先行作業の関係が循環しています。');
    }
    if (depth > 100) {
      fail('作業の関係が深すぎます。');
    }
    if (visited.has(id)) {
      return;
    }
    stack.add(id);
    const t = tasks.find((t) => t.id === id);
    for (const next of [
      ...t.dependsOnIds,
      ...tasks.filter((t) => t.parentId === id).map((t) => t.id),
    ]) {
      visit(next, depth + 1);
    }
    stack.delete(id);
    visited.add(id);
  }
  for (const t of tasks) {
    visit(t.id);
  }
  for (const t of tasks) {
    const blocked = taskBlockers(state, t);
    if (['in_progress', 'done'].includes(t.status) && blocked.dependencies.length) {
      fail(
        '先行作業「' + blocked.dependencies[0].title + '」が完了してから開始・完了してください。',
      );
    }
    if (t.status === 'done' && blocked.children.length) {
      fail('子作業を完了・中止してから親作業を完了してください。');
    }
    if (t.status === 'done' && t.acceptanceCriteria.trim() && !t.acceptanceConfirmed) {
      fail('完了条件を確認してから作業を完了してください。');
    }
  }
  return state;
}
