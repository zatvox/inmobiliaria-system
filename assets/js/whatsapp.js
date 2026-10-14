/**
 * whatsapp.js — Envío por WhatsApp (wa.me). Una página web NO puede adjuntar
 * ni enviar mensajes por sí sola (eso requiere la API de pago de WhatsApp
 * Business), así que el flujo es: 1 clic → la imagen se copia al portapapeles
 * y se abre el chat del inquilino con el mensaje ya escrito → el usuario pega
 * (Ctrl+V) y presiona Enviar.
 */
import { el, formatCurrency, formatDate, showToast } from './utils.js';

// Devuelve solo dígitos con código de país (Perú 51 por defecto) o null.
export function normalizarTelefono(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9 && d.startsWith('9')) d = `51${d}`;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

// "GERARDO FREDY RAYMUNDO CONDORI" -> "Gerardo"
export function nombreCorto(nombre) {
  // Razones sociales (S.A.C., S.R.L., E.I.R.L., GRUPO…) no tienen "primer nombre".
  if (/\b(S\.?A\.?C\.?|S\.?A\.?A\.?|S\.?R\.?L\.?|E\.?I\.?R\.?L\.?|S\.?A\.?|GRUPO|CORP\w*|EMPRESA)\b/i.test(String(nombre ?? ''))) return '';
  const p = String(nombre ?? '').trim().split(/\s+/)[0] ?? '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}

const saludo = (nombre) => { const n = nombreCorto(nombre); return `Hola${n ? ' ' + n : ''}, buenas.`; };
const fecha = (v) => (v ? formatDate(v, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

// Los mensajes van SIN emojis: la página de wa.me los muestra como "�" (rompe
// los pares sustitutos) y algunos clientes también. Se usa *negrita* de
// WhatsApp y saltos de línea, que sí funcionan en todos lados.
export function mensajeServicio(c) {
  return `${saludo(c.deudor)}\n\nTe compartimos el cuadro de consumo de tu servicio:\n- *${c.concepto ?? 'Servicio'}*\n- Total a pagar: *${formatCurrency(c.saldo)}*\n- Vence: *${fecha(c.fecha_vencimiento)}*\n\nCualquier consulta estamos a tu disposición. ¡Gracias!`;
}
export function mensajeMensualidad(c) {
  return `${saludo(c.deudor)}\n\nTe compartimos el detalle de tu mensualidad:\n- *${c.concepto ?? 'Renta mensual'}* (${c.referencia})\n- Total a pagar: *${formatCurrency(c.saldo)}*\n- Vence: *${fecha(c.fecha_vencimiento)}*\n\nCualquier consulta estamos a tu disposición. ¡Gracias!`;
}
export function mensajeEstadoCuenta(nombre, saldoTotal) {
  return `${saludo(nombre)}\n\nTe compartimos tu estado de cuenta.\n- Total pendiente: *${formatCurrency(saldoTotal)}*\n\nCualquier consulta estamos a tu disposición. ¡Gracias!`;
}

// Tarjeta de mensualidad (para cuotas de alquiler) — misma línea visual que el cuadro de consumo.
export function buildTarjetaMensualidadEl(c, acento = '#1B3A5C') {
  const fila = (k, v, fuerte = false) => el('div', { style: 'display:flex; justify-content:space-between; padding:9px 0; border-bottom:1px solid #E5E7EB;' }, [
    el('span', { style: 'color:#6B7280;' }, k), el('span', { style: `font-weight:${fuerte ? 800 : 600};` }, v),
  ]);
  return el('div', { style: 'width:460px; font-family:Inter,Arial,sans-serif; background:#fff; border:1px solid #E5E7EB; border-radius:14px; overflow:hidden;' }, [
    el('div', { style: `background:${acento}; color:#fff; padding:18px 22px;` }, [
      el('div', { style: 'font-size:22px; font-weight:800;' }, 'MENSUALIDAD'),
      el('div', { style: 'opacity:.9; margin-top:4px;' }, c.referencia),
    ]),
    el('div', { style: 'padding:6px 22px 18px;' }, [
      el('div', { style: `color:${acento}; font-weight:800; font-size:16px; padding:12px 0 4px;` }, c.deudor),
      fila('Concepto', c.concepto ?? 'Renta mensual'),
      fila('Vencimiento', fecha(c.fecha_vencimiento)),
      fila('Importe', formatCurrency(Number(c.monto) + Number(c.mora_aplicada || 0))),
      fila('Pagado', formatCurrency(c.totalPagado ?? 0)),
      el('div', { style: `display:flex; justify-content:space-between; align-items:center; padding-top:14px; border-top:3px solid ${acento}; margin-top:6px;` }, [
        el('span', { style: 'font-weight:800;' }, 'TOTAL A PAGAR'),
        el('span', { style: `font-weight:800; font-size:24px; color:${acento};` }, formatCurrency(c.saldo)),
      ]),
    ]),
  ]);
}

// obtenerCanvas: () => Promise<HTMLCanvasElement>. Debe llamarse directo desde
// un clic (el portapapeles exige gesto del usuario).
export async function enviarImagenWhatsapp({ telefono, mensaje, obtenerCanvas, nombreArchivo = 'detalle' }) {
  const tel = normalizarTelefono(telefono);
  if (!tel) { showToast('Esta persona no tiene un teléfono válido registrado (Personas → teléfono).', 'error'); return false; }
  const blobPromise = obtenerCanvas().then((c) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Sin imagen'))), 'image/png')));
  let copiada = false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
    copiada = true;
  } catch (err) {
    console.error(err);
    try { // Plan B: descargar la imagen para adjuntarla a mano.
      const b = await blobPromise;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = `${nombreArchivo}.png`; a.click();
    } catch (e2) { console.error(e2); showToast('No se pudo generar la imagen.', 'error'); return false; }
  }
  const w = window.open(`https://wa.me/${tel}?text=${encodeURIComponent(mensaje)}`, '_blank');
  if (!w) showToast('El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio.', 'error');
  else showToast(copiada ? 'Imagen copiada. En el chat pega con Ctrl+V y presiona Enviar.' : 'Imagen descargada: adjúntala en el chat y envía.', 'success', 7000);
  return true;
}
