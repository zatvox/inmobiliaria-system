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
  listTiposServicio, guardarServiciosFijosContrato, planSincronizarMontoFijoServicios, aplicarSincronizacionMontoFijoServicios, guardarSeccionesContrato,
  listCuotasAlquilerPendientes, actualizarMontoCuotasAlquilerPendientes,
  planCronogramaAlquiler, aplicarCronogramaAlquiler,
  listPrestamos, getPrestamo, savePrestamo, cronogramaBloqueado,
} from './supabase-data.js';
import { abrirGenerarContrato } from './contrato-ui.js';
import { abrirGenerarContratoPrestamo } from './contrato-prestamo-ui.js';
import { calcularCronograma, recalcularFilas, totalesCronograma, tasaMensual, sumarMeses } from './prestamo-calc.js';
import { qs, qsa, el, formatCurrency, formatDate, badgeHtml, showToast, openModal, closeModal, validateForm, setLoading, debounce, confirmAction } from './utils.js';

let profile = null;
let activeTab = 'alquiler';
let tiposServicioCache = [];
// Secciones que se pueden elegir en el editor de "Secciones del contrato":
// las disponibles + (si se está editando) las que ya tiene ese contrato,
// aunque ya no figuren como "disponibles" en la tabla secciones.
let seccionesAlquilerCache = [];
// Datos del documento de contrato (renovación, garantía, firma…): se guardan
// en contratos_alquiler.datos_contrato (SQL 27) y los usa contrato-ui.js.
let docBase = {};          // lo ya guardado/copiado; el modal solo pisa lo que edita
let docAbonos = [];        // [{ monto, recibo }]
let inquilinosCache = [];
let contratosPrevCache = [];

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
  bindFormPrestamo();
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
    if (activeTab === 'alquiler') openModal('modal-tipo-contrato'); else openVentaModal();
  });
  qsa('#modal-tipo-contrato [data-nuevo]').forEach((b) => b.addEventListener('click', () => {
    closeModal('modal-tipo-contrato');
    if (b.dataset.nuevo === 'prestamo') openPrestamoModal(); else openAlquilerModal();
  }));
  qs('#search-input')?.addEventListener('input', debounce(refresh, 350));
  // Filtro multiselect Alquiler / Préstamos (ambos marcados = todos).
  qsa('#filtro-tipo input[type=checkbox]').forEach((c) => c.addEventListener('change', () => {
    if (!tiposFiltro().length) { c.checked = true; showToast('Deja al menos un tipo seleccionado.', 'info', 2500); return; }
    actualizarResumenFiltro();
    refresh();
  }));
  document.addEventListener('click', (e) => { const d = qs('#filtro-tipo'); if (d?.open && !d.contains(e.target)) d.open = false; });
}

const tiposFiltro = () => qsa('#filtro-tipo input[type=checkbox]:checked').map((c) => c.value);
function actualizarResumenFiltro() {
  const t = tiposFiltro();
  qs('#filtro-tipo-resumen').textContent = `Tipo: ${t.length === 2 ? 'Alquiler y préstamos' : t[0] === 'alquiler' ? 'Solo alquiler' : 'Solo préstamos'}`;
}

async function refresh() {
  const search = qs('#search-input')?.value ?? '';
  const filtro = qs('#filtro-tipo');
  if (filtro) filtro.style.display = activeTab === 'alquiler' ? '' : 'none';
  if (activeTab === 'alquiler') await renderAlquiler(search);
  else await renderVenta(search);
}

/* ================================ ALQUILER ================================== */
async function renderAlquiler(search = '') {
  const tbody = qs('#alquiler-tbody');
  try {
    const tipos = tiposFiltro();
    const [alq, pres] = await Promise.all([
      tipos.includes('alquiler') ? listContratosAlquiler({ search }) : Promise.resolve([]),
      tipos.includes('prestamo') ? listPrestamos({ search }).catch((err) => {
        console.error(err);
        showToast('No se pudieron cargar los préstamos: ejecuta el SQL 33 (assets/sql/33_migrations-prestamos.sql) en Supabase.', 'warning', 7000);
        return [];
      }) : Promise.resolve([]),
    ]);
    const filas = [
      ...alq.map((c) => ({ tipo: 'alquiler', fecha: c.fecha_inicio ?? '', c })),
      ...pres.map((p) => ({ tipo: 'prestamo', fecha: p.fecha_desembolso ?? '', c: p })),
    ].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    tbody.innerHTML = '';
    if (!filas.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '10' }, [
        el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '📄'), el('p', {}, 'Sin contratos para el filtro elegido.')]),
      ])]));
      return;
    }
    filas.forEach((f) => tbody.append(f.tipo === 'alquiler' ? renderRowAlquiler(f.c) : renderRowPrestamo(f.c)));
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar los contratos.', 'error');
  }
}

