/**
 * cobranzas.js — Módulo Cobranzas + Pagos (Fase 3). Vista unificada de
 * `cuotas` (alquiler / venta / servicio), registro de pagos con voucher +
 * foto, verificación, y aplicación manual de mora a cuotas vencidas.
 */
import { initShell } from './main.js';
import { isAdmin } from './auth.js';
import {
  listCuotas, getCuota, aplicarMoraVencidas, registrarPago, verificarPago, anularPago, anularCuota,
  uploadArchivo, getSignedUrl, getCatalogo, listComisionesAgentes, marcarComisionPagada,
} from './supabase-data.js';
import { qs, qsa, el, formatCurrency, formatDate, badgeHtml, showToast, openModal, closeModal, validateForm, setLoading, confirmAction, debounce } from './utils.js';

let profile = null;
let activeOrigen = '';
let cuotasCache = [];

const ORIGEN_LABELS = { alquiler: 'Alquiler', venta: 'Venta', servicio: 'Servicio' };

async function main() {
  profile = await initShell('cobranzas');
  if (!profile) return;

  bindTabs();
  bindToolbar();
  bindFormPago();
  await Promise.all([refresh(), renderComisiones()]);
}

function bindTabs() {
  qsa('.tab-btn[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeOrigen = btn.dataset.tab === 'todas' ? '' : btn.dataset.tab;
      qsa('.tab-btn[data-tab]').forEach((b) => b.classList.toggle('active', b === btn));
      refresh();
    });
  });
}

function bindToolbar() {
  qs('#search-input')?.addEventListener('input', debounce(refresh, 350));
  qs('#filter-estado')?.addEventListener('change', refresh);
  qs('#btn-actualizar-vencidas')?.addEventListener('click', async () => {
    const btn = qs('#btn-actualizar-vencidas');
    setLoading(btn, true, 'Actualizando…');
    try {
      const n = await aplicarMoraVencidas();
      showToast(n > 0 ? `${n} cuota(s) marcadas como vencidas con mora aplicada.` : 'No hay cuotas nuevas por marcar como vencidas.', 'success');
      await refresh();
    } catch (err) {
      console.error(err);
      showToast('No se pudo actualizar las cuotas vencidas.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

async function refresh() {
  const search = qs('#search-input')?.value ?? '';
  const estado = qs('#filter-estado')?.value ?? '';
  const tbody = qs('#cuotas-tbody');
  try {
    cuotasCache = await listCuotas({ origen: activeOrigen, estado, search });
    renderKpis(cuotasCache);
    tbody.innerHTML = '';
    if (!cuotasCache.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '8' }, [
        el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '💰'), el('p', {}, 'No hay cuotas para este filtro.')]),
      ])]));
      return;
    }
    cuotasCache.forEach((c) => tbody.append(renderRow(c)));
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar las cuotas.', 'error');
  }
}

function renderKpis(cuotas) {
  const hoy = new Date();
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const pendienteMes = cuotas.filter((c) => c.estado === 'pendiente' && c.fecha_vencimiento?.startsWith(mesActual)).reduce((s, c) => s + c.saldo, 0);
  const vencidoTotal = cuotas.filter((c) => c.estado === 'vencida').reduce((s, c) => s + c.saldo, 0);
  const cobradoMes = cuotas.filter((c) => (c.estado === 'pagada' || c.estado === 'parcial')).reduce((s, c) => {
    const enEsteMes = c.fecha_vencimiento?.startsWith(mesActual);
    return enEsteMes ? s + c.totalPagado : s;
  }, 0);
  qs('#kpi-pendiente').textContent = formatCurrency(pendienteMes);
  qs('#kpi-vencido').textContent = formatCurrency(vencidoTotal);
  qs('#kpi-cobrado').textContent = formatCurrency(cobradoMes);
}

function renderRow(c) {
  const concepto = `${ORIGEN_LABELS[c.origen] ?? c.origen}${c.concepto ? ' · ' + c.concepto : ''}`;
  return el('tr', {}, [
    el('td', {}, c.deudor),
    el('td', {}, c.referencia),
    el('td', {}, concepto),
    el('td', {}, formatCurrency(Number(c.monto) + Number(c.mora_aplicada))),
    el('td', {}, [el('span', { style: c.saldo > 0 ? 'color:var(--color-danger); font-weight:600;' : 'color:var(--color-success); font-weight:600;' }, formatCurrency(c.saldo))]),
    el('td', {}, formatDate(c.fecha_vencimiento)),
    el('td', { html: badgeHtml(c.estado) }),
    el('td', { class: 'actions' }, [
      c.saldo > 0.009 && c.estado !== 'anulada'
        ? el('button', { class: 'btn btn-primary btn-sm', onclick: () => openPagoModal(c) }, 'Registrar pago')
        : null,
      el('button', { class: 'btn btn-tertiary btn-sm', onclick: () => openDetalleModal(c.id) }, 'Ver'),
    ]),
  ]);
}

