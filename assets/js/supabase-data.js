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
    .select('id, nombre_referencial, tipo, direccion, distrito, n_pisos, notas, propietario_id, personas:propietario_id(nombre), secciones(id, estado), propiedades_fotos(url_storage, orden)')
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
                  tiene_medidor_propio_agua, partida_registral, codigo_pu_hr, orden, notas )
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

/* =========================== SECCIONES (helpers) ============================ */
export async function listSeccionesDisponibles({ paraVenta = false } = {}) {
  const estados = paraVenta ? ['disponible', 'en_venta'] : ['disponible', 'en_alquiler'];
  const { data, error } = await supabase
    .from('secciones')
    .select('id, nombre, tipo_seccion, estado, precio_venta, precio_alquiler_referencial, propiedad_id, propiedades(nombre_referencial)')
    .in('estado', estados)
    .order('nombre', { ascending: true });
  if (error) throw error;
  return data;
}

export async function listSeccionesPorPropiedad(propiedadId) {
  const { data, error } = await supabase
    .from('secciones')
    .select('id, nombre, tipo_seccion, estado, tiene_medidor_propio_luz, tiene_medidor_propio_agua, partida_registral, codigo_pu_hr')
    .eq('propiedad_id', propiedadId)
    .order('orden', { ascending: true });
  if (error) throw error;
  return data;
}

/* ============================== CONTRATOS =================================== */
export async function listContratosAlquiler({ search = '' } = {}) {
  let query = supabase
    .from('contratos_alquiler')
    .select(`
      id, monto_renta, moneda, dia_vencimiento, fecha_inicio, fecha_fin, estado, deposito_garantia, renovacion_automatica, notas, n_ocupantes,
      seccion:seccion_id ( id, nombre, propiedad_id, propiedades(nombre_referencial, distrito) ),
      inquilino:inquilino_id ( id, nombre, telefono ),
      agente:agente_id ( id, nombre ),
      aval:aval_id ( id, nombre, telefono ),
      servicios_fijos:contratos_alquiler_servicios_fijos ( id, tipo_servicio_id, monto_fijo, notas ),
      secciones_contrato:contratos_alquiler_secciones ( id, seccion_id, monto_renta, fecha_inicio, fecha_fin, es_adenda, numero_adenda, notas, seccion:seccion_id(id, nombre) )
    `)
    .order('fecha_inicio', { ascending: false });
  const { data, error } = await query;
  if (error) throw error;
  if (search) {
    const s = search.toLowerCase();
    return data.filter((c) =>
      c.inquilino?.nombre?.toLowerCase().includes(s) ||
      c.seccion?.nombre?.toLowerCase().includes(s) ||
      c.seccion?.propiedades?.nombre_referencial?.toLowerCase().includes(s));
  }
  return data;
}

