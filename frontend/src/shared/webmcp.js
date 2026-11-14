/**
 * ブラウザー上のWebMCP操作を、マップの公開APIと共有の保存処理へ接続します。
 * AIからの操作も通常の画面と同じ認証・権限・ロック検証を接続先APIで受けます。
 */
window.FactoryWebMCP = (() => {
  const lifecycle = new AbortController();
  let registered = false;
  const object = (properties) => ({
    type: 'object',
    properties,
    additionalProperties: false,
  });
  const string = {
    type: 'string',
    minLength: 1,
  };
  function validate(schema, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('オブジェクトを指定してください。');
    }
    for (const key of schema.required || []) {
      if (!(key in input)) {
        throw new Error(key + 'が必要です。');
      }
    }
    for (const [key, value] of Object.entries(input)) {
      const rule = schema.properties[key];
      if (!rule) {
        throw new Error('未定義の項目です: ' + key);
      }
      if (rule.type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) {
        throw new Error(key + 'はオブジェクトが必要です。');
      }
      if (
        rule.type === 'string' &&
        (typeof value !== 'string' || (rule.minLength && value.length < rule.minLength))
      ) {
        throw new Error(key + 'は空でない文字列が必要です。');
      }
      if (rule.enum && !rule.enum.includes(value)) {
        throw new Error(key + 'の値が正しくありません。');
      }
      if (rule.type === 'boolean' && typeof value !== 'boolean') {
        throw new Error(key + 'はオン・オフで指定してください。');
      }
      if (rule.type === 'array' && !Array.isArray(value)) {
        throw new Error(key + 'は配列が必要です。');
      }
    }
    return input;
  }
  async function register() {
    const registry = document.modelContext;
    if (registered || typeof registry?.registerTool !== 'function') {
      return;
    }
    const app = window.factoryMap;
    const request = FactoryAPI.request;
    async function add(name, description, schema, execute, readOnly = false) {
      await registry.registerTool(
        {
          name,
          description,
          inputSchema: schema,
          annotations: {
            readOnlyHint: readOnly,
            untrustedContentHint: true,
          },
          async execute(input) {
            const result = await execute(validate(schema, input));
            return result;
          },
        },
        {
          signal: lifecycle.signal,
        },
      );
    }
    try {
      for (const [kind, label] of [
        ['works', '工事'],
        ['assets', '設備'],
        ['drawings', '図面'],
        ['properties', '設備プロパティ'],
        ['notes', '付箋'],
        ['layers', 'レイヤー'],
        ['drawingLinks', '図面リンク'],
        ['layerSets', 'レイヤーセット'],
      ]) {
        await add(
          'list_' + kind,
          label + 'を検索・一覧取得します。',
          object({
            q: {
              type: 'string',
            },
            drawingId: string,
          }),
          async (input) =>
            request(
              '/api/' +
                kind +
                '?' +
                new URLSearchParams({
                  ...input,
                  limit: '1000',
                }),
            ),
          true,
        );
        const idSchema = {
          ...object({
            id: string,
          }),
          required: ['id'],
        };
        await add(
          'get_' + kind,
          label + 'の詳細を取得します。',
          idSchema,
          (input) => request('/api/' + kind + '/' + encodeURIComponent(input.id)),
          true,
        );
        if (kind === 'drawings') {
          continue;
        }
        for (const [action, method] of [
          ['create', 'POST'],
          ['update', 'PATCH'],
          ['delete', 'DELETE'],
        ]) {
          const schema = {
            ...object({
              ...(action === 'create'
                ? {}
                : {
                    id: string,
                  }),
              ...(action === 'delete'
                ? {}
                : {
                    record: {
                      type: 'object',
                    },
                  }),
            }),
            required: [
              ...(action === 'create' ? [] : ['id']),
              ...(action === 'delete' ? [] : ['record']),
            ],
          };
          await add(
            action + '_' + kind,
            label +
              'を' +
              {
                create: '登録',
                update: '更新',
                delete: '削除',
              }[action] +
              'します。施設グループのログインが必要です。',
            schema,
            async (input) => {
              const response = await request(
                '/api/' + kind + (input.id ? '/' + encodeURIComponent(input.id) : ''),
                {
                  method,
                  ...(input.record
                    ? {
                        body: input.record,
                      }
                    : {}),
                },
              );
              await app.refresh();
              if (action !== 'delete' && ['works', 'assets', 'notes'].includes(kind)) {
                app.openRecord(kind, response.record.id);
              }
              return response;
            },
          );
        }
      }
      await add(
        'search_site',
        '工事・設備・図面・付箋を横断検索します。',
        object({
          q: {
            type: 'string',
          },
        }),
        (input) => request('/api/search?' + new URLSearchParams(input)),
        true,
      );
      await add(
        'get_site_stats',
        '設備・工事・点検・添付資料の件数を取得します。',
        object({}),
        () => request('/api/stats'),
        true,
      );
      await add(
        'open_record',
        '指定した設備・工事を画面に表示します。',
        {
          ...object({
            kind: {
              type: 'string',
              enum: ['works', 'assets', 'notes'],
            },
            id: string,
          }),
          required: ['kind', 'id'],
        },
        async (input) => {
          app.openRecord(input.kind, input.id);
          return {
            opened: input.id,
            drawingId: app.currentDrawing,
          };
        },
        true,
      );
      await add(
        'set_drawing',
        '表示図面を切り替えます。',
        {
          ...object({
            id: string,
          }),
          required: ['id'],
        },
        async (input) => {
          app.setDrawing(input.id);
          return {
            drawingId: app.currentDrawing,
          };
        },
        true,
      );
      await add(
        'list_inspections',
        '設備の点検・保守履歴を取得します。',
        {
          ...object({
            assetId: string,
          }),
          required: ['assetId'],
        },
        (input) => request('/api/assets/' + encodeURIComponent(input.assetId) + '/maintenance'),
        true,
      );
      await add(
        'add_inspection',
        '点検・保守履歴を保存します。施設グループのログインが必要です。',
        {
          ...object({
            assetId: string,
            record: {
              type: 'object',
            },
          }),
          required: ['assetId', 'record'],
        },
        async (input) => {
          const r = await request(
            '/api/assets/' + encodeURIComponent(input.assetId) + '/maintenance',
            {
              method: 'POST',
              body: input.record,
            },
          );
          await app.refresh();
          app.openRecord('assets', input.assetId);
          return r;
        },
      );
      await add(
        'batch_update',
        '最大100件の登録・更新・削除を一括保存します。すべて成功する場合のみ反映します。',
        {
          ...object({
            operations: {
              type: 'array',
            },
            revision: {
              type: 'number',
            },
          }),
          required: ['operations'],
        },
        async (input) => {
          const r = await request('/api/batch', {
            method: 'POST',
            body: input,
          });
          await app.refresh();
          return r;
        },
      );
      await add(
        'list_work_register',
        '施設担当モード専用の工事一覧と削除済み工事を取得します。',
        object({}),
        () => request('/api/work-register'),
        true,
      );
      await add(
        'get_work_history',
        '工事の登録・変更・削除履歴を取得します。施設担当モード専用です。',
        {
          ...object({
            id: string,
          }),
          required: ['id'],
        },
        (input) => request('/api/works/' + encodeURIComponent(input.id) + '/history'),
        true,
      );
      await add(
        'get_display_preferences',
        '表示サイズ・ズーム連動・レイヤー表示・プリセットなどの設定を取得します。',
        object({}),
        () => request('/api/preferences'),
        true,
      );
      await add(
        'update_display_preferences',
        '表示設定を更新し、このアカウントに保存します。',
        {
          ...object({
            preferences: {
              type: 'object',
            },
          }),
          required: ['preferences'],
        },
        async (input) => {
          const current = FactoryPreferences.getPreferences();
          await FactoryPreferences.update({
            ...input.preferences,
            ...(input.preferences.appearance
              ? {
                  appearance: {
                    ...current.appearance,
                    ...input.preferences.appearance,
                  },
                }
              : {}),
          });
          return {
            preferences: FactoryPreferences.getPreferences(),
          };
        },
      );
      await add(
        'set_layer_visibility',
        '追加レイヤーの表示・非表示を切り替え、保存します。',
        {
          ...object({
            id: string,
            visible: {
              type: 'boolean',
            },
          }),
          required: ['id', 'visible'],
        },
        async (input) => {
          if (!app.state.layers.some((l) => l.id === input.id)) {
            throw new Error('レイヤーがありません。');
          }
          const ids = new Set(FactoryPreferences.getPreferences().hiddenLayerIds);
          if (input.visible) {
            ids.delete(input.id);
          } else {
            ids.add(input.id);
          }
          await FactoryPreferences.update({
            hiddenLayerIds: [...ids],
          });
          return {
            id: input.id,
            visible: input.visible,
          };
        },
      );
      await add(
        'apply_layer_sets',
        '複数レイヤーセットの保存状態・表示・非表示・和集合・共通部分を適用します。',
        {
          ...object({
            ids: {
              type: 'array',
              items: string,
            },
            operation: {
              type: 'string',
              enum: ['saved', 'show', 'hide', 'isolate', 'intersection'],
            },
          }),
          required: ['ids'],
        },
        (input) => FactoryLayerSets.apply(input.ids, input.operation),
      );
      await add(
        'go_parent_drawing',
        '上の図面へ戻ります。',
        object({}),
        () => {
          FactoryOrganization.goParent();
          return {
            drawingId: app.currentDrawing,
          };
        },
        true,
      );
      await add(
        'preview_equipment_json',
        '設備JSONの追加・更新・エラーを保存せず確認します。',
        {
          ...object({
            assets: {
              type: 'array',
            },
            mode: {
              type: 'string',
              enum: ['add', 'upsert'],
            },
            drawingId: string,
          }),
          required: ['assets'],
        },
        (input) =>
          request('/api/assets/import-preview', {
            method: 'POST',
            body: input,
          }),
        true,
      );
      await add(
        'import_equipment_json',
        'プレビュー後の設備JSONを一括保存します。点検履歴と添付資料を保持しロックを守ります。',
        {
          ...object({
            assets: {
              type: 'array',
            },
            mode: {
              type: 'string',
              enum: ['add', 'upsert'],
            },
            drawingId: string,
            revision: {
              type: 'number',
            },
            confirm: {
              type: 'string',
              enum: ['IMPORT_ASSETS'],
            },
          }),
          required: ['assets', 'revision', 'confirm'],
        },
        async (input) => {
          const r = await request('/api/assets/import', {
            method: 'POST',
            body: input,
          });
          await app.refresh();
          return r;
        },
      );
      for (const [kind, label] of [
        ['tasks', 'チームの作業'],
        ['teamMembers', '担当者名簿'],
        ['inspectionPlans', '点検計画'],
        ['projects', '案件・改善プロジェクト'],
      ]) {
        await add(
          'list_' + kind,
          label + 'を取得します。施設担当モード専用です。',
          object({
            q: {
              type: 'string',
            },
          }),
          (input) => request('/api/' + kind + '?' + new URLSearchParams(input)),
          true,
        );
        await add(
          'get_' + kind,
          label + 'の詳細を取得します。',
          {
            ...object({
              id: string,
            }),
            required: ['id'],
          },
          (input) => request('/api/' + kind + '/' + encodeURIComponent(input.id)),
          true,
        );
        for (const [action, method] of [
          ['create', 'POST'],
          ['update', 'PATCH'],
          ['delete', 'DELETE'],
        ]) {
          const schema = {
            ...object({
              revision: {
                type: 'number',
              },
              ...(action === 'create'
                ? {}
                : {
                    id: string,
                  }),
              ...(action === 'delete'
                ? {}
                : {
                    record: {
                      type: 'object',
                    },
                  }),
            }),
            required: [
              'revision',
              ...(action === 'create' ? [] : ['id']),
              ...(action === 'delete' ? [] : ['record']),
            ],
          };
          await add(
            action + '_' + kind,
            label +
              'を' +
              {
                create: '作成',
                update: '更新',
                delete: '削除',
              }[action] +
              'します。最新のrevisionが必要です。',
            schema,
            async (input) => {
              const { id, ...body } = input;
              const r = await request('/api/' + kind + (id ? '/' + encodeURIComponent(id) : ''), {
                method,
                body,
              });
              await app.refresh();
              return r;
            },
          );
        }
      }
      await add(
        'preview_inspection_plan',
        '点検計画から今回作成する作業と重複スキップを確認します。',
        {
          ...object({
            id: string,
          }),
          required: ['id'],
        },
        (input) => request('/api/inspectionPlans/' + encodeURIComponent(input.id) + '/preview'),
        true,
      );
      await add(
        'generate_inspection_plan',
        '確認済みの点検計画を設備ごとの作業へ起票します。',
        {
          ...object({
            id: string,
            revision: {
              type: 'number',
            },
            cycleDate: string,
          }),
          required: ['id', 'revision', 'cycleDate'],
        },
        async (input) => {
          const r = await request(
            '/api/inspectionPlans/' + encodeURIComponent(input.id) + '/generate',
            {
              method: 'POST',
              body: {
                revision: input.revision,
                cycleDate: input.cycleDate,
              },
            },
          );
          await app.refresh();
          return r;
        },
      );
      await add(
        'complete_task',
        'チェック確認済みの仕事を完了します。点検は結果と履歴を保存し、必要なら要対応フォローも作成します。',
        {
          ...object({
            id: string,
            revision: {
              type: 'number',
            },
            record: {
              type: 'object',
            },
            checklist: {
              type: 'array',
            },
            date: string,
            inspector: {
              type: 'string',
            },
            result: {
              type: 'string',
              enum: ['normal', 'attention', 'repaired'],
            },
            text: {
              type: 'string',
            },
            nextDate: {
              type: 'string',
            },
            updateNextDate: {
              type: 'boolean',
            },
            createFollowup: {
              type: 'boolean',
            },
            followupDueDate: string,
          }),
          required: ['id', 'revision'],
        },
        async (input) => {
          const { id, ...body } = input;
          const r = await request('/api/tasks/' + encodeURIComponent(id) + '/complete', {
            method: 'POST',
            body,
          });
          await app.refresh();
          return r;
        },
      );
      await add(
        'get_task_history',
        '作業の変更と引き継ぎコメントを取得します。',
        {
          ...object({
            id: string,
          }),
          required: ['id'],
        },
        (input) => request('/api/tasks/' + encodeURIComponent(input.id) + '/history'),
        true,
      );
      await add(
        'add_task_comment',
        '引き継ぎコメントを変更履歴に保存します。',
        {
          ...object({
            id: string,
            revision: {
              type: 'number',
            },
            text: string,
          }),
          required: ['id', 'revision', 'text'],
        },
        async (input) => {
          const r = await request('/api/tasks/' + encodeURIComponent(input.id) + '/comments', {
            method: 'POST',
            body: {
              revision: input.revision,
              text: input.text,
            },
          });
          await app.refresh();
          return r;
        },
      );
      await add(
        'get_team_report',
        '期限超過・未割り当て・手配待ち・担当負荷・直近完了の引き継ぎレポートを取得します。',
        object({
          date: string,
        }),
        (input) => request('/api/team/report?' + new URLSearchParams(input)),
        true,
      );
      await add(
        'get_project_workload',
        '案件ごとの作業数・進捗・期限超過・先行作業待ちを取得します。',
        object({}),
        () => request('/api/team/projects'),
        true,
      );
      await add(
        'add_workflow_demo',
        'チーム管理が未登録の場合だけ、架空の案件3件・工程付き作業16件・担当4名・点検計画1件を追加します。',
        {
          ...object({
            revision: {
              type: 'number',
            },
          }),
          required: ['revision'],
        },
        async (input) => {
          const r = await request('/api/team/workflow-demo', {
            method: 'POST',
            body: input,
          });
          await app.refresh();
          return r;
        },
      );
      await add(
        'get_notion_sync_status',
        'Notionとの定期同期の状態を取得します。接続トークンは返しません。',
        object({}),
        () => request('/api/notion/status'),
        true,
      );
      await add(
        'list_notion_sync_issues',
        'Notion同期の競合・入力エラー・削除確認を取得します。',
        object({}),
        () => request('/api/notion/issues'),
        true,
      );
      await add(
        'list_notion_sync_runs',
        'Notion同期の実行履歴を取得します。',
        object({}),
        () => request('/api/notion/runs'),
        true,
      );
      await add(
        'run_notion_sync',
        'Webhookを使わないNotion同期を実行待ちにします。',
        object({
          full: {
            type: 'boolean',
          },
        }),
        (input) =>
          request('/api/notion/run', {
            method: 'POST',
            body: input,
          }),
      );
      await add('pause_notion_sync', 'Notionの定期同期を停止します。', object({}), () =>
        request('/api/notion/pause', {
          method: 'POST',
          body: {},
        }),
      );
      await add(
        'resolve_notion_sync_issue',
        '確認済みの同期競合で採用する側を指定します。削除反映には明示的な確認が必要です。',
        {
          ...object({
            kind: string,
            localId: string,
            source: {
              type: 'string',
              enum: ['local', 'notion'],
            },
            revision: {
              type: 'number',
            },
            updatedAt: string,
            confirm: {
              type: 'string',
              enum: ['DELETE_REVIEWED'],
            },
          }),
          required: ['kind', 'localId', 'source', 'revision', 'updatedAt'],
        },
        (input) =>
          request('/api/notion/resolve', {
            method: 'POST',
            body: input,
          }),
      );
      registered = true;
      window.dispatchEvent(new Event('factory-webmcp-ready'));
    } catch (error) {
      console.error('WebMCP registration:', error);
    }
  }
  window.addEventListener('pagehide', () => lifecycle.abort(), {
    once: true,
  });
  return {
    register,
  };
})();
