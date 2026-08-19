/**
 * servicios.js — Módulo Cálculo de Servicios (Fase 3): medidores, lecturas
 * mensuales, recibos generales y el "runner" de cálculo que genera las
 * cuotas de cobranza por servicio (RPC calcular_periodo_servicio en el
 * servidor — toda la lógica de dinero vive ahí, no en el navegador).
 */
import { initShell } from './main.js';
import {
  listPropiedades, listSeccionesPorPropiedad, listTiposServicio,
  listMedidores, createMedidor, updateMedidor, deleteMedidor,
  listLecturas, getUltimaLectura, createLectura, updateLectura,
  listRecibosGenerales, createReciboGeneral, updateReciboGeneral,
  listCuentasServicio, createCuentaServicio, updateCuentaServicio,
  listCalculosPeriodo, calcularPeriodoServicio, uploadArchivo, getSignedUrl,
} from './supabase-data.js';
import { qs, qsa, el, formatCurrency, formatDate, formatNumber, badgeHtml, showToast, openModal, closeModal, validateForm, setLoading, confirmAction } from './utils.js';

let activeTab = 'medidores';
let propiedadesCache = [];
let tiposServicioCache = [];
let cuentasCache = [];

function periodoActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  const profile = await initShell('servicios');
  if (!profile) return;

  [propiedadesCache, tiposServicioCache] = await Promise.all([listPropiedades(), listTiposServicio()]);
  fillPropiedadSelects();
  fillTipoServicioSelects();

  bindTabs();
  bindMedidores();
  bindLecturas();
  bindRecibos();
  bindCuentas();
  bindCalculo();

  await renderMedidores();
}

const SELECTS_OBLIGATORIOS = new Set(['me-propiedad', 're-propiedad', 'ca-propiedad', 'cu-propiedad']);
function fillPropiedadSelects() {
  qsa('.select-propiedad').forEach((sel) => {
    sel.innerHTML = `<option value="">${SELECTS_OBLIGATORIOS.has(sel.id) ? 'Selecciona…' : 'Todas las propiedades'}</option>`;
    propiedadesCache.forEach((p) => sel.append(el('option', { value: p.id }, p.nombre_referencial)));
  });
}
function fillTipoServicioSelects() {
  qsa('.select-tipo-servicio').forEach((sel) => {
    sel.innerHTML = '<option value="">Selecciona…</option>';
    tiposServicioCache.forEach((t) => sel.append(el('option', { value: t.id }, t.nombre)));
  });
}

function bindTabs() {
  qsa('.tab-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      activeTab = btn.dataset.tab;
      qsa('.tab-btn[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      qsa('.tab-panel').forEach((p) => { p.style.display = p.id === `panel-${activeTab}` ? 'block' : 'none'; });
      if (activeTab === 'medidores') await renderMedidores();
      if (activeTab === 'lecturas') { await fillMedidorSelect(); await renderLecturas(); }
      if (activeTab === 'recibos') await renderRecibos();
      if (activeTab === 'cuentas') await renderCuentas();
    });
  });
}

/* ================================ MEDIDORES ================================== */
async function renderMedidores() {
  const tbody = qs('#medidores-tbody');
  try {
    const medidores = await listMedidores({ propiedadId: qs('#filtro-medidor-propiedad').value });
    tbody.innerHTML = '';
    if (!medidores.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '6' }, [el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '📟'), el('p', {}, 'Sin medidores registrados.')])])]));
      return;
    }
    medidores.forEach((m) => tbody.append(el('tr', {}, [
      el('td', {}, m.propiedad?.nombre_referencial ?? '—'),
      el('td', {}, m.es_general ? el('span', { class: 'badge badge-neutral' }, 'General') : (m.seccion?.nombre ?? '—')),
      el('td', {}, m.tipo_servicio?.nombre ?? '—'),
      el('td', {}, m.codigo_medidor || '—'),
      el('td', {}, m.activo ? el('span', { class: 'badge badge-disponible' }, 'Activo') : el('span', { class: 'badge badge-inactivo' }, 'Inactivo')),
      el('td', { class: 'actions' }, [
        el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => openMedidorModal(m) }, 'Editar'),
      ]),
    ])));
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar los medidores.', 'error');
  }
}