export async function getContratoAlquiler(id) {
  const { data, error } = await supabase
    .from('contratos_alquiler')
    .select(`*, seccion:seccion_id(id, nombre, propiedad_id, propiedades(nombre_referencial, distrito)), inquilino:inquilino_id(id, nombre), agente:agente_id(id, nombre), aval:aval_id(id, nombre), servicios_fijos:contratos_alquiler_servicios_fijos(id, tipo_servicio_id, monto_fijo, notas), secciones_contrato:contratos_alquiler_secciones(id, seccion_id, monto_renta, fecha_inicio, fecha_fin, es_adenda, numero_adenda, notas, seccion:seccion_id(id, nombre, propiedad_id, propiedades(nombre_referencial, distrito)))`)
    .eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createContratoAlquiler(payload) {
  const { data, error } = await supabase.from('contratos_alquiler').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateContratoAlquiler(id, payload) {
  const { data, error } = await supabase.from('contratos_alquiler').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

// Secciones que cubre un contrato de alquiler (uno o varias — ej. un
// inquilino que toma 2 pisos, o que amplía después con una "adenda" al
// tomar un piso más). Reemplaza siempre TODA la lista, igual que
// guardarRepartoMedidor/guardarServiciosFijosContrato — el caller
// (contratos.js) ya arma cada fila con su es_adenda/numero_adenda correcto
// antes de llamar, comparando contra lo que había cargado del contrato.
export async function guardarSeccionesContrato(contratoAlquilerId, filas) {
  const { error: delError } = await supabase.from('contratos_alquiler_secciones').delete().eq('contrato_alquiler_id', contratoAlquilerId);
  if (delError) throw delError;
  if (!filas.length) return [];
  const rows = filas.map((f) => ({
    contrato_alquiler_id: contratoAlquilerId,
    seccion_id: f.seccion_id,
    monto_renta: f.monto_renta,
    fecha_inicio: f.fecha_inicio,
    fecha_fin: f.fecha_fin ?? null,
    es_adenda: !!f.es_adenda,
    numero_adenda: f.numero_adenda ?? null,
    notas: f.notas ?? null,
  }));
  const { data, error } = await supabase.from('contratos_alquiler_secciones').insert(rows).select();
  if (error) throw error;
  return data;
}

// Contratos de alquiler VIGENTES/por_vencer que cubren alguna de las
// secciones dadas, con TODAS sus secciones (no solo las que coinciden) y sus
// servicios de monto fijo — para poder prorratear un monto fijo de contrato
// entre todas las secciones que le corresponden (ej. agua fija de un
// contrato que cubre 3 pisos, repartida entre los que no tienen medidor).
export async function listContratosVigentesConServiciosFijos(seccionIds) {
  if (!seccionIds?.length) return [];
  const { data: enlaces, error: e1 } = await supabase
    .from('contratos_alquiler_secciones')
    .select('contrato_alquiler_id, seccion_id, contrato:contrato_alquiler_id!inner(estado)')
    .in('seccion_id', seccionIds)
    .in('contrato.estado', ['vigente', 'por_vencer']);
  if (e1) throw e1;
  const contratoIds = [...new Set((enlaces ?? []).map((e) => e.contrato_alquiler_id))];
  if (!contratoIds.length) return [];

  const [{ data: todasSecciones, error: e2 }, { data: serviciosFijos, error: e3 }] = await Promise.all([
    supabase.from('contratos_alquiler_secciones').select('contrato_alquiler_id, seccion_id').in('contrato_alquiler_id', contratoIds),
    supabase.from('contratos_alquiler_servicios_fijos').select('contrato_alquiler_id, tipo_servicio_id, monto_fijo').in('contrato_alquiler_id', contratoIds),
  ]);
  if (e2) throw e2;
  if (e3) throw e3;

  const porContrato = new Map();
  contratoIds.forEach((id) => porContrato.set(id, { contratoId: id, seccionIds: [], serviciosFijos: new Map() }));
  (todasSecciones ?? []).forEach((r) => porContrato.get(r.contrato_alquiler_id)?.seccionIds.push(r.seccion_id));
  (serviciosFijos ?? []).forEach((sf) => porContrato.get(sf.contrato_alquiler_id)?.serviciosFijos.set(sf.tipo_servicio_id, Number(sf.monto_fijo)));
  return Array.from(porContrato.values());
}

// Montos fijos de servicio por contrato (ej. agua fija S/50/mes para un
// local sin medidor) — reemplaza siempre TODA la lista del contrato, igual
// que guardarRepartoMedidor: más simple que hacer diffs fila por fila.
export async function guardarServiciosFijosContrato(contratoAlquilerId, items) {
  const { error: delError } = await supabase.from('contratos_alquiler_servicios_fijos').delete().eq('contrato_alquiler_id', contratoAlquilerId);
  if (delError) throw delError;
  if (!items.length) return [];
  const rows = items.map((it) => ({ contrato_alquiler_id: contratoAlquilerId, tipo_servicio_id: it.tipo_servicio_id, monto_fijo: it.monto_fijo, notas: it.notas ?? null }));
  const { data, error } = await supabase.from('contratos_alquiler_servicios_fijos').insert(rows).select();
  if (error) throw error;
  return data;
}

export async function listContratosVenta({ search = '' } = {}) {
  const { data, error } = await supabase
    .from('contratos_venta')
    .select(`
      id, precio_pactado, forma_pago, fecha_firma, estado, n_cuotas, notas,
      seccion:seccion_id ( id, nombre, propiedad_id, propiedades(nombre_referencial, distrito) ),
      comprador:comprador_id ( id, nombre, telefono ),
      agente:agente_id ( id, nombre ),
      aval:aval_id ( id, nombre, telefono )
    `)
    .order('fecha_firma', { ascending: false });
  if (error) throw error;
  if (search) {
    const s = search.toLowerCase();
    return data.filter((c) =>
      c.comprador?.nombre?.toLowerCase().includes(s) ||
      c.seccion?.nombre?.toLowerCase().includes(s) ||
      c.seccion?.propiedades?.nombre_referencial?.toLowerCase().includes(s));
  }
  return data;
}

export async function getContratoVenta(id) {
  const { data, error } = await supabase
    .from('contratos_venta')
    .select(`*, seccion:seccion_id(id, nombre, propiedad_id, propiedades(nombre_referencial, distrito)), comprador:comprador_id(id, nombre), agente:agente_id(id, nombre), aval:aval_id(id, nombre)`)
    .eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createContratoVenta(payload) {
  const { data, error } = await supabase.from('contratos_venta').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateContratoVenta(id, payload) {
  const { data, error } = await supabase.from('contratos_venta').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/* ========================== COMISIONES DE AGENTES ============================ */
export async function createComisionAgente(payload) {
  const { data, error } = await supabase.from('comisiones_agentes').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function listComisionesAgentes() {
  const { data, error } = await supabase
    .from('comisiones_agentes')
    .select('id, agente_id, contrato_tipo, contrato_id, monto, porcentaje, estado, fecha_pago, notas, created_at, agente:agente_id(nombre)')
    .order('created_at', { ascending: false });
  if (error) throw error;

  // contrato_id es una FK lógica (apunta a contratos_alquiler o
  // contratos_venta según contrato_tipo, no hay una sola tabla), así que se
  // resuelve el inquilino/comprador y la fecha de inicio con consultas
  // aparte agrupadas por tipo — mismo patrón que ya usa listCuotas().
  const idsAlquiler = data.filter((c) => c.contrato_tipo === 'alquiler').map((c) => c.contrato_id);
  const idsVenta = data.filter((c) => c.contrato_tipo === 'venta').map((c) => c.contrato_id);
  const [alquileres, ventas] = await Promise.all([
    idsAlquiler.length
      ? supabase.from('contratos_alquiler').select('id, fecha_inicio, inquilino:inquilino_id(nombre)').in('id', idsAlquiler)
      : Promise.resolve({ data: [] }),
    idsVenta.length
      ? supabase.from('contratos_venta').select('id, fecha_firma, comprador:comprador_id(nombre)').in('id', idsVenta)
      : Promise.resolve({ data: [] }),
  ]);
  const alquilerPorId = new Map((alquileres.data ?? []).map((c) => [c.id, c]));
  const ventaPorId = new Map((ventas.data ?? []).map((c) => [c.id, c]));

  return data.map((c) => {
    if (c.contrato_tipo === 'alquiler') {
      const contrato = alquilerPorId.get(c.contrato_id);
      return { ...c, clienteNombre: contrato?.inquilino?.nombre ?? null, fechaInicioContrato: contrato?.fecha_inicio ?? null };
    }
    if (c.contrato_tipo === 'venta') {
      const contrato = ventaPorId.get(c.contrato_id);
      return { ...c, clienteNombre: contrato?.comprador?.nombre ?? null, fechaInicioContrato: contrato?.fecha_firma ?? null };
    }
    return { ...c, clienteNombre: null, fechaInicioContrato: null };
  });
}

export async function marcarComisionPagada(id, comprobanteUrl = null) {
  const payload = { estado: 'pagada', fecha_pago: new Date().toISOString().slice(0, 10) };
  if (comprobanteUrl) payload.comprobante_url = comprobanteUrl;
  const { data, error } = await supabase.from('comisiones_agentes').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/* ============================ CUOTAS Y COBRANZAS ============================= */
export async function listCuotas({ origen = '', estado = '', search = '' } = {}) {
  let query = supabase
    .from('cuotas')
    .select(`
      id, origen, contrato_id, calculo_servicio_detalle_id, numero_cuota, concepto, monto, fecha_vencimiento, estado, mora_aplicada, created_at,
      pagos ( id, monto, estado )
    `)
    .order('fecha_vencimiento', { ascending: true });
  if (origen) query = query.eq('origen', origen);
  if (estado) query = query.eq('estado', estado);
  const { data, error } = await query;
  if (error) throw error;

  // Resolver el "deudor" y referencia segun el origen, en llamadas separadas
  // agrupadas (evita N+1 con joins logicos que Supabase no puede hacer directo
  // porque contrato_id apunta a dos tablas distintas segun el origen).
  const idsAlquiler = data.filter((c) => c.origen === 'alquiler' && c.contrato_id).map((c) => c.contrato_id);
  const idsVenta = data.filter((c) => c.origen === 'venta' && c.contrato_id).map((c) => c.contrato_id);
  const idsDetalle = data.filter((c) => c.origen === 'servicio' && c.calculo_servicio_detalle_id).map((c) => c.calculo_servicio_detalle_id);

  const [alquileres, ventas, detalles] = await Promise.all([
    idsAlquiler.length
      ? supabase.from('contratos_alquiler').select('id, inquilino:inquilino_id(nombre), seccion:seccion_id(nombre, propiedades(nombre_referencial))').in('id', idsAlquiler)
      : Promise.resolve({ data: [] }),
    idsVenta.length
      ? supabase.from('contratos_venta').select('id, comprador:comprador_id(nombre), seccion:seccion_id(nombre, propiedades(nombre_referencial))').in('id', idsVenta)
      : Promise.resolve({ data: [] }),
    idsDetalle.length
      ? supabase.from('calculo_servicios_detalle').select('id, seccion:seccion_id(nombre, propiedades(nombre_referencial)), calculo_periodo:calculo_periodo_id(periodo, tipo_servicio:tipo_servicio_id(nombre)), contrato_alquiler:contrato_alquiler_id(inquilino:inquilino_id(nombre))').in('id', idsDetalle)
      : Promise.resolve({ data: [] }),
  ]);

  const mapAlquiler = new Map((alquileres.data ?? []).map((a) => [a.id, a]));
  const mapVenta = new Map((ventas.data ?? []).map((v) => [v.id, v]));
  const mapDetalle = new Map((detalles.data ?? []).map((d) => [d.id, d]));

  const enriched = data.map((c) => {
    let deudor = '—', referencia = '—';
    if (c.origen === 'alquiler') {
      const a = mapAlquiler.get(c.contrato_id);
      deudor = a?.inquilino?.nombre ?? '—';
      referencia = a ? `${a.seccion?.propiedades?.nombre_referencial ?? ''} · ${a.seccion?.nombre ?? ''}` : '—';
    } else if (c.origen === 'venta') {
      const v = mapVenta.get(c.contrato_id);
      deudor = v?.comprador?.nombre ?? '—';
      referencia = v ? `${v.seccion?.propiedades?.nombre_referencial ?? ''} · ${v.seccion?.nombre ?? ''}` : '—';
    } else if (c.origen === 'servicio') {
      const d = mapDetalle.get(c.calculo_servicio_detalle_id);
      deudor = d?.contrato_alquiler?.inquilino?.nombre ?? '—';
      referencia = d ? `${d.seccion?.propiedades?.nombre_referencial ?? ''} · ${d.seccion?.nombre ?? ''} · ${d.calculo_periodo?.tipo_servicio?.nombre ?? ''}` : '—';
    }
    const totalPagado = (c.pagos ?? []).filter((p) => p.estado !== 'anulado').reduce((s, p) => s + Number(p.monto), 0);
    return { ...c, deudor, referencia, totalPagado, saldo: Number(c.monto) + Number(c.mora_aplicada) - totalPagado };
  });

  if (search) {
    const s = search.toLowerCase();
    return enriched.filter((c) => c.deudor.toLowerCase().includes(s) || c.referencia.toLowerCase().includes(s) || (c.concepto ?? '').toLowerCase().includes(s));
  }
  return enriched;
}

/* ================================= REPORTES =================================== */
// Reporte consolidado de cuotas de servicio (agua/luz) de un periodo,
// agrupable por inmueble — pensado para imprimirse como el control físico
// que ya llevaban en Excel (columna INMUEBLE, INQUILINO, IMPORTE...).
// Reutiliza el mismo patrón de listCuotas (contrato_id es FK lógica, así que
// el detalle de cada cuota de servicio se resuelve en una consulta aparte).
export async function listCuotasServicioParaReporte({ periodo, tipoServicioId = '', soloPendientes = true } = {}) {
  if (!periodo) return [];
  let query = supabase
    .from('cuotas')
    .select('id, calculo_servicio_detalle_id, concepto, monto, mora_aplicada, fecha_vencimiento, estado, pagos(id, monto, fecha_pago, medio_pago, n_operacion, estado)')
    .eq('origen', 'servicio')
    .order('fecha_vencimiento', { ascending: true });
  if (soloPendientes) query = query.neq('estado', 'anulada');
  const { data: cuotas, error } = await query;
  if (error) throw error;
  if (!cuotas.length) return [];

  const idsDetalle = cuotas.filter((c) => c.calculo_servicio_detalle_id).map((c) => c.calculo_servicio_detalle_id);
  if (!idsDetalle.length) return [];
  const { data: detalles, error: e2 } = await supabase
    .from('calculo_servicios_detalle')
    .select(`
      id,
      seccion:seccion_id(nombre, propiedad_id, propiedades(nombre_referencial)),
      contrato_alquiler:contrato_alquiler_id(inquilino:inquilino_id(nombre)),
      calculo_periodo:calculo_periodo_id!inner(periodo, tipo_servicio_id, propiedad_id, tipo_servicio:tipo_servicio_id(nombre))
    `)
    .in('id', idsDetalle)
    .eq('calculo_periodo.periodo', periodo);
  if (e2) throw e2;
  const mapDetalle = new Map((detalles ?? []).map((d) => [d.id, d]));

  const filtrado = tipoServicioId
    ? (detalles ?? []).filter((d) => d.calculo_periodo?.tipo_servicio_id === tipoServicioId)
    : (detalles ?? []);
  const idsValidos = new Set(filtrado.map((d) => d.id));

  return cuotas
    .filter((c) => idsValidos.has(c.calculo_servicio_detalle_id))
    .map((c) => {
      const d = mapDetalle.get(c.calculo_servicio_detalle_id);
      // Una cuota puede tener varios pagos (cobro parcial en distintas
      // fechas) — se listan todos los no anulados, ordenados por fecha, así
      // el reporte puede mostrar "Fch. pago" y "Recibo/método" con más de
      // un valor cuando corresponda.
      const pagosValidos = (c.pagos ?? [])
        .filter((p) => p.estado !== 'anulado')
        .sort((a, b) => (a.fecha_pago ?? '').localeCompare(b.fecha_pago ?? ''));
      const totalPagado = pagosValidos.reduce((s, p) => s + Number(p.monto), 0);
      const importeTotal = Number(c.monto) + Number(c.mora_aplicada);
      const saldo = importeTotal - totalPagado;
      return {
        id: c.id,
        propiedadId: d?.seccion?.propiedad_id ?? d?.calculo_periodo?.propiedad_id ?? null,
        propiedadNombre: d?.seccion?.propiedades?.nombre_referencial ?? '—',
        seccionNombre: d?.seccion?.nombre ?? '—',
        inquilinoNombre: d?.contrato_alquiler?.inquilino?.nombre ?? '—',
        tipoServicioNombre: d?.calculo_periodo?.tipo_servicio?.nombre ?? '—',
        concepto: c.concepto,
        monto: Number(c.monto),
        moraAplicada: Number(c.mora_aplicada),
        importeTotal,
        totalPagado,
        saldo,
        estado: c.estado,
        fechaVencimiento: c.fecha_vencimiento,
        pagos: pagosValidos.map((p) => ({
          monto: Number(p.monto),
          fechaPago: p.fecha_pago,
          medioPago: p.medio_pago,
          nOperacion: p.n_operacion,
        })),
      };
    })
    .filter((r) => !soloPendientes || r.saldo > 0.009);
}

export async function getCuota(id) {
  const { data, error } = await supabase
    .from('cuotas')
    .select('*, pagos(id, monto, fecha_pago, medio_pago, n_operacion, estado, comprobante_url, foto_cobranza_url, notas, created_at)')
    .eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function aplicarMoraVencidas() {
  const { data, error } = await supabase.rpc('aplicar_mora_cuotas_vencidas');
  if (error) throw error;
  return data;
}

export async function anularCuota(id) {
  const { data, error } = await supabase.from('cuotas').update({ estado: 'anulada' }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/* =================================== PAGOS ==================================== */
export async function registrarPago(payload) {
  const { data, error } = await supabase.from('pagos').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function verificarPago(id) {
  const { data, error } = await supabase
    .from('pagos')
    .update({ estado: 'verificado', fecha_verificacion: new Date().toISOString() })
    .eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function anularPago(id) {
  const { data, error } = await supabase.from('pagos').update({ estado: 'anulado' }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/* ===================== MODULO CALCULO DE SERVICIOS ============================ */
export async function listTiposServicio() {
  const { data, error } = await supabase.from('tipos_servicio').select('*').eq('activo', true).order('orden');
  if (error) throw error;
  return data;
}

export async function listMedidores({ propiedadId = '' } = {}) {
  let query = supabase
    .from('medidores')
    .select('*, propiedad:propiedad_id(nombre_referencial), seccion:seccion_id(nombre), tipo_servicio:tipo_servicio_id(nombre, unidad_medida), cuenta_servicio:cuenta_servicio_id(id, codigo, nombre), medidores_reparto(id, seccion_id, porcentaje, seccion:seccion_id(nombre))')
    .order('created_at', { ascending: false });
  if (propiedadId) query = query.eq('propiedad_id', propiedadId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/* ------------------------------ Reparto de medidores compartidos ---------------
 * Un medidor "compartido" (es_compartido = true) no tiene seccion_id propia;
 * en cambio, su consumo se reparte por porcentaje entre varias secciones
 * (ej. un baño común entre 2 locales). guardarRepartoMedidor reemplaza el
 * reparto completo de un medidor de una sola vez (borra y vuelve a insertar).
 * ------------------------------------------------------------------------- */
export async function guardarRepartoMedidor(medidorId, repartos) {
  const { error: delError } = await supabase.from('medidores_reparto').delete().eq('medidor_id', medidorId);
  if (delError) throw delError;
  if (!repartos.length) return [];
  const rows = repartos.map((r) => ({ medidor_id: medidorId, seccion_id: r.seccion_id, porcentaje: r.porcentaje }));
  const { data, error } = await supabase.from('medidores_reparto').insert(rows).select();
  if (error) throw error;
  return data;
}

/* ------------------------------ Cuentas de servicio ---------------------------
 * Representa una cuenta municipal independiente (ej. "Lt14") cuando una
 * propiedad tiene varias cuentas del mismo servicio (agua/luz), cada una
 * alimentando un subconjunto de medidores. Opcional: si una propiedad solo
 * tiene una cuenta por servicio, no hace falta crear ninguna aquí.
 * ------------------------------------------------------------------------- */
export async function listCuentasServicio({ propiedadId = '', tipoServicioId = '' } = {}) {
  let query = supabase
    .from('cuentas_servicio')
    .select('*, propiedad:propiedad_id(nombre_referencial), tipo_servicio:tipo_servicio_id(nombre)')
    .order('codigo', { ascending: true });
  if (propiedadId) query = query.eq('propiedad_id', propiedadId);
  if (tipoServicioId) query = query.eq('tipo_servicio_id', tipoServicioId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createCuentaServicio(payload) {
  const { data, error } = await supabase.from('cuentas_servicio').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateCuentaServicio(id, payload) {
  const { data, error } = await supabase.from('cuentas_servicio').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCuentaServicio(id) {
  const { error } = await supabase.from('cuentas_servicio').delete().eq('id', id);
  if (error) throw error;
}

export async function createMedidor(payload) {
  const { data, error } = await supabase.from('medidores').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateMedidor(id, payload) {
  const { data, error } = await supabase.from('medidores').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteMedidor(id) {
  const { error } = await supabase.from('medidores').delete().eq('id', id);
  if (error) throw error;
}

export async function listLecturas({ medidorId = '', periodo = '', propiedadId = '', tipoServicioId = '' } = {}) {
  // !inner en el embed de medidor es necesario para que el filtro por
  // propiedad_id / tipo_servicio_id se aplique también a las filas de nivel
  // superior (lecturas), no solo al objeto anidado — si no, el filtro no
  // tiene ningún efecto.
  const embedMedidor = (propiedadId || tipoServicioId) ? 'medidor:medidor_id!inner' : 'medidor:medidor_id';
  let query = supabase
    .from('lecturas_medidores')
    .select(`*, ${embedMedidor}(propiedad_id, seccion_id, tipo_servicio_id, codigo_medidor, es_general, es_compartido, propiedad:propiedad_id(nombre_referencial), seccion:seccion_id(nombre), tipo_servicio:tipo_servicio_id(nombre, unidad_medida), medidores_reparto(seccion_id))`)
    .order('fecha_lectura', { ascending: false });
  if (medidorId) query = query.eq('medidor_id', medidorId);
  if (periodo) query = query.eq('periodo', periodo);
  if (propiedadId) query = query.eq('medidor.propiedad_id', propiedadId);
  if (tipoServicioId) query = query.eq('medidor.tipo_servicio_id', tipoServicioId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Trae la lectura ANTERIOR más reciente ANTES de `antesDeFecha` (formato
// 'YYYY-MM-DD'), encadenando por FECHA real de lectura y no por el mes
// calendario — importante cuando se registran lecturas fuera de orden (ej.
// primero agosto y luego, para completar el historial, julio): la "lectura
// anterior" de julio debe ser la de junio, no la de agosto que ya se cargó
// después. Devuelve también su fecha, para poder autocompletar tanto la
// fecha como el valor de "lectura anterior" del formulario.
export async function getUltimaLectura(medidorId, antesDeFecha = '') {
  let query = supabase
    .from('lecturas_medidores')
    .select('fecha_lectura, lectura_actual')
    .eq('medidor_id', medidorId)
    .order('fecha_lectura', { ascending: false })
    .limit(1);
  if (antesDeFecha) query = query.lt('fecha_lectura', antesDeFecha);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export async function createLectura(payload) {
  const { data, error } = await supabase.from('lecturas_medidores').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateLectura(id, payload) {
  const { data, error } = await supabase.from('lecturas_medidores').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteLectura(id) {
  const { error } = await supabase.from('lecturas_medidores').delete().eq('id', id);
  if (error) throw error;
}

export async function listRecibosGenerales({ propiedadId = '', tipoServicioId = '' } = {}) {
  let query = supabase
    .from('recibos_generales_servicio')
    .select('*, propiedad:propiedad_id(nombre_referencial), tipo_servicio:tipo_servicio_id(nombre), cuenta_servicio:cuenta_servicio_id(id, codigo, nombre)')
    .order('periodo', { ascending: false });
  if (propiedadId) query = query.eq('propiedad_id', propiedadId);
  if (tipoServicioId) query = query.eq('tipo_servicio_id', tipoServicioId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createReciboGeneral(payload) {
  const { data, error } = await supabase.from('recibos_generales_servicio').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateReciboGeneral(id, payload) {
  const { data, error } = await supabase.from('recibos_generales_servicio').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteReciboGeneral(id) {
  const { error } = await supabase.from('recibos_generales_servicio').delete().eq('id', id);
  if (error) throw error;
}

export async function listCalculosPeriodo({ propiedadId = '' } = {}) {
  let query = supabase
    .from('calculo_servicios_periodo')
    .select('*, propiedad:propiedad_id(nombre_referencial), tipo_servicio:tipo_servicio_id(nombre)')
    .order('periodo', { ascending: false });
  if (propiedadId) query = query.eq('propiedad_id', propiedadId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getDetalleCalculo(calculoPeriodoId) {
  const { data, error } = await supabase
    .from('calculo_servicios_detalle')
    .select('*, seccion:seccion_id(nombre)')
    .eq('calculo_periodo_id', calculoPeriodoId);
  if (error) throw error;
  return data;
}

export async function calcularPeriodoServicio({ propiedadId, tipoServicioId, periodo, reciboGeneralId, detalles, precioUnitario = null }) {
  const { data, error } = await supabase.rpc('calcular_periodo_servicio', {
    p_propiedad_id: propiedadId,
    p_tipo_servicio_id: tipoServicioId,
    p_periodo: periodo,
    p_recibo_general_id: reciboGeneralId,
    p_detalles: detalles,
    p_precio_unitario_override: precioUnitario,
  });
  if (error) throw error;
  return data;
}

// Junta el detalle de TODAS las cuentas ya calculadas de una propiedad +
// servicio + periodo (agrupado por sección) y genera UNA cuota de cobranza
// combinada por sección — exige que todas las cuentas de ese periodo ya
// estén calculadas (si no, el RPC lanza error y se muestra como toast).
export async function generarCobranzasServicio({ propiedadId, tipoServicioId, periodo }) {
  const { data, error } = await supabase.rpc('generar_cobranzas_servicio', {
    p_propiedad_id: propiedadId,
    p_tipo_servicio_id: tipoServicioId,
    p_periodo: periodo,
  });
  if (error) throw error;
  return data;
}

// Detalle de cálculo (por sección) de TODAS las cuentas ya calculadas para
// una propiedad + servicio + periodo — usado para saber si ya se generaron
// las cobranzas (cuota_id no nulo) antes de habilitar el botón.
export async function listDetalleCalculoPorPeriodo({ propiedadId, tipoServicioId, periodo }) {
  const { data, error } = await supabase
    .from('calculo_servicios_detalle')
    .select('id, seccion_id, monto_calculado, cuota_id, calculo_periodo:calculo_periodo_id!inner(propiedad_id, tipo_servicio_id, periodo)')
    .eq('calculo_periodo.propiedad_id', propiedadId)
    .eq('calculo_periodo.tipo_servicio_id', tipoServicioId)
    .eq('calculo_periodo.periodo', periodo);
  if (error) throw error;
  return data;
}

// Detalle "rico" (con lecturas, sección, cuenta e inquilino) de todas las
// cuentas ya calculadas de una propiedad+servicio+periodo — usado para
// armar el "cuadro de consumo" que se le presenta al inquilino (vista
// previa en el tab Cálculo, antes de generar la cobranza combinada).
const SELECT_DETALLE_CUADRO = `
  id, seccion_id, metodo, consumo, precio_unitario_aplicado, n_personas, tarifa_por_persona, monto_calculado, cuota_id,
  seccion:seccion_id(nombre, propiedades(nombre_referencial)),
  lectura:lectura_id(periodo, fecha_lectura, fecha_lectura_anterior, lectura_anterior, lectura_actual, medidor:medidor_id(codigo_medidor, es_compartido)),
  contrato_alquiler:contrato_alquiler_id(inquilino:inquilino_id(nombre)),
  calculo_periodo:calculo_periodo_id!inner(
    propiedad_id, tipo_servicio_id, periodo,
    propiedad:propiedad_id(nombre_referencial),
    tipo_servicio:tipo_servicio_id(nombre, unidad_medida),
    recibo_general:recibo_general_id(cuenta_servicio:cuenta_servicio_id(codigo, nombre))
  )
`;

export async function listDetalleCalculoConLecturas({ propiedadId, tipoServicioId, periodo }) {
  const { data, error } = await supabase
    .from('calculo_servicios_detalle')
    .select(SELECT_DETALLE_CUADRO)
    .eq('calculo_periodo.propiedad_id', propiedadId)
    .eq('calculo_periodo.tipo_servicio_id', tipoServicioId)
    .eq('calculo_periodo.periodo', periodo);
  if (error) throw error;
  return data;
}

// Mismo detalle "rico" pero filtrado por una cuota ya generada — usado
// desde Cobranzas y Pagos para descargar el cuadro de una cuota puntual.
export async function listDetalleCalculoPorCuota(cuotaId) {
  const { data, error } = await supabase
    .from('calculo_servicios_detalle')
    .select(SELECT_DETALLE_CUADRO)
    .eq('cuota_id', cuotaId);
  if (error) throw error;
  return data;
}

// Deshace el cálculo confirmado de UNA cuenta (borra calculo_servicios_periodo
// + su detalle) para poder corregir una lectura y recalcular. El servidor
// bloquea esto si ese detalle ya quedó ligado a una cuota generada.
export async function deshacerCalculoServicio(reciboGeneralId) {
  const { error } = await supabase.rpc('deshacer_calculo_servicio', { p_recibo_general_id: reciboGeneralId });
  if (error) throw error;
}

// Elimina una cuota de servicio ya generada y libera su detalle de cálculo
// (vuelve a quedar "pendiente de facturar"). El servidor bloquea esto si la
// cuota ya tiene pagos registrados.
export async function eliminarCuotaServicio(cuotaId) {
  const { error } = await supabase.rpc('eliminar_cuota_servicio', { p_cuota_id: cuotaId });
  if (error) throw error;
}

/* ============================ CONFIGURACIÓN DEL SISTEMA ======================= */
// Tabla singleton (siempre 1 fila, id fijo) con variables globales editables
// desde la pantalla de Configuración: precio por defecto de agua/luz,
// moneda, mora, etc.
export async function getConfiguracionSistema() {
  const { data, error } = await supabase.from('configuracion_sistema').select('*').eq('id', true).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateConfiguracionSistema(payload) {
  // upsert en vez de update plano: si por lo que sea la fila única (id=true)
  // no existe todavía, la crea en vez de fallar con "0 rows" (PGRST116).
  const { data, error } = await supabase.from('configuracion_sistema').upsert({ id: true, ...payload }).select().single();
  if (error) throw error;
  return data;
}

/* ================================ OPORTUNIDADES ================================ */
export async function listOportunidades({ tipoOperacion = '', etapa = '', search = '' } = {}) {
  let query = supabase
    .from('oportunidades')
    .select(`
      id, tipo_operacion, etapa, fuente, notas, motivo_perdida, fecha_creacion, updated_at,
      contrato_venta_id, contrato_alquiler_id,
      seccion:seccion_id ( id, nombre, propiedad_id, propiedades(nombre_referencial, distrito) ),
      persona:persona_id ( id, nombre, telefono, email )
    `)
    .order('updated_at', { ascending: false });
  if (tipoOperacion) query = query.eq('tipo_operacion', tipoOperacion);
  if (etapa) query = query.eq('etapa', etapa);
  const { data, error } = await query;
  if (error) throw error;
  if (search) {
    const s = search.toLowerCase();
    return data.filter((o) =>
      o.persona?.nombre?.toLowerCase().includes(s) ||
      o.seccion?.nombre?.toLowerCase().includes(s) ||
      o.seccion?.propiedades?.nombre_referencial?.toLowerCase().includes(s));
  }
  return data;
}

export async function getOportunidad(id) {
  const { data, error } = await supabase
    .from('oportunidades')
    .select(`*, seccion:seccion_id(id, nombre, propiedad_id, propiedades(nombre_referencial, distrito)), persona:persona_id(id, nombre)`)
    .eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createOportunidad(payload) {
  const { data, error } = await supabase.from('oportunidades').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateOportunidad(id, payload) {
  const { data, error } = await supabase.from('oportunidades').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteOportunidad(id) {
  const { error } = await supabase.from('oportunidades').delete().eq('id', id);
  if (error) throw error;
}

/* ================================ MANTENIMIENTOS ================================ */
export async function listMantenimientos({ propiedadId = '' } = {}) {
  let query = supabase
    .from('mantenimientos')
    .select('*, propiedad:propiedad_id(nombre_referencial), seccion:seccion_id(nombre), proveedor:proveedor_id(nombre)')
    .order('fecha', { ascending: false });
  if (propiedadId) query = query.eq('propiedad_id', propiedadId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getMantenimiento(id) {
  const { data, error } = await supabase
    .from('mantenimientos')
    .select('*, propiedad:propiedad_id(nombre_referencial), seccion:seccion_id(nombre), proveedor:proveedor_id(nombre), mantenimientos_comprobantes(id, tipo_comprobante, url_storage, descripcion, monto, created_at)')
    .eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createMantenimiento(payload) {
  const { data, error } = await supabase.from('mantenimientos').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateMantenimiento(id, payload) {
  const { data, error } = await supabase.from('mantenimientos').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteMantenimiento(id) {
  const { error } = await supabase.from('mantenimientos').delete().eq('id', id);
  if (error) throw error;
}

export async function addMantenimientoComprobante(mantenimientoId, payload) {
  const { data, error } = await supabase
    .from('mantenimientos_comprobantes')
    .insert({ mantenimiento_id: mantenimientoId, ...payload })
    .select().single();
  if (error) throw error;
  return data;
}

export async function removeMantenimientoComprobante(id) {
  const { error } = await supabase.from('mantenimientos_comprobantes').delete().eq('id', id);
  if (error) throw error;
}

/* ============================== TRIBUTOS MUNICIPALES ============================= */
export async function listTributos({ propiedadId = '', estadoPago = '' } = {}) {
  let query = supabase
    .from('tributos_municipales')
    .select('*, propiedad:propiedad_id(nombre_referencial), seccion:seccion_id(nombre, partida_registral, codigo_pu_hr)')
    .order('fecha_vencimiento', { ascending: true });
  if (propiedadId) query = query.eq('propiedad_id', propiedadId);
  if (estadoPago) query = query.eq('estado_pago', estadoPago);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getTributo(id) {
  const { data, error } = await supabase
    .from('tributos_municipales')
    .select('*, propiedad:propiedad_id(nombre_referencial), seccion:seccion_id(nombre, partida_registral, codigo_pu_hr)')
    .eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createTributo(payload) {
  const { data, error } = await supabase.from('tributos_municipales').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateTributo(id, payload) {
  const { data, error } = await supabase.from('tributos_municipales').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/* ================================== DOCUMENTOS ================================== */
/**
 * Recorre el bucket completo (2 niveles: carpeta/entidad/archivo, que es la
 * convención usada por uploadArchivo en todo el sistema) y devuelve una
 * lista plana de archivos con su categoría, para el explorador de
 * Documentos. No usa ninguna tabla — lee directo del Storage.
 */
export async function listAllArchivos() {
  const { data: topLevel, error: topError } = await supabase.storage.from(STORAGE_BUCKET).list('', { limit: 200 });
  if (topError) throw topError;
  const carpetas = (topLevel ?? []).filter((item) => item.id === null);

  const archivos = [];
  for (const carpeta of carpetas) {
    const { data: subLevel, error: subError } = await supabase.storage.from(STORAGE_BUCKET).list(carpeta.name, { limit: 500 });
    if (subError) { console.error(subError); continue; }
    const subcarpetas = (subLevel ?? []).filter((item) => item.id === null);
    for (const sub of subcarpetas) {
      const path = `${carpeta.name}/${sub.name}`;
      const { data: files, error: filesError } = await supabase.storage.from(STORAGE_BUCKET).list(path, { limit: 500 });
      if (filesError) { console.error(filesError); continue; }
      (files ?? []).filter((f) => f.id !== null).forEach((f) => {
        archivos.push({
          categoria: carpeta.name,
          entidadId: sub.name,
          nombre: f.name,
          path: `${path}/${f.name}`,
          tamano: f.metadata?.size ?? null,
          actualizado: f.updated_at ?? f.created_at ?? null,
        });
      });
    }
  }
  return archivos;
}

/* ============================ DASHBOARD / KPIs ============================== */
export async function getDashboardKpis() {
  const [propiedades, secciones, personas, contratos, cuotasPendientes] = await Promise.all([
    supabase.from('propiedades').select('id', { count: 'exact', head: true }),
    supabase.from('secciones').select('id, estado'),
    supabase.from('personas').select('id', { count: 'exact', head: true }),
    supabase.from('contratos_alquiler').select('id, estado'),
    supabase.from('cuotas').select('id, monto, mora_aplicada, estado').in('estado', ['pendiente', 'parcial', 'vencida']),
  ]);
  if (propiedades.error) throw propiedades.error;
  if (secciones.error) throw secciones.error;
  if (personas.error) throw personas.error;
  if (contratos.error) throw contratos.error;
  if (cuotasPendientes.error) throw cuotasPendientes.error;

  const montoPendiente = (cuotasPendientes.data ?? []).reduce((s, c) => s + Number(c.monto) + Number(c.mora_aplicada), 0);
  const cuotasVencidas = (cuotasPendientes.data ?? []).filter((c) => c.estado === 'vencida').length;

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
    montoPendiente,
    cuotasVencidas,
  };
}
