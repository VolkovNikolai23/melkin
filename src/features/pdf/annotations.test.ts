import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { purgeDoc } from '../notes/docs';
import { addHighlight, createTargetNote, getTargetNote, highlightToBlock, importPdf, pageAnnotations, saveInk } from './annotations';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const pdfFile = () => new File([new Uint8Array([37, 80, 68, 70])], 'Лекция 3.pdf', { type: 'application/pdf' });

describe('PDF: импорт, аннотации, выделения → блоки', () => {
  it('импорт создаёт документ и файл', async () => {
    const d = await importPdf(pdfFile(), null);
    expect(d).toMatchObject({ type: 'pdf', title: 'Лекция 3' });
    expect((await db.files.get(d.fileId!))?.kind).toBe('pdf');
  });

  it('рукописный слой — одна запись на страницу', async () => {
    const d = await importPdf(pdfFile(), null);
    const s = { id: 's', tool: 'pen' as const, color: 'auto', size: 2, points: [1, 2, 0.5] };
    await saveInk(d.id, 2, [s]);
    await saveInk(d.id, 2, [s, { ...s, id: 't' }]);
    const anns = await pageAnnotations(d.id, 2);
    expect(anns).toHaveLength(1);
    expect(anns[0].strokes).toHaveLength(2);
  });

  it('выделение → карточка в конспекте со ссылкой на страницу', async () => {
    const d = await importPdf(pdfFile(), null);
    const a = await addHighlight(d.id, 5, [{ id: 'r', x: 0.1, y: 0.2, w: 0.3, h: 0.02 }], 'Ранг — размерность образа', 'yellow');
    expect(await getTargetNote(d)).toBeNull();
    const noteId = await createTargetNote(d);
    expect(await getTargetNote(d)).toBe(noteId);
    const b = await highlightToBlock(a, noteId, { question: 'Что такое ранг?' });
    expect(b).toMatchObject({ text: 'Что такое ранг? >> Ранг — размерность образа', pdfRef: { docId: d.id, page: 5 } });
    expect((await db.annotations.get(a.id))!.blockId).toBe(b.id);
    expect(await db.cards.where('blockId').equals(b.id).count()).toBe(1);
    const c = await highlightToBlock(a, noteId, { cloze: true });
    expect(c.text).toBe('{{Ранг — размерность образа}}');
  });

  it('удаление PDF удаляет аннотации и файл', async () => {
    const d = await importPdf(pdfFile(), null);
    await addHighlight(d.id, 1, [], 'x', 'yellow');
    await purgeDoc(d.id);
    expect(await db.annotations.count()).toBe(0);
    expect(await db.files.count()).toBe(0);
  });
});
