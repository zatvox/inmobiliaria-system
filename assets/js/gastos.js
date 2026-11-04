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
  saveEventoMantenimiento, listEquipos, saveEquipo, deleteEquipo,
  listTributos, getTributo, createTributo, updateTributo,
  uploadArchivo, getSignedUrl,
} from './supabase-data.js';
import { abrirCarpeta, initCarpeta } from './mantenimiento-carpeta.js';
import { ESTADOS } from './mant-informe.js';
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
  bindEquipos();

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
      else if (activeTab === 'equipos') await renderEquipos();
      else await renderTributos();
    });
  });
}

/* ============================== MANTENIMIENTOS ================================ */
// Cada trabajo es una carpeta (bitácora, gastos, reparto, informe): ver mantenimiento-carpeta.js.
async function renderMantenimientos() {
  const tbody = qs('#mantenimientos-tbody');
  try {
    const items = await listMantenimientos({ propiedadId: qs('#filtro-mant-propiedad').value });
    tbody.innerHTML = '';
    if (!items.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '7' }, [
        el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '🧰'), el('p', {}, 'Sin trabajos registrados todavía. Crea el primero con “+ Nuevo trabajo”.')]),
      ])]));
      return;
    }
    items.forEach((m) => tbody.append(el('tr', { style: 'cursor:pointer;', onclick: () => abrirCarpeta(m.id, renderMantenimientosSilencioso) }, [
      el('td', {}, m.propiedad?.nombre_referencial ?? '—'),
      el('td', {}, [el('div', { style: 'font-weight:600;' }, m.titulo || m.descripcion), el('div', { style: 'font-size:11px; color:var(--gray-500);' }, [m.seccion?.nombre, m.tipo].filter(Boolean).join(' · ') || 'Todo el predio')]),
      el('td', {}, m.equipo || '—'),
      el('td', {}, el('span', { class: 'badge badge-neutral' }, ESTADOS[m.estado] ?? m.estado)),
      el('td', {}, formatCurrency(m.costo_total)),
      el('td', {}, formatDate(m.fecha)),
      el('td', { class: 'actions' }, [
        el('button', { class: 'btn btn-secondary btn-sm', onclick: (evt) => { evt.stopPropagation(); abrirCarpeta(m.id, renderMantenimientosSilencioso); } }, '📂 Abrir carpeta'),
        el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: (evt) => { evt.stopPropagation(); handleDeleteMantenimiento(m); } }, '🗑️'),
      ]),
    ])));
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar los trabajos.', 'error');
  }
}
// Refresco de la lista cuando se hacen cambios dentro de la carpeta (sin toasts ni parpadeo).
async function renderMantenimientosSilencioso() { try { await renderMantenimientos(); } catch { /* ignorar */ } }

