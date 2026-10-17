import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../../db/db';
import type { Block, CardRow } from '../../db/schema';
import { InkBlock } from '../ink/InkBlock';
import { childrenMap } from '../notes/blocks';
import { renderText } from '../notes/render';

function Html({ html, className }: { html: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

function BlockContent({ b }: { b: Block }) {
  if (b.kind === 'ink') return <InkBlock block={b} readOnly />;
  return <Html className={b.heading ? `h${b.heading}` : undefined} html={renderText(b.text, { showSeparator: true })} />;
}

/** Дочерние блоки вопроса — часть ответа (только чтение). */
function ReadOnlyTree({ kids, parentId }: { kids: Map<string | null, Block[]>; parentId: string }) {
  const list = kids.get(parentId) ?? [];
  if (!list.length) return null;
  return (
    <ul className="ro-tree">
      {list.map((b) => (
        <li key={b.id}>
          <BlockContent b={b} />
          <ReadOnlyTree kids={kids} parentId={b.id} />
        </li>
      ))}
    </ul>
  );
}

/** Карточка-список: пункты открываются по одному. */
function ListAnswer({ items, kids }: { items: Block[]; kids: Map<string | null, Block[]> }) {
  const [shown, setShown] = useState(1);
  return (
    <div>
      <ol className="ro-tree list-answer">
        {items.slice(0, shown).map((b) => (
          <li key={b.id}>
            <BlockContent b={b} />
            <ReadOnlyTree kids={kids} parentId={b.id} />
          </li>
        ))}
      </ol>
      {shown < items.length && (
        <button className="btn small" onClick={() => setShown((n) => n + 1)}>
          Следующий пункт ({shown}/{items.length})
        </button>
      )}
    </div>
  );
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Множественный выбор: первый дочерний блок — правильный ответ. */
function Choices({ options, correctId, revealed, onReveal }: { options: Block[]; correctId: string; revealed: boolean; onReveal: () => void }) {
  const order = useMemo(() => shuffle(options), [options]);
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="choices">
      {order.map((b, i) => {
        const state = revealed ? (b.id === correctId ? ' correct' : b.id === picked ? ' wrong' : '') : '';
        return (
          <button
            key={b.id}
            className={'choice' + state}
            disabled={revealed}
            onClick={() => {
              setPicked(b.id);
              onReveal();
            }}
          >
            <span className="choice-letter">{String.fromCharCode(65 + i)}</span>
            <BlockContent b={b} />
          </button>
        );
      })}
    </div>
  );
}

export function CardFace({ card, revealed, onReveal }: { card: CardRow; revealed: boolean; onReveal: () => void }) {
  const data = useLiveQuery(async () => {
    const block = await db.blocks.get(card.blockId);
    if (!block) return null;
    const [all, doc] = await Promise.all([db.blocks.where('docId').equals(block.docId).toArray(), db.docs.get(block.docId)]);
    return { block, kids: childrenMap(all), docTitle: doc?.title ?? '' };
  }, [card.blockId]);

  const front = useMemo(
    () =>
      card.kind === 'cloze'
        ? renderText(card.front, { cloze: { group: card.sub ?? '', reveal: revealed }, showSeparator: false })
        : renderText(card.front, { showSeparator: false, concept: card.concept && card.kind === 'forward' }),
    [card, revealed],
  );
  const back = useMemo(
    () => (card.kind === 'cloze' || !card.back ? '' : renderText(card.back, { showSeparator: false, concept: card.concept && card.kind === 'backward' })),
    [card],
  );
  const children = (data?.kids.get(card.blockId) ?? []) as Block[];
  const label = { forward: '', backward: ' · обратная', cloze: '', list: ' · список', mcq: ' · выбор ответа', occlusion: '' }[card.kind];

  return (
    <div className="card-face">
      {data?.docTitle && (
        <div className="card-source">
          {data.docTitle}
          {label}
        </div>
      )}
      <Html className="card-front" html={front} />
      {card.kind === 'mcq' && data && children.length > 0 && <Choices options={children} correctId={children[0].id} revealed={revealed} onReveal={onReveal} />}
      {revealed && card.kind === 'list' && data && (
        <div className="card-back">
          <ListAnswer items={children} kids={data.kids} />
        </div>
      )}
      {revealed && card.kind !== 'list' && card.kind !== 'mcq' && (back || children.length > 0) && (
        <div className="card-back">
          {back && <Html html={back} />}
          {data && <ReadOnlyTree kids={data.kids} parentId={card.blockId} />}
        </div>
      )}
    </div>
  );
}
