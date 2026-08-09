/**
 * main.js — Lógica global compartida por el "shell" de la aplicación
 * (sidebar + topbar), presente en todas las páginas protegidas.
 * Cada página llama a initShell('clave-de-pagina') al cargar.
 */
import { requireAuth, signOut, isAdmin } from './auth.js';
import { qs, qsa, initModalDismiss } from './utils.js';

export async function initShell(activePageKey) {
  const profile = await requireAuth();
  if (!profile) return null; // requireAuth ya redirigió a login

  // Marcar el link activo del sidebar
  qsa('.nav-link[data-page]').forEach((link) => {
    link.classList.toggle('active', link.dataset.page === activePageKey);
  });

  // Ocultar/objetar acciones exclusivas de administrador si el rol es operador
  if (!isAdmin(profile)) {
    qsa('[data-admin-only]').forEach((node) => node.remove());
  }

  // Chip de usuario en el topbar
  const nameEl = qs('#user-name');
  const roleEl = qs('#user-role');
  const avatarEl = qs('#user-avatar');
  const initials = (profile.nombre_visible || profile.user.email || '?').trim().charAt(0).toUpperCase();
  if (nameEl) nameEl.textContent = profile.nombre_visible || profile.user.email;
  if (roleEl) roleEl.textContent = profile.rol === 'administrador' ? 'Administrador' : (profile.rol === 'operador' ? 'Operador' : 'Sin rol asignado');
  if (avatarEl) avatarEl.textContent = initials;

  if (!profile.rol) {
    const warn = document.createElement('div');
    warn.className = 'toast warning';
    warn.style.position = 'fixed';
    warn.style.top = '12px';
    warn.style.left = '50%';
    warn.style.transform = 'translateX(-50%)';
    warn.style.zIndex = '300';
    warn.textContent = 'Tu usuario no tiene un rol asignado todavía — pide a Luis que te agregue en usuarios_roles.';
    document.body.append(warn);
  }

  // Modo desarrollo (AUTH_ENABLED = false en config.js): sin login real,
  // se oculta "Salir" y se avisa que el acceso a datos está abierto.
  const logoutBtn = qs('#logout-btn');
  if (profile.devMode) {
    logoutBtn?.remove();
    if (!sessionStorage.getItem('dev-mode-warned')) {
      const warn = document.createElement('div');
      warn.className = 'toast warning';
      warn.style.position = 'fixed';
      warn.style.top = '12px';
      warn.style.left = '50%';
      warn.style.transform = 'translateX(-50%)';
      warn.style.zIndex = '300';
      warn.textContent = 'Modo desarrollo: login desactivado, acceso abierto a todos los datos. No compartas esta URL públicamente.';
      document.body.append(warn);
      sessionStorage.setItem('dev-mode-warned', '1');
    }
  } else {
    // Logout (solo aplica con auth real activada)
    logoutBtn?.addEventListener('click', async () => {
      await signOut();
    });
  }

  // Sidebar responsive (drawer en móvil)
  const sidebar = qs('.sidebar');
  const backdrop = qs('.sidebar-backdrop');
  const toggle = qs('.sidebar-toggle');
  const openSidebar = () => { sidebar?.classList.add('open'); backdrop?.classList.add('open'); };
  const closeSidebar = () => { sidebar?.classList.remove('open'); backdrop?.classList.remove('open'); };
  toggle?.addEventListener('click', () => {
    sidebar?.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  backdrop?.addEventListener('click', closeSidebar);

  initModalDismiss();

  return profile;
}
