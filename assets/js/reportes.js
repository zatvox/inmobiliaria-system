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
  getConfiguracionSistema,
} from './supabase-data.js';
import { qs, qsa, el, formatCurrency, formatDate, showToast, setLoading } from './utils.js';

let html2canvasPromise = null;
const COLOR_ACENTO_DEFAULT = '#1B3A5C';
let colorAcentoCache = null;
let filasInquilinoCache = [];
let contextoInquilinoCache = null;

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

async function descargarComoJPEG(selectorNodo, btnSelector, nombreArchivo) {
  const nodo = qs(selectorNodo);
  if (!nodo) { showToast('Genera el reporte primero.', 'error'); return; }
  const btn = qs(btnSelector);
  setLoading(btn, true, 'Generando imagen…');
  try {
    const html2canvas = await cargarHtml2Canvas();
    const canvas = await html2canvas(nodo, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const link = document.createElement('a');
    link.download = `${nombreArchivo}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.92);
    link.click();
  } catch (err) {
    console.error(err);
    showToast('No se pudo generar la imagen del reporte.', 'error');
  } finally {
    setLoading(btn, false);
  }
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
  qs('#btn-imprimir-reporte')?.addEventListener('click', () => descargarComoJPEG('#reporte-resultado .reporte-imprimible', '#btn-imprimir-reporte', `reporte-cuotas-servicios-${qs('#rp-periodo').value}`));

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
  qs('#btn-imprimir-reporte-alquiler')?.addEventListener('click', () => descargarComoJPEG('#reporte-alquiler-resultado .reporte-imprimible', '#btn-imprimir-reporte-alquiler', `reporte-cuotas-alquiler-${qs('#rpa-periodo').value}`));

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
  qs('#rpi-incluir')?.addEventListener('change', () => {
    if (contextoInquilinoCache) renderReporteInquilino(filasInquilinoCache, contextoInquilinoCache);
  });
  qs('#btn-imprimir-reporte-inquilino')?.addEventListener('click', () => descargarComoJPEG('#reporte-inquilino-resultado .reporte-imprimible', '#btn-imprimir-reporte-inquilino', `estado-cuenta-${(contextoInquilinoCache?.inquilinoNombre ?? 'inquilino').replace(/\s+/g, '-').toLowerCase()}`));
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
      subtitulo: `${qs('#rp-servicio').selectedOptions[0]?.textContent ?? 'Agua y Luz (todos)'} · Periodo ${periodo} · ${soloPendientes ? 'Solo pendientes de cobrar' : 'Todas (incluye pagadas)'}`,
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
      subtitulo: `${qs('#rpa-edificio').selectedOptions[0]?.textContent ?? 'Todos los edificios'} · Periodo ${periodo} · ${soloPendientes ? 'Solo pendientes de cobrar' : 'Todas (incluye pagadas)'}`,
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
function renderReporteAgrupado(cont, filas, { titulo, subtitulo, colDetalleLabel, colorAcento, mensajeVacio }) {
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

  const celdaFechasPago = (f) => {
    if (!f.pagos.length) return el('span', { style: 'color:var(--gray-300);' }, '—');
    return el('div', {}, f.pagos.map((p) => el('div', { style: 'font-size:12px; white-space:nowrap;' }, formatDate(p.fechaPago))));
  };
  const celdaRecibo = (f) => {
    if (!f.pagos.length) return el('span', { style: 'color:var(--gray-300);' }, '—');
    return el('div', {}, f.pagos.map((p) => el('div', { style: 'font-size:12px;' },
      `${p.medioPago}${p.nOperacion ? ' · Op: ' + p.nOperacion : ''} — ${formatCurrency(p.monto)}`)));
  };

  const bordeAcento = `border-left: 4px solid ${colorAcento};`;
  const bordeAcentoSuave = `border-left: 4px solid ${hexToRgba(colorAcento, 0.35)};`;
  const fondoAcentoSuave = `background: ${hexToRgba(colorAcento, 0.06)};`;

  const filasNodos = [];
  grupos.forEach((g) => {
    filasNodos.push(el('tr', { class: 'reporte-header-inmueble', style: `${bordeAcento} ${fondoAcentoSuave}` }, [
      el('td', { colspan: '7', style: `color:${colorAcento};` }, `${g.nombre} — ${g.filas.length} cuota${g.filas.length === 1 ? '' : 's'}`),
    ]));
    g.filas.forEach((f) => {
      filasNodos.push(el('tr', { style: bordeAcentoSuave }, [
        el('td', {}, f.inquilinoNombre),
        el('td', {}, f.seccionNombre),
        el('td', {}, f.tipoServicioNombre),
        el('td', { style: 'text-align:right; font-weight:600;' }, formatCurrency(f.importeTotal)),
        el('td', { style: `text-align:right; font-weight:600; ${f.saldo > 0.009 ? 'color:var(--color-danger);' : 'color:var(--color-success);'}` }, formatCurrency(f.saldo)),
        el('td', {}, [celdaFechasPago(f)]),
        el('td', {}, [celdaRecibo(f)]),
      ]));
    });
    filasNodos.push(el('tr', { class: 'reporte-subtotal-inmueble', style: `${bordeAcento} ${fondoAcentoSuave}` }, [
      el('td', { colspan: '3' }, `Subtotal — ${g.nombre}`),
      el('td', { style: 'text-align:right;' }, formatCurrency(g.subtotalImporte)),
      el('td', { style: 'text-align:right;' }, formatCurrency(g.subtotalSaldo)),
      el('td', { colspan: '2' }, ''),
    ]));
  });
  filasNodos.push(el('tr', { class: 'reporte-total-row' }, [
    el('td', { colspan: '3' }, `TOTAL (${filas.length} cuota${filas.length === 1 ? '' : 's'})`),
    el('td', { style: 'text-align:right;' }, formatCurrency(totalImporte)),
    el('td', { style: 'text-align:right;' }, formatCurrency(totalSaldo)),
    el('td', { colspan: '2' }, ''),
  ]));

  const tabla = el('table', { class: 'data-table reporte-tabla' }, [
    el('thead', {}, [el('tr', {}, [
      el('th', {}, 'Inquilino'), el('th', {}, 'Sección'), el('th', {}, colDetalleLabel),
      el('th', { style: 'text-align:right;' }, 'Importe'), el('th', { style: 'text-align:right;' }, 'Saldo'),
      el('th', {}, 'Fch. pago'), el('th', {}, 'Recibo / método'),
    ])]),
    el('tbody', {}, filasNodos),
  ]);

  cont.append(el('div', { class: 'card reporte-imprimible' }, [
    el('div', { style: 'margin-bottom:14px;' }, [
      el('div', { style: 'font-size:20px; font-weight:800;' }, titulo),
      el('div', { style: 'color:var(--gray-500); margin-top:4px;' }, subtitulo),
      el('div', { style: 'color:var(--gray-500); font-size:12px;' }, `Impreso: ${formatDate(new Date().toISOString().slice(0, 10))}`),
    ]),
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
    const [filas, colorAcento] = await Promise.all([
      listCuotasPorInquilino({ inquilinoId, soloConDeuda }),
      getColorAcento(),
    ]);
    filasInquilinoCache = filas;
    contextoInquilinoCache = { inquilinoNombre, soloConDeuda, colorAcento };
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
  const filas = incluir === 'todo' ? filasCompletas : filasCompletas.filter((f) => f.origen === incluir);

  qs('#btn-imprimir-reporte-inquilino').style.display = filas.length ? 'inline-flex' : 'none';

  if (!filas.length) {
    cont.append(el('div', { class: 'card' }, [
      el('div', { class: 'empty-state' }, [
        el('div', { class: 'icon' }, '📊'),
        el('p', {}, soloConDeuda ? 'Este inquilino no tiene deuda pendiente con ese filtro.' : 'Sin cuotas registradas con ese filtro.'),
      ]),
    ]));
    return;
  }

  const celdaFechasPago = (f) => {
    if (!f.pagos.length) return el('span', { style: 'color:var(--gray-300);' }, '—');
    return el('div', {}, f.pagos.map((p) => el('div', { style: 'font-size:12px; white-space:nowrap;' }, formatDate(p.fechaPago))));
  };
  const celdaRecibo = (f) => {
    if (!f.pagos.length) return el('span', { style: 'color:var(--gray-300);' }, '—');
    return el('div', {}, f.pagos.map((p) => el('div', { style: 'font-size:12px;' },
      `${p.medioPago}${p.nOperacion ? ' · Op: ' + p.nOperacion : ''} — ${formatCurrency(p.monto)}`)));
  };

  const totalImporte = filas.reduce((s, f) => s + f.importeTotal, 0);
  const totalSaldo = filas.reduce((s, f) => s + f.saldo, 0);

  const filasNodos = filas.map((f) => el('tr', {}, [
    el('td', {}, formatDate(f.fechaVencimiento)),
    el('td', {}, f.origen === 'alquiler' ? 'Alquiler' : f.tipoServicioNombre),
    el('td', {}, `${f.propiedadNombre} · ${f.seccionNombre}`),
    el('td', {}, f.concepto ?? '—'),
    el('td', { style: 'text-align:right; font-weight:600;' }, formatCurrency(f.importeTotal)),
    el('td', { style: `text-align:right; font-weight:600; ${f.saldo > 0.009 ? 'color:var(--color-danger);' : 'color:var(--color-success);'}` }, formatCurrency(f.saldo)),
    el('td', {}, [celdaFechasPago(f)]),
    el('td', {}, [celdaRecibo(f)]),
  ]));
  filasNodos.push(el('tr', { class: 'reporte-total-row' }, [
    el('td', { colspan: '4' }, `TOTAL (${filas.length} cuota${filas.length === 1 ? '' : 's'})`),
    el('td', { style: 'text-align:right;' }, formatCurrency(totalImporte)),
    el('td', { style: 'text-align:right;' }, formatCurrency(totalSaldo)),
    el('td', { colspan: '2' }, ''),
  ]));

  const tabla = el('table', { class: 'data-table reporte-tabla' }, [
    el('thead', {}, [el('tr', {}, [
      el('th', {}, 'Vence'), el('th', {}, 'Tipo'), el('th', {}, 'Inmueble · Sección'), el('th', {}, 'Concepto'),
      el('th', { style: 'text-align:right;' }, 'Importe'), el('th', { style: 'text-align:right;' }, 'Saldo'),
      el('th', {}, 'Fch. pago'), el('th', {}, 'Recibo / método'),
    ])]),
    el('tbody', {}, filasNodos),
  ]);

  const incluirLabel = { todo: 'Renta + Servicios', alquiler: 'Solo renta', servicio: 'Solo servicios' }[incluir];
  cont.append(el('div', { class: 'card reporte-imprimible', style: `border-left: 4px solid ${colorAcento};` }, [
    el('div', { style: 'margin-bottom:14px;' }, [
      el('div', { style: 'font-size:20px; font-weight:800;' }, 'ESTADO DE CUENTA'),
      el('div', { style: 'font-size:16px; font-weight:700; margin-top:2px;' }, inquilinoNombre),
      el('div', { style: 'color:var(--gray-500); margin-top:4px;' }, `${incluirLabel} · ${soloConDeuda ? 'Solo lo pendiente' : 'Historial completo'}`),
      el('div', { style: 'color:var(--gray-500); font-size:12px;' }, `Impreso: ${formatDate(new Date().toISOString().slice(0, 10))}`),
    ]),
    el('div', { class: 'table-wrap' }, [tabla]),
  ]));
}

main();
