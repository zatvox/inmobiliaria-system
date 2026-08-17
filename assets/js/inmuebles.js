/**
 * inmuebles.js — Lógica del módulo Inmuebles + Secciones (Fase 1).
 */
import { initShell } from './main.js';
import {
  listPropiedades, getPropiedad, createPropiedad, updatePropiedad, deletePropiedad,
  createSeccion, updateSeccion, deleteSeccion,
  addPropiedadFoto, removePropiedadFoto,
  listPersonas, getCatalogo, uploadArchivo, getSignedUrl, removeArchivo,
} from './supabase-data.js';
import {
  qs, qsa, el, showToast, openModal, closeModal, validateForm, setLoading,
  confirmAction, badgeHtml, formatCurrency, debounce,
} from './utils.js';

let profile = null;
let currentPropiedadId = null;
let editingSeccionId = null;

async function main() {
  profile = await initShell('inmuebles');
  if (!profile) return;

  await loadCatalogosEnFormulario();

  bindListView();
  bindPropiedadForm();
  bindSeccionForm();
  bindTabs();
  bindFotos();

  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');
  if (idParam) {
    await showDetail(idParam);
  } else {
    await renderList();
  }
}

/* ============================== CATÁLOGOS EN FORM ============================ */
async function loadCatalogosEnFormulario() {
  try {
    const [tipos, distritos, propietarios] = await Promise.all([
      getCatalogo('tipo_propiedad'),
      getCatalogo('distrito'),
      listPersonas({ rol: 'propietario' }),
    ]);
    const tipoSelect = qs('#p-tipo');
    tipos.forEach((t) => tipoSelect.append(el('option', { value: t.valor }, t.valor)));

    const distritoSelect = qs('#p-distrito');
    distritos.forEach((d) => distritoSelect.append(el('option', { value: d.valor }, d.valor)));

    const propietarioSelect = qs('#p-propietario');
    propietarios.forEach((per) => propietarioSelect.append(el('option', { value: per.id }, per.nombre)));
  } catch (err) {
    console.error('Error cargando catálogos:', err);
  }
}

/* ================================ VISTA LISTA ================================= */
function bindListView() {
  qs('#btn-nueva-propiedad')?.addEventListener('click', () => openPropiedadModal());
  qs('#search-input')?.addEventListener('input', debounce((evt) => renderList(evt.target.value), 350));
}

async function renderList(search = '') {
  const grid = qs('#propiedades-grid');
  try {
    const propiedades = await listPropiedades({ search });
    grid.innerHTML = '';
    if (!propiedades.length) {
      grid.innerHTML = '';
      grid.style.display = 'block';
      grid.append(el('div', { class: 'empty-state' }, [
        el('div', { class: 'icon' }, '🏢'),
        el('p', {}, search ? 'No se encontraron inmuebles con ese criterio.' : 'Aún no has registrado ningún inmueble.'),
        !search ? el('button', { class: 'btn btn-primary', onclick: () => openPropiedadModal() }, '+ Registrar el primero') : null,
      ]));
      return;
    }
    grid.style.display = 'grid';
    propiedades.forEach((p) => grid.append(renderPropiedadCard(p)));
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar los inmuebles. Revisa la conexión con Supabase.', 'error');
  }
}