function bindMedidores() {
  qs('#filtro-medidor-propiedad')?.addEventListener('change', renderMedidores);
  qs('#btn-nuevo-medidor')?.addEventListener('click', () => openMedidorModal());
  qs('#me-es-general')?.addEventListener('change', toggleMedidorDueno);
  qs('#me-propiedad')?.addEventListener('change', refreshCuentasMedidor);
  qs('#me-tipo-servicio')?.addEventListener('change', refreshCuentasMedidor);

  const form = qs('#form-medidor');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const esGeneral = qs('#me-es-general').checked;
    const payload = {
      propiedad_id: qs('#me-propiedad').value || null,
      seccion_id: esGeneral ? null : (qs('#me-seccion').value || null),
      tipo_servicio_id: qs('#me-tipo-servicio').value,
      es_general: esGeneral,
      codigo_medidor: qs('#me-codigo').value || null,
      cuenta_servicio_id: qs('#me-cuenta').value || null,
      fecha_instalacion: qs('#me-fecha-instalacion').value || null,
      notas: qs('#me-notas').value || null,
    };
    if (!esGeneral && !payload.seccion_id) { showToast('Selecciona una sección o marca "medidor general".', 'error'); return; }
    if (esGeneral && !payload.propiedad_id) { showToast('Un medidor general necesita una propiedad.', 'error'); return; }

    const btn = qs('#btn-guardar-medidor');
    setLoading(btn, true);
    try {
      const editingId = form.dataset.editingId;
      if (editingId) await updateMedidor(editingId, payload); else await createMedidor(payload);
      showToast('Medidor guardado.', 'success');
      closeModal('modal-medidor');
      await renderMedidores();
    } catch (err) {
      console.error(err);
      showToast('No se pudo guardar el medidor.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

function toggleMedidorDueno() {
  const esGeneral = qs('#me-es-general').checked;
  qs('#me-propiedad-field').style.display = 'block';
  qs('#me-seccion-field').style.display = esGeneral ? 'none' : 'block';
}

async function openMedidorModal(medidor = null) {
  const form = qs('#form-medidor');
  form.reset();
  form.dataset.editingId = medidor?.id ?? '';
  qs('#modal-medidor-title').textContent = medidor ? 'Editar medidor' : 'Nuevo medidor';
  qs('#me-propiedad').value = medidor?.propiedad_id ?? '';
  qs('#me-es-general').checked = medidor?.es_general ?? false;
  qs('#me-tipo-servicio').value = medidor?.tipo_servicio_id ?? '';
  toggleMedidorDueno();
  await Promise.all([refreshSeccionesMedidor(), refreshCuentasMedidor()]);
  if (medidor) {
    qs('#me-seccion').value = medidor.seccion_id ?? '';
    qs('#me-codigo').value = medidor.codigo_medidor ?? '';
    qs('#me-cuenta').value = medidor.cuenta_servicio_id ?? '';
    qs('#me-fecha-instalacion').value = medidor.fecha_instalacion ?? '';
    qs('#me-notas').value = medidor.notas ?? '';
  }
  openModal('modal-medidor');
}

async function refreshSeccionesMedidor() {
  const propiedadId = qs('#me-propiedad').value;
  const seccionSelect = qs('#me-seccion');
  seccionSelect.innerHTML = '<option value="">Selecciona…</option>';
  if (!propiedadId) return;
  const secciones = await listSeccionesPorPropiedad(propiedadId);
  secciones.forEach((s) => seccionSelect.append(el('option', { value: s.id }, s.nombre)));
}

async function refreshCuentasMedidor() {
  const propiedadId = qs('#me-propiedad')?.value;
  const tipoServicioId = qs('#me-tipo-servicio')?.value;
  const sel = qs('#me-cuenta');
  if (!sel) return;
  const currentValue = sel.value;
  sel.innerHTML = '<option value="">Sin cuenta específica</option>';
  if (!propiedadId || !tipoServicioId) return;
  const cuentas = await listCuentasServicio({ propiedadId, tipoServicioId });
  cuentas.forEach((c) => sel.append(el('option', { value: c.id }, `${c.codigo}${c.nombre ? ' · ' + c.nombre : ''}`)));
  if (cuentas.some((c) => c.id === currentValue)) sel.value = currentValue;
}

document.addEventListener('DOMContentLoaded', () => {
  qs('#me-propiedad')?.addEventListener('change', refreshSeccionesMedidor);
});

/* ================================= LECTURAS =================================== */
async function renderLecturas() {
  const tbody = qs('#lecturas-tbody');
  try {
    const lecturas = await listLecturas({
      propiedadId: qs('#filtro-lectura-propiedad').value,
      medidorId: qs('#filtro-lectura-medidor').value,
      periodo: qs('#filtro-lectura-periodo').value,
    });
    tbody.innerHTML = '';
    if (!lecturas.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '8' }, [el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '📊'), el('p', {}, 'Sin lecturas registradas.')])])]));
      return;
    }
    lecturas.forEach((l) => tbody.append(el('tr', {}, [
      el('td', {}, `${l.medidor?.propiedad?.nombre_referencial ?? ''} ${l.medidor?.seccion?.nombre ? '· ' + l.medidor.seccion.nombre : '(general)'}`),
      el('td', {}, l.medidor?.codigo_medidor || '—'),
      el('td', {}, l.medidor?.tipo_servicio?.nombre ?? '—'),
      el('td', {}, l.periodo),
      el('td', {}, formatNumber(l.lectura_anterior ?? 0, 3)),
      el('td', {}, formatNumber(l.lectura_actual, 3)),
      el('td', {}, Number(l.consumo_calculado) < 0
        ? el('span', { class: 'badge badge-vencida', title: 'Consumo negativo: revisa la "lectura anterior" de este registro.' }, `⚠ ${formatNumber(l.consumo_calculado, 3)} ${l.medidor?.tipo_servicio?.unidad_medida ?? ''}`)
        : `${formatNumber(l.consumo_calculado, 3)} ${l.medidor?.tipo_servicio?.unidad_medida ?? ''}`),
      el('td', { class: 'actions' }, [
        l.foto_url ? el('a', { class: 'btn btn-tertiary btn-sm', href: '#', onclick: async (evt) => { evt.preventDefault(); window.open(await getSignedUrl(l.foto_url), '_blank'); } }, '📷') : null,
        el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => openLecturaModal(l) }, 'Editar'),
      ]),
    ])));
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar las lecturas.', 'error');
  }
}

