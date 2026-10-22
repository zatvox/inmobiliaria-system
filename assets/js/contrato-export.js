/**
 * contrato-export.js — Exportadores del contrato a partir de los BLOQUES que
 * genera contrato-modelo.js:
 *   · renderPreview(blocks)   → nodo HTML (vista previa en pantalla)
 *   · imprimirPDF(...)        → abre el diálogo de impresión → "Guardar como PDF"
 *   · generarDocx(...)        → Blob .docx real (negritas, tamaños, sangrías)
 * Las medidas (márgenes, sangrías, tamaños de letra) son las mismas en los tres
 * para que el documento se vea igual en pantalla, en PDF y en Word.
 */
import { parseMd } from './contrato-modelo.js';

/* Medidas en pulgadas (1 in = 1440 twips). */
const M = {
  margenLR: 0.85, margenTB: 0.75,
  clauseLeft: 0.6, clauseHang: 0.46,     // número romano a 0.14" y texto a 0.6" (cabe hasta XXXVIII.)
  subLeft: 0.6,
  bullet: [{ left: 1.05, hang: 0.22 }, { left: 1.35, hang: 0.25 }],
  fuente: 'Arial', cuerpo: 10.5, titulo: 16, heading: 12, anexo: 12,
};

/* ================================ VISTA PREVIA =============================== */
export const CSS_CONTRATO = `
.ct-page { font-family:${M.fuente}, Helvetica, sans-serif; font-size:${M.cuerpo}pt; line-height:1.18; color:#000; background:#fff; text-align:justify; }
.ct-page p { margin:0; }
.ct-title { text-align:center; font-weight:700; text-decoration:underline; font-size:${M.titulo}pt; margin:0 0 14pt; }
.ct-heading { font-weight:700; text-decoration:underline; font-size:${M.heading}pt; text-transform:none; margin:11pt 0 5pt; break-after:avoid; page-break-after:avoid; text-align:left; }
.ct-para { margin:0 0 6pt; }
.ct-gap { margin-top:16pt; }
.ct-clause { margin:0 0 6pt ${M.clauseLeft}in; text-indent:-${M.clauseHang}in; padding-left:0; }
.ct-clause .ct-num { display:inline-block; width:${M.clauseHang}in; text-indent:0; text-align:left; }
.ct-sub { margin:0 0 6pt ${M.subLeft}in; }
.ct-bullet { margin:0 0 4pt; position:relative; }
.ct-bullet .ct-mk { position:absolute; text-indent:0; }
.ct-b0 { margin-left:${M.bullet[0].left}in; text-indent:0; }
.ct-b0 .ct-mk { left:-${M.bullet[0].hang}in; }
.ct-b1 { margin-left:${M.bullet[1].left}in; }
.ct-b1 .ct-mk { left:-${M.bullet[1].hang}in; }
.ct-sign { width:100%; border-collapse:collapse; margin-top:34pt; break-inside:avoid; page-break-inside:avoid; }
.ct-sign td { width:50%; vertical-align:top; padding:0 12pt 26pt 0; text-align:left; }
.ct-sign .ct-line { margin-bottom:3pt; }
.ct-sign .ct-name { font-weight:700; margin:0; }
.ct-annex { font-weight:700; margin:12pt 0 6pt; text-align:left; font-size:${M.anexo}pt; }
.ct-photos { display:flex; flex-wrap:wrap; gap:8pt; margin-bottom:8pt; }
.ct-photos img { max-width:48%; max-height:3.4in; object-fit:contain; border:1px solid #ccc; }
.ct-break { break-after:page; page-break-after:always; height:0; }
.ct-miss { background:#FFF3B0; }
`;

const nodoRuns = (md) => parseMd(md).map((r) => {
  const s = document.createElement(r.b ? 'strong' : 'span');
  s.textContent = r.t;
  if (/…{3,}/.test(r.t)) s.className = 'ct-miss';
  return s;
});

