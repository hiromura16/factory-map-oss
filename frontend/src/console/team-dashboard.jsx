/**
 * 期限超過・担当未定・担当者負荷・点検・工事をまとめるダッシュボード。
 * 集計の選択から、同じ条件を引き継いだタスク画面へ移動します。
 */
import React from 'react';
import {
  today,
  addDays,
  openTask,
  compareTasks,
  Person,
  statusNames,
  priorityNames,
} from './team-shared.jsx';
export const latestInspection = (a) =>
  [...(a.history || [])].sort((x, y) => y.date.localeCompare(x.date))[0];
export const nextInspection = (a) =>
  a.properties?.nextInspection || latestInspection(a)?.nextDate || '';
export function TeamDashboard({ state, onTasks, onInspections, onEquipment, onWorks }) {
  const day = today();
  const open = state.tasks.filter(openTask);
  const overdue = open.filter((t) => t.dueDate && t.dueDate < day);
  const unassigned = open.filter((t) => !t.assigneeId);
  const waiting = open.filter((t) => t.status === 'waiting');
  const decisions = [...open]
    .filter((t) => !t.assigneeId || t.status === 'waiting' || (t.dueDate && t.dueDate <= day))
    .sort(compareTasks);
  const due = state.assets.filter((a) => nextInspection(a) && nextInspection(a) <= day);
  const attention = state.assets.filter((a) => latestInspection(a)?.result === 'attention');
  const works = state.works
    .filter((w) => w.status !== 'done' && (w.end < day || w.start <= addDays(day, 7)))
    .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  const members = state.teamMembers
    .filter((m) => m.active)
    .map((m) => {
      const tasks = open.filter((t) => t.assigneeId === m.id);
      return {
        ...m,
        tasks,
        minutes: tasks.reduce((n, t) => n + t.estimatedMinutes, 0),
        late: tasks.filter((t) => t.dueDate && t.dueDate < day).length,
      };
    })
    .sort((a, b) => b.minutes - a.minutes);
  return (
    <div className="management-dashboard">
      <div className="work-page-intro">
        <p>遅れ・担当未定・負荷を確認し、作業の割り振りを調整します。</p>
        <time>
          {new Date(day + 'T12:00:00Z').toLocaleDateString('ja-JP', {
            month: 'long',
            day: 'numeric',
            weekday: 'long',
            timeZone: 'Asia/Tokyo',
          })}
        </time>
      </div>
      <div className="management-counts">
        {[
          ['期限超過', overdue.length, 'overdue'],
          ['担当未定', unassigned.length, 'unassigned'],
          ['確認・手配待ち', waiting.length, 'waiting'],
          ['未完了', open.length, 'open'],
        ].map(([name, count, focus]) => (
          <button key={focus} onClick={() => onTasks(null, focus)}>
            <span>{name}</span>
            <strong>
              {count}
              <small>件</small>
            </strong>
            <span aria-hidden="true">→</span>
          </button>
        ))}
      </div>
      <div className="management-columns">
        <section className="work-surface management-decisions">
          <div className="work-section-title">
            <h2>
              判断・調整が必要なタスク <small>{decisions.length}件</small>
            </h2>
            <button onClick={() => onTasks()}>タスクを開く →</button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>タスク</th>
                  <th>担当者</th>
                  <th>期限</th>
                  <th>確認事項</th>
                </tr>
              </thead>
              <tbody>
                {decisions.slice(0, 12).map((t) => (
                  <tr key={t.id}>
                    <td>
                      <button className="task-title-button" onClick={() => onTasks(t.id)}>
                        {t.title}
                      </button>
                      <small>
                        {statusNames[t.status]} · 優先度 {priorityNames[t.priority]}
                      </small>
                    </td>
                    <td>
                      <Person state={state} id={t.assigneeId} />
                    </td>
                    <td className={t.dueDate && t.dueDate < day ? 'task-overdue' : ''}>
                      {t.dueDate || '未設定'}
                    </td>
                    <td>
                      {!t.assigneeId
                        ? '担当者を決める'
                        : t.status === 'waiting'
                          ? t.blocker || '次の対応を確認'
                          : t.dueDate < day
                            ? '遅れを確認'
                            : '今日の進め方を確認'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!decisions.length && (
            <p className="team-empty">期限超過・担当未定・手配待ちのタスクはありません。</p>
          )}
          {decisions.length > 12 && (
            <button className="work-more" onClick={() => onTasks()}>
              残りのタスクを確認 →
            </button>
          )}
        </section>
        <section className="work-surface management-workload">
          <div className="work-section-title">
            <h2>担当者の負荷</h2>
          </div>
          <p className="work-caption">未完了タスクの見積時間合計</p>
          {members.map((m) => (
            <button
              className="workload-person"
              key={m.id}
              onClick={() => onTasks(null, 'member:' + m.id)}
            >
              <span>
                <Person state={state} id={m.id} />
                <small>
                  {m.tasks.length}件
                  {m.late > 0 && <b className="task-overdue"> · 超過 {m.late}件</b>}
                </small>
              </span>
              <strong>
                {Math.round(m.minutes / 6) / 10}
                <small>時間</small>
              </strong>
              <progress max={Math.max(1, ...members.map((m) => m.minutes))} value={m.minutes} />
            </button>
          ))}
          {!members.length && <p className="team-empty">担当者は未登録です。</p>}
          <button className="work-more" onClick={() => onTasks(null, 'members')}>
            担当者・負荷を開く →
          </button>
        </section>
      </div>
      <div className="management-columns">
        <section className="work-surface">
          <div className="work-section-title">
            <h2>設備の点検・要対応</h2>
            <button onClick={onInspections}>点検予定・履歴 →</button>
          </div>
          <div className="management-notice">
            <span>点検期限を迎えた設備</span>
            <strong>{due.length}台</strong>
            <button onClick={onInspections}>点検を手配</button>
          </div>
          <div className="management-notice">
            <span>直近の点検で要対応</span>
            <strong>{attention.length}台</strong>
            <button onClick={() => onEquipment('attention')}>設備を確認</button>
          </div>
        </section>
        <section className="work-surface">
          <div className="work-section-title">
            <h2>直近の工事予定</h2>
            <button onClick={() => onWorks('upcoming')}>工事台帳 →</button>
          </div>
          {works.slice(0, 4).map((w) => (
            <a
              key={w.id}
              className="management-work-link"
              href={'index.html?work=' + encodeURIComponent(w.id)}
            >
              <span>
                {w.title}
                <small>
                  {w.start} → {w.end}
                </small>
              </span>
              <b className={w.end < day ? 'task-overdue' : ''}>
                {w.end < day ? '終了予定超過' : w.status === 'active' ? '工事中' : '予定'}
              </b>
              <span>↗</span>
            </a>
          ))}
          {!works.length && <p className="team-empty">直近7日以内の工事予定はありません。</p>}
        </section>
      </div>
    </div>
  );
}
