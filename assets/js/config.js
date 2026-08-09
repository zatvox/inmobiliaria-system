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
 * AUTH_ENABLED = true → hay login real (Supabase Auth), y por lo tanto RLS
 * funciona con auth.uid() normalmente — NO hace falta correr
 * assets/sql/dev-open-access.sql (ese archivo era solo para el modo
 * desarrollo sin login, ya no se usa mientras esto esté en `true`).
 *
 * El login es "solo con correo": no se pide contraseña ni código. El
 * usuario escribe su email en pages/login.html, recibe un correo con un
 * enlace ("magic link"), y al hacer clic entra directo al sistema — ver
 * requestMagicLink() en auth.js. Cuando en el futuro se quiera agregar
 * contraseña, se puede volver a usar signIn().
 */
export const AUTH_ENABLED = true;

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
