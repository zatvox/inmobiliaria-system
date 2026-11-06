/**
 * contrato-prestamo.js — Motor del "Contrato de Préstamo (mutuo) con intereses".
 * Módulo PURO: recibe datos normalizados y devuelve BLOQUES de documento
 * (title · heading · para · clause · sub · table · sign · pagebreak · annex)
 * que consumen los mismos exportadores del contrato de alquiler
 * (vista previa, Word y PDF) — ver contrato-export.js.
 */
import { montoTexto, fmtNumero, fmtMonto, fechaLarga, numALetras, romano } from './contrato-modelo.js';

const PUNTOS = '…………………';
const val = (x, ph = PUNTOS) => (x !== null && x !== undefined && String(x).trim() !== '' ? String(x).trim() : ph);
const B = (x) => `**${x}**`;
const esFem = (t = '') => /^(doña|la sra|sra|señora|la señora)/i.test(t.trim());
const o_a = (t) => (esFem(t) ? 'a' : 'o');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');

function partesFecha(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

function personaTxt(p, rol) {
  if (p?.juridica) {
    return `la empresa ${B(val(p.nombre).toUpperCase())}, identificada con RUC N° ${B(val(p.doc))}, debidamente representada por ${p.repTratamiento || 'el Sr.'} ${val(p.repNombre)}${p.repCargo ? ` en su calidad de ${p.repCargo}` : ''}, con domicilio en ${val(p.domicilio)}, a quien en adelante se le denominará ${B(rol)}`;
  }
  return `${p?.tratamiento || 'don'} ${B(val(p?.nombre).toUpperCase())}, identificad${o_a(p?.tratamiento)} con ${B(p?.docTipo || 'DNI')} N° ${B(val(p?.doc))}, con domicilio en ${val(p?.domicilio)}, a quien en adelante se le denominará ${B(rol)}`;
}

/** @param d datos normalizados (ver contrato-prestamo-ui.js) */
export function construirContratoPrestamo(d) {
  const faltantes = [];
  const falta = (cond, txt) => { if (cond) faltantes.push(txt); };
  falta(!d.prestamista?.doc, 'documento del prestamista');
  falta(!d.prestamista?.domicilio, 'domicilio del prestamista');
  falta(!d.prestatario?.doc, 'documento del prestatario');
  falta(!d.prestatario?.domicilio, 'domicilio del prestatario');
  falta(!d.fechaFirma, 'fecha de firma');

  const mon = d.moneda ?? 'PEN';
  const cron = d.cronograma ?? [];
  const n = cron.length;
  const f = partesFecha(d.fechaFirma);
  const diaF = f ? String(f.d) : '……', mesF = f ? MESES[f.m - 1] : '…………', anioF = f ? String(f.y) : '……';
  const totales = cron.reduce((a, x) => ({ cuota: a.cuota + x.cuota, interes: a.interes + x.interes }), { cuota: 0, interes: 0 });
  const tasaTxt = `${fmtNumero(d.tasaValor)}% ${d.tasaTipo === 'anual' ? 'anual' : 'mensual'}`;
  const tm = d.tasaTipo === 'anual' ? d.tasaValor / 12 : d.tasaValor;
  const cuotaTipica = cron[0]?.cuota ?? 0;
  const diaPago = d.diaPago || (cron[0] ? Number(cron[0].fecha_pago.slice(8, 10)) : null);
  const conAval = !!d.aval?.tiene;

  const cl = [];
  cl.push({ titulo: 'PRIMERA: OBJETO DEL CONTRATO', md: `${B('EL PRESTAMISTA')} entrega en este acto a ${B('EL PRESTATARIO')}, en calidad de préstamo (mutuo) con intereses, la suma de ${B(montoTexto(d.monto, mon))}, que ${B('EL PRESTATARIO')} declara haber recibido a su entera conformidad${d.formaEntrega ? ` mediante ${d.formaEntrega}` : ''}, sirviendo el presente documento como el más amplio recibo y constancia de entrega, con fecha ${fechaLarga(d.fechaDesembolso)}.` });
  cl.push({ titulo: 'SEGUNDA: INTERESES', md: `El préstamo devenga un interés compensatorio de ${B(tasaTxt)}${d.tasaTipo === 'anual' ? ` (equivalente a ${fmtNumero(tm)}% mensual)` : ''}, calculado sobre el monto del préstamo. En consecuencia, cada cuota comprende un capital de ${B(fmtMonto(cron[0]?.capital ?? 0, mon))} y un interés de ${B(fmtMonto(cron[0]?.interes ?? 0, mon))}.` });
  cl.push({ titulo: 'TERCERA: PLAZO Y FORMA DE PAGO', md: `${B('EL PRESTATARIO')} se obliga a devolver el préstamo, más los intereses pactados, en ${B(`${numALetras(n)} (${n})`)} cuotas ${n > 1 ? 'mensuales e iguales' : 'única'} de ${B(montoTexto(cuotaTipica, mon))} cada una${diaPago ? `, pagaderas el día ${B(String(diaPago))} de cada mes` : ''}, con vencimiento de la primera cuota el ${B(fechaLarga(cron[0]?.fecha_pago))} y de la última el ${B(fechaLarga(cron[n - 1]?.fecha_pago))}. El monto total a devolver es de ${B(fmtMonto(totales.cuota, mon))}, de los cuales ${B(fmtMonto(d.monto, mon))} corresponden a capital y ${B(fmtMonto(totales.interes, mon))} a intereses. El detalle de cada cuota consta en el ${B('CRONOGRAMA DE PAGOS')} que forma parte de este contrato (Anexo 1).` });
  cl.push({ titulo: 'CUARTA: LUGAR Y MEDIO DE PAGO', md: `Los pagos se efectuarán en ${d.medioPago ? val(d.medioPago) : 'efectivo o mediante depósito/transferencia a la cuenta que indique EL PRESTAMISTA'}${d.cuenta ? `: ${val(d.cuenta)}` : ''}. ${B('EL PRESTAMISTA')} entregará la constancia o recibo correspondiente por cada pago. Los pagos se imputan primero a intereses y luego a capital.` });
  const mora = Number(d.moraPct) || 0;
  if (mora > 0) {
    cl.push({ titulo: 'QUINTA: MORA', md: `El retraso en el pago de cualquier cuota genera de pleno derecho, sin necesidad de requerimiento, un interés moratorio de ${B(`${fmtNumero(mora)}%`)} mensual sobre la cuota impaga, hasta su cancelación total.` });
  }
  cl.push({ titulo: 'VENCIMIENTO ANTICIPADO', md: `Si ${B('EL PRESTATARIO')} incumple el pago de ${B(numALetras(d.cuotasMora || 2).toLowerCase() + ` (${d.cuotasMora || 2})`)} o más cuotas, ${B('EL PRESTAMISTA')} podrá dar por vencidos todos los plazos y exigir el pago inmediato del saldo de capital más los intereses devengados y moratorios.` });
  cl.push({ titulo: 'PAGO ANTICIPADO', md: `${B('EL PRESTATARIO')} podrá efectuar pagos anticipados totales o parciales; en tal caso las partes recalcularán por escrito los intereses sobre el saldo de capital.` });
  if (conAval) {
    cl.push({ titulo: 'AVAL', md: `Interviene en calidad de ${B('AVAL')} ${d.aval.tratamiento || 'el señor'} ${B(val(d.aval.nombre).toUpperCase())}, identificad${o_a(d.aval.tratamiento)} con ${B(d.aval.docTipo || 'DNI')} N° ${B(val(d.aval.doc))}${d.aval.domicilio ? `, con domicilio en ${d.aval.domicilio}` : ''}, quien se constituye en garante solidario, sin beneficio de excusión, del cumplimiento de todas las obligaciones de ${B('EL PRESTATARIO')}.` });
  }
  if (d.garantia) {
    cl.push({ titulo: 'GARANTÍA', md: `Como respaldo de la obligación, las partes acuerdan: ${val(d.garantia)}.` });
  }
  cl.push({ titulo: 'GASTOS', md: `Los gastos y tributos que pudiera generar la celebración y ejecución de este contrato serán asumidos por ${B('EL PRESTATARIO')}.` });
  cl.push({ titulo: 'DOMICILIO Y JURISDICCIÓN', md: `Las partes señalan como sus domicilios los indicados en la introducción. Para cualquier controversia se someten a la competencia de los jueces y tribunales de ${d.jurisdiccion || d.ciudad || 'Lima'}, renunciando al fuero de sus domicilios.` });

  const blocks = [];
  blocks.push({ k: 'title', text: 'CONTRATO DE PRÉSTAMO CON INTERESES' });
  blocks.push({
    k: 'para',
    md: `En la ciudad de ${d.ciudad || 'Lima'}, a los ${diaF} días del mes de ${mesF} de ${anioF}, se reúnen de una parte ${personaTxt(d.prestamista, 'EL PRESTAMISTA')}; y de la otra parte ${personaTxt(d.prestatario, 'EL PRESTATARIO')}${conAval ? `; interviniendo además el AVAL que se indica en este documento` : ''}; quienes convienen en celebrar el presente contrato bajo los términos y condiciones siguientes:`,
  });
  cl.forEach((c, i) => {
    blocks.push({ k: 'heading', text: c.titulo.includes(':') ? c.titulo : `${['QUINTA', 'SEXTA', 'SÉPTIMA', 'OCTAVA', 'NOVENA', 'DÉCIMA', 'UNDÉCIMA', 'DUODÉCIMA'][i - 4] ?? romano(i + 1)}: ${c.titulo}` });
    blocks.push({ k: 'clause', num: `${romano(i + 1)}.`, md: c.md });
  });
  blocks.push({
    k: 'para', gapBefore: true,
    md: `En señal de conformidad, las partes firman el presente documento en la ciudad de ${d.ciudad || 'Lima'}, a los ${diaF} días del mes de ${mesF} de ${anioF}.`,
  });
  const firmaDe = (p, rol) => ({ lines: [val(p?.nombre).toUpperCase(), `${p?.juridica ? 'RUC' : (p?.docTipo || 'DNI')} N° ${val(p?.doc)}`, rol] });
  blocks.push({
    k: 'sign',
    filas: [
      [firmaDe(d.prestamista, 'EL PRESTAMISTA'), firmaDe(d.prestatario, 'EL PRESTATARIO')],
      ...(conAval ? [[firmaDe(d.aval, 'AVAL'), null]] : []),
    ],
  });

  blocks.push({ k: 'pagebreak' });
  blocks.push({ k: 'annex', text: 'ANEXO 1: CRONOGRAMA DE PAGOS' });
  blocks.push({
    k: 'para',
    md: `Préstamo de ${B(fmtMonto(d.monto, mon))} · ${B(String(n))} cuotas · tasa ${B(tasaTxt)} · desembolso ${B(dmy(d.fechaDesembolso))}.`,
  });
  blocks.push({
    k: 'table',
    head: ['N.° de cuota', 'Monto a pagar', 'Capital', 'Interés', 'Saldo capital', 'Fecha de pago'],
    align: ['c', 'r', 'r', 'r', 'r', 'c'],
    rows: cron.map((x) => [String(x.nro), fmtNumero(x.cuota), fmtNumero(x.capital), fmtNumero(x.interes), fmtNumero(x.saldo_capital), dmy(x.fecha_pago)]),
    foot: ['Total', fmtNumero(totales.cuota), fmtNumero(cron.reduce((s, x) => s + x.capital, 0)), fmtNumero(totales.interes), '', ''],
  });
  if (d.anexos?.dni) blocks.push({ k: 'annex', text: 'ANEXO 2: COPIAS DE DNIs / DOCUMENTOS DE IDENTIDAD:' });

  return { blocks, faltantes };
}