export function renderPreview(blocks, { fotos = [] } = {}) {
  const root = document.createElement('div');
  root.className = 'ct-page';
  const mk = (tag, cls, md) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (md !== undefined) nodoRuns(md).forEach((n) => e.append(n));
    return e;
  };
  blocks.forEach((b) => {
    switch (b.k) {
      case 'title': { const e = mk('p', 'ct-title'); e.textContent = b.text; root.append(e); break; }
      case 'heading': { const e = mk('p', 'ct-heading'); e.textContent = b.text; root.append(e); break; }
      case 'para': root.append(mk('p', `ct-para${b.gapBefore ? ' ct-gap' : ''}`, b.md)); break;
      case 'clause': {
        const e = mk('p', 'ct-clause');
        const n = document.createElement('span'); n.className = 'ct-num'; n.textContent = b.num;
        e.append(n); nodoRuns(b.md).forEach((x) => e.append(x));
        root.append(e); break;
      }
      case 'sub': root.append(mk('p', 'ct-sub', b.md)); break;
      case 'bullet': {
        const e = mk('p', `ct-bullet ct-b${b.level ?? 0}`);
        const m = document.createElement('span'); m.className = 'ct-mk'; m.textContent = b.marker || '•';
        e.append(m); nodoRuns(b.md).forEach((x) => e.append(x));
        root.append(e); break;
      }
      case 'sign': {
        const t = document.createElement('table'); t.className = 'ct-sign';
        b.filas.forEach((fila) => {
          const tr = document.createElement('tr');
          fila.forEach((celda) => {
            const td = document.createElement('td');
            if (celda) {
              const l = document.createElement('p'); l.className = 'ct-line'; l.textContent = '_________________________________';
              td.append(l);
              celda.lines.forEach((ln) => { const p = document.createElement('p'); p.className = 'ct-name'; p.textContent = ln; td.append(p); });
            }
            tr.append(td);
          });
          t.append(tr);
        });
        root.append(t); break;
      }
      case 'pagebreak': root.append(Object.assign(document.createElement('div'), { className: 'ct-break' })); break;
      case 'annex': { const e = mk('p', 'ct-annex'); e.textContent = b.text; root.append(e); break; }
      case 'photos': {
        if (!fotos.length) break;
        const w = document.createElement('div'); w.className = 'ct-photos';
        fotos.forEach((f) => { const i = document.createElement('img'); i.src = f.url; i.alt = 'Foto del inmueble'; w.append(i); });
        root.append(w); break;
      }
      default: break;
    }
  });
  return root;
}

/* ===================================== PDF =================================== */
/** Imprime solo el contrato en un iframe oculto; el usuario elige "Guardar como PDF". */
export function imprimirPDF(blocks, tituloArchivo, { fotos = [] } = {}) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;';
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  const tituloAnterior = document.title;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${tituloArchivo}</title>
    <style>@page { size: letter; margin: ${M.margenTB}in ${M.margenLR}in; } html,body{margin:0;padding:0;background:#fff;} ${CSS_CONTRATO}</style></head><body></body></html>`);
  doc.close();
  doc.body.append(renderPreview(blocks, { fotos }));
  const limpiar = () => { document.title = tituloAnterior; setTimeout(() => iframe.remove(), 500); };
  const imprimir = () => {
    document.title = tituloArchivo; // Chrome usa el título como nombre sugerido del PDF
    iframe.contentWindow.focus();
    iframe.contentWindow.addEventListener('afterprint', limpiar, { once: true });
    iframe.contentWindow.print();
  };
  // Espera a que carguen las fotos antes de imprimir.
  const imgs = [...doc.images];
  if (!imgs.length) { setTimeout(imprimir, 150); return; }
  let pend = imgs.length;
  const listo = () => { pend -= 1; if (pend <= 0) setTimeout(imprimir, 100); };
  imgs.forEach((im) => { if (im.complete) listo(); else { im.onload = listo; im.onerror = listo; } });
}

/* ==================================== WORD =================================== */
function cargarDocxLib() {
  if (globalThis.docx) return Promise.resolve(globalThis.docx);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
    s.onload = () => (globalThis.docx ? resolve(globalThis.docx) : reject(new Error('No se pudo iniciar la librería de Word.')));
    s.onerror = () => reject(new Error('No se pudo cargar la librería de Word (docx). Revisa tu conexión a internet.'));
    document.head.append(s);
  });
}

const tw = (inches) => Math.round(inches * 1440);

