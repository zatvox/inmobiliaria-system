-- ============================================================================
-- SISTEMA DE GESTION INMOBILIARIA — SCHEMA (Fase 1)
-- Proyecto: inmobiliaria-system | Stack: Supabase (PostgreSQL)
-- Orden de ejecucion: schema.sql -> rls-policies.sql -> seed.sql
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- FUNCION GENERICA: updated_at automatico
-- ============================================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ============================================================================
-- 1. EMPRESAS
-- ============================================================================
create table empresas (
  id uuid primary key default gen_random_uuid(),
  razon_social text not null,
  ruc text,
  direccion text,
  telefono text,
  email text,
  logo_url text,
  representante_nombre text,
  representante_dni text,
  representante_cargo text,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_empresas_updated before update on empresas
  for each row execute function set_updated_at();

-- ============================================================================
-- 2. USUARIOS Y ROLES
-- ============================================================================
create table usuarios_roles (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  rol text not null check (rol in ('administrador','operador')),
  nombre_visible text,
  created_at timestamptz not null default now(),
  unique (usuario_id)
);

-- ============================================================================
-- 3. PERSONAS (compradores / inquilinos / propietarios / leads / agentes)
-- ============================================================================
create table personas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo_documento text check (tipo_documento in ('DNI','RUC','CE','PASAPORTE','OTRO')),
  dni_ruc text,
  telefono text,
  email text,
  direccion text,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_personas_updated before update on personas
  for each row execute function set_updated_at();

create table personas_roles (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references personas(id) on delete cascade,
  rol text not null check (rol in ('comprador','inquilino','propietario','lead','agente','proveedor')),
  created_at timestamptz not null default now(),
  unique (persona_id, rol)
);
create index idx_personas_roles_persona on personas_roles(persona_id);
create index idx_personas_roles_rol on personas_roles(rol);

-- ============================================================================
-- 4. CATALOGOS GENERICOS (tipo_propiedad, distrito, medio_pago, fuente_lead...)
-- ============================================================================
create table catalogos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  valor text not null,
  orden int not null default 0,
  activo boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tipo, valor)
);
create index idx_catalogos_tipo on catalogos(tipo) where activo;

