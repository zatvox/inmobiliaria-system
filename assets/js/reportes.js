/**
 * reportes.js — Módulo Reportes (Fase 4). Tres reportes, cada uno en su
 * propia pestaña:
 *  - Servicios: cuotas de agua/luz por cobrar en un periodo, por inmueble.
 *  - Alquiler: lo mismo pero para la renta mensual (mensualidades).
 *  - Por inquilino: estado de cuenta de UNA persona, mezclando renta +
 *    servicios, no acotado a un mes (es "todo lo que debe").
 * Los dos primeros comparten el mismo layout de tabla agrupada por inmueble
 * (renderReporteAgrupado); el de inquilino es una lista plana porque es una
 * sola persona, no hace falta agrupar por edificio.
 */
import { initShell } from './main.js';
import {
  listTiposServicio, listPropiedades, listPersonas,
  listCuotasServicioParaReporte, listCuotasAlquilerParaReporte, listCuotasPorInquilino,
  getConfiguracionSistema, getPersona,
} from './supabase-data.js';
import { enviarImagenWhatsapp, mensajeEstadoCuenta } from './whatsapp.js';
import { qs, qsa, el, formatCurrency, formatDate, showToast, setLoading } from './utils.js';

let html2canvasPromise = null;
const COLOR_ACENTO_DEFAULT = '#1B3A5C';
let colorAcentoCache = null;
let filasInquilinoCache = [];
let contextoInquilinoCache = null;
let filasVisiblesInquilino = [];
const colsOcultasInquilino = new Set(); // columnas ocultas por el menú ⋮ del estado de cuenta

// Color del acento que conecta el nombre de cada inmueble con sus filas de
// detalle — configurable desde Configuración (⚙️), se pide una sola vez.
async function getColorAcento() {
  if (colorAcentoCache) return colorAcentoCache;
  try {
    const cfg = await getConfiguracionSistema();
    colorAcentoCache = cfg?.color_acento_reportes || COLOR_ACENTO_DEFAULT;
  } catch (err) {
    console.error(err);
    colorAcentoCache = COLOR_ACENTO_DEFAULT;
  }
  return colorAcentoCache;
}

function hexToRgba(hex, alpha) {
  const h = (hex || COLOR_ACENTO_DEFAULT).replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Carga html2canvas desde CDN solo la primera vez que se necesita (no hay
// build step en este proyecto, así que se inyecta como <script> clásico —
// mismo patrón que assets/js/cuadro-consumo.js).
function cargarHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (html2canvasPromise) return html2canvasPromise;
  html2canvasPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    script.onload = () => resolve(window.html2canvas);
    script.onerror = () => reject(new Error('No se pudo cargar la herramienta de imagen (html2canvas). Revisa tu conexión a internet.'));
    document.head.append(script);
  });
  return html2canvasPromise;
}

const scriptsCargados = {};
function cargarScript(url, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (scriptsCargados[url]) return scriptsCargados[url];
  scriptsCargados[url] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve(window[globalName]);
    s.onerror = () => reject(new Error(`No se pudo cargar ${globalName}. Revisa tu conexión a internet.`));
    document.head.append(s);
  });
  return scriptsCargados[url];
}

// Captura el reporte en un ancho de hoja vertical (~A4): se clona fuera de
// pantalla a 780 px de ancho, con tabla al 100 %, letra compacta y texto que
// puede saltar de línea, de modo que las columnas se ajustan a la hoja en vez
// de quedar una tabla ancha reducida. El original en pantalla no se toca.
async function capturarCanvas(nodo) {
  const html2canvas = await cargarHtml2Canvas();
  const ANCHO = 780;
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed; left:-20000px; top:0; width:${ANCHO}px; background:#fff;`;
  const clon = nodo.cloneNode(true);
  clon.querySelectorAll('[data-html2canvas-ignore]').forEach((n) => n.remove());
  clon.style.cssText += `;width:${ANCHO}px; max-width:none; box-sizing:border-box; margin:0; box-shadow:none;`;
  clon.querySelectorAll('.table-wrap').forEach((w) => { w.style.overflow = 'visible'; });
  clon.querySelectorAll('table').forEach((t) => { t.style.width = '100%'; t.style.minWidth = '0'; t.style.tableLayout = 'auto'; });
  clon.querySelectorAll('th, td').forEach((c) => { c.style.fontSize = '11.5px'; c.style.padding = '7px 6px'; });
  clon.querySelectorAll('th').forEach((c) => { c.style.whiteSpace = 'normal'; });
  wrap.append(clon);
  document.body.append(wrap);
  try {
    return await html2canvas(clon, { scale: 2.5, backgroundColor: '#ffffff', useCORS: true, windowWidth: ANCHO + 40 });
  } finally {
    wrap.remove();
  }
}

