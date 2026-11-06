/**
 * contrato-prestamo-ui.js — Botón "📄 Contrato" de un préstamo.
 * Formulario con los datos que el sistema ya tiene (precargados) → vista previa
 * del contrato + cronograma → Descargar Word / PDF. Reutiliza el modal
 * #modal-contrato-doc y los exportadores del contrato de alquiler.
 */
import { getPrestamo, updatePrestamoDatos } from './supabase-data.js';
import { qs, el, showToast, openModal, closeModal, setLoading } from './utils.js';
import { construirContratoPrestamo } from './contrato-prestamo.js';
import { renderPreview, imprimirPDF, generarDocx } from './contrato-export.js';
import { inyectarEstilos } from './contrato-ui.js';

let ctx = null; // { prestamo, form }

const NOMBRES_M_EN_A = new Set(['luca', 'joshua', 'noa', 'jonna']);
const fem = (nombre = '') => {
  const w = (nombre.trim().split(/\s+/)[0] ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
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

function parteInicial(p) {
  return {
    juridica: esRuc(p), tratamiento: fem(p?.nombre) ? 'doña' : 'don', nombre: p?.nombre ?? '',
    docTipo: p?.tipo_documento || 'DNI', doc: p?.dni_ruc ?? '', domicilio: p?.direccion ?? '',
    repTratamiento: 'el Sr.', repNombre: '', repCargo: 'Gerente General',
  };
}

function datosIniciales(p) {
  const base = {
    ciudad: 'Lima', fechaFirma: p.fecha_desembolso ?? '', formaEntrega: '', medioPago: '', cuenta: '',
    moraPct: 0, cuotasMora: 2, jurisdiccion: 'Lima',
    prestamista: parteInicial(p.prestamista),
    prestatario: parteInicial(p.prestatario),
    aval: { tiene: !!p.aval_id, ...parteInicial(p.aval), tratamiento: fem(p.aval?.nombre) ? 'la señora' : 'el señor' },
    garantia: p.garantia ?? '',
    anexos: { dni: true },
  };
  const guardado = p.datos_contrato && typeof p.datos_contrato === 'object' ? p.datos_contrato : {};
  // Si cambió la persona del contrato, no arrastrar los datos guardados de la anterior.
  const g = { ...guardado };
  [['prestamista', p.prestamista], ['prestatario', p.prestatario], ['aval', p.aval]].forEach(([k, persona]) => {
    if (g[k] && persona && g[k].doc && persona.dni_ruc && g[k].doc !== persona.dni_ruc) delete g[k];
  });
  const out = merge(base, g);
  // Un dato guardado en blanco no debe tapar el que sí existe en la ficha del contacto.
  ['prestamista', 'prestatario', 'aval'].forEach((k) => {
    ['domicilio', 'doc', 'nombre', 'docTipo'].forEach((campo) => {
      if (!String(out[k]?.[campo] ?? '').trim() && base[k]?.[campo]) out[k][campo] = base[k][campo];
    });
  });
  out.garantia = p.garantia ?? out.garantia ?? '';
  out.aval.tiene = !!p.aval_id;
  return out;
}

function datosParaMotor(f, p) {
  const num = (x) => (x === '' || x == null ? 0 : Number(x));
  return {
    ...f,
    moneda: p.moneda, monto: Number(p.monto), tasaValor: Number(p.tasa_valor), tasaTipo: p.tasa_tipo,
    fechaDesembolso: p.fecha_desembolso, diaPago: p.dia_vencimiento,
    moraPct: num(f.moraPct), cuotasMora: num(f.cuotasMora) || 2,
    cronograma: (p.cronograma ?? []).map((x) => ({ nro: x.nro, fecha_pago: x.fecha_pago, cuota: Number(x.cuota), capital: Number(x.capital), interes: Number(x.interes), saldo_capital: Number(x.saldo_capital) })),
  };
}

const inp = (path, type = 'text', extra = {}) => el('input', { type, 'data-path': path, ...extra });
const sel = (path, ops) => el('select', { 'data-path': path }, ops.map(([v, t]) => el('option', { value: v }, t)));
const campo = (label, control, { full = false, span = 4, hint = '' } = {}) => el('div', { class: `form-field${full ? ' full' : ''}`, style: `--s:${span};` }, [
  el('label', {}, label), control, hint ? el('div', { class: 'hint' }, hint) : null,
]);
const bloque = (titulo, sub, hijos) => el('div', { class: 'ct-bloque' }, [
  el('div', { class: 'ct-bloque-t' }, [el('strong', {}, titulo), sub ? el('span', {}, ` — ${sub}`) : null]),
  el('div', { class: 'ct-grid' }, hijos),
]);

function bloquePersona(titulo, sub, pre, f) {
  const jur = get(f, `${pre}.juridica`);
  return bloque(titulo, sub, [
    campo('Tipo de persona', sel(`${pre}.juridica`, [['false', 'Persona natural'], ['true', 'Empresa (persona jurídica)']]), { span: 3 }),
    jur ? null : campo('Tratamiento', sel(`${pre}.tratamiento`, [['don', 'don'], ['doña', 'doña']]), { span: 2 }),
    campo(jur ? 'Razón social' : 'Nombre completo', inp(`${pre}.nombre`), { span: 5 }),
    campo('Tipo doc.', sel(`${pre}.docTipo`, [['DNI', 'DNI'], ['RUC', 'RUC'], ['CE', 'CE'], ['PASAPORTE', 'Pasaporte']]), { span: 2 }),
    campo(jur ? 'RUC' : 'N.° documento', inp(`${pre}.doc`), { span: 3 }),
    campo('Domicilio', inp(`${pre}.domicilio`), { full: true }),
    ...(jur ? [
      campo('Representante — tratamiento', sel(`${pre}.repTratamiento`, [['el Sr.', 'el Sr.'], ['la Sra.', 'la Sra.']]), { span: 2 }),
      campo('Representante legal', inp(`${pre}.repNombre`), { span: 5 }),
      campo('Cargo', inp(`${pre}.repCargo`), { span: 3 }),
    ] : []),
  ].filter(Boolean));
}

function construirFormulario(f) {
  const root = el('div', { class: 'ct-form' });
  root.append(bloque('Documento', 'firma, pago y mora', [
    campo('Ciudad de firma', inp('ciudad'), { span: 3 }),
    campo('Fecha de firma', inp('fechaFirma', 'date'), { span: 3, hint: 'Vacío = “a los ……. días”.' }),
    campo('Jurisdicción', inp('jurisdiccion'), { span: 3 }),
    campo('Forma de entrega del dinero (opcional)', inp('formaEntrega', 'text', { placeholder: 'Ej. transferencia bancaria, efectivo' }), { span: 6 }),
    campo('Medio de pago de las cuotas (opcional)', inp('medioPago', 'text', { placeholder: 'Ej. depósito en cuenta BCP' }), { span: 6 }),
    campo('Cuenta / datos de depósito (opcional)', inp('cuenta'), { span: 6 }),
    campo('Interés moratorio (% mensual)', inp('moraPct', 'number', { step: '0.01', min: '0' }), { span: 3, hint: '0 = sin cláusula de mora.' }),
    campo('Cuotas impagas para vencimiento anticipado', inp('cuotasMora', 'number', { min: '1', step: '1' }), { span: 3 }),
  ]));
  root.append(bloquePersona('Prestamista', 'EL PRESTAMISTA', 'prestamista', f));
  root.append(bloquePersona('Prestatario', 'EL PRESTATARIO', 'prestatario', f));
  if (f.aval.tiene) {
    root.append(bloque('Aval', 'se elige en “Editar” del contrato', [
      campo('Tratamiento', sel('aval.tratamiento', [['el señor', 'el señor'], ['la señora', 'la señora']]), { span: 3 }),
      campo('Nombre completo', inp('aval.nombre'), { span: 5 }),
      campo('Tipo doc.', sel('aval.docTipo', [['DNI', 'DNI'], ['CE', 'CE'], ['PASAPORTE', 'Pasaporte']]), { span: 2 }),
      campo('N.° documento', inp('aval.doc'), { span: 3 }),
      campo('Domicilio', inp('aval.domicilio'), { full: true }),
    ]));
  }
  root.append(bloque('Garantía y anexos', '', [
    campo('Garantía / respaldo', inp('garantia', 'text', { placeholder: 'Ej. Pagaré firmado por el prestatario' }), { full: true, hint: 'Se guarda en el contrato; vacío = se omite la cláusula.' }),
    campo('Anexos', el('label', { style: 'display:inline-flex; gap:6px; align-items:center; font-weight:400;' }, [
      (() => { const c = el('input', { type: 'checkbox', style: 'width:auto;' }); c.checked = !!f.anexos.dni; c.addEventListener('change', () => { f.anexos.dni = c.checked; }); return c; })(),
      'Anexo de DNIs',
    ]), { full: true }),
  ]));

  root.querySelectorAll('[data-path]').forEach((n) => {
    const path = n.dataset.path;
    const v = get(f, path);
    n.value = v === undefined || v === null ? '' : String(v);
    const aplicar = () => {
      let nv = n.value;
      if (n.tagName === 'SELECT' && (nv === 'true' || nv === 'false')) nv = nv === 'true';
      set(f, path, nv);
    };
    n.addEventListener('input', aplicar);
    n.addEventListener('change', () => { aplicar(); if (/\.juridica$/.test(path)) montarFormulario(); });
  });
  return root;
}

function montarFormulario() {
  qs('#ct-titulo').textContent = `Generar contrato de préstamo — ${ctx.form.prestatario.nombre || 'prestatario'}`;
  const body = qs('#ct-body'), footer = qs('#ct-footer');
  body.innerHTML = '';
  body.append(construirFormulario(ctx.form));
  footer.innerHTML = '';
  footer.append(
    el('button', { type: 'button', class: 'btn btn-tertiary', onclick: () => closeModal('modal-contrato-doc') }, 'Cancelar'),
    el('button', { type: 'button', class: 'btn btn-primary', onclick: (e) => irAPreview(e.currentTarget) }, 'Vista previa del contrato →'),
  );
}

async function irAPreview(btn) {
  setLoading(btn, true, 'Generando…');
  try {
    updatePrestamoDatos(ctx.prestamo.id, ctx.form).catch((err) => {
      console.error(err);
      showToast('No se guardaron los datos del documento; el contrato se genera igual.', 'warning', 5000);
    });
    const { blocks, faltantes } = construirContratoPrestamo(datosParaMotor(ctx.form, ctx.prestamo));
    ctx.blocks = blocks;
    const body = qs('#ct-body'), footer = qs('#ct-footer');
    body.innerHTML = '';
    if (faltantes.length) body.append(el('div', { class: 'ct-aviso' }, `Datos que faltan (resaltados como “…………” en el documento): ${faltantes.join(' · ')}.`));
    const papel = el('div', { class: 'ct-papel' });
    papel.append(renderPreview(blocks, { fotos: [] }));
    body.append(el('div', { class: 'ct-papel-wrap' }, [papel]));
    const nombre = `Contrato_Prestamo_${(ctx.form.prestatario.nombre || 'prestatario').replace(/[^\wÁÉÍÓÚÑáéíóúñ]+/g, '_')}_${(ctx.prestamo.fecha_desembolso ?? '').slice(0, 4)}`;
    footer.innerHTML = '';
    footer.append(
      el('button', { type: 'button', class: 'btn btn-tertiary', onclick: montarFormulario }, '← Editar datos'),
      el('button', { type: 'button', class: 'btn btn-secondary', onclick: (e) => descargarWord(e.currentTarget, nombre) }, '📝 Descargar Word (.docx)'),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => imprimirPDF(ctx.blocks, nombre, { fotos: [] }) }, '📄 Descargar PDF'),
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
    const blob = await generarDocx(ctx.blocks, { fotos: [] });
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

export async function abrirGenerarContratoPrestamo(id) {
  inyectarEstilos();
  try {
    showToast('Cargando datos del préstamo…', 'info', 1500);
    const prestamo = await getPrestamo(id);
    ctx = { prestamo, form: datosIniciales(prestamo) };
    montarFormulario();
    openModal('modal-contrato-doc');
  } catch (err) {
    console.error(err);
    showToast('No se pudieron cargar los datos del préstamo.', 'error');
  }
}
