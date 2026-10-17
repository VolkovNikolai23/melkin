import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { dialog } from '../../components/dialog';
import { db } from '../../db/db';
import type { Block } from '../../db/schema';
import { normalizeTag } from '../../lib/markup';
import { navigate } from '../../lib/router';
import { plural } from '../../lib/time';
import { renderText } from '../notes/render';
import { stripTags } from '../cards/parser';
import { backlinksQuery } from './links';

function useDocTitles(blocks: Block[] | undefined) {
  return useLiveQuery(async () => {
    const ids = [...new Set((blocks ?? []).map((b) => b.docId))];
    return new Map((await db.docs.bulkGet(ids)).filter(Boolean).map((d) => [d!.id, d!.title]));
  }, [blocks]);
}

/** Обратные ссылки: блоки из других мест, которые ссылаются на документ. */
export function Backlinks({ docId }: { docId: string }) {
  const blocks = useLiveQuery(() => backlinksQuery(docId), [docId]);
  const titles = useDocTitles(blocks);
  if (!blocks?.length) return null;
  return (
    <section className="backlinks">
      <h3>
        <Icon name="backlink" size={18} /> Обратные ссылки · {blocks.length}
      </h3>
      {blocks.map((b) => (
        <button key={b.id} className="backlink" onClick={() => navigate(`doc/${b.docId}?b=${b.id}`)}>
          <small>{titles?.get(b.docId) ?? ''}</small>
          <span dangerouslySetInnerHTML={{ __html: renderText(b.text) }} />
        </button>
      ))}
    </section>
  );
}

/**
 * Таблица блоков с тегом: строка — блок, столбцы — его свойства.
 * Ячейки редактируются прямо здесь (меняют свойства исходных блоков).
 */
export function TagTable({ tag, title }: { tag: string; title?: string }) {
  const t = normalizeTag(tag);
  const blocks = useLiveQuery(() => db.blocks.where('tags').equals(t).toArray(), [t]);
  const titles = useDocTitles(blocks);
  const [extra, setExtra] = useState<string[]>([]);
  const cols = useMemo(() => {
    const set = new Set<string>();
    for (const b of blocks ?? []) for (const k of Object.keys(b.props ?? {})) set.add(k);
    for (const k of extra) set.add(k);
    return [...set];
  }, [blocks, extra]);

  if (!blocks) return null;
  if (!blocks.length) return title ? null : <p className="muted">С тегом #{t} пока нет блоков.</p>;

  const setCell = async (b: Block, key: string, value: string) => {
    const props = { ...(b.props ?? {}) };
    if (value.trim()) props[key] = value.trim();
    else delete props[key];
    await db.blocks.update(b.id, { props: Object.keys(props).length ? props : undefined, updatedAt: Date.now() });
  };

  return (
    <section className="tag-table-wrap">
      {title && (
        <h3>
          <Icon name="table" size={18} /> {title}
        </h3>
      )}
      <div className="tag-table-scroll">
        <table className="tag-table">
          <thead>
            <tr>
              <th>Блок</th>
              {cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
              <th className="add-col">
                <button
                  className="icon-btn small"
                  aria-label="Добавить столбец"
                  onClick={async () => {
                    const name = (await dialog.prompt('Название свойства'))?.trim();
                    if (name && !cols.includes(name)) setExtra([...extra, name]);
                  }}
                >
                  <Icon name="plus" size={18} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.id}>
                <td>
                  <button className="cell-link" onClick={() => navigate(`doc/${b.docId}?b=${b.id}`)}>
                    <span dangerouslySetInnerHTML={{ __html: renderText(stripTags(b.text)) }} />
                    <small>{titles?.get(b.docId)}</small>
                  </button>
                </td>
                {cols.map((c) => (
                  <td key={c}>
                    <input
                      className="cell-input"
                      defaultValue={b.props?.[c] ?? ''}
                      key={b.props?.[c] ?? ''}
                      aria-label={c}
                      onBlur={(e) => e.target.value !== (b.props?.[c] ?? '') && setCell(b, c, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TagPage({ tag }: { tag: string }) {
  const t = normalizeTag(tag);
  const cards = useLiveQuery(async () => {
    const ids = (await db.blocks.where('tags').equals(t).primaryKeys()) as string[];
    return db.cards.where('blockId').anyOf(ids).count();
  }, [t]);
  return (
    <div className="page-pad">
      <div className="doc-head-row">
        <h1 className="tag-title">#{t}</h1>
        {(cards ?? 0) > 0 && (
          <button className="btn small" onClick={() => navigate(`review?scope=tag:${encodeURIComponent(t)}`)}>
            <Icon name="cards" size={18} /> Повторить ({cards})
          </button>
        )}
      </div>
      <TagTable tag={t} />
    </div>
  );
}

export function TagsView() {
  const tags = useLiveQuery(async () => {
    const counts = new Map<string, number>();
    await db.blocks.filter((b) => (b.tags?.length ?? 0) > 0).each((b) => b.tags.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1)));
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, []);
  return (
    <div className="page-pad">
      <h1>Теги</h1>
      {tags && !tags.length && <p className="muted">Пока нет тегов. Напишите в любом блоке #тег.</p>}
      <div className="tag-cloud">
        {tags?.map(([t, n]) => (
          <button key={t} className="tag-pill" onClick={() => navigate(`tag/${encodeURIComponent(t)}`)}>
            #{t} <small>{n} {plural(n, 'блок', 'блока', 'блоков')}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