function guardarBlobUrl(url, nombre) {
  const link = document.createElement('a');
  link.download = nombre;
  link.href = url;
  link.click();
}

async function exportarPNG(nodo, nombre) {
  const canvas = await capturarCanvas(nodo);
  guardarBlobUrl(canvas.toDataURL('image/png'), `${nombre}.png`);
}

// PDF A4 horizontal: la captura se escala al ancho útil y se corta en tantas
// páginas como haga falta.
async function exportarPDF(nodo, nombre) {
  const [canvas, jspdf] = await Promise.all([
    capturarCanvas(nodo),
    cargarScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js', 'jspdf'),
  ]);
  // Siempre A4 vertical. La captura ya viene con las columnas ajustadas al
  // ancho de una hoja vertical (ver capturarCanvas), así que se escala al
  // ancho útil; si además cabe completa en una hoja, se ajusta a una sola. Si
  // es tan larga que quedaría ilegible, se reparte en varias hojas.
  const margen = 24;
  const pdf = new jspdf.jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const anchoPag = pdf.internal.pageSize.getWidth() - margen * 2;
  const altoPag = pdf.internal.pageSize.getHeight() - margen * 2;
  const ajustada = Math.min(anchoPag / canvas.width, altoPag / canvas.height);
  const MIN_LEGIBLE = (anchoPag / canvas.width) * 0.75; // no achicar más de 25% bajo el ancho útil
  if (ajustada >= MIN_LEGIBLE) {
    const w = canvas.width * ajustada;
    const h = canvas.height * ajustada;
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', (pdf.internal.pageSize.getWidth() - w) / 2, margen, w, h);
    pdf.save(`${nombre}.pdf`);
    return;
  }
  const escala = anchoPag / canvas.width;
  const altoSliceCanvas = Math.floor(altoPag / escala);
  for (let y = 0, pagina = 0; y < canvas.height; y += altoSliceCanvas, pagina += 1) {
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = Math.min(altoSliceCanvas, canvas.height - y);
    slice.getContext('2d').drawImage(canvas, 0, y, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
    if (pagina > 0) pdf.addPage();
    pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', margen, margen, anchoPag, slice.height * escala);
  }
  pdf.save(`${nombre}.pdf`);
}

// XLSX con datos reales: los importes "S/ 1,300.00" pasan a número con
// formato de moneda y las fechas DD/MM/AAAA quedan como texto tal cual.
async function exportarXLSX(nodo, nombre) {
  const XLSX = await cargarScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'XLSX');
  const tabla = nodo.querySelector('table');
  if (!tabla) throw new Error('Sin tabla');
  const aoa = [];
  [...nodo.children[0]?.children ?? []].forEach((d) => aoa.push([d.textContent.trim()]));
  aoa.push([]);
  const reMoneda = /^S\/\s*(-?[\d,]+(?:\.\d+)?)$/;
  const colsMoneda = new Set();
  [...tabla.rows].forEach((tr) => {
    // Solo celdas visibles (respeta columnas ocultas con el menú ⋮).
    const celdas = [...tr.cells].filter((c) => c.style.display !== 'none');
    const fila = celdas.map((c) => c.textContent.trim().replace(/\s+/g, ' '));
    // Filas con celdas combinadas (encabezado de edificio, subtotales) se
    // alinean a su posición real de columna.
    const salida = [];
    celdas.forEach((c, i) => {
      salida.push(fila[i]);
      for (let k = 1; k < (c.colSpan || 1); k += 1) salida.push('');
    });
    aoa.push(salida);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  Object.keys(ws).forEach((ref) => {
    if (ref[0] === '!') return;
    const m = typeof ws[ref].v === 'string' && ws[ref].v.match(reMoneda);
    if (m) { ws[ref].t = 'n'; ws[ref].v = Number(m[1].replace(/,/g, '')); ws[ref].z = '#,##0.00'; colsMoneda.add(ref); }
  });
  const anchos = [];
  aoa.forEach((f) => f.forEach((v, i) => { anchos[i] = Math.max(anchos[i] ?? 8, Math.min(String(v ?? '').length + 2, 42)); }));
  ws['!cols'] = anchos.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
  XLSX.writeFile(wb, `${nombre}.xlsx`);
}

// Enlaza un menú "Descargar ▾" (wrapper .dl-menu) con los 3 formatos.
function bindDescarga(wrapperId, selectorNodo, nombreFn) {
  const wrap = qs(wrapperId);
  if (!wrap) return;
  const toggle = wrap.querySelector('.dl-toggle');
  toggle.addEventListener('click', (e) => { e.stopPropagation(); wrap.classList.toggle('open'); });
  document.addEventListener('click', () => wrap.classList.remove('open'));
  wrap.querySelectorAll('[data-fmt]').forEach((b) => b.addEventListener('click', async () => {
    wrap.classList.remove('open');
    const nodo = qs(selectorNodo);
    if (!nodo) { showToast('Genera el reporte primero.', 'error'); return; }
    const fmt = b.dataset.fmt;
    setLoading(toggle, true, 'Generando…');
    try {
      const nombre = nombreFn();
      if (fmt === 'pdf') await exportarPDF(nodo, nombre);
      else if (fmt === 'png') await exportarPNG(nodo, nombre);
      else await exportarXLSX(nodo, nombre);
    } catch (err) {
      console.error(err);
      showToast(`No se pudo generar el ${fmt.toUpperCase()} del reporte.`, 'error');
    } finally {
      setLoading(toggle, false);
    }
  }));
}

function bindTabs() {
  qsa('.tab-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      qsa('.tab-btn[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      qsa('.tab-panel').forEach((p) => { p.style.display = p.id === `panel-${btn.dataset.tab}` ? 'block' : 'none'; });
    });
  });
}

