/**
 * contratos.js — Módulo Contratos (Fase 2): alquiler y venta, con generación
 * automática de cuotas manejada por triggers en la base de datos (ver
 * assets/sql/migrations-fase2-fase3.sql). Esta capa solo hace CRUD y arma
 * las listas de selección (secciones disponibles, personas por rol).
 */
import { initShell } from './main.js';
import {
  listContratosAlquiler, getContratoAlquiler, createContratoAlquiler, updateContratoAlquiler,
  listContratosVenta, getContratoVenta, createContratoVenta, updateContratoVenta,
  listSeccionesDisponibles, listPersonas, createComisionAgente,
} from './supabase-data.js';
import { qs, qsa, el, formatCurrency, formatDate, badgeHtml, showToast, openModal, closeModal, validateForm, setLoading, debounce } from './utils.js';

let profile = null;
let activeTab = 'alquiler';

async function main() {
  profile = await initShell('contratos');
  if (!profile) return;

  bindTabs();
  bindToolbar();
  bindFormAlquiler();
  bindFormVenta();
  await refresh();
}

function bindTabs() {
  qsa('.tab-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      qsa('.tab-btn[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      qsa('.tab-panel').forEach((p) => { p.style.display = p.id === `panel-${activeTab}` ? 'block' : 'none'; });
      refresh();
    });
  });
}

function bindToolbar() {
  qs('#btn-nuevo-contrato')?.addEventListener('click', () => {
    if (activeTab === 'alquiler') openAlquilerModal(); else openVentaModal();
  });
  qs('#search-input')?.addEventListener('input', debounce(refresh, 350));
}

async function refresh() {
  const search = qs('#search-input')?.value ?? '';
  if (activeTab === 'alquiler') await renderAlquiler(search);
  else await renderVenta(search);
}

/* ================================ ALQUILER ================================== */
async function renderAlquiler(search = '') {
  const tbody = qs('#alquiler-tbody');
  try {
    const contratos = await listContratosAlquiler({ search });
    tbody.innerHTML = '';
    if (!contratos.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '8' }, [
        el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '📄'), el('p', {}, 'Sin contratos de alquiler todavía.')]),
      ])]));
      return;
    }
    contratos.forEach((c) => tbody.append(renderRowAlquiler(c)));
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar los contratos de alquiler.', 'error');
  }
}

function renderRowAlquiler(c) {
  const edificio = c.seccion?.propiedades?.nombre_referencial ?? '—';
  const distrito = c.seccion?.propiedades?.distrito ?? '—';
  const ubicacion = c.seccion?.nombre ?? '—';
  return el('tr', {}, [
    el('td', {}, edificio),
    el('td', {}, distrito),
    el('td', {}, [el('div', { style: 'font-weight:600;' }, ubicacion)]),
    el('td', {}, [c.inquilino?.nombre ?? '—', c.aval ? el('div', { style: 'font-size:11px; color:var(--gray-500);' }, `Aval: ${c.aval.nombre}`) : null]),
    el('td', {}, `${formatCurrency(c.monto_renta, c.moneda)} / mes`),
    el('td', {}, `${formatDate(c.fecha_inicio)} → ${c.fecha_fin ? formatDate(c.fecha_fin) : 'indefinido'}`),
    el('td', { html: badgeHtml(c.estado) }),
    el('td', { class: 'actions' }, [
      el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => editAlquiler(c.id) }, 'Editar'),
    ]),
  ]);
}

async function editAlquiler(id) {
  try {
    const c = await getContratoAlquiler(id);
    openAlquilerModal(c);
  } catch (err) {
    console.error(err);
    showToast('No se pudo cargar el contrato.', 'error');
  }
}

