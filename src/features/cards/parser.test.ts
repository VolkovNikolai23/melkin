import { describe, expect, it } from 'vitest';
import { conceptName, parseCards } from './parser';
import { newCardRow, planCardSync } from './sync';
import { extractLinkTitles, extractTags, tokenize } from '../../lib/markup';
import { migrateBlockTextV1, migrateCardIdV1 } from '../../db/migrations';

const kinds = (t: string, ctx = {}) => parseCards(t, ctx).map((c) => `${c.key}:${c.kind}`);

describe('parseCards — синтаксис RemNote', () => {
  it('обычный текст — без карточек', () => {
    expect(parseCards('Просто заметка про матрицы')).toEqual([]);
  });

  it('>> — карточка вперёд', () => {
    const [c] = parseCards('Что такое ранг? >> Размерность образа');
    expect(c).toMatchObject({ key: 'fwd', kind: 'forward', front: 'Что такое ранг?', back: 'Размерность образа' });
  });

  it('<< — только обратная', () => {
    const c = parseCards('det << определитель');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ key: 'bwd', kind: 'backward', front: 'определитель', back: 'det' });
  });

  it('<> — в обе стороны', () => {
    expect(kinds('a <> b')).toEqual(['fwd:forward', 'bwd:backward']);
  });

  it(':: — понятие, в обе стороны и со стилем понятия', () => {
    const c = parseCards('Ранг :: размерность образа');
    expect(c.map((x) => x.kind)).toEqual(['forward', 'backward']);
    expect(c.every((x) => x.concept)).toBe(true);
  });

  it(';; — описание: вопрос «Понятие → свойство»', () => {
    const [c] = parseCards('размерность ;; n×n', { parentText: 'Квадратная матрица :: матрица с равным числом строк и столбцов' });
    expect(c).toMatchObject({ kind: 'forward', front: 'Квадратная матрица → размерность', back: 'n×n' });
  });

  it(';; без родителя — просто карточка вперёд', () => {
    expect(parseCards('свойство ;; значение')[0].front).toBe('свойство');
  });

  it('>>> — многострочный ответ из дочерних блоков', () => {
    expect(parseCards('Свойства определителя >>>')[0]).toMatchObject({ kind: 'forward', back: '' });
  });

  it('>>1. — карточка-список, >>A) — множественный выбор', () => {
    expect(kinds('Этапы метода Гаусса >>1.')).toEqual(['list:list']);
    expect(kinds('Чему равен det I? >>A)')).toEqual(['mcq:mcq']);
  });

  it('>> с пустым ответом допустим (ответ — дочерние блоки)', () => {
    expect(parseCards('Свойства >>')).toHaveLength(1);
    expect(parseCards('x <<')).toEqual([]);
  });

  it('теги не попадают в текст карточки', () => {
    expect(parseCards('Ранг #линал :: размерность образа #важное')[1]).toMatchObject({ front: 'размерность образа', back: 'Ранг' });
  });

  it('пустой вопрос — не карточка', () => {
    expect(parseCards('>> ответ')).toEqual([]);
  });

  it('разделители внутри формул и кода не считаются', () => {
    expect(parseCards('Если $a >> b$, то `x :: y`')).toEqual([]);
    expect(parseCards('$a::b$ ? >> да')[0].front).toBe('$a::b$ ?');
  });

  it('ключ вперёд один для всех видов — смена >> на :: сохраняет историю', () => {
    expect(parseCards('q >> a')[0].key).toBe(parseCards('q :: a')[0].key);
  });
});

describe('клозы', () => {
  it('каждый клоз — отдельная карточка', () => {
    const c = parseCards('Матрица {{обратима}} тогда и только тогда, когда {{$\\det A \\ne 0$}}');
    expect(c).toHaveLength(2);
    expect(c[1].back).toBe('$\\det A \\ne 0$');
  });

  it('{{c1::…}} объединяет клозы в одну карточку', () => {
    const c = parseCards('{{c1::a}} и {{c1::b}}, а ещё {{c2::c}}');
    expect(c.map((x) => x.key)).toEqual(['cloze:c1', 'cloze:c2']);
    expect(c[0].back).toBe('a · b');
  });

  it('ключ клоза не зависит от позиции', () => {
    const a = parseCards('{{x}} и {{y}}');
    const b = parseCards('сначала {{y}}, потом {{x}}');
    expect(a.find((c) => c.back === 'x')!.key).toBe(b.find((c) => c.back === 'x')!.key);
  });

  it('{{ внутри формулы — не клоз; }}} закрывается правильно', () => {
    expect(parseCards('$x^{{2}}$')).toEqual([]);
    expect(parseCards('{{a^{2}}} = b')[0].back).toBe('a^{2}');
  });

  it('при наличии разделителя клозы не превращаются в отдельные карточки', () => {
    expect(kinds('{{a}} >> b')).toEqual(['fwd:forward']);
  });
});

