/**
 * contrato-modelo.js — Motor del "Contrato de Arrendamiento" (modelo ALIZON
 * GRUPO 2026). Módulo PURO (sin DOM, sin Supabase): recibe un objeto de datos
 * normalizado y devuelve una lista de BLOQUES de documento que luego consumen
 * los exportadores (vista previa HTML, Word .docx y PDF). Así el mismo texto
 * se ve idéntico en pantalla, en Word y al imprimir.
 *
 * Marcado de texto dentro de los bloques: **negrita**. Los términos definidos
 * "EL PROPIETARIO" / "EL INQUILINO" se resaltan en negrita automáticamente.
 *
 * Bloques: title · heading · clause{num} · sub · bullet{level,marker} ·
 *          para · sign · pagebreak · annex · photos
 */

/* ============================== NÚMEROS / FECHAS ============================== */
const UNI = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
  'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO',
  'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DEC = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CEN = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function menorMil(n) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100), r = n % 100;
  const partes = [];
  if (c) partes.push(CEN[c]);
  if (r) {
    if (r < 30) partes.push(UNI[r]);
    else {
      const d = Math.floor(r / 10), u = r % 10;
      partes.push(u ? `${DEC[d]} Y ${UNI[u]}` : DEC[d]);
    }
  }
  return partes.join(' ');
}

/** Entero → letras en MAYÚSCULAS ("UN" como apócope cuando va antes de sustantivo). */
export function numALetras(n, { apocope = true } = {}) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes = [];
  if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : `${numALetras(millones)} MILLONES`);
  if (miles) partes.push(miles === 1 ? 'MIL' : `${numALetras(miles)} MIL`);
  if (resto) partes.push(menorMil(resto));
  let txt = partes.join(' ');
  if (apocope) txt = txt.replace(/UNO$/, 'UN').replace(/VEINTIUNO$/, 'VEINTIÚN');
  return txt;
}

const MONEDAS = {
  PEN: { simbolo: 'S/', singular: 'SOL', plural: 'SOLES' },
  USD: { simbolo: 'US$', singular: 'DÓLAR AMERICANO', plural: 'DÓLARES AMERICANOS' },
};

