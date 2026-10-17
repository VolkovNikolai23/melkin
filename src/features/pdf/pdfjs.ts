// pdf.js подключается лениво: только когда открывают PDF. Воркер и ресурсы
// (шрифты, CMaps, wasm) лежат в бандле/public — работают офлайн.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { db } from '../../db/db';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const base = import.meta.env.BASE_URL + 'pdfjs/';
const cache = new Map<string, Promise<PDFDocumentProxy>>();

export function loadPdf(fileId: string): Promise<PDFDocumentProxy> {
  let p = cache.get(fileId);
  if (!p) {
    p = (async () => {
      const row = await db.files.get(fileId);
      if (!row) throw new Error('Файл PDF не найден');
      const data = new Uint8Array(await row.blob.arrayBuffer());
      return pdfjs.getDocument({
        data,
        cMapUrl: base + 'cmaps/',
        cMapPacked: true,
        standardFontDataUrl: base + 'standard_fonts/',
        wasmUrl: base + 'wasm/',
        iccUrl: base + 'iccs/',
      }).promise;
    })();
    p.catch(() => cache.delete(fileId));
    cache.set(fileId, p);
  }
  return p;
}

/** Текст всех страниц (для поиска), кэшируется. */
const textCache = new Map<string, Promise<string[]>>();
export function pdfText(fileId: string): Promise<string[]> {
  let p = textCache.get(fileId);
  if (!p) {
    p = loadPdf(fileId).then(async (doc) => {
      const out: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const tc = await (await doc.getPage(i)).getTextContent();
        out.push(tc.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join(''));
      }
      return out;
    });
    textCache.set(fileId, p);
  }
  return p;
}

export { pdfjs };
