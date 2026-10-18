import type { IconName } from '../../components/Icon';
import type { Doc, DocType } from '../../db/schema';

export const TYPE_ICON: Record<DocType, IconName> = {
  folder: 'folder',
  note: 'note',
  notebook: 'notebook',
  pdf: 'pdf',
  daily: 'calendar',
  lecture: 'lecture',
};

/** Набор иконок, из которого выбирают иконку предмета, темы или папки. */
export const PICKABLE_ICONS: IconName[] = [
  'folder', 'book', 'lecture', 'leaf', 'dna', 'microscope', 'flask', 'atom',
  'brain', 'heart', 'globe', 'hanzi', 'calculator', 'laptop', 'music', 'palette',
  'star', 'sparkle', 'note', 'notebook',
];

/** Пастельные цвета и приглушённый винно-красный — для иконки и названия. */
export const PICKABLE_COLORS: { id: string; label: string; value: string }[] = [
  { id: '', label: 'Обычный', value: '' },
  { id: 'wine', label: 'Винный', value: '#9e3d5a' },
  { id: 'rose', label: 'Розовый', value: '#e27d9f' },
  { id: 'peach', label: 'Персиковый', value: '#e89a6f' },
  { id: 'butter', label: 'Медовый', value: '#c9a23a' },
  { id: 'mint', label: 'Мятный', value: '#4fa98a' },
  { id: 'sky', label: 'Голубой', value: '#5b9fd6' },
  { id: 'lilac', label: 'Сиреневый', value: '#9b84d6' },
];

export function docIcon(d: Pick<Doc, 'type' | 'icon' | 'role'>): IconName {
  if (d.icon && PICKABLE_ICONS.includes(d.icon as IconName)) return d.icon as IconName;
  if (d.type === 'folder' && d.role === 'subject') return 'book';
  return TYPE_ICON[d.type];
}
