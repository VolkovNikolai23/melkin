import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo } from 'react';
import { db } from '../db/db';

/** object URL для Blob из таблицы files (освобождается при размонтировании). */
export function useFileUrl(fileId: string | undefined): string | null {
  const row = useLiveQuery(() => (fileId ? db.files.get(fileId) : undefined), [fileId]);
  const url = useMemo(() => (row ? URL.createObjectURL(row.blob) : null), [row]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url;
}