function renderPropiedadCard(p) {
  const secciones = p.secciones ?? [];
  const ocupadas = secciones.filter((s) => s.estado === 'alquilado' || s.estado === 'vendido').length;
  const thumb = el('div', { class: 'thumb' }, p.tipo === 'Terreno / Lotes' ? '🗺️' : '🏢');
  const card = el('div', { class: 'property-card', onclick: () => { window.history.pushState({}, '', `?id=${p.id}`); showDetail(p.id); } }, [
    thumb,
    el('div', { class: 'body' }, [
      el('h4', {}, p.nombre_referencial),
      el('div', { class: 'addr' }, [p.direccion, p.distrito].filter(Boolean).join(' · ')),
      el('div', { class: 'meta-row' }, [
        el('span', { class: 'secciones-count' }, `${secciones.length} sección${secciones.length === 1 ? '' : 'es'} · ${ocupadas} ocupada${ocupadas === 1 ? '' : 's'}`),
        el('span', { class: 'badge badge-neutral' }, p.tipo || 'Sin tipo'),
      ]),
    ]),
  ]);

  // Si el inmueble ya tiene fotos, muestra la de fachada (la primera según
  // orden) en miniatura en vez del ícono genérico. La URL firmada se resuelve
  // de forma asíncrona sin bloquear el render de la tarjeta.
  const fotos = (p.propiedades_fotos ?? []).slice().sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  if (fotos.length) {
    getSignedUrl(fotos[0].url_storage)
      .then((url) => {
        if (!url) return;
        thumb.innerHTML = '';
        thumb.append(el('img', { src: url, alt: `Fachada de ${p.nombre_referencial}`, loading: 'lazy' }));
      })
      .catch((err) => console.error('No se pudo cargar la foto de fachada:', err));
  }
  return card;
}

function openPropiedadModal(propiedad = null) {
  const form = qs('#form-propiedad');
  form.reset();
  qsa('.form-field', form).forEach((f) => f.classList.remove('invalid'));
  qs('#modal-propiedad-title').textContent = propiedad ? 'Editar propiedad' : 'Nueva propiedad';
  form.dataset.editingId = propiedad?.id ?? '';
  if (propiedad) {
    qs('#p-nombre').value = propiedad.nombre_referencial ?? '';
    qs('#p-direccion').value = propiedad.direccion ?? '';
    qs('#p-tipo').value = propiedad.tipo ?? '';
    qs('#p-distrito').value = propiedad.distrito ?? '';
    qs('#p-zona').value = propiedad.zona ?? '';
    qs('#p-npisos').value = propiedad.n_pisos ?? '';
    qs('#p-area-terreno').value = propiedad.area_terreno_m2 ?? '';
    qs('#p-area-construida').value = propiedad.area_construida_m2 ?? '';
    qs('#p-anio').value = propiedad.anio_construccion ?? '';
    qs('#p-partida').value = propiedad.partida_registral ?? '';
    qs('#p-propietario').value = propiedad.propietario_id ?? propiedad.propietario?.id ?? '';
    qs('#p-notas').value = propiedad.notas ?? '';
  }
  openModal('modal-propiedad');
}

