/**
 * configuracion.js — Módulo de Configuración: variables globales del sistema
 * (precio por defecto de agua/luz, moneda, mora) editables desde una sola
 * pantalla, sin tocar código. Accesible desde el ícono ⚙️ del header en
 * todas las páginas.
 */
import { initShell } from './main.js';
import { isAdmin } from './auth.js';
import { getConfiguracionSistema, updateConfiguracionSistema, listCobroTipos, saveCobroTipos, listTiposServicio } from './supabase-data.js';
import { claveTipoCuota } from './cuota-pdf.js';
import { qs, showToast, setLoading, confirmAction } from './utils.js';

let profile = null;

async function main() {
  profile = await initShell('configuracion');
  if (!profile) return;

  if (!isAdmin(profile)) {
    qs('#config-solo-lectura').style.display = 'inline-block';
    Array.from(document.querySelectorAll('#form-configuracion input, #form-configuracion select')).forEach((f) => { f.disabled = true; });
  }

  bindForm();
  bindColorLineas();
  await cargarConfiguracion();
  await cargarCobroTipos();
}

const COLOR_LINEAS_DEFAULT = '#D1D5DB';
const COLOR_ACENTO_REPORTES_DEFAULT = '#1B3A5C';

async function cargarConfiguracion() {
  try {
    const cfg = await getConfiguracionSistema();
    qs('#cf-nombre-inmobiliaria').value = cfg?.nombre_inmobiliaria ?? '';
    qs('#cf-precio-agua').value = cfg?.precio_default_agua_m3 ?? '';
    qs('#cf-precio-luz').value = cfg?.precio_default_luz_kwh ?? '';
    qs('#cf-moneda').value = cfg?.moneda ?? 'PEN';
    qs('#cf-dias-gracia').value = cfg?.dias_gracia_mora ?? 5;
    qs('#cf-porcentaje-mora').value = cfg?.porcentaje_mora_mensual ?? 0;
    const colorLineas = cfg?.color_lineas_tabla || COLOR_LINEAS_DEFAULT;
    qs('#cf-color-lineas').value = colorLineas;
    qs('#cf-color-lineas-hex').value = colorLineas;
    const colorAcentoReportes = cfg?.color_acento_reportes || COLOR_ACENTO_REPORTES_DEFAULT;
    qs('#cf-color-acento-reportes').value = colorAcentoReportes;
    qs('#cf-color-acento-reportes-hex').value = colorAcentoReportes;
  } catch (err) {
    console.error(err);
    showToast('No se pudo cargar la configuración del sistema.', 'error');
  }
}

// El selector de color <input type="color"> y el campo de texto (para
// quien prefiera escribir/pegar el código hex directo) se mantienen
// sincronizados entre sí en ambas direcciones.
function bindColorLineas() {
  const picker = qs('#cf-color-lineas');
  const texto = qs('#cf-color-lineas-hex');
  picker?.addEventListener('input', () => { texto.value = picker.value; });
  texto?.addEventListener('input', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(texto.value)) picker.value = texto.value;
  });

  const picker2 = qs('#cf-color-acento-reportes');
  const texto2 = qs('#cf-color-acento-reportes-hex');
  picker2?.addEventListener('input', () => { texto2.value = picker2.value; });
  texto2?.addEventListener('input', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(texto2.value)) picker2.value = texto2.value;
  });
}

function bindForm() {
  const form = qs('#form-configuracion');
  form.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    if (!confirmAction('¿Guardar estos cambios? Se usarán como valores por defecto en los demás módulos.')) return;
    const btn = qs('#btn-guardar-configuracion');
    setLoading(btn, true, 'Guardando…');
    try {
      const colorLineas = /^#[0-9a-fA-F]{6}$/.test(qs('#cf-color-lineas-hex').value)
        ? qs('#cf-color-lineas-hex').value
        : qs('#cf-color-lineas').value;
      const colorAcentoReportes = /^#[0-9a-fA-F]{6}$/.test(qs('#cf-color-acento-reportes-hex').value)
        ? qs('#cf-color-acento-reportes-hex').value
        : qs('#cf-color-acento-reportes').value;
      await updateConfiguracionSistema({
        nombre_inmobiliaria: qs('#cf-nombre-inmobiliaria').value || null,
        precio_default_agua_m3: qs('#cf-precio-agua').value ? Number(qs('#cf-precio-agua').value) : null,
        precio_default_luz_kwh: qs('#cf-precio-luz').value ? Number(qs('#cf-precio-luz').value) : null,
        moneda: qs('#cf-moneda').value,
        dias_gracia_mora: Number(qs('#cf-dias-gracia').value || 0),
        porcentaje_mora_mensual: Number(qs('#cf-porcentaje-mora').value || 0),
        color_lineas_tabla: colorLineas,
        color_acento_reportes: colorAcentoReportes,
      });
      showToast('Configuración actualizada.', 'success');
    } catch (err) {
      console.error(err);
      showToast('No se pudo guardar la configuración.', 'error');
    } finally {
      setLoading(btn, false);
    }
  });
}

