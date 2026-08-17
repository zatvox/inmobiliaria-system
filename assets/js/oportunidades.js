/**
 * oportunidades.js — Módulo Oportunidades (Fase 4): embudo comercial de
 * venta y alquiler (prospecto -> visita agendada -> negociación ->
 * separación -> firma de contrato -> cerrado / perdido). Al cerrar una
 * oportunidad se puede vincular al contrato real ya creado en Contratos.
 */
import { initShell } from './main.js';
import {
  listOportunidades, getOportunidad, createOportunidad, updateOportunidad, deleteOportunidad,
  listSeccionesDisponibles, listPersonas, getCatalogo,
} from './supabase-data.js';
import { qs, qsa, el, formatDate, badgeHtml, showToast, openModal, closeModal, validateForm, setLoading, confirmAction, debounce } from './utils.js';
import { isAdmin } from './auth.js';

let profile = null;
let activeTipo = 'venta';

const ETAPA_ORDEN = ['prospecto', 'visita_agendada', 'negociacion', 'separacion', 'firma_contrato', 'cerrado', 'perdido'];

async function main() {
  profile = await initShell('oportunidades');
  if (!profile) return;

  bindTabs();
  bindToolbar();
  bindForm();
  await refresh();
}

function bindTabs() {
  qsa('.tab-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTipo = btn.dataset.tab;
      qsa('.tab-btn[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      refresh();
    });
  });
}

function bindToolbar() {
  qs('#btn-nueva-oportunidad')?.addEventListener('click', () => openModalOportunidad());
  qs('#search-input')?.addEventListener('input', debounce(refresh, 350));
  qs('#filter-etapa')?.addEventListener('change', refresh);
}

async function refresh() {
  const tbody = qs('#oportunidades-tbody');
  const search = qs('#search-input')?.value ?? '';
  const etapa = qs('#filter-etapa')?.value ?? '';
  try {
    const oportunidades = await listOportunidades({ tipoOperacion: activeTipo, etapa, search });
    tbody.innerHTML = '';
    if (!oportunidades.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '6' }, [
        el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '🎯'), el('p', {}, 'Sin oportunidades registradas todavía.')]),
      ])]));
      return;
    }
    oportunidades.forEach((o) => tbody.append(renderRow(o)));
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar las oportunidades.', 'error');
  }
}

function renderRow(o) {
  const inmueble = o.seccion ? `${o.seccion.propiedades?.nombre_referencial ?? ''} · ${o.seccion.nombre}` : '—';
  const etapaSelect = el('select', { style: 'font-size:12px; padding:4px 6px;', onchange: (evt) => cambiarEtapa(o, evt.target.value) },
    ETAPA_ORDEN.map((et) => el('option', { value: et, ...(et === o.etapa ? { selected: '' } : {}) }, ETAPA_LABEL(et))));
  return el('tr', {}, [
    el('td', {}, [el('div', { style: 'font-weight:600;' }, o.persona?.nombre ?? '—'), o.persona?.telefono ? el('div', { style: 'font-size:12px; color:var(--gray-500);' }, o.persona.telefono) : null]),
    el('td', {}, inmueble),
    el('td', {}, o.fuente || '—'),
    el('td', {}, isAdmin(profile) ? etapaSelect : el('span', { html: badgeHtml(o.etapa) })),
    el('td', {}, formatDate(o.updated_at)),
    el('td', { class: 'actions' }, [
      el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => editOportunidad(o.id) }, 'Editar'),
      el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => handleDelete(o) }, '🗑️'),
    ]),
  ]);
}

function ETAPA_LABEL(et) {
  const labels = {
    prospecto: 'Prospecto', visita_agendada: 'Visita agendada', negociacion: 'Negociación',
    separacion: 'Separación', firma_contrato: 'Firma de contrato', cerrado: 'Cerrado', perdido: 'Perdido',
  };
  return labels[et] ?? et;
}

async function cambiarEtapa(o, nuevaEtapa) {
  try {
    const payload = { etapa: nuevaEtapa };
    if (nuevaEtapa === 'perdido' && !o.motivo_perdida) {
      const motivo = window.prompt('¿Motivo de la pérdida? (opcional)');
      if (motivo) payload.motivo_perdida = motivo;
    }
    await updateOportunidad(o.id, payload);
    showToast('Etapa actualizada.', 'success');
    await refresh();
  } catch (err) {
    console.error(err);
    showToast('No se pudo actualizar la etapa.', 'error');
  }
}

