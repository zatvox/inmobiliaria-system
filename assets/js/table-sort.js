/**
 * table-sort.js — Ordenamiento global asc/desc al hacer clic en el encabezado
 * de cualquier tabla del sistema (incluidas las que se renderizan después).
 * Detecta números, importes ("S/ 1,370.05"), fechas (DD/MM/AAAA, ISO y
 * "10 set. 2026") y texto. Vacíos ("—") siempre al final. El orden se
 * conserva cuando la tabla se vuelve a pintar (filtros, refrescos).
 * Exclusiones: <table data-no-sort>, <th data-no-sort>, tablas con más de una
 * fila de encabezado o con celdas combinadas (matrices/cuadros).
 */
const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, set: 9, sep: 9, oct: 10, nov: 11, dic: 12 };

function cellText(td) {
  if (!td) return '';
  if (td.dataset.sort !== undefined) return td.dataset.sort;
  const input = td.querySelector('input:not([type=checkbox]):not([type=file]), select');
  if (input) return input.value ?? '';
  return td.textContent.replace(/\s+/g, ' ').trim();
}

function parse(raw) {
  const t = raw.trim();
  if (!t || /^[—–-]+$/.test(t)) return null;
  let m;
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return { n: +m[3] * 10000 + +m[2] * 100 + +m[1], t };
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return { n: +m[1] * 10000 + +m[2] * 100 + +m[3], t };
  if ((m = t.match(/^(\d{1,2})\s+([a-záéíóú]{3})[a-z.]*\s+(\d{4})$/i)) && MESES[m[2].toLowerCase()]) return { n: +m[3] * 10000 + MESES[m[2].toLowerCase()] * 100 + +m[1], t };
  if ((m = t.match(/^(\d{1,2})\/(\d{4})$/))) return { n: +m[2] * 10000 + +m[1] * 100, t };
  const num = t.replace(/^(S\/|\$|US\$)\s*/i, '').replace(/\s*%$/, '').replace(/,/g, '');
  if (/^-?\d+(\.\d+)?$/.test(num)) return { n: parseFloat(num), t };
  return { s: t.toLowerCase(), t };
}

function comparar(a, b) {
  if (a.n !== undefined && b.n !== undefined) return a.n - b.n;
  return a.t.localeCompare(b.t, 'es', { numeric: true, sensitivity: 'base' });
}

function esOrdenable(table) {
  if (table.hasAttribute('data-no-sort')) return false;
  const thead = table.tHead;
  if (!thead || thead.rows.length !== 1) return false;
  return thead.rows[0].cells.length > 0;
}

function aplicar(table) {
  const st = table._sort;
  if (!st) return;
  const tbody = table.tBodies[0];
  if (!tbody) return;
  const filas = [...tbody.rows];
  // Filas de relleno (estado vacío / skeleton / celdas combinadas): no se ordenan.
  if (!filas.length || filas.some((r) => [...r.cells].some((c) => c.colSpan > 1))) return;
  const idx = st.col;
  const claves = new Map(filas.map((r) => [r, parse(cellText(r.cells[idx]))]));
  const dir = st.dir === 'asc' ? 1 : -1;
  const orden = [...filas].sort((ra, rb) => {
    const a = claves.get(ra), b = claves.get(rb);
    if (!a && !b) return 0;
    if (!a) return 1;   // vacíos al final siempre
    if (!b) return -1;
    return comparar(a, b) * dir;
  });
  if (orden.every((r, i) => r === filas[i])) return;
  st.aplicando = true;
  orden.forEach((r) => tbody.append(r));
  st.aplicando = false;
}

function pintarEncabezados(table) {
  [...table.tHead.rows[0].cells].forEach((th, i) => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (table._sort && table._sort.col === i) th.classList.add(table._sort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

function iniciar(table) {
  if (table._sortInit || !esOrdenable(table)) return;
  table._sortInit = true;
  const ths = [...table.tHead.rows[0].cells];
  ths.forEach((th, i) => {
    if (th.hasAttribute('data-no-sort') || th.querySelector('input, button, select') || !th.textContent.trim()) return;
    th.classList.add('sortable');
    th.title = th.title || 'Clic para ordenar';
    th.addEventListener('click', () => {
      const prev = table._sort;
      table._sort = { col: i, dir: prev && prev.col === i && prev.dir === 'asc' ? 'desc' : 'asc' };
      pintarEncabezados(table);
      aplicar(table);
    });
  });
  // Mantener el orden cuando la tabla se vuelve a renderizar.
  const tbody = table.tBodies[0];
  if (tbody) {
    new MutationObserver(() => {
      if (table._sort && !table._sort.aplicando) { table._sort.aplicando = true; aplicar(table); if (table._sort) table._sort.aplicando = false; }
    }).observe(tbody, { childList: true });
  }
}

function escanear(root = document) {
  root.querySelectorAll?.('table').forEach(iniciar);
}

function arrancar() {
  escanear();
  let pendiente = false;
  new MutationObserver(() => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => { pendiente = false; escanear(); });
  }).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
else arrancar();