function renderRowPrestamo(p) {
  const cron = p.cronograma ?? [];
  const ultima = cron.length ? cron[cron.length - 1].fecha_pago : null;
  const cuota = cron[0]?.cuota ?? 0;
  const tasaTxt = `${Number(p.tasa_valor)}% ${p.tasa_tipo === 'anual' ? 'anual' : 'mensual'}`;
  const vista = { estado: p.estado, fecha_inicio: p.fecha_desembolso, fecha_fin: ultima, renovacion_automatica: false };
  return el('tr', {}, [
    el('td', {}, '—'),
    el('td', {}, '—'),
    el('td', {}, [
      el('div', { style: 'font-weight:600;' }, [el('span', { class: 'tipo-chip pres' }, 'PRÉSTAMO'), formatCurrency(p.monto, p.moneda)]),
      el('div', { style: 'font-size:11px; color:var(--gray-500);' }, `${p.n_cuotas} cuotas · ${tasaTxt}`),
    ]),
    el('td', {}, [p.prestatario?.nombre ?? '—', el('div', { style: 'font-size:11px; color:var(--gray-500);' }, `Prestamista: ${p.prestamista?.nombre ?? '—'}${p.aval ? ` · Aval: ${p.aval.nombre}` : ''}`)]),
    el('td', {}, [formatCurrency(cuota, p.moneda), el('div', { style: 'font-size:11px; color:var(--gray-500);' }, 'por cuota')]),
    el('td', { class: 'n', title: 'Día de pago mensual de la cuota' }, p.dia_vencimiento ? String(p.dia_vencimiento) : '—'),
    el('td', {}, `${formatDate(p.fecha_desembolso)} → ${ultima ? formatDate(ultima) : '—'}`),
    el('td', { html: badgeHtml(p.estado) }),
    celdaVencimiento(vista),
    el('td', { class: 'actions' }, [
      el('button', { class: 'btn btn-tertiary btn-sm', title: 'Generar el contrato de préstamo (Word / PDF)', onclick: () => abrirGenerarContratoPrestamo(p.id) }, '📄 Contrato'),
      el('button', { class: 'btn btn-tertiary btn-sm', 'data-admin-only': '', onclick: () => editPrestamo(p.id) }, 'Editar'),
    ]),
  ]);
}

async function editPrestamo(id) {
  try {
    openPrestamoModal(await getPrestamo(id));
  } catch (err) {
    console.error(err);
    showToast('No se pudo cargar el préstamo.', 'error');
  }
}

/* ================================ PRÉSTAMO =================================== */
let prFilas = [];
let prEdit = null;
let prBloqueado = false;
let prFilasOriginales = '';
const PR_FIN = ['#pr-prestamista', '#pr-prestatario', '#pr-moneda', '#pr-monto', '#pr-ncuotas', '#pr-tasa', '#pr-tasa-tipo', '#pr-fecha-desembolso', '#pr-fecha-primera'];
const num = (id) => Number(qs(id).value) || 0;
const hoyISO = () => new Date().toISOString().slice(0, 10);

async function openPrestamoModal(p = null) {
  const form = qs('#form-prestamo');
  form.reset();
  qsa('.form-field', form).forEach((f) => f.classList.remove('invalid'));
  prEdit = p;
  prBloqueado = !!p && cronogramaBloqueado(p);
  qs('#modal-prestamo-title').textContent = p ? 'Editar contrato de préstamo' : 'Nuevo contrato de préstamo';

  const personas = await listPersonas({});
  const llenar = (id, vacio) => {
    const s = qs(id);
    s.innerHTML = `<option value="">${vacio}</option>`;
    personas.forEach((x) => s.append(el('option', { value: x.id }, `${x.nombre}${x.dni_ruc ? ` · ${x.dni_ruc}` : ''}`)));
  };
  llenar('#pr-prestamista', 'Selecciona…');
  llenar('#pr-prestatario', 'Selecciona…');
  llenar('#pr-aval', 'Selecciona…');
  qs('#pr-tiene-aval').checked = false;
  qs('#pr-aval-field').style.display = 'none';
  qs('#pr-estado-field').style.display = p ? 'block' : 'none';

  if (p) {
    qs('#pr-prestamista').value = p.prestamista_id;
    qs('#pr-prestatario').value = p.prestatario_id;
    qs('#pr-moneda').value = p.moneda;
    qs('#pr-monto').value = p.monto;
    qs('#pr-ncuotas').value = p.n_cuotas;
    qs('#pr-tasa').value = p.tasa_valor;
    qs('#pr-tasa-tipo').value = p.tasa_tipo;
    qs('#pr-fecha-desembolso').value = p.fecha_desembolso;
    qs('#pr-fecha-primera').value = p.fecha_primera_cuota;
    qs('#pr-garantia').value = p.garantia ?? '';
    qs('#pr-notas').value = p.notas ?? '';
    qs('#pr-estado').value = p.estado;
    if (p.aval_id) { qs('#pr-tiene-aval').checked = true; qs('#pr-aval-field').style.display = 'block'; qs('#pr-aval').value = p.aval_id; }
    prFilas = (p.cronograma ?? []).map((f) => ({ nro: f.nro, fecha_pago: f.fecha_pago, cuota: Number(f.cuota), capital: Number(f.capital), interes: Number(f.interes), saldo_capital: Number(f.saldo_capital) }));
    prFilasOriginales = JSON.stringify(prFilas);
  } else {
    qs('#pr-moneda').value = 'PEN';
    qs('#pr-tasa-tipo').value = 'mensual';
    qs('#pr-fecha-desembolso').value = hoyISO();
    qs('#pr-fecha-primera').value = sumarMeses(hoyISO(), 1);
    prFilas = [];
    prFilasOriginales = '';
  }
  PR_FIN.forEach((id) => { qs(id).disabled = prBloqueado; });
  const aviso = qs('#pr-bloqueo');
  aviso.style.display = prBloqueado ? 'block' : 'none';
  aviso.textContent = prBloqueado ? 'Este préstamo ya tiene cuotas con pagos: monto, tasa, fechas y cronograma quedan bloqueados. Para cambiarlos, anula primero los pagos en Cobranzas. Puedes editar aval, garantía, estado y notas.' : '';
  qs('#pr-recalcular').style.display = prBloqueado ? 'none' : '';
  if (!p) recalcularAuto(); else pintarCronograma();
  openModal('modal-prestamo');
}

function recalcularAuto() {
  prFilas = calcularCronograma({
    monto: num('#pr-monto'), nCuotas: num('#pr-ncuotas'), tasaValor: num('#pr-tasa'), tasaTipo: qs('#pr-tasa-tipo').value,
    fechaPrimeraCuota: qs('#pr-fecha-primera').value,
  });
  pintarCronograma();
}