async function openAlquilerModal(contrato = null) {
  const form = qs('#form-alquiler');
  form.reset();
  qsa('.form-field', form).forEach((f) => f.classList.remove('invalid'));
  qs('#modal-alquiler-title').textContent = contrato ? 'Editar contrato de alquiler' : 'Nuevo contrato de alquiler';
  form.dataset.editingId = contrato?.id ?? '';

  const [secciones, inquilinos, agentes, avales] = await Promise.all([
    listSeccionesDisponibles({ paraVenta: false }),
    listPersonas({ rol: 'inquilino' }),
    listPersonas({ rol: 'agente' }),
    listPersonas({ rol: 'aval' }),
  ]);

  const seccionSelect = qs('#al-seccion');
  seccionSelect.innerHTML = '<option value="">Selecciona una sección…</option>';
  const opciones = [...secciones];
  if (contrato?.seccion && !opciones.some((s) => s.id === contrato.seccion.id)) {
    opciones.unshift({ id: contrato.seccion.id, nombre: contrato.seccion.nombre, propiedades: contrato.seccion.propiedades });
  }
  opciones.forEach((s) => seccionSelect.append(el('option', { value: s.id }, `${s.propiedades?.nombre_referencial ?? ''} · ${s.nombre}`)));

  const inquilinoSelect = qs('#al-inquilino');
  inquilinoSelect.innerHTML = '<option value="">Selecciona…</option>';
  inquilinos.forEach((p) => inquilinoSelect.append(el('option', { value: p.id }, p.nombre)));

  const agenteSelect = qs('#al-agente');
  agenteSelect.innerHTML = '<option value="">Sin agente</option>';
  agentes.forEach((p) => agenteSelect.append(el('option', { value: p.id }, p.nombre)));

  const avalSelect = qs('#al-aval');
  avalSelect.innerHTML = '<option value="">Selecciona…</option>';
  avales.forEach((p) => avalSelect.append(el('option', { value: p.id }, p.nombre)));

  const estadoField = qs('#al-estado-field');
  const estadoSelect = qs('#al-estado');
  const comisionField = qs('#al-comision-field');

  qs('#al-tiene-aval').checked = false;
  qs('#al-aval-field').style.display = 'none';

  if (contrato) {
    seccionSelect.value = contrato.seccion_id;
    inquilinoSelect.value = contrato.inquilino_id;
    agenteSelect.value = contrato.agente_id ?? '';
    qs('#al-monto').value = contrato.monto_renta ?? '';
    qs('#al-moneda').value = contrato.moneda ?? 'PEN';
    qs('#al-dia-venc').value = contrato.dia_vencimiento ?? '';
    qs('#al-fecha-inicio').value = contrato.fecha_inicio ?? '';
    qs('#al-fecha-fin').value = contrato.fecha_fin ?? '';
    qs('#al-deposito').value = contrato.deposito_garantia ?? '';
    qs('#al-renovacion').checked = !!contrato.renovacion_automatica;
    qs('#al-notas').value = contrato.notas ?? '';
    estadoSelect.value = contrato.estado ?? 'vigente';
    estadoField.style.display = 'block';
    comisionField.style.display = 'none';
    if (contrato.aval_id) {
      qs('#al-tiene-aval').checked = true;
      qs('#al-aval-field').style.display = 'block';
      avalSelect.value = contrato.aval_id;
    }
  } else {
    qs('#al-moneda').value = 'PEN';
    estadoField.style.display = 'none';
    comisionField.style.display = 'block';
  }
  openModal('modal-alquiler');
}

function bindFormAlquiler() {
  qs('#al-tiene-aval')?.addEventListener('change', (evt) => {
    qs('#al-aval-field').style.display = evt.target.checked ? 'block' : 'none';
    if (!evt.target.checked) qs('#al-aval').value = '';
  });
  const form = qs('#form-alquiler');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const payload = {
      seccion_id: qs('#al-seccion').value,
      inquilino_id: qs('#al-inquilino').value,
      agente_id: qs('#al-agente').value || null,
      aval_id: qs('#al-tiene-aval').checked ? (qs('#al-aval').value || null) : null,
      monto_renta: Number(qs('#al-monto').value),
      moneda: qs('#al-moneda').value,
      dia_vencimiento: Number(qs('#al-dia-venc').value),
      fecha_inicio: qs('#al-fecha-inicio').value,
      fecha_fin: qs('#al-fecha-fin').value || null,
      deposito_garantia: qs('#al-deposito').value ? Number(qs('#al-deposito').value) : null,
      renovacion_automatica: qs('#al-renovacion').checked,
      notas: qs('#al-notas').value || null,
    };
    const editingId = form.dataset.editingId;
    if (editingId) payload.estado = qs('#al-estado').value;

    const btn = qs('#btn-guardar-alquiler');
    setLoading(btn, true);
    try {
      let contrato;
      if (editingId) {
        contrato = await updateContratoAlquiler(editingId, payload);
        showToast('Contrato actualizado.', 'success');
      } else {
        contrato = await createContratoAlquiler({ ...payload, estado: 'vigente' });
        showToast('Contrato creado. Las cuotas mensuales se generaron automáticamente.', 'success');
        await maybeCrearComision('alquiler', contrato.id, payload.agente_id);
      }
      closeModal('modal-alquiler');
      await refresh();
    } catch (err) {
      console.error(err);
      showToast('No se pudo guardar el contrato. Verifica que la sección no tenga ya un contrato activo.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

/* ================================== VENTA ==================================== */
async function renderVenta(search = '') {
  const tbody = qs('#venta-tbody');
  try {
    const contratos = await listContratosVenta({ search });
    tbody.innerHTML = '';
    if (!contratos.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '8' }, [
        el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '📄'), el('p', {}, 'Sin contratos de venta todavía.')]),
      ])]));
      return;
    }
    contratos.forEach((c) => tbody.append(renderRowVenta(c)));
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar los contratos de venta.', 'error');
  }
}

