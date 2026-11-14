/**
 * ASCII DXFの図形をマップ用データへ変換するアダプター。
 * 図面のローカルXY座標を扱い、単位とブロック変換を適用します。DWGの直接解析は対象外です。
 */
(() => {
  'use strict';

  const supported = new Set([
    'LINE',
    'LWPOLYLINE',
    'POLYLINE',
    'CIRCLE',
    'ARC',
    'ELLIPSE',
    'TEXT',
    'MTEXT',
    'INSERT',
    'POINT',
    'SOLID',
    '3DFACE',
  ]);
  const unitScale = {
    1: 0.0254,
    2: 0.3048,
    4: 0.001,
    5: 0.01,
    6: 1,
    7: 1000,
    8: 0.0000000254,
    9: 0.0000254,
    10: 0.9144,
    14: 0.1,
  };
  const multiply = (a, b) => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const point = (p, t) => [t[0] * p.x + t[2] * p.y + t[4], t[1] * p.x + t[3] * p.y + t[5]];
  const finitePoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  /**
   * DXFのbulgeで表す円弧を表示用の点列へ近似します。
   * 分割数を制限して過剰な頂点生成を避け、元の始終点と曲がる方向を保ちます。
   */
  function bulgePoints(vertices, closed) {
    const result = [];
    vertices.forEach((a, i) => {
      result.push(a);
      const b = vertices[(i + 1) % vertices.length];
      if ((!closed && i === vertices.length - 1) || !b || !a.bulge || !Number.isFinite(a.bulge)) {
        return;
      }
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      if (!chord) {
        return;
      }
      const theta = 4 * Math.atan(a.bulge);
      const offset = (chord * (1 - a.bulge * a.bulge)) / (4 * a.bulge);
      const cx = (a.x + b.x) / 2 - ((b.y - a.y) / chord) * offset;
      const cy = (a.y + b.y) / 2 + ((b.x - a.x) / chord) * offset;
      const r = Math.hypot(a.x - cx, a.y - cy);
      const start = Math.atan2(a.y - cy, a.x - cx);
      const steps = Math.min(128, Math.max(5, Math.ceil(Math.abs(theta) * 16)));
      for (let j = 1; j < steps; j++) {
        const angle = start + (theta * j) / steps;
        result.push({
          x: cx + r * Math.cos(angle),
          y: cy + r * Math.sin(angle),
        });
      }
    });
    return result;
  }
  function parse(text) {
    if (typeof text !== 'string' || text.length > 10 * 1024 * 1024) {
      throw new Error('DXFは10MBまでです。図面を分割して読み込んでください。');
    }
    if (text.startsWith('AutoCAD Binary DXF')) {
      throw new Error('バイナリDXFには対応していません。ASCII DXF形式で保存し直してください。');
    }
    if (!/\bSECTION\b/.test(text) || !/\bEOF\b/.test(text)) {
      throw new Error('DXF形式を確認できません。ASCII DXFファイルを選んでください。');
    }
    const dxf = new DxfParser().parseSync(text);
    if (!dxf || !Array.isArray(dxf.entities)) {
      throw new Error('図形データを読み取れませんでした。');
    }
    const scale = unitScale[dxf.header?.$INSUNITS] || 1;
    const features = [];
    const skipped = {};
    const layers = new Set();
    // パーサーが返さない未対応図形もあるため、元のエンティティ見出しから省略件数を数えます。
    const rows = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
    let section = '';
    let wantSection = false;
    for (let i = 0; i + 1 < rows.length; i += 2) {
      const code = rows[i].trim();
      const value = rows[i + 1].trim();
      if (code === '0' && value === 'SECTION') {
        wantSection = true;
        continue;
      }
      if (wantSection && code === '2') {
        section = value;
        wantSection = false;
        continue;
      }
      if (code === '0' && value === 'ENDSEC') {
        section = '';
        continue;
      }
      if (
        code === '0' &&
        ['ENTITIES', 'BLOCKS'].includes(section) &&
        !supported.has(value) &&
        !['BLOCK', 'ENDBLK', 'VERTEX', 'SEQEND'].includes(value)
      ) {
        skipped[value] = (skipped[value] || 0) + 1;
      }
    }
    let visited = 0;
    const add = (kind, points, layer, extra = {}) => {
      if (
        points.length === 0 ||
        points.some((p) => !p.every(Number.isFinite) || p.some((n) => Math.abs(n) > 1e12))
      ) {
        return;
      }
      if (features.length >= 100000) {
        throw new Error('図形が多すぎます。10万要素以下に分割してください。');
      }
      features.push({
        kind,
        points,
        layer,
        ...extra,
      });
      layers.add(layer);
    };
    function walk(entities, transform, depth = 0, parentLayer = '0') {
      if (depth > 8) {
        skipped['深いブロック参照'] = (skipped['深いブロック参照'] || 0) + 1;
        return;
      }
      for (const e of entities) {
        if (++visited > 150000) {
          throw new Error('図形が多すぎます。対象の棟・レイヤーに分割してください。');
        }
        if (e.inPaperSpace || e.paperSpace) {
          continue;
        }
        const layer = e.layer && e.layer !== '0' ? e.layer : parentLayer;
        if (!supported.has(e.type)) {
          continue;
        }
        if (e.type === 'INSERT') {
          const block = dxf.blocks?.[e.name];
          if (!block) {
            skipped.INSERT = (skipped.INSERT || 0) + 1;
            continue;
          }
          const a = ((e.rotation || 0) * Math.PI) / 180;
          const c = Math.cos(a);
          const s = Math.sin(a);
          const sx = e.xScale ?? 1;
          const sy = e.yScale ?? 1;
          const base = block.position || {
            x: 0,
            y: 0,
          };
          const pos = e.position || {
            x: 0,
            y: 0,
          };
          const m = [
            c * sx,
            s * sx,
            -s * sy,
            c * sy,
            pos.x - c * sx * base.x + s * sy * base.y,
            pos.y - s * sx * base.x - c * sy * base.y,
          ];
          walk(block.entities || [], multiply(transform, m), depth + 1, layer);
          continue;
        }
        if (e.type === 'TEXT' || e.type === 'MTEXT') {
          const p = e.startPoint || e.position;
          if (finitePoint(p)) {
            add('text', [point(p, transform)], layer, {
              text: String(e.text || '')
                .replace(/\\P/g, ' ')
                .replace(/\\[A-Za-z][^;]*;/g, '')
                .replace(/[{}]/g, '')
                .slice(0, 300),
              height: (e.textHeight || e.height || 1) * scale,
            });
          }
          continue;
        }
        if (e.type === 'POINT') {
          if (finitePoint(e.position)) {
            add('point', [point(e.position, transform)], layer);
          }
          continue;
        }
        if (e.type === 'CIRCLE' || e.type === 'ARC' || e.type === 'ELLIPSE') {
          if (!finitePoint(e.center)) {
            continue;
          }
          const start = e.type === 'CIRCLE' ? 0 : (e.startAngle ?? 0);
          let end = e.type === 'CIRCLE' ? Math.PI * 2 : (e.endAngle ?? Math.PI * 2);
          while (end <= start) {
            end += Math.PI * 2;
          }
          const sweep = Math.min(end - start, Math.PI * 2);
          const steps = Math.min(200, Math.max(16, Math.ceil(sweep * 24)));
          const points = [];
          for (let i = 0; i <= steps; i++) {
            const a = start + (sweep * i) / steps;
            let p;
            if (e.type === 'ELLIPSE') {
              const v = e.majorAxisEndPoint;
              if (!finitePoint(v)) {
                break;
              }
              const ratio = e.axisRatio ?? 1;
              p = {
                x: e.center.x + v.x * Math.cos(a) - v.y * ratio * Math.sin(a),
                y: e.center.y + v.y * Math.cos(a) + v.x * ratio * Math.sin(a),
              };
            } else {
              if (!Number.isFinite(e.radius) || e.radius <= 0) {
                break;
              }
              p = {
                x: e.center.x + e.radius * Math.cos(a),
                y: e.center.y + e.radius * Math.sin(a),
              };
            }
            points.push(point(p, transform));
          }
          add('line', points, layer);
          continue;
        }
        let vertices = (e.vertices || e.points || []).filter(finitePoint);
        if (vertices.length < 2) {
          continue;
        }
        const closed = !!e.shape || e.type === 'SOLID' || e.type === '3DFACE';
        vertices = bulgePoints(vertices, closed);
        add(
          closed ? 'polygon' : 'line',
          vertices.map((p) => point(p, transform)),
          layer,
        );
      }
    }
    walk(dxf.entities, [scale, 0, 0, scale, 0, 0]);
    const geometry = features.filter((f) => f.kind !== 'text');
    if (!geometry.length) {
      throw new Error('表示できる2Dの線・図形がありませんでした。');
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const f of geometry) {
      for (const [x, y] of f.points) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    const span = Math.max(maxX - minX, maxY - minY);
    if (!span || !Number.isFinite(span)) {
      throw new Error('図面の範囲を計算できませんでした。');
    }
    return {
      features,
      layers: [...layers].sort(),
      bounds: [
        [minY, minX],
        [maxY, maxX],
      ],
      skipped,
      units: dxf.header?.$INSUNITS ? `図面単位コード ${dxf.header.$INSUNITS}` : '単位指定なし',
      metres: !!unitScale[dxf.header?.$INSUNITS],
    };
  }
  window.FactoryCAD = {
    parse,
  };
})();
