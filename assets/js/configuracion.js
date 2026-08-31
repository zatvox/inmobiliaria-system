/**
 * configuracion.js — Módulo de Configuración: variables globales del sistema
 * (precio por defecto de agua/luz, moneda, mora) editables desde una sola
 * pantalla, sin tocar código. Accesible desde el ícono ⚙️ del header en
 * todas las páginas.
 */
import { initShell } from './main.js';
import { isAdmin } from './auth.js';
import { getConfiguracionSistema, updateConfiguracionSistema } from './supabase-data.js';
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
}

const COLOR_LINEAS_DEFAULT = '#D1D5DB';

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
      await updateConfiguracionSistema({
        nombre_inmobiliaria: qs('#cf-nombre-inmobiliaria').value || null,
        precio_default_agua_m3: qs('#cf-precio-agua').value ? Number(qs('#cf-precio-agua').value) : null,
        precio_default_luz_kwh: qs('#cf-precio-luz').value ? Number(qs('#cf-precio-luz').value) : null,
        moneda: qs('#cf-moneda').value,
        dias_gracia_mora: Number(qs('#cf-dias-gracia').value || 0),
        porcentaje_mora_mensual: Number(qs('#cf-porcentaje-mora').value || 0),
        color_lineas_tabla: colorLineas,
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