async function main() {
  const profile = await initShell('reportes');
  if (!profile) return;

  const hoy = new Date();
  const periodoActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;

  bindTabs();
  document.addEventListener('click', () => qsa('.cols-menu.open').forEach((m) => m.classList.remove('open')));

  // --- Servicios ---
  try {
    const tipos = await listTiposServicio();
    const sel = qs('#rp-servicio');
    tipos.forEach((t) => sel.append(el('option', { value: t.id }, t.nombre)));
  } catch (err) {
    console.error(err);
  }
  qs('#rp-periodo').value = periodoActual;
  qs('#btn-generar-reporte')?.addEventListener('click', generarReporteServicios);
  bindDescarga('#btn-imprimir-reporte', '#reporte-resultado .reporte-imprimible', () => `reporte-cuotas-servicios-${qs('#rp-periodo').value}`);

  // --- Alquiler ---
  try {
    const propiedades = await listPropiedades();
    const sel = qs('#rpa-edificio');
    propiedades.forEach((p) => sel.append(el('option', { value: p.id }, p.nombre_referencial)));
  } catch (err) {
    console.error(err);
  }
  qs('#rpa-periodo').value = periodoActual;
  qs('#btn-generar-reporte-alquiler')?.addEventListener('click', generarReporteAlquiler);
  bindDescarga('#btn-imprimir-reporte-alquiler', '#reporte-alquiler-resultado .reporte-imprimible', () => `reporte-cuotas-alquiler-${qs('#rpa-periodo').value}`);

  // --- Por inquilino ---
  try {
    const inquilinos = await listPersonas({ rol: 'inquilino' });
    const sel = qs('#rpi-inquilino');
    inquilinos
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .forEach((p) => sel.append(el('option', { value: p.id }, p.nombre)));
  } catch (err) {
    console.error(err);
  }
  qs('#btn-generar-reporte-inquilino')?.addEventListener('click', generarReporteInquilino);
  ['#rpi-incluir', '#rpi-periodo'].forEach((sel) => qs(sel)?.addEventListener('change', () => {
    if (contextoInquilinoCache) renderReporteInquilino(filasInquilinoCache, contextoInquilinoCache);
  }));
  qs('#btn-wa-reporte-inquilino')?.addEventListener('click', () => {
    const nodo = qs('#reporte-inquilino-resultado .reporte-imprimible');
    if (!nodo) return;
    const pendiente = filasVisiblesInquilino.reduce((t, f) => t + Math.max(0, Number(f.saldo) || 0), 0);
    enviarImagenWhatsapp({
      telefono: contextoInquilinoCache?.telefono,
      mensaje: mensajeEstadoCuenta(contextoInquilinoCache?.inquilinoNombre, pendiente),
      obtenerCanvas: () => capturarCanvas(nodo),
      nombreArchivo: `estado-cuenta-${(contextoInquilinoCache?.inquilinoNombre ?? 'inquilino').split(' ')[0].toLowerCase()}`,
    });
  });
  bindDescarga('#btn-imprimir-reporte-inquilino', '#reporte-inquilino-resultado .reporte-imprimible', () => `estado-cuenta-${(contextoInquilinoCache?.inquilinoNombre ?? 'inquilino').replace(/\s+/g, '-').toLowerCase()}`);
}

