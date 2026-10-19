// Промпты к модели лежат в prompts/*.md — их можно править, не трогая код.
// В тексте {{имя}} заменяется на значение; общие куски — {{language}} и {{markup}}.
import ask from './prompts/ask.md?raw';
import cards from './prompts/cards.md?raw';
import check from './prompts/check.md?raw';
import explain from './prompts/explain.md?raw';
import language from './prompts/language.md?raw';
import markup from './prompts/markup.md?raw';
import occlusion from './prompts/occlusion.md?raw';
import outline from './prompts/outline.md?raw';
import recognize from './prompts/recognize.md?raw';
import simpler from './prompts/simpler.md?raw';
import summary from './prompts/summary.md?raw';
import translate from './prompts/translate.md?raw';
import tests from './prompts/tests.md?raw';

const FILES = { ask, cards, check, explain, occlusion, outline, recognize, simpler, summary, tests, translate };
export type PromptName = keyof typeof FILES;

/** Подставляет {{имя}}; неизвестные {{…}} (например, клоз {{46}} в примере) не трогает. */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

export function prompt(name: PromptName, vars: Record<string, string> = {}): string {
  const subject = vars.subject || 'не указан';
  const shared = { language: fill(language, { subject }), markup };
  return fill(FILES[name], { ...shared, ...vars }).trim();
}
