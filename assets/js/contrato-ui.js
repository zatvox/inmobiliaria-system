/**
 * contrato-ui.js — "Generar contrato" del módulo Contratos (alquiler).
 * Flujo: botón 📄 en la fila → formulario con los datos que el sistema ya tiene
 * (precargados) + los que faltan (se guardan en contratos_alquiler.datos_contrato)
 * → vista previa del documento completo → Descargar Word / PDF.
 * El texto del modelo vive en contrato-modelo.js; los formatos en contrato-export.js.
 */
import { supabase } from './supabase-client.js';
import { getContratoAlquiler, updateContratoAlquiler, listTiposServicio, getSignedUrl } from './supabase-data.js';
import { qs, el, showToast, openModal, closeModal, setLoading } from './utils.js';
import { construirContrato } from './contrato-modelo.js';
import { renderPreview, CSS_CONTRATO, imprimirPDF, generarDocx } from './contrato-export.js';

let ctx = null; // { contrato, form (objeto de datos), fotos, tipos }

const PERSONA_COLS = 'id, nombre, tipo_documento, dni_ruc, telefono, email, direccion';

/* ------------------------------- utilidades -------------------------------- */
const NOMBRES_M_EN_A = new Set(['luca', 'joshua', 'noa', 'jonna']);
const fem = (nombre = '') => {
  const w = (nombre.trim().split(/\s+/)[0] ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /a$/.test(w) && !NOMBRES_M_EN_A.has(w);
};
const esRuc = (p) => p?.tipo_documento === 'RUC' || /^(10|15|17|20)\d{9}$/.test(p?.dni_ruc ?? '');
const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function set(o, path, v) {
  const ks = path.split('.');
  ks.slice(0, -1).reduce((a, k) => { a[k] = a[k] ?? {}; return a[k]; }, o)[ks.at(-1)] = v;
}
const merge = (base, extra) => {
  if (extra === undefined || extra === null) return base;
  if (Array.isArray(base) || Array.isArray(extra) || typeof base !== 'object' || typeof extra !== 'object' || base === null) return extra;
  const out = { ...base };
  Object.keys(extra).forEach((k) => { out[k] = merge(base[k], extra[k]); });
  return out;
};

/* ------------------------------ carga de datos ----------------------------- */
async function cargarContexto(contratoId) {
  const contrato = await getContratoAlquiler(contratoId);
  const seccionIds = [...new Set([contrato.seccion_id, ...(contrato.secciones_contrato ?? []).map((s) => s.seccion_id)].filter(Boolean))];
  const [propRes, inqRes, avalRes, secRes, tipos, fotosSec] = await Promise.all([
    supabase.from('propiedades').select(`id, nombre_referencial, direccion, distrito, partida_registral, propietario:propietario_id(${PERSONA_COLS})`).eq('id', contrato.seccion?.propiedad_id).maybeSingle(),
    supabase.from('personas').select(PERSONA_COLS).eq('id', contrato.inquilino_id).maybeSingle(),
    contrato.aval_id ? supabase.from('personas').select(PERSONA_COLS).eq('id', contrato.aval_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('secciones').select('id, nombre, area_m2, partida_registral').in('id', seccionIds),
    listTiposServicio(),
    supabase.from('secciones_fotos').select('url_storage, orden').in('seccion_id', seccionIds).order('orden'),
  ]);
  return {
    contrato,
    propiedad: propRes.data, inquilino: inqRes.data, aval: avalRes.data,
    secciones: secRes.data ?? [], tipos, fotosPaths: (fotosSec.data ?? []).map((f) => f.url_storage),
  };
}

/** Datos del formulario: lo que el sistema ya sabe + lo guardado antes en el contrato. */
function datosIniciales(c) {
  const { contrato, propiedad, inquilino, aval, secciones, tipos } = c;
  const prop = propiedad?.propietario;
  const fijos = new Map((contrato.servicios_fijos ?? []).map((s) => [s.tipo_servicio_id, Number(s.monto_fijo)]));
  const areaTotal = secciones.reduce((s, x) => s + Number(x.area_m2 ?? 0), 0);
  const renta = Number(contrato.monto_renta ?? 0);
  const base = {
    ciudad: 'Lima', fechaFirma: '', uso: 'comercial', banco: 'BCP',
    renovacion: { es: false, fechaAnterior: '' },
    aumentoPct: 10, renovacionAuto: !!contrato.renovacion_automatica,
    prop: {
      tratamiento: fem(prop?.nombre) ? 'doña' : 'don', nombre: prop?.nombre ?? '', docTipo: prop?.tipo_documento || 'DNI',
      doc: prop?.dni_ruc ?? '', domicilio: prop?.direccion ?? '',
    },
    inq: {
      juridica: esRuc(inquilino), tratamiento: fem(inquilino?.nombre) ? 'doña' : 'don', nombre: inquilino?.nombre ?? '',
      docTipo: inquilino?.tipo_documento || 'DNI', doc: inquilino?.dni_ruc ?? '', domicilio: inquilino?.direccion ?? '',
      repTratamiento: 'el Sr.', repNombre: '', repCargo: 'Gerente General', partida: '', oficinaRegistral: 'Lima',
    },
    aval: {
      tiene: !!contrato.aval_id, tratamiento: fem(aval?.nombre) ? 'la señora' : 'el señor', nombre: aval?.nombre ?? '',
      docTipo: aval?.tipo_documento || 'DNI', doc: aval?.dni_ruc ?? '', domicilio: aval?.direccion ?? '',
    },
    inmueble: {
      direccion: [propiedad?.direccion, propiedad?.distrito].filter(Boolean).join(', '),
      partida: propiedad?.partida_registral || secciones.find((s) => s.partida_registral)?.partida_registral || '',
      oficinaRegistral: 'Lima',
      lineas: secciones.map((s) => `${s.nombre}${Number(s.area_m2) > 0 ? `: ${Number(s.area_m2)} m² aprox.` : ''}`),
      areaTotal: areaTotal > 0 ? areaTotal : '',
    },
    garantia: { monto: Number(contrato.deposito_garantia ?? 0) || '', modalidad: '', abonos: [] },
    penalidadDiaria: renta ? Math.round((renta / 30) * 1.5 * 100) / 100 : '',
    servicios: tipos.map((t) => {
      const monto = fijos.get(t.id);
      return {
        tipoId: t.id, nombre: t.nombre,
        incluir: monto != null || /^(luz|agua)$/i.test(t.nombre),
        modo: monto != null ? 'fijo' : 'medidor', monto: monto ?? '',
      };
    }),
    llaves: { items: [{ desc: '', cant: 1 }], costoReposicion: 6 },
    contacto: { whatsapp: prop?.telefono ?? '', email: prop?.email ?? '' },
    anexos: { dni: true, recibos: true, fotos: c.fotosPaths.length > 0 },
  };
  const guardado = contrato.datos_contrato && typeof contrato.datos_contrato === 'object' ? contrato.datos_contrato : {};
  const out = merge(base, guardado);
  // La garantía pactada manda la del contrato (se edita en el modal Editar contrato).
  out.garantia = { ...out.garantia, monto: Number(contrato.deposito_garantia ?? 0) || '' };
  // Servicios: respeta lo guardado pero incorpora tipos nuevos que no estaban.
  const guardados = new Map((guardado.servicios ?? []).map((s) => [s.tipoId, s]));
  out.servicios = base.servicios.map((s) => ({ ...s, ...(guardados.get(s.tipoId) ?? {}) }));
  return out;
}

/** Datos finales para el motor: mezcla formulario + valores del contrato (siempre vigentes). */
function datosParaMotor(f, c) {
  const k = c.contrato;
  const num = (x) => (x === '' || x === null || x === undefined ? null : Number(x));
  return {
    ...f,
    moneda: k.moneda ?? 'PEN',
    fechaInicio: k.fecha_inicio, fechaFin: k.fecha_fin,
    renta: Number(k.monto_renta ?? 0),
    penalidadDiaria: num(f.penalidadDiaria) ?? 0,
    garantia: { ...f.garantia, monto: num(f.garantia?.monto) ?? 0, abonos: (f.garantia?.abonos ?? []).map((a) => ({ monto: num(a.monto), recibo: a.recibo })) },
    inmueble: { ...f.inmueble, areaTotal: num(f.inmueble?.areaTotal), lineas: Array.isArray(f.inmueble?.lineas) ? f.inmueble.lineas : String(f.inmueble?.lineas ?? '').split('\n').map((x) => x.trim()).filter(Boolean) },
    servicios: (f.servicios ?? []).map((s) => ({ ...s, monto: num(s.monto) ?? 0 })),
    llaves: { ...f.llaves, costoReposicion: num(f.llaves?.costoReposicion) ?? 6, items: (f.llaves?.items ?? []).map((l) => ({ desc: l.desc, cant: num(l.cant) ?? 1 })) },
    aumentoPct: num(f.aumentoPct) ?? 10,
  };
}

/* ------------------------------- formulario -------------------------------- */
const sel = (path, opciones) => {
  const s = el('select', { 'data-path': path }, opciones.map(([v, t]) => el('option', { value: v }, t)));
  return s;
};
const inp = (path, type = 'text', extra = {}) => el('input', { type, 'data-path': path, ...extra });
// Ancho por tipo de dato en una grilla de 12 columnas: fechas/números/selectores
// cortos ocupan poco; textos libres (nombres, direcciones) tienen más espacio.
const SPAN_POR_ETIQUETA = {
  'Tipo de contrato': 3, 'Contrato anterior firmado el': 3, 'Uso del inmueble': 3, 'Ciudad de firma': 3,
  'Fecha de firma': 3, 'Aumento mínimo en renovación (%)': 3, 'Banco para depósitos': 3, 'Renovación automática': 3,
  'Tratamiento': 2, 'Nombre completo': 5, 'Razón social': 5, 'Tipo doc.': 2, 'N° documento': 3, 'RUC': 2,
  'Tipo de persona': 3, 'Representante legal — tratamiento': 2, 'Representante legal — nombre': 5, 'Cargo': 3,
  'Partida electrónica N°': 2, 'Registros públicos de': 3, '¿Tiene aval?': 2,
  'Partida registral N°': 3, 'Oficina registral': 3, 'Área total a alquilar (m²)': 3,
  'Garantía (monto)': 3, 'Modalidad (opcional)': 3, 'Penalidad por día de permanencia adicional': 4,
  'WhatsApp de notificaciones': 3, 'Correo de notificaciones': 4, 'Costo de reposición de llave': 3,
};
const spanAuto = (control) => {
  if (control.tagName === 'TEXTAREA') return 12;
  if (control.tagName === 'SELECT') return 3;
  if (control.type === 'date' || control.type === 'number') return 2;
  return 4;
};
const campo = (label, control, { full = false, hint = '', span = null } = {}) => {
  const n = full ? 12 : (span ?? SPAN_POR_ETIQUETA[label] ?? spanAuto(control));
  const d = el('div', { class: `form-field${full ? ' full' : ''}`, style: `--s:${n};` }, [
    el('label', {}, label), control, hint ? el('div', { class: 'hint' }, hint) : null,
  ]);
  return d;
};
const bloque = (titulo, subtitulo, hijos) => el('div', { class: 'ct-bloque' }, [
  el('div', { class: 'ct-bloque-t' }, [el('strong', {}, titulo), subtitulo ? el('span', {}, ` — ${subtitulo}`) : null]),
  el('div', { class: 'ct-grid' }, hijos),
]);

function filasEditables({ items, columnas, vacio, onChange }) {
  // columnas: [{ key, placeholder, type, width }]
  const cont = el('div', { class: 'ct-filas' });
  const pintar = () => {
    cont.innerHTML = '';
    items.forEach((it, i) => {
      const fila = el('div', { class: 'ct-fila' }, [
        ...columnas.map((col) => {
          const input = el('input', { type: col.type ?? 'text', placeholder: col.placeholder ?? '', value: it[col.key] ?? '', style: col.width ? `flex:0 0 ${col.width};` : 'flex:1;', step: col.type === 'number' ? '0.01' : null });
          input.addEventListener('input', () => { it[col.key] = input.value; onChange?.(); });
          return input;
        }),
        el('button', { type: 'button', class: 'btn btn-tertiary btn-sm', title: 'Quitar', onclick: () => { items.splice(i, 1); pintar(); onChange?.(); } }, '✕'),
      ]);
      cont.append(fila);
    });
    cont.append(el('button', { type: 'button', class: 'btn btn-tertiary btn-sm', onclick: () => { items.push({ ...vacio }); pintar(); onChange?.(); } }, '+ Agregar'));
  };
  pintar();
  return cont;
}

function construirFormulario(f, c) {
  const root = el('div', { class: 'ct-form' });
  const jur = f.inq.juridica;

  root.append(bloque('Documento', 'tipo, uso y firma', [
    campo('Tipo de contrato', sel('renovacion.es', [['false', 'Contrato nuevo'], ['true', 'Renovación']])),
    campo('Contrato anterior firmado el', inp('renovacion.fechaAnterior', 'date'), { hint: 'Solo si es renovación.' }),
    campo('Uso del inmueble', sel('uso', [['comercial', 'Comercial'], ['vivienda', 'Vivienda']])),
    campo('Ciudad de firma', inp('ciudad')),
    campo('Fecha de firma', inp('fechaFirma', 'date'), { hint: 'Vacío = se imprime “a los ……. días”, para completar a mano.' }),
    campo('Aumento mínimo en renovación (%)', inp('aumentoPct', 'number')),
    campo('Banco para depósitos', inp('banco')),
    campo('Renovación automática', sel('renovacionAuto', [['true', 'Sí, renovable automáticamente'], ['false', 'No']])),
  ]));

  root.append(bloque('Propietario', 'EL PROPIETARIO', [
    campo('Tratamiento', sel('prop.tratamiento', [['don', 'don'], ['doña', 'doña']])),
    campo('Nombre completo', inp('prop.nombre')),
    campo('Tipo doc.', sel('prop.docTipo', [['DNI', 'DNI'], ['RUC', 'RUC'], ['CE', 'CE'], ['PASAPORTE', 'Pasaporte']])),
    campo('N° documento', inp('prop.doc')),
    campo('Domicilio', inp('prop.domicilio'), { full: true }),
  ]));

  const inqBloque = bloque('Inquilino', 'EL INQUILINO', [
    campo('Tipo de persona', sel('inq.juridica', [['false', 'Persona natural'], ['true', 'Empresa (persona jurídica)']])),
    campo(jur ? 'Razón social' : 'Nombre completo', inp('inq.nombre')),
    campo(jur ? 'Tipo doc.' : 'Tipo doc.', sel('inq.docTipo', [['DNI', 'DNI'], ['RUC', 'RUC'], ['CE', 'CE'], ['PASAPORTE', 'Pasaporte']])),
    campo(jur ? 'RUC' : 'N° documento', inp('inq.doc'), { span: 2 }),
    jur ? null : campo('Tratamiento', sel('inq.tratamiento', [['don', 'don'], ['doña', 'doña']])),
    campo('Domicilio', inp('inq.domicilio'), jur ? { full: true } : { span: 10 }),
    ...(jur ? [
      campo('Representante legal — tratamiento', sel('inq.repTratamiento', [['el Sr.', 'el Sr.'], ['la Sra.', 'la Sra.']])),
      campo('Representante legal — nombre', inp('inq.repNombre')),
      campo('Cargo', inp('inq.repCargo')),
      campo('Partida electrónica N°', inp('inq.partida')),
      campo('Registros públicos de', inp('inq.oficinaRegistral')),
    ] : []),
  ]);
  root.append(inqBloque);

  root.append(bloque('Aval', 'opcional', [
    campo('¿Tiene aval?', sel('aval.tiene', [['false', 'No'], ['true', 'Sí']])),
    ...(f.aval.tiene ? [
      campo('Tratamiento', sel('aval.tratamiento', [['el señor', 'el señor'], ['la señora', 'la señora']])),
      campo('Nombre completo', inp('aval.nombre'), { span: 4 }),
      campo('Tipo doc.', sel('aval.docTipo', [['DNI', 'DNI'], ['CE', 'CE'], ['PASAPORTE', 'Pasaporte']])),
      campo('N° documento', inp('aval.doc'), { span: 2 }),
    ] : []),
  ]));

  const lineasTxt = el('textarea', { 'data-path': 'inmueble.lineas', rows: '3', placeholder: 'Una línea por ambiente o sección' });
  root.append(bloque('Inmueble', 'ubicación y descripción', [
    campo('Dirección', inp('inmueble.direccion'), { full: true }),
    campo('Partida registral N°', inp('inmueble.partida')),
    campo('Oficina registral', inp('inmueble.oficinaRegistral')),
    campo('Descripción (una línea por viñeta)', lineasTxt, { full: true, hint: 'Se arma con las secciones del contrato; edítala (ej. “Dúplex en el 1er piso de 270 m² aprox. y mezanine de 90 m² aprox.”).' }),
    campo('Área total a alquilar (m²)', inp('inmueble.areaTotal', 'number', { step: '0.01' })),
  ]));

  // Garantía y abonos
  const abonosCont = filasEditables({
    items: f.garantia.abonos, vacio: { monto: '', recibo: '' },
    columnas: [{ key: 'monto', type: 'number', placeholder: 'Monto', width: '130px' }, { key: 'recibo', placeholder: 'N° de recibo' }],
  });
  root.append(bloque('Renta, garantía y penalidad', `Renta S/ ${Number(c.contrato.monto_renta).toFixed(2)} y fechas vienen del contrato`, [
    campo('Garantía (monto)', inp('garantia.monto', 'number', { step: '0.01' })),
    campo('Modalidad (opcional)', inp('garantia.modalidad', 'text', { placeholder: 'Ej. 2x1' })),
    campo('Penalidad por día de permanencia adicional', inp('penalidadDiaria', 'number', { step: '0.01' }), { hint: 'Sugerida: renta ÷ 30 + 50%.' }),
    el('div', { class: 'form-field full' }, [el('label', {}, 'Abonos de la garantía (monto + N° de recibo)'), abonosCont]),
  ]));

  // Servicios
  const filasServ = el('div', { class: 'ct-filas' });
  f.servicios.forEach((s) => {
    const chk = el('input', { type: 'checkbox', style: 'width:auto;' }); chk.checked = !!s.incluir;
    const modo = el('select', {}, [el('option', { value: 'medidor' }, 'Por consumo (medidor)'), el('option', { value: 'fijo' }, 'Monto fijo mensual')]); modo.value = s.modo;
    const monto = el('input', { type: 'number', step: '0.01', placeholder: 'Monto fijo', value: s.monto ?? '', style: 'flex:0 0 130px;' });
    const actualizar = () => { monto.style.display = modo.value === 'fijo' ? '' : 'none'; };
    chk.addEventListener('change', () => { s.incluir = chk.checked; });
    modo.addEventListener('change', () => { s.modo = modo.value; actualizar(); });
    monto.addEventListener('input', () => { s.monto = monto.value; });
    actualizar();
    filasServ.append(el('div', { class: 'ct-fila' }, [chk, el('strong', { style: 'flex:0 0 110px;' }, s.nombre), modo, monto]));
  });
  root.append(bloque('Servicios', 'la cláusula se arma con los marcados', [el('div', { class: 'form-field full' }, [filasServ])]));

  // Llaves
  const llavesCont = filasEditables({
    items: f.llaves.items, vacio: { desc: '', cant: 1 },
    columnas: [{ key: 'desc', placeholder: 'Puerta / ambiente (ej. Puerta principal de metal negra del 1er piso)' }, { key: 'cant', type: 'number', placeholder: 'Copias', width: '90px' }],
  });
  root.append(bloque('Entrega de llaves', 'según los ambientes del inmueble (vacío = se omite la cláusula)', [
    el('div', { class: 'form-field full' }, [llavesCont]),
    campo('Costo de reposición de llave', inp('llaves.costoReposicion', 'number', { step: '0.01' })),
  ]));

  root.append(bloque('Contacto y anexos', '', [
    campo('WhatsApp de notificaciones', inp('contacto.whatsapp', 'text', { placeholder: '+51 9…' })),
    campo('Correo de notificaciones', inp('contacto.email', 'email')),
    campo('Anexos', el('div', { class: 'ct-chks' }, [
      chkAnexo('dni', 'DNIs', f), chkAnexo('recibos', 'Recibos de abonos', f),
      chkAnexo('fotos', `Fotos del inmueble (${c.fotosPaths.length} disponibles)`, f),
    ]), { full: true }),
  ]));

  // Enlaza inputs data-path con el objeto f
  root.querySelectorAll('[data-path]').forEach((n) => {
    const path = n.dataset.path;
    let v = get(f, path);
    if (path === 'inmueble.lineas') v = Array.isArray(v) ? v.join('\n') : (v ?? '');
    if (n.tagName === 'SELECT') n.value = String(v);
    else n.value = v ?? '';
    const aplicar = () => {
      let nv = n.value;
      if (n.tagName === 'SELECT' && (nv === 'true' || nv === 'false')) nv = nv === 'true';
      set(f, path, path === 'inmueble.lineas' ? nv.split('\n').map((x) => x.trim()).filter(Boolean) : nv);
    };
    n.addEventListener('input', aplicar);
    n.addEventListener('change', () => {
      aplicar();
      // Cambios que alteran los campos visibles → repintar el formulario.
      if (['inq.juridica', 'aval.tiene'].includes(path)) montarFormulario();
    });
  });
  return root;
}

function chkAnexo(k, label, f) {
  const c = el('input', { type: 'checkbox', style: 'width:auto;' }); c.checked = !!f.anexos[k];
  c.addEventListener('change', () => { f.anexos[k] = c.checked; });
  return el('label', { style: 'display:inline-flex; gap:6px; align-items:center; margin-right:16px; font-weight:400;' }, [c, label]);
}

/* -------------------------------- pantallas -------------------------------- */
function inyectarEstilos() {
  if (document.getElementById('ct-estilos')) return;
  const s = document.createElement('style');
  s.id = 'ct-estilos';
  s.textContent = `
    .ct-bloque { border:1px solid var(--gray-200,#E5E7EB); border-radius:10px; padding:12px 14px; margin-bottom:12px; background:#FAFAFB; }
    .ct-bloque-t { margin-bottom:8px; } .ct-bloque-t span { color:var(--gray-500,#6B7280); font-size:12px; }
    .ct-grid { display:grid; grid-template-columns:repeat(12, minmax(0,1fr)); gap:12px 14px; align-items:start; }
    .ct-grid > .form-field { grid-column:span var(--s, 4); min-width:0; margin:0; }
    .ct-grid > .form-field.full { grid-column:1 / -1; }
    .ct-grid input[type=date] { min-width:0; }
    @media (max-width: 980px) { .ct-grid > .form-field { grid-column:span 6; } }
    @media (max-width: 560px) { .ct-grid > .form-field { grid-column:1 / -1; } }
    #modal-contrato-doc .form-field label { font-size:13px; }
    #modal-contrato-doc .form-field input, #modal-contrato-doc .form-field select { padding:8px 10px; }
    .ct-filas { display:flex; flex-direction:column; gap:6px; align-items:flex-start; width:100%; }
    .ct-fila { display:flex; gap:8px; align-items:center; width:100%; }
    .ct-fila input[type=text], .ct-fila input[type=number], .ct-fila select { min-width:0; }
    .ct-papel-wrap { background:#6B7280; padding:18px; border-radius:8px; max-height:64vh; overflow:auto; }
    .ct-papel { background:#fff; width:8.5in; max-width:100%; margin:0 auto; padding:0.75in 0.85in; box-shadow:0 2px 10px rgba(0,0,0,.35); box-sizing:border-box; }
    .ct-aviso { background:#FEF3C7; border:1px solid #F59E0B; color:#92400E; border-radius:8px; padding:10px 14px; margin-bottom:10px; font-size:13px; }
    ${CSS_CONTRATO}
  `;
  document.head.append(s);
}

function montarFormulario() {
  const body = qs('#ct-body'), footer = qs('#ct-footer');
  qs('#ct-titulo').textContent = `Generar contrato — ${ctx.form.inq.nombre || 'inquilino'}`;
  body.innerHTML = '';
  body.append(construirFormulario(ctx.form, ctx));
  footer.innerHTML = '';
  footer.append(
    el('button', { type: 'button', class: 'btn btn-tertiary', onclick: () => closeModal('modal-contrato-doc') }, 'Cancelar'),
    el('button', { type: 'button', class: 'btn btn-primary', id: 'ct-btn-preview', onclick: (e) => irAPreview(e.currentTarget) }, 'Vista previa del contrato →'),
  );
}

async function guardarDatos(silencioso = true) {
  try {
    await updateContratoAlquiler(ctx.contrato.id, { datos_contrato: ctx.form });
    if (!silencioso) showToast('Datos del contrato guardados.', 'success');
    return true;
  } catch (err) {
    console.error(err);
    if (!silencioso || !ctx.avisoSql) {
      showToast(/datos_contrato/.test(err?.message ?? '') ? 'Para guardar estos datos ejecuta el SQL 27 en Supabase (assets/sql/27_migrations-contrato-datos.sql). El documento se genera igual.' : 'No se pudieron guardar los datos del contrato.', 'warning', 7000);
      ctx.avisoSql = true;
    }
    return false;
  }
}

async function cargarFotos() {
  if (ctx.fotos) return ctx.fotos;
  ctx.fotos = [];
  for (const path of ctx.fotosPaths) {
    try {
      const url = await getSignedUrl(path, 3600);
      const dim = await new Promise((res) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res({ w: 520, h: 390 }); i.src = url; });
      ctx.fotos.push({ url, ...dim });
    } catch (e) { console.error(e); }
  }
  return ctx.fotos;
}

async function irAPreview(btn) {
  setLoading(btn, true, 'Generando…');
  try {
    guardarDatos(true); // sin await: no bloquea la vista previa
    const datos = datosParaMotor(ctx.form, ctx);
    const { blocks, faltantes } = construirContrato(datos);
    const fotos = ctx.form.anexos?.fotos ? await cargarFotos() : [];
    ctx.blocks = blocks; ctx.fotosUsar = fotos;

    const body = qs('#ct-body'), footer = qs('#ct-footer');
    body.innerHTML = '';
    if (faltantes.length) {
      body.append(el('div', { class: 'ct-aviso' }, `Datos que faltan (aparecen resaltados como “…………” en el documento): ${faltantes.join(' · ')}.`));
    }
    const papel = el('div', { class: 'ct-papel' });
    papel.append(renderPreview(blocks, { fotos }));
    body.append(el('div', { class: 'ct-papel-wrap' }, [papel]));

    const nombre = `Contrato_Arrendamiento_${(ctx.form.inq.nombre || 'inquilino').replace(/[^\wÁÉÍÓÚÑáéíóúñ]+/g, '_')}_${(ctx.contrato.fecha_inicio ?? '').slice(0, 4)}`;
    footer.innerHTML = '';
    footer.append(
      el('button', { type: 'button', class: 'btn btn-tertiary', onclick: montarFormulario }, '← Editar datos'),
      el('button', { type: 'button', class: 'btn btn-secondary', onclick: (e) => descargarWord(e.currentTarget, nombre) }, '📝 Descargar Word (.docx)'),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => imprimirPDF(ctx.blocks, nombre, { fotos: ctx.fotosUsar }) }, '📄 Descargar PDF'),
    );
  } catch (err) {
    console.error(err);
    showToast('No se pudo generar la vista previa del contrato.', 'error');
  } finally {
    setLoading(btn, false);
  }
}

async function descargarWord(btn, nombre) {
  setLoading(btn, true, 'Generando Word…');
  try {
    const blob = await generarDocx(ctx.blocks, { fotos: ctx.fotosUsar });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${nombre}.docx`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (err) {
    console.error(err);
    showToast(err?.message ?? 'No se pudo generar el Word.', 'error');
  } finally {
    setLoading(btn, false);
  }
}

/* ---------------------------------- API ----------------------------------- */
export async function abrirGenerarContrato(contratoId) {
  inyectarEstilos();
  try {
    showToast('Cargando datos del contrato…', 'info', 1500);
    const c = await cargarContexto(contratoId);
    ctx = { ...c, form: datosIniciales(c), fotos: null, avisoSql: false };
    montarFormulario();
    openModal('modal-contrato-doc');
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar los datos del contrato.', 'error');
  }
}
