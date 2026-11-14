/**
 * 台帳の編集可能項目とNotionプロパティを相互変換する同期モデル。
 * システム項目・関係ID・独自属性を分け、読み込んだ値も業務ルールで再検証します。
 */
import { ApiError } from '../core.mjs';
import { makeTask, completeTask, ensureTeam } from '../team.mjs';
import { PROJECT_STATUS, makeProject, projectStats } from '../workflow.mjs';
export const KINDS = [
  'teamMembers',
  'projects',
  'assets',
  'works',
  'inspectionPlans',
  'tasks',
  'inspections',
];
export const LABELS = {
  teamMembers: '担当者',
  projects: '案件・改善プロジェクト',
  assets: '設備台帳',
  works: '工事台帳',
  inspectionPlans: '点検計画',
  tasks: 'チームの仕事',
  inspections: '点検・保守履歴',
};
const status = {
  open: '未着手',
  in_progress: '進行中',
  waiting: '確認・手配待ち',
  done: '完了',
  cancelled: '中止',
};
const priority = {
  urgent: '最優先',
  high: '高',
  normal: '通常',
  low: '低',
};
const kind = {
  task: '一般作業',
  inspection: '点検',
  repair: '修理・対応',
  coordination: '工事調整',
};
const result = {
  normal: '異常なし',
  attention: '要対応',
  repaired: '補修済み',
};
const workStatus = {
  active: '工事中',
  planned: '予定',
  done: '完了',
};
import {
  canonical,
  threeWayMerge,
  propertySchema,
  encodeProperty,
  decodeProperty,
} from '../../connectors/notion/index.mjs';
export { canonical };
const field = (key, name, type = 'rich_text', extra = {}) => ({
  key,
  name,
  type,
  ...extra,
});
const relation = (key, name, target, many = false) =>
  field(key, name, 'relation', {
    target,
    many,
  });
const select = (key, name, options) =>
  field(key, name, 'select', {
    options,
  });
