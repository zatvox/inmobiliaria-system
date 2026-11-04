/**
 * mantenimiento-carpeta.js — Cada trabajo de mantenimiento es una carpeta:
 *   Resumen (ficha) · Bitácora (cronología con fotos) · Gastos (partidas con
 *   comprobante) · Reparto (por m² entre inquilinos y propietario → cuotas en
 *   Cobranzas) · Informe PDF para gerencia (incluye la comisión del contratista).
 */
import {
  getCarpetaMantenimiento, updateMantenimiento, saveGastoMantenimiento, deleteGastoMantenimiento,
  saveEventoMantenimiento, deleteEventoMantenimiento, sugerirRepartoMantenimiento, guardarRepartoMantenimiento,
  generarCuotasMantenimiento, listEquipos, uploadArchivo, getSignedUrl, getConfiguracionSistema,
} from './supabase-data.js';
import { qs, qsa, formatCurrency, showToast, openModal, closeModal, setLoading, confirmAction } from './utils.js';
import { esc, CATEGORIAS, TIPOS_EVENTO, ESTADOS, resumenMantenimiento, htmlInforme, descargarPDFDesdeHTML } from './mant-informe.js';

let m = null;            // carpeta cargada
let carpetaId = '';
let tab = 'resumen';
let alCerrar = null;
let editGastoId = '';
let repartoEdit = null;  // filas del reparto en edición
const urlsCache = {};

