import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { parseXml } from '../../lib/xml';
import { parsePptx, resolvePath, slideText } from './pptx';
import { pptxToPdf } from './pptxToPdf';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const rels = (items: [string, string][]) =>
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, t]) => `<Relationship Id="${id}" Type="x" Target="${t}"/>`).join('')}</Relationships>`;
const xf = (x: number, y: number, w: number, h: number) => `<a:xfrm><a:off x="${x * 12700}" y="${y * 12700}"/><a:ext cx="${w * 12700}" cy="${h * 12700}"/></a:xfrm>`;

// PNG 1×1
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

function deck() {
  const slide1 = `<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:bgPr></p:bg><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Заголовок"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>
      <p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="ru-RU" b="1"/><a:t>Митоз &amp; мейоз</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="3" name="Текст"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr>${xf(40, 120, 640, 300)}</p:spPr>
      <p:txBody><a:bodyPr><a:normAutofit fontScale="90000"/></a:bodyPr>
        <a:p><a:r><a:rPr sz="2400"/><a:t>Профаза: хромосомы спирализуются, α-тубулин собирает веретено</a:t></a:r></a:p>
        <a:p><a:pPr lvl="1"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>Метафаза</a:t></a:r></a:p>
        <a:p><a:pPr lvl="1"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:rPr><a:solidFill><a:srgbClr val="DC2626"/></a:solidFill></a:rPr><a:t>Анафаза</a:t></a:r></a:p>
        <a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>Без маркера</a:t></a:r><a:br/><a:r><a:t>вторая строка</a:t></a:r></a:p>
      </p:txBody></p:sp>
    <p:pic><p:nvPicPr><p:cNvPr id="4" name="Рис"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr>${xf(500, 20, 200, 100)}</p:spPr></p:pic>
    <p:grpSp><p:grpSpPr><a:xfrm><a:off x="${100 * 12700}" y="${400 * 12700}"/><a:ext cx="${200 * 12700}" cy="${100 * 12700}"/><a:chOff x="0" y="0"/><a:chExt cx="${100 * 12700}" cy="${50 * 12700}"/></a:xfrm></p:grpSpPr>
      <p:sp><p:nvSpPr><p:cNvPr id="5" name="Блок"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xf(10, 10, 50, 20)}<a:solidFill><a:srgbClr val="FDE047"/></a:solidFill></p:spPr></p:sp>
    </p:grpSp>
    <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Таблица"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${40 * 12700}" y="${450 * 12700}"/><a:ext cx="${300 * 12700}" cy="${60 * 12700}"/></p:xfrm>
      <a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="${100 * 12700}"/><a:gridCol w="${200 * 12700}"/></a:tblGrid>
        <a:tr h="${30 * 12700}"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Фаза</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Что происходит</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
      </a:tbl></a:graphicData></a:graphic></p:graphicFrame>
  </p:spTree></p:cSld></p:sld>`;
  const slide2 = `<p:sld ${NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Второй слайд</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const layout = `<p:sldLayout ${NS}><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr>${xf(40, 20, 640, 80)}</p:spPr></p:sp>
  </p:spTree></p:cSld></p:sldLayout>`;
  const master = `<p:sldMaster ${NS}><p:cSld><p:spTree/></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4000"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr><a:lvl2pPr><a:defRPr sz="2000"/></a:lvl2pPr></p:bodyStyle></p:txStyles></p:sldMaster>`;
  const theme = `<a:theme ${NS}><a:themeElements><a:clrScheme name="x"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="FDF0F3"/></a:accent1></a:clrScheme></a:themeElements></a:theme>`;
  const pres = `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst><p:sldSz cx="${720 * 12700}" cy="${540 * 12700}"/></p:presentation>`;
  return zipSync({
    'ppt/presentation.xml': strToU8(pres),
    'ppt/_rels/presentation.xml.rels': strToU8(rels([['rId1', 'theme/theme1.xml'], ['rId2', 'slides/slide1.xml'], ['rId3', 'slides/slide2.xml']])),
    'ppt/slides/slide1.xml': strToU8(slide1),
    'ppt/slides/slide2.xml': strToU8(slide2),
    'ppt/slides/_rels/slide1.xml.rels': strToU8(rels([['rId1', '../slideLayouts/slideLayout1.xml'], ['rId2', '../media/image1.png']])),
    'ppt/slides/_rels/slide2.xml.rels': strToU8(rels([['rId1', '../slideLayouts/slideLayout1.xml']])),
    'ppt/slideLayouts/slideLayout1.xml': strToU8(layout),
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': strToU8(rels([['rId1', '../slideMasters/slideMaster1.xml']])),
    'ppt/slideMasters/slideMaster1.xml': strToU8(master),
    'ppt/theme/theme1.xml': strToU8(theme),
    'ppt/media/image1.png': PNG,
  });
}