function medidorLabel(m, { conPropiedad = false } = {}) {
  const parts = [];
  if (conPropiedad) parts.push(m.propiedad?.nombre_referencial ?? '');
  parts.push(m.seccion?.nombre ? m.seccion.nombre : '(general)');
  parts.push(m.tipo_servicio?.nombre ?? '');
  let label = parts.filter(Boolean).join(' · ');
  if (m.codigo_medidor) label += ` · Cód. ${m.codigo_medidor}`;
  return label;
}

async function fillMedidorSelect() {
  const propiedadId = qs('#filtro-lectura-propiedad')?.value ?? '';
  const medidores = await listMedidores({ propiedadId });
  const select = qs('#filtro-lectura-medidor');
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = '<option value="">Todos los medidores</option>';
  medidores.forEach((m) => select.append(el('option', { value: m.id }, medidorLabel(m, { conPropiedad: !propiedadId }))));
  if (medidores.some((m) => m.id === currentValue)) select.value = currentValue;
}

async function fillLecturaMedidorSelect() {
  const propiedadId = qs('#le-propiedad')?.value ?? '';
  const medidores = await listMedidores({ propiedadId });
  const sel = qs('#le-medidor');
  if (!sel) return;
  const currentValue = sel.value;
  sel.innerHTML = '<option value="">Selecciona…</option>';
  medidores.forEach((m) => sel.append(el('option', { value: m.id }, medidorLabel(m, { conPropiedad: !propiedadId }))));
  if (medidores.some((m) => m.id === currentValue)) sel.value = currentValue;
}

