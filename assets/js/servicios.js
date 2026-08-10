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
  listLecturas, getUltimaLectura, createLectura,
  listRecibosGenerales, createReciboGeneral, updateReciboGeneral,
  calcularPeriodoServicio, uploadArchivo, getSignedUrl,
} from './supabase-data.js';
import { qs, qsa, el, formatCurrency, formatDate, formatNumber, badgeHtml, showToast, openModal, closeModal, validateForm, setLoading, confirmAction } from './utils.js';

let activeTab = 'medidores';
let propiedadesCache = [];
let tiposServicioCache = [];

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
  bindCalculo();

  await renderMedidores();
}

const SELECTS_OBLIGATORIOS = new Set(['me-propiedad', 're-propiedad', 'ca-propiedad']);
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
      if (activeTab === 'lecturas') await renderLecturas();
      if (activeTab === 'recibos') await renderRecibos();
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
  toggleMedidorDueno();
  await refreshSeccionesMedidor();
  if (medidor) {
    qs('#me-seccion').value = medidor.seccion_id ?? '';
    qs('#me-tipo-servicio').value = medidor.tipo_servicio_id ?? '';
    qs('#me-codigo').value = medidor.codigo_medidor ?? '';
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

document.addEventListener('DOMContentLoaded', () => {
  qs('#me-propiedad')?.addEventListener('change', refreshSeccionesMedidor);
});

/* ================================= LECTURAS =================================== */
async function renderLecturas() {
  const tbody = qs('#lecturas-tbody');
  try {
    await fillMedidorSelect();
    const lecturas = await listLecturas({ medidorId: qs('#filtro-lectura-medidor').value, periodo: qs('#filtro-lectura-periodo').value });
    tbody.innerHTML = '';
    if (!lecturas.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '7' }, [el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '📊'), el('p', {}, 'Sin lecturas registradas.')])])]));
      return;
    }
    lecturas.forEach((l) => tbody.append(el('tr', {}, [
      el('td', {}, `${l.medidor?.propiedad?.nombre_referencial ?? ''} ${l.medidor?.seccion?.nombre ? '· ' + l.medidor.seccion.nombre : '(general)'}`),
      el('td', {}, l.medidor?.tipo_servicio?.nombre ?? '—'),
      el('td', {}, l.periodo),
      el('td', {}, formatNumber(l.lectura_anterior ?? 0, 3)),
      el('td', {}, formatNumber(l.lectura_actual, 3)),
      el('td', {}, `${formatNumber(l.consumo_calculado, 3)} ${l.medidor?.tipo_servicio?.unidad_medida ?? ''}`),
      el('td', {}, l.foto_url ? el('a', { href: '#', onclick: async (evt) => { evt.preventDefault(); window.open(await getSignedUrl(l.foto_url), '_blank'); } }, '📷 Ver foto') : '—'),
    ])));
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar las lecturas.', 'error');
  }
}

async function fillMedidorSelect() {
  const propiedadId = qs('#filtro-lectura-propiedad')?.value ?? '';
  const medidores = await listMedidores({ propiedadId });
  const select = qs('#filtro-lectura-medidor');
  const leSelect = qs('#le-medidor');
  [select, leSelect].forEach((sel) => {
    if (!sel) return;
    const keepFirst = sel === select;
    sel.innerHTML = keepFirst ? '<option value="">Todos los medidores</option>' : '<option value="">Selecciona…</option>';
    medidores.forEach((m) => sel.append(el('option', { value: m.id }, `${m.propiedad?.nombre_referencial ?? ''} ${m.seccion?.nombre ? '· ' + m.seccion.nombre : '(general)'} · ${m.tipo_servicio?.nombre ?? ''}`)));
  });
}

