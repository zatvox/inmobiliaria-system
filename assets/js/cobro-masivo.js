/**
 * cobro-masivo.js — Cobro masivo (modal flotante sobre Cobranzas): busca cuotas (mensualidades y servicios),
 * las marca, calcula totales y registra un pago por cuota con fecha, N° de
 * recibo y documentos compartidos. La selección persiste al cambiar filtros.
 */
import { listCuotas, registrarPagosMasivo, uploadArchivo, getCatalogo, listPropiedades, listTiposServicio } from './supabase-data.js';
import { qs, qsa, el, formatCurrency, formatDate, badgeHtml, showToast, setLoading, confirmAction, debounce, openModal } from './utils.js';

const seleccion = new Map(); // id -> { cuota, monto }
let visibles = [];

const ORIGEN = { alquiler: 'Alquiler', venta: 'Venta', servicio: 'Servicio' };
const cobrable = (c) => c.saldo > 0.009 && c.estado !== 'anulada';
const round2 = (n) => Math.round(n * 100) / 100;

let iniciado = false;
let onGuardado = () => {};

// Abre el modal; la primera vez carga catálogos y enlaza eventos.
export async function abrirCobroMasivo({ alGuardar } = {}) {
  if (alGuardar) onGuardado = alGuardar;
  const d = new Date();
  if (!iniciado) {
    iniciado = true;
    await init(d);
  }
  qs('#cm-mv-fecha').value = d.toISOString().slice(0, 10);
  openModal('modal-cobro-masivo');
  await refresh();
}

async function init(d) {
  qs('#cm-filter-periodo').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  const [props, tipos, medios] = await Promise.all([listPropiedades(), listTiposServicio(), getCatalogo('medio_pago').catch(() => [])]);
  props.forEach((p) => qs('#cm-filter-edificio').append(el('option', { value: p.id }, p.nombre_referencial)));
  tipos.forEach((t) => qs('#cm-filter-servicio').append(el('option', { value: t.id }, t.nombre)));
  medios.forEach((m) => qs('#cm-mv-medio').append(el('option', { value: m.valor }, m.valor)));
  try {
    const todas = await listCuotas({});
    [...new Set(todas.map((c) => c.deudor).filter((x) => x && x !== '—'))].sort((a, b) => a.localeCompare(b))
      .forEach((n) => qs('#cm-filter-inquilino').append(el('option', { value: n }, n)));
  } catch (e) { console.error(e); }

  qs('#cm-search').addEventListener('input', debounce(refresh, 350));
  ['#cm-filter-origen', '#cm-filter-servicio', '#cm-filter-inquilino', '#cm-filter-edificio', '#cm-filter-periodo', '#cm-filter-estado']
    .forEach((s) => qs(s).addEventListener('change', refresh));
  qs('#cm-limpiar').addEventListener('click', () => {
    qs('#cm-search').value = '';
    ['#cm-filter-origen', '#cm-filter-servicio', '#cm-filter-inquilino', '#cm-filter-edificio', '#cm-filter-estado'].forEach((s) => { qs(s).value = ''; });
    qs('#cm-filter-periodo').value = '';
    refresh();
  });
  qs('#cm-vaciar').addEventListener('click', () => { seleccion.clear(); pintarSeleccion(); });
  qs('#cm-chk-todas').addEventListener('change', (evt) => {
    visibles.forEach((c) => { if (evt.target.checked) seleccion.set(c.id, { cuota: c, monto: round2(c.saldo) }); else seleccion.delete(c.id); });
    pintarSeleccion();
  });
  qs('#cm-form').addEventListener('submit', guardar);
}

async function refresh() {
  const tbody = qs('#cm-tbody');
  const filtros = {
    origen: qs('#cm-filter-origen').value,
    estado: qs('#cm-filter-estado').value,
    search: qs('#cm-search').value,
    propiedadId: qs('#cm-filter-edificio').value,
    tipoServicioId: qs('#cm-filter-servicio').value,
    deudor: qs('#cm-filter-inquilino').value,
    periodo: qs('#cm-filter-periodo').value,
  };
  try {
    let rows = (await listCuotas(filtros)).filter(cobrable);
    // Sin filtro de origen: solo alquiler + servicio (la venta se cobra aparte).
    if (!filtros.origen) rows = rows.filter((c) => c.origen !== 'venta');
    visibles = rows;
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.append(el('tr', {}, [el('td', { colspan: '8' }, [el('div', { class: 'empty-state' }, [el('p', {}, 'No hay cuotas con saldo para este filtro.')])])]));
    }
    rows.forEach((c) => tbody.append(fila(c)));
    pintarSeleccion();
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar las cuotas.', 'error');
  }
}