function bindMantenimientos() {
  initCarpeta();
  qs('#filtro-mant-propiedad')?.addEventListener('change', renderMantenimientos);
  qs('#btn-nuevo-mantenimiento')?.addEventListener('click', () => openMantenimientoModal());
  qs('#mt-propiedad')?.addEventListener('change', () => { refreshSeccionesMantenimiento(); llenarEquiposTrabajo(); });
  qs('#mt-equipo-id')?.addEventListener('change', (e) => { qs('#mt-equipo').style.display = e.target.value === '__otro' ? '' : 'none'; });

  const form = qs('#form-mantenimiento');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const titulo = qs('#mt-descripcion').value.trim();
    const payload = {
      propiedad_id: qs('#mt-propiedad').value,
      seccion_id: qs('#mt-seccion').value || null,
      tipo: qs('#mt-tipo').value || null,
      titulo,
      descripcion: titulo,
      ...equipoDelFormulario(),
      proveedor_id: qs('#mt-proveedor').value || null,
      fecha: qs('#mt-fecha').value,
      estado: qs('#mt-estado').value,
      comision_pct: Number(qs('#mt-comision').value || 0),
      presupuesto_estimado: qs('#mt-presupuesto').value === '' ? null : Number(qs('#mt-presupuesto').value),
      problema: qs('#mt-problema').value.trim() || null,
    };
    const btn = qs('#btn-guardar-mantenimiento');
    setLoading(btn, true);
    try {
      const creado = await createMantenimiento(payload);
      // Primer evento de la bitácora = el reporte del problema (si lo escribió)
      if (payload.problema) { try { await saveEventoMantenimiento(creado.id, { tipo: 'reporte', nota: payload.problema }); } catch (e) { console.error(e); } }
      closeModal('modal-mantenimiento');
      showToast('Trabajo creado. Registra ahora la bitácora y los gastos.', 'success');
      await renderMantenimientos();
      await abrirCarpeta(creado.id, renderMantenimientosSilencioso);
    } catch (err) {
      console.error(err);
      showToast('No se pudo crear el trabajo. ¿Ejecutaste el SQL 31?', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
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

async function openMantenimientoModal() {
  const form = qs('#form-mantenimiento');
  form.reset();
  qsa('.form-field', form).forEach((f) => f.classList.remove('invalid'));
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
  qs('#mt-propiedad').value = qs('#filtro-mant-propiedad')?.value ?? '';
  await refreshSeccionesMantenimiento();
  await llenarEquiposTrabajo();
  qs('#mt-fecha').value = new Date().toISOString().slice(0, 10);
  qs('#mt-estado').value = 'reportado';
  openModal('modal-mantenimiento');
}

// Equipos registrados del edificio elegido (si el SQL 32 aún no se ejecutó, queda solo "Otro").
let equiposTrabajo = [];
async function llenarEquiposTrabajo() {
  const sel = qs('#mt-equipo-id');
  sel.innerHTML = '<option value="">— Sin equipo —</option>';
  qs('#mt-equipo').style.display = 'none'; qs('#mt-equipo').value = '';
  const propiedadId = qs('#mt-propiedad').value;
  equiposTrabajo = [];
  if (propiedadId) { try { equiposTrabajo = (await listEquipos({ propiedadId })).filter((x) => x.estado !== 'dado_de_baja'); } catch { /* sin SQL 32 */ } }
  equiposTrabajo.forEach((x) => sel.append(el('option', { value: x.id }, `${x.nombre}${x.ubicacion ? ' — ' + x.ubicacion : ''}`)));
  sel.append(el('option', { value: '__otro' }, 'Otro (no registrado)…'));
}
function equipoDelFormulario() {
  const v = qs('#mt-equipo-id').value;
  if (v && v !== '__otro') return { equipo_id: v, equipo: equiposTrabajo.find((x) => x.id === v)?.nombre ?? null };
  return v === '__otro' ? { equipo: qs('#mt-equipo').value.trim() || null } : {};
}

async function handleDeleteMantenimiento(m) {
  if (!confirmAction(`¿Eliminar el trabajo "${m.titulo || m.descripcion}" con toda su bitácora, gastos y reparto? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteMantenimiento(m.id);
    showToast('Trabajo eliminado.', 'success');
    await renderMantenimientos();
  } catch (err) {
    console.error(err);
    showToast('No se pudo eliminar (si ya generó cuotas en Cobranzas, anúlalas primero).', 'error');
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


/* ================================== EQUIPOS ==================================== */
const ESTADOS_EQUIPO = { operativo: 'Operativo', en_mantenimiento: 'En mantenimiento', fuera_de_servicio: 'Fuera de servicio', dado_de_baja: 'Dado de baja' };
const sumarMeses = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };

async function renderEquipos() {
  const tbody = qs('#equipos-tbody');
  try {
    const propiedadId = qs('#filtro-eq-propiedad').value;
    const [equipos, trabajos] = await Promise.all([listEquipos({ propiedadId }), listMantenimientos({ propiedadId }).catch(() => [])]);
    tbody.innerHTML = '';
    if (!equipos.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '11' }, [el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '⚙️'), el('p', {}, 'Sin equipos registrados. Agrega las motobombas, tanques, tableros, etc. de cada edificio.')])])]));
      return;
    }
    const hoy = new Date().toISOString().slice(0, 10);
    equipos.forEach((eq) => {
      const t = trabajos.filter((x) => x.equipo_id === eq.id);
      const ultimo = t.map((x) => x.fecha_fin || x.fecha).sort().at(-1) ?? null;
      const proximo = eq.frecuencia_mant_meses ? sumarMeses(ultimo ?? eq.fecha_instalacion ?? hoy, eq.frecuencia_mant_meses) : null;
      const vencido = proximo && proximo < hoy;
      tbody.append(el('tr', {}, [
        el('td', {}, eq.propiedad?.nombre_referencial ?? '—'),
        el('td', {}, [el('div', { style: 'font-weight:600;' }, eq.nombre), eq.seccion?.nombre ? el('div', { style: 'font-size:11px; color:var(--gray-500);' }, eq.seccion.nombre) : null]),
        el('td', {}, eq.categoria || '—'),
        el('td', {}, eq.ubicacion || '—'),
        el('td', {}, [eq.marca, eq.modelo].filter(Boolean).join(' ') || '—'),
        el('td', {}, el('span', { class: `badge ${eq.estado === 'operativo' ? 'badge-disponible' : eq.estado === 'dado_de_baja' ? 'badge-inactivo' : 'badge-pendiente'}` }, ESTADOS_EQUIPO[eq.estado] ?? eq.estado)),
        el('td', {}, ultimo ? formatDate(ultimo) : '—'),
        el('td', {}, proximo ? el('span', { style: vencido ? 'color:var(--color-danger); font-weight:700;' : '', title: vencido ? 'Mantenimiento preventivo vencido' : '' }, formatDate(proximo)) : '—'),
        el('td', {}, String(t.length)),
        el('td', {}, formatCurrency(t.reduce((s, x) => s + Number(x.costo_total || 0), 0))),
        el('td', { class: 'actions' }, [
          el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => openEquipoModal(eq) }, 'Editar'),
          el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => handleDeleteEquipo(eq) }, '🗑️'),
        ]),
      ]));
    });
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '';
    tbody.append(el('tr', {}, [el('td', { colspan: '11', style: 'color:var(--gray-500);' }, 'No se pudo cargar. ¿Ejecutaste el SQL 32?')]));
  }
}

async function refreshSeccionesEquipo(seleccion = '') {
  const sel = qs('#eq-seccion');
  sel.innerHTML = '<option value="">Todo el edificio</option>';
  const propiedadId = qs('#eq-propiedad').value;
  if (!propiedadId) return;
  (await listSeccionesPorPropiedad(propiedadId)).forEach((x) => sel.append(el('option', { value: x.id }, x.nombre)));
  if (seleccion) sel.value = seleccion;
}

async function openEquipoModal(eq = null) {
  const form = qs('#form-equipo');
  form.reset();
  form.dataset.editingId = eq?.id ?? '';
  qs('#modal-equipo-title').textContent = eq ? 'Editar equipo' : 'Nuevo equipo';
  qs('#eq-propiedad').value = eq?.propiedad_id ?? qs('#filtro-eq-propiedad').value ?? '';
  await refreshSeccionesEquipo(eq?.seccion_id ?? '');
  qs('#eq-nombre').value = eq?.nombre ?? '';
  qs('#eq-categoria').value = eq?.categoria ?? '';
  qs('#eq-ubicacion').value = eq?.ubicacion ?? '';
  qs('#eq-marca').value = eq?.marca ?? '';
  qs('#eq-modelo').value = eq?.modelo ?? '';
  qs('#eq-serie').value = eq?.nro_serie ?? '';
  qs('#eq-estado').value = eq?.estado ?? 'operativo';
  qs('#eq-instalacion').value = eq?.fecha_instalacion ?? '';
  qs('#eq-garantia').value = eq?.garantia_hasta ?? '';
  qs('#eq-frecuencia').value = eq?.frecuencia_mant_meses ?? '';
  qs('#eq-notas').value = eq?.notas ?? '';
  openModal('modal-equipo');
}

async function handleDeleteEquipo(eq) {
  if (!confirmAction(`¿Eliminar el equipo "${eq.nombre}"? Los trabajos vinculados conservarán su nombre pero perderán el vínculo.`)) return;
  try { await deleteEquipo(eq.id); showToast('Equipo eliminado.', 'success'); await renderEquipos(); }
  catch (err) { console.error(err); showToast('No se pudo eliminar.', 'error'); }
}

function bindEquipos() {
  qs('#filtro-eq-propiedad')?.addEventListener('change', renderEquipos);
  qs('#btn-nuevo-equipo')?.addEventListener('click', () => openEquipoModal());
  qs('#eq-propiedad')?.addEventListener('change', () => refreshSeccionesEquipo());
  const form = qs('#form-equipo');
  form?.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const v = (id) => qs(id).value.trim() || null;
    const payload = {
      propiedad_id: qs('#eq-propiedad').value, seccion_id: qs('#eq-seccion').value || null, nombre: qs('#eq-nombre').value.trim(),
      categoria: v('#eq-categoria'), ubicacion: v('#eq-ubicacion'), marca: v('#eq-marca'), modelo: v('#eq-modelo'), nro_serie: v('#eq-serie'),
      estado: qs('#eq-estado').value, fecha_instalacion: qs('#eq-instalacion').value || null, garantia_hasta: qs('#eq-garantia').value || null,
      frecuencia_mant_meses: qs('#eq-frecuencia').value ? Number(qs('#eq-frecuencia').value) : null, notas: v('#eq-notas'),
    };
    const btn = qs('#btn-guardar-equipo');
    setLoading(btn, true);
    try {
      await saveEquipo(payload, form.dataset.editingId);
      closeModal('modal-equipo');
      showToast('Equipo guardado.', 'success');
      await renderEquipos();
    } catch (err) { console.error(err); showToast('No se pudo guardar. ¿Ejecutaste el SQL 32?', 'error'); } finally { setLoading(btn, false); }
  });
}