function bindLecturas() {
  qs('#filtro-lectura-propiedad')?.addEventListener('change', async () => { await fillMedidorSelect(); await renderLecturas(); });
  qs('#filtro-lectura-medidor')?.addEventListener('change', renderLecturas);
  qs('#filtro-lectura-periodo')?.addEventListener('change', renderLecturas);
  qs('#btn-nueva-lectura')?.addEventListener('click', () => openLecturaModal());
  qs('#le-medidor')?.addEventListener('change', actualizarLecturaAnterior);
  qs('#le-periodo')?.addEventListener('change', actualizarLecturaAnterior);

  const form = qs('#form-lectura');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const btn = qs('#btn-guardar-lectura');
    setLoading(btn, true);
    try {
      let fotoUrl = null;
      const file = qs('#le-foto-file').files[0];
      const medidorId = qs('#le-medidor').value;
      if (file) fotoUrl = await uploadArchivo(file, `medidores/${medidorId}`);
      await createLectura({
        medidor_id: medidorId,
        periodo: qs('#le-periodo').value,
        fecha_lectura: qs('#le-fecha').value,
        lectura_anterior: qs('#le-lectura-anterior').value ? Number(qs('#le-lectura-anterior').value) : null,
        lectura_actual: Number(qs('#le-lectura-actual').value),
        foto_url: fotoUrl,
        notas: qs('#le-notas').value || null,
      });
      showToast('Lectura registrada.', 'success');
      closeModal('modal-lectura');
      await renderLecturas();
    } catch (err) {
      console.error(err);
      showToast('No se pudo registrar la lectura. ¿Ya existe una lectura para ese medidor y periodo?', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

async function actualizarLecturaAnterior() {
  const medidorId = qs('#le-medidor').value;
  if (!medidorId) return;
  try {
    const ultima = await getUltimaLectura(medidorId);
    qs('#le-lectura-anterior').value = ultima?.lectura_actual ?? '';
  } catch (err) {
    console.error(err);
  }
}

async function openLecturaModal() {
  const form = qs('#form-lectura');
  form.reset();
  await fillMedidorSelect();
  qs('#le-periodo').value = periodoActual();
  qs('#le-fecha').value = new Date().toISOString().slice(0, 10);
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
      el('td', {}, r.tipo_servicio?.nombre ?? '—'),
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
      showToast('No se pudo registrar el recibo. ¿Ya existe uno para esa propiedad, servicio y periodo?', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

function openReciboModal() {
  const form = qs('#form-recibo');
  form.reset();
  qs('#re-periodo').value = periodoActual();
  qs('#re-foto-file').value = '';
  openModal('modal-recibo');
}

/* ================================== CÁLCULO ==================================== */
let calculoDetalleActual = [];

function bindCalculo() {
  qs('#ca-propiedad')?.addEventListener('change', () => { qs('#calculo-resultado').innerHTML = ''; });
  qs('#btn-cargar-calculo')?.addEventListener('click', cargarSeccionesParaCalculo);
  qs('#btn-confirmar-calculo')?.addEventListener('click', confirmarCalculo);
  qs('#ca-periodo').value = periodoActual();
}

async function cargarSeccionesParaCalculo() {
  const propiedadId = qs('#ca-propiedad').value;
  const tipoServicioId = qs('#ca-tipo-servicio').value;
  const periodo = qs('#ca-periodo').value;
  if (!propiedadId || !tipoServicioId || !periodo) {
    showToast('Selecciona propiedad, tipo de servicio y periodo.', 'error');
    return;
  }

  const contenedor = qs('#calculo-resultado');
  contenedor.innerHTML = '<div class="skeleton" style="height:80px;"></div>';

  try {
    const tipoServicio = tiposServicioCache.find((t) => t.id === tipoServicioId);
    const recibos = await listRecibosGenerales({ propiedadId });
    const recibo = recibos.find((r) => r.tipo_servicio?.nombre === tipoServicio?.nombre && r.periodo === periodo);
    if (!recibo) {
      contenedor.innerHTML = `<div class="card"><p>No hay un recibo general registrado para <strong>${tipoServicio?.nombre}</strong> en el periodo <strong>${periodo}</strong>. Regístralo primero en la pestaña "Recibos generales".</p></div>`;
      qs('#btn-confirmar-calculo').style.display = 'none';
      return;
    }

    const [secciones, medidoresPropiedad] = await Promise.all([
      listSeccionesPorPropiedad(propiedadId),
      listMedidores({ propiedadId }),
    ]);
    const mapaMedidorPorSeccion = new Map(
      medidoresPropiedad.filter((m) => !m.es_general && m.tipo_servicio_id === tipoServicioId && m.seccion_id).map((m) => [m.seccion_id, m])
    );

    calculoDetalleActual = [];
    const filas = [];
    for (const s of secciones) {
      const medidor = mapaMedidorPorSeccion.get(s.id);
      if (medidor) {
        const lecturas = await listLecturas({ medidorId: medidor.id, periodo });
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
      } else if (tipoServicio?.permite_tarifa_fija_por_persona) {
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
      } else {
        filas.push(el('tr', {}, [el('td', {}, s.nombre), el('td', {}, 'No prorrateable'), el('td', {}, '—'), el('td', {}, '—')]));
      }
    }

    contenedor.innerHTML = '';
    contenedor.append(el('div', { class: 'card' }, [
      el('p', { style: 'margin-bottom:12px;' }, `Recibo: ${formatCurrency(recibo.monto_total_recibo)} · Precio unitario aplicado: ${recibo.precio_unitario ? formatNumber(recibo.precio_unitario, 4) : '—'}`),
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data-table' }, [
          el('thead', {}, [el('tr', {}, [el('th', {}, 'Sección'), el('th', {}, 'Método'), el('th', {}, 'Consumo / detalle'), el('th', {}, '')])]),
          el('tbody', {}, filas),
        ]),
      ]),
    ]));
    qs('#calculo-recibo-id').value = recibo.id;
    qs('#btn-confirmar-calculo').style.display = calculoDetalleActual.length ? 'inline-flex' : 'none';
  } catch (err) {
    console.error(err);
    showToast('No se pudo preparar el cálculo.', 'error');
  }
}

async function confirmarCalculo() {
  if (!calculoDetalleActual.length) return;
  if (!confirmAction(`Se generarán ${calculoDetalleActual.length} cuota(s) de cobranza a partir de este cálculo. ¿Confirmar?`)) return;
  const btn = qs('#btn-confirmar-calculo');
  setLoading(btn, true, 'Calculando…');
  try {
    await calcularPeriodoServicio({
      propiedadId: qs('#ca-propiedad').value,
      tipoServicioId: qs('#ca-tipo-servicio').value,
      periodo: qs('#ca-periodo').value,
      reciboGeneralId: qs('#calculo-recibo-id').value,
      detalles: calculoDetalleActual,
    });
    showToast('Cálculo confirmado. Las cuotas de servicio ya están disponibles en Cobranzas.', 'success');
    calculoDetalleActual = [];
    qs('#calculo-resultado').innerHTML = '<p style="color:var(--color-success);">✓ Cálculo confirmado.</p>';
    btn.style.display = 'none';
  } catch (err) {
    console.error(err);
    showToast(err.message?.includes('Ya existe') ? 'Ya existe un cálculo confirmado para esta propiedad, servicio y periodo.' : 'No se pudo confirmar el cálculo.', 'error');
  } finally {
    setLoading(btn, false);
  }
}

main();
