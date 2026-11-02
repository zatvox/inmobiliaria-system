/**
 * cuota-pdf.js — Cuota por cobrar en PDF (media hoja A4) con correlativo único.
 *
 * Flujo (botón "PDF" del menú ⋮ de cada cuota en Cobranzas):
 *   1. Diálogo de confirmación: muestra el número que se asignará (ALQ1-0012),
 *      o avisa que es una REIMPRESIÓN si la cuota ya tiene número.
 *   2. Se asigna el número (RPC atómico, nunca se repite ni se reutiliza).
 *   3. Se arma el HTML de la cuota, se captura con html2canvas y se baja como
 *      PDF A4 con la cuota arriba o abajo (para imprimir 2 cuotas en la misma
 *      hoja, p. ej. agua y luz en el reverso de la cuota de alquiler).
 *   4. Se registra la impresión (fecha de la 1.ª y número de impresiones).
 * Motor tomado de la guía "motor_documento_comercial_pdf_png": HTML+CSS → iframe
 * de 794 px (A4 a 96 dpi) → html2canvas (scale 2) → jsPDF.
 */
import {
  getDatosCuotaDocumento, previsualizarNroCobro, asignarNroCobro, registrarImpresionCuota, listCobroTipos,
} from './supabase-data.js';
import { agruparDetalleParaCuadro } from './cuadro-consumo.js';
import { qs, formatDate, showToast, openModal, closeModal, setLoading } from './utils.js';