describe('разметка', () => {
  it('tokenize выделяет формулы, код, клозы, ссылки, теги и разделитель', () => {
    const t = tokenize('Ранг $r$ #линал [[Матрица]] `код` >> {{dim}}');
    expect(t.filter((s) => s.t !== 'text').map((s) => s.t)).toEqual(['math', 'tag', 'link', 'code', 'sep', 'cloze']);
  });

  it('экранированный доллар — не формула', () => {
    expect(tokenize('цена \\$5').every((s) => s.t === 'text')).toBe(true);
  });

  it('теги нормализуются, «# Заголовок» — не тег', () => {
    expect(extractTags('#Линал и #линал, а ещё #матан/пределы')).toEqual(['линал', 'матан/пределы']);
    expect(extractTags('# Заголовок')).toEqual([]);
    expect(extractTags('$#x$ и `#y`')).toEqual([]);
  });

  it('ссылки [[…]]', () => {
    expect(extractLinkTitles('см. [[Ранг]] и [[ Ядро ]]')).toEqual(['Ранг', 'Ядро']);
  });

  it('conceptName берёт левую часть', () => {
    expect(conceptName('Ранг :: что-то')).toBe('Ранг');
    expect(conceptName('Просто понятие')).toBe('Просто понятие');
  });
});

describe('миграция v1 → v2', () => {
  it('старый :: становится >>, старый ;; — <>', () => {
    expect(migrateBlockTextV1('q :: a')).toBe('q >> a');
    expect(migrateBlockTextV1('q ;; a')).toBe('q <> a');
    expect(migrateBlockTextV1('$f::g$ текст')).toBe('$f::g$ текст');
  });

  it('id карточек переименовываются, смысл сохраняется', () => {
    expect(migrateCardIdV1('b#fwd')).toBe('b#fwd');
    expect(migrateCardIdV1('b#rev')).toBe('b#bwd');
    expect(migrateCardIdV1('b#cloze:abc')).toBe('b#cloze:habc');
    // после миграции новый парсер выдаёт те же ключи
    const v1Text = 'Матрица {{обратима}}';
    const key = parseCards(migrateBlockTextV1(v1Text))[0].key;
    expect(migrateCardIdV1('b#cloze:' + key.slice('cloze:h'.length))).toBe('b#' + key);
    expect(parseCards(migrateBlockTextV1('q ;; a')).map((c) => c.key)).toEqual(['fwd', 'bwd']);
  });
});

describe('planCardSync', () => {
  const now = 1_700_000_000_000;

  it('создаёт новые карточки', () => {
    const r = planCardSync('b1', 'd1', parseCards('q >> a'), [], now);
    expect(r.put.map((c) => c.id)).toEqual(['b1#fwd']);
    expect(r.remove).toEqual([]);
  });

  it('при правке ответа сохраняет историю повторений', () => {
    const old = { ...newCardRow('b1', 'd1', parseCards('q >> a')[0], now), reps: 5, stability: 12, state: 2 };
    const r = planCardSync('b1', 'd1', parseCards('q >> исправленный ответ'), [old], now + 1);
    expect(r.put[0]).toMatchObject({ id: 'b1#fwd', reps: 5, stability: 12, back: 'исправленный ответ' });
  });

  it('ничего не делает, если карточка не изменилась', () => {
    const old = newCardRow('b1', 'd1', parseCards('q >> a')[0], now);
    expect(planCardSync('b1', 'd1', parseCards('q >> a'), [old], now)).toEqual({ put: [], remove: [] });
  });

  it('удаляет карточки, которых больше нет', () => {
    const cards = parseCards('q <> a').map((p) => newCardRow('b1', 'd1', p, now));
    expect(planCardSync('b1', 'd1', parseCards('q >> a'), cards, now).remove).toEqual(['b1#bwd']);
  });

  it('отключение карточек сохраняет их историю', () => {
    const old = { ...newCardRow('b1', 'd1', parseCards('q >> a')[0], now), reps: 3 };
    const r = planCardSync('b1', 'd1', parseCards('q >> a'), [old], now, true);
    expect(r.remove).toEqual([]);
    expect(r.put[0]).toMatchObject({ disabled: true, reps: 3 });
  });
});

describe('image occlusion', () => {
  const rect = (id: string) => ({ id, x: 0.1, y: 0.1, w: 0.2, h: 0.1 });
  const image = { fileId: 'f', width: 100, height: 100, occlusions: [rect('r1'), rect('r2')] };

  it('по карточке на каждую область, ключ — id области', async () => {
    const { occlusionCards } = await import('./parser');
    const c = occlusionCards(image, { parentText: 'Строение клетки #био' });
    expect(c.map((x) => x.key)).toEqual(['occ:r1', 'occ:r2']);
    expect(c[0]).toMatchObject({ kind: 'occlusion', front: 'Строение клетки', sub: 'r1', clozeIndex: 0 });
  });

  it('удаление области удаляет только её карточку', async () => {
    const { occlusionCards } = await import('./parser');
    const now = 1;
    const existing = occlusionCards(image).map((p) => ({ ...newCardRow('b', 'd', p, now), reps: 2 }));
    const r = planCardSync('b', 'd', occlusionCards({ ...image, occlusions: [rect('r2')] }), existing, now);
    expect(r.remove).toEqual(['b#occ:r1']);
    expect(r.put.map((c) => c.id)).toEqual(['b#occ:r2']); // сдвинулся номер, история сохранена
    expect(r.put[0].reps).toBe(2);
  });
});