export function fields(collection, state) {
  const common = [field('title', '名前', 'title')];
  if (collection === 'teamMembers') {
    return [
      ...common,
      field('specialty', '専門'),
      field('contact', '連絡先'),
      field('active', '有効', 'checkbox'),
      field('color', '色'),
    ];
  }
  if (collection === 'projects') {
    return [
      ...common,
      select('status', '状態', PROJECT_STATUS),
      relation('ownerId', '責任者', 'teamMembers'),
      field('startDate', '着手予定', 'date'),
      field('dueDate', '期限', 'date'),
      field('goal', '目的・完了条件'),
      field('description', '内容'),
      field('color', '色'),
    ];
  }
  if (collection === 'assets') {
    return [
      ...common,
      field('code', '設備ID'),
      field('location', '場所'),
      field('drawingId', '図面ID'),
      field('x', 'X座標', 'number'),
      field('y', 'Y座標', 'number'),
      field('layerId', 'レイヤーID'),
      ...state.propertyDefinitions.map((d) => {
        const names =
          state.propertyDefinitions.filter((p) => p.name === d.name).length +
          ([
            '名前',
            'PlantDesk ID',
            '設備ID',
            '場所',
            '図面ID',
            'X座標',
            'Y座標',
            'レイヤーID',
            '位置ロック',
            '属性ロック',
            'PlantDesk',
            '同期状態',
          ].includes(d.name)
            ? 1
            : 0);
        return field(
          'prop:' + d.id,
          names > 1 ? d.name + '（' + d.id + '）' : d.name,
          {
            text: 'rich_text',
            number: 'number',
            date: 'date',
            checkbox: 'checkbox',
            select: 'select',
            multiselect: 'multi_select',
            url: 'url',
          }[d.type],
          {
            definition: d,
            options: Object.fromEntries(
              (d.options || []).map((o) => [
                o.id,
                d.options.filter((x) => x.label === o.label).length > 1
                  ? o.label + ' [' + o.id + ']'
                  : o.label,
              ]),
            ),
          },
        );
      }),
    ];
  }
  if (collection === 'works') {
    return [
      ...common,
      field('code', '工事ID'),
      select('status', '状態', workStatus),
      field('location', '場所'),
      field('start', '開始日', 'date'),
      field('end', '終了日', 'date'),
      field('contact', '担当'),
      field('phone', '内線'),
      field('impacts', '影響', 'multi_select'),
      relation('assetIds', '対象設備', 'assets', true),
      field('drawingId', '図面ID'),
      field('layerId', 'レイヤーID'),
      field('points', '範囲JSON', 'rich_text', {
        json: true,
      }),
      field('notes', '内容'),
    ];
  }
  if (collection === 'inspectionPlans') {
    return [
      ...common,
      relation('assetIds', '対象設備', 'assets', true),
      relation('assigneeId', '担当者', 'teamMembers'),
      field('intervalDays', '周期日', 'number'),
      field('nextDue', '次回予定', 'date'),
      field('active', '運用中', 'checkbox'),
      select('priority', '優先度', priority),
      field('estimatedMinutes', '見積分', 'number'),
      field('description', '内容'),
      field('checklist', 'チェックJSON', 'rich_text', {
        json: true,
      }),
    ];
  }
  if (collection === 'tasks') {
    return [
      ...common,
      select('kind', '種類', kind),
      select('status', '状態', status),
      select('priority', '優先度', priority),
      field('dueDate', '期限', 'date'),
      relation('assigneeId', '担当者', 'teamMembers'),
      relation('assetId', '対象設備', 'assets'),
      relation('workId', '関連工事', 'works'),
      field('drawingId', '図面ID'),
      field('estimatedMinutes', '見積分', 'number'),
      field('description', '内容'),
      field('blocker', '手配待ち'),
      field('checklist', 'チェックJSON', 'rich_text', {
        json: true,
      }),
      field('inspectionDate', '点検日', 'date'),
      select('inspectionResult', '点検結果', result),
      field('inspectionText', '実施内容'),
      field('inspector', '実施者'),
      field('nextDate', '次回点検日', 'date'),
      field('updateNextDate', '次回日を反映', 'checkbox'),
      field('createFollowup', 'フォロー作成', 'checkbox'),
      field('followupDueDate', 'フォロー期限', 'date'),
      relation('projectId', '案件', 'projects'),
      relation('parentId', '親作業', 'tasks'),
      relation('dependsOnIds', '先行作業', 'tasks', true),
      field('startDate', '着手予定', 'date'),
      field('requestor', '依頼元'),
      field('acceptanceCriteria', '完了条件'),
      field('acceptanceConfirmed', '完了条件を確認', 'checkbox'),
    ];
  }
  return [
    ...common,
    relation('assetId', '対象設備', 'assets'),
    field('date', '点検日', 'date'),
    field('text', '内容'),
    field('kind', '点検種別'),
    select('result', '結果', result),
    field('inspector', '実施者'),
    field('nextDate', '次回点検日', 'date'),
    field('checklist', 'チェックJSON', 'rich_text', {
      json: true,
    }),
  ];
}
export function records(collection, state) {
  ensureTeam(state);
  return collection === 'inspections'
    ? state.assets.flatMap((a) =>
        a.history.map((h) => ({
          ...h,
          id: a.id + '~' + h.id,
          historyId: h.id,
          assetId: a.id,
        })),
      )
    : state[collection];
}
/**
 * アプリのレコードを、同期対象にした編集可能項目だけの比較用データへ変換します。
 * 添付本体や管理外のNotion列は、この比較と上書きの対象に含めません。
 */