/* ------------------------------ utilidades ---------------------------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const U = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const D = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
function menorMil(n) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100), r = n % 100;
  const dec = r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' Y ' + U[r % 10] : '');
  return [C[c], dec].filter(Boolean).join(' ');
}
function numeroALetras(monto, moneda = 'PEN') {
  const redondo = Math.round((Number(monto) || 0) * 100);
  const entero = Math.floor(redondo / 100), cent = redondo % 100;
  const mill = Math.floor(entero / 1e6), miles = Math.floor((entero % 1e6) / 1000), resto = entero % 1000;
  const partes = [];
  if (mill) partes.push(mill === 1 ? 'UN MILLÓN' : `${menorMil(mill).replace(/UNO$/, 'UN')} MILLONES`);
  if (miles) partes.push(miles === 1 ? 'MIL' : `${menorMil(miles).replace(/UNO$/, 'UN')} MIL`);
  if (resto) partes.push(menorMil(resto));
  const nombre = moneda === 'USD' ? 'DÓLARES' : 'SOLES';
  return `${partes.join(' ') || 'CERO'} Y ${String(cent).padStart(2, '0')}/100 ${nombre}`;
}

const COLORES_SERIE = { ALQ: '#1D4ED8', SAGUA: '#0891B2', SLUZ: '#D97706' };
// Misma regla que el SQL: alquiler = 'ALQ'; servicio = 'S' + nombre sin tildes/espacios (máx. 6).
export const claveTipoCuota = (origen, nombreServicio = '') => (origen === 'servicio'
  ? 'S' + nombreServicio.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 6)
  : 'ALQ');
const cargarTipos = async () => {
  try { return Object.fromEntries((await listCobroTipos()).map((t) => [t.tipo_clave, t])); } catch { return {}; }
};
const tinte = (hex, p) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * p + 255 * (1 - p)).toString(16).padStart(2, '0')).join('');
const colorDeSerie = (nro) => COLORES_SERIE[String(nro ?? '').split('-')[0].replace(/\d+$/, '')] ?? '#475569';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
const periodoLargo = (p) => (p && /^\d{4}-\d{2}$/.test(p) ? `${MESES[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}` : p ?? '');
const dmy = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');

/* ------------------------------ plantilla HTML ------------------------------ */
// Estructura tomada del documento comercial de referencia (caja con datos,
// tabla con encabezado de color, importe en letras) pero simplificada: una
// cuota tiene un solo ítem, así que no hay detalle ni subtotales.
//   1) Inquilino (izquierda) + N° de cuota e importe a cobrar (derecha)
//   2) Caja con inmueble, sección, dirección y vencimiento
//   3) Fila destacada: CONCEPTO · PERIODO · IMPORTE
//   4) Recuadro de CANCELACIÓN para llenar a mano
const sumarMes = (iso) => {
  if (!iso) return '';
  const [y, m, dd] = iso.slice(0, 10).split('-').map(Number);
  const ultimo = new Date(y, m + 1, 0).getDate();      // último día del mes siguiente
  const d = new Date(y, m, Math.min(dd, ultimo));
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

function htmlCuotaBloque(d) {
  const { cuota, contrato, detalle, propiedad } = d;
  const nroReal = cuota.nro_cobro;
  const nro = nroReal || d.nroPrevio || '—';
  const clave = claveTipoCuota(cuota.origen, detalle?.calculo_periodo?.tipo_servicio?.nombre ?? '');
  const color = /^#[0-9a-f]{6}$/i.test(d.tipos?.[clave]?.color ?? '') ? d.tipos[clave].color : colorDeSerie(nro);
  const moneda = contrato?.moneda ?? 'PEN';
  const sim = moneda === 'USD' ? '$' : 'S/';
  const esServicio = cuota.origen === 'servicio';
  const tipoServ = detalle?.calculo_periodo?.tipo_servicio?.nombre ?? '';
  const concepto = cuota.concepto || (esServicio ? `Servicio de ${tipoServ}` : 'Renta mensual');
  // Periodo que cubre: alquiler = del día de vencimiento al mismo día del mes siguiente; servicio = mes del consumo.
  const periodo = esServicio
    ? periodoLargo(detalle?.calculo_periodo?.periodo)
    : `${dmy(cuota.fecha_vencimiento)} al ${sumarMes(cuota.fecha_vencimiento)}`;
  const importe = Number(cuota.monto) + Number(cuota.mora_aplicada || 0);
  const pagos = (cuota.pagos ?? []).filter((p) => p.estado !== 'anulado');
  const pagado = pagos.reduce((s, p) => s + Number(p.monto), 0);
  const saldo = importe - pagado;
  const inq = contrato?.inquilino ?? {};
  const vigencia = contrato?.fecha_inicio ? `${dmy(contrato.fecha_inicio)} al ${contrato.fecha_fin ? dmy(contrato.fecha_fin) : 'indefinido'}` : '—';
  const reimp = nroReal && (cuota.n_impresiones ?? 0) >= 1;
  const abonosPrevios = pagos.length
    ? `<div class="prev">Abonos registrados: ${pagos.map((p) => `${dmy(p.fecha_pago)} · ${sim} ${fmt(p.monto)}${p.n_recibo ? ' · Rec. ' + esc(p.n_recibo) : ''}`).join(' &nbsp;|&nbsp; ')} &nbsp;→&nbsp; <b>Saldo ${sim} ${fmt(saldo)}</b></div>`
    : '';
  // Tabla principal: alquiler = una fila (concepto · periodo · importe); servicio = detalle por cuenta/medidor.
  const num3 = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
  const grupo = esServicio && d.detalleRows?.length ? agruparDetalleParaCuadro(d.detalleRows)[0] : null;
  let tablaPrincipal;
  if (grupo) {
    const filasSv = grupo.filas.map((f) => {
      const fija = f.metodo === 'tarifa_fija_por_persona';
      return `<tr>
        <td class="cu">${esc(f.etiqueta)}</td>
        <td class="r2">${fija || !f.fechaLectura ? '—' : `${dmy(f.fechaLecturaAnterior)}<br>– ${dmy(f.fechaLectura)}`}</td>
        <td class="r2">${fija || f.lecturaActual == null ? '—' : `${num3(f.lecturaAnterior)}<br>→ ${num3(f.lecturaActual)}`}</td>
        <td class="r1">${fija ? `${f.nPersonas ?? '—'} pers.` : `${num3(f.consumo)} ${esc(grupo.unidadMedida)}`}</td>
        <td class="r1">${Number((fija ? f.tarifaPorPersona : f.precioUnitario) ?? 0).toFixed(4)}</td>
        <td class="r1 sub">${sim} ${fmt(f.subtotal)}</td></tr>`;
    }).join('');
    tablaPrincipal = `<div class="svc-h">${esc(tipoServ.toUpperCase())} <span>· periodo ${esc(periodo)}</span></div>
    <table class="l sv"><thead><tr><th style="text-align:left;">Cuenta</th><th>Periodo lectura</th><th>Lectura</th><th>Consumo</th><th>Precio</th><th>Subtotal</th></tr></thead>
      <tbody>${filasSv}</tbody>
      <tfoot><tr><td colspan="5" class="tl">TOTAL A PAGAR</td><td class="tv">${sim} ${fmt(importe)}</td></tr></tfoot></table>
    <div class="letras">SON: ${numeroALetras(importe, moneda)}</div>`;
  } else {
    tablaPrincipal = `<table class="l"><thead><tr><th style="text-align:left;">Concepto</th><th>Periodo</th><th>Importe</th></tr></thead>
      <tbody><tr><td class="conc">${esc(concepto)}</td><td class="per">${esc(periodo)}</td><td class="mon">${sim} ${fmt(importe)}</td></tr></tbody></table>
    <div class="letras">SON: ${numeroALetras(importe, moneda)}</div>`;
  }
  const filasCancel = Array.from({ length: 2 }, () => '<tr><td></td><td></td><td></td><td></td></tr>').join('');
  return `
  <div class="cuota" style="--c:${color}; --t1:${tinte(color, 0.08)}; --t2:${tinte(color, 0.28)};">
    <div class="top">
      <div class="inq">
        <div class="k">INQUILINO</div>
        <div class="inq-n">${esc(inq.nombre ?? '—')}</div>
        <div class="inq-d">${esc([inq.tipo_documento, inq.dni_ruc].filter(Boolean).join(' '))}${inq.telefono ? ` &nbsp;·&nbsp; Cel. ${esc(inq.telefono)}` : ''}</div>
      </div>
      <div class="doc">
        <div class="doc-l">
          <div class="k">N° DE CUOTA</div>
          <div class="nro${nroReal ? '' : ' prev-n'}">${esc(nro)}</div>
          ${reimp ? `<div class="reimp">REIMPRESIÓN N° ${cuota.n_impresiones}</div>` : ''}
          ${nroReal ? '' : '<div class="reimp">se asigna al generar</div>'}
        </div>
        <div class="doc-r">
          <div class="k">IMPORTE A COBRAR</div>
          <div class="imp">${sim} ${fmt(importe)}</div>
        </div>
      </div>
    </div>

    <div class="box">
      <div class="bc">
        <div class="bf"><span class="k">INMUEBLE</span><b>${esc(propiedad?.nombre_referencial ?? '—')}</b></div>
        <div class="bf"><span class="k">SECCIÓN</span><b>${esc(d.secciones || '—')}</b></div>
        <div class="bf"><span class="k">DIRECCIÓN</span><span>${esc([propiedad?.direccion, propiedad?.distrito].filter(Boolean).join(', '))}</span></div>
      </div>
      <div class="bc">
        <div class="bf"><span class="k">VENCIMIENTO</span><b>${esc(dmy(cuota.fecha_vencimiento))}</b></div>
        <div class="bf"><span class="k">CONTRATO</span><span>${esc(vigencia)}</span></div>
        <div class="bf"><span class="k">${esServicio ? 'SERVICIO' : 'CUOTA N°'}</span><span>${esc(esServicio ? tipoServ : (cuota.numero_cuota ?? '—'))}</span></div>
      </div>
    </div>

    ${tablaPrincipal}
    ${abonosPrevios}

    <div class="cancel">
      <div class="cancel-t">CANCELACIÓN <small>(llenar a mano · engrapar recibo y voucher en esta hoja)</small></div>
      <div class="cancel-g">
        <table><thead><tr><th>Fecha de pago</th><th>N° recibo</th><th>N° operación</th><th>Monto</th></tr></thead><tbody>${filasCancel}</tbody></table>
        <div class="lado">
          <div class="firma"><i></i><span>Recibido por / sello</span></div>
        </div>
      </div>
    </div>
    <div class="pie"><span>Impreso ${dmy(new Date().toISOString())}${reimp ? ' · REIMPRESIÓN' : ''}</span></div>
  </div>`;
}

const CSS = `
  * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { margin:0; background:#fff; font-family:Arial, Helvetica, sans-serif; color:#111827; }
  .pagina { position:relative; width:794px; height:1123px; }
  .pagina.prev { height:600px; }
  .slot { position:absolute; left:40px; width:714px; height:510px; }
  .slot.arriba { top:30px; } .slot.abajo { top:583px; }
  .cuota { height:100%; display:flex; flex-direction:column; padding:4px 2px 0; }
  .k { font-size:9px; font-weight:700; letter-spacing:.1em; color:#6b7280; }
  .top { display:flex; justify-content:space-between; align-items:stretch; gap:16px; }
  .inq { flex:1; min-width:0; display:flex; flex-direction:column; justify-content:center; }
  .inq-n { font-size:17px; font-weight:800; line-height:1.2; margin-top:3px; word-break:break-word; }
  .inq-d { font-size:11.5px; color:#374151; margin-top:3px; }
  .doc { display:flex; flex:none; border:1.5px solid var(--c); border-radius:10px; overflow:hidden; }
  .doc-l { padding:8px 14px; text-align:center; min-width:150px; display:flex; flex-direction:column; justify-content:center; }
  .nro { font:800 19px/1.2 "Courier New", monospace; color:var(--c); margin-top:3px; white-space:nowrap; }
  .nro.prev-n { color:#9ca3af; }
  .reimp { font-size:8.5px; font-weight:700; color:#b45309; margin-top:3px; }
  .doc-r { background:var(--c); color:#fff; padding:8px 16px; text-align:center; min-width:170px; display:flex; flex-direction:column; justify-content:center; }
  .doc-r .k { color:rgba(255,255,255,.85); }
  .imp { font-size:25px; font-weight:800; line-height:1.15; margin-top:3px; white-space:nowrap; }
  .box { margin-top:12px; border:1px solid var(--t2); background:var(--t1); border-radius:10px; padding:9px 16px; display:flex; gap:28px; font-size:11px; }
  .bc { flex:1; min-width:0; display:flex; flex-direction:column; gap:5px; }
  .bf { display:flex; gap:10px; align-items:baseline; } .bf .k { width:82px; flex:none; } .bf b { font-size:12px; }
  table.l { width:100%; border-collapse:collapse; margin-top:14px; }
  table.l th { background:var(--c); color:#fff; padding:6px 8px; font-size:11px; border:1px solid var(--c); }
  table.l td { border:1px solid #9ca3af; padding:9px 10px; }
  table.l td.conc { font-size:15px; font-weight:800; }
  table.l td.per { text-align:center; font-size:13px; font-weight:700; white-space:nowrap; }
  table.l td.mon { text-align:right; font-size:15px; font-weight:800; white-space:nowrap; width:1%; }
  .svc-h { margin-top:12px; font-size:13px; font-weight:800; color:var(--c); letter-spacing:.04em; } .svc-h span { color:#4b5563; font-weight:600; letter-spacing:0; }
  table.sv { margin-top:5px; } table.sv th { font-size:10px; padding:5px 6px; text-align:right; } table.sv th:first-child { text-align:left; }
  table.sv td { padding:4px 6px; font-size:10.5px; border:0; border-bottom:1px solid #d1d5db; vertical-align:middle; }
  table.sv td.cu { font-weight:700; font-size:11px; } table.sv td.r1, table.sv td.r2 { text-align:right; white-space:nowrap; } table.sv td.r2 { line-height:1.3; } table.sv td.sub { font-weight:800; }
  table.sv tfoot td { border:0; border-top:2px solid var(--c); padding-top:6px; } table.sv td.tl { font-weight:800; font-size:12px; } table.sv td.tv { text-align:right; font-weight:800; font-size:15px; color:var(--c); white-space:nowrap; }
  .letras { font-size:10.5px; font-weight:700; margin-top:8px; }
  .prev { margin-top:6px; font-size:9.5px; color:#374151; background:#f9fafb; border-radius:6px; padding:4px 8px; }
  .cancel { margin-top:auto; border:1.5px dashed var(--c); border-radius:10px; padding:7px 10px 8px; }
  .cancel-t { font-size:11px; font-weight:800; color:var(--c); letter-spacing:.05em; } .cancel-t small { font-weight:400; color:#6b7280; letter-spacing:0; }
  .cancel-g { display:flex; gap:12px; margin-top:5px; }
  .cancel-g table { flex:1; border-collapse:collapse; }
  .cancel-g th { font-size:9px; font-weight:700; color:#374151; background:#f3f4f6; border:1px solid #9ca3af; padding:3px; }
  .cancel-g td { border:1px solid #9ca3af; height:22px; }
  .lado { width:190px; display:flex; flex-direction:column; justify-content:flex-end; }
  .linea { display:flex; align-items:flex-end; gap:6px; font-size:10px; } .linea span { white-space:nowrap; } .linea i { flex:1; border-bottom:1px solid #6b7280; height:12px; }
  .firma { text-align:center; font-size:9px; color:#6b7280; margin-top:8px; } .firma i { display:block; border-bottom:1px solid #6b7280; height:20px; margin-bottom:2px; }
  .pie { display:flex; justify-content:flex-end; margin-top:5px; font-size:8.5px; color:#6b7280; }
`;

/** Hoja A4 con hasta 2 cuotas (slots arriba/abajo). */
function htmlPagina(items, { preview = false } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cuota</title><style>${CSS}</style></head><body>
    <div class="pagina${preview ? ' prev' : ''}">${items.map((it) => `<div class="slot ${it.posicion}">${htmlCuotaBloque(it.datos)}</div>`).join('')}</div>
  </body></html>`;
}

/* ------------------------------ PDF (1 página A4) --------------------------- */
async function descargarPDFDesdeHTML(html, nombreArchivo) {
  const ifr = document.createElement('iframe');
  ifr.style.cssText = 'position:fixed; left:-10000px; top:0; width:794px; height:1123px; border:0; visibility:hidden;';
  document.body.appendChild(ifr);
  try {
    const doc = ifr.contentDocument;
    doc.open(); doc.write(html); doc.close();
    await new Promise((r) => setTimeout(r, 150));
    const [{ jsPDF }, h2c] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm'),
      import('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm'),
    ]);
    const html2canvas = h2c.default || h2c;
    const canvas = await html2canvas(doc.body, { scale: 2, backgroundColor: '#ffffff', useCORS: true, windowWidth: 794, width: 794, height: 1123, windowHeight: 1123 });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, 210, 297);
    pdf.save(nombreArchivo);
  } finally { ifr.remove(); }
}

/** Genera el PDF de una o varias cuotas ya numeradas (máx. 2 por hoja). */
export async function generarPdfCuotas(items, nombreArchivo) {
  await descargarPDFDesdeHTML(htmlPagina(items), nombreArchivo);
}

/**
 * Vista previa (sin asignar correlativo): dibuja la cuota tal como saldrá en el
 * PDF dentro de `contenedor`, escalada al ancho disponible.
 */
export async function renderVistaPreviaCuota(contenedor, cuotaId) {
  contenedor.innerHTML = '<div class="skeleton" style="height:120px;"></div>';
  try {
    const [datos, nroPrevio] = await Promise.all([getDatosCuotaDocumento(cuotaId), previsualizarNroCobro(cuotaId).catch(() => null)]);
    if (datos.cuota.origen === 'venta') { contenedor.innerHTML = '<p style="color:var(--gray-500);">Las cuotas de venta no tienen formato PDF.</p>'; return; }
    datos.nroPrevio = nroPrevio;
    datos.tipos = await cargarTipos();
    const ifr = document.createElement('iframe');
    ifr.style.cssText = 'width:794px; height:600px; border:0; transform-origin:top left; background:#fff;';
    ifr.srcdoc = htmlPagina([{ datos, posicion: 'arriba' }], { preview: true });
    const caja = document.createElement('div');
    caja.style.cssText = 'border:1px solid var(--gray-300); border-radius:8px; overflow:hidden; background:#fff;';
    caja.append(ifr);
    contenedor.innerHTML = '';
    contenedor.append(caja);
    const k = Math.min(1, (contenedor.clientWidth || 794) / 794);
    ifr.style.transform = `scale(${k})`;
    caja.style.height = `${600 * k}px`;
    caja.style.width = `${794 * k}px`;
  } catch (err) {
    console.error(err);
    contenedor.innerHTML = '<p style="color:var(--color-danger);">No se pudo armar la vista previa.</p>';
  }
}

/* ------------------------------ diálogo de confirmación --------------------- */
let contexto = null;

/**
 * Abre el diálogo "¿Confirmas generar la cuota?" para una fila de cobranzas.
 * @param {object} cuota fila de listCuotas (id, origen, estado, nro_cobro, deudor…)
 * @param {Function} alTerminar callback para refrescar la tabla
 */
export async function abrirPdfCuota(cuota, alTerminar) {
  if (cuota.estado === 'anulada') { showToast('Una cuota anulada no se imprime.', 'error'); return; }
  if (Number(cuota.monto) + Number(cuota.mora_aplicada || 0) <= 0.009) { showToast('La cuota tiene importe 0: no hay nada que imprimir.', 'info'); return; }
  contexto = { cuota, alTerminar };
  const nroEl = qs('#cp-numero'), aviso = qs('#cp-aviso'), btn = qs('#btn-cp-generar');
  qs('#cp-resumen').innerHTML = `<b>${esc(cuota.deudor)}</b><br>${esc(cuota.referencia)} · vence ${esc(formatDate(cuota.fecha_vencimiento))}`;
  nroEl.textContent = '…'; aviso.textContent = ''; btn.disabled = true;
  qs('#cp-pos-arriba').checked = true;
  openModal('modal-cuota-pdf');
  try {
    const nro = await previsualizarNroCobro(cuota.id);
    if (!nro) { nroEl.textContent = '—'; aviso.textContent = 'Este tipo de cuota no lleva correlativo.'; return; }
    nroEl.textContent = nro;
    contexto.nro = nro;
    if (cuota.nro_cobro) {
      aviso.innerHTML = `Esta cuota ya tiene número. Se generará una <b>REIMPRESIÓN</b> (impresiones anteriores: ${cuota.n_impresiones ?? 0}). El número no cambia.`;
    } else {
      aviso.innerHTML = `Al confirmar se asigna el número <b>${esc(nro)}</b> a esta cuota. <b>No se puede cambiar ni reutilizar</b>.`;
    }
    btn.disabled = false;
  } catch (err) {
    console.error(err);
    nroEl.textContent = '—';
    aviso.textContent = /function|does not exist|schema cache/i.test(err.message ?? '')
      ? 'Falta ejecutar el SQL 29 (correlativo de cuotas) en Supabase.'
      : (err.message ?? 'No se pudo calcular el número.');
  }
}

export function bindPdfCuota({ verVistaPrevia } = {}) {
  qs('#cp-ver-preview')?.addEventListener('click', () => {
    if (!contexto) return;
    const id = contexto.cuota.id;
    closeModal('modal-cuota-pdf');
    verVistaPrevia?.(id);
  });
  qs('#btn-cp-generar')?.addEventListener('click', async () => {
    if (!contexto) return;
    const btn = qs('#btn-cp-generar');
    setLoading(btn, true, 'Generando…');
    try {
      const { cuota } = contexto;
      const nro = await asignarNroCobro(cuota.id);
      const datos = await getDatosCuotaDocumento(cuota.id);
      datos.tipos = await cargarTipos();
      const posicion = qs('#cp-pos-abajo').checked ? 'abajo' : 'arriba';
      const nombre = `${nro}_${String(datos.contrato?.inquilino?.nombre ?? 'cuota').replace(/[^\w]+/g, '_').slice(0, 40)}.pdf`;
      await generarPdfCuotas([{ datos, posicion }], nombre);
      await registrarImpresionCuota(cuota.id);
      closeModal('modal-cuota-pdf');
      showToast(`Cuota ${nro} generada.`, 'success');
      await contexto.alTerminar?.();
    } catch (err) {
      console.error(err);
      showToast(err.message ?? 'No se pudo generar el PDF.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}
