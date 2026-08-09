/**
 * supabase-client.js — Inicialización única (singleton) del cliente Supabase.
 * Toda la capa de datos (supabase-data.js) y auth.js importan desde aquí,
 * nunca crean su propia instancia.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'inmobiliaria-system-auth',
    // El enlace de acceso por correo (magic link) llega con la sesión en la
    // URL (#access_token=...) — esto le dice al cliente que la lea y guarde
    // la sesión automáticamente al cargar la página, sin que el usuario
    // tenga que hacer nada más.
    detectSessionInUrl: true,
  },
});
