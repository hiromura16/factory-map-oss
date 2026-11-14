/**
 * ブラウザーとAPIで共用する表示項目の定義・初期値・許容範囲。
 * 画面入力とサーバー検証がずれないよう同じ正規化処理を使い、DOMには依存しません。
 */
(() => {
  const fields = [
    ['equipment', 'iconSize', '設備アイコンのサイズ', 'number', 32, 12, 72, 'px'],
    [
      'equipment',
      'iconScale',
      '設備アイコンのズーム連動',
      'select',
      'gentle',
      {
        fixed: '固定する',
        gentle: '緩やかに連動',
        map: '図面と同じ倍率',
      },
    ],
    [
      'equipment',
      'equipmentLabels',
      '設備名の表示',
      'select',
      'hover',
      {
        hover: 'ホバー時',
        always: '常に表示',
        none: '表示しない',
      },
    ],
    [
      'equipment',
      'equipmentLabelContent',
      '設備ラベルの内容',
      'select',
      'name',
      {
        name: '設備名',
        code: '設備ID',
        both: '設備ID ＋ 設備名',
      },
    ],
    ['equipment', 'equipmentLabelSize', '設備ラベルの文字サイズ', 'number', 11, 8, 22, 'px'],
    ['equipment', 'equipmentOpacity', '設備アイコンの濃さ', 'number', 100, 25, 100, '%'],
    [
      'equipment',
      'equipmentColors',
      '設備アイコンの色分け',
      'select',
      'type',
      {
        type: '設備の種類',
        layer: 'レイヤーの色',
        single: '単色',
      },
    ],
    ['equipment', 'equipmentColor', '設備アイコンの共通色', 'color', '#417e70'],
    [
      'equipment',
      'equipmentShape',
      '設備アイコンの形',
      'select',
      'rounded',
      {
        rounded: '角丸',
        circle: '円形',
        square: '四角',
      },
    ],
    ['equipment', 'lockBadges', 'ロックマークを表示', 'boolean', true],
    ['equipment', 'equipmentDrag', 'ドラッグで設備を移動', 'boolean', true],
    ['works', 'workLabelSize', '工事の吹き出しサイズ', 'number', 11, 8, 24, 'px'],
    [
      'works',
      'workScale',
      '工事の吹き出しのズーム連動',
      'select',
      'gentle',
      {
        fixed: '固定する',
        gentle: '緩やかに連動',
        map: '図面と同じ倍率',
      },
    ],
    [
      'works',
      'workLabels',
      '工事の吹き出し表示',
      'select',
      'always',
      {
        always: '常に表示',
        hover: 'ホバー時',
        none: '表示しない',
      },
    ],
    [
      'works',
      'workLabelContent',
      '吹き出しの内容',
      'select',
      'title',
      {
        title: '工事名',
        code: '工事ID ＋ 工事名',
        dates: '工事名 ＋ 期間',
      },
    ],
    ['works', 'workLabelWidth', '吹き出しの最大幅', 'number', 240, 100, 420, 'px'],
    ['works', 'workLabelOpacity', '吹き出しの濃さ', 'number', 97, 45, 100, '%'],
    [
      'works',
      'workColors',
      '工事範囲の色分け',
      'select',
      'status',
      {
        status: '工事の状態',
        layer: 'レイヤーの色',
      },
    ],
    ['works', 'workFill', '工事範囲の塗りの濃さ', 'number', 13, 0, 65, '%'],
    ['works', 'workStroke', '工事範囲の線の太さ', 'number', 2, 1, 6, 'px'],
    ['works', 'plannedDashed', '予定の工事を破線で表示', 'boolean', true],
    ['works', 'showCompleted', '完了した工事を表示', 'boolean', true],
    ['works', 'activeColor', '工事中の色', 'color', '#d79652'],
    ['works', 'plannedColor', '予定の色', 'color', '#779ed0'],
    ['works', 'doneColor', '完了の色', 'color', '#9aaf8a'],
    ['map', 'background', '地図の背景色', 'color', '#f4f6ee'],
    [
      'map',
      'grid',
      '地図の背景模様',
      'select',
      'dots',
      {
        dots: 'ドット',
        lines: '方眼',
        none: 'なし',
      },
    ],
    ['map', 'gridSize', '背景模様の間隔', 'number', 20, 10, 60, 'px'],
    ['map', 'drawingOpacity', '図面の濃さ', 'number', 100, 20, 100, '%'],
    ['map', 'north', '方位マークを表示', 'boolean', true],
    ['map', 'scaleBar', '縮尺を表示', 'boolean', true],
    ['map', 'legend', '工事の凡例を表示', 'boolean', true],
    ['map', 'coordinates', 'カーソル位置の座標を表示', 'boolean', false],
    ['notes', 'noteOpacity', '付箋の濃さ', 'number', 100, 30, 100, '%'],
    ['notes', 'noteShadow', '付箋に影を付ける', 'boolean', true],
    ['layout', 'summary', '工事サマリーを表示', 'boolean', true],
    ['layout', 'footer', '図面下の補足を表示', 'boolean', true],
    ['layout', 'leftWidth', '一覧パネルの幅', 'number', 300, 240, 440, 'px'],
    ['layout', 'rightWidth', '詳細パネルの幅', 'number', 290, 240, 440, 'px'],
    ['operation', 'wheelZoom', 'マウスホイールでズーム', 'boolean', true],
    ['operation', 'doubleClickZoom', 'ダブルクリックでズーム', 'boolean', true],
    ['operation', 'zoomButtons', 'ズームボタンを表示', 'boolean', true],
    [
      'operation',
      'zoomPosition',
      'ズームボタンの位置',
      'select',
      'topleft',
      {
        topleft: '左上',
        topright: '右上',
        bottomleft: '左下',
        bottomright: '右下',
      },
    ],
    ['operation', 'minimumScale', 'ズーム連動時の最小倍率', 'number', 45, 25, 90, '%'],
    ['operation', 'linkAreas', '詳細図面へのリンク範囲を表示', 'boolean', true],
  ].map(([section, key, label, type, value, min, max, unit]) => ({
    section,
    key,
    label,
    type,
    value,
    ...(type === 'number'
      ? {
          min,
          max,
          unit,
        }
      : type === 'select'
        ? {
            choices: min,
          }
        : {}),
  }));
  const defaults = Object.fromEntries(fields.map((f) => [f.key, f.value]));
  /**
   * 定義した項目だけを初期値へ重ね、型・範囲・選択肢を共通の規則で確認します。
   * 画面での復元は不正値を初期値に戻し、APIのstrict検証では不正値を例外にします。
   */
  function normalize(input = {}, strict = false) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      if (strict) {
        throw new Error('表示設定が不正です。');
      }
      input = {};
    }
    const result = {
      ...defaults,
    };
    for (const f of fields) {
      const v = input[f.key];
      if (v === undefined) {
        continue;
      }
      const valid =
        f.type === 'number'
          ? typeof v === 'number' && Number.isFinite(v) && v >= f.min && v <= f.max
          : f.type === 'boolean'
            ? typeof v === 'boolean'
            : f.type === 'color'
              ? typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
              : Object.hasOwn(f.choices, v);
      if (valid) {
        result[f.key] = v;
      } else if (strict) {
        throw new Error(f.label + 'の値を確認してください。');
      }
    }
    return result;
  }
  const presets = {
    announcements: {
      label: '工事の周知',
      values: {
        equipmentLabels: 'none',
        workLabels: 'always',
        workLabelSize: 12,
        workScale: 'gentle',
        workFill: 18,
        summary: true,
      },
    },
    inspection: {
      label: '巡回・点検',
      values: {
        iconSize: 40,
        equipmentLabels: 'always',
        equipmentLabelContent: 'both',
        workLabels: 'hover',
        workFill: 8,
        coordinates: true,
      },
    },
    drawing: {
      label: '図面を中心に',
      values: {
        iconSize: 24,
        iconScale: 'gentle',
        workLabels: 'hover',
        workFill: 7,
        summary: false,
        grid: 'none',
        north: false,
      },
    },
    overview: {
      label: '全体を俯瞰',
      values: {
        iconSize: 28,
        workLabelSize: 10,
        iconScale: 'gentle',
        workScale: 'gentle',
        workLabelWidth: 180,
        workFill: 12,
        equipmentLabels: 'hover',
      },
    },
  };
  const api = {
    fields,
    defaults,
    normalize,
    presets,
  };
  if (typeof module !== 'undefined') {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.FactoryAppearance = api;
  }
})();
