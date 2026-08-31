/**
 * contratos.js — Módulo Contratos (Fase 2): alquiler y venta, con generación
 * automática de cuotas manejada por triggers en la base de datos (ver
 * assets/sql/04_migrations-fase2-fase3.sql). Esta capa solo hace CRUD y arma
 * las listas de selección (secciones disponibles, personas por rol).
 */
import { initShell } from './main.js';
import {
  listContratosAlquiler, getContratoAlquiler, createContratoAlquiler, updateContratoAlquiler,
  listContratosVenta, getContratoVenta, createContratoVenta, updateContratoVenta,
  listSeccionesDisponibles, listPersonas, createComisionAgente,
  listTiposServicio, guardarServiciosFijosContrato, guardarSeccionesContrato,
} from './supabase-data.js';
import { qs, qsa, el, formatCurrency, formatDate, badgeHtml, showToast, openModal, closeModal, validateForm, setLoading, debounce } from './utils.js';

let profile = null;
let activeTab = 'alquiler';
let tiposServicioCache = [];
// Secciones que se pueden elegir en el editor de "Secciones del contrato":
// las disponibles + (si se está editando) las que ya tiene ese contrato,
// aunque ya no figuren como "disponibles" en la tabla secciones.
let seccionesAlquilerCache = [];

