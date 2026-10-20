/**
 * cobranzas.js — Módulo Cobranzas + Pagos (Fase 3). Vista unificada de
 * `cuotas` (alquiler / venta / servicio), registro de pagos con voucher +
 * foto, verificación, y aplicación manual de mora a cuotas vencidas.
 */
import { initShell } from './main.js';
import { isAdmin } from './auth.js';
import {
  listCuotas, getCuota, aplicarMoraVencidas, registrarPago, verificarPago, anularPago, anularCuota,
  uploadArchivo, getSignedUrl, getCatalogo, listComisionesAgentes, marcarComisionPagada,
  listDetalleCalculoPorCuota, eliminarCuotaServicio, listPropiedades, listTiposServicio, listPagos, actualizarPago,
} from './supabase-data.js';
import { qs, qsa, el, formatCurrency, formatDate, badgeHtml, showToast, openModal, closeModal, validateForm, setLoading, confirmAction, debounce } from './utils.js';
import { abrirCobroMasivo } from './cobro-masivo.js';
import { agruparDetalleParaCuadro, buildCuadroConsumoEl, descargarCuadroComoImagen, getColorLineasTabla, capturarNodoACanvas } from './cuadro-consumo.js';
import { enviarImagenWhatsapp, mensajeServicio, mensajeMensualidad, buildTarjetaMensualidadEl } from './whatsapp.js';

let profile = null;
let activeOrigen = '';
let cuotasCache = [];
let propiedadesCache = [];
let tiposServicioCache = [];

const ORIGEN_LABELS = { alquiler: 'Alquiler', venta: 'Venta', servicio: 'Servicio' };

// Quita el nombre del inmueble del inicio de la referencia (solo visual).
function refSinInmueble(ref) {
  const r = ref ?? '';
  const p = propiedadesCache.find((x) => x.nombre_referencial && r.startsWith(x.nombre_referencial));
  if (!p) return r;
  return r.slice(p.nombre_referencial.length).replace(/^\s*[·\-–]\s*/, '') || r;
}

function periodoActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  profile = await initShell('cobranzas');
  if (!profile) return;

  qs('#filter-periodo').value = periodoActual();

  [propiedadesCache, tiposServicioCache] = await Promise.all([listPropiedades(), listTiposServicio()]);
  fillEdificioYServicioSelects();
  await fillInquilinoSelect();

  bindTabs();
  bindToolbar();
  bindFormPago();
  bindEditarAbono();
  await Promise.all([refresh(), renderComisiones()]);
}

function fillEdificioYServicioSelects() {
  const selEdificio = qs('#filter-edificio');
  if (selEdificio) {
    selEdificio.innerHTML = '<option value="">Todos los edificios</option>';
    propiedadesCache.forEach((p) => selEdificio.append(el('option', { value: p.id }, p.nombre_referencial)));
  }
  const selServicio = qs('#filter-servicio');
  if (selServicio) {
    selServicio.innerHTML = '<option value="">Todos los servicios</option>';
    tiposServicioCache.forEach((t) => selServicio.append(el('option', { value: t.id }, t.nombre)));
  }
}

// Lista de deudores (inquilinos/compradores) con al menos una cuota, para el
// select "Todos los inquilinos". Se calcula una sola vez sobre el universo
// completo de cuotas (sin aplicar los demás filtros) para que la lista no se
// vaya vaciando a medida que el usuario filtra por otro lado.
async function fillInquilinoSelect() {
  const select = qs('#filter-inquilino');
  if (!select) return;
  const currentValue = select.value;
  try {
    const todas = await listCuotas({});
    const nombres = [...new Set(todas.map((c) => c.deudor).filter((d) => d && d !== '—'))].sort((a, b) => a.localeCompare(b));
    select.innerHTML = '<option value="">Todos los inquilinos</option>';
    nombres.forEach((n) => select.append(el('option', { value: n }, n)));
    if (nombres.includes(currentValue)) select.value = currentValue;
  } catch (err) {
    console.error(err);
  }
}