/* ============================== SERVICIOS ================================ */
async function generarReporteServicios() {
  const periodo = qs('#rp-periodo').value;
  if (!periodo) { showToast('Elige un periodo (mes) primero.', 'error'); return; }
  const tipoServicioId = qs('#rp-servicio').value;
  const soloPendientes = qs('#rp-estado').value !== 'todos';

  const btn = qs('#btn-generar-reporte');
  setLoading(btn, true, 'Generando…');
  try {
    const [filas, colorAcento] = await Promise.all([
      listCuotasServicioParaReporte({ periodo, tipoServicioId, soloPendientes }),
      getColorAcento(),
    ]);
    renderReporteAgrupado(qs('#reporte-resultado'), filas, {
      titulo: 'CUOTAS POR COBRAR — SERVICIOS',
      etiqueta: qs('#rp-servicio').selectedOptions[0]?.textContent ?? 'Agua y Luz (todos)',
      periodo,
      alcance: soloPendientes ? 'Solo pendientes de cobrar' : 'Todas (incluye pagadas)',
      colDetalleLabel: 'Servicio',
      colorAcento,
      mensajeVacio: soloPendientes
        ? 'No hay cuotas de servicio pendientes de cobrar para ese periodo/servicio.'
        : 'No hay cuotas de servicio registradas para ese periodo/servicio.',
    });
    qs('#btn-imprimir-reporte').style.display = filas.length ? 'inline-flex' : 'none';
  } catch (err) {
    console.error(err);
    showToast('No se pudo generar el reporte.', 'error');
  } finally {
    setLoading(btn, false);
  }
}

/* =============================== ALQUILER ================================= */
async function generarReporteAlquiler() {
  const periodo = qs('#rpa-periodo').value;
  if (!periodo) { showToast('Elige un periodo (mes) primero.', 'error'); return; }
  const propiedadId = qs('#rpa-edificio').value;
  const soloPendientes = qs('#rpa-estado').value !== 'todos';

  const btn = qs('#btn-generar-reporte-alquiler');
  setLoading(btn, true, 'Generando…');
  try {
    const [filas, colorAcento] = await Promise.all([
      listCuotasAlquilerParaReporte({ periodo, propiedadId, soloPendientes }),
      getColorAcento(),
    ]);
    renderReporteAgrupado(qs('#reporte-alquiler-resultado'), filas, {
      titulo: 'CUOTAS POR COBRAR — ALQUILER',
      etiqueta: qs('#rpa-edificio').selectedOptions[0]?.textContent ?? 'Todos los edificios',
      periodo,
      alcance: soloPendientes ? 'Solo pendientes de cobrar' : 'Todas (incluye pagadas)',
      colDetalleLabel: 'Concepto',
      colorAcento,
      mensajeVacio: soloPendientes
        ? 'No hay mensualidades de alquiler pendientes de cobrar para ese periodo/edificio.'
        : 'No hay mensualidades de alquiler registradas para ese periodo/edificio.',
    });
    qs('#btn-imprimir-reporte-alquiler').style.display = filas.length ? 'inline-flex' : 'none';
  } catch (err) {
    console.error(err);
    showToast('No se pudo generar el reporte.', 'error');
  } finally {
    setLoading(btn, false);
  }
}

