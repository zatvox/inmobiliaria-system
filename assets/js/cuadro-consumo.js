/**
 * cuadro-consumo.js — Construye el "cuadro de consumo" que se le presenta
 * al inquilino para que pague: junta el detalle de todas las cuentas
 * (Lt14, Lt15, baño compartido, etc.) que aportan a una misma sección en un
 * solo cuadro con lecturas, consumo, precio y subtotal por cuenta, más el
 * total a pagar. Se usa desde el tab "Cálculo" (vista previa antes de
 * generar la cobranza) y desde "Cobranzas y Pagos" (descarga por cuota ya
 * generada) — de ahí que viva en un módulo aparte en vez de duplicarse.
 */
import { el, formatCurrency, formatNumber, formatDate } from './utils.js';
import { getConfiguracionSistema } from './supabase-data.js';

let html2canvasPromise = null;
let colorLineasCache = null;
const COLOR_LINEAS_DEFAULT = '#D1D5DB'; // mismo gris que --gray-300 del resto de la app

// El color de las líneas de la tabla del cuadro de consumo es configurable
// desde Configuración (⚙️) — se pide una sola vez por sesión y se cachea.
export async function getColorLineasTabla() {
  if (colorLineasCache) return colorLineasCache;
  try {
    const cfg = await getConfiguracionSistema();
    colorLineasCache = cfg?.color_lineas_tabla || COLOR_LINEAS_DEFAULT;
  } catch (err) {
    console.error(err);
    colorLineasCache = COLOR_LINEAS_DEFAULT;
  }
  return colorLineasCache;
}

// Carga html2canvas desde CDN solo la primera vez que se necesita (no hay
// build step en este proyecto, así que se inyecta como <script> clásico).
function cargarHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (html2canvasPromise) return html2canvasPromise;
  html2canvasPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    script.onload = () => resolve(window.html2canvas);
    script.onerror = () => reject(new Error('No se pudo cargar la herramienta de imagen (html2canvas). Revisa tu conexión a internet.'));
    document.head.append(script);
  });
  return html2canvasPromise;
}

// Agrupa filas de calculo_servicios_detalle (ya enriquecidas con lectura,
// sección, propiedad, cuenta e inquilino — ver listDetalleCalculoConLecturas
// / listDetalleCalculoPorCuota en supabase-data.js) en un cuadro por CUOTA
// cuando ya existe (así un inquilino con varias secciones bajo un mismo
// contrato — ej. 2 pisos de Edificio Polonia — sale en UN solo cuadro con
// varias filas, no en un cuadro por sección). Antes de generar la cobranza
// (cuota_id todavía null, vista previa en el tab Cálculo) se sigue agrupando
// por sección, que es lo correcto ahí porque se está revisando cuenta por
// cuenta, todavía sin combinar.
export function agruparDetalleParaCuadro(detalleRows) {
  const grupos = new Map();
  for (const d of detalleRows) {
    const key = d.cuota_id ?? d.seccion_id;
    if (!grupos.has(key)) {
      grupos.set(key, {
        seccionId: d.seccion_id,
        seccionNombres: new Set(),
        propiedadNombre: d.seccion?.propiedades?.nombre_referencial ?? d.calculo_periodo?.propiedad?.nombre_referencial ?? '—',
        inquilinoNombre: d.contrato_alquiler?.inquilino?.nombre ?? null,
        tipoServicioNombre: d.calculo_periodo?.tipo_servicio?.nombre ?? 'Servicio',
        unidadMedida: d.calculo_periodo?.tipo_servicio?.unidad_medida ?? '',
        periodo: d.calculo_periodo?.periodo ?? '',
        filas: [],
        total: 0,
      });
    }
    const g = grupos.get(key);
    if (d.seccion?.nombre) g.seccionNombres.add(d.seccion.nombre);
    if (!g.inquilinoNombre && d.contrato_alquiler?.inquilino?.nombre) g.inquilinoNombre = d.contrato_alquiler.inquilino.nombre;
    const cuenta = d.calculo_periodo?.recibo_general?.cuenta_servicio;
    // Una misma cuenta (ej. Lt14) puede aportar a una sección con MÁS de un
    // medidor — uno propio y otro compartido (ej. un baño común). Si no se
    // distinguen, ambas filas saldrían con la misma etiqueta "Lt14" y una
    // parecería estar duplicada o faltante. Se agrega el código del medidor
    // (y si es compartido, "compartido") para diferenciarlas siempre.
    const medidor = d.lectura?.medidor;
    const detalleMedidor = medidor ? `${medidor.codigo_medidor || 'sin código'}${medidor.es_compartido ? ' · compartido' : ''}` : null;
    const etiquetaBase = cuenta ? `${cuenta.codigo}${cuenta.nombre ? ' · ' + cuenta.nombre : ''}` : g.tipoServicioNombre;
    const etiqueta = detalleMedidor ? `${etiquetaBase} (${detalleMedidor})` : etiquetaBase;
    // Código corto para la columna de la tabla (ya no repetimos el nombre del
    // inquilino fila por fila — eso ahora va una sola vez en la cabecera del
    // cuadro): prioriza el código del medidor, si no hay usa el de la cuenta.
    const codigo = medidor?.codigo_medidor || cuenta?.codigo || '—';
    g.filas.push({
      etiqueta,
      codigo,
      seccionNombre: d.seccion?.nombre ?? '—',
      metodo: d.metodo,
      fechaLecturaAnterior: d.lectura?.fecha_lectura_anterior ?? null,
      fechaLectura: d.lectura?.fecha_lectura ?? null,
      lecturaAnterior: d.lectura?.lectura_anterior ?? null,
      lecturaActual: d.lectura?.lectura_actual ?? null,
      consumo: d.consumo,
      nPersonas: d.n_personas,
      precioUnitario: d.precio_unitario_aplicado,
      tarifaPorPersona: d.tarifa_por_persona,
      subtotal: Number(d.monto_calculado ?? 0),
    });
    g.total += Number(d.monto_calculado ?? 0);
  }
  return Array.from(grupos.values()).map((g) => {
    const nombres = [...g.seccionNombres];
    // Cuando el cuadro combina varias secciones (mismo contrato), se antepone
    // el nombre de la sección a cada fila para poder distinguirlas — si no,
    // dos secciones con el mismo tipo de cuenta ("Polonia Agua General")
    // saldrían con etiquetas idénticas y parecerían filas duplicadas.
    const filas = nombres.length > 1 ? g.filas.map((f) => ({ ...f, etiqueta: `${f.seccionNombre} — ${f.etiqueta}` })) : g.filas;
    return { ...g, seccionNombre: nombres.join(', ') || '—', filas };
  });
}