/* ============================== REGISTRAR PAGO ================================ */
async function openPagoModal(cuota) {
  const form = qs('#form-pago');
  form.reset();
  qsa('.form-field', form).forEach((f) => f.classList.remove('invalid'));
  form.dataset.cuotaId = cuota.id;
  qs('#pg-contexto').innerHTML = `<strong>${cuota.deudor}</strong> · ${cuota.referencia}<br>${cuota.concepto ?? ''} — saldo pendiente: <strong>${formatCurrency(cuota.saldo)}</strong>`;
  qs('#pg-monto').value = cuota.saldo.toFixed(2);
  qs('#pg-monto').max = cuota.saldo.toFixed(2);
  qs('#pg-fecha').value = new Date().toISOString().slice(0, 10);
  qs('#pg-comprobante-file').value = '';
  qs('#pg-foto-file').value = '';

  const medioSelect = qs('#pg-medio');
  medioSelect.innerHTML = '';
  try {
    const medios = await getCatalogo('medio_pago');
    medios.forEach((m) => medioSelect.append(el('option', { value: m.valor }, m.valor)));
  } catch (err) {
    console.error(err);
  }
  openModal('modal-pago');
}

function bindFormPago() {
  const form = qs('#form-pago');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!validateForm(form)) return;
    const cuotaId = form.dataset.cuotaId;
    const btn = qs('#btn-guardar-pago');
    setLoading(btn, true, 'Registrando…');
    try {
      let comprobanteUrl = null, fotoUrl = null;
      const comprobanteFile = qs('#pg-comprobante-file').files[0];
      const fotoFile = qs('#pg-foto-file').files[0];
      if (comprobanteFile) comprobanteUrl = await uploadArchivo(comprobanteFile, `pagos/${cuotaId}`);
      if (fotoFile) fotoUrl = await uploadArchivo(fotoFile, `pagos/${cuotaId}`);

      await registrarPago({
        cuota_id: cuotaId,
        monto: Number(qs('#pg-monto').value),
        fecha_pago: qs('#pg-fecha').value,
        medio_pago: qs('#pg-medio').value,
        n_operacion: qs('#pg-operacion').value || null,
        comprobante_url: comprobanteUrl,
        foto_cobranza_url: fotoUrl,
        notas: qs('#pg-notas').value || null,
      });
      showToast('Pago registrado.', 'success');
      closeModal('modal-pago');
      await refresh();
    } catch (err) {
      console.error(err);
      showToast('No se pudo registrar el pago.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

/* ============================== DETALLE / HISTORIAL ============================ */
async function openDetalleModal(cuotaId) {
  try {
    const cuota = await getCuota(cuotaId);
    qs('#detalle-title').textContent = cuota.concepto ?? 'Detalle de cuota';
    qs('#detalle-resumen').innerHTML = `
      Monto: <strong>${formatCurrency(cuota.monto)}</strong> · Mora: <strong>${formatCurrency(cuota.mora_aplicada)}</strong>
      · Vence: <strong>${formatDate(cuota.fecha_vencimiento)}</strong> · Estado: ${badgeHtml(cuota.estado)}
    `;
    const list = qs('#detalle-pagos');
    list.innerHTML = '';
    if (!cuota.pagos?.length) {
      list.append(el('p', { style: 'color:var(--gray-500);' }, 'Todavía no hay pagos registrados.'));
    } else {
      cuota.pagos.forEach((p) => list.append(renderPagoItem(p, cuotaId)));
    }
    if (isAdmin(profile) && cuota.estado !== 'anulada' && cuota.estado !== 'pagada') {
      qs('#btn-anular-cuota').style.display = 'inline-flex';
      qs('#btn-anular-cuota').onclick = async () => {
        if (!confirmAction('¿Anular esta cuota? No se podrá registrar más pagos sobre ella.')) return;
        try {
          await anularCuota(cuotaId);
          showToast('Cuota anulada.', 'success');
          closeModal('modal-detalle');
          await refresh();
        } catch (err) {
          console.error(err);
          showToast('No se pudo anular la cuota.', 'error');
        }
      };
    } else {
      qs('#btn-anular-cuota').style.display = 'none';
    }
    openModal('modal-detalle');
  } catch (err) {
    console.error(err);
    showToast('No se pudo cargar el detalle.', 'error');
  }
}

function renderPagoItem(p, cuotaId) {
  const acciones = [];
  if (isAdmin(profile) && p.estado === 'registrado') {
    acciones.push(el('button', { class: 'btn btn-tertiary btn-sm', onclick: async (evt) => {
      evt.target.disabled = true;
      try { await verificarPago(p.id); showToast('Pago verificado.', 'success'); await refresh(); await openDetalleModal(cuotaId); }
      catch (err) { console.error(err); showToast('No se pudo verificar.', 'error'); evt.target.disabled = false; }
    } }, 'Verificar'));
  }
  if (isAdmin(profile) && p.estado !== 'anulado') {
    acciones.push(el('button', { class: 'btn btn-tertiary btn-sm', onclick: async (evt) => {
      if (!confirmAction('¿Anular este pago? El saldo de la cuota se recalculará.')) return;
      try { await anularPago(p.id); showToast('Pago anulado.', 'success'); await refresh(); closeModal('modal-detalle'); }
      catch (err) { console.error(err); showToast('No se pudo anular.', 'error'); }
    } }, 'Anular'));
  }
  return el('div', { style: 'border:1px solid var(--gray-300); border-radius:8px; padding:10px; margin-bottom:8px;' }, [
    el('div', { style: 'display:flex; justify-content:space-between; align-items:center;' }, [
      el('strong', {}, formatCurrency(p.monto)),
      el('span', { html: badgeHtml(p.estado) }),
    ]),
    el('div', { style: 'font-size:12px; color:var(--gray-500); margin:4px 0;' }, `${formatDate(p.fecha_pago)} · ${p.medio_pago}${p.n_operacion ? ' · Op: ' + p.n_operacion : ''}`),
    p.comprobante_url ? el('a', { href: '#', style: 'font-size:12px;', onclick: async (evt) => { evt.preventDefault(); window.open(await getSignedUrl(p.comprobante_url), '_blank'); } }, '📎 Ver comprobante') : null,
    ' ',
    p.foto_cobranza_url ? el('a', { href: '#', style: 'font-size:12px;', onclick: async (evt) => { evt.preventDefault(); window.open(await getSignedUrl(p.foto_cobranza_url), '_blank'); } }, '📷 Ver foto de cobranza') : null,
    el('div', { style: 'margin-top:6px; display:flex; gap:6px;' }, acciones),
  ]);
}

/* ============================== COMISIONES AGENTES ============================= */
async function renderComisiones() {
  const wrap = qs('#comisiones-wrap');
  if (!wrap) return;
  try {
    const comisiones = await listComisionesAgentes();
    wrap.innerHTML = '';
    if (!comisiones.length) {
      wrap.append(el('p', { style: 'color:var(--gray-500);' }, 'Sin comisiones registradas todavía.'));
      return;
    }
    const table = el('table', { class: 'data-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', {}, 'Agente'), el('th', {}, 'Tipo'), el('th', {}, 'Monto/%'), el('th', {}, 'Estado'), el('th', {}, '')])]),
    ]);
    const tbody = el('tbody');
    comisiones.forEach((c) => {
      tbody.append(el('tr', {}, [
        el('td', {}, c.agente?.nombre ?? '—'),
        el('td', {}, ORIGEN_LABELS[c.contrato_tipo] ?? c.contrato_tipo),
        el('td', {}, c.monto ? formatCurrency(c.monto) : `${c.porcentaje}%`),
        el('td', { html: badgeHtml(c.estado) }),
        el('td', {}, [
          c.estado === 'pendiente' && isAdmin(profile)
            ? el('button', { class: 'btn btn-tertiary btn-sm', onclick: async (evt) => {
                setLoading(evt.target, true);
                try { await marcarComisionPagada(c.id); showToast('Comisión marcada como pagada.', 'success'); await renderComisiones(); }
                catch (err) { console.error(err); showToast('No se pudo actualizar.', 'error'); }
                finally { setLoading(evt.target, false); }
              } }, 'Marcar pagada')
            : null,
        ]),
      ]));
    });
    table.append(tbody);
    wrap.append(table);
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<p style="color:var(--color-danger);">No se pudieron cargar las comisiones.</p>';
  }
}

main();