describe('XML', () => {
  it('элементы, атрибуты, сущности, самозакрывающиеся теги', () => {
    const x = parseXml('<?xml version="1.0"?><!-- c --><a x="1" y=\'&lt;2&gt;\'><b/><c>t &amp; &#1052;</c></a>');
    const a = x.children[0];
    expect(a.attrs).toEqual({ x: '1', y: '<2>' });
    expect(a.children.map((c) => c.name)).toEqual(['b', 'c']);
    expect(a.children[1].text).toBe('t & М');
  });

  it('относительные пути связей', () => {
    expect(resolvePath('ppt/slides/slide1.xml', '../media/image1.png')).toBe('ppt/media/image1.png');
  });
});

describe('PPTX', () => {
  const d = parsePptx(deck());

  it('размер, порядок слайдов, фон из темы, размеры шрифтов мастера', () => {
    expect([d.width, d.height]).toEqual([720, 540]);
    expect(d.slides).toHaveLength(2);
    expect(d.slides[0].bg).toBe('#fdf0f3');
    expect(d.defaults.title).toBe(40);
    expect(d.defaults.body.slice(0, 2)).toEqual([28, 20]);
    expect(slideText(d.slides[1])).toBe('Второй слайд');
  });

  it('заголовок без координат берёт положение из макета', () => {
    const title = d.slides[0].els.find((e) => e.kind === 'text' && e.role === 'title');
    expect(title).toMatchObject({ x: 40, y: 20, w: 640, h: 80, anchor: 'ctr' });
    expect(d.slides[1].els[0]).toMatchObject({ role: 'title', y: 20 });
  });

  it('список: маркеры, нумерация, без маркера, перенос строки, цвет, автоподбор', () => {
    const body = d.slides[0].els.find((e) => e.kind === 'text' && e.role === 'body');
    if (body?.kind !== 'text') throw new Error('нет текста');
    expect(body.paras.map((p) => p.bullet)).toEqual(['•', '1.', '2.', null]);
    expect(body.paras[1].level).toBe(1);
    expect(body.paras[2].runs[0].color).toBe('#dc2626');
    expect(body.paras[3].runs.map((r) => r.t)).toEqual(['Без маркера', '\n', 'вторая строка']);
    expect(body.scale).toBe(0.9);
    expect(body.paras[0].runs[0].size).toBe(24);
  });

  it('картинка, группа (масштаб детей) и таблица', () => {
    const els = d.slides[0].els;
    expect(els.find((e) => e.kind === 'image')).toMatchObject({ path: 'ppt/media/image1.png', x: 500, w: 200 });
    // в группе дети вдвое крупнее: chExt 100×50 → ext 200×100
    expect(els.find((e) => e.kind === 'rect' && e.fill === '#fde047')).toMatchObject({ x: 120, y: 420, w: 100, h: 40 });
    const cells = els.filter((e) => e.kind === 'rect' && e.stroke);
    expect(cells.map((c) => (c.kind === 'rect' ? [c.x, c.w] : []))).toEqual([
      [40, 100],
      [140, 200],
    ]);
    expect(slideText(d.slides[0])).toContain('Что происходит');
  });

  it('не презентация — понятная ошибка', () => {
    expect(() => parsePptx(new Uint8Array([1, 2, 3]))).toThrow(/pptx/i);
  });

  it('собирается PDF с кириллицей, греческими буквами и картинкой', async () => {
    const font = (n: string) => new Uint8Array(readFileSync(`node_modules/@fontsource/pt-sans/files/pt-sans-${n}-normal.woff`));
    const bytes = await pptxToPdf(d, { latin: font('latin-400'), cyrillic: font('cyrillic-400'), latinBold: font('latin-700'), cyrillicBold: font('cyrillic-700') }, undefined, 'Деление клетки');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 720, height: 540 });
    expect(pdf.getTitle()).toBe('Деление клетки');
  });
});