const fm = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function actualizarTotalesCronograma() {
  const monto = num('#pr-monto');
  const t = totalesCronograma(prFilas);
  const saldoFinal = prFilas.length ? prFilas[prFilas.length - 1].saldo_capital : 0;
  const tm = tasaMensual(num('#pr-tasa'), qs('#pr-tasa-tipo').value);
  const ok = Math.abs(saldoFinal) < 0.005 && Math.abs(t.capital - monto) < 0.005;
  qs('#pr-resumen').innerHTML = prFilas.length
    ? `<span>Tasa mensual: <b>${tm.toFixed(4)}%</b></span><span>Total capital: <b>${fm(t.capital)}</b></span><span>Total intereses: <b>${fm(t.interes)}</b></span><span>Total a pagar: <b>${fm(t.cuota)}</b></span>${ok ? '<span style="color:#15803D;">✓ El saldo llega a 0</span>' : `<span style="color:#DC2626;">⚠ Saldo final ${fm(saldoFinal)} (debe ser 0)</span>`}`
    : '';
  qs('#pr-cron-foot').innerHTML = prFilas.length ? `<tr><td>Total</td><td>${fm(t.cuota)}</td><td>${fm(t.capital)}</td><td>${fm(t.interes)}</td><td></td><td></td></tr>` : '';
  prFilas.forEach((f, i) => {
    const row = qs('#pr-cron-body').children[i];
    if (!row) return;
    row.querySelector('.c-cuota').textContent = fm(f.cuota);
    row.querySelector('.c-saldo').textContent = fm(f.saldo_capital);
  });
}

function pintarCronograma() {
  const body = qs('#pr-cron-body');
  body.innerHTML = '';
  if (!prFilas.length) {
    body.append(el('tr', {}, [el('td', { colspan: '6', style: 'text-align:center; color:var(--gray-500); padding:16px;' }, 'Completa monto, cuotas, tasa y fecha de la 1.ª cuota.')]));
    actualizarTotalesCronograma();
    return;
  }
  prFilas.forEach((f, i) => {
    const cap = el('input', { type: 'number', step: '0.01', min: '0' }); cap.value = f.capital; cap.disabled = prBloqueado;
    const int = el('input', { type: 'number', step: '0.01', min: '0' }); int.value = f.interes; int.disabled = prBloqueado;
    const fec = el('input', { type: 'date' }); fec.value = f.fecha_pago; fec.disabled = prBloqueado;
    const editar = () => {
      prFilas[i].capital = Number(cap.value) || 0;
      prFilas[i].interes = Number(int.value) || 0;
      prFilas = recalcularFilas(prFilas, num('#pr-monto'));
      actualizarTotalesCronograma();
    };
    cap.addEventListener('input', editar);
    int.addEventListener('input', editar);
    fec.addEventListener('change', () => { prFilas[i].fecha_pago = fec.value; });
    body.append(el('tr', {}, [
      el('td', {}, String(f.nro)),
      el('td', { class: 'c-cuota', style: 'font-weight:600;' }, fm(f.cuota)),
      el('td', {}, [cap]), el('td', {}, [int]),
      el('td', { class: 'c-saldo' }, fm(f.saldo_capital)),
      el('td', {}, [fec]),
    ]));
  });
  actualizarTotalesCronograma();
}

