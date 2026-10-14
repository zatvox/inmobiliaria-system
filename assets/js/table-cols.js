/**
 * table-cols.js — Estándar de tablas: menú ⋮ (esquina superior derecha) para
 * mostrar/ocultar columnas en TODAS las tablas `.data-table` del sistema,
 * incluidas las que se dibujan después. La preferencia se recuerda por
 * página + tabla (localStorage). Se oculta por CSS (nth-child), así sobrevive
 * a los re-renders de filas. Las tablas de Reportes (.reporte-imprimible, con
 * filas de celdas combinadas) se resuelven celda por celda para respetar los
 * colspan. Exclusiones: <table data-no-cols>, tablas con más de una fila de
 * encabezado, la matriz de lecturas (.grid-excel) y el Estado de cuenta (que
 * ya trae su propio menú ⋮).
 */
const hidden = new Map(); // tid -> Set(índices ocultos)
const tablasJs = new Map(); // tid -> table (modo celda por celda)
let contador = 0;
let menuAbierto = null;

function estilo() {
  let st = document.getElementById('tcols-style');
  if (!st) { st = document.createElement('style'); st.id = 'tcols-style'; document.head.append(st); }
  return st;
}
function aplicarEstilos() {
  const reglas = [];
  hidden.forEach((set, tid) => set.forEach((i) => {
    if (tablasJs.has(tid)) return;
    reglas.push(`table[data-tid="${tid}"] tr > :nth-child(${i + 1}):not([colspan]){display:none}`);
  }));
  estilo().textContent = reglas.join('\n');
  tablasJs.forEach((table, tid) => aplicarJs(table, hidden.get(tid)));
}

// Oculta columnas respetando colspan: cada celda cubre un rango de columnas
// lógicas; se oculta si todas están ocultas, o se reduce su colspan.
function aplicarJs(table, ocultas) {
  [...table.rows].forEach((tr) => {
    let pos = 0;
    [...tr.cells].forEach((c) => {
      if (!c.dataset.cs0) c.dataset.cs0 = String(c.colSpan || 1);
      const span = Number(c.dataset.cs0);
      let vis = 0;
      for (let k = 0; k < span; k += 1) if (!ocultas.has(pos + k)) vis += 1;
      c.style.display = vis === 0 ? 'none' : '';
      if (vis > 0) c.colSpan = vis;
      pos += span;
    });
  });
}

const nombreCol = (th) => th.textContent.replace(/\s+/g, ' ').trim();
const elegible = (t) => t.classList.contains('data-table') && !t.hasAttribute('data-no-cols')
  && !t.classList.contains('grid-excel') && !t.closest('.reporte-imprimible')?.querySelector('.cols-menu')
  && t.tHead && t.tHead.rows.length === 1 && t.tHead.rows[0].cells.length > 1;

function claveTabla(t) {
  const ths = [...t.tHead.rows[0].cells].map(nombreCol).join('|');
  let h = 0; for (const ch of ths) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const anc = t.id || t.closest('[id]')?.id || '';
  return `tcols:${location.pathname}:${anc}:${h}`;
}
const leer = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const guardar = (k, arr) => { try { localStorage.setItem(k, JSON.stringify(arr)); } catch { /* sin storage */ } };

function cerrarMenu() { menuAbierto?.remove(); menuAbierto = null; }

function abrirMenu(btn, table, key) {
  cerrarMenu();
  const tid = table.dataset.tid;
  const ocultas = hidden.get(tid);
  const ths = [...table.tHead.rows[0].cells];
  const menu = document.createElement('div');
  menu.className = 'tcm-menu';
  menu.addEventListener('click', (e) => e.stopPropagation());
  menu.innerHTML = '<div class="tcm-title">Columnas</div>';
  const lista = document.createElement('div');
  lista.className = 'tcm-list';
  const checks = [];
  ths.forEach((th, i) => {
    const nombre = nombreCol(th);
    if (!nombre) return; // columna de acciones: siempre visible
    const lbl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !ocultas.has(i);
    cb.addEventListener('change', () => {
      if (!cb.checked) {
        const visibles = checks.filter((c) => c.cb.checked).length;
        if (visibles < 1) { cb.checked = true; return; } // al menos una visible
        ocultas.add(i);
      } else ocultas.delete(i);
      guardar(key, [...ocultas]);
      aplicarEstilos();
      btn.classList.toggle('activo', ocultas.size > 0);
    });
    checks.push({ cb, i });
    lbl.append(cb, document.createTextNode(' ' + nombre));
    lista.append(lbl);
  });
  menu.append(lista);
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'tcm-reset';
  reset.textContent = 'Mostrar todas';
  reset.addEventListener('click', () => {
    ocultas.clear(); guardar(key, []); aplicarEstilos();
    checks.forEach((c) => { c.cb.checked = true; });
    btn.classList.remove('activo');
  });
  menu.append(reset);
  document.body.append(menu);
  const r = btn.getBoundingClientRect();
  menu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
  menuAbierto = menu;
}

function iniciar(table) {
  if (table._colsInit || !elegible(table)) return;
  table._colsInit = true;
  const key = claveTabla(table);
  const tid = `t${++contador}`;
  table.dataset.tid = tid;
  hidden.set(tid, new Set(leer(key).filter((i) => Number.isInteger(i))));
  if (table.closest('.reporte-imprimible')) tablasJs.set(tid, table);

  // Envoltorio relativo para fijar el botón en la esquina superior derecha.
  const objetivo = table.closest('.table-wrap, .cm-tabla') || table;
  if (!objetivo.parentElement?.classList.contains('tcm-shell')) {
    const shell = document.createElement('div');
    shell.className = 'tcm-shell';
    objetivo.parentElement.insertBefore(shell, objetivo);
    shell.append(objetivo);
  }
  const shell = objetivo.parentElement;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tcm-btn';
  btn.title = 'Mostrar / ocultar columnas';
  btn.textContent = '⋮';
  btn.setAttribute('data-html2canvas-ignore', 'true');
  btn.classList.toggle('activo', hidden.get(tid).size > 0);
  btn.addEventListener('click', (e) => { e.stopPropagation(); if (menuAbierto) cerrarMenu(); else abrirMenu(btn, table, key); });
  shell.append(btn);
  aplicarEstilos();
}

function escanear() { document.querySelectorAll('table.data-table').forEach(iniciar); }

function arrancar() {
  escanear();
  let pend = false;
  new MutationObserver(() => {
    if (pend) return;
    pend = true;
    requestAnimationFrame(() => { pend = false; escanear(); });
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', cerrarMenu);
  window.addEventListener('scroll', cerrarMenu, true);
  window.addEventListener('resize', cerrarMenu);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
else arrancar();