const FORMA_PAGO_LABELS = { contado: 'Contado', cuotas: 'Cuotas', credito_hipotecario: 'Crédito hipotecario' };

function renderRowVenta(c) {
  const edificio = c.seccion?.propiedades?.nombre_referencial ?? '—';
  const distrito = c.seccion?.propiedades?.distrito ?? '—';
  const ubicacion = c.seccion?.nombre ?? '—';
  return el('tr', {}, [
    el('td', {}, edificio),
    el('td', {}, distrito),
    el('td', {}, [el('div', { style: 'font-weight:600;' }, ubicacion)]),
    el('td', {}, [c.comprador?.nombre ?? '—', c.aval ? el('div', { style: 'font-size:11px; color:var(--gray-500);' }, `Aval: ${c.aval.nombre}`) : null]),
    el('td', {}, formatCurrency(c.precio_pactado)),
    el('td', {}, `${FORMA_PAGO_LABELS[c.forma_pago] ?? c.forma_pago}${c.forma_pago === 'cuotas' ? ` (${c.n_cuotas})` : ''}`),
    el('td', { html: badgeHtml(c.estado) }),
    el('td', { class: 'actions' }, [
      el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => editVenta(c.id) }, 'Editar'),
    ]),
  ]);
}

async function editVenta(id) {
  try {
    const c = await getContratoVenta(id);
    openVentaModal(c);
  } catch (err) {
    console.error(err);
    showToast('No se pudo cargar el contrato.', 'error');
  }
}

async function openVentaModal(contrato = null) {
  const form = qs('#form-venta');
  form.reset();
  qsa('.form-field', form).forEach((f) => f.classList.remove('invalid'));
  qs('#modal-venta-title').textContent = contrato ? 'Editar contrato de venta' : 'Nuevo contrato de venta';
  form.dataset.editingId = contrato?.id ?? '';

  const [secciones, compradores, agentes, avales] = await Promise.all([
    listSeccionesDisponibles({ paraVenta: true }),
    listPersonas({ rol: 'comprador' }),
    listPersonas({ rol: 'agente' }),
    listPersonas({ rol: 'aval' }),
  ]);

  const seccionSelect = qs('#ve-seccion');
  seccionSelect.innerHTML = '<option value="">Selecciona una sección…</option>';
  const opciones = [...secciones];
  if (contrato?.seccion && !opciones.some((s) => s.id === contrato.seccion.id)) {
    opciones.unshift({ id: contrato.seccion.id, nombre: contrato.seccion.nombre, propiedades: contrato.seccion.propiedades });
  }
  opciones.forEach((s) => seccionSelect.append(el('option', { value: s.id }, `${s.propiedades?.nombre_referencial ?? ''} · ${s.nombre}`)));

  const compradorSelect = qs('#ve-comprador');
  compradorSelect.innerHTML = '<option value="">Selecciona…</option>';
  compradores.forEach((p) => compradorSelect.append(el('option', { value: p.id }, p.nombre)));

  const agenteSelect = qs('#ve-agente');
  agenteSelect.innerHTML = '<option value="">Sin agente</option>';
  agentes.forEach((p) => agenteSelect.append(el('option', { value: p.id }, p.nombre)));

  const avalSelect = qs('#ve-aval');
  avalSelect.innerHTML = '<option value="">Selecciona…</option>';
  avales.forEach((p) => avalSelect.append(el('option', { value: p.id }, p.nombre)));

  const estadoField = qs('#ve-estado-field');
  const comisionField = qs('#ve-comision-field');

  qs('#ve-tiene-aval').checked = false;
  qs('#ve-aval-field').style.display = 'none';

  if (contrato) {
    seccionSelect.value = contrato.seccion_id;
    compradorSelect.value = contrato.comprador_id;
    agenteSelect.value = contrato.agente_id ?? '';
    qs('#ve-precio').value = contrato.precio_pactado ?? '';
    qs('#ve-forma-pago').value = contrato.forma_pago ?? 'contado';
    qs('#ve-fecha-firma').value = contrato.fecha_firma ?? '';
    qs('#ve-n-cuotas').value = contrato.n_cuotas ?? '';
    qs('#ve-notas').value = contrato.notas ?? '';
    qs('#ve-estado').value = contrato.estado ?? 'vigente';
    estadoField.style.display = 'block';
    comisionField.style.display = 'none';
    if (contrato.aval_id) {
      qs('#ve-tiene-aval').checked = true;
      qs('#ve-aval-field').style.display = 'block';
      avalSelect.value = contrato.aval_id;
    }
  } else {
    estadoField.style.display = 'none';
    comisionField.style.display = 'block';
  }
  toggleNCuotas();
  openModal('modal-venta');
}

