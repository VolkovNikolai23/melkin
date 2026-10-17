import type { IconName } from '../../components/Icon';
import type { DocType } from '../../db/schema';

export const TYPE_ICON: Record<DocType, IconName> = { folder: 'folder', note: 'note', notebook: 'notebook', pdf: 'pdf', daily: 'calendar' };
