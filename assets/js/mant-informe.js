/**
 * mant-informe.js — Informe de un trabajo de mantenimiento (PDF A4 multipágina)
 * para presentar a gerencia: ficha, resumen financiero, cronología, gastos con
 * comprobantes, reparto entre inquilinos/propietario, comisión del contratista y
 * anexo fotográfico. Motor: HTML+CSS → iframe 794 px → html2canvas → jsPDF, con
 * cortes de página solo entre filas/bloques y encabezado de tabla repetido.
 */
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const hora = (s) => { const d = new Date(s); return `${dmy(s)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export const CATEGORIAS = {
  mano_obra: 'Mano de obra', servicio_taller: 'Servicio de taller', material: 'Material', repuesto: 'Repuesto', transporte: 'Transporte', otro: 'Otro',
};
export const TIPOS_EVENTO = {
  reporte: '🚨 Reporte', diagnostico: '🔍 Diagnóstico', visita: '👷 Visita', traslado: '🚚 Traslado', compra: '🛒 Compra', trabajo: '🔧 Trabajo', incidencia: '⚠️ Incidencia', pago: '💵 Pago', nota: '📝 Nota',
};
export const ESTADOS = {
  reportado: 'Reportado', en_proceso: 'En proceso', esperando_repuesto: 'Esperando repuesto', terminado: 'Terminado', informado: 'Informado a gerencia',
  planificado: 'Planificado', finalizado: 'Finalizado',
};

/** Totales del trabajo (todo en un solo lugar para que pantalla e informe coincidan). */
export function resumenMantenimiento(m) {
  const gastos = m.gastos ?? [];
  const sum = (f) => gastos.filter(f).reduce((t, g) => t + Number(g.monto || 0), 0);
  const total = sum(() => true);
  const confirmado = sum((g) => g.estado === 'confirmado');
  const estimado = total - confirmado;
  const manoObra = sum((g) => ['mano_obra', 'servicio_taller'].includes(g.categoria));
  const materiales = total - manoObra;
  const comision = Math.round(total * Number(m.comision_pct || 0)) / 100;
  const reparto = m.reparto ?? [];
  const inquilinos = reparto.filter((r) => r.tipo === 'inquilino').reduce((t, r) => t + Number(r.monto || 0), 0);
  const propietario = reparto.filter((r) => r.tipo === 'propietario').reduce((t, r) => t + Number(r.monto || 0), 0);
  const presupuesto = Number(m.presupuesto_estimado || 0);
  return { total, confirmado, estimado, manoObra, materiales, comision, inquilinos, propietario, presupuesto, desvio: presupuesto ? total - presupuesto : 0 };
}

const esImagen = (u) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u ?? '');

export function htmlInforme(m, { urls = {}, empresa = '' } = {}) {
  const r = resumenMantenimiento(m);
  const titulo = m.titulo || m.descripcion;
  const C = '#1B3A5C';
  const filasEventos = (m.eventos ?? []).map((e) => `<tr><td class="nw">${hora(e.fecha_hora)}</td><td class="nw">${esc(TIPOS_EVENTO[e.tipo] ?? e.tipo)}</td><td>${esc(e.nota).replace(/\n/g, '<br>')}</td></tr>`).join('');
  const filasGastos = (m.gastos ?? []).map((g) => `<tr><td class="nw">${dmy(g.fecha)}</td><td>${esc(CATEGORIAS[g.categoria] ?? g.categoria)}</td><td>${esc(g.descripcion)}${Number(g.cantidad) !== 1 ? ` <span class="mut">(x${Number(g.cantidad)})</span>` : ''}</td><td>${esc(g.proveedor ?? '')}</td><td>${g.comprobante_tipo ? esc(g.comprobante_tipo) + (g.comprobante_nro ? ' ' + esc(g.comprobante_nro) : '') : (g.comprobante_url ? 'adjunto' : '—')}</td><td class="c">${g.estado === 'estimado' ? '<span class="est">estimado</span>' : 'confirmado'}</td><td class="r nw">S/ ${fmt(g.monto)}</td></tr>`).join('');
  const filasReparto = (m.reparto ?? []).map((p) => {
    const cuota = p.cuota;
    const pagado = (cuota?.pagos ?? []).filter((x) => x.estado !== 'anulado').reduce((t, x) => t + Number(x.monto), 0);
    const estado = p.tipo === 'propietario' ? 'Asume el propietario' : (cuota ? (cuota.estado === 'pagada' ? 'Pagado' : (pagado > 0 ? `Abonó S/ ${fmt(pagado)}` : 'Cuota emitida')) : 'Sin cuota');
    return `<tr><td>${esc(p.nombre)}${p.tipo === 'propietario' ? ' <span class="mut">(propietario)</span>' : ''}</td><td>${esc(p.detalle ?? '')}</td><td class="r nw">${fmt(p.base_m2)}</td><td class="r nw">${Number(p.porcentaje).toFixed(2)}%</td><td class="r nw">S/ ${fmt(p.monto)}</td><td>${estado}</td></tr>`;
  }).join('');

  // Anexo fotográfico: fotos de la bitácora y comprobantes de gastos (solo imágenes)
  const fotos = [];
  (m.eventos ?? []).forEach((e) => { const u = urls[e.foto_url]; if (e.foto_url && esImagen(e.foto_url) && u) fotos.push({ u, t: `${hora(e.fecha_hora)} · ${e.nota.slice(0, 70)}` }); });
  (m.gastos ?? []).forEach((g) => { const u = urls[g.comprobante_url]; if (g.comprobante_url && esImagen(g.comprobante_url) && u) fotos.push({ u, t: `Comprobante · ${g.descripcion} · S/ ${fmt(g.monto)}` }); });
  const anexo = fotos.length
    ? `<div class="sec"><h2>Anexo fotográfico</h2><div class="fotos">${fotos.map((f) => `<figure><img src="${esc(f.u)}" crossorigin="anonymous"><figcaption>${esc(f.t)}</figcaption></figure>`).join('')}</div></div>`
    : '';
  const ficha = [['Problema reportado', m.problema], ['Diagnóstico', m.diagnostico], ['Causa', m.causa], ['Solución aplicada', m.solucion]].filter(([, v]) => v)
    .map(([k, v]) => `<div class="fk">${k}</div><div class="fv">${esc(v).replace(/\n/g, '<br>')}</div>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Informe</title><style>
  * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { font-family:Arial, Helvetica, sans-serif; font-size:11px; line-height:16px; color:#111827; margin:0; }
  .top { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid ${C}; padding-bottom:10px; }
  .top h1 { margin:0; font-size:21px; line-height:26px; color:${C}; letter-spacing:.03em; } .top .sub { color:#374151; margin-top:2px; font-size:12.5px; line-height:18px; }
  .top .doc { text-align:right; font-size:10px; line-height:15px; color:#6b7280; } .top .doc b { display:block; font-size:13px; line-height:18px; color:#111827; }
  .box { margin-top:12px; border:1px solid #c7d2e0; background:#eef3f9; border-radius:8px; padding:10px 16px; display:grid; grid-template-columns:112px 1fr 112px 1fr; gap:6px 10px; font-size:11px; line-height:16px; }
  .box .k { font-weight:700; color:#374151; font-size:10px; letter-spacing:.03em; }
  .sec { margin-top:18px; } .sec h2 { font-size:12px; line-height:18px; color:${C}; margin:0 0 8px; padding-bottom:4px; border-bottom:2px solid ${C}; text-transform:uppercase; letter-spacing:.05em; }
  .cards { display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; }
  .card { border:1px solid #d1d5db; border-radius:8px; padding:9px 12px; } .card span { display:block; font-size:9px; line-height:13px; color:#6b7280; letter-spacing:.06em; text-transform:uppercase; } .card b { display:block; font-size:16px; line-height:22px; margin-top:3px; }
  .card.hi { background:${C}; border-color:${C}; color:#fff; } .card.hi span { color:#cbd5e1; }
  table { width:100%; border-collapse:separate; border-spacing:0; table-layout:fixed; }
  th { background:${C}; color:#fff; padding:8px 8px 5px; font-size:10px; line-height:14px; text-align:left; font-weight:700; }
  td { border-bottom:1px solid #d6dde8; padding:6px 8px; vertical-align:middle; line-height:15px; word-break:break-word; }
  tbody tr:nth-child(even) td { background:#f6f8fb; }
  th.r, td.r { text-align:right; } th.c, td.c { text-align:center; } td.nw { white-space:nowrap; }
  tfoot td { font-weight:700; background:#e8edf4; border-bottom:2px solid ${C}; } .mut { color:#6b7280; } .est { color:#b45309; font-weight:700; }
  .nota { margin-top:7px; font-size:10.5px; line-height:15px; color:#4b5563; }
  .fk { font-weight:700; margin-top:8px; color:#374151; } .fv { margin-top:2px; line-height:17px; }
  .fotos { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; } figure { margin:0; border:1px solid #d1d5db; border-radius:6px; overflow:hidden; }
  figure img { width:100%; height:150px; object-fit:cover; display:block; } figcaption { font-size:8.5px; line-height:12px; padding:4px 6px; color:#4b5563; }
  .firma { display:flex; justify-content:space-between; gap:60px; margin-top:44px; } .firma div { flex:1; border-top:1px solid #6b7280; text-align:center; padding-top:5px; font-size:10px; color:#4b5563; }
  </style></head><body>
  <div class="top"><div><h1>INFORME DE MANTENIMIENTO</h1><div class="sub">${esc(titulo)}</div></div>
    <div class="doc"><b>${esc(m.propiedad?.nombre_referencial ?? '')}</b>${esc(empresa)}<br>Emitido ${dmy(new Date().toISOString())}</div></div>
  <div class="box">
    <span class="k">INMUEBLE</span><span>${esc(m.propiedad?.nombre_referencial ?? '—')}${m.seccion?.nombre ? ' · ' + esc(m.seccion.nombre) : ' · todo el predio'}</span>
    <span class="k">ESTADO</span><span>${esc(ESTADOS[m.estado] ?? m.estado)}</span>
    <span class="k">EQUIPO / SISTEMA</span><span>${esc(m.equipo_ref?.nombre ?? m.equipo ?? '—')}${[m.equipo_ref?.marca, m.equipo_ref?.modelo].filter(Boolean).length ? ' <span class="mut">(' + esc([m.equipo_ref.marca, m.equipo_ref.modelo].filter(Boolean).join(' ')) + ')</span>' : ''}</span>
    <span class="k">INICIO</span><span>${dmy(m.fecha)}</span>
    <span class="k">TIPO</span><span>${esc(m.tipo ?? '—')}</span>
    <span class="k">FIN</span><span>${m.fecha_fin ? dmy(m.fecha_fin) : 'en curso'}</span>
    <span class="k">DIRECCIÓN</span><span>${esc([m.propiedad?.direccion, m.propiedad?.distrito].filter(Boolean).join(', '))}</span>
    <span class="k">GARANTÍA HASTA</span><span>${m.garantia_hasta ? dmy(m.garantia_hasta) : '—'}</span>
  </div>
  <div class="sec"><h2>Resumen económico</h2>
    <div class="cards">
      <div class="card hi"><span>Total del trabajo</span><b>S/ ${fmt(r.total)}</b></div>
      <div class="card"><span>Mano de obra / taller</span><b>S/ ${fmt(r.manoObra)}</b></div>
      <div class="card"><span>Materiales y repuestos</span><b>S/ ${fmt(r.materiales)}</b></div>
      <div class="card"><span>${r.presupuesto ? 'Presupuesto inicial' : 'Estimado sin confirmar'}</span><b>S/ ${fmt(r.presupuesto || r.estimado)}</b></div>
    </div>
    ${r.presupuesto ? `<div class="nota">Desvío frente al presupuesto: <b>${r.desvio >= 0 ? '+' : ''}S/ ${fmt(r.desvio)}</b>${r.estimado ? ` · incluye S/ ${fmt(r.estimado)} aún estimados` : ''}</div>` : ''}
  </div>
  ${ficha ? `<div class="sec"><h2>Ficha técnica</h2>${ficha}</div>` : ''}
  ${filasEventos ? `<div class="sec"><h2>Cronología</h2><table><colgroup><col style="width:112px"><col style="width:96px"><col></colgroup><thead><tr><th>Fecha y hora</th><th>Tipo</th><th>Detalle</th></tr></thead><tbody>${filasEventos}</tbody></table></div>` : ''}
  ${filasGastos ? `<div class="sec"><h2>Gastos</h2><table><colgroup><col style="width:68px"><col style="width:92px"><col><col style="width:82px"><col style="width:84px"><col style="width:76px"><col style="width:84px"></colgroup><thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Proveedor</th><th>Comprobante</th><th class="c">Estado</th><th class="r">Monto</th></tr></thead><tbody>${filasGastos}</tbody><tfoot><tr><td colspan="6" class="r">TOTAL</td><td class="r nw">S/ ${fmt(r.total)}</td></tr></tfoot></table></div>` : ''}
  ${filasReparto ? `<div class="sec"><h2>Reparto del costo (proporcional al área)</h2><table><colgroup><col style="width:27%"><col style="width:25%"><col style="width:9%"><col style="width:9%"><col style="width:13%"><col></colgroup><thead><tr><th>Participante</th><th>Ocupa</th><th class="r">m²</th><th class="r">%</th><th class="r">Monto</th><th>Estado</th></tr></thead><tbody>${filasReparto}</tbody><tfoot><tr><td colspan="4" class="r">TOTAL REPARTIDO</td><td class="r nw">S/ ${fmt(r.inquilinos + r.propietario)}</td><td></td></tr></tfoot></table>
    <div class="nota">A cobrar a inquilinos: <b>S/ ${fmt(r.inquilinos)}</b> · Asume el propietario: <b>S/ ${fmt(r.propietario)}</b></div></div>` : ''}
  <div class="sec"><h2>Comisión del contratista</h2>
    <div class="cards" style="grid-template-columns:repeat(3, 1fr);"><div class="card"><span>Base: total del trabajo</span><b>S/ ${fmt(r.total)}</b></div><div class="card"><span>Porcentaje</span><b>${Number(m.comision_pct || 0).toFixed(2)}%</b></div><div class="card hi"><span>Comisión a cargo del propietario</span><b>S/ ${fmt(r.comision)}</b></div></div>
    <div class="nota">La comisión no se reparte a los inquilinos.</div></div>
  ${anexo}
  <div class="firma"><div>Contratista</div><div>Gerencia / Propietario</div></div>
  </body></html>`;
}

/** HTML → PDF A4 multipágina (cortes limpios, encabezado de tabla repetido). */
export async function descargarPDFDesdeHTML(html, nombreArchivo, { soloBlob = false, soloPaginas = false } = {}) {
  const ifr = document.createElement('iframe');
  ifr.style.cssText = 'position:fixed; left:-10000px; top:0; width:794px; height:1123px; border:0; visibility:hidden;';
  document.body.appendChild(ifr);
  try {
    const doc = ifr.contentDocument;
    doc.open(); doc.write(html); doc.close();
    doc.body.style.margin = '0'; doc.body.style.padding = '38px 40px'; doc.body.style.background = '#fff';
    await new Promise((r) => setTimeout(r, 150));
    await Promise.all([...doc.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
    const [{ jsPDF }, h2c] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm'),
      import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm'),
    ]);
    const html2canvas = h2c.default || h2c;
    const alto = Math.ceil(Math.max(...[...doc.body.children].map((e) => e.getBoundingClientRect().bottom + (doc.defaultView.scrollY || 0)))) + 38;
    const canvas = await html2canvas(doc.body, { scale: 2, backgroundColor: '#ffffff', useCORS: true, windowWidth: 794, height: alto, windowHeight: alto });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210, H = 297;
    const mm = canvas.width / W;
    const hPag = Math.floor(H * mm), mTop = Math.round(12 * mm), mBot = Math.round(10 * mm);
    const S = canvas.width / 794;
    const pos = (e) => { const rc = e.getBoundingClientRect(); return { t: Math.round(rc.top * S), b: Math.round(rc.bottom * S) }; };
    // Puntos de corte permitidos: fin de cada bloque raíz y, solo en bloques largos (más de la mitad
    // de la hoja útil), fin de cada fila de cuerpo/pie. Los bloques cortos pasan enteros a la hoja
    // siguiente: nunca se parte una tabla pequeña, un título ni un texto.
    const cortes = new Set();
    const util0 = hPag - mTop - mBot;
    [...doc.body.children].forEach((blk) => {
      const pb = pos(blk);
      cortes.add(pb.b);
      if (pb.b - pb.t > util0 * 0.5) blk.querySelectorAll('tbody tr, tfoot tr, figure, .fv').forEach((e) => cortes.add(pos(e).b));
    });
    const tablas = [...doc.querySelectorAll('table')].filter((t) => t.tHead).map((t) => ({ th: pos(t.tHead), end: pos(t).b }));
    const paginas = [];
    let y = 0, pag = 0;
    while (canvas.height - y > 24) {
      const tab = pag > 0 ? tablas.find((t) => y > t.th.b && y < t.end) : null;
      const offTop = pag === 0 ? 0 : mTop + (tab ? tab.th.b - tab.th.t : 0);
      const util = hPag - offTop - mBot;
      let fin = y + util;
      if (fin >= canvas.height) fin = canvas.height;
      else {
        const cand = [...cortes].filter((c) => c > y + util * 0.3 && c <= fin);
        if (cand.length) fin = Math.max(...cand);
      }
      const trozo = document.createElement('canvas');
      trozo.width = canvas.width; trozo.height = hPag;
      const ctx = trozo.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, trozo.width, trozo.height);
      if (tab) ctx.drawImage(canvas, 0, tab.th.t, canvas.width, tab.th.b - tab.th.t, 0, mTop, canvas.width, tab.th.b - tab.th.t);
      ctx.drawImage(canvas, 0, y, canvas.width, fin - y, 0, offTop, canvas.width, fin - y);
      if (soloPaginas) paginas.push(trozo.toDataURL('image/jpeg', 0.85));
      if (pag > 0) pdf.addPage();
      pdf.addImage(trozo.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, W, H);
      pdf.setFontSize(7).setTextColor(120);
      pdf.text(`Informe de mantenimiento · Página ${pag + 1}`, W - 10.6, H - 5, { align: 'right' });
      y = fin; pag += 1;
    }
    if (soloPaginas) return paginas;
    if (soloBlob) return pdf.output('bloburl');
    pdf.save(nombreArchivo);
  } finally { ifr.remove(); }
}
