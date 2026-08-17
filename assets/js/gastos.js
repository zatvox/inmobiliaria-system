/**
 * gastos.js — Módulo Gastos y Mantenimiento (Fase 4): inversiones de
 * mantenimiento (materiales + mano de obra, con varios comprobantes por
 * mantenimiento) y tributos municipales (arbitrios, predial), flexible a
 * nivel de propiedad completa o de una sección independizada.
 */
import { initShell } from './main.js';
import {
  listPropiedades, listSeccionesPorPropiedad, listPersonas, getCatalogo,
  listMantenimientos, getMantenimiento, createMantenimiento, updateMantenimiento, deleteMantenimiento,
  addMantenimientoComprobante, removeMantenimientoComprobante,
  listTributos, getTributo, createTributo, updateTributo,
  uploadArchivo, getSignedUrl,
} from './supabase-data.js';
import { qs, qsa, el, formatCurrency, formatDate, badgeHtml, showToast, openModal, closeModal, validateForm, setLoading, confirmAction } from './utils.js';

let activeTab = 'mantenimientos';
let propiedadesCache = [];

async function main() {
  const profile = await initShell('gastos');
  if (!profile) return;

  propiedadesCache = await listPropiedades();
  fillPropiedadSelects();

  bindTabs();
  bindMantenimientos();
  bindTributos();

  await renderMantenimientos();
}

function fillPropiedadSelects() {
  qsa('.select-propiedad').forEach((sel) => {
    const esFiltro = sel.classList.contains('filtro');
    sel.innerHTML = `<option value="">${esFiltro ? 'Todas las propiedades' : 'Selecciona…'}</option>`;
    propiedadesCache.forEach((p) => sel.append(el('option', { value: p.id }, p.nombre_referencial)));
  });
}

function bindTabs() {
  qsa('.tab-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      activeTab = btn.dataset.tab;
      qsa('.tab-btn[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      qsa('.tab-panel').forEach((p) => { p.style.display = p.id === `panel-${activeTab}` ? 'block' : 'none'; });
      if (activeTab === 'mantenimientos') await renderMantenimientos();
      else await renderTributos();
    });
  });
}

/* ============================== MANTENIMIENTOS ================================ */
async function renderMantenimientos() {
  const tbody = qs('#mantenimientos-tbody');
  try {
    const items = await listMantenimientos({ propiedadId: qs('#filtro-mant-propiedad').value });
    tbody.innerHTML = '';
    if (!items.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '7' }, [
        el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '🧰'), el('p', {}, 'Sin mantenimientos registrados todavía.')]),
      ])]));
      return;
    }
    items.forEach((m) => tbody.append(el('tr', {}, [
      el('td', {}, m.propiedad?.nombre_referencial ?? '—'),
      el('td', {}, m.seccion?.nombre ?? el('span', { style: 'color:var(--gray-500);' }, 'Todo el predio')),
      el('td', {}, m.tipo || '—'),
      el('td', {}, m.descripcion),
      el('td', {}, formatCurrency(m.costo_total)),
      el('td', {}, formatDate(m.fecha)),
      el('td', { class: 'actions' }, [
        el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => editMantenimiento(m.id) }, 'Editar'),
        el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => handleDeleteMantenimiento(m) }, '🗑️'),
      ]),
    ])));
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar los mantenimientos.', 'error');
  }
}

