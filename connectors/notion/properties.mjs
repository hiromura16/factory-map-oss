/**
 * 独自属性とNotionの列定義・プロパティ値の変換。
 * 選択肢と関係の識別子を保ち、表示名の変更だけで保存値が失われないようにします。
 */
import { NotionError, richText, plainText } from './client.mjs';
export function propertySchema(f, resolveSourceId) {
  if (f.type === 'relation') {
    return {
      relation: {
        data_source_id: resolveSourceId(f.target),
        type: 'single_property',
        single_property: {},
      },
    };
  }
  if (['select', 'multi_select'].includes(f.type)) {
    return {
      [f.type]: {
        options: Object.values(f.options || {}).map((name) => ({
          name,
          color: 'default',
        })),
      },
    };
  }
  return {
    [f.type]:
      f.type === 'number'
        ? {
            format: 'number',
          }
        : {},
  };
}
export function encodeProperty(f, value, { resolvePageId } = {}) {
  if (f.type === 'relation') {
    const ids = f.many ? value : value ? [value] : [];
    if (ids.length > 100) {
      throw new NotionError('relation_limit', '関連項目を100件以内に分けてください。', {
        status: 422,
      });
    }
    return {
      relation: ids.map((id) => {
        const page = resolvePageId?.(f.target, id);
        if (!page) {
          throw new NotionError('unresolved_relation', f.name + 'の関連項目が未同期です。', {
            status: 422,
          });
        }
        return {
          id: page,
        };
      }),
    };
  }
  if (f.type === 'number') {
    return {
      number: value ?? null,
    };
  }
  if (f.type === 'checkbox') {
    return {
      checkbox: value === true,
    };
  }
  if (f.type === 'date') {
    return {
      date: value
        ? {
            start: value,
          }
        : null,
    };
  }
  if (f.type === 'url') {
    return {
      url: value || null,
    };
  }
  if (f.type === 'select') {
    if (value && !Object.hasOwn(f.options || {}, value)) {
      throw new NotionError('unknown_option', f.name + 'の選択肢が不明です。', {
        status: 422,
      });
    }
    return {
      select: value
        ? {
            name: f.options[value],
          }
        : null,
    };
  }
  if (f.type === 'multi_select') {
    return {
      multi_select: (value || []).map((v) => ({
        name: f.options?.[v] || v,
      })),
    };
  }
  return {
    [f.type]: richText(f.json ? JSON.stringify(value) : value),
  };
}
export function decodeProperty(f, p, { resolveLocalId } = {}) {
  if (!p || p.type !== f.type) {
    throw new NotionError('property_type', f.name + 'の列の型が変更されています。', {
      status: 422,
    });
  }
  if (f.type === 'relation') {
    const ids = p.relation.map((r) => {
      const id = resolveLocalId?.(f.target, r.id);
      if (!id) {
        throw new NotionError('unresolved_relation', f.name + 'に未同期の関連項目があります。', {
          status: 422,
        });
      }
      return id;
    });
    if (!f.many && ids.length > 1) {
      throw new NotionError('relation_count', f.name + 'は1件を選択してください。', {
        status: 422,
      });
    }
    return f.many ? ids.sort() : ids[0] || '';
  }
  if (f.type === 'number') {
    return p.number;
  }
  if (f.type === 'checkbox') {
    return p.checkbox;
  }
  if (f.type === 'date') {
    return p.date?.start?.slice(0, 10) || '';
  }
  if (f.type === 'url') {
    return p.url || '';
  }
  const option = (name) => {
    if (!name) {
      return '';
    }
    const id = Object.entries(f.options || {}).find(([, v]) => v === name)?.[0];
    if (id === undefined) {
      throw new NotionError('unknown_option', f.name + 'の選択肢を同期元にも追加してください。', {
        status: 422,
      });
    }
    return id;
  };
  if (f.type === 'select') {
    return option(p.select?.name);
  }
  if (f.type === 'multi_select') {
    return p.multi_select.map((v) => (f.options ? option(v.name) : v.name)).sort();
  }
  const text = plainText(p[f.type]);
  if (f.json) {
    try {
      return JSON.parse(text || '[]');
    } catch {
      throw new NotionError('invalid_json', f.name + 'のJSON形式を確認してください。', {
        status: 422,
      });
    }
  }
  return text;
}
