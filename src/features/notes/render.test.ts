import { describe, expect, it } from 'vitest';
import { renderText } from './render';

describe('химические формулы (mhchem)', () => {
  it('формула с индексами и заряды', () => {
    const html = renderText('Серная кислота $\\ce{H2SO4}$ и ион $\\ce{Fe^{3+}}$');
    expect(html).not.toContain('katex-error');
    expect(html).toContain('msupsub'); // нижние/верхние индексы
  });

  it('уравнение реакции со стрелкой и равновесием', () => {
    const html = renderText('$$\\ce{2H2 + O2 -> 2H2O}$$ $\\ce{N2 + 3H2 <=> 2NH3}$');
    expect(html).not.toContain('katex-error');
    expect(html).toContain('katex-display');
  });
});