function bindPropiedadForm() {
  const form = qs('#form-propiedad');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const payload = {
      nombre_referencial: qs('#p-nombre').value.trim(),
      direccion: qs('#p-direccion').value.trim(),
      tipo: qs('#p-tipo').value || null,
      distrito: qs('#p-distrito').value || null,
      zona: qs('#p-zona').value || null,
      n_pisos: qs('#p-npisos').value ? Number(qs('#p-npisos').value) : null,
      area_terreno_m2: qs('#p-area-terreno').value ? Number(qs('#p-area-terreno').value) : null,
      area_construida_m2: qs('#p-area-construida').value ? Number(qs('#p-area-construida').value) : null,
      anio_construccion: qs('#p-anio').value ? Number(qs('#p-anio').value) : null,
      partida_registral: qs('#p-partida').value || null,
      propietario_id: qs('#p-propietario').value || null,
      notas: qs('#p-notas').value || null,
    };
    const btn = qs('#btn-guardar-propiedad');
    setLoading(btn, true);
    try {
      const editingId = form.dataset.editingId;
      if (editingId) {
        await updatePropiedad(editingId, payload);
        showToast('Propiedad actualizada.', 'success');
      } else {
        const created = await createPropiedad(payload);
        showToast('Propiedad creada. Ahora agrega sus secciones.', 'success');
        closeModal('modal-propiedad');
        window.history.pushState({}, '', `?id=${created.id}`);
        await showDetail(created.id);
        return;
      }
      closeModal('modal-propiedad');
      if (currentPropiedadId === editingId) await showDetail(editingId);
      else await renderList();
    } catch (err) {
      console.error(err);
      showToast('No se pudo guardar la propiedad.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

/* ================================ VISTA DETALLE ================================ */
async function showDetail(id) {
  currentPropiedadId = id;
  qs('#view-list').style.display = 'none';
  qs('#view-detail').style.display = 'block';
  try {
    const p = await getPropiedad(id);
    renderDetailHeader(p);
    renderSecciones(p.secciones ?? []);
    renderFotos(p.propiedades_fotos ?? []);
  } catch (err) {
    console.error(err);
    showToast('No se pudo cargar el detalle del inmueble.', 'error');
  }
}

function renderDetailHeader(p) {
  qs('#detail-nombre').textContent = p.nombre_referencial;
  qs('#detail-direccion').textContent = [p.direccion, p.distrito].filter(Boolean).join(' · ');

  const rows = [
    ['Tipo', p.tipo || '—'],
    ['N° de pisos', p.n_pisos ?? '—'],
    ['Área de terreno', p.area_terreno_m2 ? `${p.area_terreno_m2} m²` : '—'],
    ['Área construida', p.area_construida_m2 ? `${p.area_construida_m2} m²` : '—'],
    ['Año de construcción', p.anio_construccion ?? '—'],
    ['Partida registral', p.partida_registral || '—'],
    ['Propietario', p.propietario?.nombre || '—'],
  ];
  const info = qs('#detail-info-card');
  info.innerHTML = '';
  const grid = el('div', { class: 'form-grid' });
  rows.forEach(([label, value]) => {
    grid.append(el('div', {}, [
      el('div', { style: 'font-size:12px; color:var(--gray-500); font-weight:600;' }, label),
      el('div', { style: 'font-size:15px;' }, String(value)),
    ]));
  });
  info.append(grid);
  if (p.notas) {
    info.append(el('div', { style: 'margin-top:12px; padding:12px; background:var(--color-warning-bg); border-radius:8px; font-size:13px; color:var(--gray-700);' }, `📝 ${p.notas}`));
  }

  qs('#btn-editar-propiedad').onclick = () => openPropiedadModal(p);
  qs('#btn-eliminar-propiedad').onclick = async () => {
    if (!confirmAction(`¿Eliminar "${p.nombre_referencial}" y todas sus secciones? Esta acción no se puede deshacer.`)) return;
    try {
      await deletePropiedad(p.id);
      showToast('Propiedad eliminada.', 'success');
      backToList();
    } catch (err) {
      console.error(err);
      showToast('No se pudo eliminar. Verifica que no tenga contratos asociados.', 'error');
    }
  };
}

function backToList() {
  currentPropiedadId = null;
  window.history.pushState({}, '', window.location.pathname);
  qs('#view-detail').style.display = 'none';
  qs('#view-list').style.display = 'block';
  renderList(qs('#search-input').value);
}

qs('#back-to-list')?.addEventListener('click', (evt) => { evt.preventDefault(); backToList(); });
window.addEventListener('popstate', () => {
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');
  if (idParam) showDetail(idParam); else backToList();
});

/* ================================== TABS ==================================== */
function bindTabs() {
  qsa('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      qsa('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      qs('#tab-secciones').style.display = btn.dataset.tab === 'secciones' ? 'block' : 'none';
      qs('#tab-fotos').style.display = btn.dataset.tab === 'fotos' ? 'block' : 'none';
    });
  });
}