const hoyLocalInput = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const opts = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
const dmy = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const horaFmt = (s) => { const d = new Date(s); return `${dmy(s)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

async function urlDe(path) {
  if (!path) return null;
  if (!urlsCache[path]) { try { urlsCache[path] = await getSignedUrl(path, 3600); } catch { urlsCache[path] = null; } }
  return urlsCache[path];
}

export function initCarpeta() {
  qsa('#modal-mant-carpeta .mc-tab').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.mc; pintar(); }));
  qs('#mc-informe')?.addEventListener('click', generarInforme);
  qs('#mc-estado')?.addEventListener('change', async (e) => {
    try { await updateMantenimiento(m.id, { estado: e.target.value, fecha_fin: ['terminado', 'informado', 'finalizado'].includes(e.target.value) && !m.fecha_fin ? new Date().toISOString().slice(0, 10) : m.fecha_fin }); await recargar(); }
    catch (err) { console.error(err); showToast('No se pudo cambiar el estado.', 'error'); }
  });
}

export async function abrirCarpeta(id, onClose = null) {
  carpetaId = id; alCerrar = onClose; tab = 'resumen'; editGastoId = ''; repartoEdit = null;
  qs('#mc-body').innerHTML = '<div class="skeleton" style="height:120px;"></div>';
  openModal('modal-mant-carpeta');
  await recargar();
}

async function recargar() {
  try {
    m = await getCarpetaMantenimiento(carpetaId);
  } catch (err) { console.error(err); showToast('No se pudo cargar la carpeta. ¿Ejecutaste el SQL 31?', 'error'); return; }
  pintar();
  alCerrar?.();
}

function pintar() {
  if (!m) return;
  const r = resumenMantenimiento(m);
  qs('#mc-titulo').textContent = m.titulo || m.descripcion;
  qs('#mc-sub').textContent = `${m.propiedad?.nombre_referencial ?? ''}${m.seccion?.nombre ? ' · ' + m.seccion.nombre : ''}${m.equipo ? ' · ⚙️ ' + m.equipo : ''}`;
  qs('#mc-estado').innerHTML = opts(ESTADOS, m.estado);
  qs('#mc-kpis').innerHTML = [
    ['Total del trabajo', formatCurrency(r.total), 'var(--color-primary)'],
    ['Confirmado', formatCurrency(r.confirmado), 'var(--color-success)'],
    ['Estimado', formatCurrency(r.estimado), '#B45309'],
    ['Presupuesto', r.presupuesto ? `${formatCurrency(r.presupuesto)} <small style="color:${r.desvio > 0 ? 'var(--color-danger)' : 'var(--color-success)'};">${r.desvio >= 0 ? '+' : ''}${formatCurrency(r.desvio)}</small>` : '—', 'inherit'],
    [`Comisión ${Number(m.comision_pct || 0)}%`, formatCurrency(r.comision), 'inherit'],
  ].map(([l, v, c]) => `<div class="kpi-card"><div class="kpi-label">${l}</div><div class="kpi-value" style="color:${c}; font-size:18px;">${v}</div></div>`).join('');
  qsa('#modal-mant-carpeta .mc-tab').forEach((b) => b.classList.toggle('active', b.dataset.mc === tab));
  ({ resumen: pintarResumen, bitacora: pintarBitacora, gastos: pintarGastos, reparto: pintarReparto })[tab]();
}

/* ------------------------------- RESUMEN ----------------------------------- */
async function pintarResumen() {
  let equipos = []; let conEquipos = true;
  try { equipos = (await listEquipos({ propiedadId: m.propiedad_id })).filter((x) => x.estado !== 'dado_de_baja' || x.id === m.equipo_id); } catch { conEquipos = false; }
  const seleccionado = m.equipo_id ?? (m.equipo && !equipos.find((x) => x.nombre === m.equipo) ? '__otro' : '');
  const f = (id, label, val, type = 'text', extra = '') => `<div class="form-field"><label for="${id}">${label}</label><input type="${type}" id="${id}" value="${esc(val ?? '')}" ${extra}></div>`;
  const ta = (id, label, val) => `<div class="form-field full"><label for="${id}">${label}</label><textarea id="${id}" rows="2">${esc(val ?? '')}</textarea></div>`;
  qs('#mc-body').innerHTML = `<div class="form-grid">
    ${f('mc-f-titulo', 'Título del trabajo', m.titulo || m.descripcion)}
    <div class="form-field"><label for="mc-f-equipo-id">Equipo / sistema afectado</label>
      ${conEquipos ? `<select id="mc-f-equipo-id"><option value="">— Sin equipo —</option>${equipos.map((x) => `<option value="${x.id}"${x.id === seleccionado ? ' selected' : ''}>${esc(x.nombre)}${x.ubicacion ? ' — ' + esc(x.ubicacion) : ''}</option>`).join('')}<option value="__otro"${seleccionado === '__otro' ? ' selected' : ''}>Otro (no registrado)…</option></select>` : ''}
      <input type="text" id="mc-f-equipo" value="${esc(seleccionado === '__otro' || !conEquipos ? (m.equipo ?? '') : '')}" placeholder="Nombre del equipo" style="${conEquipos && seleccionado !== '__otro' ? 'display:none;' : ''} margin-top:6px;">
      ${conEquipos && !equipos.length ? '<div class="hint">Este edificio no tiene equipos registrados: agrégalos en la pestaña “Equipos”.</div>' : ''}
    </div>
    ${f('mc-f-fecha', 'Fecha de inicio', m.fecha, 'date')}
    ${f('mc-f-fin', 'Fecha de fin', m.fecha_fin, 'date')}
    ${f('mc-f-presupuesto', 'Presupuesto inicial (S/)', m.presupuesto_estimado, 'number', 'step="0.01" min="0"')}
    ${f('mc-f-comision', 'Comisión del contratista (%)', m.comision_pct, 'number', 'step="0.01" min="0" max="100"')}
    ${f('mc-f-garantia', 'Garantía hasta', m.garantia_hasta, 'date')}
    ${ta('mc-f-problema', 'Problema reportado', m.problema)}
    ${ta('mc-f-diagnostico', 'Diagnóstico', m.diagnostico)}
    ${ta('mc-f-causa', 'Causa', m.causa)}
    ${ta('mc-f-solucion', 'Solución aplicada', m.solucion)}
    ${ta('mc-f-notas', 'Notas internas', m.notas)}
  </div><button class="btn btn-primary" id="mc-guardar-ficha">Guardar ficha</button>`;
  qs('#mc-f-equipo-id')?.addEventListener('change', (e) => { qs('#mc-f-equipo').style.display = e.target.value === '__otro' ? '' : 'none'; });
  qs('#mc-guardar-ficha').addEventListener('click', async (e) => {
    const v = (id) => qs(id).value.trim() || null;
    const titulo = qs('#mc-f-titulo').value.trim();
    if (!titulo) { showToast('El título es obligatorio.', 'error'); return; }
    setLoading(e.currentTarget, true);
    try {
      await updateMantenimiento(m.id, {
        titulo, descripcion: titulo, ...equipoPayload(equipos, conEquipos), fecha: qs('#mc-f-fecha').value || m.fecha, fecha_fin: v('#mc-f-fin'),
        presupuesto_estimado: qs('#mc-f-presupuesto').value === '' ? null : Number(qs('#mc-f-presupuesto').value),
        comision_pct: Number(qs('#mc-f-comision').value || 0), garantia_hasta: v('#mc-f-garantia'),
        problema: v('#mc-f-problema'), diagnostico: v('#mc-f-diagnostico'), causa: v('#mc-f-causa'), solucion: v('#mc-f-solucion'), notas: v('#mc-f-notas'),
      });
      showToast('Ficha guardada.', 'success');
      await recargar();
    } catch (err) { console.error(err); showToast('No se pudo guardar la ficha.', 'error'); } finally { setLoading(e.currentTarget, false); }
  });
}

function equipoPayload(equipos, conEquipos) {
  if (!conEquipos) return { equipo: qs('#mc-f-equipo').value.trim() || null };
  const v = qs('#mc-f-equipo-id').value;
  if (!v) return { equipo_id: null, equipo: null };
  if (v === '__otro') return { equipo_id: null, equipo: qs('#mc-f-equipo').value.trim() || null };
  return { equipo_id: v, equipo: equipos.find((x) => x.id === v)?.nombre ?? null };
}

/* ------------------------------- BITÁCORA ---------------------------------- */
async function pintarBitacora() {
  qs('#mc-body').innerHTML = `
    <div class="mc-add">
      <div class="form-grid">
        <div class="form-field"><label>Tipo</label><select id="ev-tipo">${opts(TIPOS_EVENTO, 'nota')}</select></div>
        <div class="form-field"><label>Fecha y hora</label><input type="datetime-local" id="ev-fecha" value="${hoyLocalInput()}"></div>
        <div class="form-field full"><label>¿Qué pasó? *</label><textarea id="ev-nota" rows="2" placeholder="Ej. 10:00 se retira la motobomba al taller para revisión…"></textarea></div>
        <div class="form-field full"><label>Foto (opcional)</label><input type="file" id="ev-foto" accept="image/*,.pdf"></div>
      </div>
      <button class="btn btn-primary" id="ev-agregar">+ Agregar a la bitácora</button>
    </div>
    <div id="ev-lista" style="margin-top:14px;"></div>`;
  qs('#ev-agregar').addEventListener('click', async (e) => {
    const nota = qs('#ev-nota').value.trim();
    if (!nota) { showToast('Escribe qué pasó.', 'error'); return; }
    setLoading(e.currentTarget, true, 'Guardando…');
    try {
      const file = qs('#ev-foto').files[0];
      const foto = file ? await uploadArchivo(file, `mantenimientos/${m.id}`) : null;
      await saveEventoMantenimiento(m.id, { tipo: qs('#ev-tipo').value, fecha_hora: new Date(qs('#ev-fecha').value || Date.now()).toISOString(), nota, foto_url: foto });
      await recargar();
    } catch (err) { console.error(err); showToast('No se pudo guardar el evento.', 'error'); setLoading(e.currentTarget, false); }
  });
  const lista = qs('#ev-lista');
  if (!m.eventos.length) { lista.innerHTML = '<p style="color:var(--gray-500);">Todavía no hay eventos. Registra aquí lo que antes mandabas por WhatsApp.</p>'; return; }
  const items = [...m.eventos].reverse();
  const urls = await Promise.all(items.map((e) => urlDe(e.foto_url)));
  lista.innerHTML = items.map((e, i) => `<div class="mc-ev">
      <div class="mc-ev-h"><b>${esc(TIPOS_EVENTO[e.tipo] ?? e.tipo)}</b> <span class="mut">${horaFmt(e.fecha_hora)}</span>
        <a href="#" data-del-ev="${e.id}" style="margin-left:auto; color:var(--color-danger);">Eliminar</a></div>
      <div>${esc(e.nota).replace(/\n/g, '<br>')}</div>
      ${urls[i] ? (/\.pdf/i.test(e.foto_url) ? `<a href="${urls[i]}" target="_blank">Ver adjunto</a>` : `<a href="${urls[i]}" target="_blank"><img src="${urls[i]}" style="max-height:140px; border-radius:6px; margin-top:6px;"></a>`) : ''}
    </div>`).join('');
  lista.querySelectorAll('[data-del-ev]').forEach((a) => a.addEventListener('click', async (ev) => {
    ev.preventDefault();
    if (!confirmAction('¿Eliminar este evento de la bitácora?')) return;
    try { await deleteEventoMantenimiento(a.dataset.delEv); await recargar(); } catch (err) { console.error(err); showToast('No se pudo eliminar.', 'error'); }
  }));
}

/* -------------------------------- GASTOS ----------------------------------- */
function pintarGastos() {
  const g = m.gastos.find((x) => x.id === editGastoId) ?? {};
  qs('#mc-body').innerHTML = `
    <div class="mc-add">
      <div class="form-grid">
        <div class="form-field"><label>Fecha</label><input type="date" id="g-fecha" value="${g.fecha ?? new Date().toISOString().slice(0, 10)}"></div>
        <div class="form-field"><label>Categoría</label><select id="g-cat">${opts(CATEGORIAS, g.categoria ?? 'material')}</select></div>
        <div class="form-field full"><label>Descripción *</label><input type="text" id="g-desc" value="${esc(g.descripcion ?? '')}" placeholder="Ej. Llave check 3/4 para motobomba"></div>
        <div class="form-field"><label>Proveedor / ferretería</label><input type="text" id="g-prov" value="${esc(g.proveedor ?? '')}"></div>
        <div class="form-field"><label>Cantidad</label><input type="number" id="g-cant" step="0.001" min="0" value="${g.cantidad ?? 1}"></div>
        <div class="form-field"><label>Monto total (S/) *</label><input type="number" id="g-monto" step="0.01" min="0" value="${g.monto ?? ''}"></div>
        <div class="form-field"><label>Estado</label><select id="g-estado"><option value="confirmado"${g.estado !== 'estimado' ? ' selected' : ''}>Confirmado (ya pagado/facturado)</option><option value="estimado"${g.estado === 'estimado' ? ' selected' : ''}>Estimado (aprox.)</option></select></div>
        <div class="form-field"><label>Comprobante</label><select id="g-ctipo"><option value="">Sin comprobante</option>${['factura', 'boleta', 'recibo', 'otro'].map((t) => `<option value="${t}"${g.comprobante_tipo === t ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="form-field"><label>N° de comprobante</label><input type="text" id="g-cnro" value="${esc(g.comprobante_nro ?? '')}"></div>
        <div class="form-field full"><label>Foto / PDF del comprobante ${g.comprobante_url ? '(ya hay uno; sube otro para reemplazarlo)' : ''}</label><input type="file" id="g-file" accept="image/*,.pdf"></div>
      </div>
      <button class="btn btn-primary" id="g-guardar">${editGastoId ? 'Guardar cambios' : '+ Agregar gasto'}</button>
      ${editGastoId ? '<button class="btn btn-tertiary" id="g-cancelar">Cancelar edición</button>' : ''}
    </div>
    <div class="table-wrap" style="margin-top:14px;"><table class="data-table" data-no-cols>
      <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Proveedor</th><th>Comprobante</th><th>Estado</th><th style="text-align:right;">Monto</th><th></th></tr></thead>
      <tbody>${m.gastos.map((x) => `<tr><td>${dmy(x.fecha)}</td><td>${esc(CATEGORIAS[x.categoria] ?? x.categoria)}</td><td>${esc(x.descripcion)}${Number(x.cantidad) !== 1 ? ` <span class="mut">(x${Number(x.cantidad)})</span>` : ''}</td><td>${esc(x.proveedor ?? '')}</td>
        <td>${x.comprobante_url ? `<a href="#" data-ver="${esc(x.comprobante_url)}">${esc(x.comprobante_tipo ?? 'ver')} ${esc(x.comprobante_nro ?? '')}</a>` : (x.comprobante_tipo ? esc(x.comprobante_tipo + ' ' + (x.comprobante_nro ?? '')) : '—')}</td>
        <td>${x.estado === 'estimado' ? '<span class="badge badge-pendiente">estimado</span>' : '<span class="badge badge-disponible">confirmado</span>'}</td>
        <td style="text-align:right; white-space:nowrap;">${formatCurrency(x.monto)}</td>
        <td class="actions"><a href="#" data-edit="${x.id}">Editar</a> · <a href="#" data-del="${x.id}" style="color:var(--color-danger);">Eliminar</a></td></tr>`).join('') || '<tr><td colspan="8" style="color:var(--gray-500);">Sin gastos todavía.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="6" style="text-align:right; font-weight:700;">TOTAL</td><td style="text-align:right; font-weight:700;">${formatCurrency(resumenMantenimiento(m).total)}</td><td></td></tr></tfoot>
    </table></div>`;
  qs('#g-cancelar')?.addEventListener('click', () => { editGastoId = ''; pintarGastos(); });
  qs('#g-guardar').addEventListener('click', async (e) => {
    const descripcion = qs('#g-desc').value.trim(), monto = qs('#g-monto').value;
    if (!descripcion || monto === '') { showToast('Completa la descripción y el monto.', 'error'); return; }
    setLoading(e.currentTarget, true, 'Guardando…');
    try {
      const file = qs('#g-file').files[0];
      const url = file ? await uploadArchivo(file, `mantenimientos/${m.id}`) : (g.comprobante_url ?? null);
      await saveGastoMantenimiento(m.id, {
        fecha: qs('#g-fecha').value, categoria: qs('#g-cat').value, descripcion, proveedor: qs('#g-prov').value.trim() || null,
        cantidad: Number(qs('#g-cant').value || 1), monto: Number(monto), estado: qs('#g-estado').value,
        comprobante_tipo: qs('#g-ctipo').value || null, comprobante_nro: qs('#g-cnro').value.trim() || null, comprobante_url: url,
      }, editGastoId);
      editGastoId = '';
      await recargar();
    } catch (err) { console.error(err); showToast('No se pudo guardar el gasto.', 'error'); setLoading(e.currentTarget, false); }
  });
  const cont = qs('#mc-body');
  cont.querySelectorAll('[data-edit]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); editGastoId = a.dataset.edit; pintarGastos(); cont.scrollTop = 0; }));
  cont.querySelectorAll('[data-del]').forEach((a) => a.addEventListener('click', async (ev) => {
    ev.preventDefault();
    if (!confirmAction('¿Eliminar este gasto?')) return;
    try { await deleteGastoMantenimiento(a.dataset.del); await recargar(); } catch (err) { console.error(err); showToast('No se pudo eliminar.', 'error'); }
  }));
  cont.querySelectorAll('[data-ver]').forEach((a) => a.addEventListener('click', async (ev) => { ev.preventDefault(); const u = await urlDe(a.dataset.ver); if (u) window.open(u, '_blank'); }));
}

/* -------------------------------- REPARTO ---------------------------------- */
const recalc = (filas, total, desdeM2) => {
  if (desdeM2) {
    const base = filas.reduce((t, f) => t + Number(f.base_m2 || 0), 0);
    filas.forEach((f) => { f.porcentaje = base ? Math.round((Number(f.base_m2) / base) * 100000) / 1000 : 0; });
  }
  filas.forEach((f) => { f.monto = Math.round(total * Number(f.porcentaje || 0)) / 100; });
  // El redondeo puede dejar centavos de más o de menos: se ajusta en la parte más grande para que la suma sea exacta.
  const suma = filas.reduce((t, f) => t + f.monto, 0);
  const pct = filas.reduce((t, f) => t + Number(f.porcentaje || 0), 0);
  if (filas.length && Math.abs(pct - 100) < 0.05) {
    const mayor = filas.reduce((a, f) => (f.monto > a.monto ? f : a), filas[0]);
    mayor.monto = Math.round((mayor.monto + (total - suma)) * 100) / 100;
  }
};

async function pintarReparto() {
  const r = resumenMantenimiento(m);
  if (!repartoEdit) repartoEdit = m.reparto.map((x) => ({ ...x }));
  const filas = repartoEdit;
  const sumPct = filas.reduce((t, f) => t + Number(f.porcentaje || 0), 0);
  const generadas = filas.filter((f) => f.cuota_id).length;
  qs('#mc-body').innerHTML = `
    <p class="mut" style="margin:0 0 8px;">Total a repartir: <b>${formatCurrency(r.total)}</b> (sin la comisión, que paga el propietario aparte). Por defecto el reparto es proporcional a los m² que ocupa cada uno; puedes editar m² o % a mano.</p>
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
      <button class="btn btn-secondary btn-sm" id="rp-sugerir">↻ Sugerir desde contratos vigentes</button>
      <button class="btn btn-secondary btn-sm" id="rp-m2">Recalcular % por m²</button>
      <button class="btn btn-secondary btn-sm" id="rp-igual">Partes iguales</button>
    </div>
    <div class="table-wrap"><table class="data-table" data-no-cols>
      <thead><tr><th>Participante</th><th>Ocupa</th><th>m²</th><th>%</th><th style="text-align:right;">Monto</th><th>Cuota</th></tr></thead>
      <tbody>${filas.map((f, i) => {
        const c = f.cuota; const pag = (c?.pagos ?? []).filter((p) => p.estado !== 'anulado').reduce((t, p) => t + Number(p.monto), 0);
        const est = f.tipo === 'propietario' ? '<span class="mut">asume el propietario</span>' : (f.cuota_id ? `${esc(c?.nro_cobro ?? 'emitida')} · ${esc(c?.estado ?? '')}${pag ? ' · abonó ' + formatCurrency(pag) : ''}` : '<span class="mut">sin cuota</span>');
        return `<tr><td>${esc(f.nombre)}${f.tipo === 'propietario' ? ' <span class="badge badge-neutral">propietario</span>' : ''}</td><td>${esc(f.detalle ?? '')}</td>
          <td><input type="number" step="0.01" min="0" data-i="${i}" data-k="base_m2" value="${f.base_m2}" style="width:90px;"></td>
          <td><input type="number" step="0.001" min="0" data-i="${i}" data-k="porcentaje" value="${f.porcentaje}" style="width:90px;"></td>
          <td style="text-align:right; white-space:nowrap;" id="rp-monto-${i}">${formatCurrency(f.monto)}</td><td>${est}</td></tr>`;
      }).join('') || '<tr><td colspan="6" style="color:var(--gray-500);">Pulsa “Sugerir desde contratos vigentes”.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right; font-weight:700;">TOTAL</td><td id="rp-pct" style="font-weight:700; ${Math.abs(sumPct - 100) > 0.01 ? 'color:var(--color-danger);' : ''}">${sumPct.toFixed(3)}%</td><td style="text-align:right; font-weight:700;" id="rp-suma">${formatCurrency(filas.reduce((t, f) => t + f.monto, 0))}</td><td></td></tr></tfoot>
    </table></div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
      <button class="btn btn-primary" id="rp-guardar">Guardar reparto</button>
      <button class="btn btn-secondary" id="rp-cuotas" ${filas.length ? '' : 'disabled'}>💰 Generar cuotas en Cobranzas${generadas ? ` (${generadas} ya generadas)` : ''}</button>
    </div>
    <p class="mut" style="margin-top:8px; font-size:12px;">Las cuotas ya generadas no se modifican al cambiar el reparto; si hay que corregir una, anúlala en Cobranzas.</p>`;
  const refrescarNumeros = () => {
    filas.forEach((f, i) => { const t = qs(`#rp-monto-${i}`); if (t) t.textContent = formatCurrency(f.monto); });
    const s = filas.reduce((t, f) => t + Number(f.porcentaje || 0), 0);
    qs('#rp-pct').textContent = `${s.toFixed(3)}%`; qs('#rp-pct').style.color = Math.abs(s - 100) > 0.01 ? 'var(--color-danger)' : '';
    qs('#rp-suma').textContent = formatCurrency(filas.reduce((t, f) => t + f.monto, 0));
  };
  qs('#mc-body').querySelectorAll('input[data-i]').forEach((inp) => inp.addEventListener('input', () => {
    const f = filas[Number(inp.dataset.i)]; f[inp.dataset.k] = Number(inp.value || 0);
    if (inp.dataset.k === 'base_m2') { recalc(filas, r.total, true); qs('#mc-body').querySelectorAll('input[data-k="porcentaje"]').forEach((p, j) => { p.value = filas[j].porcentaje; }); } else recalc(filas, r.total, false);
    refrescarNumeros();
  }));
  qs('#rp-sugerir').addEventListener('click', async () => {
    try {
      const sug = await sugerirRepartoMantenimiento(m.propiedad_id);
      // conserva las filas con cuota ya generada y agrega solo las que faltan
      const claves = new Set(filas.map((f) => `${f.tipo}|${f.contrato_alquiler_id ?? ''}`));
      sug.forEach((s) => { if (!claves.has(`${s.tipo}|${s.contrato_alquiler_id ?? ''}`)) filas.push({ ...s, porcentaje: 0, monto: 0 }); });
      recalc(filas, r.total, true); pintarReparto();
    } catch (err) { console.error(err); showToast('No se pudo sugerir el reparto.', 'error'); }
  });
  qs('#rp-m2').addEventListener('click', () => { recalc(filas, r.total, true); pintarReparto(); });
  qs('#rp-igual').addEventListener('click', () => { filas.forEach((f) => { f.porcentaje = Math.round(100000 / filas.length) / 1000; }); recalc(filas, r.total, false); pintarReparto(); });
  qs('#rp-guardar').addEventListener('click', async (e) => {
    const s = filas.reduce((t, f) => t + Number(f.porcentaje || 0), 0);
    if (filas.length && Math.abs(s - 100) > 0.05 && !confirmAction(`Los porcentajes suman ${s.toFixed(2)}% (no 100%). ¿Guardar igual?`)) return;
    setLoading(e.currentTarget, true);
    try { await guardarRepartoMantenimiento(m.id, filas); repartoEdit = null; showToast('Reparto guardado.', 'success'); await recargar(); }
    catch (err) { console.error(err); showToast('No se pudo guardar el reparto.', 'error'); setLoading(e.currentTarget, false); }
  });
  qs('#rp-cuotas').addEventListener('click', async (e) => {
    const sinGuardar = filas.some((f) => !f.id);
    if (sinGuardar) { showToast('Guarda el reparto antes de generar las cuotas.', 'info'); return; }
    const vence = window.prompt('Fecha de vencimiento de las cuotas (AAAA-MM-DD):', new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
    if (!vence) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vence)) { showToast('Formato de fecha no válido.', 'error'); return; }
    setLoading(e.currentTarget, true, 'Generando…');
    try {
      const res = await generarCuotasMantenimiento(m.id, { fechaVencimiento: vence, concepto: `Mantenimiento: ${m.titulo || m.descripcion}` });
      showToast(res.creadas ? `${res.creadas} cuota(s) generada(s). Ya aparecen en Cobranzas.` : 'No había cuotas nuevas por generar.', res.creadas ? 'success' : 'info');
      repartoEdit = null; await recargar();
    } catch (err) { console.error(err); showToast(err.message ?? 'No se pudieron generar las cuotas.', 'error'); setLoading(e.currentTarget, false); }
  });
}

/* -------------------------------- INFORME ---------------------------------- */
async function generarInforme() {
  const btn = qs('#mc-informe');
  setLoading(btn, true, 'Generando…');
  try {
    const rutas = [...m.eventos.map((e) => e.foto_url), ...m.gastos.map((g) => g.comprobante_url)].filter(Boolean);
    const urls = {};
    await Promise.all(rutas.map(async (p) => { urls[p] = await urlDe(p); }));
    const cfg = await getConfiguracionSistema().catch(() => null);
    const html = htmlInforme(m, { urls, empresa: cfg?.nombre_inmobiliaria ?? '' });
    const nombre = `Informe_${String(m.titulo || m.descripcion).replace(/[^\w]+/g, '_').slice(0, 40)}.pdf`;
    await descargarPDFDesdeHTML(html, nombre);
    if (['terminado', 'finalizado'].includes(m.estado) && confirmAction('¿Marcar el trabajo como "Informado a gerencia"?')) {
      await updateMantenimiento(m.id, { estado: 'informado' }); await recargar();
    }
  } catch (err) { console.error(err); showToast('No se pudo generar el informe.', 'error'); } finally { setLoading(btn, false); }
}

export function cerrarCarpeta() { closeModal('modal-mant-carpeta'); alCerrar?.(); }
