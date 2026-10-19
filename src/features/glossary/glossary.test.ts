import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/db';
import { renderText } from '../notes/render';
import { allTerms, buildIndex, markTerms, stripMarks, termsToHtml, upsertTerm } from './glossary';

const index = buildIndex([
  { key: 'митоз', term: 'Митоз', definition: 'деление клетки' },
  { key: 'клеточный цикл', term: 'Клеточный цикл', definition: 'жизнь клетки' },
  { key: 'днк', term: 'ДНК', definition: 'молекула наследственности' },
]);

const html = (t: string) => termsToHtml(renderText(markTerms(t, index)));

describe('термины в тексте', () => {
  it('находит термин с окончанием, многословный, по одному разу', () => {
    const h = html('Во время **митоза** идёт клеточный цикл, митоз и ДНК');
    expect(h).toContain('<span class="gl-term" data-term="митоз">митоза</span>');
    expect(h).toContain('data-term="клеточный цикл"');
    expect(h.match(/data-term="митоз"/g)).toHaveLength(1);
    expect(h).toContain('<strong>');
  });

  it('не трогает формулы, ссылки, клозы и определяющий блок', () => {
    expect(markTerms('$митоз$ [[Митоз]] {{митоз}}', index)).toBe('$митоз$ [[Митоз]] {{митоз}}');
    expect(stripMarks(markTerms('Митоз :: деление; митоз', index))).toBe('Митоз :: деление; митоз');
    expect(markTerms('Митоз :: деление', index)).not.toContain('');
  });

  it('не цепляет часть другого слова', () => {
    expect(markTerms('амитоза нет', index)).not.toContain('');
  });
});

describe('словарь в базе', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('ручная правка важнее ИИ, перевод ИИ дополняет', async () => {
    await upsertTerm({ term: 'Митоз', definition: 'моё определение' }, 'user');
    await upsertTerm({ term: 'митоз', definition: 'определение ИИ', zh: '有丝分裂', pinyin: 'yǒusī fēnliè' }, 'ai');
    const t = (await allTerms()).find((x) => x.key === 'митоз')!;
    expect(t.definition).toBe('моё определение');
    expect(t.zh).toBe('有丝分裂');
    expect(await db.glossary.count()).toBe(1);
  });
});