/* ================================ SECCIONES ================================== */
function renderSecciones(secciones) {
  const list = qs('#secciones-list');
  list.innerHTML = '';
  if (!secciones.length) {
    list.append(el('div', { class: 'empty-state' }, [
      el('div', { class: 'icon' }, '📐'),
      el('p', {}, 'Este inmueble aún no tiene secciones registradas.'),
    ]));
    return;
  }
  secciones.forEach((s) => {
    const precio = s.estado === 'vendido' || s.precio_venta ? s.precio_venta : s.precio_alquiler_referencial;
    const precioLabel = precio ? formatCurrency(precio) + (s.precio_alquiler_referencial && s.estado !== 'vendido' ? '/mes' : '') : 'Sin precio';
    const flags = el('div', { class: 'meter-flags' }, [
      el('span', { class: `meter-flag ${s.tiene_medidor_propio_luz ? 'on' : ''}` }, '⚡ Luz'),
      el('span', { class: `meter-flag ${s.tiene_medidor_propio_agua ? 'on' : ''}` }, '💧 Agua'),
    ]);
    const item = el('div', { class: 'seccion-item' }, [
      el('div', { class: 'seccion-info' }, [
        el('strong', {}, s.nombre),
        el('span', {}, `${s.tipo_seccion} · ${precioLabel}${s.area_m2 ? ' · ' + s.area_m2 + ' m²' : ''}`),
        (s.partida_registral || s.codigo_pu_hr) ? el('span', { style: 'color:var(--gray-500); font-size:12px;' }, s.partida_registral ? `📋 Partida ${s.partida_registral}` : `📋 PU/HR ${s.codigo_pu_hr}`) : null,
        s.notas ? el('span', { style: 'color:var(--color-warning);' }, `📝 ${s.notas}`) : null,
      ]),
      el('div', { class: 'seccion-actions' }, [
        flags,
        el('span', { html: badgeHtml(s.estado) }),
        el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => openSeccionModal(s) }, 'Editar'),
        el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => handleDeleteSeccion(s) }, '🗑️'),
      ]),
    ]);
    list.append(item);
  });
  if (!isAdminNow()) qsa('[data-admin-only]', list).forEach((n) => n.remove());
}

function isAdminNow() { return profile?.rol === 'administrador'; }

function openSeccionModal(seccion = null) {
  const form = qs('#form-seccion');
  form.reset();
  qsa('.form-field', form).forEach((f) => f.classList.remove('invalid'));
  editingSeccionId = seccion?.id ?? null;
  qs('#modal-seccion-title').textContent = seccion ? 'Editar sección' : 'Nueva sección';
  if (seccion) {
    qs('#s-nombre').value = seccion.nombre ?? '';
    qs('#s-tipo').value = seccion.tipo_seccion ?? '';
    qs('#s-estado').value = seccion.estado ?? 'disponible';
    qs('#s-area').value = seccion.area_m2 ?? '';
    qs('#s-habitaciones').value = seccion.habitaciones ?? '';
    qs('#s-banos').value = seccion.banos ?? '';
    qs('#s-cocheras').value = seccion.cocheras ?? '';
    qs('#s-precio-alquiler').value = seccion.precio_alquiler_referencial ?? '';
    qs('#s-precio-venta').value = seccion.precio_venta ?? '';
    qs('#s-medidor-luz').checked = !!seccion.tiene_medidor_propio_luz;
    qs('#s-medidor-agua').checked = !!seccion.tiene_medidor_propio_agua;
    qs('#s-partida-registral').value = seccion.partida_registral ?? '';
    qs('#s-pu-hr').value = seccion.codigo_pu_hr ?? '';
    qs('#s-notas').value = seccion.notas ?? '';
  }
  openModal('modal-seccion');
}

