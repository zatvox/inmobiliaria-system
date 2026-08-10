/**
 * config.js — Configuración de conexión a Supabase.
 *
 * IMPORTANTE: la anon key es segura para exponer en un sitio estático
 * (GitHub Pages) SIEMPRE que la Row Level Security (RLS) esté activa en
 * todas las tablas — ver assets/sql/rls-policies.sql. Nunca pegues aquí la
 * service_role key.
 *
 * Reemplaza estos dos valores con los de tu proyecto Supabase
 * (Project Settings -> API) antes de desplegar. Ver SETUP.md.
 */
export const SUPABASE_URL = 'https://lepzvqrtkoichsxyjtse.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxlcHp2cXJ0a29pY2hzeHlqdHNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MjcwMTEsImV4cCI6MjA5ODEwMzAxMX0.rHBoVArG6smT2x8YW5C3oG19w_t7F6gEXKsOkILaSik';

/**
 * AUTH_ENABLED = false → SIN LOGIN por ahora (decisión de Luis: sistema de
 * uso interno/personal, con su hermano, mientras se termina de construir).
 * Todas las páginas entran directo como administrador, sin pantalla de
 * login. pages/login.html redirige solo a index.html si alguien la abre.
 *
 * Para que esto funcione con datos reales hace falta correr UNA VEZ
 * assets/sql/dev-open-access.sql en Supabase — abre las políticas RLS al
 * rol "anon" (sin eso, como no hay sesión real, ninguna tabla protegida
 * devuelve datos). Ver la advertencia de seguridad dentro de ese archivo:
 * cualquiera con la URL puede leer y escribir todo mientras esto esté así.
 *
 * Cuando se quiera volver a activar un login real (correo+contraseña,
 * `signIn()` ya está listo en auth.js), poner esto en `true` y correr la
 * reversión que trae dev-open-access.sql al final del archivo.
 */
export const AUTH_ENABLED = false;

/**
 * SITE_URL ya NO hace falta configurarlo a mano: pages/login.html calcula
 * automáticamente a dónde debe volver el enlace de acceso (a index.html,
 * en el mismo dominio/carpeta desde donde se abrió el login) — funciona
 * igual en localhost que en GitHub Pages sin tocar este archivo.
 *
 * Lo único que SÍ hay que configurar en Supabase (Authentication → URL
 * Configuration → Redirect URLs) es agregar la URL de cada lugar desde
 * donde vayas a entrar, por ejemplo:
 *   http://localhost:8080/index.html
 *   https://tu-usuario.github.io/inmobiliaria-system/index.html
 * o, más simple, un comodín que cubra todo el sitio publicado:
 *   https://tu-usuario.github.io/inmobiliaria-system/**
 * Sin esto en la lista, Supabase rechaza el enlace aunque el código esté
 * bien. Ver SETUP.md paso 7.
 */

/** Nombre del bucket de Supabase Storage usado por todo el sistema. */
export const STORAGE_BUCKET = 'inmuebles';

/** Nombre visible del sistema (usado en el sidebar, título de pestaña, etc.) */
export const APP_NAME = 'Gestión Inmobiliaria';