function bindMantenimientos() {
  qs('#filtro-mant-propiedad')?.addEventListener('change', renderMantenimientos);
  qs('#btn-nuevo-mantenimiento')?.addEventListener('click', () => openMantenimientoModal());
  qs('#mt-propiedad')?.addEventListener('change', () => refreshSeccionesMantenimiento());
  qs('#mt-materiales')?.addEventListener('input', actualizarCostoTotal);
  qs('#mt-mano-obra')?.addEventListener('input', actualizarCostoTotal);
  qs('#btn-agregar-comprobante')?.addEventListener('click', agregarComprobante);

  const form = qs('#form-mantenimiento');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const payload = {
      propiedad_id: qs('#mt-propiedad').value,
      seccion_id: qs('#mt-seccion').value || null,
      tipo: qs('#mt-tipo').value || null,
      descripcion: qs('#mt-descripcion').value.trim(),
      proveedor_id: qs('#mt-proveedor').value || null,
      fecha: qs('#mt-fecha').value,
      costo_materiales: Number(qs('#mt-materiales').value || 0),
      costo_mano_obra: Number(qs('#mt-mano-obra').value || 0),
      estado: qs('#mt-estado').value,
      notas: qs('#mt-notas').value || null,
    };
    const btn = qs('#btn-guardar-mantenimiento');
    setLoading(btn, true);
    try {
      const editingId = form.dataset.editingId;
      if (editingId) {
        await updateMantenimiento(editingId, payload);
        showToast('Mantenimiento actualizado.', 'success');
      } else {
        const creado = await createMantenimiento(payload);
        showToast('Mantenimiento creado. Ahora puedes adjuntar sus comprobantes.', 'success');
        form.dataset.editingId = creado.id;
        qs('#modal-mantenimiento-title').textContent = 'Editar mantenimiento';
        qs('#mt-comprobantes-section').style.display = 'block';
        await renderComprobantes(creado.id);
      }
      await renderMantenimientos();
    } catch (err) {
      console.error(err);
      showToast('No se pudo guardar el mantenimiento.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

function actualizarCostoTotal() {
  const materiales = Number(qs('#mt-materiales').value || 0);
  const manoObra = Number(qs('#mt-mano-obra').value || 0);
  qs('#mt-costo-total').textContent = formatCurrency(materiales + manoObra);
}

async function refreshSeccionesMantenimiento(seccionIdSeleccionada = '') {
  const propiedadId = qs('#mt-propiedad').value;
  const seccionSelect = qs('#mt-seccion');
  seccionSelect.innerHTML = '<option value="">Todo el predio (sin sección específica)</option>';
  if (!propiedadId) return;
  const secciones = await listSeccionesPorPropiedad(propiedadId);
  secciones.forEach((s) => seccionSelect.append(el('option', { value: s.id }, s.nombre)));
  if (seccionIdSeleccionada) seccionSelect.value = seccionIdSeleccionada;
}

async function editMantenimiento(id) {
  try {
    const m = await getMantenimiento(id);
    openMantenimientoModal(m);
  } catch (err) {
    console.error(err);
    showToast('No se pudo cargar el mantenimiento.', 'error');
  }
}

async function openMantenimientoModal(mantenimiento = null) {
  const form = qs('#form-mantenimiento');
  form.reset();
  qsa('.form-field', form).forEach((f) => f.classList.remove('invalid'));
  form.dataset.editingId = mantenimiento?.id ?? '';
  qs('#modal-mantenimiento-title').textContent = mantenimiento ? 'Editar mantenimiento' : 'Nuevo mantenimiento';

  const [tipos, proveedores] = await Promise.all([
    getCatalogo('tipo_mantenimiento'),
    listPersonas({ rol: 'proveedor' }),
  ]);
  const tipoSelect = qs('#mt-tipo');
  tipoSelect.innerHTML = '<option value="">Selecciona…</option>';
  tipos.forEach((t) => tipoSelect.append(el('option', { value: t.valor }, t.valor)));

  const proveedorSelect = qs('#mt-proveedor');
  proveedorSelect.innerHTML = '<option value="">Sin especificar</option>';
  proveedores.forEach((p) => proveedorSelect.append(el('option', { value: p.id }, p.nombre)));

  if (mantenimiento) {
    qs('#mt-propiedad').value = mantenimiento.propiedad_id;
    await refreshSeccionesMantenimiento(mantenimiento.seccion_id ?? '');
    tipoSelect.value = mantenimiento.tipo ?? '';
    qs('#mt-descripcion').value = mantenimiento.descripcion ?? '';
    proveedorSelect.value = mantenimiento.proveedor_id ?? '';
    qs('#mt-fecha').value = mantenimiento.fecha ?? '';
    qs('#mt-materiales').value = mantenimiento.costo_materiales ?? 0;
    qs('#mt-mano-obra').value = mantenimiento.costo_mano_obra ?? 0;
    qs('#mt-estado').value = mantenimiento.estado ?? 'finalizado';
    qs('#mt-notas').value = mantenimiento.notas ?? '';
    qs('#mt-comprobantes-section').style.display = 'block';
    await renderComprobantes(mantenimiento.id, mantenimiento.mantenimientos_comprobantes);
  } else {
    qs('#mt-propiedad').value = '';
    await refreshSeccionesMantenimiento();
    qs('#mt-fecha').value = new Date().toISOString().slice(0, 10);
    qs('#mt-estado').value = 'finalizado';
    qs('#mt-comprobantes-section').style.display = 'none';
    qs('#mt-comprobantes-list').innerHTML = '';
  }
  actualizarCostoTotal();
  openModal('modal-mantenimiento');
}

async function renderComprobantes(mantenimientoId, comprobantes = null) {
  const list = qs('#mt-comprobantes-list');
  list.innerHTML = '';
  let items = comprobantes;
  if (!items) {
    const m = await getMantenimiento(mantenimientoId);
    items = m.mantenimientos_comprobantes;
  }
  if (!items?.length) {
    list.append(el('p', { style: 'color:var(--gray-500); font-size:13px;' }, 'Sin comprobantes adjuntos todavía.'));
    return;
  }
  items.forEach((c) => {
    list.append(el('div', { style: 'display:flex; justify-content:space-between; align-items:center; border:1px solid var(--gray-300); border-radius:8px; padding:8px 10px; margin-bottom:6px; font-size:13px;' }, [
      el('div', {}, [
        el('span', { class: 'badge badge-neutral', style: 'margin-right:6px;' }, c.tipo_comprobante),
        c.descripcion || '(sin descripción)',
        c.monto ? ` — ${formatCurrency(c.monto)}` : '',
      ]),
      el('div', { style: 'display:flex; gap:8px;' }, [
        el('a', { href: '#', onclick: async (evt) => { evt.preventDefault(); window.open(await getSignedUrl(c.url_storage), '_blank'); } }, 'Ver'),
        el('a', { href: '#', style: 'color:var(--color-danger);', onclick: async (evt) => {
          evt.preventDefault();
          if (!confirmAction('¿Eliminar este comprobante?')) return;
          try { await removeMantenimientoComprobante(c.id); await renderComprobantes(mantenimientoId); }
          catch (err) { console.error(err); showToast('No se pudo eliminar.', 'error'); }
        } }, 'Eliminar'),
      ]),
    ]));
  });
}

async function agregarComprobante() {
  const mantenimientoId = qs('#form-mantenimiento').dataset.editingId;
  if (!mantenimientoId) { showToast('Guarda el mantenimiento primero.', 'error'); return; }
  const file = qs('#mt-comprobante-file').files[0];
  if (!file) { showToast('Selecciona un archivo primero.', 'error'); return; }
  const btn = qs('#btn-agregar-comprobante');
  setLoading(btn, true, 'Subiendo…');
  try {
    const path = await uploadArchivo(file, `mantenimientos/${mantenimientoId}`);
    await addMantenimientoComprobante(mantenimientoId, {
      tipo_comprobante: qs('#mt-comprobante-tipo').value,
      descripcion: qs('#mt-comprobante-descripcion').value || null,
      monto: qs('#mt-comprobante-monto').value ? Number(qs('#mt-comprobante-monto').value) : null,
      url_storage: path,
    });
    qs('#mt-comprobante-file').value = '';
    qs('#mt-comprobante-descripcion').value = '';
    qs('#mt-comprobante-monto').value = '';
    await renderComprobantes(mantenimientoId);
    showToast('Comprobante agregado.', 'success');
  } catch (err) {
    console.error(err);
    showToast('No se pudo subir el comprobante.', 'error');
  } finally {
    setLoading(btn, false);
  }
}

async function handleDeleteMantenimiento(m) {
  if (!confirmAction(`¿Eliminar el mantenimiento "${m.descripcion}"? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteMantenimiento(m.id);
    showToast('Mantenimiento eliminado.', 'success');
    await renderMantenimientos();
  } catch (err) {
    console.error(err);
    showToast('No se pudo eliminar.', 'error');
  }
}

/* ============================= TRIBUTOS MUNICIPALES ============================= */
async function renderTributos() {
  const tbody = qs('#tributos-tbody');
  try {
    const items = await listTributos({ propiedadId: qs('#filtro-trib-propiedad').value, estadoPago: qs('#filtro-trib-estado').value });
    tbody.innerHTML = '';
    if (!items.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '7' }, [
        el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '🏛️'), el('p', {}, 'Sin tributos registrados todavía.')]),
      ])]));
      return;
    }
    items.forEach((t) => {
      const referencia = t.seccion
        ? `${t.seccion.nombre}${t.seccion.partida_registral ? ' · Partida ' + t.seccion.partida_registral : (t.seccion.codigo_pu_hr ? ' · PU/HR ' + t.seccion.codigo_pu_hr : '')}`
        : 'Todo el predio';
      tbody.append(el('tr', {}, [
        el('td', {}, t.propiedad?.nombre_referencial ?? '—'),
        el('td', {}, referencia),
        el('td', {}, t.tipo),
        el('td', {}, t.periodo),
        el('td', {}, formatCurrency(t.monto)),
        el('td', {}, [formatDate(t.fecha_vencimiento), el('div', { html: badgeHtml(t.estado_pago === 'pagado' ? 'pagada' : 'pendiente') })]),
        el('td', { class: 'actions' }, [
          t.estado_pago === 'pendiente' ? el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => marcarTributoPagado(t) }, 'Marcar pagado') : null,
          el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => editTributo(t.id) }, 'Editar'),
        ]),
      ]));
    });
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar los tributos.', 'error');
  }
}

function bindTributos() {
  qs('#filtro-trib-propiedad')?.addEventListener('change', renderTributos);
  qs('#filtro-trib-estado')?.addEventListener('change', renderTributos);
  qs('#btn-nuevo-tributo')?.addEventListener('click', () => openTributoModal());
  qs('#tr-propiedad')?.addEventListener('change', () => refreshSeccionesTributo());

  const form = qs('#form-tributo');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const btn = qs('#btn-guardar-tributo');
    setLoading(btn, true);
    try {
      let comprobanteUrl = null;
      const file = qs('#tr-comprobante-file').files[0];
      const propiedadId = qs('#tr-propiedad').value;
      const payload = {
        propiedad_id: propiedadId,
        seccion_id: qs('#tr-seccion').value || null,
        tipo: qs('#tr-tipo').value,
        periodo: qs('#tr-periodo').value.trim(),
        monto: Number(qs('#tr-monto').value),
        fecha_vencimiento: qs('#tr-fecha-vencimiento').value || null,
        notas: qs('#tr-notas').value || null,
      };
      if (file) {
        comprobanteUrl = await uploadArchivo(file, `tributos/${propiedadId}`);
        payload.comprobante_estado_cuenta_url = comprobanteUrl;
      }
      const editingId = form.dataset.editingId;
      if (editingId) {
        await updateTributo(editingId, payload);
        showToast('Tributo actualizado.', 'success');
      } else {
        await createTributo(payload);
        showToast('Tributo registrado.', 'success');
      }
      closeModal('modal-tributo');
      await renderTributos();
    } catch (err) {
      console.error(err);
      showToast('No se pudo guardar el tributo. ¿Ya existe uno igual (propiedad + tipo + periodo)?', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

async function refreshSeccionesTributo(seccionIdSeleccionada = '') {
  const propiedadId = qs('#tr-propiedad').value;
  const seccionSelect = qs('#tr-seccion');
  seccionSelect.innerHTML = '<option value="">Todo el predio (no independizado)</option>';
  if (!propiedadId) return;
  const secciones = await listSeccionesPorPropiedad(propiedadId);
  secciones.forEach((s) => {
    const ref = s.partida_registral ? `Partida ${s.partida_registral}` : (s.codigo_pu_hr ? `PU/HR ${s.codigo_pu_hr}` : 'sin registro');
    seccionSelect.append(el('option', { value: s.id }, `${s.nombre} (${ref})`));
  });
  if (seccionIdSeleccionada) seccionSelect.value = seccionIdSeleccionada;
}

async function editTributo(id) {
  try {
    const t = await getTributo(id);
    openTributoModal(t);
  } catch (err) {
    console.error(err);
    showToast('No se pudo cargar el tributo.', 'error');
  }
}

async function openTributoModal(tributo = null) {
  const form = qs('#form-tributo');
  form.reset();
  qsa('.form-field', form).forEach((f) => f.classList.remove('invalid'));
  form.dataset.editingId = tributo?.id ?? '';
  qs('#modal-tributo-title').textContent = tributo ? 'Editar tributo' : 'Nuevo tributo municipal';

  const tipos = await getCatalogo('tipo_tributo');
  const tipoSelect = qs('#tr-tipo');
  tipoSelect.innerHTML = '<option value="">Selecciona…</option>';
  tipos.forEach((t) => tipoSelect.append(el('option', { value: t.valor }, t.valor)));

  if (tributo) {
    qs('#tr-propiedad').value = tributo.propiedad_id;
    await refreshSeccionesTributo(tributo.seccion_id ?? '');
    tipoSelect.value = tributo.tipo;
    qs('#tr-periodo').value = tributo.periodo;
    qs('#tr-monto').value = tributo.monto;
    qs('#tr-fecha-vencimiento').value = tributo.fecha_vencimiento ?? '';
    qs('#tr-notas').value = tributo.notas ?? '';
  } else {
    qs('#tr-propiedad').value = '';
    await refreshSeccionesTributo();
    qs('#tr-periodo').value = String(new Date().getFullYear());
  }
  qs('#tr-comprobante-file').value = '';
  openModal('modal-tributo');
}

async function marcarTributoPagado(tributo) {
  if (!confirmAction(`¿Marcar como pagado el tributo "${tributo.tipo}" (${tributo.periodo})?`)) return;
  try {
    await updateTributo(tributo.id, { estado_pago: 'pagado', fecha_pago: new Date().toISOString().slice(0, 10) });
    showToast('Tributo marcado como pagado.', 'success');
    await renderTributos();
  } catch (err) {
    console.error(err);
    showToast('No se pudo actualizar.', 'error');
  }
}

main();
