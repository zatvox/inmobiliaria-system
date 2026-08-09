/**
 * auth.js — Gestión de autenticación y de rol del usuario (usuarios_roles).
 * Toda página protegida debe llamar a requireAuth() antes de pintar datos.
 */
import { supabase } from './supabase-client.js';
import { AUTH_ENABLED } from './config.js';

let cachedProfile = null; // { user, rol, nombre_visible }

/** Perfil sintético usado mientras AUTH_ENABLED = false (modo desarrollo). */
const DEV_PROFILE = {
  user: { id: null, email: 'modo-desarrollo@local' },
  rol: 'administrador',
  nombre_visible: 'Modo desarrollo (sin login)',
  devMode: true,
};

/** Login con contraseña — no se usa por ahora (login es solo con correo), se deja disponible por si se reactiva más adelante. */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  cachedProfile = null;
  return data;
}

/**
 * Login sin contraseña: envía un correo con un enlace ("magic link"). Al
 * hacer clic, Supabase autentica al usuario y lo redirige de vuelta ya con
 * la sesión activa — no hay código que escribir a mano.
 *
 * `redirectTo` se calcula en pages/login.html a partir de la URL actual
 * (funciona igual en localhost que en GitHub Pages, sin editar config.js),
 * pero esa URL exacta debe estar en la lista blanca de Supabase
 * (Authentication → URL Configuration → Redirect URLs) — si no está ahí,
 * Supabase rechaza el enlace sin avisar claramente por qué. Ver SETUP.md.
 *
 * `shouldCreateUser: true` permite que el primer ingreso de un correo nuevo
 * cree automáticamente su usuario en Supabase Auth. El acceso real a los
 * datos lo sigue controlando `usuarios_roles` — sin una fila ahí, el rol
 * queda `null` aunque el login haya funcionado.
 */
export async function requestMagicLink(email, redirectTo) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

/**
 * Si el enlace de acceso falló (link vencido, o la URL no está en la lista
 * blanca de Supabase), Supabase vuelve a traer al usuario con
 * "#error=...&error_description=..." en la URL en vez de una sesión. Esto
 * lee ese mensaje para poder mostrarlo, en vez de fallar en silencio.
 */
export function getUrlAuthError() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  const params = new URLSearchParams(hash);
  const description = params.get('error_description');
  return description ? description.replace(/\+/g, ' ') : null;
}

export async function signOut() {
  if (!AUTH_ENABLED) return; // no hay sesión que cerrar en modo desarrollo
  await supabase.auth.signOut();
  cachedProfile = null;
  window.location.href = resolvePath('pages/login.html');
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Devuelve { user, rol, nombre_visible } del usuario autenticado, consultando
 * usuarios_roles una sola vez por carga de página (cache en memoria).
 * Si el usuario está autenticado pero no tiene fila en usuarios_roles,
 * rol queda en null — la UI debe mostrar "acceso pendiente de asignar".
 */
export async function getProfile() {
  if (!AUTH_ENABLED) return DEV_PROFILE;
  if (cachedProfile) return cachedProfile;
  const session = await getSession();
  if (!session) return null;

  const { data, error } = await supabase
    .from('usuarios_roles')
    .select('rol, nombre_visible')
    .eq('usuario_id', session.user.id)
    .maybeSingle();

  if (error) console.error('Error obteniendo rol de usuario:', error);

  cachedProfile = {
    user: session.user,
    rol: data?.rol ?? null,
    nombre_visible: data?.nombre_visible ?? session.user.email,
  };
  return cachedProfile;
}

export function isAdmin(profile) {
  return profile?.rol === 'administrador';
}

/** Ruta relativa correcta según si la página vive en / o en /pages/. */
function resolvePath(path) {
  const inPagesDir = window.location.pathname.includes('/pages/');
  return inPagesDir ? `../${path.replace(/^pages\//, 'pages/').replace('pages/', '')}` : path;
}

/**
 * Debe llamarse al cargar cualquier página protegida. Redirige a login si
 * no hay sesión. Devuelve el perfil (user + rol) para que la página lo use.
 */
export async function requireAuth() {
  const profile = await getProfile();
  if (!profile) {
    const loginPath = window.location.pathname.includes('/pages/') ? 'login.html' : 'pages/login.html';
    // Si venimos de un enlace de acceso que falló, arrastrar el motivo del
    // error a la pantalla de login para que se muestre ahí en vez de
    // perderse en una redirección silenciosa.
    window.location.href = loginPath + window.location.hash;
    return null;
  }
  return profile;
}

supabase.auth.onAuthStateChange(() => {
  cachedProfile = null;
});