function bindFormPrestamo() {
  const form = qs('#form-prestamo');
  if (!form) return;
  ['#pr-monto', '#pr-ncuotas', '#pr-tasa', '#pr-tasa-tipo', '#pr-fecha-primera'].forEach((id) => {
    qs(id).addEventListener('input', () => { if (!prBloqueado) recalcularAuto(); });
    qs(id).addEventListener('change', () => { if (!prBloqueado) recalcularAuto(); });
  });
  const fd = qs('#pr-fecha-desembolso');
  fd.addEventListener('focus', () => { fd.dataset.previo = fd.value; });
  fd.addEventListener('change', () => {
    // Si la 1.ª cuota seguía el patrón "desembolso + 1 mes", se mueve con él.
    const fp = qs('#pr-fecha-primera');
    if (!prBloqueado && fd.value && (!fp.value || (fd.dataset.previo && fp.value === sumarMeses(fd.dataset.previo, 1)))) {
      fp.value = sumarMeses(fd.value, 1);
      recalcularAuto();
    }
  });
  qs('#pr-recalcular').addEventListener('click', recalcularAuto);
  qs('#pr-tiene-aval').addEventListener('change', (e) => {
    qs('#pr-aval-field').style.display = e.target.checked ? 'block' : 'none';
    if (!e.target.checked) qs('#pr-aval').value = '';
  });
  qs('#pr-tasa-tipo').addEventListener('change', () => {
    qs('#pr-tasa-hint').textContent = qs('#pr-tasa-tipo').value === 'anual' ? 'Tasa anual: se convierte a mensual dividiendo entre 12.' : 'Tasa mensual aplicada sobre el monto del préstamo en cada cuota.';
  });

  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    if (qs('#pr-prestamista').value === qs('#pr-prestatario').value) { showToast('El prestamista y el prestatario no pueden ser la misma persona.', 'error'); return; }
    const monto = num('#pr-monto');
    if (!prFilas.length) { showToast('No hay cronograma: revisa monto, cuotas, tasa y fecha de la 1.ª cuota.', 'error'); return; }
    const t = totalesCronograma(prFilas);
    const saldoFinal = prFilas[prFilas.length - 1].saldo_capital;
    if (Math.abs(saldoFinal) > 0.005 || Math.abs(t.capital - monto) > 0.005) { showToast(`El capital del cronograma (${fm(t.capital)}) debe sumar el monto (${fm(monto)}) y el saldo final llegar a 0.`, 'error', 6000); return; }
    if (prFilas.some((f, i) => i && f.fecha_pago < prFilas[i - 1].fecha_pago)) { showToast('Las fechas de pago deben ir en orden cronológico.', 'error'); return; }

    const editingId = prEdit?.id ?? '';
    const cambioCronograma = !prBloqueado && editingId && (JSON.stringify(prFilas) !== prFilasOriginales || prEdit.monto != monto
      || prEdit.n_cuotas !== num('#pr-ncuotas') || Number(prEdit.tasa_valor) !== num('#pr-tasa') || prEdit.tasa_tipo !== qs('#pr-tasa-tipo').value);
    if (cambioCronograma && !confirmAction('Cambiaste el monto, la tasa, las cuotas o el cronograma.\n\nSe ANULARÁN las cuotas pendientes actuales de este préstamo (ninguna tiene pagos) y se crearán las nuevas. ¿Continuar?')) return;

    const payload = {
      aval_id: qs('#pr-tiene-aval').checked ? (qs('#pr-aval').value || null) : null,
      garantia: qs('#pr-garantia').value.trim() || null,
      notas: qs('#pr-notas').value.trim() || null,
    };
    if (editingId) payload.estado = qs('#pr-estado').value;
    if (!prBloqueado) {
      Object.assign(payload, {
        prestamista_id: qs('#pr-prestamista').value, prestatario_id: qs('#pr-prestatario').value,
        moneda: qs('#pr-moneda').value, monto, n_cuotas: prFilas.length,
        tasa_valor: num('#pr-tasa'), tasa_tipo: qs('#pr-tasa-tipo').value,
        tasa_mensual: Math.round(tasaMensual(num('#pr-tasa'), qs('#pr-tasa-tipo').value) * 1e6) / 1e6,
        fecha_desembolso: qs('#pr-fecha-desembolso').value, fecha_primera_cuota: prFilas[0].fecha_pago,
        dia_vencimiento: Number(prFilas[0].fecha_pago.slice(8, 10)),
      });
    }
    const btn = qs('#btn-guardar-prestamo');
    setLoading(btn, true);
    try {
      await savePrestamo(payload, prFilas, { id: editingId, reemplazarCronograma: !!cambioCronograma });
      showToast(editingId ? 'Préstamo actualizado.' : `Préstamo creado. Se generaron ${prFilas.length} cuotas por cobrar (serie PRES).`, 'success');
      closeModal('modal-prestamo');
      await refresh();
    } catch (err) {
      console.error(err);
      showToast(/contratos_prestamo|prestamo_cronograma|origen/.test(err?.message ?? '') ? 'Falta ejecutar el SQL 33 (assets/sql/33_migrations-prestamos.sql) en Supabase.' : 'No se pudo guardar el préstamo.', 'error', 7000);
    } finally {
      setLoading(btn, false);
    }
  });
}

