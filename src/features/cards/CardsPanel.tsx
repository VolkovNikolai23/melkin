import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef } from 'react';
import { Icon } from '../../components/Icon';
import { dialog } from '../../components/dialog';
import { db } from '../../db/db';
import type { Block, CardRow } from '../../db/schema';
import { formatDate } from '../../lib/time';
import { navigate } from '../../lib/router';
import { setBlockProps } from '../notes/blocks';
import { renderText } from '../notes/render';
import { formatInterval, State } from '../review/scheduler';
import { resetCard, syncBlockCards } from './sync';

const KIND: Record<CardRow['kind'], string> = {
  forward: 'вперёд',
  backward: 'обратная',
  cloze: 'клоз',
  list: 'список',
  mcq: 'выбор ответа',
  occlusion: 'область',
};

function status(c: CardRow): string {
  if (c.disabled) return 'отключена';
  if (c.state === State.New) return 'новая';
  const left = c.due - Date.now();
  if (left <= 0) return 'пора повторить';
  return `через ${formatInterval(left)}`;
}


/** Карточки одного блока: что создалось, когда повторение, сброс и отключение. */
export function CardsPanel({ block, onClose }: { block: Block; onClose: () => void }) {
  const cards = useLiveQuery(() => db.cards.where('blockId').equals(block.id).toArray(), [block.id]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.card-badge, .modal-backdrop')) onClose();
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [onClose]);

  if (!cards) return null;
  return (
    <div ref={ref} className="cards-panel">
      <div className="cards-panel-head">
        <strong>Карточки блока · {cards.length}</strong>
        <button
          className="btn small ghost"
          onClick={async () => {
            await setBlockProps(block.id, { cardsOff: !block.cardsOff || undefined });
            await syncBlockCards(block.id);
          }}
        >
          <Icon name={block.cardsOff ? 'cards' : 'cardOff'} size={18} /> {block.cardsOff ? 'Включить' : 'Отключить'}
        </button>
      </div>
      {cards.map((c) => (
        <div key={c.id} className="cards-panel-row">
          <div className="cp-main">
            <span className="cp-kind">{KIND[c.kind]}</span>
            <span
              className="cp-front"
              dangerouslySetInnerHTML={{
                __html: renderText((c.kind === 'cloze' ? c.back : c.front) || '—', { showSeparator: false }),
              }}
            />
          </div>
          <div className="cp-meta">
            <span className={c.state === State.New ? 'cp-new' : ''}>{status(c)}</span>
            {c.reps > 0 && (
              <span className="muted">
                {' '}· повторений {c.reps}
                {c.lapses ? `, забыто ${c.lapses}` : ''}
                {c.last_review ? ` · последний раз ${formatDate(c.last_review)}` : ''}
              </span>
            )}
          </div>
          {c.reps > 0 && (
            <button
              className="btn small ghost"
              onClick={async () => {
                if (await dialog.confirm('Сбросить прогресс карточки?', 'Сбросить', 'Она снова станет новой. Журнал повторений сохранится.')) resetCard(c.id);
              }}
            >
              Сбросить
            </button>
          )}
        </div>
      ))}
      {cards.length > 0 && !block.cardsOff && (
        <button className="btn small" onClick={() => navigate(`review?scope=doc:${block.docId}`)}>
          <Icon name="cards" size={18} /> Повторить документ
        </button>
      )}
    </div>
  );
}