function bindTabs() {
  qsa('.tab-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      qsa('.tab-btn[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      const esAbonos = btn.dataset.tab === 'abonos';
      qs('#vista-cuotas').style.display = esAbonos ? 'none' : '';
      qs('#vista-abonos').style.display = esAbonos ? '' : 'none';
      qs('#card-comisiones').style.display = esAbonos ? 'none' : '';
      if (esAbonos) { cargarAbonos(); return; }
      activeOrigen = btn.dataset.tab === 'todas' ? '' : btn.dataset.tab;
      refresh();
    });
  });
}

function bindToolbar() {
  qs('#search-input')?.addEventListener('input', debounce(refresh, 350));
  qs('#filter-estado')?.addEventListener('change', refresh);
  qs('#filter-inquilino')?.addEventListener('change', refresh);
  qs('#filter-edificio')?.addEventListener('change', refresh);
  qs('#filter-servicio')?.addEventListener('change', refresh);
  qs('#filter-periodo')?.addEventListener('change', refresh);
  qs('#btn-cobro-masivo')?.addEventListener('click', () => abrirCobroMasivo({ alGuardar: refresh }));
  qs('#btn-actualizar-vencidas')?.addEventListener('click', async () => {
    const btn = qs('#btn-actualizar-vencidas');
    setLoading(btn, true, 'Actualizando…');
    try {
      const n = await aplicarMoraVencidas();
      showToast(n > 0 ? `${n} cuota(s) marcadas como vencidas con mora aplicada.` : 'No hay cuotas nuevas por marcar como vencidas.', 'success');
      await refresh();
    } catch (err) {
      console.error(err);
      showToast('No se pudo actualizar las cuotas vencidas.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

async function refresh() {
  const filtros = {
    origen: activeOrigen,
    estado: qs('#filter-estado')?.value ?? '',
    search: qs('#search-input')?.value ?? '',
    propiedadId: qs('#filter-edificio')?.value ?? '',
    tipoServicioId: qs('#filter-servicio')?.value ?? '',
    deudor: qs('#filter-inquilino')?.value ?? '',
    periodo: qs('#filter-periodo')?.value ?? '',
  };
  const tbody = qs('#cuotas-tbody');
  try {
    // Los KPIs se calculan sobre TODO el histórico de la pestaña activa (no
    // solo el mes filtrado en la tabla) — "Vencido (total)" en particular
    // dejaría de ser un total real si se acotara al periodo seleccionado.
    const [paraTabla, paraKpis] = await Promise.all([
      listCuotas(filtros),
      listCuotas({ origen: activeOrigen }),
    ]);
    cuotasCache = paraTabla;
    renderKpis(paraKpis);
    tbody.innerHTML = '';
    if (!cuotasCache.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '8' }, [
        el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '💰'), el('p', {}, 'No hay cuotas para este filtro.')]),
      ])]));
      return;
    }
    cuotasCache.forEach((c) => tbody.append(renderRow(c)));
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar las cuotas.', 'error');
  }
}

function renderKpis(cuotas) {
  const hoy = new Date();
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const pendienteMes = cuotas.filter((c) => c.estado === 'pendiente' && c.fecha_vencimiento?.startsWith(mesActual)).reduce((s, c) => s + c.saldo, 0);
  const vencidoTotal = cuotas.filter((c) => c.estado === 'vencida').reduce((s, c) => s + c.saldo, 0);
  const cobradoMes = cuotas.filter((c) => (c.estado === 'pagada' || c.estado === 'parcial')).reduce((s, c) => {
    const enEsteMes = c.fecha_vencimiento?.startsWith(mesActual);
    return enEsteMes ? s + c.totalPagado : s;
  }, 0);
  qs('#kpi-pendiente').textContent = formatCurrency(pendienteMes);
  qs('#kpi-vencido').textContent = formatCurrency(vencidoTotal);
  qs('#kpi-cobrado').textContent = formatCurrency(cobradoMes);
}