-- ============================================================================
-- 5. TIPOS DE SERVICIO (luz, agua, gas, internet, wifi, telefonia, cable...)
-- ============================================================================
create table tipos_servicio (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  unidad_medida text,                                   -- kWh, m3, gal, N/A
  prorrateable_por_consumo boolean not null default true,-- false = gasto fijo, no se cobra a inquilinos
  permite_tarifa_fija_por_persona boolean not null default false,
  tarifa_por_persona_default numeric(10,2),
  dia_corte_mensual int check (dia_corte_mensual between 1 and 31),
  activo boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 6. PROPIEDADES (predio / edificio fisico)
-- ============================================================================
create table propiedades (
  id uuid primary key default gen_random_uuid(),
  nombre_referencial text not null,
  tipo text,                                            -- referencia catalogos tipo='tipo_propiedad'
  direccion text not null,
  distrito text,
  zona text,
  area_terreno_m2 numeric(10,2),
  area_construida_m2 numeric(10,2),
  n_pisos int,
  anio_construccion int,
  partida_registral text,
  propietario_id uuid references personas(id),
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_propiedades_updated before update on propiedades
  for each row execute function set_updated_at();
create index idx_propiedades_propietario on propiedades(propietario_id);

create table propiedades_fotos (
  id uuid primary key default gen_random_uuid(),
  propiedad_id uuid not null references propiedades(id) on delete cascade,
  url_storage text not null,
  descripcion text,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

create table propiedades_documentos (
  id uuid primary key default gen_random_uuid(),
  propiedad_id uuid not null references propiedades(id) on delete cascade,
  tipo text,                                            -- titulo_propiedad, hr_pu, planos, otro
  url_storage text not null,
  descripcion text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 7. SECCIONES (unidad real que se alquila / vende / mide consumo)
-- ============================================================================
create table secciones (
  id uuid primary key default gen_random_uuid(),
  propiedad_id uuid not null references propiedades(id) on delete cascade,
  nombre text not null,                                 -- "Piso 1-2 Duplex", "Depto 301", "Lote 15"
  tipo_seccion text not null check (tipo_seccion in ('piso','departamento','duplex','lote','oficina','almacen','local','otro')),
  area_m2 numeric(10,2),
  habitaciones int,
  banos int,
  cocheras int,
  estado text not null default 'disponible' check (estado in ('disponible','en_venta','en_alquiler','vendido','alquilado','reservado','inactivo')),
  precio_venta numeric(12,2),
  precio_alquiler_referencial numeric(12,2),
  tiene_medidor_propio_luz boolean not null default false,
  tiene_medidor_propio_agua boolean not null default false,
  orden int not null default 0,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_secciones_updated before update on secciones
  for each row execute function set_updated_at();
create index idx_secciones_propiedad on secciones(propiedad_id);
create index idx_secciones_estado on secciones(estado);

create table secciones_fotos (
  id uuid primary key default gen_random_uuid(),
  seccion_id uuid not null references secciones(id) on delete cascade,
  url_storage text not null,
  descripcion text,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

create table historial_precios (
  id uuid primary key default gen_random_uuid(),
  seccion_id uuid not null references secciones(id) on delete cascade,
  tipo_operacion text not null check (tipo_operacion in ('venta','alquiler')),
  precio numeric(12,2) not null,
  fecha_cambio timestamptz not null default now(),
  notas text
);
create index idx_historial_precios_seccion on historial_precios(seccion_id);

-- ============================================================================
-- 8. AGENTES INMOBILIARIOS: COMISIONES
-- ============================================================================
create table comisiones_agentes (
  id uuid primary key default gen_random_uuid(),
  agente_id uuid not null references personas(id),
  contrato_tipo text not null check (contrato_tipo in ('venta','alquiler')),
  contrato_id uuid not null,                            -- FK logica -> contratos_venta / contratos_alquiler segun contrato_tipo
  monto numeric(12,2),
  porcentaje numeric(5,2),
  estado text not null default 'pendiente' check (estado in ('pendiente','pagada','anulada')),
  fecha_pago date,
  comprobante_url text,
  notas text,
  created_at timestamptz not null default now()
);
create index idx_comisiones_agente on comisiones_agentes(agente_id);
create index idx_comisiones_contrato on comisiones_agentes(contrato_tipo, contrato_id);

-- ============================================================================
-- 9. CONTRATOS
-- ============================================================================
create table contratos_alquiler (
  id uuid primary key default gen_random_uuid(),
  seccion_id uuid not null references secciones(id),
  inquilino_id uuid not null references personas(id),
  agente_id uuid references personas(id),
  monto_renta numeric(12,2) not null,
  moneda text not null default 'PEN' check (moneda in ('PEN','USD')),
  dia_vencimiento int not null check (dia_vencimiento between 1 and 31),
  fecha_inicio date not null,
  fecha_fin date,
  deposito_garantia numeric(12,2),
  estado text not null default 'vigente' check (estado in ('vigente','por_vencer','vencido','renovado','finalizado')),
  renovacion_automatica boolean not null default false,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_contratos_alquiler_updated before update on contratos_alquiler
  for each row execute function set_updated_at();
create index idx_contratos_alquiler_seccion on contratos_alquiler(seccion_id);
create index idx_contratos_alquiler_inquilino on contratos_alquiler(inquilino_id);
create index idx_contratos_alquiler_estado on contratos_alquiler(estado);

create table contratos_venta (
  id uuid primary key default gen_random_uuid(),
  seccion_id uuid not null references secciones(id),
  comprador_id uuid not null references personas(id),
  agente_id uuid references personas(id),
  precio_pactado numeric(12,2) not null,
  forma_pago text not null check (forma_pago in ('contado','cuotas','credito_hipotecario')),
  fecha_firma date not null,
  estado text not null default 'vigente' check (estado in ('vigente','completado','anulado')),
  n_cuotas int,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_contratos_venta_updated before update on contratos_venta
  for each row execute function set_updated_at();
create index idx_contratos_venta_seccion on contratos_venta(seccion_id);
create index idx_contratos_venta_comprador on contratos_venta(comprador_id);

create table oportunidades_venta (
  id uuid primary key default gen_random_uuid(),
  seccion_id uuid not null references secciones(id),
  persona_id uuid not null references personas(id),
  etapa text not null default 'prospecto' check (etapa in ('prospecto','visita_agendada','negociacion','separacion','firma_contrato','cerrado','perdido')),
  fuente text,
  notas text,
  motivo_perdida text,
  fecha_creacion timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_oportunidades_updated before update on oportunidades_venta
  for each row execute function set_updated_at();
create index idx_oportunidades_seccion on oportunidades_venta(seccion_id);
create index idx_oportunidades_etapa on oportunidades_venta(etapa);

-- ============================================================================
-- 10. CUOTAS Y PAGOS (cobranzas) — origen: venta / alquiler / servicio
-- ============================================================================
create table cuotas (
  id uuid primary key default gen_random_uuid(),
  origen text not null check (origen in ('venta','alquiler','servicio')),
  contrato_id uuid,                                     -- FK logica -> contratos_venta / contratos_alquiler
  calculo_servicio_detalle_id uuid,                      -- FK logica -> calculo_servicios_detalle (se agrega constraint tras crear esa tabla)
  numero_cuota int,
  concepto text,
  monto numeric(12,2) not null,
  fecha_vencimiento date not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','pagada','parcial','vencida','anulada')),
  mora_aplicada numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_cuotas_updated before update on cuotas
  for each row execute function set_updated_at();
create index idx_cuotas_origen on cuotas(origen);
create index idx_cuotas_contrato on cuotas(contrato_id);
create index idx_cuotas_estado on cuotas(estado);
create index idx_cuotas_vencimiento on cuotas(fecha_vencimiento);

create table pagos (
  id uuid primary key default gen_random_uuid(),
  cuota_id uuid not null references cuotas(id),
  monto numeric(12,2) not null,
  fecha_pago date not null default current_date,
  medio_pago text not null,                             -- referencia catalogos tipo='medio_pago'
  n_operacion text,
  estado text not null default 'registrado' check (estado in ('registrado','verificado','anulado')),
  comprobante_url text,                                 -- voucher deposito/transferencia
  foto_cobranza_url text,                                -- foto del recibo firmado por el gerente
  registrado_por uuid references auth.users(id),
  verificado_por uuid references auth.users(id),
  fecha_verificacion timestamptz,
  notas text,
  created_at timestamptz not null default now()
);
create index idx_pagos_cuota on pagos(cuota_id);
create index idx_pagos_estado on pagos(estado);

-- ============================================================================
-- 11. MODULO "CALCULO DE SERVICIOS" (medidores, lecturas, recibos, calculo)
-- ============================================================================
create table medidores (
  id uuid primary key default gen_random_uuid(),
  propiedad_id uuid references propiedades(id),
  seccion_id uuid references secciones(id),
  tipo_servicio_id uuid not null references tipos_servicio(id),
  es_general boolean not null default false,             -- true = medidor general del edificio/propiedad
  codigo_medidor text,
  activo boolean not null default true,
  fecha_instalacion date,
  notas text,
  created_at timestamptz not null default now(),
  constraint chk_medidor_dueno check (
    (es_general = true  and propiedad_id is not null and seccion_id is null)
    or
    (es_general = false and seccion_id is not null)
  )
);
create index idx_medidores_propiedad on medidores(propiedad_id);
create index idx_medidores_seccion on medidores(seccion_id);
create index idx_medidores_tipo on medidores(tipo_servicio_id);

create table lecturas_medidores (
  id uuid primary key default gen_random_uuid(),
  medidor_id uuid not null references medidores(id),
  periodo text not null,                                 -- 'YYYY-MM'
  fecha_lectura date not null,
  lectura_anterior numeric(12,3),
  lectura_actual numeric(12,3) not null,
  consumo_calculado numeric(12,3) generated always as (lectura_actual - coalesce(lectura_anterior,0)) stored,
  foto_url text,
  registrado_por uuid references auth.users(id),
  notas text,
  created_at timestamptz not null default now(),
  unique (medidor_id, periodo)
);
create index idx_lecturas_medidor on lecturas_medidores(medidor_id);
create index idx_lecturas_periodo on lecturas_medidores(periodo);

create table recibos_generales_servicio (
  id uuid primary key default gen_random_uuid(),
  propiedad_id uuid not null references propiedades(id),
  tipo_servicio_id uuid not null references tipos_servicio(id),
  periodo text not null,                                 -- 'YYYY-MM'
  monto_total_recibo numeric(12,2) not null,
  consumo_total_recibo numeric(12,3),
  precio_unitario numeric(12,4),                          -- monto_total/consumo_total o ingresado directo
  fecha_vencimiento_recibo date,
  foto_recibo_url text,
  estado_pago text not null default 'pendiente' check (estado_pago in ('pendiente','pagado')),
  fecha_pago date,
  comprobante_pago_url text,
  notas text,
  created_at timestamptz not null default now(),
  unique (propiedad_id, tipo_servicio_id, periodo)
);
create index idx_recibos_propiedad on recibos_generales_servicio(propiedad_id);
create index idx_recibos_periodo on recibos_generales_servicio(periodo);

create table calculo_servicios_periodo (
  id uuid primary key default gen_random_uuid(),
  propiedad_id uuid not null references propiedades(id),
  tipo_servicio_id uuid not null references tipos_servicio(id),
  periodo text not null,
  recibo_general_id uuid references recibos_generales_servicio(id),
  precio_unitario_aplicado numeric(12,4),
  fecha_calculo timestamptz not null default now(),
  generado_por uuid references auth.users(id),
  estado text not null default 'borrador' check (estado in ('borrador','confirmado')),
  notas text,
  unique (propiedad_id, tipo_servicio_id, periodo)
);
create index idx_calculo_periodo_propiedad on calculo_servicios_periodo(propiedad_id);

create table calculo_servicios_detalle (
  id uuid primary key default gen_random_uuid(),
  calculo_periodo_id uuid not null references calculo_servicios_periodo(id) on delete cascade,
  seccion_id uuid not null references secciones(id),
  metodo text not null check (metodo in ('medidor','tarifa_fija_por_persona')),
  lectura_id uuid references lecturas_medidores(id),
  consumo numeric(12,3),
  precio_unitario_aplicado numeric(12,4),
  n_personas int,
  tarifa_por_persona numeric(10,2),
  monto_calculado numeric(12,2) not null,
  cuota_id uuid references cuotas(id),
  notas text,
  created_at timestamptz not null default now()
);
create index idx_calculo_detalle_periodo on calculo_servicios_detalle(calculo_periodo_id);
create index idx_calculo_detalle_seccion on calculo_servicios_detalle(seccion_id);

alter table cuotas
  add constraint fk_cuotas_calculo_servicio_detalle
  foreign key (calculo_servicio_detalle_id) references calculo_servicios_detalle(id);

-- ============================================================================
-- 12. MANTENIMIENTO
-- ============================================================================
create table incidencias_mantenimiento (
  id uuid primary key default gen_random_uuid(),
  contrato_alquiler_id uuid not null references contratos_alquiler(id),
  descripcion text not null,
  estado text not null default 'reportado' check (estado in ('reportado','en_proceso','resuelto')),
  fecha_reporte timestamptz not null default now(),
  fecha_resolucion timestamptz,
  foto_url text
);
create index idx_incidencias_contrato on incidencias_mantenimiento(contrato_alquiler_id);

-- ============================================================================
-- 13. NOTIFICACIONES
-- ============================================================================
create table notificaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id),
  tipo text not null,
  referencia_id uuid,
  mensaje text not null,
  leido boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_notificaciones_usuario on notificaciones(usuario_id) where not leido;

-- ============================================================================
-- 14. CONFIGURACION (parametros de negocio editables desde el panel)
-- ============================================================================
create table configuracion (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  valor jsonb not null,
  descripcion text,
  updated_at timestamptz not null default now()
);
create trigger trg_configuracion_updated before update on configuracion
  for each row execute function set_updated_at();

-- ============================================================================
-- 15. FUNCION: helper de rol del usuario actual (se usa tambien en RLS)
-- ============================================================================
create or replace function auth_rol()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from usuarios_roles where usuario_id = auth.uid() limit 1;
$$;

-- ============================================================================
-- 16. FUNCION: generacion automatica de cuotas de alquiler
-- Se ejecuta al crear/activar un contrato_alquiler; genera cuotas mensuales
-- desde fecha_inicio hasta fecha_fin (o p_meses_adelante si no hay fecha_fin).
-- ============================================================================
create or replace function generar_cuotas_alquiler(p_contrato_id uuid, p_meses_adelante int default 12)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_fecha date;
  v_limite date;
  v_numero int := 1;
begin
  select * into c from contratos_alquiler where id = p_contrato_id;
  if not found then
    raise exception 'Contrato de alquiler % no existe', p_contrato_id;
  end if;

  v_limite := coalesce(c.fecha_fin, (current_date + (p_meses_adelante || ' months')::interval)::date);
  v_fecha := date_trunc('month', c.fecha_inicio)::date
             + ((c.dia_vencimiento - 1) || ' days')::interval;
  if v_fecha < c.fecha_inicio then
    v_fecha := (v_fecha + interval '1 month')::date;
  end if;

  while v_fecha <= v_limite loop
    if not exists (
      select 1 from cuotas
      where origen = 'alquiler' and contrato_id = p_contrato_id and fecha_vencimiento = v_fecha
    ) then
      insert into cuotas (origen, contrato_id, numero_cuota, concepto, monto, fecha_vencimiento, estado)
      values ('alquiler', p_contrato_id, v_numero, 'Renta mensual', c.monto_renta, v_fecha, 'pendiente');
    end if;
    v_numero := v_numero + 1;
    v_fecha := (v_fecha + interval '1 month')::date;
  end loop;
end;
$$;

-- Trigger: al crear un contrato de alquiler vigente, marcar la seccion como
-- 'alquilado' y generar el cronograma de cuotas automaticamente.
create or replace function trg_fn_contrato_alquiler_creado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'vigente' then
    update secciones set estado = 'alquilado' where id = new.seccion_id;
    perform generar_cuotas_alquiler(new.id);
  end if;
  return new;
end;
$$;

create trigger trg_contrato_alquiler_creado
  after insert on contratos_alquiler
  for each row execute function trg_fn_contrato_alquiler_creado();

-- Trigger equivalente para venta: marca la seccion como 'vendido' si la venta
-- queda 'completado', o 'reservado' si el contrato nace 'vigente' (separacion/cuotas).
create or replace function trg_fn_contrato_venta_creado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'completado' then
    update secciones set estado = 'vendido' where id = new.seccion_id;
  elsif new.estado = 'vigente' then
    update secciones set estado = 'reservado' where id = new.seccion_id;
  end if;
  return new;
end;
$$;

create trigger trg_contrato_venta_creado
  after insert on contratos_venta
  for each row execute function trg_fn_contrato_venta_creado();

-- ============================================================================
-- FIN schema.sql
-- ============================================================================