export function project(collection, r, state) {
  const p = {};
  for (const f of fields(collection, state)) {
    let v = r[f.key];
    if (f.key === 'title') {
      v = r.name || r.title || r.text?.slice(0, 80) || '点検記録';
    }
    if (collection === 'assets') {
      if (f.key === 'x') {
        v = r.point?.[0];
      }
      if (f.key === 'y') {
        v = r.point?.[1];
      }
      if (f.definition) {
        v = r.properties?.[f.definition.id];
      }
    }
    if (collection === 'tasks') {
      const h = r.inspectionId
        ? state.assets.find((a) => a.id === r.assetId)?.history.find((h) => h.id === r.inspectionId)
        : null;
      const special = {
        inspectionDate: h?.date || '',
        inspectionResult: h?.result || '',
        inspectionText: h?.text || '',
        inspector: h?.inspector || '',
        nextDate: h?.nextDate || '',
        updateNextDate: r.completionOptions?.updateNextDate === true,
        createFollowup: r.completionOptions?.createFollowup === true,
        followupDueDate: r.completionOptions?.followupDueDate || '',
      };
      if (Object.hasOwn(special, f.key)) {
        v = special[f.key];
      }
    }
    if (f.json) {
      v = v ?? [];
    } else if (f.type === 'checkbox') {
      v = v === true;
    } else if (f.type === 'number') {
      v = v === undefined || v === '' ? null : v;
    } else if (f.type === 'multi_select' || f.many) {
      v = Array.isArray(v) ? [...v].sort() : [];
    } else {
      v = v ?? '';
    }
    p[f.key] = v;
  }
  return p;
}
export const merge = (base, local, remote, direction = 'both', resolution = null) =>
  threeWayMerge(base, local, remote, {
    direction,
    prefer: resolution,
  });
/**
 * 同期対象の値を台帳へ反映します。タスク完了は通常と同じ点検・完了処理を通します。
 * この関数の反映だけではDBに保存されないため、呼び出し元で台帳検証とcommitを行います。
 */
