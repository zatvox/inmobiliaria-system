/**
 * utils.js — Funciones auxiliares compartidas por todas las páginas.
 */

export function qs(selector, scope = document) {
  return scope.querySelector(selector);
}
export function qsa(selector, scope = document) {
  return Array.from(scope.querySelectorAll(selector));
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function formatCurrency(amount, currency = 'PEN') {
  const value = Number(amount ?? 0);
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency }).format(value);
}

export function formatDate(value, opts = {}) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric', ...opts }).format(date);
}

export function formatNumber(value, decimals = 2) {
  return new Intl.NumberFormat('es-PE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(value ?? 0));
}

export function debounce(fn, wait = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function slugify(text) {
  return String(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/* --------------------------------- Toasts -------------------------------- */
function ensureToastContainer() {
  let container = qs('#toast-container');
  if (!container) {
    container = el('div', { id: 'toast-container', role: 'status', 'aria-live': 'polite' });
    document.body.append(container);
  }
  return container;
}

export function showToast(message, type = 'info', duration = 4000) {
  const container = ensureToastContainer();
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  const toast = el('div', { class: `toast ${type}` }, [`${icons[type] ?? ''}  ${message}`]);
  container.append(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 200ms ease';
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

/* --------------------------------- Modales -------------------------------- */
// Guarda una "foto" del estado de cada formulario al abrir su modal, para
// poder detectar si el usuario hizo cambios antes de cerrar sin guardar.
const modalSnapshots = new WeakMap();

function serializeForm(form) {
  return qsa('input, select, textarea', form).map((field) => {
    if (field.type === 'file') return field.files?.length ? Array.from(field.files).map((f) => `${f.name}:${f.size}`).join(',') : '';
    if (field.type === 'checkbox' || field.type === 'radio') return field.checked ? '1' : '0';
    return field.value ?? '';
  }).join('§');
}

function snapshotModal(overlay) {
  const form = overlay.querySelector('form');
  if (form) modalSnapshots.set(overlay, serializeForm(form));
  else modalSnapshots.delete(overlay);
}

function modalHasUnsavedChanges(overlay) {
  const form = overlay.querySelector('form');
  if (!form || !modalSnapshots.has(overlay)) return false;
  return serializeForm(form) !== modalSnapshots.get(overlay);
}

export function openModal(modalId) {
  const overlay = qs(`#${modalId}`);
  if (overlay) {
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    snapshotModal(overlay);
    const firstInput = overlay.querySelector('input, select, textarea, button');
    firstInput?.focus();
  }
}
// skipConfirm: true cuando el cierre es programático (ej. justo después de
// guardar con éxito) — ahí no tiene sentido preguntar por cambios sin guardar.
export function closeModal(modalId, { skipConfirm = true } = {}) {
  const overlay = qs(`#${modalId}`);
  if (overlay) {
    if (!skipConfirm && modalHasUnsavedChanges(overlay)) {
      if (!confirmAction('Tienes cambios sin guardar. ¿Seguro que quieres cerrar sin guardar?')) return false;
    }
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    modalSnapshots.delete(overlay);
  }
  return true;
}
export function initModalDismiss() {
  qsa('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (evt) => {
      if (evt.target === overlay) closeModal(overlay.id, { skipConfirm: false });
    });
    overlay.querySelectorAll('[data-modal-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(overlay.id, { skipConfirm: false }));
    });
  });
  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') {
      const open = qsa('.modal-overlay.open').pop();
      if (open) closeModal(open.id, { skipConfirm: false });
    }
  });
}

/* ------------------------------ Confirmación ------------------------------ */
export function confirmAction(message) {
  return window.confirm(message);
}

/* ------------------------------ Validación --------------------------------- */
export function validateForm(formEl) {
  let valid = true;
  qsa('[required]', formEl).forEach((field) => {
    const wrapper = field.closest('.form-field') || field.parentElement;
    const isEmpty = !String(field.value ?? '').trim();
    if (isEmpty) {
      valid = false;
      wrapper?.classList.add('invalid');
    } else {
      wrapper?.classList.remove('invalid');
    }
  });
  return valid;
}

/* ------------------------------ Estado de carga ---------------------------- */
export function setLoading(button, isLoading, labelWhileLoading = 'Guardando…') {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalLabel = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span> ${labelWhileLoading}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalLabel) button.innerHTML = button.dataset.originalLabel;
  }
}

/* ------------------------------ Etiquetas de estado ------------------------ */
export const ESTADO_LABELS = {
  disponible: 'Disponible', en_venta: 'En venta', en_alquiler: 'En alquiler',
  vendido: 'Vendido', alquilado: 'Alquilado', reservado: 'Reservado', inactivo: 'Inactivo',
  vigente: 'Vigente', por_vencer: 'Por vencer', vencido: 'Vencido', renovado: 'Renovado', finalizado: 'Finalizado',
  pendiente: 'Pendiente', pagada: 'Pagada', parcial: 'Parcial', vencida: 'Vencida', anulada: 'Anulada', anulado: 'Anulado',
  registrado: 'Registrado', verificado: 'Verificado',
  reportado: 'Reportado', en_proceso: 'En proceso', resuelto: 'Resuelto',
  prospecto: 'Prospecto', visita_agendada: 'Visita agendada', negociacion: 'Negociación',
  separacion: 'Separación', firma_contrato: 'Firma de contrato', cerrado: 'Cerrado', perdido: 'Perdido',
};
export function badgeHtml(estado) {
  const label = ESTADO_LABELS[estado] ?? estado ?? '—';
  return `<span class="badge badge-${estado}">${label}</span>`;
}