function toggleNCuotas() {
  const formaPago = qs('#ve-forma-pago').value;
  qs('#ve-n-cuotas-field').style.display = formaPago === 'cuotas' ? 'block' : 'none';
}

function bindFormVenta() {
  qs('#ve-forma-pago')?.addEventListener('change', toggleNCuotas);
  qs('#ve-tiene-aval')?.addEventListener('change', (evt) => {
    qs('#ve-aval-field').style.display = evt.target.checked ? 'block' : 'none';
    if (!evt.target.checked) qs('#ve-aval').value = '';
  });
  const form = qs('#form-venta');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const formaPago = qs('#ve-forma-pago').value;
    const payload = {
      seccion_id: qs('#ve-seccion').value,
      comprador_id: qs('#ve-comprador').value,
      agente_id: qs('#ve-agente').value || null,
      aval_id: qs('#ve-tiene-aval').checked ? (qs('#ve-aval').value || null) : null,
      precio_pactado: Number(qs('#ve-precio').value),
      forma_pago: formaPago,
      fecha_firma: qs('#ve-fecha-firma').value,
      n_cuotas: formaPago === 'cuotas' ? Number(qs('#ve-n-cuotas').value || 0) || null : null,
      notas: qs('#ve-notas').value || null,
    };
    const editingId = form.dataset.editingId;
    if (editingId) payload.estado = qs('#ve-estado').value;

    const btn = qs('#btn-guardar-venta');
    setLoading(btn, true);
    try {
      let contrato;
      if (editingId) {
        contrato = await updateContratoVenta(editingId, payload);
        showToast('Contrato actualizado.', 'success');
      } else {
        contrato = await createContratoVenta({ ...payload, estado: 'vigente' });
        showToast(formaPago === 'cuotas' ? 'Contrato creado. El cronograma de cuotas se generó automáticamente.' : 'Contrato creado.', 'success');
        await maybeCrearComision('venta', contrato.id, payload.agente_id);
      }
      closeModal('modal-venta');
      await refresh();
    } catch (err) {
      console.error(err);
      showToast('No se pudo guardar el contrato. Verifica que la sección no tenga ya un contrato activo.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

/* ============================ COMISIÓN (opcional) ============================= */
async function maybeCrearComision(tipo, contratoId, agenteId) {
  if (!agenteId) return;
  const prefix = tipo === 'alquiler' ? 'al' : 've';
  const monto = qs(`#${prefix}-comision-monto`)?.value;
  const porcentaje = qs(`#${prefix}-comision-porcentaje`)?.value;
  if (!monto && !porcentaje) return;
  try {
    await createComisionAgente({
      agente_id: agenteId,
      contrato_tipo: tipo,
      contrato_id: contratoId,
      monto: monto ? Number(monto) : null,
      porcentaje: porcentaje ? Number(porcentaje) : null,
      estado: 'pendiente',
    });
  } catch (err) {
    console.error(err);
    showToast('El contrato se guardó, pero no se pudo registrar la comisión del agente.', 'warning');
  }
}

main();
