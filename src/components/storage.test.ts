import { describe, expect, it } from 'vitest';
import { storageLevel } from './storage';

const GB = 1024 ** 3;
const MB = 1024 ** 2;

describe('предупреждение о месте', () => {
  it('заранее предупреждает при 80% или когда свободно меньше 300 МБ', () => {
    expect(storageLevel(1 * GB, 10 * GB)).toBe('ok');
    expect(storageLevel(8.1 * GB, 10 * GB)).toBe('warn');
    expect(storageLevel(800 * MB, 1000 * MB)).toBe('warn');
    expect(storageLevel(9.6 * GB, 10 * GB)).toBe('critical');
    expect(storageLevel(0, 0)).toBe('ok'); // браузер не сообщил квоту
  });
});
