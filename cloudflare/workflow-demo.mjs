import {ApiError} from './core.mjs';
import {addDemoTeam,makeTask,teamToday,addDays,ensureTeam} from './team.mjs';
import {makeProject} from './workflow.mjs';

export function addWorkflowDemo(state){
 ensureTeam(state);if(['tasks','teamMembers','inspectionPlans','projects'].some(k=>state[k].length))throw new ApiError(409,'チーム管理が未登録のときだけ、案件と工程のサンプルを追加できます。');
 addDemoTeam(state);const today=teamToday(),owner=i=>'team-demo-'+i;
 state.projects=[
  makeProject({id:'project-demo-pipe',name:'A棟 給水配管の更新',status:'active',ownerId:owner(3),startDate:addDays(today,-7),dueDate:addDays(today,14),color:'#287f91',goal:'配管更新・漏れ検査・周知が完了し、通路を通常利用に戻す。',description:'架空のサンプル案件です。現地確認から工事後の受入までを作業で管理します。'}),
  makeProject({id:'project-demo-preventive',name:'設備の予防保全・月次点検',status:'active',ownerId:owner(0),startDate:addDays(today,-5),dueDate:addDays(today,21),color:'#588f6c',goal:'対象設備の点検結果を記録し、要対応の設備には修理担当と期限を設定する。',description:'架空のサンプル案件です。点検計画と異常時のフォローをまとめます。'}),
  makeProject({id:'project-demo-energy',name:'空調運転の省エネ改善',status:'planning',ownerId:owner(0),startDate:today,dueDate:addDays(today,30),color:'#bc9042',goal:'運転実績を確認し、生産影響を確認した改善案と実施予定を決める。',description:'架空のサンプル案件です。検討中・手配待ちの運用例です。'})
 ];
 state.tasks.forEach((t,i)=>{t.projectId=state.projects[[1,0,1,1,2,1,0,1][i]].id;t.requestor=['月次点検計画','製造1課','現場巡回','安全衛生担当','省エネ会議','施設グループ','工事調整担当','翌週準備'][i];});
 const asset=state.assets.find(a=>a.properties.category==='pipe')||state.assets[0];
 const add=(id,title,extra={})=>state.tasks.push(makeTask({id,title,projectId:'project-demo-pipe',kind:'coordination',assigneeId:owner(3),dueDate:addDays(today,7),estimatedMinutes:30,description:'架空のサンプル作業です。実際の作業指示ではありません。',requestor:'施設グループ',...extra}));
 add('demo-pipe-rollout','給水配管更新を完了する',{dueDate:addDays(today,14),acceptanceCriteria:'子作業と漏れ検査が完了し、通行規制を解除している。'});
 add('demo-pipe-survey','配管ルートと影響範囲を確認する',{parentId:'demo-pipe-rollout',status:'done',assetId:asset?.id||'',drawingId:asset?.drawingId||''});
 add('demo-pipe-isolation','断水・隔離手順を関係部署と確定する',{parentId:'demo-pipe-rollout',dependsOnIds:['demo-pipe-survey'],dueDate:today});
 add('demo-pipe-install','配管更新の施工日を決める',{parentId:'demo-pipe-rollout',dependsOnIds:['demo-pipe-isolation'],dueDate:addDays(today,3)});
 add('demo-pipe-accept','漏れ検査と現地受入を確認する',{parentId:'demo-pipe-rollout',dependsOnIds:['demo-pipe-install'],dueDate:addDays(today,10),acceptanceCriteria:'検査結果と写真を確認し、対象設備の記録を更新している。'});
 add('demo-energy-measure','空調の運転時間を集計する',{projectId:'project-demo-energy',assigneeId:owner(0),status:'done',kind:'task'});
 add('demo-energy-proposal','省エネ案の生産影響を確認する',{projectId:'project-demo-energy',assigneeId:owner(0),kind:'task',status:'waiting',blocker:'製造側の運転条件の回答待ち。次の朝会で回答予定日を確認する。',dependsOnIds:['demo-energy-measure']});
 add('demo-energy-schedule','改善案の試行日を調整する',{projectId:'project-demo-energy',assigneeId:'',kind:'task',dependsOnIds:['demo-energy-proposal'],dueDate:addDays(today,14)});
 return{tasks:state.tasks.length,members:state.teamMembers.length,plans:state.inspectionPlans.length,projects:state.projects.length};
}