function bindSeccionForm() {
  qs('#btn-nueva-seccion')?.addEventListener('click', () => openSeccionModal());
  const form = qs('#form-seccion');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const payload = {
      propiedad_id: currentPropiedadId,
      nombre: qs('#s-nombre').value.trim(),
      tipo_seccion: qs('#s-tipo').value,
      estado: qs('#s-estado').value,
      area_m2: qs('#s-area').value ? Number(qs('#s-area').value) : null,
      habitaciones: qs('#s-habitaciones').value ? Number(qs('#s-habitaciones').value) : null,
      banos: qs('#s-banos').value ? Number(qs('#s-banos').value) : null,
      cocheras: qs('#s-cocheras').value ? Number(qs('#s-cocheras').value) : null,
      precio_alquiler_referencial: qs('#s-precio-alquiler').value ? Number(qs('#s-precio-alquiler').value) : null,
      precio_venta: qs('#s-precio-venta').value ? Number(qs('#s-precio-venta').value) : null,
      tiene_medidor_propio_luz: qs('#s-medidor-luz').checked,
      tiene_medidor_propio_agua: qs('#s-medidor-agua').checked,
      partida_registral: qs('#s-partida-registral').value || null,
      codigo_pu_hr: qs('#s-pu-hr').value || null,
      notas: qs('#s-notas').value || null,
    };
    const btn = qs('#btn-guardar-seccion');
    setLoading(btn, true);
    try {
      if (editingSeccionId) {
        delete payload.propiedad_id;
        await updateSeccion(editingSeccionId, payload);
        showToast('Sección actualizada.', 'success');
      } else {
        await createSeccion(payload);
        showToast('Sección creada.', 'success');
      }
      closeModal('modal-seccion');
      await showDetail(currentPropiedadId);
    } catch (err) {
      console.error(err);
      showToast('No se pudo guardar la sección.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

async function handleDeleteSeccion(seccion) {
  if (!confirmAction(`¿Eliminar la sección "${seccion.nombre}"? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteSeccion(seccion.id);
    showToast('Sección eliminada.', 'success');
    await showDetail(currentPropiedadId);
  } catch (err) {
    console.error(err);
    showToast('No se pudo eliminar. Verifica que no tenga contratos asociados.', 'error');
  }
}

/* ================================== FOTOS ==================================== */
function bindFotos() {
  const dropzone = qs('#foto-dropzone');
  const input = qs('#foto-input');
  dropzone?.addEventListener('click', () => input.click());
  dropzone?.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone?.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    await handleFotoFiles(e.dataTransfer.files);
  });
  input?.addEventListener('change', async (e) => {
    await handleFotoFiles(e.target.files);
    input.value = '';
  });
}

async function handleFotoFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length || !currentPropiedadId) return;
  for (const file of files) {
    try {
      const path = await uploadArchivo(file, `propiedades/${currentPropiedadId}`);
      await addPropiedadFoto(currentPropiedadId, path, file.name);
    } catch (err) {
      console.error(err);
      showToast(`No se pudo subir "${file.name}".`, 'error');
    }
  }
  showToast('Fotos subidas.', 'success');
  const p = await getPropiedad(currentPropiedadId);
  renderFotos(p.propiedades_fotos ?? []);
}

async function renderFotos(fotos) {
  const grid = qs('#fotos-grid');
  grid.innerHTML = '';
  if (!fotos.length) {
    grid.append(el('div', { class: 'empty-state', style: 'grid-column:1/-1;' }, [
      el('div', { class: 'icon' }, '🖼️'),
      el('p', {}, 'Sin fotos todavía.'),
    ]));
    return;
  }
  for (const foto of fotos) {
    const thumb = el('div', { class: 'photo-thumb' });
    grid.append(thumb);
    try {
      const url = await getSignedUrl(foto.url_storage);
      thumb.append(el('img', { src: url, alt: foto.descripcion || 'Foto del inmueble', loading: 'lazy' }));
    } catch {
      thumb.style.display = 'flex'; thumb.style.alignItems = 'center'; thumb.style.justifyContent = 'center';
      thumb.textContent = '⚠️';
    }
    if (isAdminNow()) {
      const removeBtn = el('button', {
        class: 'remove-photo', 'aria-label': 'Eliminar foto',
        onclick: async () => {
          if (!confirmAction('¿Eliminar esta foto?')) return;
          try {
            await removeArchivo(foto.url_storage);
            await removePropiedadFoto(foto.id);
            const p = await getPropiedad(currentPropiedadId);
            renderFotos(p.propiedades_fotos ?? []);
          } catch (err) {
            console.error(err);
            showToast('No se pudo eliminar la foto.', 'error');
          }
        },
      }, '×');
      thumb.append(removeBtn);
    }
  }
}

main();