function bindLecturas() {
  qs('#filtro-lectura-propiedad')?.addEventListener('change', async () => { await fillMedidorSelect(); await renderLecturas(); });
  qs('#filtro-lectura-medidor')?.addEventListener('change', renderLecturas);
  qs('#filtro-lectura-periodo')?.addEventListener('change', renderLecturas);
  qs('#btn-nueva-lectura')?.addEventListener('click', () => openLecturaModal());
  qs('#le-propiedad')?.addEventListener('change', fillLecturaMedidorSelect);
  qs('#le-medidor')?.addEventListener('change', actualizarLecturaAnterior);
  qs('#le-periodo')?.addEventListener('change', actualizarLecturaAnterior);

  const form = qs('#form-lectura');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const btn = qs('#btn-guardar-lectura');
    setLoading(btn, true);
    try {
      const editingId = form.dataset.editingId;
      let fotoUrl = form.dataset.fotoUrlActual || null;
      const file = qs('#le-foto-file').files[0];
      const medidorId = qs('#le-medidor').value;
      if (file) fotoUrl = await uploadArchivo(file, `medidores/${medidorId}`);
      const payload = {
        medidor_id: medidorId,
        periodo: qs('#le-periodo').value,
        fecha_lectura: qs('#le-fecha').value,
        lectura_anterior: qs('#le-lectura-anterior').value ? Number(qs('#le-lectura-anterior').value) : null,
        lectura_actual: Number(qs('#le-lectura-actual').value),
        foto_url: fotoUrl,
        notas: qs('#le-notas').value || null,
      };
      if (editingId) await updateLectura(editingId, payload); else await createLectura(payload);
      showToast('Lectura guardada.', 'success');
      closeModal('modal-lectura');
      await renderLecturas();
    } catch (err) {
      console.error(err);
      showToast('No se pudo guardar la lectura. ¿Ya existe una lectura para ese medidor y periodo?', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

async function actualizarLecturaAnterior() {
  const medidorId = qs('#le-medidor').value;
  const periodo = qs('#le-periodo').value;
  if (!medidorId || !periodo) return;
  try {
    const ultima = await getUltimaLectura(medidorId, periodo);
    qs('#le-lectura-anterior').value = ultima?.lectura_actual ?? '';
  } catch (err) {
    console.error(err);
  }
}

async function openLecturaModal(lectura = null) {
  const form = qs('#form-lectura');
  form.reset();
  form.dataset.editingId = lectura?.id ?? '';
  form.dataset.fotoUrlActual = lectura?.foto_url ?? '';
  qs('#modal-lectura-title').textContent = lectura ? 'Editar lectura' : 'Registrar lectura';
  qs('#le-propiedad').value = lectura?.medidor?.propiedad_id ?? qs('#filtro-lectura-propiedad')?.value ?? '';
  await fillLecturaMedidorSelect();
  if (lectura) {
    qs('#le-medidor').value = lectura.medidor_id;
    qs('#le-periodo').value = lectura.periodo;
    qs('#le-fecha').value = lectura.fecha_lectura;
    qs('#le-lectura-anterior').value = lectura.lectura_anterior ?? '';
    qs('#le-lectura-actual').value = lectura.lectura_actual;
    qs('#le-notas').value = lectura.notas ?? '';
  } else {
    qs('#le-periodo').value = periodoActual();
    qs('#le-fecha').value = new Date().toISOString().slice(0, 10);
  }
  qs('#le-foto-file').value = '';
  openModal('modal-lectura');
}

/* ============================== RECIBOS GENERALES =============================== */
async function renderRecibos() {
  const tbody = qs('#recibos-tbody');
  try {
    const recibos = await listRecibosGenerales({ propiedadId: qs('#filtro-recibo-propiedad').value });
    tbody.innerHTML = '';
    if (!recibos.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '6' }, [el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '🧾'), el('p', {}, 'Sin recibos generales registrados.')])])]));
      return;
    }
    recibos.forEach((r) => tbody.append(el('tr', {}, [
      el('td', {}, r.propiedad?.nombre_referencial ?? '—'),
      el('td', {}, `${r.tipo_servicio?.nombre ?? '—'}${r.cuenta_servicio ? ' · ' + r.cuenta_servicio.codigo : ''}`),
      el('td', {}, r.periodo),
      el('td', {}, formatCurrency(r.monto_total_recibo)),
      el('td', { html: badgeHtml(r.estado_pago === 'pagado' ? 'pagada' : 'pendiente') }),
      el('td', { class: 'actions' }, [
        r.estado_pago === 'pendiente' ? el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => marcarReciboPagado(r) }, 'Marcar pagado') : null,
        r.foto_recibo_url ? el('a', { class: 'btn btn-tertiary btn-sm', href: '#', onclick: async (evt) => { evt.preventDefault(); window.open(await getSignedUrl(r.foto_recibo_url), '_blank'); } }, '📷') : null,
      ]),
    ])));
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar los recibos.', 'error');
  }
}