function renderRow(c) {
  const concepto = `${ORIGEN_LABELS[c.origen] ?? c.origen}${c.concepto ? ' · ' + c.concepto : ''}`;
  return el('tr', {}, [
    el('td', {}, c.deudor),
    el('td', {}, refSinInmueble(c.referencia)),
    el('td', {}, concepto),
    el('td', {}, formatCurrency(Number(c.monto) + Number(c.mora_aplicada))),
    el('td', {}, [el('span', { style: c.saldo > 0 ? 'color:var(--color-danger); font-weight:600;' : 'color:var(--color-success); font-weight:600;' }, formatCurrency(c.saldo))]),
    el('td', {}, formatDate(c.fecha_vencimiento)),
    el('td', { html: badgeHtml(c.estado) }),
    el('td', {}, [el('div', { class: 'acciones-fila' }, [
      c.saldo > 0.009 && c.estado !== 'anulada'
        ? el('button', { class: 'btn btn-primary btn-sm', onclick: () => openPagoModal(c) }, 'Registrar pago')
        : null,
      el('button', { class: 'btn-dots', title: 'Más acciones', onclick: (evt) => {
        evt.stopPropagation();
        const items = [{ icon: '👁️', label: 'Ver detalle', fn: () => openDetalleModal(c.id) }];
        if (c.origen === 'servicio') items.push({ icon: '📷', label: 'Descargar cuadro', fn: () => descargarCuadroCuota(c, botonStub()) });
        if (c.origen === 'servicio' || c.origen === 'alquiler') items.push({ icon: '📲', label: 'Enviar por WhatsApp', fn: () => enviarCuotaWhatsapp(c) });
        if (c.origen === 'servicio' && isAdmin(profile)) items.push({ sep: true }, { icon: '🗑️', label: 'Eliminar', peligro: true, fn: () => eliminarCuota(c, botonStub()) });
        abrirMenuFila(evt.currentTarget, items);
      } }, '⋮'),
    ])]),
  ]);
}

// Elimina una cuota de servicio ya generada (ej. para corregir una lectura
// y recalcular) — el servidor la bloquea si ya tiene pagos registrados; en
// ese caso hay que anular esos pagos primero desde "Ver".
async function eliminarCuota(cuota, btn) {
  if (!confirmAction(`¿Eliminar la cuota de ${cuota.deudor} (${cuota.referencia})? El consumo calculado volverá a quedar pendiente de facturar — podrás corregirlo y volver a generar la cobranza.`)) return;
  setLoading(btn, true, 'Eliminando…');
  try {
    await eliminarCuotaServicio(cuota.id);
    showToast('Cuota eliminada. El consumo asociado ya está disponible para recalcular/regenerar.', 'success');
    await refresh();
  } catch (err) {
    console.error(err);
    showToast(err.message ?? 'No se pudo eliminar la cuota.', 'error');
    setLoading(btn, false);
  }
}

/* ================== CUADRO DE CONSUMO (cuotas de servicio) ==================== */
// Reconstruye el mismo "cuadro de consumo" que se ve en el tab Cálculo, a
// partir del calculo_servicios_detalle ya ligado a esta cuota, y lo
// descarga como imagen — para que el cobrador se lo pueda mostrar/enviar al
// inquilino sin tener que volver al módulo de Cálculo de Servicios.
async function descargarCuadroCuota(cuota, btn) {
  setLoading(btn, true, 'Generando…');
  try {
    const [detalleRows, colorLineas] = await Promise.all([
      listDetalleCalculoPorCuota(cuota.id),
      getColorLineasTabla(),
    ]);
    if (!detalleRows.length) {
      showToast('No se encontró el detalle de consumo de esta cuota (puede ser una cuota antigua sin cálculo asociado).', 'error');
      return;
    }
    const [grupo] = agruparDetalleParaCuadro(detalleRows);
    const cuadroEl = buildCuadroConsumoEl(grupo, { colorLineas });
    await descargarCuadroComoImagen(cuadroEl, `cuadro-${grupo.tipoServicioNombre}-${grupo.seccionNombre}-${grupo.periodo}`.replace(/\s+/g, '-').toLowerCase());
  } catch (err) {
    console.error(err);
    showToast(err.message ?? 'No se pudo generar el cuadro de esta cuota.', 'error');
  } finally {
    setLoading(btn, false);
  }
}