// Barra de vencimiento de horizonte fijo: todas las filas se miden contra la
// misma regla (próximos 12 meses), así se comparan contratos entre sí.
// Rojo: vencido o < 30 días · ámbar: 30–90 · neutro: > 90. Indefinido = ∞.
// Con renovación automática la barra va apagada (+ ↻): vence, pero no requiere acción.
const HORIZONTE_DIAS = 365, UMBRAL_URGENTE = 30, UMBRAL_AVISO = 90;
function celdaVencimiento(c) {
  const td = el('td', { style: 'white-space:nowrap;' });
  if (!['vigente', 'por_vencer'].includes(c.estado)) { td.textContent = '—'; td.style.color = 'var(--gray-400)'; return td; }
  if (!c.fecha_fin) {
    td.append(el('span', { title: `${formatDate(c.fecha_inicio)} → indefinido`, style: 'color:var(--gray-400); font-size:16px;' }, '∞'));
    return td;
  }
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const dias = Math.round((new Date(`${c.fecha_fin}T00:00:00`) - hoy) / 86400000);
  const auto = !!c.renovacion_automatica;
  const color = dias < UMBRAL_URGENTE ? '#DC2626' : dias <= UMBRAL_AVISO ? '#F59E0B' : '#94A3B8';
  const pct = dias <= 0 ? 3 : Math.max(4, Math.min(100, (dias / HORIZONTE_DIAS) * 100));
  const texto = dias < 0 ? `venció hace ${-dias} d` : dias === 0 ? 'vence hoy' : dias > 90 ? `${Math.round(dias / 30.4)} m` : `${dias} d`;
  const tip = `${formatDate(c.fecha_inicio)} → ${formatDate(c.fecha_fin)} · ${dias < 0 ? `venció hace ${-dias} días` : `faltan ${dias} días`}${auto ? ' · renovación automática' : ''}`;
  td.title = tip;
  td.append(el('div', { style: `display:flex; align-items:center; gap:8px; ${auto ? 'opacity:.5;' : ''}` }, [
    el('div', { style: 'width:90px; height:8px; background:var(--gray-100); border-radius:999px; overflow:hidden; flex:none;' }, [
      el('div', { style: `width:${pct}%; height:100%; background:${color}; border-radius:999px;` }),
    ]),
    el('span', { style: `font-size:12px; font-weight:${dias < UMBRAL_URGENTE && !auto ? 700 : 500}; color:${dias < UMBRAL_URGENTE && !auto ? color : 'var(--gray-600)'}; min-width:56px;` }, texto),
    auto ? el('span', { title: 'Renovación automática', style: 'font-size:13px;' }, '↻') : null,
  ]));
  return td;
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
    el('td', {}, formatCurrency(c.monto_renta, c.moneda)),
    el('td', { class: 'n', title: 'Día de vencimiento mensual de la cuota' },
       c.dia_vencimiento ? String(c.dia_vencimiento) : '—'),
    el('td', {}, `${formatDate(c.fecha_inicio)} → ${c.fecha_fin ? formatDate(c.fecha_fin) : 'indefinido'}`),
    el('td', { html: badgeHtml(c.estado) }),
    celdaVencimiento(c),
    el('td', { class: 'actions' }, [
      el('button', { class: 'btn btn-tertiary btn-sm', title: 'Generar el documento del contrato (Word / PDF)', onclick: () => abrirGenerarContrato(c.id) }, '📄 Contrato'),
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
  // Monto de renta tal cual estaba al abrir el modal — se compara contra lo
  // que el usuario termine guardando para saber si hay que avisar sobre las
  // cuotas pendientes (ver bindFormAlquiler).
  form.dataset.originalMontoRenta = contrato ? String(contrato.monto_renta ?? 0) : '';
  form.dataset.originalFechaInicio = contrato?.fecha_inicio ?? '';
  form.dataset.originalFechaFin = contrato?.fecha_fin ?? '';
  form.dataset.originalDiaVenc = contrato ? String(contrato.dia_vencimiento ?? '') : '';
  form.dataset.originalEstado = contrato?.estado ?? '';

  const [secciones, inquilinos, agentes, avales, contratosPrev] = await Promise.all([
    listSeccionesDisponibles({ paraVenta: false }),
    listPersonas({ rol: 'inquilino' }),
    listPersonas({ rol: 'agente' }),
    listPersonas({ rol: 'aval' }),
    listContratosAlquiler({}),
  ]);
  inquilinosCache = inquilinos;
  contratosPrevCache = contratosPrev;

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
    form.dataset.originalServiciosFijos = JSON.stringify(Object.fromEntries((contrato.servicios_fijos ?? []).map((sf) => [sf.tipo_servicio_id, Number(sf.monto_fijo)])));

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
  docBase = contrato?.datos_contrato && typeof contrato.datos_contrato === 'object' ? JSON.parse(JSON.stringify(contrato.datos_contrato)) : {};
  llenarCamposDoc();
  poblarContratosPrevios();
  qs('#al-doc-details').open = !!docBase.renovacion?.es;
  openModal('modal-alquiler');
}

/* ---------- Datos para el documento (renovación / garantía / firma) ---------- */
const esEmpresa = (p) => p?.tipo_documento === 'RUC' || /^(10|15|17|20)\d{9}$/.test(p?.dni_ruc ?? '');
const mergeDeep = (base, extra) => {
  if (extra === undefined || extra === null) return base;
  if (Array.isArray(base) || Array.isArray(extra) || typeof base !== 'object' || typeof extra !== 'object' || base === null) return extra;
  const out = { ...base };
  Object.keys(extra).forEach((k) => { out[k] = mergeDeep(base[k], extra[k]); });
  return out;
};

function pintarAbonosDoc() {
  const cont = qs('#al-doc-abonos');
  cont.innerHTML = '';
  docAbonos.forEach((a, i) => {
    const monto = el('input', { type: 'number', step: '0.01', min: '0', placeholder: 'Monto', value: a.monto ?? '', style: 'width:130px;' });
    const recibo = el('input', { type: 'text', placeholder: 'N° de recibo', value: a.recibo ?? '', style: 'flex:1;' });
    monto.addEventListener('input', () => { a.monto = monto.value; resumenAbonosDoc(); });
    recibo.addEventListener('input', () => { a.recibo = recibo.value; });
    cont.append(el('div', { style: 'display:flex; gap:8px; align-items:center; margin-bottom:6px;' }, [
      monto, recibo, el('button', { type: 'button', class: 'btn btn-tertiary btn-sm', onclick: () => { docAbonos.splice(i, 1); pintarAbonosDoc(); } }, '✕'),
    ]));
  });
  resumenAbonosDoc();
}

function resumenAbonosDoc() {
  const dep = Number(qs('#al-deposito').value) || 0;
  const suma = docAbonos.reduce((s, a) => s + (Number(a.monto) || 0), 0);
  const r = qs('#al-doc-abonos-resumen');
  if (!docAbonos.length) { r.textContent = dep ? `Garantía pactada: ${formatCurrency(dep)}. Sin abonos registrados.` : ''; return; }
  const saldo = Math.round((dep - suma) * 100) / 100;
  r.textContent = `Abonado ${formatCurrency(suma)}${dep ? ` de ${formatCurrency(dep)} — ${Math.abs(saldo) < 0.005 ? 'garantía completa ✓' : (saldo > 0 ? `saldo pendiente ${formatCurrency(saldo)}` : `excede en ${formatCurrency(-saldo)}`)}` : ''}`;
}

function actualizarVisibilidadDoc() {
  const renov = qs('#al-doc-tipo').value === 'renovacion';
  qs('#al-doc-prev-wrap').style.display = renov ? 'block' : 'none';
  qs('#al-doc-anterior-wrap').style.display = renov ? 'block' : 'none';
  const persona = inquilinosCache.find((p) => p.id === qs('#al-inquilino').value);
  qs('#al-doc-rep-wrap').style.display = esEmpresa(persona) ? 'block' : 'none';
}

function llenarCamposDoc() {
  const d = docBase ?? {};
  qs('#al-doc-tipo').value = d.renovacion?.es ? 'renovacion' : 'nuevo';
  qs('#al-doc-fecha-anterior').value = d.renovacion?.fechaAnterior ?? '';
  qs('#al-doc-fecha-firma').value = d.fechaFirma ?? '';
  qs('#al-doc-uso').value = d.uso ?? 'comercial';
  qs('#al-doc-aumento').value = d.aumentoPct ?? '';
  qs('#al-doc-modalidad').value = d.garantia?.modalidad ?? '';
  qs('#al-doc-penalidad').value = d.penalidadDiaria ?? '';
  qs('#al-doc-rep-trat').value = d.inq?.repTratamiento ?? 'el Sr.';
  qs('#al-doc-rep-nombre').value = d.inq?.repNombre ?? '';
  qs('#al-doc-rep-cargo').value = d.inq?.repCargo ?? '';
  qs('#al-doc-partida').value = d.inq?.partida ?? '';
  qs('#al-doc-oficina').value = d.inq?.oficinaRegistral ?? '';
  docAbonos = (d.garantia?.abonos ?? []).map((a) => ({ ...a }));
  pintarAbonosDoc();
  actualizarVisibilidadDoc();
}

/** Campos del modal → objeto para datos_contrato (conserva lo demás ya guardado). */
function recogerDatosDoc() {
  const v = (id) => qs(id).value.trim();
  const patch = {
    renovacion: { es: qs('#al-doc-tipo').value === 'renovacion', fechaAnterior: v('#al-doc-fecha-anterior') },
    fechaFirma: v('#al-doc-fecha-firma'),
    uso: qs('#al-doc-uso').value,
    garantia: { modalidad: v('#al-doc-modalidad'), abonos: docAbonos.filter((a) => Number(a.monto) > 0).map((a) => ({ monto: Number(a.monto), recibo: (a.recibo ?? '').trim() })) },
    inq: { repTratamiento: qs('#al-doc-rep-trat').value, repNombre: v('#al-doc-rep-nombre'), repCargo: v('#al-doc-rep-cargo'), partida: v('#al-doc-partida'), oficinaRegistral: v('#al-doc-oficina') },
  };
  if (v('#al-doc-aumento') !== '') patch.aumentoPct = Number(v('#al-doc-aumento'));
  if (v('#al-doc-penalidad') !== '') patch.penalidadDiaria = Number(v('#al-doc-penalidad'));
  return mergeDeep(docBase ?? {}, patch);
}

/** Renovación: copia al formulario lo del contrato anterior (editable después). */
async function prellenarDesdeAnterior(prevId) {
  if (!prevId) return;
  try {
    const prev = await getContratoAlquiler(prevId);
    const d = prev.datos_contrato ?? {};
    docBase = mergeDeep(d, {});
    delete docBase.fechaFirma;
    docBase.renovacion = { es: true, fechaAnterior: prev.fecha_inicio ?? '' };
    llenarCamposDoc();
    qs('#al-doc-tipo').value = 'renovacion';
    actualizarVisibilidadDoc();
    if (!qs('#al-deposito').value && prev.deposito_garantia) qs('#al-deposito').value = prev.deposito_garantia;
    if (!qs('#al-dia-venc').value && prev.dia_vencimiento) qs('#al-dia-venc').value = prev.dia_vencimiento;
    if (!qs('#al-fecha-inicio').value && prev.fecha_fin) qs('#al-fecha-inicio').value = prev.fecha_fin;
    if (prev.aval_id && !qs('#al-tiene-aval').checked) {
      qs('#al-tiene-aval').checked = true; qs('#al-aval-field').style.display = 'block'; qs('#al-aval').value = prev.aval_id;
    }
    if (!qs('#al-servicios-fijos-list').children.length) (prev.servicios_fijos ?? []).forEach((sf) => agregarFilaServicioFijo(sf.tipo_servicio_id, sf.monto_fijo));
    if (!qs('#al-ocupantes').value && prev.n_ocupantes) qs('#al-ocupantes').value = prev.n_ocupantes;
    pintarAbonosDoc();
    showToast('Datos copiados del contrato anterior. Revisa fechas, renta y abonos.', 'info');
  } catch (err) {
    console.error(err);
    showToast('No se pudo leer el contrato anterior.', 'error');
  }
}

function poblarContratosPrevios() {
  const sel = qs('#al-doc-prev');
  const inq = qs('#al-inquilino').value;
  sel.innerHTML = '<option value="">Selecciona…</option>';
  contratosPrevCache
    .filter((c) => (!inq || c.inquilino?.id === inq) && c.id !== qs('#form-alquiler').dataset.editingId)
    .forEach((c) => sel.append(el('option', { value: c.id }, `${c.seccion?.propiedades?.nombre_referencial ?? ''} · ${c.seccion?.nombre ?? ''} (${formatDate(c.fecha_inicio)} → ${c.fecha_fin ? formatDate(c.fecha_fin) : 'indef.'})`)));
}

/** Guarda; si la columna datos_contrato aún no existe (SQL 27), reintenta sin ella. */
async function guardarConFallbackDatos(fn, payload) {
  try {
    return await fn(payload);
  } catch (err) {
    if (payload.datos_contrato && /datos_contrato/.test(err?.message ?? '')) {
      const { datos_contrato: _omitido, ...sinDatos } = payload;
      const res = await fn(sinDatos);
      showToast('Contrato guardado, pero los datos del documento no: ejecuta el SQL 27 (assets/sql/27_migrations-contrato-datos.sql) en Supabase.', 'warning', 8000);
      return res;
    }
    throw err;
  }
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
  // El día de las cuotas sale de "Día de vencimiento": al mover la fecha de
  // inicio se ajusta solo (si no, el cronograma quedaba en el día anterior y
  // "no cambiaba nada"), junto con las secciones originales que usaban la fecha vieja.
  const fi = qs('#al-fecha-inicio');
  fi?.addEventListener('focus', () => { fi.dataset.previo = fi.value; });
  fi?.addEventListener('change', () => {
    const previo = fi.dataset.previo || '';
    if (!fi.value) return;
    const dia = Number(fi.value.slice(8, 10));
    if (Number(qs('#al-dia-venc').value) !== dia) {
      qs('#al-dia-venc').value = dia;
      showToast(`Día de vencimiento ajustado a ${dia} (según la fecha de inicio). Puedes cambiarlo si es otro.`, 'info', 5000);
    }
    qsa('#al-secciones-list > div').forEach((row) => {
      const f = row.querySelector('.sec-fecha-inicio');
      if (f && row.dataset.esAdenda !== 'true' && (!f.value || f.value === previo)) f.value = fi.value;
    });
    fi.dataset.previo = fi.value;
  });
  qs('#btn-doc-add-abono')?.addEventListener('click', () => { docAbonos.push({ monto: '', recibo: '' }); pintarAbonosDoc(); });
  qs('#al-doc-tipo')?.addEventListener('change', () => { actualizarVisibilidadDoc(); if (qs('#al-doc-tipo').value === 'renovacion') poblarContratosPrevios(); });
  qs('#al-doc-prev')?.addEventListener('change', (e) => prellenarDesdeAnterior(e.target.value));
  qs('#al-inquilino')?.addEventListener('change', () => { actualizarVisibilidadDoc(); poblarContratosPrevios(); });
  qs('#al-deposito')?.addEventListener('input', resumenAbonosDoc);
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

    // Validaciones de fechas / día de pago.
    const fechaInicio = qs('#al-fecha-inicio').value;
    const fechaFin = qs('#al-fecha-fin').value;
    const diaVenc = Number(qs('#al-dia-venc').value);
    if (!Number.isInteger(diaVenc) || diaVenc < 1 || diaVenc > 31) { showToast('El día de vencimiento debe estar entre 1 y 31.', 'error'); return; }
    if (fechaFin && fechaFin < fechaInicio) { showToast('La fecha de fin no puede ser anterior a la fecha de inicio del contrato.', 'error'); return; }
    if (filasSecciones.some((f) => f.fecha_fin && f.fecha_fin < f.fecha_inicio)) { showToast('En una sección, la fecha de fin no puede ser anterior a su inicio.', 'error'); return; }
    const inicioOriginales = filasSecciones.filter((f) => !f.es_adenda && (!editingId || f._existente)).map((f) => f.fecha_inicio).sort()[0];
    if (inicioOriginales && inicioOriginales !== fechaInicio) {
      if (!confirmAction(`La fecha de inicio del contrato (${formatDate(fechaInicio)}) no coincide con la de su sección original (${formatDate(inicioOriginales)}).\n\n¿Guardar así de todos modos?`)) return;
    }

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

    // Si se está editando un contrato y el monto de renta total cambió, las
    // cuotas que ya se generaron (al crear el contrato) quedan con el monto
    // VIEJO — generar_cuotas_alquiler solo corre una vez, al crear. Se avisa
    // explícitamente cuáles cuotas pendientes se actualizarían y se pide
    // confirmación antes de tocarlas; las ya pagadas o anuladas nunca se
    // tocan, para no alterar el historial de cobros ya cerrado.
    const montoRentaOriginal = Number(form.dataset.originalMontoRenta || 0);
    const montoCambio = editingId && Math.abs(montoRentaTotal - montoRentaOriginal) > 0.009;
    let cuotasPendientes = [];
    let sincronizarCuotas = false;
    if (montoCambio) {
      try {
        cuotasPendientes = await listCuotasAlquilerPendientes(editingId);
      } catch (err) {
        console.error(err);
      }
      if (cuotasPendientes.length) {
        const desde = formatDate(cuotasPendientes[0].fecha_vencimiento);
        const hasta = formatDate(cuotasPendientes[cuotasPendientes.length - 1].fecha_vencimiento);
        sincronizarCuotas = confirmAction(
          `El monto de renta cambió de ${formatCurrency(montoRentaOriginal)} a ${formatCurrency(montoRentaTotal)}.\n\n` +
          `Este contrato tiene ${cuotasPendientes.length} cuota(s) pendiente(s) de cobro (${desde} – ${hasta}) todavía con el monto anterior.\n\n` +
          `¿Actualizar también esas cuotas pendientes al nuevo monto? Las cuotas ya pagadas no se tocan.`,
        );
      }
    }

    // Si cambió el inicio, el fin o el día de pago, el cronograma de cuotas
    // cambia: se calcula qué cuotas sin pagos quedarían obsoletas (se anulan,
    // no se borran) y cuáles faltan por crear, y se pide confirmación.
    let planCronograma = null;
    const fechasCambiaron = editingId && (
      fechaInicio !== form.dataset.originalFechaInicio
      || (fechaFin || '') !== form.dataset.originalFechaFin
      || String(diaVenc) !== form.dataset.originalDiaVenc
    );
    if (editingId) {
      try {
        // Sin cambio de fechas igual se revisa si quedaron cuotas duplicadas u
        // obsoletas de una edición anterior (solo se anulan, no se crean).
        const plan = await planCronogramaAlquiler(editingId, { fecha_inicio: fechaInicio, dia_vencimiento: diaVenc, fecha_fin: fechaFin || null }, { soloObsoletas: !fechasCambiaron, reemplazarTodo: !!fechasCambiaron });
        if (plan.bloqueadas?.length) {
          const lista = plan.bloqueadas.slice(0, 6).map((c) => `• ${formatDate(c.fecha_vencimiento)} (${c.estado})`).join('\n');
          alert(`No se puede cambiar las fechas / el día de pago: ${plan.bloqueadas.length} cuota(s) ya tienen pagos registrados:\n\n${lista}${plan.bloqueadas.length > 6 ? '\n• …' : ''}\n\nPrimero anula esos pagos en Cobranzas y Pagos → Abonos (⋮ → Anular pago) y vuelve a guardar el contrato. Nada se guardó.`);
          return;
        }
        if (plan.anular.length || plan.crear.length) {
          const rango = (arr) => (arr.length ? `${formatDate(arr[0].fecha_vencimiento)} – ${formatDate(arr[arr.length - 1].fecha_vencimiento)}` : '');
          const ok = confirmAction(
            (fechasCambiaron ? 'Cambiaste las fechas / el día de pago: se reemplazará TODO el cronograma de cuotas (ninguna tiene pagos):' : 'Se detectaron cuotas duplicadas/obsoletas de un cronograma anterior:') + '\n\n' +
            `• Se ANULARÁN ${plan.anular.length} cuota(s) pendiente(s)/vencida(s) sin pagos que ya no corresponden ${rango(plan.anular)}.\n` +
            `• Se CREARÁN ${plan.crear.length} cuota(s) nueva(s) ${rango(plan.crear)}.\n\n` +
            'Las cuotas con pagos nunca se tocan. Si cancelas, el contrato NO se guarda.',
          );
          if (!ok) return;
          planCronograma = plan;
        }
      } catch (err) {
        console.error(err);
        showToast('No se pudo calcular el ajuste de cuotas; no se guardó el contrato.', 'error');
        return;
      }
    }

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
    const datosDoc = recogerDatosDoc();
    if (Object.keys(datosDoc).length) payload.datos_contrato = datosDoc;
    // Solo se envía el estado si cambió: el trigger de la BD regenera cuotas
    // cada vez que se actualiza la columna estado (aunque no cambie), y eso
    // duplicaba el cronograma al mover fechas.
    if (editingId && qs('#al-estado').value !== form.dataset.originalEstado) payload.estado = qs('#al-estado').value;

    const serviciosFijos = leerFilasServiciosFijos().filter((sf) => sf.tipo_servicio_id);
    if (serviciosFijos.some((sf) => !sf.monto_fijo)) { showToast('Cada servicio con monto fijo debe tener un monto mayor a 0.', 'error'); return; }
    const tiposRepetidos = new Set(serviciosFijos.map((sf) => sf.tipo_servicio_id)).size !== serviciosFijos.length;
    if (tiposRepetidos) { showToast('No repitas el mismo tipo de servicio en los montos fijos.', 'error'); return; }

    // Montos fijos de servicios: si cambió el monto de un servicio, se
    // revisan los consumos ya calculados/facturados y se ofrece actualizar las
    // cuotas de servicio todavía sin pagos (igual que con la mensualidad).
    let planServicios = null;
    if (editingId) {
      const originales = JSON.parse(form.dataset.originalServiciosFijos || '{}');
      const cambiados = serviciosFijos.filter((sf) => originales[sf.tipo_servicio_id] != null && Math.abs(originales[sf.tipo_servicio_id] - sf.monto_fijo) > 0.009);
      if (cambiados.length) {
        try {
          const plan = await planSincronizarMontoFijoServicios(editingId, cambiados);
          if (plan.items.length || plan.bloqueadas.length) {
            const lineas = plan.items.slice(0, 8).map((i) => `• ${i.tipoNombre} ${i.periodo}: ${formatCurrency(i.antes)} → ${formatCurrency(i.despues)}${i.sinCuota ? ' (aún sin cobranza)' : ''}`);
            if (plan.items.length > 8) lineas.push(`• … y ${plan.items.length - 8} más`);
            const ok = confirmAction(
              'Cambiaste el monto fijo de un servicio.\n\n' +
              (plan.items.length ? `Se ACTUALIZARÁN ${plan.items.length} consumo(s)/cuota(s) de servicio pendientes:\n${lineas.join('\n')}\n\n` : '') +
              (plan.bloqueadas.length ? `${plan.bloqueadas.length} cuota(s) con pagos (parciales/pagadas) NO se modifican.\n\n` : '') +
              (plan.items.length ? '¿Actualizar también esas cuotas? Aceptar = actualizar · Cancelar = dejar las cuotas con el monto anterior (el contrato igual se guarda con el nuevo monto fijo).' : 'Solo se guardará el nuevo monto fijo para los próximos cálculos.'),
            );
            if (ok && plan.items.length) planServicios = plan;
          }
        } catch (err) {
          console.error(err);
          showToast('No se pudo revisar las cuotas de servicio; se guardará solo el nuevo monto fijo.', 'warning');
        }
      }
    }

    const btn = qs('#btn-guardar-alquiler');
    setLoading(btn, true);
    try {
      let contrato;
      if (editingId) {
        contrato = await guardarConFallbackDatos((pl) => updateContratoAlquiler(editingId, pl), payload);
        if (planCronograma) {
          try {
            await aplicarCronogramaAlquiler(contrato.id, planCronograma, montoRentaTotal);
            showToast(`Cronograma ajustado: ${planCronograma.anular.length} cuota(s) anulada(s), ${planCronograma.crear.length} creada(s).`, 'success');
          } catch (err) {
            console.error(err);
            showToast('El contrato se actualizó, pero no se pudo ajustar el cronograma de cuotas.', 'warning');
          }
        }
        if (sincronizarCuotas) {
          try {
            const actualizadas = await actualizarMontoCuotasAlquilerPendientes(contrato.id, montoRentaTotal);
            showToast(`Contrato actualizado. Se ajustaron ${actualizadas.length} cuota(s) pendiente(s) al nuevo monto.`, 'success');
          } catch (err) {
            console.error(err);
            showToast('El contrato se actualizó, pero no se pudieron ajustar las cuotas pendientes.', 'warning');
          }
        } else if (montoCambio && cuotasPendientes.length) {
          showToast('Contrato actualizado. Las cuotas pendientes se dejaron con el monto anterior, tal como elegiste.', 'info');
        } else {
          showToast('Contrato actualizado.', 'success');
        }
      } else {
        contrato = await guardarConFallbackDatos((pl) => createContratoAlquiler({ ...pl, estado: 'vigente' }), payload);
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
        if (planServicios) {
          try {
            const n = await aplicarSincronizacionMontoFijoServicios(planServicios.items);
            showToast(`Montos fijos actualizados: ${planServicios.items.length} consumo(s) y ${n} cuota(s) de servicio ajustadas.`, 'success');
          } catch (err) {
            console.error(err);
            showToast('Se guardó el monto fijo, pero no se pudieron actualizar las cuotas de servicio existentes.', 'warning');
          }
        }
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