async function marcarReciboPagado(recibo) {
  if (!confirmAction(`¿Marcar como pagado el recibo de ${recibo.tipo_servicio?.nombre} (${recibo.periodo})?`)) return;
  try {
    await updateReciboGeneral(recibo.id, { estado_pago: 'pagado', fecha_pago: new Date().toISOString().slice(0, 10) });
    showToast('Recibo marcado como pagado.', 'success');
    await renderRecibos();
  } catch (err) {
    console.error(err);
    showToast('No se pudo actualizar.', 'error');
  }
}

function bindRecibos() {
  qs('#filtro-recibo-propiedad')?.addEventListener('change', renderRecibos);
  qs('#btn-nuevo-recibo')?.addEventListener('click', () => openReciboModal());
  qs('#re-propiedad')?.addEventListener('change', refreshCuentasRecibo);
  qs('#re-tipo-servicio')?.addEventListener('change', refreshCuentasRecibo);

  const form = qs('#form-recibo');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const btn = qs('#btn-guardar-recibo');
    setLoading(btn, true);
    try {
      let fotoUrl = null;
      const file = qs('#re-foto-file').files[0];
      const propiedadId = qs('#re-propiedad').value;
      if (file) fotoUrl = await uploadArchivo(file, `recibos/${propiedadId}`);
      const montoTotal = Number(qs('#re-monto').value);
      const consumoTotal = qs('#re-consumo').value ? Number(qs('#re-consumo').value) : null;
      await createReciboGeneral({
        propiedad_id: propiedadId,
        tipo_servicio_id: qs('#re-tipo-servicio').value,
        cuenta_servicio_id: qs('#re-cuenta').value || null,
        periodo: qs('#re-periodo').value,
        monto_total_recibo: montoTotal,
        consumo_total_recibo: consumoTotal,
        precio_unitario: consumoTotal ? Number((montoTotal / consumoTotal).toFixed(4)) : null,
        fecha_vencimiento_recibo: qs('#re-fecha-venc').value || null,
        foto_recibo_url: fotoUrl,
        notas: qs('#re-notas').value || null,
      });
      showToast('Recibo general registrado.', 'success');
      closeModal('modal-recibo');
      await renderRecibos();
    } catch (err) {
      console.error(err);
      showToast('No se pudo registrar el recibo. ¿Ya existe uno para esa propiedad, servicio, periodo y cuenta?', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

async function refreshCuentasRecibo() {
  const propiedadId = qs('#re-propiedad')?.value;
  const tipoServicioId = qs('#re-tipo-servicio')?.value;
  const sel = qs('#re-cuenta');
  if (!sel) return;
  const currentValue = sel.value;
  sel.innerHTML = '<option value="">Cuenta única de la propiedad</option>';
  if (!propiedadId || !tipoServicioId) return;
  const cuentas = await listCuentasServicio({ propiedadId, tipoServicioId });
  cuentas.forEach((c) => sel.append(el('option', { value: c.id }, `${c.codigo}${c.nombre ? ' · ' + c.nombre : ''}`)));
  if (cuentas.some((c) => c.id === currentValue)) sel.value = currentValue;
}

async function openReciboModal() {
  const form = qs('#form-recibo');
  form.reset();
  await refreshCuentasRecibo();
  qs('#re-periodo').value = periodoActual();
  qs('#re-foto-file').value = '';
  openModal('modal-recibo');
}

/* ============================= CUENTAS DE SERVICIO ============================== */
async function renderCuentas() {
  const tbody = qs('#cuentas-tbody');
  try {
    const propiedadId = qs('#filtro-cuenta-propiedad').value;
    const [cuentas, medidores] = await Promise.all([
      listCuentasServicio({ propiedadId }),
      listMedidores({ propiedadId }),
    ]);
    cuentasCache = cuentas;
    const conteoMedidores = new Map();
    medidores.forEach((m) => {
      if (!m.cuenta_servicio_id) return;
      conteoMedidores.set(m.cuenta_servicio_id, (conteoMedidores.get(m.cuenta_servicio_id) ?? 0) + 1);
    });
    tbody.innerHTML = '';
    if (!cuentasCache.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '7' }, [el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '🧾'), el('p', {}, 'Sin cuentas de servicio registradas.')])])]));
      return;
    }
    cuentasCache.forEach((c) => {
      const n = conteoMedidores.get(c.id) ?? 0;
      tbody.append(el('tr', {}, [
        el('td', {}, c.propiedad?.nombre_referencial ?? '—'),
        el('td', {}, c.tipo_servicio?.nombre ?? '—'),
        el('td', {}, c.codigo),
        el('td', {}, c.nombre || '—'),
        el('td', {}, n ? el('span', { class: 'badge badge-disponible' }, `${n} medidor${n === 1 ? '' : 'es'}`) : el('span', { class: 'badge badge-inactivo' }, 'Ninguno todavía')),
        el('td', {}, c.activo ? el('span', { class: 'badge badge-disponible' }, 'Activa') : el('span', { class: 'badge badge-inactivo' }, 'Inactiva')),
        el('td', { class: 'actions' }, [
          el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => openCuentaModal(c) }, 'Editar'),
        ]),
      ]));
    });
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar las cuentas de servicio.', 'error');
  }
}

