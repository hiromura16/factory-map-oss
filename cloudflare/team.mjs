import { ApiError } from './core.mjs';
import { validateWorkflow, taskBlockers } from './workflow.mjs';
export const TEAM_COLLECTIONS = ['tasks', 'teamMembers', 'inspectionPlans', 'projects'];
export const STATUS = {
  open: '未着手',
  in_progress: '進行中',
  waiting: '確認・手配待ち',
  done: '完了',
  cancelled: '中止',
};
export const PRIORITY = {
  urgent: '最優先',
  high: '高',
  normal: '通常',
  low: '低',
};
export const teamToday = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const validDate = (x) =>
  typeof x === 'string' &&
  /^\d{4}-\d\d-\d\d$/.test(x) &&
  Number.isFinite(Date.parse(x + 'T00:00:00Z')) &&
  new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) === x;
export const addDays = (value, days) => {
  const d = new Date(value + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const isOpen = (t) => !['done', 'cancelled'].includes(t.status);
export function ensureTeam(s) {
  for (const k of TEAM_COLLECTIONS) {
    s[k] ??= [];
  }
  for (const t of s.tasks) {
    for (const [k, v] of Object.entries({
      projectId: '',
      parentId: '',
      dependsOnIds: [],
      startDate: '',
      requestor: '',
      acceptanceCriteria: '',
      acceptanceConfirmed: false,
    })) {
      if (t[k] === undefined) {
        t[k] = structuredClone(v);
      }
    }
  }
  return s;
}
const fail = (m) => {
  throw new ApiError(422, m);
};
const text = (x, n, required = false) =>
  typeof x === 'string' && x.length <= n && (!required || !!x.trim());
export function validateTeam(s, previous) {
  ensureTeam(s);
  if (s.tasks.length > 2000 || s.teamMembers.length > 100 || s.inspectionPlans.length > 100) {
    fail('作業は2,000件、担当者と点検計画は各100件までです。');
  }
  const members = new Set(s.teamMembers.map((m) => m.id));
  const assets = new Set(s.assets.map((a) => a.id));
  const works = new Set(s.works.map((w) => w.id));
  const drawings = new Set(s.drawings.map((d) => d.id));
  const checklist = (items, task) =>
    Array.isArray(items) &&
    items.length <= 50 &&
    new Set(items.map((c) => c?.id)).size === items.length &&
    items.every(
      (c) =>
        c &&
        text(c.id, 100, true) &&
        text(c.text, 300, true) &&
        (!task || typeof c.done === 'boolean'),
    );
  for (const m of s.teamMembers) {
    if (
      !text(m.name, 80, true) ||
      !text(m.specialty, 150) ||
      !text(m.contact, 150) ||
      !/^#[\da-f]{6}$/i.test(m.color) ||
      typeof m.active !== 'boolean'
    ) {
      fail('担当者の名前・専門・連絡先・色を確認してください。');
    }
  }
  const origins = new Set();
  for (const t of s.tasks) {
    if (
      !text(t.title, 150, true) ||
      !text(t.description, 5000) ||
      !Object.hasOwn(STATUS, t.status) ||
      !Object.hasOwn(PRIORITY, t.priority) ||
      !['task', 'inspection', 'repair', 'coordination'].includes(t.kind) ||
      (t.dueDate && !validDate(t.dueDate)) ||
      !text(t.dueDate, 10) ||
      !text(t.assigneeId, 100) ||
      (t.assigneeId && !members.has(t.assigneeId)) ||
      !text(t.assetId, 100) ||
      (t.assetId && !assets.has(t.assetId)) ||
      !text(t.workId, 100) ||
      (t.workId && !works.has(t.workId)) ||
      !text(t.drawingId, 100) ||
      (t.drawingId && !drawings.has(t.drawingId)) ||
      !Number.isInteger(t.estimatedMinutes) ||
      t.estimatedMinutes < 0 ||
      t.estimatedMinutes > 10080 ||
      !checklist(t.checklist, true) ||
      !Array.isArray(t.attachments) ||
      t.attachments.length > 20 ||
      t.attachments.some(
        (f) =>
          !f ||
          typeof f !== 'object' ||
          typeof (f.fileId || f.id) !== 'string' ||
          !text(f.name, 180, true),
      ) ||
      !text(t.blocker, 1000)
    ) {
      fail('作業の名前・状態・期限・担当・関連先・チェックリストを確認してください。');
    }
    if (t.kind === 'inspection' && !t.assetId) {
      fail('点検作業には対象設備が必要です。');
    }
    if (t.status === 'waiting' && !t.blocker.trim()) {
      fail('手配待ちの理由・次に必要なことを記入してください。');
    }
    if (t.status === 'done' && t.checklist.some((c) => !c.done)) {
      fail('未確認のチェック項目があります。');
    }
    if (
      t.kind === 'inspection' &&
      t.status === 'done' &&
      !s.assets
        .find((a) => a.id === t.assetId)
        ?.history.some((h) => h.id === t.inspectionId && h.taskId === t.id)
    ) {
      fail('点検作業は「点検結果を記録して完了」から完了してください。');
    }
    if (t.inspectionId) {
      const old = previous?.tasks?.find((x) => x.id === t.id);
      if (t.status !== 'done' || (old?.inspectionId && old.inspectionId !== t.inspectionId)) {
        fail('点検記録済みの作業は完了状態を保持してください。');
      }
    }
    if (t.origin) {
      if (!text(t.origin.planId, 100, true) || !validDate(t.origin.cycleDate)) {
        fail('点検計画の起票情報が不正です。');
      }
      const key = JSON.stringify([t.origin.planId, t.origin.cycleDate, t.assetId]);
      if (origins.has(key)) {
        fail('同じ点検計画・予定日・設備の作業が重複しています。');
      }
      origins.add(key);
    }
  }
  for (const p of s.inspectionPlans) {
    if (
      !text(p.name, 150, true) ||
      !Array.isArray(p.assetIds) ||
      !p.assetIds.length ||
      p.assetIds.length > 500 ||
      new Set(p.assetIds).size !== p.assetIds.length ||
      p.assetIds.some((id) => !assets.has(id)) ||
      !validDate(p.nextDue) ||
      !Number.isInteger(p.intervalDays) ||
      p.intervalDays < 1 ||
      p.intervalDays > 730 ||
      !text(p.assigneeId, 100) ||
      (p.assigneeId && !members.has(p.assigneeId)) ||
      !checklist(p.checklist, false) ||
      typeof p.active !== 'boolean' ||
      !Object.hasOwn(PRIORITY, p.priority) ||
      !Number.isInteger(p.estimatedMinutes) ||
      p.estimatedMinutes < 0 ||
      p.estimatedMinutes > 10080 ||
      !text(p.description, 5000)
    ) {
      fail('点検計画の対象設備・周期・次回日・担当・チェックリストを確認してください。');
    }
  }
  validateWorkflow(s);
  return s;
}
export function makeTask(input, previous = null) {
  const defaults = {
    title: '',
    description: '',
    kind: 'task',
    status: 'open',
    priority: 'normal',
    dueDate: '',
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
  };
  const allowed = Object.keys(defaults);
  if (Object.keys(input).some((k) => !allowed.includes(k) && k !== 'id')) {
    throw new ApiError(422, '作業の未定義項目、またはサーバー管理項目は変更できません。');
  }
  const record = {
    ...defaults,
    ...previous,
    ...input,
    id: previous?.id || input.id || crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
  };
  if (!previous) {
    record.createdAt = record.updatedAt;
  }
  if (record.status === 'done' && !previous?.completedAt) {
    record.completedAt = record.updatedAt;
  } else if (record.status !== 'done') {
    delete record.completedAt;
  }
  return record;
}
export function planPreview(state, plan, today = teamToday()) {
  if (!plan.active) {
    throw new ApiError(409, '休止中の点検計画です。');
  }
  const cycleDate = plan.nextDue;
  const items = plan.assetIds
    .map((id) => state.assets.find((a) => a.id === id))
    .filter(Boolean)
    .map((a) => ({
      assetId: a.id,
      code: a.code,
      name: a.name,
      exists: state.tasks.some(
        (t) =>
          t.origin?.planId === plan.id && t.origin?.cycleDate === cycleDate && t.assetId === a.id,
      ),
    }));
  let nextDue = addDays(cycleDate, plan.intervalDays);
  if (nextDue <= today) {
    const elapsed = Math.floor((Date.parse(today) - Date.parse(cycleDate)) / 86400000);
    nextDue = addDays(cycleDate, (Math.floor(elapsed / plan.intervalDays) + 1) * plan.intervalDays);
  }
  return {
    planId: plan.id,
    cycleDate,
    nextDue,
    items,
    created: items.filter((x) => !x.exists).length,
    skipped: items.filter((x) => x.exists).length,
  };
}
export function generatePlan(state, plan, cycleDate) {
  const preview = planPreview(state, plan);
  if (cycleDate !== preview.cycleDate) {
    throw new ApiError(409, '点検計画が更新されています。内容を確認し直してください。');
  }
  for (const item of preview.items.filter((x) => !x.exists)) {
    const a = state.assets.find((a) => a.id === item.assetId);
    const t = makeTask({
      title: plan.name + ' · ' + a.name,
      description: plan.description,
      kind: 'inspection',
      assetId: a.id,
      drawingId: a.drawingId,
      dueDate: preview.cycleDate,
      assigneeId: plan.assigneeId,
      priority: plan.priority,
      estimatedMinutes: plan.estimatedMinutes,
      checklist: plan.checklist.map((c) => ({
        ...c,
        done: false,
      })),
    });
    t.origin = {
      planId: plan.id,
      planName: plan.name,
      cycleDate: preview.cycleDate,
    };
    state.tasks.push(t);
  }
  plan.nextDue = preview.nextDue;
  plan.updatedAt = new Date().toISOString();
  return preview;
}
export function completeTask(state, id, input, actor) {
  const t = state.tasks.find((t) => t.id === id);
  if (!t) {
    throw new ApiError(404, '作業がありません。');
  }
  if (!isOpen(t)) {
    throw new ApiError(409, 'この作業はすでに完了・中止しています。');
  }
  const blockers = taskBlockers(state, t);
  if (blockers.dependencies.length || blockers.children.length) {
    throw new ApiError(422, '先行作業・子作業が完了していません。');
  }
  if (t.acceptanceCriteria?.trim() && !t.acceptanceConfirmed) {
    throw new ApiError(422, '完了条件を確認してください。');
  }
  if (input.checklist !== undefined) {
    if (
      !Array.isArray(input.checklist) ||
      input.checklist.length !== t.checklist.length ||
      new Set(input.checklist.map((c) => c.id)).size !== t.checklist.length ||
      input.checklist.some(
        (c) => !t.checklist.some((x) => x.id === c.id) || typeof c.done !== 'boolean',
      )
    ) {
      fail('チェック項目が更新されています。再読み込みしてください。');
    }
    t.checklist = t.checklist.map((c) => ({
      ...c,
      done: input.checklist.find((x) => x.id === c.id).done,
    }));
  }
  if (t.checklist.some((c) => !c.done)) {
    throw new ApiError(422, 'チェックリストをすべて確認してから完了してください。');
  }
  if (t.kind === 'inspection') {
    if (
      !['normal', 'attention', 'repaired'].includes(input.result) ||
      !validDate(input.date) ||
      !text(input.text, 5000, true) ||
      (input.nextDate && !validDate(input.nextDate))
    ) {
      fail('点検日・結果・内容・次回点検日を確認してください。');
    }
    if (input.date > teamToday()) {
      fail('点検実施日に未来の日付は指定できません。');
    }
    if (input.nextDate && input.nextDate <= input.date) {
      fail('次回点検日は実施日より後にしてください。');
    }
    const a = state.assets.find((a) => a.id === t.assetId);
    const historyId = crypto.randomUUID();
    t.completionOptions = {
      updateNextDate: input.updateNextDate === true,
      createFollowup: input.createFollowup === true,
      followupDueDate: input.followupDueDate || '',
    };
    a.history.unshift({
      id: historyId,
      taskId: t.id,
      date: input.date,
      text: input.text,
      kind: t.origin?.planName || '作業ボードからの点検',
      result: input.result,
      inspector:
        typeof input.inspector === 'string' && input.inspector.trim()
          ? input.inspector.trim().slice(0, 100)
          : state.teamMembers.find((m) => m.id === t.assigneeId)?.name || actor,
      nextDate: input.nextDate || '',
      checklist: structuredClone(t.checklist),
      attachments: structuredClone(t.attachments),
    });
    t.inspectionId = historyId;
    if (input.createFollowup === true && input.result === 'attention') {
      if (!validDate(input.followupDueDate) || input.followupDueDate < teamToday()) {
        fail('フォロー作業の期限は今日以降で指定してください。');
      }
      const followup = makeTask({
        title: '要対応：' + a.name,
        description: input.text,
        kind: 'repair',
        assetId: a.id,
        drawingId: a.drawingId,
        assigneeId: t.assigneeId,
        dueDate: input.followupDueDate,
        priority: 'high',
        attachments: structuredClone(t.attachments),
      });
      followup.followupFor = t.id;
      state.tasks.push(followup);
      t.followupTaskId = followup.id;
    }
    if (input.updateNextDate) {
      if (
        !input.nextDate ||
        !state.propertyDefinitions.some((p) => p.id === 'nextInspection' && p.type === 'date')
      ) {
        fail('次回点検日と、日付型のnextInspectionプロパティが必要です。');
      }
      a.properties.nextInspection = input.nextDate;
    }
  }
  t.status = 'done';
  t.completedAt = t.updatedAt = new Date().toISOString();
  return t;
}
export function teamReport(state, today = teamToday()) {
  const open = state.tasks.filter(isOpen);
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const unassigned = open.filter((t) => !t.assigneeId);
  const waiting = open.filter((t) => t.status === 'waiting');
  const week = addDays(today, 7);
  const recent = state.tasks.filter((t) => {
    if (t.status !== 'done' || !t.completedAt || !Number.isFinite(Date.parse(t.completedAt))) {
      return false;
    }
    const day = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(t.completedAt));
    return day >= addDays(today, -6) && day <= today;
  });
  const memberName = (id) => state.teamMembers.find((m) => m.id === id)?.name || '未割り当て';
  const loads = [
    ...state.teamMembers.map((m) => ({
      ...m,
      tasks: open.filter((t) => t.assigneeId === m.id),
    })),
    {
      id: '',
      name: '未割り当て',
      color: '#87998e',
      active: true,
      tasks: unassigned,
    },
  ].map((m) => ({
    id: m.id,
    name: m.name,
    color: m.color,
    active: m.active,
    count: m.tasks.length,
    minutes: m.tasks.reduce((n, t) => n + t.estimatedMinutes, 0),
    overdue: m.tasks.filter((t) => t.dueDate && t.dueDate < today).length,
  }));
  const line = (t) =>
    `- [${PRIORITY[t.priority]}] ${t.title} / ${memberName(t.assigneeId)} / 期限 ${t.dueDate || '未設定'}${t.blocker ? ' / 待ち：' + t.blocker : ''}`;
  const markdown = `# 施設グループ 引き継ぎ ${today}\n\n未完了 ${open.length}件 / 期限超過 ${overdue.length}件 / 未割り当て ${unassigned.length}件 / 直近7日完了 ${recent.length}件\n\n## 今日までに対応\n${
    open
      .filter((t) => t.dueDate && t.dueDate <= today)
      .slice(0, 100)
      .map(line)
      .join('\n') || '- なし'
  }\n\n## 明日から7日以内に対応\n${
    open
      .filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= week)
      .slice(0, 100)
      .map(line)
      .join('\n') || '- なし'
  }\n\n## 確認・手配待ち\n${waiting.slice(0, 100).map(line).join('\n') || '- なし'}\n\n## 未割り当て\n${unassigned.slice(0, 100).map(line).join('\n') || '- なし'}\n\n## 担当者ごとの予定負荷（見積）\n${loads.map((m) => `- ${m.name}：${m.count}件 / ${m.minutes}分 / 超過 ${m.overdue}件`).join('\n')}\n\n## 直近7日の完了\n${recent.slice(0, 100).map(line).join('\n') || '- なし'}\n\n※各作業一覧は最大100件。担当者名簿は作業割り振り用で、ログイン権限の追加ではありません。`;
  return {
    date: today,
    open: open.length,
    overdue: overdue.length,
    unassigned: unassigned.length,
    waiting: waiting.length,
    dueToday: open.filter((t) => t.dueDate === today).length,
    upcoming: open.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= week).length,
    completedWeek: recent.length,
    loads,
    markdown,
  };
}
export function addDemoTeam(state) {
  ensureTeam(state);
  if (TEAM_COLLECTIONS.some((k) => state[k].length)) {
    throw new ApiError(409, 'チームの仕事が未登録のときだけサンプルを追加できます。');
  }
  const today = teamToday();
  state.teamMembers = ['空調・熱源担当', '電気・防災担当', '給排水担当', '工事調整担当'].map(
    (name, i) => ({
      id: 'team-demo-' + i,
      name,
      specialty: ['空調・換気・熱源', '受変電・防災', '給排水・配管', '協力会社・工事周知'][i],
      contact: '',
      color: ['#287f91', '#bc9042', '#588f6c', '#93729f'][i],
      active: true,
    }),
  );
  const pick = (category) => state.assets.find((a) => a.properties.category === category);
  const targets = [
    pick('hvac') || state.assets[0],
    pick('pipe'),
    pick('water'),
    pick('fire'),
    pick('hvac'),
    pick('power'),
    pick('pipe'),
    null,
  ];
  const owners = [0, 3, 2, 1, 0, null, 3, 3];
  const titles = [
    '空調機のフィルター巡回',
    '配管更新の事前打合せ',
    '給排水ポンプの異音確認',
    '消火設備の標識確認',
    '協力会社からの見積回答を確認',
    '設備台帳の型式を整理',
    '工事終了後の現地確認',
    '翌週の点検用紙を準備',
  ];
  state.tasks = titles.map((title, i) =>
    makeTask({
      title,
      description: '架空のサンプル作業です。担当や期限を変更してチーム運用を試せます。',
      kind: i === 0 && targets[i] ? 'inspection' : i === 2 ? 'repair' : 'task',
      assetId: targets[i]?.id || '',
      drawingId: targets[i]?.drawingId || '',
      workId: i === 1 ? state.works[0]?.id || '' : '',
      assigneeId: owners[i] === null ? '' : 'team-demo-' + owners[i],
      priority: i === 2 ? 'urgent' : i < 2 ? 'high' : 'normal',
      dueDate: addDays(today, i === 2 ? -2 : i < 2 ? 0 : i - 1),
      estimatedMinutes: [30, 45, 60, 20, 15, 60, 30, 15][i],
      status: i === 4 ? 'waiting' : i === 1 ? 'in_progress' : i === 7 ? 'done' : 'open',
      blocker: i === 4 ? '協力会社の回答待ち。金曜までに電話で確認。' : '',
      checklist:
        i === 0
          ? [
              {
                id: 'filter',
                text: 'フィルターの汚れを確認',
                done: false,
              },
              {
                id: 'noise',
                text: '異音・振動を確認',
                done: false,
              },
            ]
          : [],
    }),
  );
  if (state.assets.length) {
    state.inspectionPlans = [
      {
        id: 'plan-demo-monthly',
        name: '空調設備の月次点検',
        assetIds: (state.assets.filter((a) => a.properties.category === 'hvac').length
          ? state.assets.filter((a) => a.properties.category === 'hvac')
          : state.assets
        )
          .slice(0, 3)
          .map((a) => a.id),
        assigneeId: 'team-demo-0',
        intervalDays: 30,
        nextDue: today,
        active: true,
        priority: 'normal',
        estimatedMinutes: 20,
        description: '外観、異音、フィルターの状態を確認してください。',
        checklist: [
          {
            id: 'visual',
            text: '外観・漏れを確認',
          },
          {
            id: 'sound',
            text: '異音・振動を確認',
          },
        ],
      },
    ];
  }
  return {
    tasks: state.tasks.length,
    members: state.teamMembers.length,
    plans: state.inspectionPlans.length,
  };
}
