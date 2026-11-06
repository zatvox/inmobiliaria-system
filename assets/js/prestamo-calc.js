/**
 * prestamo-calc.js — Cronograma de un préstamo con intereses (módulo PURO).
 * Modelo de la oficina: TODAS las cuotas iguales, con capital e interés iguales:
 *   capital por cuota = monto / n
 *   interés por cuota = monto × tasa mensual (interés simple sobre el monto original)
 *   cuota = capital + interés  ·  el saldo capital baja linealmente hasta 0.
 * Tasa anual → mensual: TEA / 12 (nominal simple). Tasa mensual: tal cual.
 * Los centavos de redondeo se absorben en la ÚLTIMA cuota para que el saldo cierre en 0.
 */
const r2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

export function tasaMensual(valor, tipo) {
  const v = Number(valor) || 0;
  return tipo === 'anual' ? v / 12 : v;
}

/** Suma n meses a una fecha ISO conservando el día (o el último día del mes). */
export function sumarMeses(iso, n, dia = null) {
  const [y, m, d0] = iso.slice(0, 10).split('-').map(Number);
  const d = dia ?? d0;
  const total = (m - 1) + n;
  const yy = y + Math.floor(total / 12), mm = ((total % 12) + 12) % 12;
  const ultimo = new Date(yy, mm + 1, 0).getDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

/** @returns {Array<{nro, fecha_pago, cuota, capital, interes, saldo_capital}>} */
export function calcularCronograma({ monto, nCuotas, tasaValor, tasaTipo, fechaPrimeraCuota, dia = null }) {
  const m = Number(monto), n = Math.floor(Number(nCuotas));
  if (!(m > 0) || !(n >= 1) || !fechaPrimeraCuota) return [];
  const tm = tasaMensual(tasaValor, tasaTipo) / 100;
  const capBase = r2(m / n);
  const interes = r2(m * tm);
  const diaPago = dia ?? Number(fechaPrimeraCuota.slice(8, 10));
  const filas = [];
  let saldo = m;
  for (let i = 1; i <= n; i += 1) {
    const capital = i === n ? r2(saldo) : capBase;
    saldo = r2(saldo - capital);
    filas.push({
      nro: i,
      fecha_pago: sumarMeses(fechaPrimeraCuota, i - 1, diaPago),
      cuota: r2(capital + interes), capital, interes, saldo_capital: saldo,
    });
  }
  return filas;
}

/** Recalcula cuota y saldo a partir de capital/interés (tras editar celdas a mano). */
export function recalcularFilas(filas, monto) {
  let saldo = Number(monto) || 0;
  return filas.map((f) => {
    const capital = r2(f.capital), interes = r2(f.interes);
    saldo = r2(saldo - capital);
    return { ...f, capital, interes, cuota: r2(capital + interes), saldo_capital: saldo };
  });
}

export function totalesCronograma(filas) {
  const sum = (k) => r2(filas.reduce((s, f) => s + Number(f[k] || 0), 0));
  return { cuota: sum('cuota'), capital: sum('capital'), interes: sum('interes') };
}
