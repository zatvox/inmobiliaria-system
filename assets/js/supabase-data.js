/**
 * supabase-data.js — Capa de datos (Fase 1: Propiedades, Secciones, Personas,
 * Catálogos, Storage, KPIs de dashboard). Cada función retorna los datos o
 * lanza el error de Supabase para que la UI lo capture y muestre un toast.
 */
import { supabase } from './supabase-client.js';
import { STORAGE_BUCKET } from './config.js';

/* ============================== CATÁLOGOS ================================ */
export async function getCatalogo(tipo) {
  const { data, error } = await supabase
    .from('catalogos')
    .select('id, valor, orden')
    .eq('tipo', tipo)
    .eq('activo', true)
    .order('orden', { ascending: true });
  if (error) throw error;
  return data;
}

/* ============================= PROPIEDADES ================================ */
export async function listPropiedades({ search = '' } = {}) {
  let query = supabase
    .from('propiedades')
    .select('id, nombre_referencial, tipo, direccion, distrito, n_pisos, notas, propietario_id, personas:propietario_id(nombre), secciones(id, estado)')
    .order('created_at', { ascending: false });

  if (search) {
    query = query.or(`nombre_referencial.ilike.%${search}%,direccion.ilike.%${search}%,distrito.ilike.%${search}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getPropiedad(id) {
  const { data, error } = await supabase
    .from('propiedades')
    .select(`
      *,
      propietario:propietario_id ( id, nombre, dni_ruc, telefono ),
      propiedades_fotos ( id, url_storage, descripcion, orden ),
      propiedades_documentos ( id, tipo, url_storage, descripcion ),
      secciones ( id, nombre, tipo_seccion, area_m2, habitaciones, banos, cocheras, estado,
                  precio_venta, precio_alquiler_referencial, tiene_medidor_propio_luz,
                  tiene_medidor_propio_agua, orden, notas )
    `)
    .eq('id', id)
    .single();
  if (error) throw error;
  data.secciones = (data.secciones ?? []).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  return data;
}

export async function createPropiedad(payload) {
  const { data, error } = await supabase.from('propiedades').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updatePropiedad(id, payload) {
  const { data, error } = await supabase.from('propiedades').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deletePropiedad(id) {
  const { error } = await supabase.from('propiedades').delete().eq('id', id);
  if (error) throw error;
}

export async function addPropiedadFoto(propiedadId, urlStorage, descripcion = '') {
  const { data, error } = await supabase
    .from('propiedades_fotos')
    .insert({ propiedad_id: propiedadId, url_storage: urlStorage, descripcion })
    .select().single();
  if (error) throw error;
  return data;
}

export async function removePropiedadFoto(fotoId) {
  const { error } = await supabase.from('propiedades_fotos').delete().eq('id', fotoId);
  if (error) throw error;
}

/* =============================== SECCIONES ================================ */
export async function createSeccion(payload) {
  const { data, error } = await supabase.from('secciones').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateSeccion(id, payload) {
  const { data, error } = await supabase.from('secciones').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteSeccion(id) {
  const { error } = await supabase.from('secciones').delete().eq('id', id);
  if (error) throw error;
}

/* ================================ PERSONAS ================================= */
export async function listPersonas({ search = '', rol = '' } = {}) {
  let query = supabase
    .from('personas')
    .select('id, nombre, tipo_documento, dni_ruc, telefono, email, notas, personas_roles(rol)')
    .order('nombre', { ascending: true });

  if (search) {
    query = query.or(`nombre.ilike.%${search}%,dni_ruc.ilike.%${search}%,email.ilike.%${search}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  const filtered = rol ? data.filter((p) => p.personas_roles?.some((r) => r.rol === rol)) : data;
  return filtered;
}

export async function getPersona(id) {
  const { data, error } = await supabase
    .from('personas')
    .select('*, personas_roles(rol)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function createPersona(payload, roles = []) {
  const { data, error } = await supabase.from('personas').insert(payload).select().single();
  if (error) throw error;
  if (roles.length) {
    const rows = roles.map((rol) => ({ persona_id: data.id, rol }));
    const { error: rolesError } = await supabase.from('personas_roles').insert(rows);
    if (rolesError) throw rolesError;
  }
  return data;
}

export async function updatePersona(id, payload, roles = []) {
  const { data, error } = await supabase.from('personas').update(payload).eq('id', id).select().single();
  if (error) throw error;

  const { error: delError } = await supabase.from('personas_roles').delete().eq('persona_id', id);
  if (delError) throw delError;
  if (roles.length) {
    const rows = roles.map((rol) => ({ persona_id: id, rol }));
    const { error: insError } = await supabase.from('personas_roles').insert(rows);
    if (insError) throw insError;
  }
  return data;
}

export async function deletePersona(id) {
  const { error } = await supabase.from('personas').delete().eq('id', id);
  if (error) throw error;
}

/* ================================ STORAGE =================================== */
/**
 * Sube un archivo al bucket configurado bajo una carpeta lógica
 * (ej. `propiedades/{propiedad_id}`) y devuelve la ruta guardada en BD.
 * El bucket es privado: para mostrar la imagen usa getSignedUrl().
 */
export async function uploadArchivo(file, folder) {
  const ext = file.name.split('.').pop();
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

export async function getSignedUrl(path, expiresInSeconds = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeArchivo(path) {
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([path]);
  if (error) throw error;
}

/* ============================ DASHBOARD / KPIs ============================== */
export async function getDashboardKpis() {
  const [propiedades, secciones, personas, contratos] = await Promise.all([
    supabase.from('propiedades').select('id', { count: 'exact', head: true }),
    supabase.from('secciones').select('id, estado'),
    supabase.from('personas').select('id', { count: 'exact', head: true }),
    supabase.from('contratos_alquiler').select('id, estado'),
  ]);
  if (propiedades.error) throw propiedades.error;
  if (secciones.error) throw secciones.error;
  if (personas.error) throw personas.error;
  if (contratos.error) throw contratos.error;

  const seccionesPorEstado = (secciones.data ?? []).reduce((acc, s) => {
    acc[s.estado] = (acc[s.estado] ?? 0) + 1;
    return acc;
  }, {});
  const contratosVigentes = (contratos.data ?? []).filter((c) => c.estado === 'vigente').length;
  const contratosPorVencer = (contratos.data ?? []).filter((c) => c.estado === 'por_vencer').length;

  return {
    totalPropiedades: propiedades.count ?? 0,
    totalSecciones: (secciones.data ?? []).length,
    seccionesPorEstado,
    totalPersonas: personas.count ?? 0,
    contratosVigentes,
    contratosPorVencer,
  };
}
