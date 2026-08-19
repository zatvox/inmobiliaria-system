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
      id, monto_renta, moneda, dia_vencimiento, fecha_inicio, fecha_fin, estado, deposito_garantia, renovacion_automatica, notas,
      seccion:seccion_id ( id, nombre, propiedad_id, propiedades(nombre_referencial, distrito) ),
      inquilino:inquilino_id ( id, nombre, telefono ),
      agente:agente_id ( id, nombre ),
      aval:aval_id ( id, nombre, telefono )
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
    .select(`*, seccion:seccion_id(id, nombre, propiedad_id, propiedades(nombre_referencial, distrito)), inquilino:inquilino_id(id, nombre), agente:agente_id(id, nombre), aval:aval_id(id, nombre)`)
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
  return data;
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
    .select('*, propiedad:propiedad_id(nombre_referencial), seccion:seccion_id(nombre), tipo_servicio:tipo_servicio_id(nombre, unidad_medida), cuenta_servicio:cuenta_servicio_id(id, codigo, nombre)')
    .order('created_at', { ascending: false });
  if (propiedadId) query = query.eq('propiedad_id', propiedadId);
  const { data, error } = await query;
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

export async function listLecturas({ medidorId = '', periodo = '', propiedadId = '' } = {}) {
  // !inner en el embed de medidor es necesario para que el filtro por
  // propiedad_id se aplique también a las filas de nivel superior (lecturas),
  // no solo al objeto anidado — si no, el filtro no tiene ningún efecto.
  const embedMedidor = propiedadId ? 'medidor:medidor_id!inner' : 'medidor:medidor_id';
  let query = supabase
    .from('lecturas_medidores')
    .select(`*, ${embedMedidor}(propiedad_id, codigo_medidor, es_general, propiedad:propiedad_id(nombre_referencial), seccion:seccion_id(nombre), tipo_servicio:tipo_servicio_id(nombre, unidad_medida))`)
    .order('periodo', { ascending: false });
  if (medidorId) query = query.eq('medidor_id', medidorId);
  if (periodo) query = query.eq('periodo', periodo);
  if (propiedadId) query = query.eq('medidor.propiedad_id', propiedadId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Trae la última lectura ANTERIOR a `antesDePeriodo` (formato 'YYYY-MM'), no
// simplemente la más reciente en general — importante cuando se registran
// lecturas fuera de orden (ej. primero agosto y luego, para completar el
// historial, julio): la "lectura anterior" de julio debe ser la de junio,
// no la de agosto que ya se cargó después.
export async function getUltimaLectura(medidorId, antesDePeriodo = '') {
  let query = supabase
    .from('lecturas_medidores')
    .select('periodo, lectura_actual')
    .eq('medidor_id', medidorId)
    .order('periodo', { ascending: false })
    .limit(1);
  if (antesDePeriodo) query = query.lt('periodo', antesDePeriodo);
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

export async function listRecibosGenerales({ propiedadId = '' } = {}) {
  let query = supabase
    .from('recibos_generales_servicio')
    .select('*, propiedad:propiedad_id(nombre_referencial), tipo_servicio:tipo_servicio_id(nombre), cuenta_servicio:cuenta_servicio_id(id, codigo, nombre)')
    .order('periodo', { ascending: false });
  if (propiedadId) query = query.eq('propiedad_id', propiedadId);
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

export async function calcularPeriodoServicio({ propiedadId, tipoServicioId, periodo, reciboGeneralId, detalles }) {
  const { data, error } = await supabase.rpc('calcular_periodo_servicio', {
    p_propiedad_id: propiedadId,
    p_tipo_servicio_id: tipoServicioId,
    p_periodo: periodo,
    p_recibo_general_id: reciboGeneralId,
    p_detalles: detalles,
  });
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
