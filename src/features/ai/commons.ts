// Иллюстрации из Wikimedia Commons: свободные лицензии, у каждой картинки — страница
// с автором и лицензией (её и показываем как источник).

export interface CommonsImage {
  title: string;
  thumb: string;
  page: string;
  license: string;
  author: string;
  mime: string;
  width: number;
}

interface ApiPage {
  index?: number;
  title: string;
  imageinfo?: {
    thumburl?: string;
    thumbwidth?: number;
    descriptionurl?: string;
    mime?: string;
    extmetadata?: Record<string, { value?: string }>;
  }[];
}

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

export function commonsUrl(query: string): string {
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: '8',
    gsrsearch: `${query} filetype:bitmap|drawing`,
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '1000',
  });
  return `https://commons.wikimedia.org/w/api.php?${p}`;
}

/** Разбор ответа API: картинки по порядку релевантности, только JPEG/PNG/SVG-превью. */
export function parseCommons(json: { query?: { pages?: Record<string, ApiPage> } }): CommonsImage[] {
  const pages = Object.values(json.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out: CommonsImage[] = [];
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii?.thumburl || !ii.descriptionurl) continue;
    const meta = ii.extmetadata ?? {};
    out.push({
      title: p.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
      thumb: ii.thumburl,
      page: ii.descriptionurl,
      license: stripHtml(meta.LicenseShortName?.value ?? ''),
      author: stripHtml(meta.Artist?.value ?? '').slice(0, 80),
      mime: ii.mime ?? '',
      width: ii.thumbwidth ?? 0,
    });
  }
  return out.filter((i) => /jpeg|png|svg|gif/.test(i.mime) && i.width >= 300);
}

export async function searchCommons(query: string): Promise<CommonsImage[]> {
  const res = await fetch(commonsUrl(query));
  if (!res.ok) return [];
  return parseCommons(await res.json());
}

export function commonsLabel(i: CommonsImage): string {
  return ['Wikimedia Commons', i.title, i.author, i.license].filter(Boolean).join(' · ');
}
