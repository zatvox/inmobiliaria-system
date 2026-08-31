/**
 * servicios.js — Módulo Cálculo de Servicios (Fase 3): medidores, lecturas
 * mensuales, recibos generales y el "runner" de cálculo que genera las
 * cuotas de cobranza por servicio (RPC calcular_periodo_servicio en el
 * servidor — toda la lógica de dinero vive ahí, no en el navegador).
 */
import { initShell } from './main.js';
import {
  listPropiedades, listSeccionesPorPropiedad, listTiposServicio,
  listMedidores, createMedidor, updateMedidor, deleteMedidor, guardarRepartoMedidor,
  listLecturas, getUltimaLectura, createLectura, updateLectura, deleteLectura,
  listRecibosGenerales, createReciboGeneral, updateReciboGeneral, deleteReciboGeneral,
  listCuentasServicio, createCuentaServicio, updateCuentaServicio, deleteCuentaServicio, listContratosAlquiler,
  listCalculosPeriodo, calcularPeriodoServicio, generarCobranzasServicio,
  listDetalleCalculoPorPeriodo, listDetalleCalculoConLecturas, uploadArchivo, getSignedUrl,
  deshacerCalculoServicio, getConfiguracionSistema, listContratosVigentesConServiciosFijos,
} from './supabase-data.js';
import { qs, qsa, el, formatCurrency, formatDate, formatNumber, badgeHtml, showToast, openModal, closeModal, validateForm, setLoading, confirmAction } from './utils.js';
import { agruparDetalleParaCuadro, buildCuadroConsumoEl, descargarCuadroComoImagen, getColorLineasTabla } from './cuadro-consumo.js';

let activeTab = 'medidores';
let propiedadesCache = [];
let tiposServicioCache = [];
let cuentasCache = [];
let configuracionCache = null;
let vistaLecturas = 'lista'; // 'lista' | 'cuadro'

function periodoActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Se pide una sola vez por sesión — si falla (ej. tabla recién creada y
// todavía sin permisos), no bloquea el cálculo: simplemente no hay
// fallback de precio y el campo queda en 0 para que el usuario lo llene.
async function getConfiguracionCacheada() {
  if (configuracionCache) return configuracionCache;
  try {
    configuracionCache = await getConfiguracionSistema();
  } catch (err) {
    console.error(err);
    configuracionCache = {};
  }
  return configuracionCache;
}

async function main() {
  const profile = await initShell('servicios');
  if (!profile) return;

  [propiedadesCache, tiposServicioCache] = await Promise.all([listPropiedades(), listTiposServicio()]);
  fillPropiedadSelects();
  fillTipoServicioSelects();
  fillServicioSelect();

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
      if (activeTab === 'lecturas') { renderLecturaPropiedadTabs(); await fillMedidorSelect(); await renderLecturas(); }
      if (activeTab === 'recibos') await renderRecibos();
      if (activeTab === 'cuentas') await renderCuentas();
    });
  });
}

/* ================================ MEDIDORES ================================== */
async function renderMedidores() {
  const tbody = qs('#medidores-tbody');
  try {
    const [medidores, contratos] = await Promise.all([
      listMedidores({ propiedadId: qs('#filtro-medidor-propiedad').value }),
      listContratosAlquiler({}),
    ]);
    // Mapa sección → inquilino actual: el contrato vigente/por_vencer más
    // reciente de esa sección (listContratosAlquiler ya viene ordenado por
    // fecha_inicio desc, así que el primero que aparezca por sección es el
    // más nuevo).
    // Un contrato puede cubrir varias secciones (ver contratos_alquiler_secciones,
    // ej. Piso 4 + Piso 5 bajo el mismo contrato/adenda) — hay que recorrer
    // TODAS las que trae, no solo su seccion_id "principal", si no las
    // secciones agregadas después quedan sin inquilino en esta tabla.
    const inquilinoPorSeccion = new Map();
    contratos
      .filter((c) => c.estado === 'vigente' || c.estado === 'por_vencer')
      .forEach((c) => {
        const idsSecciones = c.secciones_contrato?.length ? c.secciones_contrato.map((sc) => sc.seccion_id) : [c.seccion_id];
        idsSecciones.forEach((seccionId) => {
          if (!inquilinoPorSeccion.has(seccionId)) inquilinoPorSeccion.set(seccionId, c.inquilino?.nombre ?? '—');
        });
      });

    tbody.innerHTML = '';
    if (!medidores.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '7' }, [el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '📟'), el('p', {}, 'Sin medidores registrados.')])])]));
      return;
    }
    medidores.forEach((m) => {
      let inquilino = '—';
      if (m.es_compartido) {
        const nombres = (m.medidores_reparto ?? []).map((r) => inquilinoPorSeccion.get(r.seccion_id)).filter(Boolean);
        inquilino = nombres.length ? [...new Set(nombres)].join(' / ') : '—';
      } else if (!m.es_general && m.seccion_id) {
        inquilino = inquilinoPorSeccion.get(m.seccion_id) ?? '—';
      }
      tbody.append(el('tr', {}, [
        el('td', {}, m.propiedad?.nombre_referencial ?? '—'),
        el('td', {}, m.es_general
          ? el('span', { class: 'badge badge-neutral' }, 'General')
          : m.es_compartido
            ? el('span', { class: 'badge badge-neutral', title: (m.medidores_reparto ?? []).map((r) => `${r.seccion?.nombre} (${r.porcentaje}%)`).join(', ') }, `Compartido (${(m.medidores_reparto ?? []).length} secciones)`)
            : (m.seccion?.nombre ?? '—')),
        el('td', {}, m.tipo_servicio?.nombre ?? '—'),
        el('td', {}, m.codigo_medidor || '—'),
        el('td', {}, inquilino),
        el('td', {}, m.activo ? el('span', { class: 'badge badge-disponible' }, 'Activo') : el('span', { class: 'badge badge-inactivo' }, 'Inactivo')),
        el('td', { class: 'actions' }, [
          el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => openMedidorModal(m) }, 'Editar'),
          el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => eliminarMedidor(m) }, 'Eliminar'),
        ]),
      ]));
    });
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar los medidores.', 'error');
  }
}