function bindCuentas() {
  qs('#filtro-cuenta-propiedad')?.addEventListener('change', renderCuentas);
  qs('#btn-nueva-cuenta')?.addEventListener('click', () => openCuentaModal());

  const form = qs('#form-cuenta');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const payload = {
      propiedad_id: qs('#cu-propiedad').value || null,
      tipo_servicio_id: qs('#cu-tipo-servicio').value,
      codigo: qs('#cu-codigo').value.trim(),
      nombre: qs('#cu-nombre').value.trim() || null,
      notas: qs('#cu-notas').value || null,
    };
    const btn = qs('#btn-guardar-cuenta');
    setLoading(btn, true);
    try {
      const editingId = form.dataset.editingId;
      if (editingId) await updateCuentaServicio(editingId, payload); else await createCuentaServicio(payload);
      showToast('Cuenta de servicio guardada.', 'success');
      closeModal('modal-cuenta');
      await renderCuentas();
    } catch (err) {
      console.error(err);
      showToast('No se pudo guardar. ¿Ya existe una cuenta con ese código para esta propiedad y servicio?', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

function openCuentaModal(cuenta = null) {
  const form = qs('#form-cuenta');
  form.reset();
  form.dataset.editingId = cuenta?.id ?? '';
  qs('#modal-cuenta-title').textContent = cuenta ? 'Editar cuenta de servicio' : 'Nueva cuenta de servicio';
  qs('#cu-propiedad').value = cuenta?.propiedad_id ?? '';
  qs('#cu-tipo-servicio').value = cuenta?.tipo_servicio_id ?? '';
  qs('#cu-codigo').value = cuenta?.codigo ?? '';
  qs('#cu-nombre').value = cuenta?.nombre ?? '';
  qs('#cu-notas').value = cuenta?.notas ?? '';
  openModal('modal-cuenta');
}

/* ================================== CÁLCULO ==================================== */
// Una propiedad puede tener varias cuentas del mismo servicio (ej. 3 cuentas
// de agua independientes) — cada recibo general se calcula por separado,
// solo contra los medidores que pertenecen a esa misma cuenta.
let calculoDetalleActual = [];
let calculoReciboActual = null;

function bindCalculo() {
  qs('#ca-propiedad')?.addEventListener('change', () => { qs('#calculo-resultado').innerHTML = ''; qs('#btn-confirmar-calculo').style.display = 'none'; });
  qs('#btn-cargar-calculo')?.addEventListener('click', buscarRecibosCalculo);
  qs('#btn-confirmar-calculo')?.addEventListener('click', confirmarCalculo);
  qs('#ca-periodo').value = periodoActual();
}

async function buscarRecibosCalculo() {
  const propiedadId = qs('#ca-propiedad').value;
  const tipoServicioId = qs('#ca-tipo-servicio').value;
  const periodo = qs('#ca-periodo').value;
  if (!propiedadId || !tipoServicioId || !periodo) {
    showToast('Selecciona propiedad, tipo de servicio y periodo.', 'error');
    return;
  }

  const contenedor = qs('#calculo-resultado');
  contenedor.innerHTML = '<div class="skeleton" style="height:80px;"></div>';
  qs('#btn-confirmar-calculo').style.display = 'none';
  calculoDetalleActual = [];
  calculoReciboActual = null;

  try {
    const tipoServicio = tiposServicioCache.find((t) => t.id === tipoServicioId);
    const [recibos, calculos] = await Promise.all([
      listRecibosGenerales({ propiedadId }),
      listCalculosPeriodo({ propiedadId }),
    ]);
    const recibosDelPeriodo = recibos.filter((r) => r.tipo_servicio_id === tipoServicioId && r.periodo === periodo);
    if (!recibosDelPeriodo.length) {
      contenedor.innerHTML = `<div class="card"><p>No hay ningún recibo general registrado para <strong>${tipoServicio?.nombre}</strong> en el periodo <strong>${periodo}</strong>. Regístralo primero en la pestaña "Recibos generales".</p></div>`;
      return;
    }
    const calculadosIds = new Set(calculos.filter((c) => c.tipo_servicio_id === tipoServicioId && c.periodo === periodo).map((c) => c.recibo_general_id));

    contenedor.innerHTML = '';
    if (recibosDelPeriodo.length > 1) {
      contenedor.append(el('p', { style: 'margin-bottom:12px; color:var(--gray-500);' },
        `Esta propiedad tiene ${recibosDelPeriodo.length} cuentas de ${tipoServicio?.nombre} distintas en este periodo. Calcula cada una por separado.`));
    }
    recibosDelPeriodo.forEach((recibo) => {
      const yaCalculado = calculadosIds.has(recibo.id);
      const card = el('div', { class: 'card', style: 'margin-bottom:12px;' }, [
        el('p', { style: 'margin-bottom:8px;' }, [
          el('strong', {}, recibo.cuenta_servicio ? `Cuenta ${recibo.cuenta_servicio.codigo}${recibo.cuenta_servicio.nombre ? ' · ' + recibo.cuenta_servicio.nombre : ''}` : 'Cuenta única de la propiedad'),
          ` — ${formatCurrency(recibo.monto_total_recibo)}${recibo.precio_unitario ? ' · precio unit. ' + formatNumber(recibo.precio_unitario, 4) : ''}`,
        ]),
      ]);
      if (yaCalculado) {
        card.append(el('span', { class: 'badge badge-disponible' }, '✓ Ya calculado'));
      } else {
        card.append(el('button', { class: 'btn btn-secondary btn-sm', onclick: () => cargarDetalleRecibo(recibo, tipoServicio) }, 'Calcular esta cuenta'));
      }
      card.append(el('div', { id: `calculo-detalle-${recibo.id}` }));
      contenedor.append(card);
    });
  } catch (err) {
    console.error(err);
    showToast('No se pudo buscar los recibos del periodo.', 'error');
  }
}

async function cargarDetalleRecibo(recibo, tipoServicio) {
  const propiedadId = qs('#ca-propiedad').value;
  const tipoServicioId = qs('#ca-tipo-servicio').value;
  const periodo = qs('#ca-periodo').value;
  const contenedorDetalle = qs(`#calculo-detalle-${recibo.id}`);
  contenedorDetalle.innerHTML = '<div class="skeleton" style="height:60px; margin-top:8px;"></div>';
  qs('#btn-confirmar-calculo').style.display = 'none';

  try {
    const cuentaId = recibo.cuenta_servicio_id ?? null;
    const [secciones, medidoresPropiedad] = await Promise.all([
      listSeccionesPorPropiedad(propiedadId),
      listMedidores({ propiedadId }),
    ]);

    calculoDetalleActual = [];
    calculoReciboActual = recibo;
    const filas = [];
    for (const s of secciones) {
      // Una sección puede tener MÁS de un medidor del mismo servicio si sus
      // lavados/tomas están repartidos entre distintas cuentas (ej. Lavadero
      // 2 con un medidor de la cuenta Lt14 y otro de la cuenta Lt15). Hay
      // que buscar, entre todos los de esta sección, el que pertenece a la
      // cuenta que se está calculando ahora — no tomar el primero que salga.
      const medidoresSeccion = medidoresPropiedad.filter((m) => !m.es_general && m.tipo_servicio_id === tipoServicioId && m.seccion_id === s.id);
      const medidorDeEstaCuenta = medidoresSeccion.find((m) => (m.cuenta_servicio_id ?? null) === cuentaId);
      if (medidoresSeccion.length) {
        if (!medidorDeEstaCuenta) continue; // todos sus medidores pertenecen a otra(s) cuenta(s)
        const lecturas = await listLecturas({ medidorId: medidorDeEstaCuenta.id, periodo });
        const lectura = lecturas[0];
        if (!lectura) {
          filas.push(el('tr', {}, [
            el('td', {}, s.nombre), el('td', {}, 'Medidor propio'), el('td', {}, '—'),
            el('td', {}, el('span', { class: 'badge badge-vencida' }, 'Falta lectura del periodo')),
          ]));
          continue;
        }
        calculoDetalleActual.push({ seccion_id: s.id, metodo: 'medidor', lectura_id: lectura.id, consumo: Number(lectura.consumo_calculado) });
        filas.push(el('tr', {}, [
          el('td', {}, s.nombre), el('td', {}, 'Medidor propio'),
          el('td', {}, `${formatNumber(lectura.consumo_calculado, 3)} ${tipoServicio?.unidad_medida ?? ''}`),
          el('td', {}, '✓ listo'),
        ]));
      } else if (!cuentaId && tipoServicio?.permite_tarifa_fija_por_persona) {
        // Tarifa fija solo aplica cuando la propiedad tiene una sola cuenta
        // por servicio — con varias cuentas no hay forma de saber a cuál
        // pertenece una sección sin medidor propio.
        const idx = calculoDetalleActual.length;
        calculoDetalleActual.push({ seccion_id: s.id, metodo: 'tarifa_fija_por_persona', n_personas: 1, tarifa_por_persona: Number(tipoServicio.tarifa_por_persona_default ?? 0) });
        filas.push(el('tr', {}, [
          el('td', {}, s.nombre), el('td', {}, 'Tarifa fija por persona'),
          el('td', {}, [
            el('input', { type: 'number', min: '0', value: '1', style: 'width:70px; display:inline-block;', onchange: (evt) => { calculoDetalleActual[idx].n_personas = Number(evt.target.value); } }),
            ' personas × ',
            el('input', { type: 'number', min: '0', step: '0.01', value: String(tipoServicio.tarifa_por_persona_default ?? 0), style: 'width:90px; display:inline-block;', onchange: (evt) => { calculoDetalleActual[idx].tarifa_por_persona = Number(evt.target.value); } }),
          ]),
          el('td', {}, '✓ listo'),
        ]));
      } else if (!cuentaId) {
        filas.push(el('tr', {}, [el('td', {}, s.nombre), el('td', {}, 'No prorrateable'), el('td', {}, '—'), el('td', {}, '—')]));
      }
      // si cuentaId existe y la sección no tiene medidor de ninguna cuenta, no
      // pertenece a este recibo — se omite sin mostrar fila.
    }

    contenedorDetalle.innerHTML = '';
    if (!filas.length) {
      contenedorDetalle.append(el('p', { style: 'color:var(--gray-500); margin-top:8px;' }, 'Ninguna sección tiene un medidor asignado a esta cuenta todavía. Revisa los medidores en la pestaña "Medidores".'));
      return;
    }
    contenedorDetalle.append(el('div', { class: 'table-wrap', style: 'margin-top:10px;' }, [
      el('table', { class: 'data-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', {}, 'Sección'), el('th', {}, 'Método'), el('th', {}, 'Consumo / detalle'), el('th', {}, '')])]),
        el('tbody', {}, filas),
      ]),
    ]));
    qs('#calculo-recibo-id').value = recibo.id;
    qs('#btn-confirmar-calculo').style.display = calculoDetalleActual.length ? 'inline-flex' : 'none';
  } catch (err) {
    console.error(err);
    showToast('No se pudo preparar el cálculo de esta cuenta.', 'error');
  }
}

async function confirmarCalculo() {
  if (!calculoDetalleActual.length || !calculoReciboActual) return;
  if (!confirmAction(`Se generarán ${calculoDetalleActual.length} cuota(s) de cobranza a partir de este cálculo. ¿Confirmar?`)) return;
  const btn = qs('#btn-confirmar-calculo');
  setLoading(btn, true, 'Calculando…');
  try {
    await calcularPeriodoServicio({
      propiedadId: qs('#ca-propiedad').value,
      tipoServicioId: qs('#ca-tipo-servicio').value,
      periodo: qs('#ca-periodo').value,
      reciboGeneralId: calculoReciboActual.id,
      detalles: calculoDetalleActual,
    });
    showToast('Cálculo confirmado. Las cuotas de servicio ya están disponibles en Cobranzas.', 'success');
    calculoDetalleActual = [];
    calculoReciboActual = null;
    btn.style.display = 'none';
    await buscarRecibosCalculo();
  } catch (err) {
    console.error(err);
    showToast(err.message?.includes('Ya existe') ? 'Ya existe un cálculo confirmado para este recibo.' : 'No se pudo confirmar el cálculo.', 'error');
  } finally {
    setLoading(btn, false);
  }
}

main();
