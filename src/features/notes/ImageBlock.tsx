import { MenuButton } from '../../components/Menu';
import { dialog } from '../../components/dialog';
import { useFileUrl } from '../../components/useFileUrl';
import type { Block } from '../../db/schema';
import { db } from '../../db/db';
import { deleteBlock } from './blocks';

const WIDTHS = [
  { v: 1, label: 'Во всю ширину' },
  { v: 0.66, label: '2/3 ширины' },
  { v: 0.5, label: 'Половина ширины' },
  { v: 0.33, label: 'Треть ширины' },
];

export function ImageBlock({ block, readOnly }: { block: Block; readOnly?: boolean }) {
  const img = block.image;
  const url = useFileUrl(img?.fileId);
  if (!img) return <div className="muted small">Картинка не найдена</div>;
  const w = img.displayWidth ?? 1;
  return (
    <div className="image-block">
      <div className="image-frame" style={{ width: `${w * 100}%`, aspectRatio: `${img.width} / ${img.height}` }}>
        {url && <img src={url} alt="" draggable={false} />}
      </div>
      {!readOnly && (
        <div className="image-menu">
          <MenuButton
            label="Действия с картинкой"
            items={[
              ...WIDTHS.map((x) => ({
                label: (Math.abs(x.v - w) < 0.01 ? '✓ ' : '') + x.label,
                onClick: () => db.blocks.update(block.id, { image: { ...img, displayWidth: x.v } }),
              })),
              {
                label: 'Удалить картинку',
                icon: 'trash' as const,
                danger: true,
                onClick: async () => {
                  if (await dialog.confirm('Удалить картинку?', 'Удалить')) deleteBlock(block);
                },
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