/* ============================== REGISTRAR PAGO ================================ */
async function openPagoModal(cuota) {
  const form = qs('#form-pago');
  form.reset();
  qsa('.form-field', form).forEach((f) => f.classList.remove('invalid'));
  form.dataset.cuotaId = cuota.id;
  qs('#pg-contexto').innerHTML = `<strong>${cuota.deudor}</strong> · ${cuota.referencia}<br>${cuota.concepto ?? ''} — saldo pendiente: <strong>${formatCurrency(cuota.saldo)}</strong>`;
  qs('#pg-monto').value = cuota.saldo.toFixed(2);
  qs('#pg-monto').max = cuota.saldo.toFixed(2);
  qs('#pg-fecha').value = new Date().toISOString().slice(0, 10);
  qs('#pg-comprobante-file').value = '';
  qs('#pg-recibo-file').value = '';
  qs('#pg-recibo').value = '';

  const medioSelect = qs('#pg-medio');
  medioSelect.innerHTML = '';
  try {
    const medios = await getCatalogo('medio_pago');
    medios.forEach((m) => medioSelect.append(el('option', { value: m.valor }, m.valor)));
  } catch (err) {
    console.error(err);
  }
  openModal('modal-pago');
}

function bindFormPago() {
  const form = qs('#form-pago');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const cuotaId = form.dataset.cuotaId;
    const btn = qs('#btn-guardar-pago');
    setLoading(btn, true, 'Registrando…');
    try {
      let comprobanteUrl = null, fotoUrl = null;
      const comprobanteFile = qs('#pg-comprobante-file').files[0];
      const fotoFile = qs('#pg-recibo-file').files[0];
      if (comprobanteFile) comprobanteUrl = await uploadArchivo(comprobanteFile, `pagos/${cuotaId}`);
      if (fotoFile) fotoUrl = await uploadArchivo(fotoFile, `pagos/${cuotaId}`);

      await registrarPago({
        cuota_id: cuotaId,
        monto: Number(qs('#pg-monto').value),
        fecha_pago: qs('#pg-fecha').value,
        medio_pago: qs('#pg-medio').value,
        n_recibo: qs('#pg-recibo').value.trim() || null,
        n_operacion: qs('#pg-operacion').value.trim() || null,
        comprobante_url: comprobanteUrl,
        foto_cobranza_url: fotoUrl,
        notas: qs('#pg-notas').value || null,
      });
      showToast('Pago registrado.', 'success');
      closeModal('modal-pago');
      await refresh();
    } catch (err) {
      console.error(err);
      showToast('No se pudo registrar el pago.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}


/* ============================== WHATSAPP ====================================== */
// Servicio: manda el cuadro de consumo. Alquiler: una tarjeta de mensualidad.
function enviarCuotaWhatsapp(c) {
  const obtenerCanvas = async () => {
    if (c.origen === 'servicio') {
      const [detalleRows, colorLineas] = await Promise.all([listDetalleCalculoPorCuota(c.id), getColorLineasTabla()]);
      if (!detalleRows.length) throw new Error('Sin detalle de consumo para esta cuota.');
      const [grupo] = agruparDetalleParaCuadro(detalleRows);
      return capturarNodoACanvas(buildCuadroConsumoEl(grupo, { colorLineas }));
    }
    return capturarNodoACanvas(buildTarjetaMensualidadEl(c));
  };
  return enviarImagenWhatsapp({
    telefono: c.telefono,
    mensaje: c.origen === 'servicio' ? mensajeServicio(c) : mensajeMensualidad(c),
    obtenerCanvas,
    nombreArchivo: `${c.origen}-${(c.deudor ?? '').split(' ')[0].toLowerCase()}`,
  });
}

/* ============================== MENÚ ⋮ FLOTANTE ================================ */
const botonStub = () => ({ dataset: {}, innerHTML: '', disabled: false });
let menuAbierto = null;
function cerrarMenuFila() { menuAbierto?.remove(); menuAbierto = null; }
function abrirMenuFila(anchor, items) {
  cerrarMenuFila();
  const menu = el('div', { class: 'menu-flotante' }, items.map((it) => (it.sep
    ? el('hr')
    : el('button', { class: it.peligro ? 'peligro' : '', onclick: () => { cerrarMenuFila(); it.fn(); } }, [el('span', {}, it.icon), it.label]))));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const h = menu.offsetHeight, w = menu.offsetWidth;
  menu.style.top = `${r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  menuAbierto = menu;
}
document.addEventListener('click', cerrarMenuFila);
window.addEventListener('scroll', cerrarMenuFila, true);
window.addEventListener('resize', cerrarMenuFila);

/* ================================== ABONOS ===================================== */
let abonosCache = [];
let abonosListos = false;

async function cargarAbonos() {
  const tbody = qs('#ab-tbody');
  if (!abonosListos) {
    abonosListos = true;
    try {
      const medios = await getCatalogo('medio_pago');
      medios.forEach((m) => qs('#ab-medio').append(el('option', { value: m.valor }, m.valor)));
    } catch (e) { console.error(e); }
    qs('#ab-search').addEventListener('input', debounce(renderAbonos, 250));
    ['#ab-origen', '#ab-medio', '#ab-estado', '#ab-periodo'].forEach((x) => qs(x).addEventListener('change', renderAbonos));
    qs('#ab-limpiar').addEventListener('click', () => {
      qs('#ab-search').value = '';
      ['#ab-origen', '#ab-medio', '#ab-estado', '#ab-periodo'].forEach((x) => { qs(x).value = ''; });
      renderAbonos();
    });
  }
  tbody.innerHTML = '<tr><td colspan="12"><div class="skeleton" style="height:20px;"></div></td></tr>';
  try {
    abonosCache = await listPagos();
    renderAbonos();
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar los abonos.', 'error');
  }
}

function renderAbonos() {
  const q = qs('#ab-search').value.trim().toLowerCase();
  const origen = qs('#ab-origen').value, medio = qs('#ab-medio').value, estado = qs('#ab-estado').value, periodo = qs('#ab-periodo').value;
  const rows = abonosCache.filter((p) => (!origen || p.origen === origen)
    && (!medio || p.medio_pago === medio)
    && (!estado || p.estado === estado)
    && (!periodo || (p.fecha_pago ?? '').startsWith(periodo))
    && (!q || [p.deudor, p.referencia, p.concepto, p.n_recibo, p.n_operacion, p.notas].some((v) => (v ?? '').toLowerCase().includes(q))));
  const validos = rows.filter((p) => p.estado !== 'anulado');
  qs('#ab-count').textContent = rows.length;
  qs('#ab-total').textContent = formatCurrency(validos.reduce((s, p) => s + Number(p.monto), 0));
  qs('#ab-pend').textContent = rows.filter((p) => p.estado === 'registrado').length;
  const tbody = qs('#ab-tbody');
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.append(el('tr', {}, [el('td', { colspan: '13' }, [el('div', { class: 'vacio-pro' }, [el('div', { style: 'font-size:32px;' }, '🧾'), el('p', {}, 'No hay abonos para este filtro.')])])]));
    return;
  }
  rows.forEach((p) => tbody.append(filaAbono(p)));
}

function filaAbono(p) {
  const docs = [];
  const link = (path, label) => el('a', { href: '#', class: 'doc-link', onclick: async (evt) => {
    evt.preventDefault();
    try { window.open(await getSignedUrl(path), '_blank'); } catch (e) { console.error(e); showToast('No se pudo abrir el documento.', 'error'); }
  } }, label);
  if (p.comprobante_url) docs.push(link(p.comprobante_url, '📎 Voucher'));
  if (p.foto_cobranza_url) docs.push(link(p.foto_cobranza_url, '📷 Recibo'));
  return el('tr', { style: p.estado === 'anulado' ? 'opacity:.55;' : '' }, [
    el('td', { style: 'white-space:nowrap;' }, formatDate(p.fecha_pago, { day: '2-digit', month: '2-digit', year: 'numeric' })),
    el('td', {}, p.deudor),
    el('td', {}, refSinInmueble(p.referencia)),
    el('td', {}, `${ORIGEN_LABELS[p.origen] ?? p.origen}${p.concepto ? ' · ' + p.concepto : ''}`),
    el('td', { style: 'font-weight:600; white-space:nowrap;' }, formatCurrency(p.monto)),
    el('td', {}, p.medio_pago),
    el('td', {}, p.n_recibo ?? '—'),
    el('td', {}, p.n_operacion ?? '—'),
    el('td', { html: badgeHtml(p.estado) }),
    el('td', { style: 'white-space:nowrap;' }, docs.length ? docs : '—'),
    el('td', { style: 'max-width:200px; color:var(--gray-500);' }, p.notas ?? '—'),
    el('td', { style: 'white-space:nowrap; color:var(--gray-500);' }, p.created_at ? formatDate(p.created_at.slice(0, 10), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'),
    el('td', {}, [el('button', { class: 'btn-dots', title: 'Más acciones', onclick: (evt) => {
      evt.stopPropagation();
      const items = [{ icon: '👁️', label: 'Ver cuota', fn: () => openDetalleModal(p.cuota_id) }];
      if (p.estado !== 'anulado') items.push({ icon: '✏️', label: 'Editar abono', fn: () => openEditarAbono(p) });
      if (isAdmin(profile) && p.estado === 'registrado') items.push({ icon: '✅', label: 'Verificar pago', fn: async () => {
        try { await verificarPago(p.id); showToast('Pago verificado.', 'success'); await cargarAbonos(); } catch (e) { console.error(e); showToast('No se pudo verificar.', 'error'); }
      } });
      if (isAdmin(profile) && p.estado !== 'anulado') items.push({ sep: true }, { icon: '🚫', label: 'Anular pago', peligro: true, fn: async () => {
        if (!confirmAction('¿Anular este pago? El saldo de la cuota se recalculará.')) return;
        try { await anularPago(p.id); showToast('Pago anulado.', 'success'); await cargarAbonos(); await refresh(); } catch (e) { console.error(e); showToast('No se pudo anular.', 'error'); }
      } });
      abrirMenuFila(evt.currentTarget, items);
    } }, '⋮')]),
  ]);
}

/* ============================== EDITAR ABONO ================================== */
async function openEditarAbono(p) {
  const form = qs('#form-editar-abono');
  form.reset();
  form.dataset.pagoId = p.id;
  // Máximo permitido = saldo actual de la cuota + lo que este abono ya cubre.
  const maximo = Number(p.saldoCuota) + Number(p.monto);
  form.dataset.maximo = maximo.toFixed(2);
  qs('#ea-contexto').innerHTML = `<strong>${p.deudor}</strong> · ${p.referencia}<br>${p.concepto ?? ''}`;
  qs('#ea-monto').value = Number(p.monto).toFixed(2);
  qs('#ea-monto').max = maximo.toFixed(2);
  qs('#ea-hint').textContent = `Máximo: ${formatCurrency(maximo)}`;
  qs('#ea-fecha').value = p.fecha_pago ?? '';
  qs('#ea-operacion').value = p.n_operacion ?? '';
  qs('#ea-recibo').value = p.n_recibo ?? '';
  qs('#ea-notas').value = p.notas ?? '';
  qs('#ea-voucher-actual').textContent = p.comprobante_url ? 'Ya tiene voucher; sube uno nuevo para reemplazarlo.' : 'Sin voucher.';
  qs('#ea-foto-actual').textContent = p.foto_cobranza_url ? 'Ya tiene archivo de recibo; sube uno nuevo para reemplazarlo.' : 'Sin archivo de recibo.';
  const sel = qs('#ea-medio');
  sel.innerHTML = '';
  try {
    const medios = await getCatalogo('medio_pago');
    medios.forEach((m) => sel.append(el('option', { value: m.valor }, m.valor)));
  } catch (e) { console.error(e); }
  if (p.medio_pago && ![...sel.options].some((o) => o.value === p.medio_pago)) sel.append(el('option', { value: p.medio_pago }, p.medio_pago));
  sel.value = p.medio_pago;
  openModal('modal-editar-abono');
}

function bindEditarAbono() {
  const form = qs('#form-editar-abono');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const monto = Number(qs('#ea-monto').value);
    if (monto > Number(form.dataset.maximo) + 0.009) { showToast(`El monto excede el máximo permitido (${formatCurrency(form.dataset.maximo)}).`, 'error'); return; }
    const btn = qs('#ea-guardar');
    setLoading(btn, true, 'Guardando…');
    try {
      const id = form.dataset.pagoId;
      const patch = {
        monto,
        fecha_pago: qs('#ea-fecha').value,
        medio_pago: qs('#ea-medio').value,
        n_recibo: qs('#ea-recibo').value.trim() || null,
        n_operacion: qs('#ea-operacion').value.trim() || null,
        notas: qs('#ea-notas').value.trim() || null,
      };
      const v = qs('#ea-voucher').files[0];
      const f = qs('#ea-foto').files[0];
      if (v) patch.comprobante_url = await uploadArchivo(v, `pagos/${id}`);
      if (f) patch.foto_cobranza_url = await uploadArchivo(f, `pagos/${id}`);
      await actualizarPago(id, patch);
      showToast('Abono actualizado.', 'success');
      closeModal('modal-editar-abono');
      await cargarAbonos();
      await refresh();
    } catch (err) {
      console.error(err);
      showToast('No se pudo actualizar el abono.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

/* ============================== DETALLE / HISTORIAL ============================ */
async function openDetalleModal(cuotaId) {
  try {
    const cuota = await getCuota(cuotaId);
    qs('#detalle-title').textContent = cuota.concepto ?? 'Detalle de cuota';
    qs('#detalle-resumen').innerHTML = `
      Monto: <strong>${formatCurrency(cuota.monto)}</strong> · Mora: <strong>${formatCurrency(cuota.mora_aplicada)}</strong>
      · Vence: <strong>${formatDate(cuota.fecha_vencimiento)}</strong> · Estado: ${badgeHtml(cuota.estado)}
    `;
    const list = qs('#detalle-pagos');
    list.innerHTML = '';
    if (!cuota.pagos?.length) {
      list.append(el('p', { style: 'color:var(--gray-500);' }, 'Todavía no hay pagos registrados.'));
    } else {
      cuota.pagos.forEach((p) => list.append(renderPagoItem(p, cuotaId)));
    }
    if (isAdmin(profile) && cuota.estado !== 'anulada' && cuota.estado !== 'pagada') {
      qs('#btn-anular-cuota').style.display = 'inline-flex';
      qs('#btn-anular-cuota').onclick = async () => {
        if (!confirmAction('¿Anular esta cuota? No se podrá registrar más pagos sobre ella.')) return;
        try {
          await anularCuota(cuotaId);
          showToast('Cuota anulada.', 'success');
          closeModal('modal-detalle');
          await refresh();
        } catch (err) {
          console.error(err);
          showToast('No se pudo anular la cuota.', 'error');
        }
      };
    } else {
      qs('#btn-anular-cuota').style.display = 'none';
    }
    openModal('modal-detalle');
  } catch (err) {
    console.error(err);
    showToast('No se pudo cargar el detalle.', 'error');
  }
}

function renderPagoItem(p, cuotaId) {
  const acciones = [];
  if (isAdmin(profile) && p.estado === 'registrado') {
    acciones.push(el('button', { class: 'btn btn-tertiary btn-sm', onclick: async (evt) => {
      evt.target.disabled = true;
      try { await verificarPago(p.id); showToast('Pago verificado.', 'success'); await refresh(); await openDetalleModal(cuotaId); }
      catch (err) { console.error(err); showToast('No se pudo verificar.', 'error'); evt.target.disabled = false; }
    } }, 'Verificar'));
  }
  if (isAdmin(profile) && p.estado !== 'anulado') {
    acciones.push(el('button', { class: 'btn btn-tertiary btn-sm', onclick: async (evt) => {
      if (!confirmAction('¿Anular este pago? El saldo de la cuota se recalculará.')) return;
      try { await anularPago(p.id); showToast('Pago anulado.', 'success'); await refresh(); closeModal('modal-detalle'); }
      catch (err) { console.error(err); showToast('No se pudo anular.', 'error'); }
    } }, 'Anular'));
  }
  return el('div', { style: 'border:1px solid var(--gray-300); border-radius:8px; padding:10px; margin-bottom:8px;' }, [
    el('div', { style: 'display:flex; justify-content:space-between; align-items:center;' }, [
      el('strong', {}, formatCurrency(p.monto)),
      el('span', { html: badgeHtml(p.estado) }),
    ]),
    el('div', { style: 'font-size:12px; color:var(--gray-500); margin:4px 0;' }, `${formatDate(p.fecha_pago)} · ${p.medio_pago}${p.n_recibo ? ' · Rec: ' + p.n_recibo : ''}${p.n_operacion ? ' · Op: ' + p.n_operacion : ''}`),
    p.comprobante_url ? el('a', { href: '#', style: 'font-size:12px;', onclick: async (evt) => { evt.preventDefault(); window.open(await getSignedUrl(p.comprobante_url), '_blank'); } }, '📎 Ver comprobante') : null,
    ' ',
    p.foto_cobranza_url ? el('a', { href: '#', style: 'font-size:12px;', onclick: async (evt) => { evt.preventDefault(); window.open(await getSignedUrl(p.foto_cobranza_url), '_blank'); } }, '📷 Ver foto de cobranza') : null,
    el('div', { style: 'margin-top:6px; display:flex; gap:6px;' }, acciones),
  ]);
}

/* ============================== COMISIONES AGENTES ============================= */
async function renderComisiones() {
  const wrap = qs('#comisiones-wrap');
  if (!wrap) return;
  try {
    const comisiones = await listComisionesAgentes();
    wrap.innerHTML = '';
    if (!comisiones.length) {
      wrap.append(el('p', { style: 'color:var(--gray-500);' }, 'Sin comisiones registradas todavía.'));
      return;
    }
    const table = el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', {}, 'Agente'), el('th', {}, 'Tipo'), el('th', {}, 'Inquilino/Comprador'), el('th', {}, 'Fecha inicio contrato'), el('th', {}, 'Monto/%'), el('th', {}, 'Estado'), el('th', {}, '')])]),
    ]);
    const tbody = el('tbody');
    comisiones.forEach((c) => {
      tbody.append(el('tr', {}, [
        el('td', {}, c.agente?.nombre ?? '—'),
        el('td', {}, ORIGEN_LABELS[c.contrato_tipo] ?? c.contrato_tipo),
        el('td', {}, c.clienteNombre ?? '—'),
        el('td', {}, c.fechaInicioContrato ? formatDate(c.fechaInicioContrato) : '—'),
        el('td', {}, c.monto ? formatCurrency(c.monto) : `${c.porcentaje}%`),
        el('td', { html: badgeHtml(c.estado) }),
        el('td', {}, [
          c.estado === 'pendiente' && isAdmin(profile)
            ? el('button', { class: 'btn btn-tertiary btn-sm', onclick: async (evt) => {
                setLoading(evt.target, true);
                try { await marcarComisionPagada(c.id); showToast('Comisión marcada como pagada.', 'success'); await renderComisiones(); }
                catch (err) { console.error(err); showToast('No se pudo actualizar.', 'error'); }
                finally { setLoading(evt.target, false); }
              } }, 'Marcar pagada')
            : null,
        ]),
      ]));
    });
    table.append(tbody);
    wrap.append(table);
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p style="color:var(--color-danger);">No se pudieron cargar las comisiones.</p>';
  }
}

main();