// Tabla agrupada por inmueble, reutilizada por Servicios y Alquiler — ambas
// funciones de datos devuelven filas con la misma forma (propiedadId,
// propiedadNombre, seccionNombre, inquilinoNombre, tipoServicioNombre,
// importeTotal, saldo, pagos...), así que el render es idéntico salvo
// textos y el nombre de la tercera columna.
function renderReporteAgrupado(cont, filas, { titulo, etiqueta, periodo, alcance, colDetalleLabel, colorAcento, mensajeVacio }) {
  cont.innerHTML = '';

  if (!filas.length) {
    cont.append(el('div', { class: 'card' }, [
      el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '📊'), el('p', {}, mensajeVacio)]),
    ]));
    return;
  }

  const porInmueble = new Map();
  filas.forEach((f) => {
    const key = f.propiedadId ?? f.propiedadNombre;
    if (!porInmueble.has(key)) porInmueble.set(key, { nombre: f.propiedadNombre, filas: [], subtotalImporte: 0, subtotalSaldo: 0 });
    const grupo = porInmueble.get(key);
    grupo.filas.push(f);
    grupo.subtotalImporte += f.importeTotal;
    grupo.subtotalSaldo += f.saldo;
  });
  const grupos = [...porInmueble.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  const totalImporte = filas.reduce((s, f) => s + f.importeTotal, 0);
  const totalSaldo = filas.reduce((s, f) => s + f.saldo, 0);

  const dmy = (v) => (v ? formatDate(v, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
  const hoyIso = new Date().toISOString().slice(0, 10);
  const celdaFechasPago = (f) => {
    if (!f.pagos.length) return el('span', { style: 'color:var(--gray-300);' }, '—');
    return el('div', {}, f.pagos.map((p) => el('div', { style: 'font-size:12px; white-space:nowrap;' }, dmy(p.fechaPago))));
  };
  const celdaRecibo = (f) => {
    if (!f.pagos.length) return el('span', { style: 'color:var(--gray-300);' }, '—');
    return el('div', {}, f.pagos.map((p) => el('div', { style: 'font-size:12px;' },
      `${p.medioPago}${p.nOperacion ? ' · Op: ' + p.nOperacion : ''} — ${formatCurrency(p.monto)}`)));
  };
  // Estado visible calculado: pagada / vencida (con días de atraso) / por vencer.
  const celdaEstado = (f) => {
    if (f.saldo <= 0.009) return el('span', { style: 'color:var(--color-success); font-weight:600;' }, 'Pagada');
    if (f.fechaVencimiento && f.fechaVencimiento < hoyIso) {
      const dias = Math.round((Date.parse(hoyIso) - Date.parse(f.fechaVencimiento)) / 86400000);
      return el('span', { style: 'color:var(--color-danger); font-weight:600; white-space:nowrap;' }, `Vencida · ${dias} d`);
    }
    return el('span', { style: 'color:var(--gray-600); font-weight:600;' }, 'Por vencer');
  };

  const bordeAcento = `border-left: 4px solid ${colorAcento};`;
  const bordeAcentoSuave = `border-left: 4px solid ${hexToRgba(colorAcento, 0.35)};`;
  const fondoAcentoSuave = `background: ${hexToRgba(colorAcento, 0.06)};`;

  const filasNodos = [];
  grupos.forEach((g) => {
    filasNodos.push(el('tr', { class: 'reporte-header-inmueble', style: `${bordeAcento} ${fondoAcentoSuave}` }, [
      el('td', { colspan: '9', style: `color:${colorAcento};` }, `${g.nombre} — ${g.filas.length} cuota${g.filas.length === 1 ? '' : 's'}`),
    ]));
    [...g.filas].sort((a, b) => (a.fechaVencimiento ?? '').localeCompare(b.fechaVencimiento ?? '') || a.inquilinoNombre.localeCompare(b.inquilinoNombre)).forEach((f) => {
      filasNodos.push(el('tr', { style: bordeAcentoSuave }, [
        el('td', {}, f.inquilinoNombre),
        el('td', {}, f.seccionNombre),
        el('td', {}, f.tipoServicioNombre),
        el('td', { style: 'white-space:nowrap; font-weight:600;' }, dmy(f.fechaVencimiento)),
        el('td', {}, [celdaEstado(f)]),
        el('td', { style: 'text-align:right; font-weight:600;' }, formatCurrency(f.importeTotal)),
        el('td', { style: `text-align:right; font-weight:600; ${f.saldo > 0.009 ? 'color:var(--color-danger);' : 'color:var(--color-success);'}` }, formatCurrency(f.saldo)),
        el('td', {}, [celdaFechasPago(f)]),
        el('td', {}, [celdaRecibo(f)]),
      ]));
    });
    filasNodos.push(el('tr', { class: 'reporte-subtotal-inmueble', style: `${bordeAcento} ${fondoAcentoSuave}` }, [
      el('td', { colspan: '5' }, `Subtotal — ${g.nombre}`),
      el('td', { style: 'text-align:right;' }, formatCurrency(g.subtotalImporte)),
      el('td', { style: 'text-align:right;' }, formatCurrency(g.subtotalSaldo)),
      el('td', { colspan: '2' }, ''),
    ]));
  });
  filasNodos.push(el('tr', { class: 'reporte-total-row' }, [
    el('td', { colspan: '5' }, `TOTAL (${filas.length} cuota${filas.length === 1 ? '' : 's'})`),
    el('td', { style: 'text-align:right;' }, formatCurrency(totalImporte)),
    el('td', { style: 'text-align:right;' }, formatCurrency(totalSaldo)),
    el('td', { colspan: '2' }, ''),
  ]));

  const tabla = el('table', { class: 'data-table reporte-tabla' }, [
    el('thead', {}, [el('tr', {}, [
      el('th', {}, 'Inquilino'), el('th', {}, 'Sección'), el('th', {}, colDetalleLabel),
      el('th', {}, 'Vencimiento'), el('th', {}, 'Estado'),
      el('th', { style: 'text-align:right;' }, 'Importe'), el('th', { style: 'text-align:right;' }, 'Saldo'),
      el('th', {}, 'Fch. pago'), el('th', {}, 'Recibo / método'),
    ])]),
    el('tbody', {}, filasNodos),
  ]);

  const periodoTxt = periodo ? `Mes ${periodo.slice(5)}/${periodo.slice(0, 4)}` : 'Todos los meses';
  cont.append(el('div', { class: 'card reporte-imprimible', style: 'position:relative;' }, [
    el('div', { style: 'margin-bottom:14px; padding-right:190px;' }, [
      el('div', { style: 'font-size:20px; font-weight:800;' }, titulo),
      el('div', { style: 'color:var(--gray-500); margin-top:4px;' }, [
        el('strong', { style: 'color:var(--gray-800);' }, etiqueta), ` · ${alcance}`,
      ]),
      el('div', { style: 'color:#000; font-size:12px;' }, `Generado: ${dmy(hoyIso)}`),
    ]),
    el('div', { style: `position:absolute; top:14px; right:52px; border:2px solid ${colorAcento}; border-radius:4px; padding:6px 14px; font-weight:800; font-size:15px; color:${colorAcento}; background:#fff; white-space:nowrap;` }, periodoTxt),
    el('div', { class: 'table-wrap' }, [tabla]),
  ]));
}

/* ============================== POR INQUILINO ============================= */
async function generarReporteInquilino() {
  const inquilinoId = qs('#rpi-inquilino').value;
  const inquilinoNombre = qs('#rpi-inquilino').selectedOptions[0]?.textContent ?? '';
  if (!inquilinoId) { showToast('Elige un inquilino primero.', 'error'); return; }
  const soloConDeuda = qs('#rpi-alcance').value !== 'todo';

  const btn = qs('#btn-generar-reporte-inquilino');
  setLoading(btn, true, 'Generando…');
  try {
    const [filas, colorAcento, persona] = await Promise.all([
      listCuotasPorInquilino({ inquilinoId, soloConDeuda }),
      getColorAcento(),
      getPersona(inquilinoId).catch(() => null),
    ]);
    filasInquilinoCache = filas;
    contextoInquilinoCache = { inquilinoNombre, soloConDeuda, colorAcento, telefono: persona?.telefono ?? null };
    renderReporteInquilino(filas, contextoInquilinoCache);
  } catch (err) {
    console.error(err);
    showToast('No se pudo generar el reporte.', 'error');
  } finally {
    setLoading(btn, false);
  }
}

// Lista plana (sin agrupar por inmueble, porque es una sola persona) de
// todas sus cuotas — filtrable por "Incluir" (todo / solo renta / solo
// servicios) sin volver a pedir datos, ya que ya se trajeron ambos orígenes
// juntos en generarReporteInquilino().
function renderReporteInquilino(filasCompletas, { inquilinoNombre, soloConDeuda, colorAcento }) {
  const cont = qs('#reporte-inquilino-resultado');
  cont.innerHTML = '';
  const incluir = qs('#rpi-incluir')?.value ?? 'todo';
  const periodo = qs('#rpi-periodo')?.value ?? '';
  const filas = filasCompletas
    .filter((f) => incluir === 'todo' || f.origen === incluir)
    .filter((f) => !periodo || (f.fechaVencimiento ?? '').startsWith(periodo));
  const dmy = (v) => (v ? formatDate(v, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
  const periodoLabel = periodo ? `Mes ${periodo.slice(5)}/${periodo.slice(0, 4)}` : 'Todos los meses';

  qs('#btn-imprimir-reporte-inquilino').style.display = filas.length ? 'inline-flex' : 'none';
  qs('#btn-wa-reporte-inquilino').style.display = filas.length ? 'inline-flex' : 'none';
  filasVisiblesInquilino = filas;

  if (!filas.length) {
    cont.append(el('div', { class: 'card' }, [
      el('div', { class: 'empty-state' }, [
        el('div', { class: 'icon' }, '📊'),
        el('p', {}, soloConDeuda ? `Este inquilino no tiene deuda pendiente con ese filtro (${periodoLabel}).` : `Sin cuotas registradas con ese filtro (${periodoLabel}).`),
      ]),
    ]));
    return;
  }

  const celdaFechasPago = (f) => {
    if (!f.pagos.length) return el('span', { style: 'color:var(--gray-300);' }, '—');
    return el('div', {}, f.pagos.map((p) => el('div', { style: 'font-size:12px; white-space:nowrap;' }, dmy(p.fechaPago))));
  };
  const celdaRecibo = (f) => {
    if (!f.pagos.length) return el('span', { style: 'color:var(--gray-300);' }, '—');
    return el('div', {}, f.pagos.map((p) => el('div', { style: 'font-size:12px;' },
      `${p.medioPago}${p.nOperacion ? ' · Op: ' + p.nOperacion : ''} — ${formatCurrency(p.monto)}`)));
  };

  const totalImporte = filas.reduce((s, f) => s + f.importeTotal, 0);
  const totalSaldo = filas.reduce((s, f) => s + f.saldo, 0);

  // Columnas del reporte; las ocultas (menú ⋮) se quitan de la tabla y, por
  // tanto, también de las descargas PDF / PNG / XLSX.
  const columnas = [
    { k: 'vence', label: 'Vence', celda: (f) => el('td', { style: 'white-space:nowrap;' }, dmy(f.fechaVencimiento)) },
    { k: 'tipo', label: 'Tipo', celda: (f) => el('td', {}, f.origen === 'alquiler' ? 'Alquiler' : f.tipoServicioNombre) },
    { k: 'inmueble', label: 'Inmueble · Sección', celda: (f) => el('td', {}, `${f.propiedadNombre} · ${f.seccionNombre}`) },
    { k: 'concepto', label: 'Concepto', celda: (f) => el('td', {}, f.concepto ?? '—') },
    { k: 'importe', label: 'Importe', dinero: true, celda: (f) => el('td', { style: 'text-align:right; font-weight:600;' }, formatCurrency(f.importeTotal)) },
    { k: 'saldo', label: 'Saldo', dinero: true, celda: (f) => el('td', { style: `text-align:right; font-weight:600; ${f.saldo > 0.009 ? 'color:var(--color-danger);' : 'color:var(--color-success);'}` }, formatCurrency(f.saldo)) },
    { k: 'fchpago', label: 'Fch. pago', celda: (f) => el('td', {}, [celdaFechasPago(f)]) },
    { k: 'recibo', label: 'Recibo / método', celda: (f) => el('td', {}, [celdaRecibo(f)]) },
  ];
  const visibles = columnas.filter((c) => !colsOcultasInquilino.has(c.k));

  const filasNodos = filas.map((f) => el('tr', {}, visibles.map((c) => c.celda(f))));
  const totales = { importe: totalImporte, saldo: totalSaldo };
  const celdasTotal = [];
  let pendientes = 0;
  let etiquetaPuesta = false;
  const textoTotal = `TOTAL (${filas.length} cuota${filas.length === 1 ? '' : 's'})`;
  visibles.forEach((c) => {
    if (c.dinero) {
      if (pendientes) { celdasTotal.push(el('td', { colspan: String(pendientes) }, etiquetaPuesta ? '' : textoTotal)); etiquetaPuesta = true; pendientes = 0; }
      celdasTotal.push(el('td', { style: 'text-align:right;' }, formatCurrency(totales[c.k])));
    } else pendientes += 1;
  });
  if (pendientes) celdasTotal.push(el('td', { colspan: String(pendientes) }, etiquetaPuesta ? '' : textoTotal));
  filasNodos.push(el('tr', { class: 'reporte-total-row' }, celdasTotal));

  const tabla = el('table', { class: 'data-table reporte-tabla' }, [
    el('thead', {}, [el('tr', {}, visibles.map((c) => el('th', { style: c.dinero ? 'text-align:right;' : '' }, c.label)))]),
    el('tbody', {}, filasNodos),
  ]);

  // Menú ⋮ (esquina superior derecha) para mostrar/ocultar columnas. Se marca
  // data-html2canvas-ignore para que no salga en PNG/PDF; queda fuera del
  // primer hijo de la tarjeta, así que tampoco entra al XLSX.
  const menuCols = el('div', { class: 'cols-menu', 'data-html2canvas-ignore': 'true' }, [
    el('button', { type: 'button', class: 'cols-toggle', title: 'Columnas', onclick: (e) => { e.stopPropagation(); menuCols.classList.toggle('open'); } }, '⋮'),
    el('div', { class: 'cols-list', onclick: (e) => e.stopPropagation() }, [
      el('div', { class: 'cols-title' }, 'Columnas'),
      ...columnas.map((c) => {
        const chk = el('input', { type: 'checkbox' });
        chk.checked = !colsOcultasInquilino.has(c.k);
        chk.addEventListener('change', () => {
          if (chk.checked) colsOcultasInquilino.delete(c.k); else colsOcultasInquilino.add(c.k);
          if (colsOcultasInquilino.size >= columnas.length) { colsOcultasInquilino.delete(c.k); }
          renderReporteInquilino(filasCompletas, { inquilinoNombre, soloConDeuda, colorAcento });
          qs('#reporte-inquilino-resultado .cols-menu')?.classList.add('open');
        });
        return el('label', {}, [chk, ` ${c.label}`]);
      }),
    ]),
  ]);

  const incluirLabel = { todo: 'Renta + Servicios', alquiler: 'Solo renta', servicio: 'Solo servicios' }[incluir];
  // Inmueble(s) y sección(es) donde está el inquilino, sin repetir.
  const inmuebles = [...new Set(filas.map((f) => `${f.propiedadNombre} · ${f.seccionNombre}`))].join('  |  ');
  cont.append(el('div', { class: 'card reporte-imprimible', style: `border-left: 4px solid ${colorAcento}; position:relative;` }, [
    el('div', { style: 'margin-bottom:14px;' }, [
      el('div', { style: 'font-size:20px; font-weight:800;' }, 'ESTADO DE CUENTA'),
      el('div', { style: 'margin-top:2px; display:flex; flex-wrap:wrap; align-items:baseline; gap:4px 12px; padding-right:150px;' }, [
        el('span', { style: 'font-size:16px; font-weight:700;' }, inquilinoNombre),
        ...(inmuebles ? [el('span', { style: 'font-size:14px; color:var(--gray-600);' }, inmuebles)] : []),
      ]),
      el('div', { style: 'color:var(--gray-500); margin-top:4px;' }, incluirLabel),
      // Recuadro del periodo en la esquina superior derecha (a la izquierda del menú ⋮).
      el('div', { style: `position:absolute; top:14px; right:52px; border:2px solid ${colorAcento}; border-radius:4px; padding:6px 14px; font-weight:800; font-size:15px; color:${colorAcento}; background:#fff; white-space:nowrap;` }, periodoLabel),
    ]),
    el('div', { class: 'table-wrap' }, [tabla]),
    menuCols,
  ]));
}

main();