main();


/* ======================= SERIES Y COLORES DE LAS CUOTAS ======================= */
const COLORES_DEF = { ALQ: '#1D4ED8', SAGUA: '#0891B2', SLUZ: '#D97706', MANT: '#7C3AED' };
const COLORES_EXTRA = ['#7C3AED', '#059669', '#DB2777', '#0D9488', '#B45309'];
let filasCobro = [];

async function cargarCobroTipos() {
  const tbody = qs('#cobro-tipos-tbody');
  if (!tbody) return;
  try {
    const [guardados, servicios] = await Promise.all([listCobroTipos().catch(() => []), listTiposServicio()]);
    const mapa = new Map(guardados.map((t) => [t.tipo_clave, t]));
    const lista = [{ clave: 'ALQ', etiqueta: 'Alquiler' }, { clave: 'MANT', etiqueta: 'Mantenimiento' }, ...servicios.map((t) => ({ clave: claveTipoCuota('servicio', t.nombre), etiqueta: `Servicio · ${t.nombre}` }))];
    let extra = 0;
    filasCobro = lista.map((t) => {
      const g = mapa.get(t.clave);
      return { ...t, prefijo: g?.prefijo ?? t.clave, color: g?.color ?? COLORES_DEF[t.clave] ?? COLORES_EXTRA[extra++ % COLORES_EXTRA.length], digitos: g?.digitos ?? 4 };
    });
    tbody.innerHTML = '';
    filasCobro.forEach((f) => {
      const ej = document.createElement('code');
      const pintarEj = () => { ej.textContent = `${f.prefijo || '—'}1-${'0'.repeat(Math.max(0, f.digitos - 1))}1`; ej.style.color = f.color; ej.style.fontWeight = '700'; };
      const prefijo = Object.assign(document.createElement('input'), { type: 'text', value: f.prefijo, maxLength: 8 });
      prefijo.style.cssText = 'max-width:110px; text-transform:uppercase;';
      prefijo.addEventListener('input', () => { prefijo.value = prefijo.value.toUpperCase().replace(/[^A-Z]/g, ''); f.prefijo = prefijo.value; pintarEj(); });
      const picker = Object.assign(document.createElement('input'), { type: 'color', value: f.color });
      picker.style.cssText = 'width:46px; height:34px; padding:2px; cursor:pointer;';
      const hex = Object.assign(document.createElement('input'), { type: 'text', value: f.color });
      hex.style.maxWidth = '100px';
      picker.addEventListener('input', () => { f.color = picker.value; hex.value = picker.value; pintarEj(); });
      hex.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) { f.color = hex.value; picker.value = hex.value; pintarEj(); } });
      const dig = Object.assign(document.createElement('input'), { type: 'number', value: f.digitos, min: 3, max: 8 });
      dig.style.maxWidth = '70px';
      dig.addEventListener('input', () => { f.digitos = Number(dig.value) || 4; pintarEj(); });
      if (!isAdmin(profile)) [prefijo, picker, hex, dig].forEach((x) => { x.disabled = true; });
      pintarEj();
      const tr = document.createElement('tr');
      const td = (...nodos) => { const c = document.createElement('td'); nodos.forEach((n) => c.append(n)); tr.append(c); };
      td(document.createTextNode(f.etiqueta));
      td(prefijo);
      const caja = document.createElement('div'); caja.style.cssText = 'display:flex; gap:8px; align-items:center;'; caja.append(picker, hex);
      td(caja); td(dig); td(ej);
      tbody.append(tr);
    });
    qs('#btn-guardar-cobro-tipos')?.addEventListener('click', guardarCobroTipos);
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--gray-500);">No se pudo cargar. ¿Ejecutaste el SQL 30?</td></tr>';
  }
}

async function guardarCobroTipos() {
  const invalida = filasCobro.find((f) => !/^[A-Z]{2,8}$/.test(f.prefijo));
  if (invalida) { showToast(`El prefijo de "${invalida.etiqueta}" debe tener de 2 a 8 letras (A–Z).`, 'error'); return; }
  const repetidos = filasCobro.map((f) => f.prefijo).filter((x, i, a) => a.indexOf(x) !== i);
  if (repetidos.length) { showToast(`Prefijo repetido: ${repetidos[0]}. Cada tipo necesita el suyo.`, 'error'); return; }
  const btn = qs('#btn-guardar-cobro-tipos');
  setLoading(btn, true, 'Guardando…');
  try {
    await saveCobroTipos(filasCobro.map((f) => ({ tipo_clave: f.clave, etiqueta: f.etiqueta, prefijo: f.prefijo, color: f.color, digitos: f.digitos })));
    showToast('Series y colores guardados.', 'success');
  } catch (err) {
    console.error(err);
    showToast('No se pudo guardar. ¿Ejecutaste el SQL 30?', 'error');
  } finally {
    setLoading(btn, false);
  }
}