export function fmtNumero(n) {
  return Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function fmtMonto(n, moneda = 'PEN') {
  return `${(MONEDAS[moneda] ?? MONEDAS.PEN).simbolo} ${fmtNumero(n)}`;
}
/** "S/ 5,000.00 (CINCO MIL SOLES CON 00/100)" */
export function montoTexto(n, moneda = 'PEN') {
  const m = MONEDAS[moneda] ?? MONEDAS.PEN;
  const total = Math.round(Number(n ?? 0) * 100);
  const ent = Math.floor(total / 100), cent = total % 100;
  const nombre = ent === 1 ? m.singular : m.plural;
  return `${fmtMonto(n, moneda)} (${numALetras(ent)} ${nombre} CON ${String(cent).padStart(2, '0')}/100)`;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function partesFecha(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}
/** "22 de agosto del 2026" */
export function fechaLarga(iso) {
  const p = partesFecha(iso);
  return p ? `${p.d} de ${MESES[p.m - 1]} del ${p.y}` : '…………………';
}
/** Meses completos entre dos fechas ISO (redondeando días sueltos). */
export function mesesEntre(isoIni, isoFin) {
  const a = partesFecha(isoIni), b = partesFecha(isoFin);
  if (!a || !b) return null;
  let meses = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d - a.d >= 15) meses += 1;
  else if (b.d - a.d <= -15) meses -= 1;
  return Math.max(meses, 1);
}
export function duracionTexto(isoIni, isoFin) {
  const n = mesesEntre(isoIni, isoFin);
  if (!n) return null;
  if (n % 12 === 0) {
    const a = n / 12;
    return `${numALetras(a)} (${a}) ${a === 1 ? 'AÑO' : 'AÑOS'}`;
  }
  return `${numALetras(n)} (${n}) ${n === 1 ? 'MES' : 'MESES'}`;
}
const ROMANOS = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function romano(n) {
  let r = '';
  for (const [v, s] of ROMANOS) while (n >= v) { r += s; n -= v; }
  return r;
}

/* ================================ HELPERS ==================================== */
const PUNTOS = '…………………';
const val = (x, ph = PUNTOS) => (x !== null && x !== undefined && String(x).trim() !== '' ? String(x).trim() : ph);
const esFem = (trat = '') => /^(doña|la sra|sra|señora|la señora|la srta)/i.test(trat.trim());
const o_a = (trat) => (esFem(trat) ? 'a' : 'o');
const B = (x) => `**${x}**`;

/** Divide "texto **negrita** texto" en runs y resalta EL PROPIETARIO / EL INQUILINO. */
export function parseMd(texto) {
  const runs = [];
  const partes = String(texto ?? '').split('**');
  partes.forEach((seg, i) => {
    if (!seg) return;
    const negrita = i % 2 === 1;
    if (negrita) { runs.push({ t: seg, b: true }); return; }
    const re = /(EL PROPIETARIO|EL INQUILINO)/g;
    let last = 0, m;
    while ((m = re.exec(seg)) !== null) {
      if (m.index > last) runs.push({ t: seg.slice(last, m.index), b: false });
      runs.push({ t: m[0], b: true });
      last = m.index + m[0].length;
    }
    if (last < seg.length) runs.push({ t: seg.slice(last), b: false });
  });
  return runs;
}

function nombreServicio(nombre = '') {
  const n = nombre.toLowerCase();
  if (n === 'luz') return 'luz eléctrica';
  return n;
}
function listaY(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}
function listaO(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} o ${items[items.length - 1]}`;
}

/* ============================= CONSTRUCTOR DEL CONTRATO ====================== */
/**
 * @param {object} d datos normalizados (ver contrato-ui.js → datosPorDefecto)
 * @returns {{ blocks: object[], faltantes: string[] }}
 */
export function construirContrato(d) {
  const mon = d.moneda ?? 'PEN';
  const monedaTxt = mon === 'USD' ? 'dólares americanos' : 'moneda nacional (soles)';
  const faltantes = [];
  const need = (valor, etiqueta) => { if (valor === null || valor === undefined || String(valor).trim() === '') faltantes.push(etiqueta); };

  need(d.prop?.nombre, 'Propietario: nombre'); need(d.prop?.doc, 'Propietario: documento');
  need(d.inq?.nombre, 'Inquilino: nombre'); need(d.inq?.doc, 'Inquilino: documento');
  if (d.inq?.juridica) { need(d.inq?.repNombre, 'Inquilino: representante legal'); need(d.inq?.partida, 'Inquilino: partida electrónica'); }
  if (d.aval?.tiene) { need(d.aval?.nombre, 'Aval: nombre'); need(d.aval?.doc, 'Aval: documento'); }
  need(d.inmueble?.direccion, 'Inmueble: dirección'); need(d.fechaInicio, 'Fecha de inicio');
  if (!(d.renta > 0)) faltantes.push('Renta mensual');

  const f1 = fechaLarga(d.fechaInicio), f2 = d.fechaFin ? fechaLarga(d.fechaFin) : null;
  const fp = partesFecha(d.fechaFirma) ?? partesFecha(d.fechaInicio);
  const mesFirma = fp ? MESES[fp.m - 1] : '………';
  const anioFirma = fp ? fp.y : '……';
  const diaFirma = partesFecha(d.fechaFirma)?.d ?? '…….';
  const uso = d.uso === 'vivienda' ? 'vivienda' : 'comercial';
  const tieneGarantia = Number(d.garantia?.monto) > 0;
  const abonos = (d.garantia?.abonos ?? []).filter((a) => Number(a.monto) > 0);
  const servicios = (d.servicios ?? []).filter((s) => s.incluir !== false && s.nombre);
  const llaves = (d.llaves?.items ?? []).filter((l) => (l.desc ?? '').trim());
  const conAval = !!d.aval?.tiene;

  /* ---- Definición de cláusulas (orden = numeración romana correlativa) ---- */
  // Cada cláusula: { key, seccion, titulo?, incluir, build: (n) => bloques[] }
  const claus = [];
  const add = (c) => claus.push({ incluir: true, ...c });

  add({
    key: 'antecedentes', titulo: 'ANTECEDENTES',
    build: () => {
      const out = [{ k: 'clause', md: B('EL PROPIETARIO es titular del siguiente inmueble:') }];
      out.push({
        k: 'sub',
        md: `${B('EL INMUEBLE:')} Ubicado en ${val(d.inmueble?.direccion)}${d.inmueble?.partida ? `, con número de partida registral N°${d.inmueble.partida} en ${d.inmueble.oficinaRegistral || 'Lima'}` : ''}${(d.inmueble?.lineas ?? []).length ? ', el cual comprende:' : '.'}`,
      });
      (d.inmueble?.lineas ?? []).forEach((l) => out.push({ k: 'bullet', level: 0, marker: '•', md: l }));
      const area = Number(d.inmueble?.areaTotal);
      if (area > 0) {
        out.push({ k: 'sub', md: `${B(`ÁREA TOTAL A ALQUILAR: ${fmtArea(area)} m²`)} (${numALetras(Math.round(area)).toLowerCase()} metros cuadrados).` });
      }
      if (d.renovacion?.es) {
        out.push({
          k: 'sub',
          md: `El presente contrato constituye la ${B('renovación')} del contrato de arrendamiento suscrito anteriormente${d.renovacion.fechaAnterior ? ` con fecha ${fechaLarga(d.renovacion.fechaAnterior)}` : ''}, y reemplaza en su integridad las condiciones pactadas en aquel.`,
        });
      }
      return out;
    },
  });

  add({
    key: 'objeto', titulo: 'OBJETO DEL CONTRATO',
    build: () => [{
      k: 'clause',
      md: 'Por el presente contrato de arrendamiento, EL PROPIETARIO otorga en arrendamiento a EL INQUILINO el inmueble descrito en la cláusula precedente. Por su parte, EL INQUILINO se obliga a pagar a EL PROPIETARIO el monto de la renta pactada, los servicios básicos y las demás obligaciones, incluido el mantenimiento del inmueble y sus áreas comunes, establecidas en este contrato en la forma y fechas establecidas.',
    }],
  });

  const dur = duracionTexto(d.fechaInicio, d.fechaFin);
  add({
    key: 'plazo', titulo: 'PLAZO DEL CONTRATO',
    build: () => {
      const auto = d.renovacionAuto
        ? ', renovable automáticamente siempre y cuando se hayan cumplido todas las cláusulas de este contrato desde el primer día de arriendo'
        : ', no renovable automáticamente; cualquier renovación deberá pactarse por escrito antes del vencimiento';
      const vigencia = f2
        ? `El período de vigencia inicia el ${B(f1)} y finaliza el ${B(f2)}, fecha en la que EL INQUILINO está obligado a devolver el bien arrendado.`
        : `El período de vigencia inicia el ${B(f1)} y se mantiene hasta que cualquiera de las partes lo resuelva conforme a lo pactado.`;
      return [{
        k: 'clause',
        md: `Las partes convienen en fijar como plazo de duración del presente contrato ${dur ? `el período de ${B(dur)}${auto}` : 'un período a determinar'}. ${vigencia} Para la renovación, si la renta no está pactada explícitamente en este contrato, será pactada previo al vencimiento de este contrato debiendo ser como mínimo un aumento del ${B(`+${d.aumentoPct ?? 10}%`)} de la mensualidad vigente.`,
      }];
    },
  });
  add({
    key: 'penalidad', titulo: null,
    build: () => {
      const out = [{
        k: 'clause',
        md: `En el caso de no renovarse el contrato y EL INQUILINO no devolviese EL INMUEBLE dentro del plazo fijado, deberá pagar a EL PROPIETARIO una penalidad equivalente al monto del alquiler mensual dividido entre 30 días más un ${B('50%')} adicional, es decir ${B(montoTexto(d.penalidadDiaria, mon))} por cada día de permanencia adicional, más el monto del alquiler mensual que corresponda por los días transcurridos, sin perjuicio de las acciones legales de desalojo que pueda ejercer EL PROPIETARIO y la ejecución automática de la garantía otorgada, sin afectación a las medidas y cargos adicionales por deterioro y desgaste del inmueble.`,
      }];
      if (tieneGarantia) {
        out.push({
          k: 'sub',
          md: `De igual forma, EL PROPIETARIO deberá devolver la suma recibida en garantía al finalizar el plazo del contrato, previa deducción correspondiente bajo inventario y revisión de la situación física de EL INMUEBLE y de todos los muebles que se hayan entregado junto con el arrendamiento. De incumplir EL INQUILINO con el plazo del contrato establecido, se abstiene de reclamar el derecho de su garantía, la cual será ejecutada como lucro cesante en favor del propietario. En consecuencia, si se encontrase algún daño material en puertas, paredes, instalaciones u otros elementos del inmueble, estos serán cobrados automáticamente a EL INQUILINO${conAval ? `, así como al ${B('AVAL')},` : ','} sin lugar a reclamo.`,
        });
      }
      return out;
    },
  });

  add({
    key: 'renta', titulo: 'RENTA MENSUAL, GARANTIA Y ABONOS',
    build: () => {
      const out = [{
        k: 'clause',
        md: `Las partes acuerdan que el monto de la renta mensual que pagará EL INQUILINO en calidad de contraprestación por el arrendamiento del bien será de ${B(montoTexto(d.renta, mon))} ${f2 ? `por el periodo comprendido entre el ${B(f1)} y el ${B(f2)}` : `a partir del ${B(f1)}`}, pagaderos mensualmente por adelantado.`,
      }];
      if (servicios.length) {
        out.push({ k: 'sub', md: `La suma convenida no incluye los servicios básicos (${listaY(servicios.map((s) => nombreServicio(s.nombre)))}) que son de cuenta de EL INQUILINO.` });
      }
      if (tieneGarantia) {
        const modalidad = d.garantia?.modalidad?.trim() ? ` bajo modalidad ${d.garantia.modalidad.trim()}` : '';
        out.push({
          k: 'sub',
          md: `La garantía acordada${modalidad} asciende a ${B(montoTexto(d.garantia.monto, mon))}${abonos.length ? ' de los cuales EL INQUILINO realizó los siguientes abonos:' : ', la cual será entregada por EL INQUILINO a la firma del presente contrato.'}`,
        });
        abonos.forEach((a) => out.push({ k: 'bullet', level: 0, marker: '-', md: `${B(montoTexto(a.monto, mon))}${a.recibo ? ` según Recibo N° ${a.recibo}` : ''}` }));
        if (abonos.length) {
          const suma = abonos.reduce((s, a) => s + Number(a.monto), 0);
          const saldo = Math.round((Number(d.garantia.monto) - suma) * 100) / 100;
          out.push({
            k: 'sub',
            md: Math.abs(saldo) < 0.005
              ? `Completando así el total de ${B(montoTexto(suma, mon))} que conforman la garantía total del presente contrato de arrendamiento.`
              : (saldo > 0
                ? `Quedando un saldo de ${B(montoTexto(saldo, mon))} pendiente de abono para completar la garantía total del presente contrato de arrendamiento.`
                : `Los abonos suman ${B(montoTexto(suma, mon))}.`),
          });
        }
      }
      return out;
    },
  });

  add({
    key: 'pago', titulo: 'FORMA Y OPORTUNIDAD DE PAGO DE LA RENTA',
    build: () => [{
      k: 'clause',
      md: `La forma de pago de la renta será en ${monedaTxt}. EL INQUILINO pagará desde el día de toma del inmueble y el pago será por adelantado, en efectivo o mediante depósito a la cuenta ${d.banco || 'bancaria'} que se le proporcionará, previa coordinación. EL INQUILINO se obliga a pagar puntualmente y antes que se cumpla la fecha de vencimiento de la mensualidad en cada respectivo mes, el monto de la renta en la forma, oportunidad y lugar pactados, con sujeción a lo suscrito en el presente contrato.`,
    }],
  });

  add({
    key: 'resolutoria', titulo: 'CLÁUSULA RESOLUTORIA EXPRESA',
    build: () => {
      const out = [{ k: 'clause', md: 'Si EL INQUILINO incumpliera alguna de las siguientes condiciones, el presente contrato se resolverá de pleno derecho:' }];
      const items = [
        'Realizar cambios y/o mejoras dentro del inmueble sin autorización previa y por escrito de EL PROPIETARIO. De ser estas mejoras consideradas positivamente por EL PROPIETARIO, quedarán a favor de este, sin lugar a reclamo ni reembolso por parte de EL INQUILINO, de modo automático.',
        `El incumplimiento de un (1) mes de la mensualidad en la fecha correspondiente${tieneGarantia ? ', por lo cual se ejecutará la garantía como lucro cesante, así como se ejecutarán las demás cláusulas que resguarden el buen mantenimiento de la propiedad' : ''}.`,
        'El incumplimiento de las normas legales presentes y futuras de nuestra nación, así como el incumplimiento de las normas de convivencia vigentes pactadas con los inquilinos aledaños de ser el caso.',
        'El incumplimiento de las normas y políticas de orden y limpieza de las áreas comunes y de la fachada del inmueble.',
      ];
      if (servicios.length) items.push(`El incumplimiento o pago atrasado de los recibos de ${listaY(servicios.map((s) => nombreServicio(s.nombre)))} y otros servicios básicos.`);
      items.push(uso === 'comercial'
        ? 'Utilizar el inmueble para fines distintos al uso acordado, sea el comercial o doméstico, especialmente para vivienda o habitación, lo cual está expresamente prohibido.'
        : 'Utilizar el inmueble para fines distintos al uso acordado (vivienda), especialmente para actividades comerciales, industriales o de almacenamiento, lo cual está expresamente prohibido.');
      items.forEach((t) => out.push({ k: 'bullet', level: 0, marker: '•', md: t }));
      return out;
    },
  });

  add({
    key: 'servicios', titulo: 'PAGO DE SERVICIOS', incluir: servicios.length > 0,
    build: () => {
      const out = [{ k: 'clause', md: 'EL INQUILINO se compromete a pagar puntualmente los siguientes servicios:' }];
      servicios.forEach((s) => {
        const nom = nombreServicio(s.nombre);
        if (s.modo === 'fijo') {
          out.push({
            k: 'bullet', level: 0, marker: '•',
            md: `Servicio de ${nom}: El importe será de ${B(montoTexto(s.monto, mon))} mensuales, monto fijo determinado por la cantidad de personas que utilizarán el inmueble el cual puede variar previa coordinación de ambas partes.`,
          });
        } else {
          out.push({
            k: 'bullet', level: 0, marker: '•',
            md: `Servicio de ${nom}: El importe será calculado mensualmente según consumo con la lectura del medidor interno, la cual EL INQUILINO puede corroborar en cualquier momento.`,
          });
        }
      });
      out.push({
        k: 'sub',
        md: `En caso de que EL INQUILINO no notifique a EL PROPIETARIO sobre algún incumplimiento en el pago de servicios, o deje de pagar al menos un (1) mes de ${listaO(servicios.map((s) => nombreServicio(s.nombre)))}, dicho gasto será subsanado con la garantía sin lugar a reclamo.`,
      });
      out.push({
        k: 'sub',
        md: 'Asimismo, EL PROPIETARIO se obliga a entregar el bien materia del presente contrato con todos los servicios públicos al día; en caso contrario, se obliga al saneamiento de ley correspondiente.',
      });
      return out;
    },
  });

  add({
    key: 'uso', titulo: 'USO, MANTENIMIENTO Y DESTINO DEL BIEN',
    build: () => [{
      k: 'clause',
      md: `EL INQUILINO se obliga a destinar el bien arrendado única y exclusivamente para ${B(uso === 'comercial' ? 'USO COMERCIAL' : 'USO DE VIVIENDA')}. Queda expresamente ${B('PROHIBIDO')} ${uso === 'comercial' ? 'el uso del inmueble como vivienda o para fines habitacionales' : 'el uso del inmueble para actividades comerciales, industriales o de almacenamiento'}. EL INQUILINO otorga a EL PROPIETARIO el permiso de visitar el inmueble previo aviso con al menos 48 horas de anticipación, con el fin de verificar lo estipulado en el presente contrato. En caso de negarse a la inspección o incumplir con lo establecido, será motivo de resolución automática del contrato con acción inmediata${tieneGarantia ? ', absteniéndose EL INQUILINO de reclamar el derecho de su garantía, la cual quedará como lucro cesante' : ''}.`,
    }],
  });
  add({
    key: 'orden', titulo: null,
    build: () => [{
      k: 'clause',
      md: `EL INQUILINO se obliga a mantener el orden y la limpieza de las áreas comunes, así como escaleras, depósitos de almacén, balcones, ventanas u otros de ser el caso y de la fachada de la puerta de la calle en todo momento${tieneGarantia ? ' bajo pena de ser descontado de su garantía' : ''}.`,
    }],
  });

  add({
    key: 'licencia', titulo: 'LICENCIA DE FUNCIONAMIENTO Y RESPONSABILIDADES DEL INQUILINO', incluir: uso === 'comercial',
    build: () => [{
      k: 'clause',
      md: 'EL INQUILINO se obliga a tramitar y obtener su propia licencia de funcionamiento ante la municipalidad correspondiente para el desarrollo de sus actividades comerciales o de negocio en el inmueble arrendado. EL INQUILINO asume la responsabilidad integral del trámite, gestión y renovación de dicha licencia de funcionamiento. Asimismo, EL INQUILINO será el único responsable del pago de cualquier multa, sanción o infracción impuesta por la municipalidad, organismos reguladores o autoridades competentes relacionadas con el incumplimiento de normas municipales, infracciones tributarias, de higiene, seguridad, o cualquier otra disposición legal aplicable al uso del INMUEBLE. En caso de que EL PROPIETARIO fuera notificado o sancionado por incumplimientos atribuibles a EL INQUILINO, EL INQUILINO se compromete a reembolsar al propietario la totalidad de los gastos, multas y costos derivados de tales infracciones, sin derecho a reclamo alguno.',
    }],
  });

  add({
    key: 'allanamiento', titulo: 'CLÁUSULA DE ALLANAMIENTO FUTURO',
    build: () => [{
      k: 'clause',
      md: `De conformidad con el Artículo ${B('5°')} de la Ley N° ${B('30201')}, que modifica el Artículo ${B('594°')} del Código Procesal Civil, EL INQUILINO se allana desde ya a la demanda judicial para desocupar el inmueble por las causales de vencimiento del contrato, incumplimiento del pago de la renta o incumplimiento de alguna de las cláusulas establecidas en este documento, de acuerdo con lo establecido en el Artículo ${B('330°')} y siguientes del Código Procesal Civil.`,
    }],
  });
  add({
    key: 'supletoria', titulo: 'APLICACIÓN SUPLETORIA DE LA LEY',
    build: () => [{ k: 'clause', md: 'En lo no previsto por las partes en el presente contrato, este queda sometido a las normas del Código Civil y demás disposiciones legales que resulten pertinentes.' }],
  });
  add({
    key: 'financiamiento', titulo: 'PROHIBICIÓN DE USO DEL CONTRATO PARA FINANCIAMIENTO',
    build: () => [
      { k: 'clause', md: 'EL INQUILINO no podrá utilizar el presente contrato como garantía, respaldo, título o documento para solicitar préstamos, créditos, financiamientos o cualquier operación crediticia ante bancos, financieras, cooperativas, empresas o terceros.' },
      { k: 'sub', md: 'Asimismo, no podrá constituir sobre EL INMUEBLE ni sobre sus derechos derivados de este contrato ningún gravamen, garantía, cesión, subarrendamiento o derecho a favor de terceros sin autorización previa y escrita de EL PROPIETARIO.' },
      { k: 'sub', md: 'El incumplimiento de esta cláusula será causal de resolución inmediata del contrato, sin perjuicio de las responsabilidades y daños que correspondan.' },
    ],
  });
  add({
    key: 'desalojo', titulo: 'DESALOJO Y RESTITUCIÓN DEL INMUEBLE',
    build: () => [
      { k: 'clause', md: 'EL INQUILINO acepta que el vencimiento del contrato, la falta de pago de la renta o el incumplimiento de las obligaciones establecidas serán causales para exigir la inmediata restitución del INMUEBLE.' },
      { k: 'sub', md: 'EL INQUILINO se allana anticipadamente al desalojo en los casos permitidos por la legislación vigente y acepta que EL PROPIETARIO pueda utilizar los procedimientos legales de desalojo que correspondan, incluyendo los mecanismos especiales aplicables.' },
      { k: 'sub', md: 'Una vez terminado o resuelto el contrato, EL INQUILINO deberá entregar inmediatamente EL INMUEBLE libre de personas y bienes y devolver todas las llaves.' },
      { k: 'sub', md: 'La permanencia posterior al vencimiento o resolución no significará renovación ni prórroga del contrato.' },
    ],
  });
  add({
    key: 'subarriendo', titulo: 'PROHIBICIÓN DE SUBARRENDAMIENTO Y CESIÓN',
    build: () => [
      { k: 'clause', md: 'EL INQUILINO no podrá subarrendar, ceder, transferir, prestar ni permitir que terceros ocupen o utilicen total o parcialmente EL INMUEBLE sin autorización previa y escrita de EL PROPIETARIO.' },
      { k: 'sub', md: 'El incumplimiento será causal de resolución del contrato y restitución del INMUEBLE, sin perjuicio del pago de daños, perjuicios y demás obligaciones que correspondan.' },
    ],
  });
  add({
    key: 'competencia', titulo: 'COMPETENCIA TERRITORIAL',
    build: () => [{
      k: 'clause',
      md: `Para efectos de cualquier controversia que se genere con motivo de la celebración y ejecución de este contrato, las partes se someten a la competencia territorial de los jueces y tribunales de la ciudad de ${d.ciudad || 'Lima'}.`,
    }],
  });
  add({
    key: 'domicilio', titulo: 'DOMICILIO Y CONTACTO',
    build: () => {
      const vias = [];
      if (d.contacto?.whatsapp) vias.push(`por WhatsApp al ${d.contacto.whatsapp}`);
      if (d.contacto?.email) vias.push(`correo electrónico ${d.contacto.email}`);
      return [{
        k: 'clause',
        md: `Para la validez de todas las comunicaciones y notificaciones de las partes con motivo de la ejecución de este contrato, ambas señalan como sus respectivos domicilios los indicados en la introducción de este documento${vias.length ? `, así como las vías electrónicas ${vias.join(' y ')}` : ''}. El cambio de domicilio de cualquiera de las partes surtirá efectos desde la fecha de comunicación de dicho cambio a la otra parte, por medio escrito.`,
      }];
    },
  });
  add({
    key: 'aval', titulo: 'AVAL Y GARANTÍA', incluir: conAval,
    build: () => [{
      k: 'clause',
      md: `La garante y aval del inmueble es ${B(val(d.aval?.nombre).toUpperCase())} identificad${o_a(d.aval?.tratamiento)} con ${B(d.aval?.docTipo || 'DNI')} N° ${B(val(d.aval?.doc))} quien se hace responsable solidaria e ilimitadamente por cualquier incumplimiento de las cláusulas mencionadas en este contrato, asumiendo todas las obligaciones con el simple requerimiento verbal, escrito o electrónico (llamada, mensaje, email) por parte de EL PROPIETARIO, para lo cual tendrá un plazo máximo de 24 horas en resolver cualquier requerimiento dinerario o no dinerario.`,
    }],
  });
  add({
    key: 'llaves', titulo: 'ENTREGA DE LOCAL Y LLAVES', incluir: llaves.length > 0,
    build: () => {
      const cants = [...new Set(llaves.map((l) => Number(l.cant) || 1))];
      const uniforme = cants.length === 1;
      const c = cants[0];
      const out = [{
        k: 'clause',
        md: uniforme
          ? `A la fecha de firma de contrato se realizó la entrega de ${c} ${c === 1 ? 'copia' : 'copias'} de cada llave de las siguientes puertas:`
          : 'A la fecha de firma de contrato se realizó la entrega de las llaves de las siguientes puertas:',
      }];
      llaves.forEach((l) => out.push({
        k: 'bullet', level: 1, marker: 'o',
        md: `${l.desc.trim()}${uniforme ? '' : ` (${Number(l.cant) || 1} ${(Number(l.cant) || 1) === 1 ? 'copia' : 'copias'})`}`,
      }));
      out.push({
        k: 'sub',
        md: `EL INQUILINO se hace responsable de sacar las copias necesarias para su uso y de la seguridad del local que esto conlleve con responsabilidad. En el caso que EL INQUILINO pierda la llave y necesite una copia, la reposición costará ${B(montoTexto(d.llaves?.costoReposicion ?? 6, mon))}.`,
      });
      return out;
    },
  });
  add({
    key: 'comprobantes', titulo: 'COMPROBANTES DE PAGO',
    build: (n) => [{
      k: 'clause',
      md: `De los montos mencionados en las cláusulas ${n.renta}${servicios.length ? `, ${n.servicios}` : ''} y demás aplicables, de requerir EL INQUILINO factura u otro comprobante de pago fiscal, se le sumará el impuesto vigente correspondiente según la normativa tributaria aplicable; caso contrario, se emitirá un recibo como constancia de pago.`,
    }],
  });
  add({
    key: 'rescision', titulo: 'CLÁUSULA DE RESCISIÓN DE CONTRATO',
    build: (n) => {
      const out = [{ k: 'clause', md: 'Será causal de rescisión de contrato y se podrá invocar esta cláusula y las precedentes necesarias en caso de que se presente cualquiera de las siguientes situaciones:' }];
      const items = [
        `Incumplimiento de un (1) mes como mínimo de la mensualidad pactada en las cláusulas ${n.renta}, ${n.resolutoria} y precedentes${servicios.length ? `, o el equivalente a dos (2) recibos de ${listaO(servicios.map((s) => nombreServicio(s.nombre)))} respectivos` : ''}.`,
        'Incumplimiento de las normas y políticas en orden, limpieza y otras que fueron indicadas previo a la firma del contrato.',
        'Por cualquier daño ocasionado al inmueble o a los muebles, construcciones u objetos entregados de cualquier tipo que formen parte de la propiedad en alquiler.',
        uso === 'comercial'
          ? 'Utilizar el inmueble para fines de vivienda o habitación, en contravención al uso comercial exclusivo acordado.'
          : 'Utilizar el inmueble para fines comerciales, industriales o de almacenamiento, en contravención al uso de vivienda exclusivo acordado.',
        'Por la eventualidad de compraventa del terreno en el que se incluya el inmueble en cuestión, la prioridad de opción de compraventa la mantiene EL INQUILINO con una oferta en firme y efectivo en el acto de ser notificado.',
      ];
      items.forEach((t) => out.push({ k: 'bullet', level: 0, marker: '•', md: t }));
      return out;
    },
  });

  /* ---- Numeración correlativa + referencias cruzadas ---- */
  const activas = claus.filter((c) => c.incluir);
  const n = {};
  activas.forEach((c, i) => { n[c.key] = romano(i + 1); });

  /* ------------------------------ Encabezado ------------------------------- */
  const blocks = [];
  blocks.push({ k: 'title', text: d.renovacion?.es ? 'CONTRATO DE ARRENDAMIENTO (RENOVACIÓN)' : 'CONTRATO DE ARRENDAMIENTO' });

  const propTxt = `${d.prop?.tratamiento || 'don'} ${B(val(d.prop?.nombre).toUpperCase())}, identificad${o_a(d.prop?.tratamiento)} con ${B(d.prop?.docTipo || 'DNI')} N° ${B(val(d.prop?.doc))}, con domicilio ubicado en ${val(d.prop?.domicilio)}`;
  let inqTxt;
  if (d.inq?.juridica) {
    inqTxt = `la empresa ${B(val(d.inq?.nombre).toUpperCase())}, debidamente representada por su ${d.inq?.repCargo || 'Gerente General'} ${d.inq?.repTratamiento || 'el Sr.'} ${val(d.inq?.repNombre)}, y con número de contribuyente N° ${B(val(d.inq?.doc))}${d.inq?.partida ? `, inscrita con partida electrónica N° ${d.inq.partida} de los registros públicos de ${d.inq.oficinaRegistral || 'Lima'}` : ''} con domicilio en ${val(d.inq?.domicilio)}`;
  } else {
    inqTxt = `${d.inq?.tratamiento || 'don'} ${B(val(d.inq?.nombre).toUpperCase())}, identificad${o_a(d.inq?.tratamiento)} con ${B(d.inq?.docTipo || 'DNI')} N° ${B(val(d.inq?.doc))}, con domicilio ubicado en ${val(d.inq?.domicilio)}`;
  }
  const avalTxt = conAval
    ? `; y de la otra parte, en calidad de ${B('AVAL')}, ${d.aval?.tratamiento || 'la señora'}: ${B(val(d.aval?.nombre).toUpperCase())}, identificad${o_a(d.aval?.tratamiento)} con ${B(d.aval?.docTipo || 'DNI')} N°${val(d.aval?.doc)}`
    : '';
  blocks.push({
    k: 'para',
    md: `En la ciudad de ${d.ciudad || 'Lima'}, a los ${diaFirma} días del mes de ${mesFirma} de ${anioFirma}, se reúnen ${propTxt}; a quien en adelante se le llamará ${B('EL PROPIETARIO')}; y de la otra parte ${inqTxt}; a quien en adelante se le denominará ${B('EL INQUILINO')}${avalTxt} quienes se presentan y suscriben este contrato bajo los términos y condiciones siguientes:`,
  });

  /* ------------------------------- Cláusulas ------------------------------- */
  activas.forEach((c) => {
    if (c.titulo) blocks.push({ k: 'heading', text: c.titulo });
    const bl = c.build(n);
    let primero = true;
    bl.forEach((b) => {
      if (b.k === 'clause') { blocks.push({ ...b, num: `${n[c.key]}.` }); primero = false; } else blocks.push(b);
    });
    if (primero) { /* sin cláusula numerada: nada */ }
  });

  /* --------------------------------- Cierre -------------------------------- */
  blocks.push({
    k: 'para', gapBefore: true,
    md: `En señal de conformidad, las partes firman el presente documento en la ciudad de ${d.ciudad || 'Lima'}, a los ${partesFecha(d.fechaFirma)?.d ?? '……'} días del mes de ${mesFirma} de ${anioFirma}.`,
  });
  const firmaInq = d.inq?.juridica
    ? [val(d.inq.nombre).toUpperCase().replace(/S\.A\.C\./i, 'SAC'), `RUC N° ${val(d.inq.doc)}`, 'EL INQUILINO']
    : [val(d.inq?.nombre).toUpperCase(), `${d.inq?.docTipo || 'DNI'} N° ${val(d.inq?.doc)}`, 'EL INQUILINO'];
  blocks.push({
    k: 'sign',
    filas: [
      [
        { lines: [val(d.prop?.nombre).toUpperCase(), 'EL PROPIETARIO'] },
        { lines: firmaInq },
      ],
      ...(conAval ? [[{ lines: [val(d.aval?.nombre).toUpperCase(), 'AVAL'] }, null]] : []),
    ],
  });

  /* --------------------------------- Anexos -------------------------------- */
  const an = d.anexos ?? {};
  if (an.dni || an.recibos || an.fotos) {
    blocks.push({ k: 'pagebreak' });
    if (an.dni) blocks.push({ k: 'annex', text: 'ANEXOS DE DNIs:' });
    if (an.recibos) blocks.push({ k: 'annex', text: 'ANEXOS RECIBOS DE ABONOS DE INGRESO:' });
    if (an.fotos) {
      blocks.push({ k: 'annex', text: 'ANEXOS FOTOS DE LOCAL (ENTREGA DEL INMUEBLE):' });
      blocks.push({ k: 'photos' }); // el exportador inserta las fotos que reciba
    }
  }

  return { blocks, faltantes, numeracion: n };
}

function fmtArea(a) {
  return Number.isInteger(a) ? String(a) : a.toFixed(2);
}
