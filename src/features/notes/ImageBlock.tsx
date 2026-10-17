import { useState } from 'react';
import { MenuButton } from '../../components/Menu';
import { dialog } from '../../components/dialog';
import { useFileUrl } from '../../components/useFileUrl';
import type { Block } from '../../db/schema';
import { db } from '../../db/db';
import { OcclusionEditor, OcclusionLayer } from '../cards/OcclusionEditor';
import { deleteBlock } from './blocks';

const WIDTHS = [
  { v: 1, label: 'Во всю ширину' },
  { v: 0.66, label: '2/3 ширины' },
  { v: 0.5, label: 'Половина ширины' },
  { v: 0.33, label: 'Треть ширины' },
];

/**
 * Блок-картинка. В заметке показывает контуры областей image occlusion;
 * в карточке (`target`) — маски для проверяемой области.
 */
export function ImageBlock({ block, readOnly, target, revealed }: { block: Block; readOnly?: boolean; target?: string; revealed?: boolean }) {
  const img = block.image;
  const url = useFileUrl(img?.fileId);
  const [editing, setEditing] = useState(false);
  if (!img) return <div className="muted small">Картинка не найдена</div>;
  const w = target ? 1 : (img.displayWidth ?? 1);
  const n = img.occlusions?.length ?? 0;
  return (
    <div className="image-block">
      <div className="image-frame" style={{ width: `${w * 100}%`, aspectRatio: `${img.width} / ${img.height}` }}>
        {url && <img src={url} alt="" draggable={false} />}
        {(n > 0 || target) && <OcclusionLayer image={img} target={target} revealed={revealed} />}
      </div>
      {!readOnly && (
        <div className="image-menu">
          <MenuButton
            label="Действия с картинкой"
            items={[
              { label: n ? `Области для карточек (${n})…` : 'Закрыть области → карточки…', icon: 'card', onClick: () => setEditing(true) },
              ...WIDTHS.map((x) => ({
                label: (Math.abs(x.v - w) < 0.01 ? '✓ ' : '') + x.label,
                onClick: () => db.blocks.update(block.id, { image: { ...img, displayWidth: x.v } }),
              })),
              {
                label: 'Удалить картинку',
                icon: 'trash' as const,
                danger: true,
                onClick: async () => {
                  const msg = n ? `Вместе с ней удалятся карточки областей (${n}).` : undefined;
                  if (await dialog.confirm('Удалить картинку?', 'Удалить', msg)) deleteBlock(block);
                },
              },
            ]}
          />
        </div>
      )}
      {editing && <OcclusionEditor block={block} onClose={() => setEditing(false)} />}
    </div>
  );
}