function fila(c) {
  const sel = seleccion.get(c.id);
  const chk = el('input', { type: 'checkbox', class: 'chk' });
  chk.checked = !!sel;
  const inp = el('input', { type: 'number', class: 'mnt', step: '0.01', min: '0.01', max: c.saldo.toFixed(2), style: 'width:105px;', value: (sel ? sel.monto : c.saldo).toFixed(2) });
  chk.addEventListener('change', () => {
    if (chk.checked) seleccion.set(c.id, { cuota: c, monto: round2(Number(inp.value) || c.saldo) }); else seleccion.delete(c.id);
    pintarSeleccion(false);
  });
  inp.addEventListener('input', () => {
    const v = round2(Number(inp.value) || 0);
    const ok = v > 0 && v <= c.saldo + 0.009;
    inp.style.borderColor = ok ? '' : 'var(--color-danger)';
    seleccion.set(c.id, { cuota: c, monto: v });
    chk.checked = true;
    pintarSeleccion(false);
  });
  const tr = el('tr', {}, [
    el('td', {}, [chk]),
    el('td', {}, c.deudor),
    el('td', {}, c.referencia),
    el('td', {}, `${ORIGEN[c.origen] ?? c.origen}${c.concepto ? ' · ' + c.concepto : ''}`),
    el('td', {}, formatDate(c.fecha_vencimiento)),
    el('td', { html: badgeHtml(c.estado) }),
    el('td', {}, formatCurrency(c.saldo)),
    el('td', {}, [inp]),
  ]);
  tr.dataset.id = c.id;
  return tr;
}

// repintar=true re-sincroniza checkboxes/inputs de las filas visibles.
function pintarSeleccion(repintar = true) {
  if (repintar) {
    qsa('#cm-tbody tr[data-id]').forEach((tr) => {
      const s = seleccion.get(tr.dataset.id);
      tr.querySelector('.chk').checked = !!s;
      const c = visibles.find((x) => x.id === tr.dataset.id);
      if (c) tr.querySelector('.mnt').value = (s ? s.monto : c.saldo).toFixed(2);
    });
  }
  const items = [...seleccion.values()];
  const suma = (f) => round2(items.filter(f).reduce((s, x) => s + x.monto, 0));
  qs('#cm-res-count').textContent = items.length;
  qs('#cm-res-alq').textContent = formatCurrency(suma((x) => x.cuota.origen === 'alquiler'));
  qs('#cm-res-serv').textContent = formatCurrency(suma((x) => x.cuota.origen === 'servicio'));
  qs('#cm-res-total').textContent = formatCurrency(suma(() => true));
  qs('#cm-guardar').disabled = items.length === 0;
  const all = qs('#cm-chk-todas');
  all.checked = visibles.length > 0 && visibles.every((c) => seleccion.has(c.id));
  all.indeterminate = !all.checked && visibles.some((c) => seleccion.has(c.id));
}

async function guardar(evt) {
  evt.preventDefault();
  const items = [...seleccion.values()];
  if (!items.length) return;
  const mal = items.find((x) => !(x.monto > 0) || x.monto > x.cuota.saldo + 0.009);
  if (mal) { showToast(`Monto inválido en ${mal.cuota.deudor} (${mal.cuota.referencia}).`, 'error'); return; }
  const fecha = qs('#cm-mv-fecha').value;
  const medio = qs('#cm-mv-medio').value;
  if (!fecha || !medio) { showToast('Indica fecha y medio de pago.', 'error'); return; }
  const files = [...qs('#cm-mv-files').files];
  if (files.length > 2) { showToast('Adjunta máximo 2 documentos.', 'error'); return; }
  const total = round2(items.reduce((s, x) => s + x.monto, 0));
  if (!confirmAction(`¿Registrar ${items.length} pago(s) por ${formatCurrency(total)} con fecha ${formatDate(fecha)}?`)) return;

  const btn = qs('#cm-guardar');
  setLoading(btn, true, 'Registrando…');
  try {
    const urls = [];
    for (const f of files) urls.push(await uploadArchivo(f, 'pagos/masivo'));
    const recibo = qs('#cm-mv-recibo').value.trim() || null;
    const notas = qs('#cm-mv-notas').value.trim() || null;
    await registrarPagosMasivo(items.map((x) => ({
      cuota_id: x.cuota.id,
      monto: x.monto,
      fecha_pago: fecha,
      medio_pago: medio,
      n_operacion: recibo,
      comprobante_url: urls[0] ?? null,
      foto_cobranza_url: urls[1] ?? null,
      notas,
    })));
    showToast(`${items.length} pago(s) registrados por ${formatCurrency(total)}.`, 'success');
    seleccion.clear();
    qs('#cm-mv-files').value = '';
    qs('#cm-mv-recibo').value = '';
    qs('#cm-mv-notas').value = '';
    await refresh();
    onGuardado();
  } catch (err) {
    console.error(err);
    showToast('No se pudo registrar el cobro masivo.', 'error');
  } finally {
    setLoading(btn, false);
    pintarSeleccion(false);
  }
}