async function main() {
  profile = await initShell('contratos');
  if (!profile) return;

  try {
    tiposServicioCache = await listTiposServicio();
  } catch (err) {
    console.error(err);
  }

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
  const nSecciones = c.secciones_contrato?.length ?? 1;
  const ubicacion = c.seccion?.nombre ?? '—';
  return el('tr', {}, [
    el('td', {}, edificio),
    el('td', {}, distrito),
    el('td', {}, [
      el('div', { style: 'font-weight:600;' }, ubicacion),
      nSecciones > 1 ? el('div', { style: 'font-size:11px; color:var(--gray-500);' }, `+${nSecciones - 1} sección(es) más`) : null,
    ]),
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

  // Las secciones que este contrato ya tiene (al editar) deben poder elegirse
  // aunque ya no figuren como "disponibles" — se agregan a la lista si faltan.
  seccionesAlquilerCache = [...secciones];
  (contrato?.secciones_contrato ?? []).forEach((sc) => {
    if (sc.seccion && !seccionesAlquilerCache.some((s) => s.id === sc.seccion.id)) {
      seccionesAlquilerCache.push({ id: sc.seccion.id, nombre: sc.seccion.nombre, propiedades: sc.seccion.propiedades });
    }
  });

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

  qs('#al-servicios-fijos-list').innerHTML = '';
  qs('#al-ocupantes').value = '';
  qs('#al-secciones-list').innerHTML = '';
  qs('#al-secciones-error').style.display = 'none';

  if (contrato) {
    inquilinoSelect.value = contrato.inquilino_id;
    agenteSelect.value = contrato.agente_id ?? '';
    qs('#al-moneda').value = contrato.moneda ?? 'PEN';
    qs('#al-dia-venc').value = contrato.dia_vencimiento ?? '';
    qs('#al-fecha-inicio').value = contrato.fecha_inicio ?? '';
    qs('#al-fecha-fin').value = contrato.fecha_fin ?? '';
    qs('#al-deposito').value = contrato.deposito_garantia ?? '';
    qs('#al-renovacion').checked = !!contrato.renovacion_automatica;
    qs('#al-notas').value = contrato.notas ?? '';
    qs('#al-ocupantes').value = contrato.n_ocupantes ?? '';
    estadoSelect.value = contrato.estado ?? 'vigente';
    estadoField.style.display = 'block';
    comisionField.style.display = 'none';
    if (contrato.aval_id) {
      qs('#al-tiene-aval').checked = true;
      qs('#al-aval-field').style.display = 'block';
      avalSelect.value = contrato.aval_id;
    }
    (contrato.servicios_fijos ?? []).forEach((sf) => agregarFilaServicioFijo(sf.tipo_servicio_id, sf.monto_fijo));

    const seccionesContrato = contrato.secciones_contrato ?? [];
    if (seccionesContrato.length) {
      // Original primero, luego adendas en orden de número.
      [...seccionesContrato]
        .sort((a, b) => (a.numero_adenda ?? 0) - (b.numero_adenda ?? 0))
        .forEach((sc) => agregarFilaSeccion({
          seccionId: sc.seccion_id, montoRenta: sc.monto_renta, fechaInicio: sc.fecha_inicio,
          fechaFin: sc.fecha_fin, esAdenda: sc.es_adenda, numeroAdenda: sc.numero_adenda, existente: true,
        }));
    } else {
      // Contrato viejo sin filas en contratos_alquiler_secciones todavía
      // (no debería pasar tras correr la migración 20, pero por si acaso).
      agregarFilaSeccion({ seccionId: contrato.seccion_id, montoRenta: contrato.monto_renta, fechaInicio: contrato.fecha_inicio, fechaFin: contrato.fecha_fin, esAdenda: false, existente: true });
    }
  } else {
    qs('#al-moneda').value = 'PEN';
    estadoField.style.display = 'none';
    comisionField.style.display = 'block';
    agregarFilaSeccion({ fechaInicio: '', existente: false });
  }
  actualizarTotalRenta();
  openModal('modal-alquiler');
}

/* ---------- Secciones del contrato (multi-sección + adenda) ---------- */
function actualizarTotalRenta() {
  const total = qsa('#al-secciones-list > div').reduce((acc, row) => acc + (Number(row.querySelector('.sec-monto')?.value) || 0), 0);
  qs('#al-monto').value = total ? String(Math.round(total * 100) / 100) : '';
}

function leerFilasSecciones() {
  return qsa('#al-secciones-list > div').map((row) => ({
    seccion_id: row.querySelector('.sec-seccion').value,
    monto_renta: Number(row.querySelector('.sec-monto').value) || 0,
    fecha_inicio: row.querySelector('.sec-fecha-inicio').value,
    fecha_fin: row.querySelector('.sec-fecha-fin').value || null,
    // Filas que ya existían cuando se abrió el modal conservan su
    // es_adenda/numero_adenda original; las agregadas en esta sesión de
    // edición de un contrato YA EXISTENTE se marcan como adenda al guardar
    // (ver bindFormAlquiler). Las agregadas al CREAR un contrato nuevo son
    // todas parte del contrato original (es_adenda = false).
    es_adenda: row.dataset.esAdenda === 'true',
    numero_adenda: row.dataset.numeroAdenda ? Number(row.dataset.numeroAdenda) : null,
    _existente: row.dataset.existente === 'true',
  }));
}

function agregarFilaSeccion({ seccionId = '', montoRenta = '', fechaInicio = '', fechaFin = '', esAdenda = false, numeroAdenda = null, existente = false } = {}) {
  if (!fechaInicio) fechaInicio = qs('#al-fecha-inicio')?.value || '';
  const seccionSelect = el('select', { class: 'sec-seccion', style: 'flex:2;', required: 'true' },
    [el('option', { value: '' }, 'Selecciona sección…'), ...seccionesAlquilerCache.map((s) => el('option', { value: s.id }, `${s.propiedades?.nombre_referencial ?? ''} · ${s.nombre}`))]);
  seccionSelect.value = seccionId;
  const montoInput = el('input', { type: 'number', class: 'sec-monto', min: '0.01', step: '0.01', style: 'width:110px;', value: montoRenta === '' ? '' : String(montoRenta), placeholder: 'Renta S/', onchange: actualizarTotalRenta, oninput: actualizarTotalRenta });
  const fechaInicioInput = el('input', { type: 'date', class: 'sec-fecha-inicio', style: 'width:150px;', value: fechaInicio });
  const fechaFinInput = el('input', { type: 'date', class: 'sec-fecha-fin', style: 'width:150px;', value: fechaFin || '', title: 'Fecha de fin (opcional)' });
  const badge = esAdenda ? el('span', { class: 'badge', style: 'background:var(--gray-200); font-size:11px;' }, `Adenda ${numeroAdenda ?? ''}`) : null;
  const row = el('div', { style: 'display:flex; gap:8px; align-items:center; margin-bottom:6px; flex-wrap:wrap;' }, [
    seccionSelect, montoInput, fechaInicioInput, fechaFinInput, badge,
    el('button', { type: 'button', class: 'btn btn-tertiary btn-sm', onclick: () => { row.remove(); actualizarTotalRenta(); } }, '✕'),
  ]);
  row.dataset.esAdenda = String(esAdenda);
  if (numeroAdenda != null) row.dataset.numeroAdenda = String(numeroAdenda);
  row.dataset.existente = String(existente);
  qs('#al-secciones-list').append(row);
}

/* ---------- Montos fijos de servicios (por contrato) ---------- */
function leerFilasServiciosFijos() {
  return qsa('#al-servicios-fijos-list > div').map((row) => ({
    tipo_servicio_id: row.querySelector('.sf-tipo-servicio').value,
    monto_fijo: Number(row.querySelector('.sf-monto').value) || 0,
  }));
}

function agregarFilaServicioFijo(tipoServicioId = '', monto = '') {
  const tipoSelect = el('select', { class: 'sf-tipo-servicio', style: 'flex:1;' },
    [el('option', { value: '' }, 'Selecciona servicio…'), ...tiposServicioCache.map((t) => el('option', { value: t.id }, t.nombre))]);
  tipoSelect.value = tipoServicioId;
  const montoInput = el('input', { type: 'number', class: 'sf-monto', min: '0', step: '0.01', style: 'width:120px;', value: monto === '' ? '' : String(monto), placeholder: 'S/' });
  const row = el('div', { style: 'display:flex; gap:8px; align-items:center; margin-bottom:6px;' }, [
    tipoSelect,
    montoInput,
    el('button', { type: 'button', class: 'btn btn-tertiary btn-sm', onclick: () => row.remove() }, '✕'),
  ]);
  qs('#al-servicios-fijos-list').append(row);
}

function bindFormAlquiler() {
  qs('#al-tiene-aval')?.addEventListener('change', (evt) => {
    qs('#al-aval-field').style.display = evt.target.checked ? 'block' : 'none';
    if (!evt.target.checked) qs('#al-aval').value = '';
  });
  qs('#btn-agregar-servicio-fijo')?.addEventListener('click', () => agregarFilaServicioFijo());
  qs('#btn-agregar-seccion')?.addEventListener('click', () => agregarFilaSeccion());
  const form = qs('#form-alquiler');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;

    const editingId = form.dataset.editingId;
    const filasSecciones = leerFilasSecciones();
    const erroresSecciones = qs('#al-secciones-error');
    if (!filasSecciones.length || filasSecciones.some((f) => !f.seccion_id || !f.monto_renta || !f.fecha_inicio)) {
      erroresSecciones.style.display = 'block';
      erroresSecciones.textContent = 'Agrega al menos una sección con su renta mensual y fecha de inicio.';
      return;
    }
    const seccionesRepetidas = new Set(filasSecciones.map((f) => f.seccion_id)).size !== filasSecciones.length;
    if (seccionesRepetidas) {
      erroresSecciones.style.display = 'block';
      erroresSecciones.textContent = 'No repitas la misma sección dos veces en el contrato.';
      return;
    }
    erroresSecciones.style.display = 'none';

    // Al crear un contrato nuevo, todas sus filas son parte del contrato
    // original (no hay "adenda" todavía). Al editar uno existente, las filas
    // que ya traía conservan su es_adenda/numero_adenda; las que se agregaron
    // recién en esta edición se marcan como adenda, numeradas en el orden en
    // que se agregaron (siguiendo el correlativo más alto que ya existiera).
    let siguienteAdenda = Math.max(0, ...filasSecciones.filter((f) => f._existente).map((f) => f.numero_adenda ?? 0)) + 1;
    const seccionesParaGuardar = filasSecciones.map((f) => {
      if (!editingId || f._existente) return f;
      const conAdenda = { ...f, es_adenda: true, numero_adenda: siguienteAdenda };
      siguienteAdenda += 1;
      return conAdenda;
    });
    const montoRentaTotal = seccionesParaGuardar.reduce((acc, f) => acc + f.monto_renta, 0);
    // La sección "principal" del contrato (columna seccion_id, por
    // compatibilidad) es siempre una del grupo original, nunca una adenda.
    const seccionPrincipal = seccionesParaGuardar.find((f) => !f.es_adenda) ?? seccionesParaGuardar[0];

    const payload = {
      seccion_id: seccionPrincipal.seccion_id,
      monto_renta: montoRentaTotal,
      inquilino_id: qs('#al-inquilino').value,
      agente_id: qs('#al-agente').value || null,
      aval_id: qs('#al-tiene-aval').checked ? (qs('#al-aval').value || null) : null,
      moneda: qs('#al-moneda').value,
      dia_vencimiento: Number(qs('#al-dia-venc').value),
      fecha_inicio: qs('#al-fecha-inicio').value,
      fecha_fin: qs('#al-fecha-fin').value || null,
      deposito_garantia: qs('#al-deposito').value ? Number(qs('#al-deposito').value) : null,
      renovacion_automatica: qs('#al-renovacion').checked,
      notas: qs('#al-notas').value || null,
      n_ocupantes: qs('#al-ocupantes').value ? Number(qs('#al-ocupantes').value) : null,
    };
    if (editingId) payload.estado = qs('#al-estado').value;

    const serviciosFijos = leerFilasServiciosFijos().filter((sf) => sf.tipo_servicio_id);
    if (serviciosFijos.some((sf) => !sf.monto_fijo)) { showToast('Cada servicio con monto fijo debe tener un monto mayor a 0.', 'error'); return; }
    const tiposRepetidos = new Set(serviciosFijos.map((sf) => sf.tipo_servicio_id)).size !== serviciosFijos.length;
    if (tiposRepetidos) { showToast('No repitas el mismo tipo de servicio en los montos fijos.', 'error'); return; }

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
      try {
        await guardarSeccionesContrato(contrato.id, seccionesParaGuardar);
      } catch (err) {
        console.error(err);
        showToast('El contrato se guardó, pero no se pudieron guardar sus secciones. Revísalas antes de calcular servicios.', 'warning');
      }
      try {
        await guardarServiciosFijosContrato(contrato.id, serviciosFijos);
      } catch (err) {
        console.error(err);
        showToast('El contrato se guardó, pero no se pudieron guardar los montos fijos de servicios.', 'warning');
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