export function applyProjection(state, collection, id, p, _previous) {
  const list = records(collection, state);
  const old = list.find((r) => r.id === id);
  let r;
  if (collection === 'assets') {
    r = old
      ? {
          ...old,
          properties: {
            ...old.properties,
          },
        }
      : {
          id,
          name: '',
          code: '',
          location: '',
          point: [],
          drawingId: '',
          properties: {},
          history: [],
          attachments: [],
        };
    Object.assign(r, {
      name: p.title,
      code: p.code,
      location: p.location,
      drawingId: p.drawingId,
      point: [p.x, p.y],
    });
    if (p.layerId) {
      r.layerId = p.layerId;
    } else {
      delete r.layerId;
    }
    for (const d of state.propertyDefinitions) {
      if (Object.hasOwn(p, 'prop:' + d.id)) {
        r.properties[d.id] = p['prop:' + d.id];
      }
    }
  } else if (collection === 'teamMembers') {
    r = {
      ...old,
      id,
      name: p.title,
      specialty: p.specialty,
      contact: p.contact,
      active: p.active,
      color: p.color || '#287f91',
    };
  } else if (collection === 'projects') {
    r = makeProject(
      {
        id,
        name: p.title,
        status: p.status,
        ownerId: p.ownerId,
        startDate: p.startDate,
        dueDate: p.dueDate,
        goal: p.goal,
        description: p.description,
        color: p.color || '#287f91',
      },
      old,
    );
  } else if (collection === 'works') {
    r = {
      ...old,
      id,
      title: p.title,
      code: p.code,
      status: p.status,
      location: p.location,
      start: p.start,
      end: p.end,
      contact: p.contact,
      phone: p.phone,
      impacts: p.impacts,
      assetIds: p.assetIds,
      drawingId: p.drawingId,
      points: p.points,
      notes: p.notes,
      attachments: old?.attachments || [],
      ...(p.layerId
        ? {
            layerId: p.layerId,
          }
        : {
            layerId: undefined,
          }),
    };
  } else if (collection === 'inspectionPlans') {
    r = {
      ...old,
      id,
      name: p.title,
      assetIds: p.assetIds,
      assigneeId: p.assigneeId,
      intervalDays: p.intervalDays,
      nextDue: p.nextDue,
      active: p.active,
      priority: p.priority,
      estimatedMinutes: p.estimatedMinutes,
      description: p.description,
      checklist: p.checklist,
    };
  } else if (collection === 'tasks') {
    if (old?.inspectionId) {
      const current = project('tasks', old, state);
      for (const key of [
        'inspectionDate',
        'inspectionResult',
        'inspectionText',
        'inspector',
        'nextDate',
        'updateNextDate',
        'createFollowup',
        'followupDueDate',
      ]) {
        if (canonical(p[key]) !== canonical(current[key])) {
          throw new ApiError(422, '完了した点検の結果は「点検・保守履歴」から編集してください。');
        }
      }
    }
    const body = Object.fromEntries(
      [
        'kind',
        'priority',
        'dueDate',
        'assigneeId',
        'assetId',
        'workId',
        'drawingId',
        'estimatedMinutes',
        'description',
        'blocker',
        'checklist',
        'projectId',
        'parentId',
        'dependsOnIds',
        'startDate',
        'requestor',
        'acceptanceCriteria',
        'acceptanceConfirmed',
      ].map((k) => [k, p[k]]),
    );
    body.title = p.title;
    body.status = p.status === 'done' && old?.status !== 'done' ? 'in_progress' : p.status;
    r = makeTask(
      body,
      old || {
        id,
        ...makeTask({
          title: p.title,
        }),
      },
    );
    r.id = id;
    const i = state.tasks.findIndex((t) => t.id === id);
    if (i < 0) {
      state.tasks.push(r);
    } else {
      state.tasks[i] = r;
    }
    if (p.status === 'done' && old?.status !== 'done') {
      completeTask(
        state,
        id,
        {
          date: p.inspectionDate,
          result: p.inspectionResult,
          text: p.inspectionText,
          inspector: p.inspector,
          nextDate: p.nextDate,
          updateNextDate: p.updateNextDate,
          createFollowup: p.createFollowup,
          followupDueDate: p.followupDueDate,
        },
        'Notion同期',
      );
    }
    return state;
  } else {
    const asset = state.assets.find((a) => a.id === p.assetId);
    if (!asset) {
      throw new ApiError(422, '対象設備を選択してください。');
    }
    const historyId = old?.historyId || id.split('~').at(-1);
    if (old && old.assetId !== p.assetId) {
      throw new ApiError(422, '点検履歴の対象設備は変更できません。');
    }
    r = {
      ...old,
      id: historyId,
      name: p.title,
      date: p.date,
      text: p.text,
      kind: p.kind,
      result: p.result,
      inspector: p.inspector,
      nextDate: p.nextDate,
      checklist: p.checklist,
      attachments: old?.attachments || [],
    };
    delete r.historyId;
    delete r.assetId;
    const i = asset.history.findIndex((h) => h.id === historyId);
    if (i < 0) {
      asset.history.push(r);
    } else {
      asset.history[i] = r;
    }
    return state;
  }
  r.updatedAt = new Date().toISOString();
  const i = state[collection].findIndex((x) => x.id === id);
  if (i < 0) {
    state[collection].push(r);
  } else {
    state[collection][i] = r;
  }
  return state;
}
export const systemValues = (collection, record, state) =>
  collection === 'projects' ? projectStats(state, record.id) : record?.locks || {};
export const systemFields = (collection) => [
  field('_id', 'PlantDesk ID'),
  field('_url', 'PlantDesk', 'url'),
  field('_sync', '同期状態'),
  ...(collection === 'projects'
    ? [
        field('_progress', '進捗（自動）', 'number'),
        field('_open', '未完了（自動）', 'number'),
        field('_overdue', '期限超過（自動）', 'number'),
      ]
    : []),
  ...(collection === 'assets'
    ? [
        field('_positionLock', '位置ロック', 'checkbox'),
        field('_attributeLock', '属性ロック', 'checkbox'),
      ]
    : []),
];
export const schema = (f, sources) => propertySchema(f, (key) => sources[key].id);
export const toProperty = (f, value, links) =>
  encodeProperty(f, value, {
    resolvePageId: (kind, id) =>
      links.find((l) => l.kind === kind && l.local_id === id && /^[a-f0-9-]{36}$/i.test(l.page_id))
        ?.page_id,
  });
export const fromProperty = (f, p, links) =>
  decodeProperty(f, p, {
    resolveLocalId: (kind, id) => links.find((l) => l.kind === kind && l.page_id === id)?.local_id,
  });
