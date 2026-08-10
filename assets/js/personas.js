/**
 * personas.js — Lógica del módulo Personas (Fase 1).
 */
import { initShell } from './main.js';
import { listPersonas, getPersona, createPersona, updatePersona, deletePersona } from './supabase-data.js';
import { qs, qsa, el, showToast, openModal, closeModal, validateForm, setLoading, confirmAction, debounce } from './utils.js';

let profile = null;

const ROL_LABELS = {
  propietario: 'Propietario', inquilino: 'Inquilino', comprador: 'Comprador',
  agente: 'Agente', lead: 'Lead', proveedor: 'Proveedor', aval: 'Aval',
};

async function main() {
  profile = await initShell('personas');
  if (!profile) return;

  bindSearchAndFilter();
  bindPersonaForm();
  await renderTable();
}

function bindSearchAndFilter() {
  qs('#btn-nueva-persona')?.addEventListener('click', () => openPersonaModal());
  qs('#search-input')?.addEventListener('input', debounce(refresh, 350));
  qs('#filter-rol')?.addEventListener('change', refresh);
}

function refresh() {
  renderTable(qs('#search-input').value, qs('#filter-rol').value);
}

async function renderTable(search = '', rol = '') {
  const tbody = qs('#personas-tbody');
  try {
    const personas = await listPersonas({ search, rol });
    tbody.innerHTML = '';
    if (!personas.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '5' }, [
        el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '👤'), el('p', {}, 'No se encontraron personas.')]),
      ])]));
      return;
    }
    personas.forEach((p) => tbody.append(renderRow(p)));
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar las personas.', 'error');
  }
}

function renderRow(p) {
  const roles = (p.personas_roles ?? []).map((r) => el('span', { class: 'badge badge-neutral', style: 'margin-right:4px;' }, ROL_LABELS[r.rol] ?? r.rol));
  const contacto = [p.telefono, p.email].filter(Boolean).join(' · ') || '—';
  const docLabel = p.dni_ruc ? `${p.tipo_documento ?? ''} ${p.dni_ruc}`.trim() : '—';
  return el('tr', {}, [
    el('td', {}, [
      el('div', { style: 'font-weight:600;' }, p.nombre),
      p.notas ? el('div', { style: 'font-size:12px; color:var(--color-warning);' }, `📝 ${p.notas}`) : null,
    ]),
    el('td', {}, docLabel),
    el('td', {}, contacto),
    el('td', {}, roles.length ? roles : '—'),
    el('td', { class: 'actions' }, [
      el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => editPersona(p.id) }, 'Editar'),
      el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => handleDelete(p) }, '🗑️'),
    ]),
  ]);
}

async function editPersona(id) {
  try {
    const persona = await getPersona(id);
    openPersonaModal(persona);
  } catch (err) {
    console.error(err);
    showToast('No se pudo cargar la persona.', 'error');
  }
}

function openPersonaModal(persona = null) {
  const form = qs('#form-persona');
  form.reset();
  qsa('.form-field', form).forEach((f) => f.classList.remove('invalid'));
  qs('#roles-hint').style.display = 'none';
  qs('#modal-persona-title').textContent = persona ? 'Editar persona' : 'Nueva persona';
  form.dataset.editingId = persona?.id ?? '';
  qsa('.rol-check').forEach((cb) => { cb.checked = false; });
  if (persona) {
    qs('#pe-nombre').value = persona.nombre ?? '';
    qs('#pe-tipo-doc').value = persona.tipo_documento ?? '';
    qs('#pe-doc').value = persona.dni_ruc ?? '';
    qs('#pe-telefono').value = persona.telefono ?? '';
    qs('#pe-email').value = persona.email ?? '';
    qs('#pe-direccion').value = persona.direccion ?? '';
    qs('#pe-notas').value = persona.notas ?? '';
    const roles = (persona.personas_roles ?? []).map((r) => r.rol);
    qsa('.rol-check').forEach((cb) => { cb.checked = roles.includes(cb.value); });
  }
  openModal('modal-persona');
}

function bindPersonaForm() {
  const form = qs('#form-persona');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const roles = qsa('.rol-check').filter((cb) => cb.checked).map((cb) => cb.value);
    if (!roles.length) {
      qs('#roles-hint').style.display = 'block';
      return;
    }
    qs('#roles-hint').style.display = 'none';

    const payload = {
      nombre: qs('#pe-nombre').value.trim(),
      tipo_documento: qs('#pe-tipo-doc').value || null,
      dni_ruc: qs('#pe-doc').value || null,
      telefono: qs('#pe-telefono').value || null,
      email: qs('#pe-email').value || null,
      direccion: qs('#pe-direccion').value || null,
      notas: qs('#pe-notas').value || null,
    };
    const btn = qs('#btn-guardar-persona');
    setLoading(btn, true);
    try {
      const editingId = form.dataset.editingId;
      if (editingId) {
        await updatePersona(editingId, payload, roles);
        showToast('Persona actualizada.', 'success');
      } else {
        await createPersona(payload, roles);
        showToast('Persona creada.', 'success');
      }
      closeModal('modal-persona');
      await refresh();
    } catch (err) {
      console.error(err);
      showToast('No se pudo guardar la persona.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

async function handleDelete(persona) {
  if (!confirmAction(`¿Eliminar a "${persona.nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    await deletePersona(persona.id);
    showToast('Persona eliminada.', 'success');
    await refresh();
  } catch (err) {
    console.error(err);
    showToast('No se pudo eliminar. Verifica que no esté asociada a un contrato o propiedad.', 'error');
  }
}

main();
