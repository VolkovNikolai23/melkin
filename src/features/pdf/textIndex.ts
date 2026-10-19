// Текст PDF и презентаций для поиска по всему приложению. Извлекается pdf.js один раз
// и хранится в meta (ключ pdftext:<файл>), чтобы поиск работал быстро и офлайн.
import { db, getMeta, setMeta } from '../../db/db';

const key = (fileId: string) => 'pdftext:' + fileId;
const running = new Map<string, Promise<void>>();

export function getPdfIndex(fileId: string): Promise<string[] | null> {
  return getMeta<string[] | null>(key(fileId), null);
}

/** Извлечь и сохранить текст страниц (в фоне; повторные вызовы ждут одну работу). */
export function ensurePdfIndex(fileId: string): Promise<void> {
  let p = running.get(fileId);
  if (!p) {
    p = (async () => {
      if (await getPdfIndex(fileId)) return;
      const { pdfText } = await import('./pdfjs');
      await setMeta(key(fileId), await pdfText(fileId));
    })()
      .catch(() => {
        /* повреждённый PDF — просто не ищется по тексту */
      })
      .finally(() => running.delete(fileId));
    running.set(fileId, p);
  }
  return p;
}

export interface PdfHit {
  docId: string;
  title: string;
  page: number;
  text: string;
}

/** Поиск по тексту всех PDF; ещё не проиндексированные ставятся в очередь. */
export async function searchPdfs(q: string, docs: { id: string; title: string; type: string; fileId?: string }[], limit = 30): Promise<PdfHit[]> {
  const hits: PdfHit[] = [];
  for (const d of docs) {
    if (d.type !== 'pdf' || !d.fileId) continue;
    const pages = await getPdfIndex(d.fileId);
    if (!pages) {
      void ensurePdfIndex(d.fileId);
      continue;
    }
    pages.forEach((t, i) => {
      if (hits.length < limit && t.toLowerCase().includes(q)) hits.push({ docId: d.id, title: d.title, page: i + 1, text: t });
    });
  }
  return hits;
}

/** Удалить индекс вместе с файлом. */
export function dropPdfIndex(fileId: string) {
  return db.meta.delete(key(fileId));
}