async function eliminarMedidor(medidor) {
  if (!confirmAction(`¿Eliminar el medidor "${medidor.codigo_medidor || medidor.seccion?.nombre || 'sin código'}"? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteMedidor(medidor.id);
    showToast('Medidor eliminado.', 'success');
    await renderMedidores();
  } catch (err) {
    console.error(err);
    showToast('No se pudo eliminar. Verifica que no tenga lecturas o cálculos de servicio asociados.', 'error');
  }
}

function bindMedidores() {
  qs('#filtro-medidor-propiedad')?.addEventListener('change', renderMedidores);
  qs('#btn-nuevo-medidor')?.addEventListener('click', () => openMedidorModal());
  qs('#me-es-general')?.addEventListener('change', toggleMedidorDueno);
  qs('#me-es-compartido')?.addEventListener('change', toggleMedidorDueno);
  qs('#me-propiedad')?.addEventListener('change', refreshCuentasMedidor);
  qs('#me-tipo-servicio')?.addEventListener('change', refreshCuentasMedidor);
  qs('#btn-agregar-reparto')?.addEventListener('click', () => agregarFilaReparto());

  const form = qs('#form-medidor');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const esGeneral = qs('#me-es-general').checked;
    const esCompartido = qs('#me-es-compartido').checked;
    const payload = {
      propiedad_id: qs('#me-propiedad').value || null,
      seccion_id: (esGeneral || esCompartido) ? null : (qs('#me-seccion').value || null),
      tipo_servicio_id: qs('#me-tipo-servicio').value,
      es_general: esGeneral,
      es_compartido: esCompartido,
      codigo_medidor: qs('#me-codigo').value || null,
      cuenta_servicio_id: qs('#me-cuenta').value || null,
      fecha_instalacion: qs('#me-fecha-instalacion').value || null,
      notas: qs('#me-notas').value || null,
    };
    if (!esGeneral && !esCompartido && !payload.seccion_id) { showToast('Selecciona una sección, o marca "medidor general" / "medidor compartido".', 'error'); return; }
    if (esGeneral && !payload.propiedad_id) { showToast('Un medidor general necesita una propiedad.', 'error'); return; }

    let repartos = [];
    if (esCompartido) {
      if (!payload.propiedad_id) { showToast('Un medidor compartido necesita una propiedad.', 'error'); return; }
      repartos = leerFilasReparto();
      if (repartos.length < 2) { showToast('Un medidor compartido necesita al menos 2 secciones en el reparto.', 'error'); return; }
      if (repartos.some((r) => !r.seccion_id)) { showToast('Elige una sección en cada fila del reparto.', 'error'); return; }
      const seccionesRepetidas = new Set(repartos.map((r) => r.seccion_id)).size !== repartos.length;
      if (seccionesRepetidas) { showToast('No repitas la misma sección en el reparto.', 'error'); return; }
      const total = repartos.reduce((acc, r) => acc + r.porcentaje, 0);
      if (Math.abs(total - 100) > 0.01) { showToast(`El reparto debe sumar 100% (ahora suma ${formatNumber(total, 1)}%).`, 'error'); return; }
    }

    const btn = qs('#btn-guardar-medidor');
    setLoading(btn, true);
    try {
      const editingId = form.dataset.editingId;
      const medidor = editingId ? await updateMedidor(editingId, payload) : await createMedidor(payload);
      await guardarRepartoMedidor(medidor.id, esCompartido ? repartos : []);
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
  const esCompartido = qs('#me-es-compartido').checked;
  qs('#me-propiedad-field').style.display = 'block';
  qs('#me-seccion-field').style.display = (!esGeneral && !esCompartido) ? 'block' : 'none';
  qs('#me-reparto-field').style.display = esCompartido ? 'block' : 'none';
  qs('#me-es-general').disabled = esCompartido;
  qs('#me-es-compartido').disabled = esGeneral;
}

async function openMedidorModal(medidor = null) {
  const form = qs('#form-medidor');
  form.reset();
  form.dataset.editingId = medidor?.id ?? '';
  qs('#modal-medidor-title').textContent = medidor ? 'Editar medidor' : 'Nuevo medidor';
  qs('#me-propiedad').value = medidor?.propiedad_id ?? '';
  qs('#me-es-general').checked = medidor?.es_general ?? false;
  qs('#me-es-compartido').checked = medidor?.es_compartido ?? false;
  qs('#me-tipo-servicio').value = medidor?.tipo_servicio_id ?? '';
  qs('#me-reparto-list').innerHTML = '';
  toggleMedidorDueno();
  await Promise.all([refreshSeccionesMedidor(), refreshCuentasMedidor()]);
  if (medidor) {
    qs('#me-seccion').value = medidor.seccion_id ?? '';
    qs('#me-codigo').value = medidor.codigo_medidor ?? '';
    qs('#me-cuenta').value = medidor.cuenta_servicio_id ?? '';
    qs('#me-fecha-instalacion').value = medidor.fecha_instalacion ?? '';
    qs('#me-notas').value = medidor.notas ?? '';
    (medidor.medidores_reparto ?? []).forEach((r) => agregarFilaReparto(r.seccion_id, r.porcentaje));
  }
  if (!qs('#me-reparto-list').children.length && qs('#me-es-compartido').checked) {
    agregarFilaReparto();
    agregarFilaReparto();
  }
  openModal('modal-medidor');
}

async function refreshSeccionesMedidor() {
  const propiedadId = qs('#me-propiedad').value;
  seccionesMedidorCache = propiedadId ? await listSeccionesPorPropiedad(propiedadId) : [];
  const seccionSelect = qs('#me-seccion');
  seccionSelect.innerHTML = '<option value="">Selecciona…</option>';
  seccionesMedidorCache.forEach((s) => seccionSelect.append(el('option', { value: s.id }, s.nombre)));
  // refresca también las secciones disponibles en las filas de reparto ya dibujadas
  qsa('.reparto-seccion').forEach((sel) => {
    const actual = sel.value;
    sel.innerHTML = '<option value="">Selecciona sección…</option>';
    seccionesMedidorCache.forEach((s) => sel.append(el('option', { value: s.id }, s.nombre)));
    sel.value = actual;
  });
}

/* ---------- Reparto de medidores compartidos ---------- */
let seccionesMedidorCache = [];

function actualizarTotalReparto() {
  const total = qsa('.reparto-porcentaje').reduce((acc, inp) => acc + (Number(inp.value) || 0), 0);
  const totalEl = qs('#me-reparto-total');
  if (!totalEl) return;
  const ok = Math.abs(total - 100) <= 0.01;
  totalEl.textContent = `Total: ${formatNumber(total, 1)}%${ok ? ' ✓' : ' — debe sumar 100%'}`;
  totalEl.style.color = ok ? 'var(--color-success)' : 'var(--color-danger)';
}

function leerFilasReparto() {
  return qsa('#me-reparto-list > div').map((row) => ({
    seccion_id: row.querySelector('.reparto-seccion').value,
    porcentaje: Number(row.querySelector('.reparto-porcentaje').value) || 0,
  }));
}

function agregarFilaReparto(seccionId = '', porcentaje = '') {
  const seccionSelect = el('select', { class: 'reparto-seccion', style: 'flex:1;' },
    [el('option', { value: '' }, 'Selecciona sección…'), ...seccionesMedidorCache.map((s) => el('option', { value: s.id }, s.nombre))]);
  seccionSelect.value = seccionId;
  const porcentajeInput = el('input', { type: 'number', class: 'reparto-porcentaje', min: '0.01', max: '100', step: '0.01', style: 'width:100px;', value: porcentaje === '' ? '' : String(porcentaje), placeholder: '%' });
  porcentajeInput.addEventListener('input', actualizarTotalReparto);
  const row = el('div', { style: 'display:flex; gap:8px; align-items:center;' }, [
    seccionSelect,
    porcentajeInput,
    el('button', { type: 'button', class: 'btn btn-tertiary btn-sm', onclick: () => { row.remove(); actualizarTotalReparto(); } }, '✕'),
  ]);
  qs('#me-reparto-list').append(row);
  actualizarTotalReparto();
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
// El color por tipo de servicio es lo único del Excel de lecturas que de
// verdad ayuda a escanear la tabla rápido (agua vs luz) — se replica aquí
// como borde de color en cada fila, sin copiar el resto del formato de
// esa hoja (fechas desordenadas, columnas que crecen sin control, etc.).
function colorServicio(nombreServicio) {
  const n = (nombreServicio || '').toLowerCase();
  if (n.includes('agua')) return '#3B82F6';
  if (n.includes('luz')) return '#F59E0B';
  return 'var(--gray-400)';
}

// Pastillas de propiedad para saltar rápido de un edificio a otro sin abrir
// un <select> — el filtro real sigue siendo el <select> oculto
// #filtro-lectura-propiedad (así todo el resto del código que ya lee su
// .value no cambia); esto solo agrega una forma más rápida de fijarlo.
function renderLecturaPropiedadTabs() {
  const cont = qs('#lectura-propiedad-tabs');
  const sel = qs('#filtro-lectura-propiedad');
  if (!cont || !sel) return;
  cont.innerHTML = '';
  const opciones = [{ id: '', nombre_referencial: 'Todas' }, ...propiedadesCache];
  opciones.forEach((p) => {
    const activo = sel.value === p.id;
    const btn = el('button', {
      type: 'button',
      class: 'btn btn-sm',
      style: `border-radius:999px; ${activo ? 'background:var(--color-primary); color:#fff; border-color:var(--color-primary);' : 'background:#fff; color:var(--gray-500); border:1px solid var(--gray-300);'}`,
      onclick: async () => {
        sel.value = p.id;
        renderLecturaPropiedadTabs();
        await fillMedidorSelect();
        await renderLecturas();
      },
    }, p.nombre_referencial);
    cont.append(btn);
  });
}

// Punto de entrada único: decide qué vista mostrar (lista o cuadro) y
// delega. Todo el código existente que ya llamaba a renderLecturas() sigue
// funcionando igual sin tocarlo.
async function renderLecturas() {
  const vistaListaEl = qs('#lecturas-vista-lista');
  const vistaCuadroEl = qs('#lecturas-vista-cuadro');
  const btnToggle = qs('#btn-ver-cuadro');
  if (vistaLecturas === 'cuadro') {
    if (vistaListaEl) vistaListaEl.style.display = 'none';
    if (vistaCuadroEl) vistaCuadroEl.style.display = 'block';
    if (btnToggle) btnToggle.textContent = '☰ Ver como lista';
    await renderLecturasCuadro();
  } else {
    if (vistaListaEl) vistaListaEl.style.display = 'block';
    if (vistaCuadroEl) vistaCuadroEl.style.display = 'none';
    if (btnToggle) btnToggle.textContent = '▦ Ver como cuadro';
    await renderLecturasLista();
  }
}

async function renderLecturasLista() {
  const tbody = qs('#lecturas-tbody');
  const propiedadId = qs('#filtro-lectura-propiedad').value;
  const periodo = qs('#filtro-lectura-periodo').value;
  const tipoServicioId = qs('#filtro-lectura-servicio')?.value ?? '';
  try {
    const [lecturas, contratos] = await Promise.all([
      listLecturas({ propiedadId, medidorId: qs('#filtro-lectura-medidor').value, periodo, tipoServicioId }),
      listContratosAlquiler({}),
    ]);
    // Igual que en Medidores: un contrato puede cubrir varias secciones, hay
    // que recorrer todas (contratos_alquiler_secciones), no solo la principal.
    const inquilinoPorSeccion = new Map();
    contratos
      .filter((c) => c.estado === 'vigente' || c.estado === 'por_vencer')
      .forEach((c) => {
        const idsSecciones = c.secciones_contrato?.length ? c.secciones_contrato.map((sc) => sc.seccion_id) : [c.seccion_id];
        idsSecciones.forEach((seccionId) => {
          if (!inquilinoPorSeccion.has(seccionId)) inquilinoPorSeccion.set(seccionId, c.inquilino?.nombre ?? '—');
        });
      });

    await renderLecturasPendientes(propiedadId, periodo, lecturas, tipoServicioId);

    tbody.innerHTML = '';
    if (!lecturas.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '10' }, [el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '📊'), el('p', {}, 'Sin lecturas registradas.')])])]));
      return;
    }
    lecturas.forEach((l) => {
      let inquilino = '—';
      if (l.medidor?.es_compartido) {
        const nombres = (l.medidor.medidores_reparto ?? []).map((r) => inquilinoPorSeccion.get(r.seccion_id)).filter(Boolean);
        inquilino = nombres.length ? [...new Set(nombres)].join(' / ') : '—';
      } else if (!l.medidor?.es_general && l.medidor?.seccion_id) {
        inquilino = inquilinoPorSeccion.get(l.medidor.seccion_id) ?? '—';
      }
      tbody.append(el('tr', { style: `border-left:4px solid ${colorServicio(l.medidor?.tipo_servicio?.nombre)};` }, [
        el('td', {}, `${l.medidor?.propiedad?.nombre_referencial ?? ''} ${l.medidor?.seccion?.nombre ? '· ' + l.medidor.seccion.nombre : '(general)'}`),
        el('td', {}, l.medidor?.codigo_medidor || '—'),
        el('td', {}, inquilino),
        el('td', {}, l.medidor?.tipo_servicio?.nombre ?? '—'),
        el('td', {}, l.fecha_lectura_anterior ? formatDate(l.fecha_lectura_anterior) : '—'),
        el('td', {}, formatNumber(l.lectura_anterior ?? 0, 3)),
        el('td', {}, formatDate(l.fecha_lectura)),
        el('td', {}, formatNumber(l.lectura_actual, 3)),
        el('td', {}, Number(l.consumo_calculado) < 0
          ? el('span', { class: 'badge badge-vencida', title: 'Consumo negativo: revisa la "lectura anterior" de este registro.' }, `⚠ ${formatNumber(l.consumo_calculado, 3)} ${l.medidor?.tipo_servicio?.unidad_medida ?? ''}`)
          : `${formatNumber(l.consumo_calculado, 3)} ${l.medidor?.tipo_servicio?.unidad_medida ?? ''}`),
        el('td', { class: 'actions' }, [
          l.foto_url ? el('a', { class: 'btn btn-tertiary btn-sm', href: '#', onclick: async (evt) => { evt.preventDefault(); window.open(await getSignedUrl(l.foto_url), '_blank'); } }, '📷') : null,
          el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => openLecturaModal(l) }, 'Editar'),
          el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => eliminarLectura(l) }, 'Eliminar'),
        ]),
      ]));
    });
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar las lecturas.', 'error');
  }
}

// Banner de medidores sin lectura en el periodo filtrado — necesita
// propiedad Y periodo elegidos para tener sentido (si no, "periodo actual"
// sería ambiguo). Es la alerta automática que el Excel no tiene: ahí uno
// depende de notar a ojo una celda vacía.
async function renderLecturasPendientes(propiedadId, periodo, lecturas, tipoServicioId = '') {
  const cont = qs('#lecturas-pendientes');
  if (!cont) return;
  if (!propiedadId || !periodo) { cont.style.display = 'none'; cont.innerHTML = ''; return; }
  try {
    let medidores = await listMedidores({ propiedadId });
    if (tipoServicioId) medidores = medidores.filter((m) => m.tipo_servicio_id === tipoServicioId);
    const medidoresConLectura = new Set(lecturas.map((l) => l.medidor_id));
    const pendientes = medidores.filter((m) => !m.es_general && !medidoresConLectura.has(m.id));
    if (!pendientes.length) { cont.style.display = 'none'; cont.innerHTML = ''; return; }
    cont.style.display = 'block';
    cont.innerHTML = '';
    cont.append(el('div', { style: 'background:#FEF3C7; border:1px solid #FBBF24; border-radius:8px; padding:10px 14px; margin-bottom:8px; font-size:13px;' }, [
      el('strong', {}, `⚠ ${pendientes.length} medidor(es) sin lectura en ${periodo}: `),
      pendientes.map((m) => medidorLabel(m)).join(' · '),
    ]));
  } catch (err) {
    console.error(err);
  }
}

// Vista de cuadro (matriz fechas × medidores), inspirada en el Excel de
// lecturas que ya usan, pero acotada SIEMPRE a una sola propiedad — así no
// crece sin control como la hoja original al agregar más inmuebles, y las
// fechas quedan ordenadas de verdad (no dependen de que se haya tecleado en
// orden). El color de encabezado por tipo de servicio es lo que sí se copia
// del Excel porque ahí funciona.
async function renderLecturasCuadro() {
  const cont = qs('#lecturas-vista-cuadro');
  if (!cont) return;
  const propiedadId = qs('#filtro-lectura-propiedad').value;
  if (!propiedadId) {
    cont.innerHTML = '';
    cont.append(el('p', { style: 'color:var(--gray-500); padding:16px;' }, 'Selecciona una propiedad arriba para ver el cuadro de lecturas (una tabla por propiedad, para que no crezca sin control).'));
    return;
  }
  cont.innerHTML = '<div class="skeleton" style="height:120px;"></div>';
  const tipoServicioId = qs('#filtro-lectura-servicio')?.value ?? '';
  try {
    const [medidoresTodos, lecturas] = await Promise.all([
      listMedidores({ propiedadId }),
      listLecturas({ propiedadId, tipoServicioId }),
    ]);
    const medidores = tipoServicioId ? medidoresTodos.filter((m) => m.tipo_servicio_id === tipoServicioId) : medidoresTodos;
    if (!medidores.length) {
      cont.innerHTML = '';
      cont.append(el('p', { style: 'color:var(--gray-500); padding:16px;' }, 'Esta propiedad todavía no tiene medidores registrados.'));
      return;
    }
    const medidoresOrdenados = [...medidores].sort((a, b) => (a.seccion?.nombre ?? '').localeCompare(b.seccion?.nombre ?? '') || (a.codigo_medidor ?? '').localeCompare(b.codigo_medidor ?? ''));
    const valorPorCelda = new Map(); // `${medidor_id}|${fecha_lectura}` -> lectura_actual
    const fechasSet = new Set();
    lecturas.forEach((l) => {
      fechasSet.add(l.fecha_lectura);
      valorPorCelda.set(`${l.medidor_id}|${l.fecha_lectura}`, l.lectura_actual);
    });
    const fechasOrdenadas = [...fechasSet].sort(); // ISO 'YYYY-MM-DD' ordena bien como texto

    cont.innerHTML = '';
    if (!fechasOrdenadas.length) {
      cont.append(el('p', { style: 'color:var(--gray-500); padding:16px;' }, 'Esta propiedad todavía no tiene lecturas registradas.'));
      return;
    }
    const thead = el('thead', {}, [el('tr', {}, [
      el('th', { style: 'position:sticky; left:0; background:var(--gray-100); z-index:1;' }, 'Fecha'),
      ...medidoresOrdenados.map((m) => el('th', {
        style: `background:${colorServicio(m.tipo_servicio?.nombre)}22; border-bottom:3px solid ${colorServicio(m.tipo_servicio?.nombre)}; text-align:right; white-space:nowrap;`,
        title: m.tipo_servicio?.nombre ?? '',
      }, [
        el('div', {}, m.seccion?.nombre ? m.seccion.nombre : (m.es_general ? '(general)' : '(compartido)')),
        el('div', { style: 'font-weight:400; font-size:11px; color:var(--gray-500);' }, m.codigo_medidor || '—'),
      ])),
    ])]);
    const tbody = el('tbody', {}, fechasOrdenadas.map((fecha) => el('tr', {}, [
      el('td', { style: 'position:sticky; left:0; background:#fff; font-weight:600; white-space:nowrap;' }, formatDate(fecha)),
      ...medidoresOrdenados.map((m) => {
        const valor = valorPorCelda.get(`${m.id}|${fecha}`);
        return el('td', { style: 'text-align:right;' }, valor != null ? formatNumber(valor, 3) : '');
      }),
    ])));
    cont.append(el('table', { class: 'data-table', style: 'font-size:12px;' }, [thead, tbody]));
  } catch (err) {
    console.error(err);
    cont.innerHTML = '';
    showToast('No se pudo armar el cuadro de lecturas.', 'error');
  }
}

async function eliminarLectura(lectura) {
  if (!confirmAction(`¿Eliminar la lectura del ${formatDate(lectura.fecha_lectura)}? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteLectura(lectura.id);
    showToast('Lectura eliminada.', 'success');
    await renderLecturas();
  } catch (err) {
    console.error(err);
    showToast('No se pudo eliminar. Verifica que no esté usada en un cálculo de servicio ya confirmado.', 'error');
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

function fillServicioSelect() {
  const sel = qs('#filtro-lectura-servicio');
  if (!sel) return;
  const currentValue = sel.value;
  sel.innerHTML = '<option value="">Todos los servicios</option>';
  tiposServicioCache.forEach((t) => sel.append(el('option', { value: t.id }, t.nombre)));
  if (tiposServicioCache.some((t) => t.id === currentValue)) sel.value = currentValue;
}

async function fillMedidorSelect() {
  const propiedadId = qs('#filtro-lectura-propiedad')?.value ?? '';
  const tipoServicioId = qs('#filtro-lectura-servicio')?.value ?? '';
  let medidores = await listMedidores({ propiedadId });
  if (tipoServicioId) medidores = medidores.filter((m) => m.tipo_servicio_id === tipoServicioId);
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
  qs('#filtro-lectura-servicio')?.addEventListener('change', async () => { await fillMedidorSelect(); await renderLecturas(); });
  qs('#filtro-lectura-medidor')?.addEventListener('change', renderLecturas);
  qs('#filtro-lectura-periodo')?.addEventListener('change', renderLecturas);
  qs('#btn-nueva-lectura')?.addEventListener('click', () => openLecturaModal());
  qs('#btn-ver-cuadro')?.addEventListener('click', () => { vistaLecturas = vistaLecturas === 'cuadro' ? 'lista' : 'cuadro'; renderLecturas(); });
  qs('#le-propiedad')?.addEventListener('change', fillLecturaMedidorSelect);
  qs('#le-medidor')?.addEventListener('change', actualizarLecturaAnterior);
  qs('#le-fecha-actual')?.addEventListener('change', actualizarLecturaAnterior);

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
        // `periodo` ya no lo llena el usuario — un trigger en la base de
        // datos lo calcula solo a partir del mes de fecha_lectura (la
        // lectura actual), así que ni hace falta mandarlo aquí.
        fecha_lectura_anterior: qs('#le-fecha-anterior').value || null,
        fecha_lectura: qs('#le-fecha-actual').value,
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
      showToast('No se pudo guardar la lectura. ¿Ya existe una lectura de este medidor ese mismo mes?', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

// Encadena esta lectura con la anterior por FECHA real (no por mes
// calendario): busca, para este medidor, la lectura más reciente antes de
// la fecha de lectura actual que se está registrando, y sugiere su fecha y
// su valor como "lectura anterior" — editable si hace falta corregirlo.
async function actualizarLecturaAnterior() {
  const medidorId = qs('#le-medidor').value;
  const fechaActual = qs('#le-fecha-actual').value;
  if (!medidorId) return;
  try {
    const ultima = await getUltimaLectura(medidorId, fechaActual);
    qs('#le-fecha-anterior').value = ultima?.fecha_lectura ?? '';
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
    qs('#le-fecha-anterior').value = lectura.fecha_lectura_anterior ?? '';
    qs('#le-fecha-actual').value = lectura.fecha_lectura;
    qs('#le-lectura-anterior').value = lectura.lectura_anterior ?? '';
    qs('#le-lectura-actual').value = lectura.lectura_actual;
    qs('#le-notas').value = lectura.notas ?? '';
  } else {
    qs('#le-fecha-actual').value = new Date().toISOString().slice(0, 10);
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
        el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => openReciboModal(r) }, 'Editar'),
        el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => eliminarRecibo(r) }, 'Eliminar'),
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

async function eliminarRecibo(recibo) {
  if (!confirmAction(`¿Eliminar el recibo de ${recibo.tipo_servicio?.nombre ?? 'servicio'} (${recibo.periodo})? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteReciboGeneral(recibo.id);
    showToast('Recibo eliminado.', 'success');
    await renderRecibos();
  } catch (err) {
    console.error(err);
    showToast('No se pudo eliminar. Verifica que no tenga un cálculo de servicio ya confirmado.', 'error');
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
      const editingId = form.dataset.editingId;
      let fotoUrl = form.dataset.fotoUrlActual || null;
      const file = qs('#re-foto-file').files[0];
      const propiedadId = qs('#re-propiedad').value;
      if (file) fotoUrl = await uploadArchivo(file, `recibos/${propiedadId}`);
      const montoTotal = Number(qs('#re-monto').value);
      const consumoTotal = qs('#re-consumo').value ? Number(qs('#re-consumo').value) : null;
      const payload = {
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
      };
      if (editingId) await updateReciboGeneral(editingId, payload); else await createReciboGeneral(payload);
      showToast('Recibo general guardado.', 'success');
      closeModal('modal-recibo');
      await renderRecibos();
    } catch (err) {
      console.error(err);
      showToast('No se pudo guardar el recibo. ¿Ya existe uno para esa propiedad, servicio, periodo y cuenta?', 'error');
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

async function openReciboModal(recibo = null) {
  const form = qs('#form-recibo');
  form.reset();
  form.dataset.editingId = recibo?.id ?? '';
  form.dataset.fotoUrlActual = recibo?.foto_recibo_url ?? '';
  qs('#modal-recibo-title').textContent = recibo ? 'Editar recibo general' : 'Registrar recibo general';
  qs('#re-propiedad').value = recibo?.propiedad_id ?? '';
  qs('#re-tipo-servicio').value = recibo?.tipo_servicio_id ?? '';
  await refreshCuentasRecibo();
  if (recibo) {
    qs('#re-cuenta').value = recibo.cuenta_servicio_id ?? '';
    qs('#re-periodo').value = recibo.periodo;
    qs('#re-monto').value = recibo.monto_total_recibo;
    qs('#re-consumo').value = recibo.consumo_total_recibo ?? '';
    qs('#re-fecha-venc').value = recibo.fecha_vencimiento_recibo ?? '';
    qs('#re-notas').value = recibo.notas ?? '';
  } else {
    qs('#re-periodo').value = periodoActual();
  }
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
          el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => eliminarCuenta(c) }, 'Eliminar'),
        ]),
      ]));
    });
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar las cuentas de servicio.', 'error');
  }
}

async function eliminarCuenta(cuenta) {
  if (!confirmAction(`¿Eliminar la cuenta "${cuenta.codigo}"? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteCuentaServicio(cuenta.id);
    showToast('Cuenta eliminada.', 'success');
    await renderCuentas();
  } catch (err) {
    console.error(err);
    showToast('No se pudo eliminar. Verifica que no tenga medidores o recibos asociados.', 'error');
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
// solo contra los medidores que pertenecen a esa misma cuenta. Cada tarjeta
// de cuenta arma y confirma su propio detalle de forma independiente (antes
// había una sola variable compartida y un solo botón "Confirmar" para todo
// el panel, lo que hacía que calcular 2 cuentas seguidas solo guardara la
// última — la primera se perdía sin avisar).

function bindCalculo() {
  qs('#ca-propiedad')?.addEventListener('change', () => { qs('#calculo-resultado').innerHTML = ''; });
  qs('#btn-cargar-calculo')?.addEventListener('click', buscarRecibosCalculo);
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

  try {
    const tipoServicio = tiposServicioCache.find((t) => t.id === tipoServicioId);
    const [recibos, calculos, detalleTodos] = await Promise.all([
      listRecibosGenerales({ propiedadId }),
      listCalculosPeriodo({ propiedadId }),
      listDetalleCalculoPorPeriodo({ propiedadId, tipoServicioId, periodo }),
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
        `Esta propiedad tiene ${recibosDelPeriodo.length} cuentas de ${tipoServicio?.nombre} distintas en este periodo. Calcula cada una por separado y al final junta todo en una sola cobranza por inquilino.`));
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
        card.append(el('span', { class: 'badge badge-disponible', style: 'margin-right:8px;' }, '✓ Ya calculado'));
        const btnDeshacer = el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '' }, '↩ Deshacer cálculo');
        btnDeshacer.addEventListener('click', () => deshacerCalculo(recibo, btnDeshacer));
        card.append(btnDeshacer);
      } else {
        card.append(el('button', { class: 'btn btn-secondary btn-sm', onclick: () => cargarDetalleRecibo(recibo, tipoServicio) }, 'Calcular esta cuenta'));
      }
      card.append(el('div', { id: `calculo-detalle-${recibo.id}` }));
      contenedor.append(card);
    });

    // Paso final: juntar el detalle de todas las cuentas ya calculadas y
    // generar una sola cuota combinada por inquilino/sección.
    const todasCalculadas = recibosDelPeriodo.every((r) => calculadosIds.has(r.id));
    const pendientesPorFacturar = detalleTodos.filter((d) => !d.cuota_id);
    const yaFacturado = detalleTodos.length > 0 && pendientesPorFacturar.length === 0;
    const secciones = new Set(pendientesPorFacturar.map((d) => d.seccion_id)).size;

    const cardFinal = el('div', { class: 'card', style: 'margin-top:8px; border-color:var(--primary);' }, [
      el('div', { class: 'card-title' }, '3. Generar la cobranza del periodo'),
    ]);
    if (yaFacturado) {
      cardFinal.append(el('p', {}, el('span', { class: 'badge badge-disponible' }, '✓ Cobranzas de este periodo ya generadas')));
    } else if (!todasCalculadas) {
      const faltan = recibosDelPeriodo.length - calculadosIds.size;
      cardFinal.append(el('p', { style: 'color:var(--gray-500);' }, `Falta calcular ${faltan} cuenta${faltan === 1 ? '' : 's'} de este periodo antes de poder generar la cobranza combinada.`));
    } else if (!pendientesPorFacturar.length) {
      cardFinal.append(el('p', { style: 'color:var(--gray-500);' }, 'No hay consumo calculado todavía para generar cobranzas (revisa que las lecturas existan).'));
    } else {
      cardFinal.append(el('p', { style: 'margin-bottom:8px;' }, `Todas las cuentas están calculadas. Se generará 1 cuota por sección (${secciones} sección${secciones === 1 ? '' : 'es'} con consumo pendiente de facturar).`));
      cardFinal.append(el('button', { class: 'btn btn-primary', id: 'btn-generar-cobranzas', onclick: () => generarCobranzas(propiedadId, tipoServicioId, periodo, tipoServicio, secciones) }, 'Generar cobranzas del periodo'));
    }
    contenedor.append(cardFinal);

    // Vista previa del cuadro de consumo por inquilino — el mismo cuadro que
    // se le presenta para que pague, se pueda o no generar la cobranza
    // todavía (útil para revisar antes de confirmar, y sigue disponible
    // después para volver a descargar la imagen).
    if (todasCalculadas) {
      const cardPreview = el('div', { class: 'card', style: 'margin-top:16px;' }, [
        el('div', { class: 'card-title' }, 'Vista previa: cuadro de consumo por inquilino'),
        el('p', { style: 'color:var(--gray-500); margin-bottom:12px;' }, 'Así se le presenta el consumo a cada inquilino para que pague. El precio unitario ya aplicado es el que se confirmó en cada cuenta arriba.'),
      ]);
      const previewWrap = el('div');
      cardPreview.append(previewWrap);
      contenedor.append(cardPreview);
      await renderVistaPreviaCuadros(previewWrap, propiedadId, tipoServicioId, periodo);
    }
  } catch (err) {
    console.error(err);
    showToast('No se pudo buscar los recibos del periodo.', 'error');
  }
}

// Deshace el cálculo confirmado de una cuenta (para corregir una lectura y
// recalcular) — bloqueado en el servidor si esa cuenta ya está incluida en
// una cuota de cobranza generada; en ese caso hay que eliminar esa cuota
// primero desde Cobranzas y Pagos.
async function deshacerCalculo(recibo, btn) {
  if (!confirmAction('¿Deshacer el cálculo confirmado de esta cuenta? Se borrará el detalle guardado y tendrás que volver a calcularla. No se puede deshacer si ya está incluida en una cobranza generada.')) return;
  setLoading(btn, true, 'Deshaciendo…');
  try {
    await deshacerCalculoServicio(recibo.id);
    showToast('Cálculo deshecho. Ya puedes corregir la lectura y volver a calcular esta cuenta.', 'success');
    await buscarRecibosCalculo();
  } catch (err) {
    console.error(err);
    showToast(err.message ?? 'No se pudo deshacer el cálculo.', 'error');
    setLoading(btn, false);
  }
}

async function generarCobranzas(propiedadId, tipoServicioId, periodo, tipoServicio, secciones) {
  if (!confirmAction(`Se generará 1 cuota combinada de ${tipoServicio?.nombre} por cada una de las ${secciones} secciones con consumo pendiente. ¿Confirmar?`)) return;
  const btn = qs('#btn-generar-cobranzas');
  setLoading(btn, true, 'Generando…');
  try {
    const n = await generarCobranzasServicio({ propiedadId, tipoServicioId, periodo });
    showToast(`${n} cuota(s) generada(s). Ya están disponibles en Cobranzas y Pagos.`, 'success');
    await buscarRecibosCalculo();
  } catch (err) {
    console.error(err);
    showToast(err.message?.includes('Faltan') ? err.message : 'No se pudo generar la cobranza.', 'error');
  } finally {
    setLoading(btn, false);
  }
}

async function cargarDetalleRecibo(recibo, tipoServicio) {
  const propiedadId = qs('#ca-propiedad').value;
  const tipoServicioId = qs('#ca-tipo-servicio').value;
  const periodo = qs('#ca-periodo').value;
  const contenedorDetalle = qs(`#calculo-detalle-${recibo.id}`);
  contenedorDetalle.innerHTML = '<div class="skeleton" style="height:60px; margin-top:8px;"></div>';

  try {
    const cuentaId = recibo.cuenta_servicio_id ?? null;
    const [secciones, medidoresPropiedad, contratos] = await Promise.all([
      listSeccionesPorPropiedad(propiedadId),
      listMedidores({ propiedadId }),
      listContratosAlquiler({}),
    ]);
    // Inquilino por sección — un contrato ya puede cubrir varias secciones
    // (ver contratos_alquiler_secciones), así que se recorren TODAS las que
    // trae cada contrato, no solo su seccion_id "principal".
    const inquilinoPorSeccion = new Map();
    contratos
      .filter((c) => c.estado === 'vigente' || c.estado === 'por_vencer')
      .forEach((c) => {
        const idsSecciones = c.secciones_contrato?.length ? c.secciones_contrato.map((sc) => sc.seccion_id) : [c.seccion_id];
        idsSecciones.forEach((seccionId) => {
          if (!inquilinoPorSeccion.has(seccionId)) inquilinoPorSeccion.set(seccionId, c.inquilino?.nombre ?? '—');
        });
      });
    // Montos fijos definidos en el contrato de alquiler vigente de cada
    // sección (ej. locales de Edificio Polonia sin medidor propio) — se
    // consultan una sola vez para todas las secciones de la propiedad. Un
    // mismo contrato puede cubrir VARIAS secciones (ej. un inquilino que
    // toma 2-3 pisos bajo un solo contrato + adendas), en cuyo caso el monto
    // fijo pactado es UNO SOLO para todo el contrato y se reparte en partes
    // iguales entre las secciones de ese contrato que no tienen medidor
    // propio de ese servicio (ver buscarMontoFijoSeccion más abajo).
    let contratosServiciosFijos = [];
    try {
      contratosServiciosFijos = await listContratosVigentesConServiciosFijos(secciones.map((s) => s.id));
    } catch (err) {
      console.error(err);
    }
    function buscarMontoFijoSeccion(seccionId, tipoServicioId) {
      const contrato = contratosServiciosFijos.find((c) => c.seccionIds.includes(seccionId) && c.serviciosFijos.has(tipoServicioId));
      if (!contrato) return null;
      const montoTotal = contrato.serviciosFijos.get(tipoServicioId);
      const seccionesSinMedidor = contrato.seccionIds.filter((id) => !medidoresPropiedad.some((m) => !m.es_general && !m.es_compartido && m.tipo_servicio_id === tipoServicioId && m.seccion_id === id));
      const n = seccionesSinMedidor.length || 1;
      return Math.round((montoTotal / n) * 100) / 100;
    }

    // Detalle propio de ESTA cuenta — vive solo dentro de esta función, no
    // se comparte con otras tarjetas de cuenta. `filasInfo` guarda datos
    // puros (no nodos) para poder re-renderizar la tabla cada vez que el
    // usuario edite el precio unitario, sin repetir las consultas.
    const detalle = [];
    const filasInfo = [];

    // Medidores compartidos (ej. un baño común entre 2 locales): una sola
    // lectura, pero el consumo se reparte por porcentaje entre varias
    // secciones. Se procesan primero y sus secciones se marcan como
    // "cubiertas" para que el loop normal de abajo no las vuelva a tocar.
    const seccionesCubiertasPorCompartido = new Set();
    const medidoresCompartidos = medidoresPropiedad.filter((m) => m.es_compartido && m.tipo_servicio_id === tipoServicioId && (m.cuenta_servicio_id ?? null) === cuentaId);
    for (const m of medidoresCompartidos) {
      const reparto = m.medidores_reparto ?? [];
      if (!reparto.length) continue;
      const lecturas = await listLecturas({ medidorId: m.id, periodo });
      const lectura = lecturas[0];
      reparto.forEach((r) => seccionesCubiertasPorCompartido.add(r.seccion_id));
      if (!lectura) {
        reparto.forEach((r) => {
          filasInfo.push({ seccionNombre: r.seccion?.nombre ?? '—', inquilinoNombre: inquilinoPorSeccion.get(r.seccion_id) ?? '—', metodoLabel: `Medidor compartido (${m.codigo_medidor || 'sin código'}, ${r.porcentaje}%)`, ok: false, detalleIndex: null });
        });
        continue;
      }
      reparto.forEach((r) => {
        const consumoProrateado = Number((Number(lectura.consumo_calculado) * (Number(r.porcentaje) / 100)).toFixed(3));
        const idx = detalle.length;
        detalle.push({ seccion_id: r.seccion_id, metodo: 'medidor', lectura_id: lectura.id, consumo: consumoProrateado });
        filasInfo.push({
          seccionNombre: r.seccion?.nombre ?? '—',
          inquilinoNombre: inquilinoPorSeccion.get(r.seccion_id) ?? '—',
          metodoLabel: `Medidor compartido (${m.codigo_medidor || 'sin código'}, ${r.porcentaje}%)`,
          consumoLabel: `${formatNumber(consumoProrateado, 3)} ${tipoServicio?.unidad_medida ?? ''} (de ${formatNumber(lectura.consumo_calculado, 3)} total)`,
          consumo: consumoProrateado, ok: true, esMedidor: true, detalleIndex: idx,
        });
      });
    }

    for (const s of secciones) {
      // Una sección puede tener MÁS de un medidor del mismo servicio si sus
      // lavados/tomas están repartidos entre distintas cuentas (ej. Lavadero
      // 2 con un medidor de la cuenta Lt14 y otro de la cuenta Lt15) — o
      // incluso MÁS DE UN medidor propio de la MISMA cuenta (ej. Lavadero 1
      // con "Tanques Lt7" y "Baño Lt7", ambos de la cuenta LT07). Por eso se
      // filtran TODOS los que pertenecen a la cuenta que se está calculando
      // (no solo el primero que salga) y se procesan uno por uno.
      // OJO: una sección puede tener a la vez un medidor PROPIO y aportar a
      // un medidor COMPARTIDO (ej. Lavadero 3 con su Lt14 propio + su parte
      // del baño compartido) — antes, si la sección estaba "cubierta" por un
      // compartido se saltaba entera y su medidor propio nunca se procesaba.
      // El filtro de abajo ya excluye los compartidos (!m.es_compartido), así
      // que no hace falta (ni conviene) saltar la sección completa aquí.
      const medidoresSeccion = medidoresPropiedad.filter((m) => !m.es_general && !m.es_compartido && m.tipo_servicio_id === tipoServicioId && m.seccion_id === s.id);
      const medidoresDeEstaCuenta = medidoresSeccion.filter((m) => (m.cuenta_servicio_id ?? null) === cuentaId);
      if (medidoresSeccion.length) {
        if (!medidoresDeEstaCuenta.length) continue; // todos sus medidores pertenecen a otra(s) cuenta(s)
        const hayVarios = medidoresDeEstaCuenta.length > 1;
        for (const medidorDeEstaCuenta of medidoresDeEstaCuenta) {
          const etiquetaMedidor = `Medidor propio${hayVarios ? ` (${medidorDeEstaCuenta.codigo_medidor || 'sin código'})` : ''}`;
          const lecturas = await listLecturas({ medidorId: medidorDeEstaCuenta.id, periodo });
          const lectura = lecturas[0];
          if (!lectura) {
            filasInfo.push({ seccionNombre: s.nombre, inquilinoNombre: inquilinoPorSeccion.get(s.id) ?? '—', metodoLabel: etiquetaMedidor, ok: false, detalleIndex: null });
            continue;
          }
          const idx = detalle.length;
          detalle.push({ seccion_id: s.id, metodo: 'medidor', lectura_id: lectura.id, consumo: Number(lectura.consumo_calculado) });
          filasInfo.push({
            seccionNombre: s.nombre, inquilinoNombre: inquilinoPorSeccion.get(s.id) ?? '—', metodoLabel: etiquetaMedidor,
            consumoLabel: `${formatNumber(lectura.consumo_calculado, 3)} ${tipoServicio?.unidad_medida ?? ''}`,
            consumo: Number(lectura.consumo_calculado), ok: true, esMedidor: true, detalleIndex: idx,
          });
        }
      } else if (seccionesCubiertasPorCompartido.has(s.id)) {
        // No tiene medidor propio, pero ya recibió su parte de un medidor
        // compartido arriba — no hace falta ninguna fila adicional.
        continue;
      } else if (buscarMontoFijoSeccion(s.id, tipoServicioId) != null) {
        // Sección sin medidor cuyo contrato de alquiler vigente estipula un
        // monto fijo mensual para este servicio (ej. locales de Edificio
        // Polonia). Prioridad sobre la tarifa fija global porque es un dato
        // negociado por contrato, no un default igual para todos. Si el
        // contrato cubre varias secciones, el monto ya viene prorrateado.
        const montoFijo = buscarMontoFijoSeccion(s.id, tipoServicioId);
        const idx = detalle.length;
        detalle.push({ seccion_id: s.id, metodo: 'monto_fijo', n_personas: 1, tarifa_por_persona: montoFijo });
        filasInfo.push({ seccionNombre: s.nombre, inquilinoNombre: inquilinoPorSeccion.get(s.id) ?? '—', metodoLabel: 'Monto fijo (contrato)', ok: true, esMedidor: false, esMontoFijo: true, detalleIndex: idx });
      } else if (!cuentaId && tipoServicio?.permite_tarifa_fija_por_persona) {
        // Tarifa fija solo aplica cuando la propiedad tiene una sola cuenta
        // por servicio — con varias cuentas no hay forma de saber a cuál
        // pertenece una sección sin medidor propio.
        const idx = detalle.length;
        detalle.push({ seccion_id: s.id, metodo: 'tarifa_fija_por_persona', n_personas: 1, tarifa_por_persona: Number(tipoServicio.tarifa_por_persona_default ?? 0) });
        filasInfo.push({ seccionNombre: s.nombre, inquilinoNombre: inquilinoPorSeccion.get(s.id) ?? '—', metodoLabel: 'Tarifa fija por persona', ok: true, esMedidor: false, detalleIndex: idx });
      } else if (!cuentaId) {
        filasInfo.push({ seccionNombre: s.nombre, inquilinoNombre: inquilinoPorSeccion.get(s.id) ?? '—', metodoLabel: 'No prorrateable', ok: false, detalleIndex: null });
      }
      // si cuentaId existe y la sección no tiene medidor de ninguna cuenta, no
      // pertenece a este recibo — se omite sin mostrar fila.
    }

    contenedorDetalle.innerHTML = '';
    if (!filasInfo.length) {
      contenedorDetalle.append(el('p', { style: 'color:var(--gray-500); margin-top:8px;' }, 'Ninguna sección tiene un medidor asignado a esta cuenta todavía. Revisa los medidores en la pestaña "Medidores".'));
      return;
    }

    // El precio unitario por defecto viene del recibo general (mismo cálculo
    // que hace el RPC en el servidor); si el recibo no trae precio propio ni
    // consumo total para derivarlo, se usa el precio por defecto de
    // Configuración (S/ por m3 de agua o kWh de luz) como último recurso.
    // El usuario puede corregirlo siempre antes de confirmar.
    let precioDefault = recibo.precio_unitario != null
      ? Number(recibo.precio_unitario)
      : (Number(recibo.consumo_total_recibo) > 0 ? Math.round((recibo.monto_total_recibo / recibo.consumo_total_recibo) * 10000) / 10000 : 0);
    if (!precioDefault) {
      const cfg = await getConfiguracionCacheada();
      const nombreServicio = (tipoServicio?.nombre ?? '').toLowerCase();
      if (nombreServicio.includes('agua') && cfg?.precio_default_agua_m3 != null) precioDefault = Number(cfg.precio_default_agua_m3);
      else if (nombreServicio.includes('luz') && cfg?.precio_default_luz_kwh != null) precioDefault = Number(cfg.precio_default_luz_kwh);
    }
    let precioActual = precioDefault;

    const tablaWrap = el('div', { class: 'table-wrap', style: 'margin-top:10px;' });
    const totalEl = el('div', { style: 'text-align:right; margin-top:8px; font-weight:600;' });

    function renderTabla() {
      const filas = filasInfo.map((f) => {
        if (!f.ok) {
          return el('tr', {}, [
            el('td', {}, f.seccionNombre), el('td', {}, f.inquilinoNombre ?? '—'), el('td', {}, f.metodoLabel), el('td', {}, '—'), el('td', {}, '—'),
            el('td', {}, el('span', { class: 'badge badge-vencida' }, 'Falta lectura del periodo')),
          ]);
        }
        const item = f.detalleIndex != null ? detalle[f.detalleIndex] : null;
        const monto = f.esMedidor
          ? Math.round(f.consumo * precioActual * 100) / 100
          : Math.round((item?.n_personas ?? 0) * (item?.tarifa_por_persona ?? 0) * 100) / 100;
        return el('tr', {}, [
          el('td', {}, f.seccionNombre),
          el('td', {}, f.inquilinoNombre ?? '—'),
          el('td', {}, f.metodoLabel),
          el('td', {}, f.esMedidor ? f.consumoLabel : (f.esMontoFijo ? [
            'S/ ',
            el('input', { type: 'number', min: '0', step: '0.01', value: String(item.tarifa_por_persona), style: 'width:90px; display:inline-block;', onchange: (evt) => { item.tarifa_por_persona = Number(evt.target.value); renderTabla(); } }),
            ' /mes',
          ] : [
            el('input', { type: 'number', min: '0', value: String(item.n_personas), style: 'width:60px; display:inline-block;', onchange: (evt) => { item.n_personas = Number(evt.target.value); renderTabla(); } }),
            ' pers. × ',
            el('input', { type: 'number', min: '0', step: '0.01', value: String(item.tarifa_por_persona), style: 'width:80px; display:inline-block;', onchange: (evt) => { item.tarifa_por_persona = Number(evt.target.value); renderTabla(); } }),
          ])),
          el('td', { style: 'text-align:right; font-weight:600;' }, formatCurrency(monto)),
          el('td', {}, '✓ listo'),
        ]);
      });
      tablaWrap.innerHTML = '';
      tablaWrap.append(el('table', { class: 'data-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', {}, 'Sección'), el('th', {}, 'Inquilino'), el('th', {}, 'Método'), el('th', {}, 'Consumo / detalle'), el('th', {}, 'Monto'), el('th', {}, '')])]),
        el('tbody', {}, filas),
      ]));
      const totalCalc = filasInfo.filter((f) => f.ok).reduce((s, f) => {
        const item = f.detalleIndex != null ? detalle[f.detalleIndex] : null;
        return s + (f.esMedidor ? f.consumo * precioActual : (item?.n_personas ?? 0) * (item?.tarifa_por_persona ?? 0));
      }, 0);
      totalEl.textContent = `Total de esta cuenta: ${formatCurrency(totalCalc)}`;
    }

    contenedorDetalle.append(
      el('div', { style: 'display:flex; align-items:center; gap:8px; margin-bottom:4px;' }, [
        el('label', { style: 'font-size:13px; color:var(--gray-500);' }, `Precio S/ por ${tipoServicio?.unidad_medida || 'unidad'} (editable, viene del recibo general):`),
        el('input', {
          type: 'number', min: '0', step: '0.0001', value: String(precioDefault), style: 'width:110px;',
          onchange: (evt) => { precioActual = Number(evt.target.value) || 0; renderTabla(); },
        }),
      ]),
      tablaWrap,
      totalEl,
    );
    renderTabla();

    if (detalle.length) {
      const btnConfirmar = el('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:12px;', 'data-admin-only': '' }, 'Confirmar cálculo de esta cuenta');
      btnConfirmar.addEventListener('click', () => confirmarCalculoRecibo(recibo, detalle, () => precioActual, btnConfirmar));
      contenedorDetalle.append(btnConfirmar);
    }
  } catch (err) {
    console.error(err);
    showToast('No se pudo preparar el cálculo de esta cuenta.', 'error');
  }
}

