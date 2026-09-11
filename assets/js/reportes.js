/**
 * reportes.js — Módulo Reportes (Fase 4). Por ahora un solo reporte: cuotas
 * por cobrar de servicios (agua/luz) de un periodo, consolidado por
 * inmueble con el detalle de cada inquilino a la par — pensado para
 * imprimirse como el control físico que ya llevaban en Excel. Se puede ir
 * agregando más reportes a esta misma página más adelante.
 */
import { initShell } from './main.js';
import { listTiposServicio, listCuotasServicioParaReporte, getConfiguracionSistema } from './supabase-data.js';
import { qs, qsa, el, formatCurrency, formatDate, showToast, setLoading } from './utils.js';

let html2canvasPromise = null;
const COLOR_ACENTO_DEFAULT = '#1B3A5C';
let colorAcentoCache = null;

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

async function descargarReporteComoJPEG(periodo) {
  const nodo = qs('.reporte-imprimible');
  if (!nodo) { showToast('Genera el reporte primero.', 'error'); return; }
  const btn = qs('#btn-imprimir-reporte');
  setLoading(btn, true, 'Generando imagen…');
  try {
    const html2canvas = await cargarHtml2Canvas();
    const canvas = await html2canvas(nodo, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const link = document.createElement('a');
    link.download = `reporte-cuotas-servicios-${periodo}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.92);
    link.click();
  } catch (err) {
    console.error(err);
    showToast('No se pudo generar la imagen del reporte.', 'error');
  } finally {
    setLoading(btn, false);
  }
}

async function main() {
  const profile = await initShell('reportes');
  if (!profile) return;

  try {
    const tipos = await listTiposServicio();
    const sel = qs('#rp-servicio');
    tipos.forEach((t) => sel.append(el('option', { value: t.id }, t.nombre)));
  } catch (err) {
    console.error(err);
  }

  // Por defecto, el mes actual — es lo que casi siempre se quiere imprimir.
  const hoy = new Date();
  qs('#rp-periodo').value = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;

  qs('#btn-generar-reporte')?.addEventListener('click', generarReporte);
  qs('#btn-imprimir-reporte')?.addEventListener('click', () => descargarReporteComoJPEG(qs('#rp-periodo').value));
}

async function generarReporte() {
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
    renderReporte(filas, { periodo, soloPendientes, servicioNombre: qs('#rp-servicio').selectedOptions[0]?.textContent ?? 'Agua y Luz (todos)', colorAcento });
    qs('#btn-imprimir-reporte').style.display = filas.length ? 'inline-flex' : 'none';
  } catch (err) {
    console.error(err);
    showToast('No se pudo generar el reporte.', 'error');
  } finally {
    setLoading(btn, false);
  }
}

function renderReporte(filas, { periodo, soloPendientes, servicioNombre, colorAcento }) {
  const cont = qs('#reporte-resultado');
  cont.innerHTML = '';

  if (!filas.length) {
    cont.append(el('div', { class: 'card' }, [
      el('div', { class: 'empty-state' }, [
        el('div', { class: 'icon' }, '📊'),
        el('p', {}, soloPendientes
          ? 'No hay cuotas de servicio pendientes de cobrar para ese periodo/servicio.'
          : 'No hay cuotas de servicio registradas para ese periodo/servicio.'),
      ]),
    ]));
    return;
  }

  // Agrupa por inmueble, cada uno con su lista de inquilinos y subtotales —
  // mismo criterio que la hoja de Excel (INMUEBLE a la izquierda, detalle de
  // cada inquilino a la derecha).
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

  // Celda con el detalle de pagos (una cuota puede cobrarse en varias
  // partes, en distintas fechas) — se apilan como líneas pequeñas, igual
  // que en el detalle de cuota de Cobranzas. Sin pagos aún, queda en blanco
  // para llenar a mano en el control físico.
  const celdaFechasPago = (f) => {
    if (!f.pagos.length) return el('span', { style: 'color:var(--gray-300);' }, '—');
    return el('div', {}, f.pagos.map((p) => el('div', { style: 'font-size:12px; white-space:nowrap;' }, formatDate(p.fechaPago))));
  };
  const celdaRecibo = (f) => {
    if (!f.pagos.length) return el('span', { style: 'color:var(--gray-300);' }, '—');
    return el('div', {}, f.pagos.map((p) => el('div', { style: 'font-size:12px;' },
      `${p.medioPago}${p.nOperacion ? ' · Op: ' + p.nOperacion : ''} — ${formatCurrency(p.monto)}`)));
  };

  // El nombre del inmueble va SOLO arriba como título (sin montos) y el
  // subtotal va al FINAL de sus filas de detalle — mismo lugar que el TOTAL
  // general de abajo, así no hay ambigüedad de a qué filas pertenece. El
  // borde de color a la izquierda (acento configurable) conecta visualmente
  // el título con sus filas y con su subtotal, como un corchete.
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
      el('th', {}, 'Inquilino'), el('th', {}, 'Sección'), el('th', {}, 'Servicio'),
      el('th', { style: 'text-align:right;' }, 'Importe'), el('th', { style: 'text-align:right;' }, 'Saldo'),
      el('th', {}, 'Fch. pago'), el('th', {}, 'Recibo / método'),
    ])]),
    el('tbody', {}, filasNodos),
  ]);

  cont.append(el('div', { class: 'card reporte-imprimible' }, [
    el('div', { style: 'margin-bottom:14px;' }, [
      el('div', { style: 'font-size:20px; font-weight:800;' }, 'CUOTAS POR COBRAR — SERVICIOS'),
      el('div', { style: 'color:var(--gray-500); margin-top:4px;' }, `${servicioNombre} · Periodo ${periodo} · ${soloPendientes ? 'Solo pendientes de cobrar' : 'Todas (incluye pagadas)'}`),
      el('div', { style: 'color:var(--gray-500); font-size:12px;' }, `Impreso: ${formatDate(new Date().toISOString().slice(0, 10))}`),
    ]),
    el('div', { class: 'table-wrap' }, [tabla]),
  ]));
}

main();
