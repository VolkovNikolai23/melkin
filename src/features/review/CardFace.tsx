import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../../db/db';
import type { Block, CardRow } from '../../db/schema';
import { InkBlock } from '../ink/InkBlock';
import { childrenMap } from '../notes/blocks';
import { renderText } from '../notes/render';

function Html({ html, className }: { html: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Дочерние блоки вопроса — часть ответа (только чтение). */
function ReadOnlyTree({ kids, parentId }: { kids: Map<string | null, Block[]>; parentId: string }) {
  const list = kids.get(parentId) ?? [];
  if (!list.length) return null;
  return (
    <ul className="ro-tree">
      {list.map((b) => (
        <li key={b.id}>
          {b.kind === 'ink' ? <InkBlock block={b} readOnly /> : <Html html={renderText(b.text, { showSeparator: true })} />}
          <ReadOnlyTree kids={kids} parentId={b.id} />
        </li>
      ))}
    </ul>
  );
}

export function CardFace({ card, revealed }: { card: CardRow; revealed: boolean }) {
  const data = useLiveQuery(async () => {
    const block = await db.blocks.get(card.blockId);
    if (!block) return null;
    const [all, doc] = await Promise.all([db.blocks.where('docId').equals(block.docId).toArray(), db.docs.get(block.docId)]);
    return { block, kids: childrenMap(all), docTitle: doc?.title ?? '' };
  }, [card.blockId]);

  const front = useMemo(
    () =>
      card.kind === 'cloze'
        ? renderText(card.front, { cloze: { index: card.clozeIndex ?? 0, reveal: revealed }, showSeparator: false })
        : renderText(card.front, { showSeparator: false }),
    [card, revealed],
  );
  const back = useMemo(() => (card.kind === 'cloze' ? '' : renderText(card.back, { showSeparator: false })), [card]);
  const hasKids = !!data && (data.kids.get(card.blockId)?.length ?? 0) > 0;

  return (
    <div className="card-face">
      {data?.docTitle && <div className="card-source">{data.docTitle}{card.kind === 'reverse' ? ' · обратная' : ''}</div>}
      <Html className="card-front" html={front} />
      {revealed && (back || hasKids) && (
        <div className="card-back">
          {back && <Html html={back} />}
          {data && <ReadOnlyTree kids={data.kids} parentId={card.blockId} />}
        </div>
      )}
    </div>
  );
}
