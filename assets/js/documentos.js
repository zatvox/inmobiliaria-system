/**
 * documentos.js — Módulo Documentos (Fase 4): explorador de todo lo
 * subido al bucket de Storage, agrupado por carpeta/categoría, con
 * filtros. No usa tablas propias — lee directo del bucket y resuelve
 * nombres amigables (propiedad, sección) cuando puede.
 */
import { initShell } from './main.js';
import { listAllArchivos, getSignedUrl, listPropiedades, listMedidores } from './supabase-data.js';
import { qs, qsa, el, formatDate, showToast, debounce } from './utils.js';

const CATEGORIA_LABELS = {
  propiedades: 'Fotos de inmuebles',
  secciones: 'Fotos de secciones',
  medidores: 'Medidores / lecturas',
  recibos: 'Recibos generales de servicios',
  pagos: 'Vouchers de pago',
  mantenimientos: 'Comprobantes de mantenimiento',
  tributos: 'Tributos municipales',
};

let archivosCache = [];
let referenciasCache = {};

async function main() {
  const profile = await initShell('documentos');
  if (!profile) return;

  bindToolbar();
  await cargarReferencias();
  await cargar();
}

async function cargarReferencias() {
  // Resuelve el nombre amigable de la propiedad cuando la carpeta es
  // "propiedades/{propiedad_id}" — es la categoría con más volumen. El
  // resto de categorías muestran el id de la entidad (acortado) porque
  // resolverlas todas implicaría muchas consultas adicionales.
  try {
    const [propiedades, medidores] = await Promise.all([listPropiedades(), listMedidores({})]);
    referenciasCache = {
      propiedades: Object.fromEntries(propiedades.map((p) => [p.id, p.nombre_referencial])),
      medidores: Object.fromEntries(medidores.map((m) => [m.id, `${m.propiedad?.nombre_referencial ?? ''} ${m.seccion?.nombre ? '· ' + m.seccion.nombre : '(general)'}`])),
    };
  } catch (err) {
    console.error(err);
    referenciasCache = {};
  }
}

function bindToolbar() {
  qs('#filter-categoria')?.addEventListener('change', render);
  qs('#search-input')?.addEventListener('input', debounce(render, 300));
  qs('#btn-recargar')?.addEventListener('click', cargar);
}

async function cargar() {
  const tbody = qs('#documentos-tbody');
  tbody.innerHTML = '<tr><td colspan="5"><div class="skeleton" style="height:20px;"></div></td></tr>';
  try {
    archivosCache = await listAllArchivos();
    fillCategoriaFilter();
    render();
  } catch (err) {
    console.error(err);
    showToast('No se pudo leer el bucket de Storage.', 'error');
    tbody.innerHTML = '';
  }
}

function fillCategoriaFilter() {
  const select = qs('#filter-categoria');
  const categoriasPresentes = [...new Set(archivosCache.map((a) => a.categoria))].sort();
  select.innerHTML = '<option value="">Todas las categorías</option>';
  categoriasPresentes.forEach((c) => select.append(el('option', { value: c }, CATEGORIA_LABELS[c] ?? c)));
}

function referenciaLegible(archivo) {
  const mapa = referenciasCache[archivo.categoria];
  if (mapa && mapa[archivo.entidadId]) return mapa[archivo.entidadId];
  return `#${archivo.entidadId.slice(0, 8)}`;
}

function render() {
  const tbody = qs('#documentos-tbody');
  const categoria = qs('#filter-categoria').value;
  const search = (qs('#search-input').value || '').toLowerCase();

  let filtrados = archivosCache;
  if (categoria) filtrados = filtrados.filter((a) => a.categoria === categoria);
  if (search) {
    filtrados = filtrados.filter((a) =>
      a.nombre.toLowerCase().includes(search) || referenciaLegible(a).toLowerCase().includes(search));
  }

  tbody.innerHTML = '';
  qs('#documentos-total').textContent = `${filtrados.length} archivo${filtrados.length === 1 ? '' : 's'}`;

  if (!filtrados.length) {
    tbody.append(el('tr', {}, [el('td', { colspan: '5' }, [
      el('div', { class: 'empty-state' }, [el('div', { class: 'icon' }, '📁'), el('p', {}, 'No hay documentos que coincidan con el filtro.')]),
    ])]));
    return;
  }

  filtrados
    .sort((a, b) => (b.actualizado ?? '').localeCompare(a.actualizado ?? ''))
    .forEach((a) => tbody.append(renderRow(a)));
}

function renderRow(a) {
  return el('tr', {}, [
    el('td', {}, el('span', { class: 'badge badge-neutral' }, CATEGORIA_LABELS[a.categoria] ?? a.categoria)),
    el('td', {}, referenciaLegible(a)),
    el('td', {}, a.nombre),
    el('td', {}, a.actualizado ? formatDate(a.actualizado) : '—'),
    el('td', { class: 'actions' }, [
      el('button', { class: 'btn btn-tertiary btn-sm', onclick: async (evt) => {
        try {
          const url = await getSignedUrl(a.path);
          window.open(url, '_blank');
        } catch (err) {
          console.error(err);
          showToast('No se pudo abrir el archivo.', 'error');
        }
      } }, 'Ver / descargar'),
    ]),
  ]);
}

main();