async function editOportunidad(id) {
  try {
    const o = await getOportunidad(id);
    openModalOportunidad(o);
  } catch (err) {
    console.error(err);
    showToast('No se pudo cargar la oportunidad.', 'error');
  }
}

async function openModalOportunidad(oportunidad = null) {
  const form = qs('#form-oportunidad');
  form.reset();
  qsa('.form-field', form).forEach((f) => f.classList.remove('invalid'));
  form.dataset.editingId = oportunidad?.id ?? '';
  qs('#modal-oportunidad-title').textContent = oportunidad ? 'Editar oportunidad' : 'Nueva oportunidad';

  const tipoOperacion = oportunidad?.tipo_operacion ?? activeTipo;
  qs('#op-tipo-operacion').value = tipoOperacion;

  const [secciones, personas, fuentes] = await Promise.all([
    listSeccionesDisponibles({ paraVenta: tipoOperacion === 'venta' }),
    listPersonas({}),
    getCatalogo('fuente_lead'),
  ]);

  const seccionSelect = qs('#op-seccion');
  seccionSelect.innerHTML = '<option value="">Sin sección específica</option>';
  const opciones = [...secciones];
  if (oportunidad?.seccion && !opciones.some((s) => s.id === oportunidad.seccion.id)) {
    opciones.unshift({ id: oportunidad.seccion.id, nombre: oportunidad.seccion.nombre, propiedades: oportunidad.seccion.propiedades });
  }
  opciones.forEach((s) => seccionSelect.append(el('option', { value: s.id }, `${s.propiedades?.nombre_referencial ?? ''} · ${s.nombre}`)));

  const personaSelect = qs('#op-persona');
  personaSelect.innerHTML = '<option value="">Selecciona…</option>';
  personas.forEach((p) => personaSelect.append(el('option', { value: p.id }, p.nombre)));

  const fuenteSelect = qs('#op-fuente');
  fuenteSelect.innerHTML = '<option value="">Sin especificar</option>';
  fuentes.forEach((f) => fuenteSelect.append(el('option', { value: f.valor }, f.valor)));

  const etapaSelect = qs('#op-etapa');
  etapaSelect.innerHTML = '';
  ETAPA_ORDEN.forEach((et) => etapaSelect.append(el('option', { value: et }, ETAPA_LABEL(et))));

  if (oportunidad) {
    seccionSelect.value = oportunidad.seccion_id ?? '';
    personaSelect.value = oportunidad.persona_id;
    fuenteSelect.value = oportunidad.fuente ?? '';
    etapaSelect.value = oportunidad.etapa;
    qs('#op-notas').value = oportunidad.notas ?? '';
    qs('#op-motivo-perdida').value = oportunidad.motivo_perdida ?? '';
  } else {
    etapaSelect.value = 'prospecto';
  }
  toggleMotivoPerdida();
  openModal('modal-oportunidad');
}

function toggleMotivoPerdida() {
  qs('#op-motivo-perdida-field').style.display = qs('#op-etapa').value === 'perdido' ? 'block' : 'none';
}

function bindForm() {
  qs('#op-tipo-operacion')?.addEventListener('change', () => openModalOportunidad({ tipo_operacion: qs('#op-tipo-operacion').value }));
  qs('#op-etapa')?.addEventListener('change', toggleMotivoPerdida);

  const form = qs('#form-oportunidad');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const payload = {
      tipo_operacion: qs('#op-tipo-operacion').value,
      seccion_id: qs('#op-seccion').value || null,
      persona_id: qs('#op-persona').value,
      fuente: qs('#op-fuente').value || null,
      etapa: qs('#op-etapa').value,
      motivo_perdida: qs('#op-etapa').value === 'perdido' ? (qs('#op-motivo-perdida').value || null) : null,
      notas: qs('#op-notas').value || null,
    };
    const btn = qs('#btn-guardar-oportunidad');
    setLoading(btn, true);
    try {
      const editingId = form.dataset.editingId;
      if (editingId) {
        await updateOportunidad(editingId, payload);
        showToast('Oportunidad actualizada.', 'success');
      } else {
        await createOportunidad(payload);
        showToast('Oportunidad creada.', 'success');
      }
      closeModal('modal-oportunidad');
      await refresh();
    } catch (err) {
      console.error(err);
      showToast('No se pudo guardar la oportunidad.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

async function handleDelete(o) {
  if (!confirmAction(`¿Eliminar la oportunidad de "${o.persona?.nombre ?? 'esta persona'}"? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteOportunidad(o.id);
    showToast('Oportunidad eliminada.', 'success');
    await refresh();
  } catch (err) {
    console.error(err);
    showToast('No se pudo eliminar.', 'error');
  }
}

main();