// Color de acento por tipo de servicio — mismo criterio que colorServicio()
// en servicios.js (azul agua / ámbar luz), pero repetido aquí en vez de
// importado para no crear una dependencia cruzada entre módulos por un
// detalle puramente visual.
function colorServicioCuadro(nombreServicio) {
  const n = (nombreServicio || '').toLowerCase();
  if (n.includes('agua')) return '#2563EB';
  if (n.includes('luz')) return '#D97706';
  return '#374151';
}

// Construye el nodo DOM del cuadro (tarjeta estilo "recibo") para un grupo
// devuelto por agruparDetalleParaCuadro. Pensado para poder capturarse tal
// cual con html2canvas. Diseño compacto inspirado en la hoja de control
// físico que ya usaban (cabecera de color por servicio, números grandes y
// legibles) — ancho responsivo con tope de 560px para que nunca se salga de
// su tarjeta contenedora, sin importar cuánto crezca el contenido.
export function buildCuadroConsumoEl(grupo, { colorLineas = COLOR_LINEAS_DEFAULT } = {}) {
  const acento = colorServicioCuadro(grupo.tipoServicioNombre);
  const bordeCelda = `border-bottom:1px solid ${colorLineas};`;
  // dd/mm/aaaa en vez del "19 ago. 2026" por defecto de formatDate — más
  // compacto y más fácil de leer rápido en una tabla apretada.
  const fechaCorta = (value) => formatDate(value, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const filasNodos = grupo.filas.map((f) => {
    const esMedidor = f.metodo === 'medidor';
    const esMontoFijo = f.metodo === 'monto_fijo';
    // Lectura anterior → actual y el rango de fechas de lectura se apilan en
    // 2 líneas en vez de una sola línea larga — así no fuerzan el ancho de
    // la columna y quedan igual de legibles que en la hoja física de antes.
    const colLectura = esMedidor && f.lecturaAnterior != null && f.lecturaActual != null
      ? el('div', {}, [
          el('div', {}, formatNumber(f.lecturaAnterior, 3)),
          el('div', {}, `→ ${formatNumber(f.lecturaActual, 3)}`),
        ])
      : '—';
    const colFechas = !esMontoFijo && f.fechaLecturaAnterior && f.fechaLectura
      ? el('div', {}, [
          el('div', {}, fechaCorta(f.fechaLecturaAnterior)),
          el('div', {}, `– ${fechaCorta(f.fechaLectura)}`),
        ])
      : (!esMontoFijo && f.fechaLectura ? fechaCorta(f.fechaLectura) : '—');
    // Monto fijo (contrato) no tiene lectura ni "personas" que mostrar — es
    // un monto pactado en el contrato de alquiler, distinto de la tarifa
    // fija por persona (default global) y de un consumo medido.
    let colConsumo = `${f.nPersonas ?? 0} pers.`;
    let colPrecio = formatCurrency(f.tarifaPorPersona);
    if (esMedidor) {
      colConsumo = `${formatNumber(f.consumo, 3)} ${grupo.unidadMedida}`;
      colPrecio = formatNumber(f.precioUnitario, 4);
    } else if (esMontoFijo) {
      colConsumo = 'Monto fijo (contrato)';
      colPrecio = '—';
    }
    return el('tr', { title: f.etiqueta }, [
      el('td', { style: `padding:8px 10px; font-weight:600; ${bordeCelda}` }, f.codigo),
      el('td', { style: `padding:8px 10px; text-align:right; ${bordeCelda}` }, colFechas),
      el('td', { style: `padding:8px 10px; text-align:right; white-space:nowrap; ${bordeCelda}` }, colLectura),
      el('td', { style: `padding:8px 10px; text-align:right; white-space:nowrap; ${bordeCelda}` }, colConsumo),
      el('td', { style: `padding:8px 10px; text-align:right; ${bordeCelda}` }, colPrecio),
      el('td', { style: `padding:8px 10px; text-align:right; font-weight:700; ${bordeCelda}` }, formatCurrency(f.subtotal)),
    ]);
  });

  return el('div', {
    class: 'cuadro-consumo',
    style: `background:#fff; border:1px solid var(--gray-300); border-radius:10px; overflow:hidden; max-width:760px; width:100%; box-sizing:border-box; font-family:inherit;`,
  }, [
    // Cabecera de color sólido por servicio — mismo criterio de color que el
    // resto del sistema (leyenda Agua/Luz de la pestaña Lecturas).
    el('div', { style: `background:${acento}; color:#fff; padding:14px 18px; display:flex; justify-content:space-between; align-items:flex-start;` }, [
      el('div', {}, [
        el('div', { style: 'font-size:20px; font-weight:800; letter-spacing:0.5px;' }, grupo.tipoServicioNombre.toUpperCase()),
        el('div', { style: 'font-size:13px; opacity:0.9; margin-top:2px;' }, grupo.propiedadNombre),
        el('div', { style: 'font-size:13px; opacity:0.9;' }, grupo.seccionNombre),
      ]),
      el('div', { style: 'text-align:right;' }, [
        el('div', { style: 'font-size:12px; opacity:0.85;' }, 'Periodo'),
        el('div', { style: 'font-weight:700; font-size:15px;' }, grupo.periodo),
      ]),
    ]),
    grupo.inquilinoNombre ? el('div', { style: `background:${acento}18; padding:10px 18px; font-size:16px; font-weight:700; color:${acento};` }, grupo.inquilinoNombre) : null,
    el('div', { style: 'padding:0 18px;' }, [
      el('table', { style: 'width:100%; border-collapse:collapse; table-layout:fixed; font-size:14px; margin-top:10px;' }, [
        el('colgroup', {}, [
          el('col', { style: 'width:22%;' }), el('col', { style: 'width:19%;' }), el('col', { style: 'width:16%;' }),
          el('col', { style: 'width:17%;' }), el('col', { style: 'width:11%;' }), el('col', { style: 'width:15%;' }),
        ]),
        el('thead', {}, [el('tr', { style: `background:var(--gray-100); ${bordeCelda}` }, [
          el('th', { style: `padding:8px 10px; text-align:left; ${bordeCelda}` }, 'Cuenta'),
          el('th', { style: `padding:8px 10px; text-align:right; ${bordeCelda}` }, 'Periodo lectura'),
          el('th', { style: `padding:8px 10px; text-align:right; ${bordeCelda}` }, 'Lectura'),
          el('th', { style: `padding:8px 10px; text-align:right; ${bordeCelda}` }, 'Consumo'),
          el('th', { style: `padding:8px 10px; text-align:right; ${bordeCelda}` }, 'Precio'),
          el('th', { style: `padding:8px 10px; text-align:right; ${bordeCelda}` }, 'Subtotal'),
        ])]),
        el('tbody', {}, filasNodos),
      ]),
    ]),
    el('div', { style: `display:flex; justify-content:space-between; align-items:center; margin:14px 18px 18px; padding-top:12px; border-top:2px solid ${acento};` }, [
      el('span', { style: 'font-size:15px; font-weight:700;' }, 'TOTAL A PAGAR'),
      el('span', { style: `font-size:22px; font-weight:800; color:${acento};` }, formatCurrency(grupo.total)),
    ]),
  ]);
}

// Renderiza el nodo fuera de pantalla, lo captura con html2canvas y
// descarga el PNG resultante — así se puede llamar tanto para un cuadro ya
// insertado en el DOM (Cálculo) como para uno armado al vuelo (Cobranzas).
export async function descargarCuadroComoImagen(nodo, filename) {
  // Si el nodo ya está insertado y visible en la página, lo capturamos tal
  // cual (mejor fidelidad de estilos computados). Si se armó al vuelo (ej.
  // desde Cobranzas, sin insertarlo en ningún lado), lo montamos oculto
  // fuera de pantalla primero para que html2canvas pueda medir/pintarlo.
  const yaEnDom = document.body.contains(nodo);
  let wrapper = null;
  if (!yaEnDom) {
    wrapper = el('div', { style: 'position:fixed; left:-9999px; top:0; background:#fff;' }, [nodo]);
    document.body.append(wrapper);
  }
  try {
    const html2canvas = await cargarHtml2Canvas();
    const canvas = await html2canvas(nodo, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const link = document.createElement('a');
    link.download = `${filename}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } finally {
    if (wrapper) wrapper.remove();
  }
}
