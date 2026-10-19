import { describe, expect, it } from 'vitest';
import type { Page } from '../../db/schema';
import { pageNeedsRecognition } from './recognize';
import { labelsToRects, normalizeVerdict } from './review';

describe('подписи для image occlusion', () => {
  it('рамки 0–1000 → доли, с запасом; мусор и дубли отбрасываются', () => {
    let n = 0;
    const id = () => 'r' + ++n;
    const rects = labelsToRects(
      [
        { text: 'ядро', box: [100, 200, 150, 400] },
        { text: 'дубль ядра', box: [102, 205, 152, 398] },
        { text: 'плохая', box: [1, 2, 3] },
        { text: 'точка', box: [500, 500, 501, 501] },
        { text: 'мембрана', box: [800, 50, 860, 300] },
      ],
      [{ id: 'old', x: 0.04, y: 0.79, w: 0.26, h: 0.07 }],
      id,
    );
    expect(rects).toHaveLength(1); // мембрана совпала с уже нарисованной областью
    expect(rects[0]).toMatchObject({ id: 'r1', label: 'ядро' });
    expect(rects[0].x).toBeCloseTo(0.194, 3);
    expect(rects[0].w).toBeCloseTo(0.212, 3);
  });
});

describe('проверка ответа', () => {
  it('вердикт приводится к трём вариантам', () => {
    expect(normalizeVerdict({ verdict: 'correct', feedback: ' Всё верно ' })).toEqual({ verdict: 'correct', feedback: 'Всё верно', recognized: undefined });
    expect(normalizeVerdict({ verdict: 'maybe' as never }).verdict).toBe('partial');
  });
});

describe('распознавание рукописи', () => {
  const page = (extra: Partial<Page>): Page => ({ id: 'p', docId: 'd', order: 0, background: 'grid', strokes: [], createdAt: 0, updatedAt: 10, ...extra });
  it('распознаём только изменённые листы со штрихами', () => {
    const s = [{ id: 's', tool: 'pen' as const, color: 'auto', size: 2, points: [0, 0, 0.5] }];
    expect(pageNeedsRecognition(page({}))).toBe(false);
    expect(pageNeedsRecognition(page({ strokes: s }))).toBe(true);
    expect(pageNeedsRecognition(page({ strokes: s, recognizedAt: 10 }))).toBe(false);
    expect(pageNeedsRecognition(page({ strokes: s, recognizedAt: 5 }))).toBe(true);
  });
});