async function confirmarCalculoRecibo(recibo, detalle, getPrecioActual, btn) {
  if (!detalle.length) return;
  if (!confirmAction(`Se guardará el consumo calculado de esta cuenta para ${detalle.length} sección(es). Cuando calcules todas las cuentas de este periodo podrás generar la cobranza combinada. ¿Confirmar?`)) return;
  setLoading(btn, true, 'Calculando…');
  try {
    await calcularPeriodoServicio({
      propiedadId: qs('#ca-propiedad').value,
      tipoServicioId: qs('#ca-tipo-servicio').value,
      periodo: qs('#ca-periodo').value,
      reciboGeneralId: recibo.id,
      detalles: detalle,
      precioUnitario: getPrecioActual(),
    });
    showToast('Cuenta calculada. Cuando termines todas las cuentas del periodo, genera la cobranza combinada abajo.', 'success');
    await buscarRecibosCalculo();
  } catch (err) {
    console.error(err);
    showToast(err.message?.includes('Ya existe') ? 'Ya existe un cálculo confirmado para este recibo.' : 'No se pudo confirmar el cálculo.', 'error');
    setLoading(btn, false);
  }
}

/* ---------------------- Vista previa: cuadro de consumo ---------------------- */
// Se muestra cuando todas las cuentas del periodo ya están calculadas (con
// o sin cobranza generada todavía) — es el mismo cuadro que se le presenta
// al inquilino para que pague, combinando todas sus cuentas por sección.
async function renderVistaPreviaCuadros(contenedor, propiedadId, tipoServicioId, periodo) {
  contenedor.innerHTML = '<div class="skeleton" style="height:60px;"></div>';
  try {
    const [detalleRows, colorLineas] = await Promise.all([
      listDetalleCalculoConLecturas({ propiedadId, tipoServicioId, periodo }),
      getColorLineasTabla(),
    ]);
    const grupos = agruparDetalleParaCuadro(detalleRows);
    contenedor.innerHTML = '';
    if (!grupos.length) {
      contenedor.append(el('p', { style: 'color:var(--gray-500);' }, 'No hay detalle calculado todavía.'));
      return;
    }
    grupos.forEach((grupo, i) => {
      const cuadroId = `cuadro-consumo-preview-${i}`;
      const cuadroEl = buildCuadroConsumoEl(grupo, { colorLineas });
      cuadroEl.id = cuadroId;
      const btnDescargar = el('button', { class: 'btn btn-tertiary btn-sm', style: 'margin-top:8px;' }, '📷 Descargar imagen');
      btnDescargar.addEventListener('click', async () => {
        setLoading(btnDescargar, true, 'Generando…');
        try {
          await descargarCuadroComoImagen(cuadroEl, `cuadro-${grupo.tipoServicioNombre}-${grupo.seccionNombre}-${grupo.periodo}`.replace(/\s+/g, '-').toLowerCase());
        } catch (err) {
          console.error(err);
          showToast(err.message ?? 'No se pudo generar la imagen.', 'error');
        } finally {
          setLoading(btnDescargar, false);
        }
      });
      contenedor.append(el('div', { style: 'margin-bottom:16px;' }, [cuadroEl, btnDescargar]));
    });
  } catch (err) {
    console.error(err);
    contenedor.innerHTML = '<p style="color:var(--color-danger);">No se pudo cargar la vista previa del cuadro de consumo.</p>';
  }
}

main();