export async function generarDocx(blocks, { fotos = [], docxLib = null } = {}) {
  const D = docxLib ?? await cargarDocxLib();
  const { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, Tab, PageBreak, ImageRun, TabStopType } = D;
  const FONT = M.fuente;

  const runs = (md, extra = {}) => parseMd(md).map((r) => new TextRun({ text: r.t, bold: r.b || extra.bold, font: FONT, size: (extra.size ?? M.cuerpo) * 2, underline: extra.underline ? {} : undefined }));
  const sinBorde = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const bordes = { top: sinBorde, bottom: sinBorde, left: sinBorde, right: sinBorde };
  const children = [];

  for (const b of blocks) {
    switch (b.k) {
      case 'title':
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 280 }, children: [new TextRun({ text: b.text, bold: true, underline: {}, font: FONT, size: M.titulo * 2 })] }));
        break;
      case 'heading':
        children.push(new Paragraph({ keepNext: true, spacing: { before: 220, after: 100 }, children: [new TextRun({ text: b.text, bold: true, underline: {}, font: FONT, size: M.heading * 2 })] }));
        break;
      case 'para':
        children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { before: b.gapBefore ? 320 : 0, after: 120 }, children: runs(b.md) }));
        break;
      case 'clause':
        children.push(new Paragraph({
          alignment: AlignmentType.JUSTIFIED, spacing: { after: 120 },
          indent: { left: tw(M.clauseLeft), hanging: tw(M.clauseHang) },
          tabStops: [{ type: TabStopType.LEFT, position: tw(M.clauseLeft) }],
          children: [new TextRun({ children: [b.num, new Tab()], font: FONT, size: M.cuerpo * 2 }), ...runs(b.md)],
        }));
        break;
      case 'sub':
        children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 120 }, indent: { left: tw(M.subLeft) }, children: runs(b.md) }));
        break;
      case 'bullet': {
        const cfg = M.bullet[b.level ?? 0];
        children.push(new Paragraph({
          alignment: AlignmentType.JUSTIFIED, spacing: { after: 80 },
          indent: { left: tw(cfg.left), hanging: tw(cfg.hang) },
          tabStops: [{ type: TabStopType.LEFT, position: tw(cfg.left) }],
          children: [new TextRun({ children: [b.marker || '•', new Tab()], font: FONT, size: M.cuerpo * 2 }), ...runs(b.md)],
        }));
        break;
      }
      case 'sign': {
        const filas = b.filas.map((fila) => new TableRow({
          cantSplit: true,
          children: fila.map((celda) => new TableCell({
            borders: bordes, width: { size: 4500, type: WidthType.DXA },
            children: celda
              ? [
                new Paragraph({ spacing: { before: 700, after: 40 }, children: [new TextRun({ text: '_________________________________', font: FONT, size: M.cuerpo * 2 })] }),
                ...celda.lines.map((ln) => new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: ln, bold: true, font: FONT, size: M.cuerpo * 2 })] })),
              ]
              : [new Paragraph({ children: [] })],
          })),
        }));
        children.push(new Table({ width: { size: 9000, type: WidthType.DXA }, columnWidths: [4500, 4500], borders: { top: sinBorde, bottom: sinBorde, left: sinBorde, right: sinBorde, insideHorizontal: sinBorde, insideVertical: sinBorde }, rows: filas }));
        break;
      }
      case 'pagebreak':
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      case 'annex':
        children.push(new Paragraph({ spacing: { before: 240, after: 120 }, keepNext: true, children: [new TextRun({ text: b.text, bold: true, font: FONT, size: M.anexo * 2 })] }));
        break;
      case 'photos':
        for (const f of fotos) {
          try {
            const bytes = f.bytes ?? new Uint8Array(await (await fetch(f.url)).arrayBuffer());
            const maxW = 520, maxH = 400;
            const esc = Math.min(maxW / (f.w || maxW), maxH / (f.h || maxH), 1);
            const type = (f.type || '').includes('png') ? 'png' : 'jpg';
            children.push(new Paragraph({
              alignment: AlignmentType.CENTER, spacing: { after: 160 },
              children: [new ImageRun({ data: bytes, type, transformation: { width: Math.round((f.w || maxW) * esc), height: Math.round((f.h || maxH) * esc) } })],
            }));
          } catch (e) { console.error('Foto omitida en el Word:', e); }
        }
        break;
      default: break;
    }
  }

  const documento = new Document({
    creator: 'Sistema de Gestión Inmobiliaria',
    styles: { default: { document: { run: { font: FONT, size: M.cuerpo * 2 }, paragraph: { spacing: { line: 252 } } } } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: tw(M.margenTB), bottom: tw(M.margenTB), left: tw(M.margenLR), right: tw(M.margenLR) } } },
      children,
    }],
  });
  return Packer.toBlob ? Packer.toBlob(documento) : Packer.toBuffer(documento);
}
