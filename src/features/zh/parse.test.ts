import { describe, expect, it } from 'vitest';
import { candidates, isSentence, parseCedictLine, parseDsl, pinyinMarks, segment, stripDsl, syllableMarks } from './parse';

describe('пиньинь', () => {
  it('тоны по правилам', () => {
    expect(pinyinMarks('zhong1 guo2')).toBe('zhōng guó');
    expect(syllableMarks('lu:4')).toBe('lǜ');
    expect(syllableMarks('gou3')).toBe('gǒu');
    expect(syllableMarks('xiu1')).toBe('xiū');
    expect(syllableMarks('de5')).toBe('de');
    expect(syllableMarks('Bei3')).toBe('Běi');
  });
});

describe('CC-CEDICT', () => {
  it('строка словаря', () => {
    expect(parseCedictLine('細胞 细胞 [xi4 bao1] /cell (biology)/CL:個|个[ge4]/')).toEqual({ t: '細胞', w: '细胞', p: 'xì bāo', d: ['cell (biology)', 'CL:個|个[ge4]'], src: 'cedict' });
    expect(parseCedictLine('# комментарий')).toBeNull();
    expect(parseCedictLine('мусор')).toBeNull();
  });
});

describe('DSL (формат БКРС)', () => {
  it('заголовок, пиньинь, перевод; разметка убрана', () => {
    const dsl = ['#NAME "test"', '细胞', '\txìbāo', '\t[m1]1) [b]клетка[/b] [c](биол.)[/c][/m]', '\t[m1]2) ячейка[/m]', '', '好', '\thǎo', '\t[m1]хороший[/m]', 'abc', '\tлатиница не берётся'];
    const e = [...parseDsl(dsl)];
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ w: '细胞', p: 'xìbāo', d: ['1) клетка (биол.)', '2) ячейка'] });
    expect(stripDsl('\\[x\\] [ref]好[/ref]')).toBe('[x] 好');
  });
});

describe('слова в выделении', () => {
  it('кандидаты и разбивка по самому длинному слову', () => {
    expect(candidates('细胞核', 2)).toEqual(['细', '细胞', '胞', '胞核', '核']);
    expect(segment('细胞核分裂', new Set(['细胞', '细胞核', '分裂']))).toEqual(['细胞核', '分裂']);
    expect(isSentence('细胞')).toBe(false);
    expect(isSentence('我喜欢学习生物学')).toBe(true);
    expect(isSentence('你好！')).toBe(true);
  });
});
