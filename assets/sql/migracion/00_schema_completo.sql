-- ============================================================================
-- 00_schema_completo.sql
-- Esquema COMPLETO reconstruido (tablas, funciones, triggers, RLS) para el
-- proyecto Gestión Inmobiliaria, listo para correr en un proyecto Supabase
-- NUEVO (vacío), de arriba a abajo, en el SQL Editor.
--
-- Generado concatenando las migraciones aplicadas en orden en el proyecto
-- original (01 a 24 + dev-open-access), EXCLUYENDO:
--   - 03_seed.sql (datos de ejemplo — se reemplaza por 99_datos_actuales.sql
--     con los datos REALES actuales, exportados del proyecto original)
--   - 21a / 21b / 22 / 25 (scripts de un solo uso: diagnósticos o
--     correcciones puntuales de datos que ya quedaron reflejados en los
--     datos reales exportados — no son parte del esquema)
--
-- Orden de ejecución:
--   1) Este archivo (00_schema_completo.sql)
--   2) 99_datos_actuales.sql (los datos reales)
--
-- NOTA sobre Storage: el bucket 'inmuebles' (fotos/documentos) se crea en la
-- sección final de este archivo, pero los ARCHIVOS que contiene (fotos,
-- PDFs, comprobantes) NO viajan por SQL — hay que subirlos aparte desde el
-- Dashboard de Storage o con la CLI de Supabase. Ver aviso al final.
-- ============================================================================



-- ============================================================================
-- ARCHIVO ORIGINAL: 01_schema.sql
-- ============================================================================
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


-- ============================================================================
-- ARCHIVO ORIGINAL: 02_rls-policies.sql
-- ============================================================================
-- ============================================================================
-- SISTEMA DE GESTION INMOBILIARIA — ROW LEVEL SECURITY (Fase 1)
-- Ejecutar DESPUES de schema.sql y ANTES de seed.sql
-- Roles de la app: administrador (Luis, acceso total) / operador (lectura
-- general + lectura-escritura en Cobranzas, Pagos y modulo Calculo de
-- Servicios, sin poder borrar contratos ni propiedades — segun SPECS-SISTEMA
-- -INMUEBLES.md seccion 12 "Usuarios y Roles").
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Activar RLS en todas las tablas de negocio
-- ---------------------------------------------------------------------------
alter table empresas enable row level security;
alter table usuarios_roles enable row level security;
alter table personas enable row level security;
alter table personas_roles enable row level security;
alter table catalogos enable row level security;
alter table tipos_servicio enable row level security;
alter table propiedades enable row level security;
alter table propiedades_fotos enable row level security;
alter table propiedades_documentos enable row level security;
alter table secciones enable row level security;
alter table secciones_fotos enable row level security;
alter table historial_precios enable row level security;
alter table comisiones_agentes enable row level security;
alter table contratos_alquiler enable row level security;
alter table contratos_venta enable row level security;
alter table oportunidades_venta enable row level security;
alter table cuotas enable row level security;
alter table pagos enable row level security;
alter table medidores enable row level security;
alter table lecturas_medidores enable row level security;
alter table recibos_generales_servicio enable row level security;
alter table calculo_servicios_periodo enable row level security;
alter table calculo_servicios_detalle enable row level security;
alter table incidencias_mantenimiento enable row level security;
alter table notificaciones enable row level security;
alter table configuracion enable row level security;

-- ---------------------------------------------------------------------------
-- USUARIOS_ROLES
-- Cada usuario ve su propio rol; solo administrador ve/gestiona todos.
-- ---------------------------------------------------------------------------
create policy usuarios_roles_self_select on usuarios_roles
  for select using (usuario_id = auth.uid() or auth_rol() = 'administrador');
create policy usuarios_roles_admin_all on usuarios_roles
  for all using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');

-- ---------------------------------------------------------------------------
-- Tablas de SOLO LECTURA para operador / ALL para administrador
-- (empresas, personas, personas_roles, catalogos, tipos_servicio,
--  propiedades + anexos, secciones + anexos, historial_precios,
--  comisiones_agentes, contratos_alquiler, contratos_venta,
--  oportunidades_venta, configuracion)
-- ---------------------------------------------------------------------------

create policy empresas_read on empresas
  for select using (auth_rol() in ('administrador','operador'));
create policy empresas_admin_write on empresas
  for insert with check (auth_rol() = 'administrador');
create policy empresas_admin_update on empresas
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy empresas_admin_delete on empresas
  for delete using (auth_rol() = 'administrador');

create policy personas_read on personas
  for select using (auth_rol() in ('administrador','operador'));
create policy personas_admin_write on personas
  for insert with check (auth_rol() = 'administrador');
create policy personas_admin_update on personas
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy personas_admin_delete on personas
  for delete using (auth_rol() = 'administrador');

create policy personas_roles_read on personas_roles
  for select using (auth_rol() in ('administrador','operador'));
create policy personas_roles_admin_write on personas_roles
  for insert with check (auth_rol() = 'administrador');
create policy personas_roles_admin_delete on personas_roles
  for delete using (auth_rol() = 'administrador');

create policy catalogos_read on catalogos
  for select using (auth_rol() in ('administrador','operador'));
create policy catalogos_admin_write on catalogos
  for insert with check (auth_rol() = 'administrador');
create policy catalogos_admin_update on catalogos
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy catalogos_admin_delete on catalogos
  for delete using (auth_rol() = 'administrador');

create policy tipos_servicio_read on tipos_servicio
  for select using (auth_rol() in ('administrador','operador'));
create policy tipos_servicio_admin_write on tipos_servicio
  for insert with check (auth_rol() = 'administrador');
create policy tipos_servicio_admin_update on tipos_servicio
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy tipos_servicio_admin_delete on tipos_servicio
  for delete using (auth_rol() = 'administrador');

create policy propiedades_read on propiedades
  for select using (auth_rol() in ('administrador','operador'));
create policy propiedades_admin_write on propiedades
  for insert with check (auth_rol() = 'administrador');
create policy propiedades_admin_update on propiedades
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy propiedades_admin_delete on propiedades
  for delete using (auth_rol() = 'administrador');

create policy propiedades_fotos_read on propiedades_fotos
  for select using (auth_rol() in ('administrador','operador'));
create policy propiedades_fotos_admin_write on propiedades_fotos
  for insert with check (auth_rol() = 'administrador');
create policy propiedades_fotos_admin_delete on propiedades_fotos
  for delete using (auth_rol() = 'administrador');

create policy propiedades_documentos_read on propiedades_documentos
  for select using (auth_rol() in ('administrador','operador'));
create policy propiedades_documentos_admin_write on propiedades_documentos
  for insert with check (auth_rol() = 'administrador');
create policy propiedades_documentos_admin_delete on propiedades_documentos
  for delete using (auth_rol() = 'administrador');

create policy secciones_read on secciones
  for select using (auth_rol() in ('administrador','operador'));
create policy secciones_admin_write on secciones
  for insert with check (auth_rol() = 'administrador');
create policy secciones_admin_update on secciones
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy secciones_admin_delete on secciones
  for delete using (auth_rol() = 'administrador');

create policy secciones_fotos_read on secciones_fotos
  for select using (auth_rol() in ('administrador','operador'));
create policy secciones_fotos_admin_write on secciones_fotos
  for insert with check (auth_rol() = 'administrador');
create policy secciones_fotos_admin_delete on secciones_fotos
  for delete using (auth_rol() = 'administrador');

create policy historial_precios_read on historial_precios
  for select using (auth_rol() in ('administrador','operador'));
create policy historial_precios_admin_write on historial_precios
  for insert with check (auth_rol() = 'administrador');

create policy comisiones_agentes_read on comisiones_agentes
  for select using (auth_rol() in ('administrador','operador'));
create policy comisiones_agentes_admin_write on comisiones_agentes
  for insert with check (auth_rol() = 'administrador');
create policy comisiones_agentes_admin_update on comisiones_agentes
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy comisiones_agentes_admin_delete on comisiones_agentes
  for delete using (auth_rol() = 'administrador');

create policy contratos_alquiler_read on contratos_alquiler
  for select using (auth_rol() in ('administrador','operador'));
create policy contratos_alquiler_admin_write on contratos_alquiler
  for insert with check (auth_rol() = 'administrador');
create policy contratos_alquiler_admin_update on contratos_alquiler
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy contratos_alquiler_admin_delete on contratos_alquiler
  for delete using (auth_rol() = 'administrador');

create policy contratos_venta_read on contratos_venta
  for select using (auth_rol() in ('administrador','operador'));
create policy contratos_venta_admin_write on contratos_venta
  for insert with check (auth_rol() = 'administrador');
create policy contratos_venta_admin_update on contratos_venta
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy contratos_venta_admin_delete on contratos_venta
  for delete using (auth_rol() = 'administrador');

create policy oportunidades_venta_read on oportunidades_venta
  for select using (auth_rol() in ('administrador','operador'));
create policy oportunidades_venta_write on oportunidades_venta
  for insert with check (auth_rol() in ('administrador','operador'));
create policy oportunidades_venta_update on oportunidades_venta
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy oportunidades_venta_admin_delete on oportunidades_venta
  for delete using (auth_rol() = 'administrador');

create policy configuracion_read on configuracion
  for select using (auth_rol() in ('administrador','operador'));
create policy configuracion_admin_write on configuracion
  for insert with check (auth_rol() = 'administrador');
create policy configuracion_admin_update on configuracion
  for update using (auth_rol() = 'administrador') with check (auth_rol() = 'administrador');
create policy configuracion_admin_delete on configuracion
  for delete using (auth_rol() = 'administrador');

-- ---------------------------------------------------------------------------
-- COBRANZAS Y PAGOS — operador tiene lectura/escritura (sin delete);
-- administrador acceso total. Incluye el tab "Servicios" (cuotas.origen =
-- 'servicio'), que usa esta misma tabla.
-- ---------------------------------------------------------------------------
create policy cuotas_read on cuotas
  for select using (auth_rol() in ('administrador','operador'));
create policy cuotas_write on cuotas
  for insert with check (auth_rol() in ('administrador','operador'));
create policy cuotas_update on cuotas
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy cuotas_admin_delete on cuotas
  for delete using (auth_rol() = 'administrador');

create policy pagos_read on pagos
  for select using (auth_rol() in ('administrador','operador'));
create policy pagos_write on pagos
  for insert with check (auth_rol() in ('administrador','operador'));
create policy pagos_update on pagos
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy pagos_admin_delete on pagos
  for delete using (auth_rol() = 'administrador');

-- ---------------------------------------------------------------------------
-- MODULO CALCULO DE SERVICIOS — mismo criterio que Cobranzas/Pagos: el
-- operador toma lecturas, sube fotos y corre el calculo; solo admin borra.
-- ---------------------------------------------------------------------------
create policy medidores_read on medidores
  for select using (auth_rol() in ('administrador','operador'));
create policy medidores_write on medidores
  for insert with check (auth_rol() in ('administrador','operador'));
create policy medidores_update on medidores
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy medidores_admin_delete on medidores
  for delete using (auth_rol() = 'administrador');

create policy lecturas_medidores_read on lecturas_medidores
  for select using (auth_rol() in ('administrador','operador'));
create policy lecturas_medidores_write on lecturas_medidores
  for insert with check (auth_rol() in ('administrador','operador'));
create policy lecturas_medidores_update on lecturas_medidores
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy lecturas_medidores_admin_delete on lecturas_medidores
  for delete using (auth_rol() = 'administrador');

create policy recibos_generales_read on recibos_generales_servicio
  for select using (auth_rol() in ('administrador','operador'));
create policy recibos_generales_write on recibos_generales_servicio
  for insert with check (auth_rol() in ('administrador','operador'));
create policy recibos_generales_update on recibos_generales_servicio
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy recibos_generales_admin_delete on recibos_generales_servicio
  for delete using (auth_rol() = 'administrador');

create policy calculo_periodo_read on calculo_servicios_periodo
  for select using (auth_rol() in ('administrador','operador'));
create policy calculo_periodo_write on calculo_servicios_periodo
  for insert with check (auth_rol() in ('administrador','operador'));
create policy calculo_periodo_update on calculo_servicios_periodo
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy calculo_periodo_admin_delete on calculo_servicios_periodo
  for delete using (auth_rol() = 'administrador');

create policy calculo_detalle_read on calculo_servicios_detalle
  for select using (auth_rol() in ('administrador','operador'));
create policy calculo_detalle_write on calculo_servicios_detalle
  for insert with check (auth_rol() in ('administrador','operador'));
create policy calculo_detalle_update on calculo_servicios_detalle
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy calculo_detalle_admin_delete on calculo_servicios_detalle
  for delete using (auth_rol() = 'administrador');

-- ---------------------------------------------------------------------------
-- MANTENIMIENTO — operador puede crear/actualizar incidencias, no borrar.
-- ---------------------------------------------------------------------------
create policy incidencias_read on incidencias_mantenimiento
  for select using (auth_rol() in ('administrador','operador'));
create policy incidencias_write on incidencias_mantenimiento
  for insert with check (auth_rol() in ('administrador','operador'));
create policy incidencias_update on incidencias_mantenimiento
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy incidencias_admin_delete on incidencias_mantenimiento
  for delete using (auth_rol() = 'administrador');

-- ---------------------------------------------------------------------------
-- NOTIFICACIONES — cada usuario ve/marca-leido las suyas; administrador todo.
-- ---------------------------------------------------------------------------
create policy notificaciones_self_read on notificaciones
  for select using (usuario_id = auth.uid() or auth_rol() = 'administrador');
create policy notificaciones_self_update on notificaciones
  for update using (usuario_id = auth.uid() or auth_rol() = 'administrador')
  with check (usuario_id = auth.uid() or auth_rol() = 'administrador');
create policy notificaciones_system_insert on notificaciones
  for insert with check (auth_rol() in ('administrador','operador'));
create policy notificaciones_admin_delete on notificaciones
  for delete using (auth_rol() = 'administrador');

-- ============================================================================
-- STORAGE (Supabase Storage) — ejemplo de politicas para el bucket "inmuebles"
-- Crear el bucket manualmente en el dashboard (privado, no publico) y luego
-- aplicar estas politicas sobre storage.objects filtrando por bucket_id.
-- Estructura de carpetas sugerida dentro del bucket:
--   propiedades/{propiedad_id}/...
--   secciones/{seccion_id}/...
--   medidores/{medidor_id}/lecturas/...
--   pagos/{pago_id}/comprobantes/...
-- ============================================================================
create policy storage_inmuebles_read on storage.objects
  for select using (
    bucket_id = 'inmuebles' and auth_rol() in ('administrador','operador')
  );
create policy storage_inmuebles_insert on storage.objects
  for insert with check (
    bucket_id = 'inmuebles' and auth_rol() in ('administrador','operador')
  );
create policy storage_inmuebles_update on storage.objects
  for update using (
    bucket_id = 'inmuebles' and auth_rol() in ('administrador','operador')
  );
create policy storage_inmuebles_delete on storage.objects
  for delete using (
    bucket_id = 'inmuebles' and auth_rol() = 'administrador'
  );

-- ============================================================================
-- FIN rls-policies.sql
-- ============================================================================


-- ============================================================================
-- ARCHIVO ORIGINAL: 04_migrations-fase2-fase3.sql
-- ============================================================================
-- ============================================================================
-- SISTEMA DE GESTION INMOBILIARIA — MIGRACION FASE 2 + FASE 3
-- Ejecutar UNA VEZ, DESPUES de schema.sql + rls-policies.sql + seed.sql
-- (y despues de dev-open-access.sql si lo estas usando).
-- No modifica datos existentes; solo agrega funciones, triggers y una
-- columna nueva.
-- ============================================================================

-- ============================================================================
-- 1. Columna de conveniencia: que contrato de alquiler estaba vigente en la
--    seccion al momento de calcular un periodo de servicio (evita tener que
--    reconstruir esa relacion por fecha cada vez que se muestra Cobranzas).
-- ============================================================================
alter table calculo_servicios_detalle
  add column if not exists contrato_alquiler_id uuid references contratos_alquiler(id);

-- ============================================================================
-- 2. FASE 2 — Generacion automatica de cuotas de VENTA en cuotas
--    (equivalente a generar_cuotas_alquiler, para contratos_venta con
--    forma_pago = 'cuotas'). Reparte precio_pactado en n_cuotas cuotas
--    mensuales iguales, ajustando la ultima por redondeo.
-- ============================================================================
create or replace function generar_cuotas_venta(p_contrato_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_monto_cuota numeric(12,2);
  v_suma numeric(12,2) := 0;
  v_fecha date;
  v_i int;
begin
  select * into c from contratos_venta where id = p_contrato_id;
  if not found then
    raise exception 'Contrato de venta % no existe', p_contrato_id;
  end if;
  if c.forma_pago <> 'cuotas' or c.n_cuotas is null or c.n_cuotas < 1 then
    return; -- nada que generar (contado / credito_hipotecario / sin n_cuotas)
  end if;
  if exists (select 1 from cuotas where origen = 'venta' and contrato_id = p_contrato_id) then
    return; -- ya se generaron antes (evita duplicar en updates repetidos)
  end if;

  v_monto_cuota := round(c.precio_pactado / c.n_cuotas, 2);

  for v_i in 1..c.n_cuotas loop
    v_fecha := (date_trunc('month', c.fecha_firma) + (v_i || ' months')::interval)::date
               + (extract(day from c.fecha_firma)::int - 1) * interval '1 day';
    -- si el dia no existe en ese mes (ej. 31), date_trunc+interval ya lo corrige al mes correcto
    if v_i = c.n_cuotas then
      -- ultima cuota: ajusta por el redondeo acumulado para que la suma cuadre exacto
      insert into cuotas (origen, contrato_id, numero_cuota, concepto, monto, fecha_vencimiento, estado)
      values ('venta', p_contrato_id, v_i, 'Cuota de venta ' || v_i || '/' || c.n_cuotas,
              c.precio_pactado - v_suma, v_fecha, 'pendiente');
    else
      insert into cuotas (origen, contrato_id, numero_cuota, concepto, monto, fecha_vencimiento, estado)
      values ('venta', p_contrato_id, v_i, 'Cuota de venta ' || v_i || '/' || c.n_cuotas,
              v_monto_cuota, v_fecha, 'pendiente');
      v_suma := v_suma + v_monto_cuota;
    end if;
  end loop;
end;
$$;

-- ============================================================================
-- 3. Trigger de contratos_venta ampliado: ahora reacciona tambien a UPDATE de
--    estado (antes solo INSERT), para que cambiar el estado desde la UI
--    (ej. marcar "completado") actualice la seccion correctamente. Tambien
--    dispara la generacion de cuotas cuando forma_pago = 'cuotas'.
-- ============================================================================
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
    perform generar_cuotas_venta(new.id);
  elsif new.estado = 'anulado' then
    update secciones set estado = 'disponible' where id = new.seccion_id and estado in ('reservado');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contrato_venta_creado on contratos_venta;
create trigger trg_contrato_venta_creado
  after insert or update of estado on contratos_venta
  for each row execute function trg_fn_contrato_venta_creado();

-- ============================================================================
-- 4. Trigger de contratos_alquiler ampliado: reacciona tambien a UPDATE de
--    estado, para que "finalizado" libere la seccion (vuelve a 'disponible').
-- ============================================================================
create or replace function trg_fn_contrato_alquiler_creado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado in ('vigente', 'por_vencer') then
    update secciones set estado = 'alquilado' where id = new.seccion_id;
    perform generar_cuotas_alquiler(new.id);
  elsif new.estado = 'finalizado' then
    update secciones set estado = 'disponible' where id = new.seccion_id and estado = 'alquilado';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contrato_alquiler_creado on contratos_alquiler;
create trigger trg_contrato_alquiler_creado
  after insert or update of estado on contratos_alquiler
  for each row execute function trg_fn_contrato_alquiler_creado();

-- ============================================================================
-- 5. FASE 3 — Recalculo automatico del estado de una cuota cuando se
--    registra, edita, anula o elimina un pago. Suma los pagos no anulados de
--    la cuota y decide pendiente / parcial / pagada. No toca 'vencida' salvo
--    que el pago la cubra por completo (pasa a 'pagada').
-- ============================================================================
create or replace function recalcular_estado_cuota(p_cuota_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_pagado numeric(12,2);
  v_total_debido numeric(12,2);
  v_estado_actual text;
  v_estado_nuevo text;
begin
  select coalesce(sum(monto), 0) into v_total_pagado
  from pagos where cuota_id = p_cuota_id and estado <> 'anulado';

  select (monto + mora_aplicada), estado into v_total_debido, v_estado_actual
  from cuotas where id = p_cuota_id;

  if v_estado_actual is null then
    return; -- la cuota ya no existe
  end if;
  if v_estado_actual = 'anulada' then
    return; -- estado manual, no se toca por pagos
  end if;

  if v_total_pagado <= 0 then
    v_estado_nuevo := case when v_estado_actual = 'vencida' then 'vencida' else 'pendiente' end;
  elsif v_total_pagado < v_total_debido then
    v_estado_nuevo := 'parcial';
  else
    v_estado_nuevo := 'pagada';
  end if;

  if v_estado_nuevo <> v_estado_actual then
    update cuotas set estado = v_estado_nuevo where id = p_cuota_id;
  end if;
end;
$$;

create or replace function trg_fn_pagos_recalcula_cuota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform recalcular_estado_cuota(old.cuota_id);
    return old;
  else
    perform recalcular_estado_cuota(new.cuota_id);
    return new;
  end if;
end;
$$;

drop trigger if exists trg_pagos_recalcula_cuota on pagos;
create trigger trg_pagos_recalcula_cuota
  after insert or update or delete on pagos
  for each row execute function trg_fn_pagos_recalcula_cuota();

-- ============================================================================
-- 6. FASE 3 — Aplicar mora a cuotas vencidas (segun configuracion.clave =
--    'mora': {tipo:'porcentaje'|'fijo', valor, dias_gracia}). Pensada para
--    llamarse manualmente desde un boton "Actualizar vencidas" en Cobranzas
--    (RPC), y opcionalmente via pg_cron diario si el usuario lo habilita
--    (Database -> Extensions -> pg_cron en el panel de Supabase; ver nota al
--    final de este archivo). Es idempotente: no vuelve a aplicar mora a una
--    cuota que ya la tiene.
-- ============================================================================
create or replace function aplicar_mora_cuotas_vencidas()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb;
  v_tipo text;
  v_valor numeric;
  v_dias_gracia int;
  v_actualizadas int;
begin
  select valor into v_config from configuracion where clave = 'mora';
  v_tipo := coalesce(v_config->>'tipo', 'porcentaje');
  v_valor := coalesce((v_config->>'valor')::numeric, 0);
  v_dias_gracia := coalesce((v_config->>'dias_gracia')::int, 0);

  with vencidas as (
    update cuotas
    set estado = 'vencida',
        mora_aplicada = case
          when v_tipo = 'porcentaje' then round(monto * v_valor / 100, 2)
          else v_valor
        end
    where estado = 'pendiente'
      and fecha_vencimiento < (current_date - v_dias_gracia)
      and mora_aplicada = 0
    returning id
  )
  select count(*) into v_actualizadas from vencidas;

  return v_actualizadas;
end;
$$;

-- ============================================================================
-- 7. FASE 3 — RPC principal del modulo "Calculo de Servicios": toma un
--    periodo (propiedad + tipo de servicio + 'YYYY-MM'), el recibo general
--    ya registrado, y el detalle por seccion (medidor o tarifa fija por
--    persona) calculado en el frontend con los datos ya cargados en pantalla,
--    y hace TODO el trabajo de negocio en el servidor en una sola
--    transaccion: crea el periodo, el detalle por seccion y la cuota de
--    cobranza (origen='servicio') correspondiente a cada seccion.
--
--    p_detalles: jsonb array de objetos:
--      { "seccion_id": uuid, "metodo": "medidor"|"tarifa_fija_por_persona",
--        "lectura_id": uuid|null, "consumo": numeric|null,
--        "n_personas": int|null, "tarifa_por_persona": numeric|null }
-- ============================================================================
create or replace function calcular_periodo_servicio(
  p_propiedad_id uuid,
  p_tipo_servicio_id uuid,
  p_periodo text,
  p_recibo_general_id uuid,
  p_detalles jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recibo record;
  v_tipo record;
  v_precio_unitario numeric(12,4);
  v_periodo_id uuid;
  v_periodo_date date;
  v_dias_en_mes int;
  v_dia int;
  v_fecha_venc date;
  v_item jsonb;
  v_monto numeric(12,2);
  v_contrato_id uuid;
  v_detalle_id uuid;
  v_cuota_id uuid;
begin
  if auth_rol() not in ('administrador', 'operador') then
    raise exception 'No autorizado para calcular servicios';
  end if;

  if exists (
    select 1 from calculo_servicios_periodo
    where propiedad_id = p_propiedad_id and tipo_servicio_id = p_tipo_servicio_id and periodo = p_periodo
  ) then
    raise exception 'Ya existe un calculo confirmado para esta propiedad, servicio y periodo.';
  end if;

  select * into v_recibo from recibos_generales_servicio where id = p_recibo_general_id;
  if not found then
    raise exception 'Recibo general % no existe', p_recibo_general_id;
  end if;
  select * into v_tipo from tipos_servicio where id = p_tipo_servicio_id;

  v_precio_unitario := coalesce(v_recibo.precio_unitario,
    case when coalesce(v_recibo.consumo_total_recibo, 0) > 0
      then round(v_recibo.monto_total_recibo / v_recibo.consumo_total_recibo, 4)
      else null end);

  v_periodo_date := to_date(p_periodo || '-01', 'YYYY-MM-DD');
  v_dias_en_mes := extract(day from (date_trunc('month', v_periodo_date) + interval '1 month - 1 day'))::int;
  v_dia := least(coalesce(v_tipo.dia_corte_mensual, 15), v_dias_en_mes);
  v_fecha_venc := date_trunc('month', v_periodo_date)::date + (v_dia - 1);

  insert into calculo_servicios_periodo
    (propiedad_id, tipo_servicio_id, periodo, recibo_general_id, precio_unitario_aplicado, generado_por, estado)
  values
    (p_propiedad_id, p_tipo_servicio_id, p_periodo, p_recibo_general_id, v_precio_unitario, auth.uid(), 'confirmado')
  returning id into v_periodo_id;

  for v_item in select * from jsonb_array_elements(p_detalles)
  loop
    if (v_item->>'metodo') = 'medidor' then
      v_monto := round(coalesce((v_item->>'consumo')::numeric, 0) * coalesce(v_precio_unitario, 0), 2);
    else
      v_monto := round(coalesce((v_item->>'n_personas')::numeric, 0) * coalesce((v_item->>'tarifa_por_persona')::numeric, 0), 2);
    end if;

    select id into v_contrato_id from contratos_alquiler
    where seccion_id = (v_item->>'seccion_id')::uuid and estado in ('vigente', 'por_vencer')
    order by fecha_inicio desc limit 1;

    insert into calculo_servicios_detalle
      (calculo_periodo_id, seccion_id, metodo, lectura_id, consumo, precio_unitario_aplicado,
       n_personas, tarifa_por_persona, monto_calculado, contrato_alquiler_id)
    values
      (v_periodo_id, (v_item->>'seccion_id')::uuid, v_item->>'metodo',
       nullif(v_item->>'lectura_id', '')::uuid, (v_item->>'consumo')::numeric, v_precio_unitario,
       (v_item->>'n_personas')::int, (v_item->>'tarifa_por_persona')::numeric, v_monto, v_contrato_id)
    returning id into v_detalle_id;

    insert into cuotas (origen, contrato_id, calculo_servicio_detalle_id, concepto, monto, fecha_vencimiento, estado)
    values ('servicio', null, v_detalle_id, coalesce(v_tipo.nombre, 'Servicio') || ' ' || p_periodo,
            v_monto, v_fecha_venc, 'pendiente')
    returning id into v_cuota_id;

    update calculo_servicios_detalle set cuota_id = v_cuota_id where id = v_detalle_id;
  end loop;

  return v_periodo_id;
end;
$$;

-- ============================================================================
-- NOTA sobre automatizacion diaria de mora (opcional):
-- Supabase permite habilitar la extension "pg_cron" (Database -> Extensions)
-- y luego programar, por ejemplo:
--   select cron.schedule('aplicar-mora-diario', '0 6 * * *', $$select aplicar_mora_cuotas_vencidas();$$);
-- Mientras no se habilite, el boton "Actualizar vencidas" de Cobranzas llama
-- a la misma funcion manualmente via RPC — funciona igual, solo que no es
-- automatico dia a dia.
-- ============================================================================

-- ============================================================================
-- FIN migrations-fase2-fase3.sql
-- ============================================================================


-- ============================================================================
-- ARCHIVO ORIGINAL: 05_migrations-rol-aval.sql
-- ============================================================================
-- ============================================================================
-- MIGRACION: rol "aval" en personas + campo opcional de aval en contratos.
-- Ejecutar UNA VEZ, en cualquier momento despues de schema.sql (no depende
-- de migrations-fase2-fase3.sql, pero no hace daño correrla despues).
-- ============================================================================

-- 1. Permitir el rol 'aval' en personas_roles (antes solo: comprador,
--    inquilino, propietario, lead, agente, proveedor).
alter table personas_roles drop constraint if exists personas_roles_rol_check;
alter table personas_roles add constraint personas_roles_rol_check
  check (rol in ('comprador','inquilino','propietario','lead','agente','proveedor','aval'));

-- 2. Columna opcional aval_id en contratos de alquiler y de venta. Un aval es
--    una persona (normalmente con rol 'aval', aunque no se obliga a nivel de
--    base de datos) que respalda al inquilino/comprador del contrato.
alter table contratos_alquiler
  add column if not exists aval_id uuid references personas(id);
alter table contratos_venta
  add column if not exists aval_id uuid references personas(id);

-- ============================================================================
-- FIN migrations-rol-aval.sql
-- ============================================================================


-- ============================================================================
-- ARCHIVO ORIGINAL: 06_migrations-distritos-lima.sql
-- ============================================================================
-- ============================================================================
-- MIGRACION: catálogo completo de los 43 distritos de Lima Metropolitana.
-- Antes solo estaban sembrados "San Juan de Lurigancho" y "Ate" (los que
-- ya usan las 3 propiedades reales). Esta lista es la división político-
-- administrativa oficial de la provincia de Lima (INEI) — no depende de
-- ninguna librería externa, se mantiene como datos propios del sistema
-- para no añadir dependencias a un stack sin build step.
--
-- Ejecutar UNA VEZ, en cualquier momento. Usa ON CONFLICT DO NOTHING, así
-- que es seguro correrla aunque ya existan algunos distritos cargados.
-- ============================================================================

insert into catalogos (tipo, valor, orden) values
  ('distrito','Ancón',1),
  ('distrito','Ate',2),
  ('distrito','Barranco',3),
  ('distrito','Breña',4),
  ('distrito','Carabayllo',5),
  ('distrito','Chaclacayo',6),
  ('distrito','Chorrillos',7),
  ('distrito','Cieneguilla',8),
  ('distrito','Comas',9),
  ('distrito','El Agustino',10),
  ('distrito','Independencia',11),
  ('distrito','Jesús María',12),
  ('distrito','La Molina',13),
  ('distrito','La Victoria',14),
  ('distrito','Lima (Cercado)',15),
  ('distrito','Lince',16),
  ('distrito','Los Olivos',17),
  ('distrito','Lurigancho (Chosica)',18),
  ('distrito','Lurín',19),
  ('distrito','Magdalena del Mar',20),
  ('distrito','Miraflores',21),
  ('distrito','Pachacámac',22),
  ('distrito','Pucusana',23),
  ('distrito','Pueblo Libre',24),
  ('distrito','Puente Piedra',25),
  ('distrito','Punta Hermosa',26),
  ('distrito','Punta Negra',27),
  ('distrito','Rímac',28),
  ('distrito','San Bartolo',29),
  ('distrito','San Borja',30),
  ('distrito','San Isidro',31),
  ('distrito','San Juan de Lurigancho',32),
  ('distrito','San Juan de Miraflores',33),
  ('distrito','San Luis',34),
  ('distrito','San Martín de Porres',35),
  ('distrito','San Miguel',36),
  ('distrito','Santa Anita',37),
  ('distrito','Santa María del Mar',38),
  ('distrito','Santa Rosa',39),
  ('distrito','Santiago de Surco',40),
  ('distrito','Surquillo',41),
  ('distrito','Villa El Salvador',42),
  ('distrito','Villa María del Triunfo',43)
on conflict (tipo, valor) do nothing;

-- ============================================================================
-- FIN migrations-distritos-lima.sql
-- ============================================================================


-- ============================================================================
-- ARCHIVO ORIGINAL: 07_migrations-gastos-oportunidades-docs.sql
-- ============================================================================
-- ============================================================================
-- MIGRACION: Oportunidades (renombrado + venta/alquiler), Mantenimientos,
-- Tributos municipales, y datos de registro por sección (partida/PU-HR).
-- Ejecutar UNA VEZ, en cualquier momento después de schema.sql +
-- rls-policies.sql. No borra datos existentes.
-- ============================================================================

-- ============================================================================
-- 1. SECCIONES: cada piso/local puede tener su propio registro (partida
--    registral independizada) o, si no está independizado, solo el código
--    PU/HR que entrega la municipalidad. Ambos opcionales — la propiedad ya
--    tiene su propio partida_registral para el caso de terreno único
--    (ej. los locales de Av. Santa Rosa de Lima, que no están independizados).
-- ============================================================================
alter table secciones add column if not exists partida_registral text;
alter table secciones add column if not exists codigo_pu_hr text;

-- ============================================================================
-- 2. OPORTUNIDADES: renombrar oportunidades_venta -> oportunidades y hacerla
--    servir tanto para pipeline de venta como de alquiler (mismo embudo:
--    prospecto -> visita_agendada -> negociacion -> separacion ->
--    firma_contrato -> cerrado / perdido). Las politicas RLS existentes
--    siguen aplicando igual tras el rename (Postgres las asocia a la tabla
--    por OID, no por nombre).
-- ============================================================================
alter table if exists oportunidades_venta rename to oportunidades;

alter table oportunidades add column if not exists tipo_operacion text
  not null default 'venta' check (tipo_operacion in ('venta','alquiler'));
alter table oportunidades add column if not exists contrato_venta_id uuid
  references contratos_venta(id);
alter table oportunidades add column if not exists contrato_alquiler_id uuid
  references contratos_alquiler(id);

-- ============================================================================
-- 3. MANTENIMIENTOS: inversiones de mantenimiento (materiales + mano de
--    obra) a nivel de propiedad o, si aplica solo a una sección, a nivel de
--    sección. Los comprobantes (facturas/boletas) van en tabla aparte porque
--    puede haber varios por mantenimiento.
-- ============================================================================
create table mantenimientos (
  id uuid primary key default gen_random_uuid(),
  propiedad_id uuid not null references propiedades(id),
  seccion_id uuid references secciones(id),
  tipo text,                                            -- referencia catalogos tipo='tipo_mantenimiento'
  descripcion text not null,
  proveedor_id uuid references personas(id),            -- persona con rol 'proveedor', opcional
  fecha date not null default current_date,
  costo_materiales numeric(12,2) not null default 0,
  costo_mano_obra numeric(12,2) not null default 0,
  costo_total numeric(12,2) generated always as (costo_materiales + costo_mano_obra) stored,
  estado text not null default 'finalizado' check (estado in ('planificado','en_proceso','finalizado')),
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_mantenimientos_updated before update on mantenimientos
  for each row execute function set_updated_at();
create index idx_mantenimientos_propiedad on mantenimientos(propiedad_id);
create index idx_mantenimientos_seccion on mantenimientos(seccion_id);
create index idx_mantenimientos_fecha on mantenimientos(fecha);

create table mantenimientos_comprobantes (
  id uuid primary key default gen_random_uuid(),
  mantenimiento_id uuid not null references mantenimientos(id) on delete cascade,
  tipo_comprobante text not null default 'boleta' check (tipo_comprobante in ('factura','boleta','otro')),
  url_storage text not null,
  descripcion text,
  monto numeric(12,2),
  created_at timestamptz not null default now()
);
create index idx_mant_comprobantes_mantenimiento on mantenimientos_comprobantes(mantenimiento_id);

-- ============================================================================
-- 4. TRIBUTOS MUNICIPALES: arbitrios, predial y similares. seccion_id
--    opcional: si el piso/local está independizado (tiene su propia partida
--    o código PU/HR en secciones), el tributo se ancla ahí; si no está
--    independizado (ej. terreno único de Av. Santa Rosa de Lima, o un piso
--    de Ate/Polonia que aún no se independizó), se ancla solo a la
--    propiedad con seccion_id en null.
-- ============================================================================
create table tributos_municipales (
  id uuid primary key default gen_random_uuid(),
  propiedad_id uuid not null references propiedades(id),
  seccion_id uuid references secciones(id),
  tipo text not null,                                   -- referencia catalogos tipo='tipo_tributo'
  periodo text not null,                                 -- 'YYYY' o 'YYYY-T1' segun emita la municipalidad
  monto numeric(12,2) not null,
  fecha_vencimiento date,
  estado_pago text not null default 'pendiente' check (estado_pago in ('pendiente','pagado')),
  fecha_pago date,
  comprobante_estado_cuenta_url text,                    -- el estado de cuenta que entrega la municipalidad
  comprobante_pago_url text,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_tributos_municipales_updated before update on tributos_municipales
  for each row execute function set_updated_at();
create index idx_tributos_propiedad on tributos_municipales(propiedad_id);
create index idx_tributos_seccion on tributos_municipales(seccion_id);
create index idx_tributos_periodo on tributos_municipales(periodo);

-- ============================================================================
-- 5. RLS: mismo nivel que Cobranzas/Servicios — operador lee y escribe (sin
--    poder borrar), administrador acceso total.
-- ============================================================================
alter table mantenimientos enable row level security;
alter table mantenimientos_comprobantes enable row level security;
alter table tributos_municipales enable row level security;

create policy mantenimientos_read on mantenimientos
  for select using (auth_rol() in ('administrador','operador'));
create policy mantenimientos_write on mantenimientos
  for insert with check (auth_rol() in ('administrador','operador'));
create policy mantenimientos_update on mantenimientos
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy mantenimientos_admin_delete on mantenimientos
  for delete using (auth_rol() = 'administrador');

create policy mant_comprobantes_read on mantenimientos_comprobantes
  for select using (auth_rol() in ('administrador','operador'));
create policy mant_comprobantes_write on mantenimientos_comprobantes
  for insert with check (auth_rol() in ('administrador','operador'));
create policy mant_comprobantes_update on mantenimientos_comprobantes
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy mant_comprobantes_admin_delete on mantenimientos_comprobantes
  for delete using (auth_rol() = 'administrador');

create policy tributos_read on tributos_municipales
  for select using (auth_rol() in ('administrador','operador'));
create policy tributos_write on tributos_municipales
  for insert with check (auth_rol() in ('administrador','operador'));
create policy tributos_update on tributos_municipales
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy tributos_admin_delete on tributos_municipales
  for delete using (auth_rol() = 'administrador');

-- ============================================================================
-- 6. Catálogos: tipos de mantenimiento y de tributo (editables luego desde
--    Configuración, fase 5; por ahora se administran igual que los demás
--    catálogos vía SQL o la tabla catalogos).
-- ============================================================================
insert into catalogos (tipo, valor, orden) values
  ('tipo_mantenimiento','Tanque elevado',1),
  ('tipo_mantenimiento','Gasfitería',2),
  ('tipo_mantenimiento','Eléctrico',3),
  ('tipo_mantenimiento','Pintura',4),
  ('tipo_mantenimiento','Ascensor',5),
  ('tipo_mantenimiento','Techos / impermeabilización',6),
  ('tipo_mantenimiento','Estructural',7),
  ('tipo_mantenimiento','Otro',8),
  ('tipo_tributo','Impuesto predial',1),
  ('tipo_tributo','Arbitrios de limpieza pública',2),
  ('tipo_tributo','Arbitrios de parques y jardines',3),
  ('tipo_tributo','Arbitrios de serenazgo',4),
  ('tipo_tributo','Otro',5)
on conflict (tipo, valor) do nothing;

-- ============================================================================
-- FIN migrations-gastos-oportunidades-docs.sql
-- ============================================================================


-- ============================================================================
-- ARCHIVO ORIGINAL: 08_migrations-cuentas-servicio.sql
-- ============================================================================
-- ============================================================================
-- migrations-cuentas-servicio.sql
-- Soporta propiedades donde un mismo servicio (ej. agua) se factura por
-- VARIAS cuentas municipales independientes, cada una alimentando un
-- subconjunto de medidores (caso real: Lotes Av. Santa Rosa de Lima, Mz. S,
-- con 3 cuentas de agua "Lt14", "Lt15", "Lt7" repartidas entre 3 lavaderos).
--
-- Antes: un solo recibo_general_servicio por (propiedad, servicio, periodo).
-- Ahora: cada recibo puede pertenecer opcionalmente a una "cuenta de
-- servicio" (cuentas_servicio). Si una propiedad tiene una sola cuenta por
-- servicio (caso normal, ej. Edificio Polonia, Edificio Ámsterdam), se deja
-- todo sin cuenta (cuenta_servicio_id = null) y el sistema funciona igual
-- que antes — no requiere migrar datos existentes.
-- ============================================================================

create table cuentas_servicio (
  id uuid primary key default gen_random_uuid(),
  propiedad_id uuid not null references propiedades(id),
  tipo_servicio_id uuid not null references tipos_servicio(id),
  codigo text not null,                                    -- ej. "Lt14", "Lt15", "Lt7"
  nombre text,                                              -- ej. "Cuenta Sedapal Lt14" (opcional)
  activo boolean not null default true,
  notas text,
  created_at timestamptz not null default now(),
  unique (propiedad_id, tipo_servicio_id, codigo)
);
create index idx_cuentas_servicio_propiedad on cuentas_servicio(propiedad_id);

alter table medidores
  add column if not exists cuenta_servicio_id uuid references cuentas_servicio(id);
create index if not exists idx_medidores_cuenta on medidores(cuenta_servicio_id);

alter table recibos_generales_servicio
  add column if not exists cuenta_servicio_id uuid references cuentas_servicio(id);
create index if not exists idx_recibos_cuenta on recibos_generales_servicio(cuenta_servicio_id);

-- Reemplaza el unique(propiedad,servicio,periodo) — ahora permite varios
-- recibos por periodo siempre que sean de cuentas distintas (o una sola
-- si cuenta_servicio_id es null, como antes). Se busca el nombre real del
-- constraint en pg_constraint en vez de adivinarlo (Postgres trunca nombres
-- largos automaticamente).
do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'recibos_generales_servicio'::regclass
    and contype = 'u'
    and conkey = (
      select array_agg(attnum order by attnum) from pg_attribute
      where attrelid = 'recibos_generales_servicio'::regclass
        and attname in ('propiedad_id', 'tipo_servicio_id', 'periodo')
    );
  if v_name is not null then
    execute format('alter table recibos_generales_servicio drop constraint %I', v_name);
  end if;
end $$;

create unique index if not exists uq_recibos_generales_cuenta_periodo
  on recibos_generales_servicio (propiedad_id, tipo_servicio_id, periodo,
    coalesce(cuenta_servicio_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- calculo_servicios_periodo pasa a ser 1:1 con el recibo calculado (antes
-- era 1 por propiedad+servicio+periodo, lo que bloqueaba calcular varias
-- cuentas del mismo periodo).
do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'calculo_servicios_periodo'::regclass
    and contype = 'u'
    and conkey = (
      select array_agg(attnum order by attnum) from pg_attribute
      where attrelid = 'calculo_servicios_periodo'::regclass
        and attname in ('propiedad_id', 'tipo_servicio_id', 'periodo')
    );
  if v_name is not null then
    execute format('alter table calculo_servicios_periodo drop constraint %I', v_name);
  end if;
end $$;

alter table calculo_servicios_periodo
  add constraint uq_calculo_periodo_recibo unique (recibo_general_id);

alter table cuentas_servicio enable row level security;

create policy cuentas_servicio_read on cuentas_servicio
  for select using (auth_rol() in ('administrador','operador'));
create policy cuentas_servicio_write on cuentas_servicio
  for insert with check (auth_rol() in ('administrador','operador'));
create policy cuentas_servicio_update on cuentas_servicio
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy cuentas_servicio_admin_delete on cuentas_servicio
  for delete using (auth_rol() = 'administrador');

-- La funcion de calculo debe validar "ya calculado" por recibo, no por
-- propiedad+servicio+periodo (eso bloquearia calcular la 2da/3ra cuenta).
create or replace function calcular_periodo_servicio(
  p_propiedad_id uuid,
  p_tipo_servicio_id uuid,
  p_periodo text,
  p_recibo_general_id uuid,
  p_detalles jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recibo record;
  v_tipo record;
  v_precio_unitario numeric(12,4);
  v_periodo_id uuid;
  v_periodo_date date;
  v_dias_en_mes int;
  v_dia int;
  v_fecha_venc date;
  v_item jsonb;
  v_monto numeric(12,2);
  v_contrato_id uuid;
  v_detalle_id uuid;
  v_cuota_id uuid;
begin
  if auth_rol() not in ('administrador', 'operador') then
    raise exception 'No autorizado para calcular servicios';
  end if;

  if exists (
    select 1 from calculo_servicios_periodo where recibo_general_id = p_recibo_general_id
  ) then
    raise exception 'Ya existe un calculo confirmado para este recibo.';
  end if;

  select * into v_recibo from recibos_generales_servicio where id = p_recibo_general_id;
  if not found then
    raise exception 'Recibo general % no existe', p_recibo_general_id;
  end if;
  select * into v_tipo from tipos_servicio where id = p_tipo_servicio_id;

  v_precio_unitario := coalesce(v_recibo.precio_unitario,
    case when coalesce(v_recibo.consumo_total_recibo, 0) > 0
      then round(v_recibo.monto_total_recibo / v_recibo.consumo_total_recibo, 4)
      else null end);

  v_periodo_date := to_date(p_periodo || '-01', 'YYYY-MM-DD');
  v_dias_en_mes := extract(day from (date_trunc('month', v_periodo_date) + interval '1 month - 1 day'))::int;
  v_dia := least(coalesce(v_tipo.dia_corte_mensual, 15), v_dias_en_mes);
  v_fecha_venc := date_trunc('month', v_periodo_date)::date + (v_dia - 1);

  insert into calculo_servicios_periodo
    (propiedad_id, tipo_servicio_id, periodo, recibo_general_id, precio_unitario_aplicado, generado_por, estado)
  values
    (p_propiedad_id, p_tipo_servicio_id, p_periodo, p_recibo_general_id, v_precio_unitario, auth.uid(), 'confirmado')
  returning id into v_periodo_id;

  for v_item in select * from jsonb_array_elements(p_detalles)
  loop
    if (v_item->>'metodo') = 'medidor' then
      v_monto := round(coalesce((v_item->>'consumo')::numeric, 0) * coalesce(v_precio_unitario, 0), 2);
    else
      v_monto := round(coalesce((v_item->>'n_personas')::numeric, 0) * coalesce((v_item->>'tarifa_por_persona')::numeric, 0), 2);
    end if;

    select id into v_contrato_id from contratos_alquiler
    where seccion_id = (v_item->>'seccion_id')::uuid and estado in ('vigente', 'por_vencer')
    order by fecha_inicio desc limit 1;

    insert into calculo_servicios_detalle
      (calculo_periodo_id, seccion_id, metodo, lectura_id, consumo, precio_unitario_aplicado,
       n_personas, tarifa_por_persona, monto_calculado, contrato_alquiler_id)
    values
      (v_periodo_id, (v_item->>'seccion_id')::uuid, v_item->>'metodo',
       nullif(v_item->>'lectura_id', '')::uuid, (v_item->>'consumo')::numeric, v_precio_unitario,
       (v_item->>'n_personas')::int, (v_item->>'tarifa_por_persona')::numeric, v_monto, v_contrato_id)
    returning id into v_detalle_id;

    insert into cuotas (origen, contrato_id, calculo_servicio_detalle_id, concepto, monto, fecha_vencimiento, estado)
    values ('servicio', null, v_detalle_id, coalesce(v_tipo.nombre, 'Servicio') || ' ' || p_periodo,
            v_monto, v_fecha_venc, 'pendiente')
    returning id into v_cuota_id;

    update calculo_servicios_detalle set cuota_id = v_cuota_id where id = v_detalle_id;
  end loop;

  return v_periodo_id;
end;
$$;


-- ============================================================================
-- ARCHIVO ORIGINAL: 09_migrations-medidores-compartidos.sql
-- ============================================================================
-- ============================================================================
-- migrations-medidores-compartidos.sql
-- Soporta medidores compartidos por varias secciones (ej. un baño común
-- usado por 2 locales, que se dividen el consumo por porcentaje).
--
-- Antes: cada medidor (no general) pertenecía a UNA sola sección.
-- Ahora: un medidor puede marcarse "compartido" y repartirse entre 2+
-- secciones, cada una con su propio porcentaje (deben sumar 100%). Al
-- calcular el servicio, ese medidor genera una cuota por cada sección del
-- reparto, con el consumo del periodo multiplicado por su porcentaje.
-- No afecta medidores existentes — todos siguen con es_compartido = false.
-- ============================================================================

alter table medidores
  add column if not exists es_compartido boolean not null default false;

-- Reemplaza chk_medidor_dueno para permitir el 3er caso: compartido (sin
-- seccion_id propia, se reparte via medidores_reparto).
do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'medidores'::regclass and contype = 'c' and conname = 'chk_medidor_dueno';
  if v_name is not null then
    execute format('alter table medidores drop constraint %I', v_name);
  end if;
end $$;

alter table medidores add constraint chk_medidor_dueno check (
  (es_general = true  and propiedad_id is not null and seccion_id is null and es_compartido = false)
  or
  (es_general = false and es_compartido = false and seccion_id is not null)
  or
  (es_general = false and es_compartido = true  and seccion_id is null and propiedad_id is not null)
);

create table medidores_reparto (
  id uuid primary key default gen_random_uuid(),
  medidor_id uuid not null references medidores(id) on delete cascade,
  seccion_id uuid not null references secciones(id),
  porcentaje numeric(5,2) not null check (porcentaje > 0 and porcentaje <= 100),
  created_at timestamptz not null default now(),
  unique (medidor_id, seccion_id)
);
create index idx_medidores_reparto_medidor on medidores_reparto(medidor_id);
create index idx_medidores_reparto_seccion on medidores_reparto(seccion_id);

alter table medidores_reparto enable row level security;

create policy medidores_reparto_read on medidores_reparto
  for select using (auth_rol() in ('administrador','operador'));
create policy medidores_reparto_write on medidores_reparto
  for insert with check (auth_rol() in ('administrador','operador'));
create policy medidores_reparto_update on medidores_reparto
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
create policy medidores_reparto_delete on medidores_reparto
  for delete using (auth_rol() in ('administrador','operador'));


-- ============================================================================
-- ARCHIVO ORIGINAL: 10_migrations-cobranza-servicios-combinada.sql
-- ============================================================================
-- ============================================================================
-- migrations-cobranza-servicios-combinada.sql
-- Separa "calcular una cuenta" de "generar la cobranza del periodo".
--
-- Antes: cada vez que calculabas UNA cuenta (ej. Lt14), el sistema creaba
-- la cuota de cobranza al toque, por cada sección. Con propiedades de varias
-- cuentas (Lt14, Lt15, Baño compartido...) esto generaba una cuota separada
-- por cuenta para el mismo inquilino, en vez de una sola cuota combinada
-- (ej. Lavadero 3 = Lt14 + Lt15 + Baño, como en el cuadro de control real).
--
-- Ahora el flujo queda en 3 pasos, como se factura en la práctica:
--   1. Tomar lecturas (ya existía).
--   2. Calcular cada cuenta por separado (calcular_periodo_servicio) — esto
--      ahora SOLO calcula y guarda el detalle de consumo/monto por sección,
--      todavía NO genera cuotas de cobranza.
--   3. Cuando TODAS las cuentas del servicio+periodo ya fueron calculadas,
--      correr generar_cobranzas_servicio — junta el detalle de todas las
--      cuentas por sección y recién ahí crea UNA cuota por inquilino.
-- ============================================================================

create or replace function calcular_periodo_servicio(
  p_propiedad_id uuid,
  p_tipo_servicio_id uuid,
  p_periodo text,
  p_recibo_general_id uuid,
  p_detalles jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recibo record;
  v_precio_unitario numeric(12,4);
  v_periodo_id uuid;
  v_item jsonb;
  v_monto numeric(12,2);
  v_contrato_id uuid;
begin
  if auth_rol() not in ('administrador', 'operador') then
    raise exception 'No autorizado para calcular servicios';
  end if;

  if exists (
    select 1 from calculo_servicios_periodo where recibo_general_id = p_recibo_general_id
  ) then
    raise exception 'Ya existe un calculo confirmado para este recibo.';
  end if;

  select * into v_recibo from recibos_generales_servicio where id = p_recibo_general_id;
  if not found then
    raise exception 'Recibo general % no existe', p_recibo_general_id;
  end if;

  v_precio_unitario := coalesce(v_recibo.precio_unitario,
    case when coalesce(v_recibo.consumo_total_recibo, 0) > 0
      then round(v_recibo.monto_total_recibo / v_recibo.consumo_total_recibo, 4)
      else null end);

  insert into calculo_servicios_periodo
    (propiedad_id, tipo_servicio_id, periodo, recibo_general_id, precio_unitario_aplicado, generado_por, estado)
  values
    (p_propiedad_id, p_tipo_servicio_id, p_periodo, p_recibo_general_id, v_precio_unitario, auth.uid(), 'confirmado')
  returning id into v_periodo_id;

  -- Solo guarda el detalle de consumo/monto por sección — la cuota de
  -- cobranza se genera después, combinada, con generar_cobranzas_servicio.
  for v_item in select * from jsonb_array_elements(p_detalles)
  loop
    if (v_item->>'metodo') = 'medidor' then
      v_monto := round(coalesce((v_item->>'consumo')::numeric, 0) * coalesce(v_precio_unitario, 0), 2);
    else
      v_monto := round(coalesce((v_item->>'n_personas')::numeric, 0) * coalesce((v_item->>'tarifa_por_persona')::numeric, 0), 2);
    end if;

    select id into v_contrato_id from contratos_alquiler
    where seccion_id = (v_item->>'seccion_id')::uuid and estado in ('vigente', 'por_vencer')
    order by fecha_inicio desc limit 1;

    insert into calculo_servicios_detalle
      (calculo_periodo_id, seccion_id, metodo, lectura_id, consumo, precio_unitario_aplicado,
       n_personas, tarifa_por_persona, monto_calculado, contrato_alquiler_id)
    values
      (v_periodo_id, (v_item->>'seccion_id')::uuid, v_item->>'metodo',
       nullif(v_item->>'lectura_id', '')::uuid, (v_item->>'consumo')::numeric, v_precio_unitario,
       (v_item->>'n_personas')::int, (v_item->>'tarifa_por_persona')::numeric, v_monto, v_contrato_id);
  end loop;

  return v_periodo_id;
end;
$$;

-- Junta el detalle de TODAS las cuentas ya calculadas de un
-- propiedad+servicio+periodo, agrupado por sección, y genera UNA cuota por
-- sección con el monto combinado. Exige que ya se hayan calculado todas las
-- cuentas (todos los recibos) de ese periodo, para no cobrar de menos.
create or replace function generar_cobranzas_servicio(
  p_propiedad_id uuid,
  p_tipo_servicio_id uuid,
  p_periodo text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo record;
  v_periodo_date date;
  v_dias_en_mes int;
  v_dia int;
  v_fecha_venc date;
  v_total_recibos int;
  v_total_calculados int;
  v_seccion record;
  v_cuota_id uuid;
  v_generadas int := 0;
begin
  if auth_rol() not in ('administrador', 'operador') then
    raise exception 'No autorizado para generar cobranzas';
  end if;

  select count(*) into v_total_recibos
  from recibos_generales_servicio
  where propiedad_id = p_propiedad_id and tipo_servicio_id = p_tipo_servicio_id and periodo = p_periodo;

  if v_total_recibos = 0 then
    raise exception 'No hay ningún recibo general registrado para esta propiedad, servicio y periodo.';
  end if;

  select count(*) into v_total_calculados
  from calculo_servicios_periodo
  where propiedad_id = p_propiedad_id and tipo_servicio_id = p_tipo_servicio_id and periodo = p_periodo;

  if v_total_calculados < v_total_recibos then
    raise exception 'Faltan % cuenta(s) por calcular antes de generar la cobranza de este periodo.', (v_total_recibos - v_total_calculados);
  end if;

  select * into v_tipo from tipos_servicio where id = p_tipo_servicio_id;
  v_periodo_date := to_date(p_periodo || '-01', 'YYYY-MM-DD');
  v_dias_en_mes := extract(day from (date_trunc('month', v_periodo_date) + interval '1 month - 1 day'))::int;
  v_dia := least(coalesce(v_tipo.dia_corte_mensual, 15), v_dias_en_mes);
  v_fecha_venc := date_trunc('month', v_periodo_date)::date + (v_dia - 1);

  for v_seccion in
    -- (array_agg(d.id))[1] queda como "detalle de referencia": cuotas solo
    -- puede apuntar a UN calculo_servicios_detalle (columna legada de cuando
    -- cada cuota venía de una sola cuenta), pero como todos los detalles de
    -- este grupo son de la misma sección/periodo/servicio, cualquiera de
    -- ellos resuelve correctamente el inquilino y la referencia al mostrarlo
    -- en Cobranzas — el monto de la cuota sale de la suma, no de ese detalle.
    -- Nota: no se usa min(d.id) porque Postgres no tiene agregado MIN/MAX
    -- para el tipo uuid.
    select d.seccion_id, sum(d.monto_calculado) as monto_total, (array_agg(d.id))[1] as detalle_ref_id
    from calculo_servicios_detalle d
    join calculo_servicios_periodo p on p.id = d.calculo_periodo_id
    where p.propiedad_id = p_propiedad_id and p.tipo_servicio_id = p_tipo_servicio_id and p.periodo = p_periodo
      and d.cuota_id is null
    group by d.seccion_id
  loop
    insert into cuotas (origen, contrato_id, calculo_servicio_detalle_id, concepto, monto, fecha_vencimiento, estado)
    values ('servicio', null, v_seccion.detalle_ref_id, coalesce(v_tipo.nombre, 'Servicio') || ' ' || p_periodo, v_seccion.monto_total, v_fecha_venc, 'pendiente')
    returning id into v_cuota_id;

    update calculo_servicios_detalle d
    set cuota_id = v_cuota_id
    from calculo_servicios_periodo p
    where d.calculo_periodo_id = p.id
      and p.propiedad_id = p_propiedad_id and p.tipo_servicio_id = p_tipo_servicio_id and p.periodo = p_periodo
      and d.seccion_id = v_seccion.seccion_id
      and d.cuota_id is null;

    v_generadas := v_generadas + 1;
  end loop;

  if v_generadas = 0 then
    raise exception 'No hay consumos pendientes de facturar para esta propiedad, servicio y periodo (¿ya se generaron las cobranzas antes?).';
  end if;

  return v_generadas;
end;
$$;

notify pgrst, 'reload schema';


-- ============================================================================
-- ARCHIVO ORIGINAL: 11_migrations-precio-editable-cuadro.sql
-- ============================================================================
-- ============================================================================
-- migrations-precio-editable-cuadro.sql
-- Permite editar el precio unitario (S/ por m3 de agua o kWh de luz) al
-- calcular una cuenta, en vez de forzar siempre el precio derivado del
-- recibo general. El precio del recibo general sigue siendo el valor por
-- defecto que se muestra al usuario, pero ahora puede corregirlo antes de
-- confirmar el cálculo (ej. cuando el recibo real trae un precio distinto
-- al recalculado, o hay que redondear distinto).
-- ============================================================================

-- Añadir un parámetro nuevo (aunque tenga default) NO reemplaza la función
-- de 5 parámetros existente — Postgres la trataría como un overload aparte
-- y luego una llamada con 5 argumentos quedaría ambigua entre ambas. Hay
-- que borrar explícitamente la firma vieja antes de crear la nueva.
drop function if exists calcular_periodo_servicio(uuid, uuid, text, uuid, jsonb);

create or replace function calcular_periodo_servicio(
  p_propiedad_id uuid,
  p_tipo_servicio_id uuid,
  p_periodo text,
  p_recibo_general_id uuid,
  p_detalles jsonb,
  p_precio_unitario_override numeric(12,4) default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recibo record;
  v_precio_unitario numeric(12,4);
  v_periodo_id uuid;
  v_item jsonb;
  v_monto numeric(12,2);
  v_contrato_id uuid;
begin
  if auth_rol() not in ('administrador', 'operador') then
    raise exception 'No autorizado para calcular servicios';
  end if;

  if exists (
    select 1 from calculo_servicios_periodo where recibo_general_id = p_recibo_general_id
  ) then
    raise exception 'Ya existe un calculo confirmado para este recibo.';
  end if;

  select * into v_recibo from recibos_generales_servicio where id = p_recibo_general_id;
  if not found then
    raise exception 'Recibo general % no existe', p_recibo_general_id;
  end if;

  -- El precio del recibo general (o el recalculado monto/consumo) sigue
  -- siendo el valor por defecto, pero si el usuario lo edita en pantalla
  -- antes de confirmar, se respeta ese valor (p_precio_unitario_override).
  v_precio_unitario := coalesce(p_precio_unitario_override, v_recibo.precio_unitario,
    case when coalesce(v_recibo.consumo_total_recibo, 0) > 0
      then round(v_recibo.monto_total_recibo / v_recibo.consumo_total_recibo, 4)
      else null end);

  insert into calculo_servicios_periodo
    (propiedad_id, tipo_servicio_id, periodo, recibo_general_id, precio_unitario_aplicado, generado_por, estado)
  values
    (p_propiedad_id, p_tipo_servicio_id, p_periodo, p_recibo_general_id, v_precio_unitario, auth.uid(), 'confirmado')
  returning id into v_periodo_id;

  -- Solo guarda el detalle de consumo/monto por sección — la cuota de
  -- cobranza se genera después, combinada, con generar_cobranzas_servicio.
  for v_item in select * from jsonb_array_elements(p_detalles)
  loop
    if (v_item->>'metodo') = 'medidor' then
      v_monto := round(coalesce((v_item->>'consumo')::numeric, 0) * coalesce(v_precio_unitario, 0), 2);
    else
      v_monto := round(coalesce((v_item->>'n_personas')::numeric, 0) * coalesce((v_item->>'tarifa_por_persona')::numeric, 0), 2);
    end if;

    select id into v_contrato_id from contratos_alquiler
    where seccion_id = (v_item->>'seccion_id')::uuid and estado in ('vigente', 'por_vencer')
    order by fecha_inicio desc limit 1;

    insert into calculo_servicios_detalle
      (calculo_periodo_id, seccion_id, metodo, lectura_id, consumo, precio_unitario_aplicado,
       n_personas, tarifa_por_persona, monto_calculado, contrato_alquiler_id)
    values
      (v_periodo_id, (v_item->>'seccion_id')::uuid, v_item->>'metodo',
       nullif(v_item->>'lectura_id', '')::uuid, (v_item->>'consumo')::numeric, v_precio_unitario,
       (v_item->>'n_personas')::int, (v_item->>'tarifa_por_persona')::numeric, v_monto, v_contrato_id);
  end loop;

  return v_periodo_id;
end;
$$;

notify pgrst, 'reload schema';


-- ============================================================================
-- ARCHIVO ORIGINAL: 12_migrations-configuracion-sistema.sql
-- ============================================================================
-- ============================================================================
-- migrations-configuracion-sistema.sql
-- Módulo de Configuración: variables globales editables desde la pantalla
-- (precio por defecto de agua/luz, moneda, mora, etc.) sin tocar código.
-- Tabla "singleton" — siempre existe UNA sola fila (id fijo = true), así el
-- formulario de Configuración solo hace un select/update, no un CRUD.
-- `extra` (jsonb) queda como cajón de sastre para variables futuras que no
-- ameriten una columna propia ni otra migración.
-- ============================================================================

create table if not exists configuracion_sistema (
  id boolean primary key default true,
  nombre_inmobiliaria text,
  precio_default_agua_m3 numeric(12,4),
  precio_default_luz_kwh numeric(12,4),
  moneda text not null default 'PEN',
  dias_gracia_mora int not null default 5,
  porcentaje_mora_mensual numeric(5,2) not null default 0,
  extra jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint chk_configuracion_singleton check (id = true)
);

insert into configuracion_sistema (id) values (true) on conflict (id) do nothing;

drop trigger if exists trg_configuracion_updated on configuracion_sistema;
create trigger trg_configuracion_updated before update on configuracion_sistema
  for each row execute function set_updated_at();

alter table configuracion_sistema enable row level security;

drop policy if exists configuracion_select on configuracion_sistema;
create policy configuracion_select on configuracion_sistema for select
  using (auth_rol() in ('administrador', 'operador'));

drop policy if exists configuracion_update on configuracion_sistema;
create policy configuracion_update on configuracion_sistema for update
  using (auth_rol() = 'administrador')
  with check (auth_rol() = 'administrador');

notify pgrst, 'reload schema';


-- ============================================================================
-- ARCHIVO ORIGINAL: 13_migrations-deshacer-calculo-servicio.sql
-- ============================================================================
-- ============================================================================
-- migrations-deshacer-calculo-servicio.sql
-- Permite corregir un cálculo de servicios ya confirmado, o una cobranza ya
-- generada, sin editar filas a mano en la base de datos. Nunca se edita un
-- cálculo confirmado in-place — siempre se deshace y se rehace, para no
-- perder trazabilidad:
--
--   1. eliminar_cuota_servicio(cuota_id) — borra una cuota de origen
--      'servicio' ya generada y libera (cuota_id = null) el detalle de
--      cálculo que la alimentaba, para que vuelva a quedar "pendiente de
--      facturar". Bloqueada si la cuota ya tiene pagos registrados (hay que
--      anularlos primero desde Cobranzas, con lo que ya existe hoy).
--
--   2. deshacer_calculo_servicio(recibo_general_id) — borra el cálculo
--      confirmado de UNA cuenta (calculo_servicios_periodo + su detalle,
--      por cascada) para poder corregir una lectura y recalcular. Bloqueada
--      si ese detalle ya quedó ligado a una cuota (hay que eliminarla
--      primero con la función de arriba).
--
-- Flujo para corregir una lectura de un medidor cuya cuenta ya se calculó:
--   a) Si la cuenta AÚN no generó cobranza: "Deshacer cálculo" esa cuenta
--      en el tab Cálculo → corregir la lectura en "Lecturas del mes" →
--      volver a "Calcular esta cuenta".
--   b) Si la cobranza YA se generó: primero "Eliminar" la cuota en
--      Cobranzas y Pagos (si tiene pagos, anúlalos antes) → eso libera el
--      detalle → "Deshacer cálculo" de la cuenta afectada → corregir la
--      lectura → recalcular esa cuenta → "Generar cobranzas del periodo"
--      de nuevo (solo genera lo que falte, no duplica lo ya facturado).
-- ============================================================================

create or replace function eliminar_cuota_servicio(p_cuota_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuota record;
  v_pagos int;
begin
  if auth_rol() <> 'administrador' then
    raise exception 'Solo un administrador puede eliminar una cuota generada.';
  end if;

  select * into v_cuota from cuotas where id = p_cuota_id;
  if not found then
    raise exception 'La cuota % no existe.', p_cuota_id;
  end if;
  if v_cuota.origen <> 'servicio' then
    raise exception 'Esta función solo elimina cuotas de servicio (agua/luz/otros).';
  end if;

  select count(*) into v_pagos from pagos where cuota_id = p_cuota_id;
  if v_pagos > 0 then
    raise exception 'Esta cuota ya tiene % pago(s) registrado(s) — anúlalos primero desde el detalle de la cuota antes de eliminarla.', v_pagos;
  end if;

  update calculo_servicios_detalle set cuota_id = null where cuota_id = p_cuota_id;
  delete from cuotas where id = p_cuota_id;
end;
$$;

create or replace function deshacer_calculo_servicio(p_recibo_general_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_periodo_id uuid;
  v_facturados int;
begin
  if auth_rol() <> 'administrador' then
    raise exception 'Solo un administrador puede deshacer un cálculo confirmado.';
  end if;

  select id into v_periodo_id from calculo_servicios_periodo where recibo_general_id = p_recibo_general_id;
  if not found then
    raise exception 'Esta cuenta todavía no tiene un cálculo confirmado.';
  end if;

  select count(*) into v_facturados
  from calculo_servicios_detalle
  where calculo_periodo_id = v_periodo_id and cuota_id is not null;

  if v_facturados > 0 then
    raise exception 'Esta cuenta ya está incluida en % cuota(s) de cobranza generada(s) — elimina esa(s) cuota(s) primero desde Cobranzas y Pagos.', v_facturados;
  end if;

  delete from calculo_servicios_periodo where id = v_periodo_id; -- cascada borra su calculo_servicios_detalle
end;
$$;

notify pgrst, 'reload schema';


-- ============================================================================
-- ARCHIVO ORIGINAL: 14_fix-secciones-orden-OPCIONAL.sql
-- ============================================================================
-- fix-secciones-orden.sql
-- Corrige el error "column secciones.orden does not exist" (HTTP 400) que
-- aparece al abrir el selector de secciones en Servicios/Gastos.
-- Causa: la tabla `secciones` en la base de datos real no tiene la columna
-- `orden` que sí existe en schema.sql (probablemente se creó antes de que
-- esa columna se agregara al esquema). Este script es seguro de correr
-- aunque la columna ya exista (no hace nada en ese caso).

alter table secciones add column if not exists orden int not null default 0;

-- Por si acaso, verifica también estas otras tablas que se ordenan por
-- "orden" en el frontend (no debería faltar, pero no cuesta confirmarlo):
alter table catalogos add column if not exists orden int not null default 0;
alter table tipos_servicio add column if not exists orden int not null default 0;
alter table propiedades_fotos add column if not exists orden int not null default 0;

-- Refresca el cache de esquema de PostgREST para que reconozca la columna
-- nueva de inmediato (si no, puede tardar unos minutos en notarlo solo).
notify pgrst, 'reload schema';


-- ============================================================================
-- ARCHIVO ORIGINAL: 15_email-lookup-function-OPCIONAL.sql
-- ============================================================================
-- ============================================================================
-- FUNCION: verificar si un correo ya está registrado y validado (tiene fila
-- en usuarios_roles) — Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase.
--
-- La usa pages/login.html para decidir qué hace el botón "Ingresar":
--   - correo ya registrado y validado  -> envía el enlace de acceso directo.
--   - correo nuevo / sin rol asignado  -> no envía nada automáticamente;
--     muestra el enlace secundario "Enviar enlace de acceso" para que el
--     usuario lo pida explícitamente (y tú le asignes el rol después).
--
-- Es "security definer" pero solo expone true/false — nunca datos de la
-- tabla usuarios_roles ni de auth.users. Seguro de exponer a "anon".
-- ============================================================================
create or replace function public.email_esta_registrado(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    join usuarios_roles ur on ur.usuario_id = u.id
    where lower(u.email) = lower(p_email)
  );
$$;

grant execute on function public.email_esta_registrado(text) to anon, authenticated;

-- ============================================================================
-- FIN email-lookup-function.sql
-- ============================================================================


-- ============================================================================
-- ARCHIVO ORIGINAL: 16_fix-configuracion-sistema-fila.sql
-- ============================================================================
-- ============================================================================
-- 16_fix-configuracion-sistema-fila.sql
-- El error "PGRST116 / 406 / Cannot coerce the result to a single JSON
-- object" al guardar en Configuración pasa porque la fila única (id=true)
-- nunca se insertó — el UPDATE de configuracion_sistema no encuentra
-- ninguna fila que actualizar. Este archivo:
--   1. Vuelve a intentar crear la fila (idempotente, no falla si ya existe).
--   2. Agrega una política de INSERT para administrador (antes solo había
--      UPDATE) — así, si la fila llegara a faltar otra vez, el propio
--      formulario puede recrearla en vez de quedar bloqueado.
-- El data layer (updateConfiguracionSistema) también se actualizó para usar
-- upsert en vez de un update plano, como segunda capa de seguridad.
-- ============================================================================

insert into configuracion_sistema (id) values (true) on conflict (id) do nothing;

drop policy if exists configuracion_insert on configuracion_sistema;
create policy configuracion_insert on configuracion_sistema for insert
  with check (auth_rol() = 'administrador');

notify pgrst, 'reload schema';


-- ============================================================================
-- ARCHIVO ORIGINAL: 17_migrations-lecturas-por-fecha.sql
-- ============================================================================
-- ============================================================================
-- 17_migrations-lecturas-por-fecha.sql
-- Las lecturas de agua/luz no se toman en fechas de corte de mes calendario
-- (agua el 10, luz el 19 de cada mes, alineado a la fecha real en que el
-- proveedor toma su propia lectura) — obligar a elegir un "periodo" manual
-- para cada lectura era forzar un mes calendario a algo que en realidad es
-- un rango de fechas (ej. lectura del 10/08 en realidad mide el consumo del
-- 10/07 al 10/08). A partir de ahora la lógica gira en torno a las fechas
-- de lectura anterior/actual, encadenando cada lectura con la anterior por
-- FECHA (no por el string de periodo). `periodo` se sigue guardando (lo
-- necesitan Recibos generales y Cálculo de Servicios para agrupar por mes),
-- pero ya no lo elige el usuario: un trigger lo calcula solo, siempre, a
-- partir del mes de `fecha_lectura` (que ahora representa la fecha de la
-- lectura ACTUAL).
-- ============================================================================

alter table lecturas_medidores
  add column if not exists fecha_lectura_anterior date;

create or replace function set_periodo_desde_fecha_lectura()
returns trigger
language plpgsql
as $$
begin
  new.periodo := to_char(new.fecha_lectura, 'YYYY-MM');
  return new;
end;
$$;

drop trigger if exists trg_lecturas_periodo_auto on lecturas_medidores;
create trigger trg_lecturas_periodo_auto
  before insert or update on lecturas_medidores
  for each row execute function set_periodo_desde_fecha_lectura();

notify pgrst, 'reload schema';


-- ============================================================================
-- ARCHIVO ORIGINAL: 18_migrations-color-lineas-tabla.sql
-- ============================================================================
-- ============================================================================
-- 18_migrations-color-lineas-tabla.sql
-- Color de las líneas de la tabla del "cuadro de consumo" (el recibo que se
-- le presenta al inquilino) — configurable desde Configuración en vez de
-- venir fijo en el código, por si más adelante se quiere otro estilo.
-- ============================================================================

alter table configuracion_sistema
  add column if not exists color_lineas_tabla text not null default '#D1D5DB';

notify pgrst, 'reload schema';


-- ============================================================================
-- ARCHIVO ORIGINAL: 19_migrations-montos-fijos-contrato.sql
-- ============================================================================
-- ============================================================================
-- 19_migrations-montos-fijos-contrato.sql
-- Caso "Edificio Polonia": algunos locales tienen medidor propio de agua/luz
-- y otros pagan un monto fijo mensual (definido en el CONTRATO de alquiler,
-- porque depende de cuántas personas van a habitar/trabajar ahí — es un
-- dato que ya se negocia y se estipula al firmar, junto con la renta). No
-- es un default global igual para todos los locales: cada contrato puede
-- tener un monto fijo distinto por tipo de servicio (agua, luz, etc.).
-- ============================================================================

-- Dato de contexto del contrato (informativo, y referencia para negociar el
-- monto fijo) — no se usa para recalcular nada automáticamente.
alter table contratos_alquiler add column if not exists n_ocupantes int;

create table if not exists contratos_alquiler_servicios_fijos (
  id uuid primary key default gen_random_uuid(),
  contrato_alquiler_id uuid not null references contratos_alquiler(id) on delete cascade,
  tipo_servicio_id uuid not null references tipos_servicio(id),
  monto_fijo numeric(12,2) not null,
  notas text,
  created_at timestamptz not null default now(),
  unique (contrato_alquiler_id, tipo_servicio_id)
);
create index idx_contratos_servicios_fijos_contrato on contratos_alquiler_servicios_fijos(contrato_alquiler_id);

alter table contratos_alquiler_servicios_fijos enable row level security;

drop policy if exists contratos_servicios_fijos_read on contratos_alquiler_servicios_fijos;
create policy contratos_servicios_fijos_read on contratos_alquiler_servicios_fijos
  for select using (auth_rol() in ('administrador','operador'));
drop policy if exists contratos_servicios_fijos_write on contratos_alquiler_servicios_fijos;
create policy contratos_servicios_fijos_write on contratos_alquiler_servicios_fijos
  for insert with check (auth_rol() in ('administrador','operador'));
drop policy if exists contratos_servicios_fijos_update on contratos_alquiler_servicios_fijos;
create policy contratos_servicios_fijos_update on contratos_alquiler_servicios_fijos
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
drop policy if exists contratos_servicios_fijos_delete on contratos_alquiler_servicios_fijos;
create policy contratos_servicios_fijos_delete on contratos_alquiler_servicios_fijos
  for delete using (auth_rol() in ('administrador','operador'));

-- Permite guardar el detalle de cálculo de una sección con monto fijo como
-- su propio método ('monto_fijo'), distinto de 'tarifa_fija_por_persona'
-- (que era un default global igual para todos, y ya no se usa para esto) —
-- se sigue guardando como n_personas=1 / tarifa_por_persona=monto para no
-- tener que tocar la función calcular_periodo_servicio, que ya sabe hacer
-- monto = n_personas * tarifa_por_persona.
do $$
declare
  v_constraint_name text;
begin
  select con.conname into v_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'calculo_servicios_detalle' and att.attname = 'metodo' and con.contype = 'c';
  if v_constraint_name is not null then
    execute format('alter table calculo_servicios_detalle drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table calculo_servicios_detalle
  add constraint calculo_servicios_detalle_metodo_check
  check (metodo in ('medidor', 'tarifa_fija_por_persona', 'monto_fijo'));

notify pgrst, 'reload schema';


-- ============================================================================
-- ARCHIVO ORIGINAL: 20_migrations-contrato-multi-seccion.sql
-- ============================================================================
-- ============================================================================
-- 20_migrations-contrato-multi-seccion.sql
-- Caso real: un inquilino toma varias secciones bajo UN mismo contrato (ej.
-- 4to y 5to piso de Edificio Polonia) y más adelante amplía tomando una
-- sección más (6to piso). En el rubro inmobiliario esto se maneja con una
-- "adenda": un anexo que amplía el contrato original (mismo inquilino, mismo
-- número de contrato) detallando el inmueble adicional, su propia mensualidad
-- y sus propias fechas de inicio/fin — sin anular ni re-firmar el contrato
-- original. Esta migración modela justamente eso.
--
-- contratos_alquiler.seccion_id se mantiene (apunta siempre a la sección
-- ORIGINAL, la del contrato inicial) solo por compatibilidad con vistas que
-- ya lo usan como referencia rápida. La fuente de verdad de QUÉ secciones
-- cubre el contrato — y con qué renta/fechas cada una — es la tabla nueva
-- contratos_alquiler_secciones. contratos_alquiler.monto_renta pasa a ser
-- la SUMA de todas sus secciones (se valida/calcula desde el frontend).
-- ============================================================================

create table if not exists contratos_alquiler_secciones (
  id uuid primary key default gen_random_uuid(),
  contrato_alquiler_id uuid not null references contratos_alquiler(id) on delete cascade,
  seccion_id uuid not null references secciones(id),
  monto_renta numeric(12,2) not null,
  fecha_inicio date not null,
  fecha_fin date,
  es_adenda boolean not null default false,
  numero_adenda int,
  notas text,
  created_at timestamptz not null default now(),
  unique (contrato_alquiler_id, seccion_id)
);
create index idx_cas_contrato on contratos_alquiler_secciones(contrato_alquiler_id);
create index idx_cas_seccion on contratos_alquiler_secciones(seccion_id);

alter table contratos_alquiler_secciones enable row level security;

drop policy if exists contratos_secciones_read on contratos_alquiler_secciones;
create policy contratos_secciones_read on contratos_alquiler_secciones
  for select using (auth_rol() in ('administrador','operador'));
drop policy if exists contratos_secciones_insert on contratos_alquiler_secciones;
create policy contratos_secciones_insert on contratos_alquiler_secciones
  for insert with check (auth_rol() in ('administrador','operador'));
drop policy if exists contratos_secciones_update on contratos_alquiler_secciones;
create policy contratos_secciones_update on contratos_alquiler_secciones
  for update using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));
drop policy if exists contratos_secciones_delete on contratos_alquiler_secciones;
create policy contratos_secciones_delete on contratos_alquiler_secciones
  for delete using (auth_rol() in ('administrador','operador'));

-- Backfill: todo contrato de alquiler que ya existía se registra como su
-- propia "sección original" (es_adenda = false), usando los datos que ya
-- tenía en sus columnas seccion_id / monto_renta / fecha_inicio / fecha_fin.
-- Idempotente: no duplica si se corre más de una vez.
insert into contratos_alquiler_secciones (contrato_alquiler_id, seccion_id, monto_renta, fecha_inicio, fecha_fin, es_adenda, numero_adenda)
select ca.id, ca.seccion_id, ca.monto_renta, ca.fecha_inicio, ca.fecha_fin, false, null
from contratos_alquiler ca
where not exists (
  select 1 from contratos_alquiler_secciones cas where cas.contrato_alquiler_id = ca.id
);

-- ----------------------------------------------------------------------------
-- Trigger: al vincular una sección a un contrato (insertar en
-- contratos_alquiler_secciones), si el contrato está vigente/por_vencer, esa
-- sección pasa a 'alquilado' de inmediato. Cubre tanto la sección original
-- (insertada justo después de crear el contrato) como cualquier adenda
-- posterior agregada mientras el contrato ya está vigente.
-- ----------------------------------------------------------------------------
create or replace function trg_fn_contrato_alquiler_seccion_creada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado_contrato text;
begin
  select estado into v_estado_contrato from contratos_alquiler where id = new.contrato_alquiler_id;
  if v_estado_contrato in ('vigente', 'por_vencer') then
    update secciones set estado = 'alquilado' where id = new.seccion_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contrato_alquiler_seccion_creada on contratos_alquiler_secciones;
create trigger trg_contrato_alquiler_seccion_creada
  after insert on contratos_alquiler_secciones
  for each row execute function trg_fn_contrato_alquiler_seccion_creada();

-- Trigger: si se quita una sección de un contrato (ej. se corrigió una fila
-- agregada por error), la sección vuelve a 'disponible' — pero solo si
-- ningún OTRO contrato vigente la sigue reclamando (evita liberar una
-- sección que en realidad sigue ocupada por otro contrato).
create or replace function trg_fn_contrato_alquiler_seccion_eliminada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update secciones set estado = 'disponible'
  where id = old.seccion_id and estado = 'alquilado'
    and not exists (
      select 1 from contratos_alquiler_secciones cas
      join contratos_alquiler ca on ca.id = cas.contrato_alquiler_id
      where cas.seccion_id = old.seccion_id and ca.estado in ('vigente', 'por_vencer')
    );
  return old;
end;
$$;

drop trigger if exists trg_contrato_alquiler_seccion_eliminada on contratos_alquiler_secciones;
create trigger trg_contrato_alquiler_seccion_eliminada
  after delete on contratos_alquiler_secciones
  for each row execute function trg_fn_contrato_alquiler_seccion_eliminada();

-- ----------------------------------------------------------------------------
-- El trigger existente de contratos_alquiler (creado/estado) seguía marcando
-- SOLO new.seccion_id (la original) como 'alquilado'/'disponible'. Se
-- actualiza para que, al finalizar un contrato, libere TODAS sus secciones
-- (no solo la original) — la marca inicial de 'alquilado' ya la cubre el
-- trigger nuevo de arriba en cuanto se inserta cada fila.
-- ----------------------------------------------------------------------------
create or replace function trg_fn_contrato_alquiler_creado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado in ('vigente', 'por_vencer') then
    update secciones set estado = 'alquilado' where id = new.seccion_id;
    perform generar_cuotas_alquiler(new.id);
  elsif new.estado = 'finalizado' then
    update secciones set estado = 'disponible'
    where estado = 'alquilado'
      and id in (
        select seccion_id from contratos_alquiler_secciones where contrato_alquiler_id = new.id
        union
        select new.seccion_id
      );
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';


-- ============================================================================
-- ARCHIVO ORIGINAL: 21_fix-mora-contrato-multiseccion-cobranzas.sql
-- ============================================================================
-- ============================================================================
-- 21_fix-mora-contrato-multiseccion-cobranzas.sql
-- Tres bugs encontrados al probar cobranzas de servicios con contratos
-- multi-sección (ej. Edificio Polonia):
--
-- 1) aplicar_mora_cuotas_vencidas() seguía leyendo el % de mora de la tabla
--    vieja `configuracion` (columna clave='mora', sembrada una vez en
--    03_seed.sql con 5%), NO de `configuracion_sistema.porcentaje_mora_mensual`
--    que es la que de verdad edita la pantalla de Configuración. Por eso
--    poner 0% en Configuración no tenía ningún efecto: seguía aplicando el
--    5% viejo hardcodeado en el seed.
--
-- 2) calcular_periodo_servicio() solo buscaba el contrato de una sección
--    mirando contratos_alquiler.seccion_id (la sección "original"). Una
--    sección agregada después como adenda (contratos_alquiler_secciones)
--    nunca encontraba su contrato -> contrato_alquiler_id quedaba NULL ->
--    esa sección salía sin nombre de inquilino y como una cuota aparte.
--
-- 3) generar_cobranzas_servicio() agrupaba las cuotas por seccion_id. Un
--    inquilino con 2+ secciones bajo el mismo contrato (ej. Piso 4 + Piso 5)
--    terminaba con una cuota de cobranza POR SECCIÓN en vez de una sola
--    cuota combinada por contrato/inquilino.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fix 1: mora usa configuracion_sistema, no la tabla vieja `configuracion`.
-- ---------------------------------------------------------------------------
create or replace function aplicar_mora_cuotas_vencidas()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_porcentaje numeric;
  v_dias_gracia int;
  v_actualizadas int;
begin
  select porcentaje_mora_mensual, dias_gracia_mora
    into v_porcentaje, v_dias_gracia
  from configuracion_sistema where id = true;

  v_porcentaje := coalesce(v_porcentaje, 0);
  v_dias_gracia := coalesce(v_dias_gracia, 0);

  with vencidas as (
    update cuotas
    set estado = 'vencida',
        mora_aplicada = round(monto * v_porcentaje / 100, 2)
    where estado = 'pendiente'
      and fecha_vencimiento < (current_date - v_dias_gracia)
      and mora_aplicada = 0
    returning id
  )
  select count(*) into v_actualizadas from vencidas;

  return v_actualizadas;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fix 2: calcular_periodo_servicio() resuelve el contrato de una sección vía
-- contratos_alquiler_secciones (cubre secciones originales Y de adenda), no
-- solo contratos_alquiler.seccion_id.
-- ---------------------------------------------------------------------------
create or replace function calcular_periodo_servicio(
  p_propiedad_id uuid,
  p_tipo_servicio_id uuid,
  p_periodo text,
  p_recibo_general_id uuid,
  p_detalles jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recibo record;
  v_precio_unitario numeric(12,4);
  v_periodo_id uuid;
  v_item jsonb;
  v_monto numeric(12,2);
  v_contrato_id uuid;
begin
  if auth_rol() not in ('administrador', 'operador') then
    raise exception 'No autorizado para calcular servicios';
  end if;

  if exists (
    select 1 from calculo_servicios_periodo where recibo_general_id = p_recibo_general_id
  ) then
    raise exception 'Ya existe un calculo confirmado para este recibo.';
  end if;

  select * into v_recibo from recibos_generales_servicio where id = p_recibo_general_id;
  if not found then
    raise exception 'Recibo general % no existe', p_recibo_general_id;
  end if;

  v_precio_unitario := coalesce(v_recibo.precio_unitario,
    case when coalesce(v_recibo.consumo_total_recibo, 0) > 0
      then round(v_recibo.monto_total_recibo / v_recibo.consumo_total_recibo, 4)
      else null end);

  insert into calculo_servicios_periodo
    (propiedad_id, tipo_servicio_id, periodo, recibo_general_id, precio_unitario_aplicado, generado_por, estado)
  values
    (p_propiedad_id, p_tipo_servicio_id, p_periodo, p_recibo_general_id, v_precio_unitario, auth.uid(), 'confirmado')
  returning id into v_periodo_id;

  for v_item in select * from jsonb_array_elements(p_detalles)
  loop
    if (v_item->>'metodo') = 'medidor' then
      v_monto := round(coalesce((v_item->>'consumo')::numeric, 0) * coalesce(v_precio_unitario, 0), 2);
    else
      v_monto := round(coalesce((v_item->>'n_personas')::numeric, 0) * coalesce((v_item->>'tarifa_por_persona')::numeric, 0), 2);
    end if;

    -- Busca el contrato de alquiler vigente que cubre esta sección a través
    -- de contratos_alquiler_secciones (incluye tanto la sección "original"
    -- como cualquier sección agregada como adenda) — antes solo miraba
    -- contratos_alquiler.seccion_id, que ignoraba las adendas.
    select ca.id into v_contrato_id
    from contratos_alquiler_secciones cas
    join contratos_alquiler ca on ca.id = cas.contrato_alquiler_id
    where cas.seccion_id = (v_item->>'seccion_id')::uuid and ca.estado in ('vigente', 'por_vencer')
    order by ca.fecha_inicio desc limit 1;

    insert into calculo_servicios_detalle
      (calculo_periodo_id, seccion_id, metodo, lectura_id, consumo, precio_unitario_aplicado,
       n_personas, tarifa_por_persona, monto_calculado, contrato_alquiler_id)
    values
      (v_periodo_id, (v_item->>'seccion_id')::uuid, v_item->>'metodo',
       nullif(v_item->>'lectura_id', '')::uuid, (v_item->>'consumo')::numeric, v_precio_unitario,
       (v_item->>'n_personas')::int, (v_item->>'tarifa_por_persona')::numeric, v_monto, v_contrato_id);
  end loop;

  return v_periodo_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fix 3: generar_cobranzas_servicio() agrupa por contrato_alquiler_id cuando
-- existe (una sola cuota por inquilino aunque tenga varias secciones bajo el
-- mismo contrato), y solo cae a seccion_id cuando no hay contrato asociado
-- (ej. sección vacía o sin contrato de alquiler registrado).
-- ---------------------------------------------------------------------------
create or replace function generar_cobranzas_servicio(
  p_propiedad_id uuid,
  p_tipo_servicio_id uuid,
  p_periodo text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo record;
  v_periodo_date date;
  v_dias_en_mes int;
  v_dia int;
  v_fecha_venc date;
  v_total_recibos int;
  v_total_calculados int;
  v_grupo record;
  v_cuota_id uuid;
  v_generadas int := 0;
begin
  if auth_rol() not in ('administrador', 'operador') then
    raise exception 'No autorizado para generar cobranzas';
  end if;

  select count(*) into v_total_recibos
  from recibos_generales_servicio
  where propiedad_id = p_propiedad_id and tipo_servicio_id = p_tipo_servicio_id and periodo = p_periodo;

  if v_total_recibos = 0 then
    raise exception 'No hay ningún recibo general registrado para esta propiedad, servicio y periodo.';
  end if;

  select count(*) into v_total_calculados
  from calculo_servicios_periodo
  where propiedad_id = p_propiedad_id and tipo_servicio_id = p_tipo_servicio_id and periodo = p_periodo;

  if v_total_calculados < v_total_recibos then
    raise exception 'Faltan % cuenta(s) por calcular antes de generar la cobranza de este periodo.', (v_total_recibos - v_total_calculados);
  end if;

  select * into v_tipo from tipos_servicio where id = p_tipo_servicio_id;
  v_periodo_date := to_date(p_periodo || '-01', 'YYYY-MM-DD');
  v_dias_en_mes := extract(day from (date_trunc('month', v_periodo_date) + interval '1 month - 1 day'))::int;
  v_dia := least(coalesce(v_tipo.dia_corte_mensual, 15), v_dias_en_mes);
  v_fecha_venc := date_trunc('month', v_periodo_date)::date + (v_dia - 1);

  for v_grupo in
    -- Se agrupa por contrato_alquiler_id cuando existe (mismo inquilino,
    -- aunque tenga varias secciones bajo el mismo contrato) y por
    -- seccion_id cuando no (sección sin contrato de alquiler asociado).
    -- (array_agg(d.id))[1] queda como "detalle de referencia": cuotas solo
    -- puede apuntar a UN calculo_servicios_detalle (columna legada de cuando
    -- cada cuota venía de una sola cuenta), pero cualquiera de los detalles
    -- del grupo resuelve correctamente el inquilino al mostrarlo en
    -- Cobranzas — el monto de la cuota sale de la suma, no de ese detalle.
    select
      d.contrato_alquiler_id,
      coalesce(d.contrato_alquiler_id::text, d.seccion_id::text) as clave_grupo,
      sum(d.monto_calculado) as monto_total,
      (array_agg(d.id))[1] as detalle_ref_id
    from calculo_servicios_detalle d
    join calculo_servicios_periodo p on p.id = d.calculo_periodo_id
    where p.propiedad_id = p_propiedad_id and p.tipo_servicio_id = p_tipo_servicio_id and p.periodo = p_periodo
      and d.cuota_id is null
    group by coalesce(d.contrato_alquiler_id::text, d.seccion_id::text), d.contrato_alquiler_id
  loop
    insert into cuotas (origen, contrato_id, calculo_servicio_detalle_id, concepto, monto, fecha_vencimiento, estado)
    values ('servicio', null, v_grupo.detalle_ref_id, coalesce(v_tipo.nombre, 'Servicio') || ' ' || p_periodo, v_grupo.monto_total, v_fecha_venc, 'pendiente')
    returning id into v_cuota_id;

    update calculo_servicios_detalle d
    set cuota_id = v_cuota_id
    from calculo_servicios_periodo p
    where d.calculo_periodo_id = p.id
      and p.propiedad_id = p_propiedad_id and p.tipo_servicio_id = p_tipo_servicio_id and p.periodo = p_periodo
      and coalesce(d.contrato_alquiler_id::text, d.seccion_id::text) = v_grupo.clave_grupo
      and d.cuota_id is null;

    v_generadas := v_generadas + 1;
  end loop;

  if v_generadas = 0 then
    raise exception 'No hay consumos pendientes de facturar para esta propiedad, servicio y periodo (¿ya se generaron las cobranzas antes?).';
  end if;

  return v_generadas;
end;
$$;

notify pgrst, 'reload schema';


-- ============================================================================
-- ARCHIVO ORIGINAL: 23_migrations-color-acento-reportes.sql
-- ============================================================================
-- ============================================================================
-- 23_migrations-color-acento-reportes.sql
-- Color del acento/borde que conecta visualmente el encabezado de cada
-- inmueble con sus filas de detalle en el módulo Reportes — configurable
-- desde Configuración, mismo patrón que color_lineas_tabla (18).
-- ============================================================================

alter table configuracion_sistema
  add column if not exists color_acento_reportes text not null default '#1B3A5C';

notify pgrst, 'reload schema';


-- ============================================================================
-- ARCHIVO ORIGINAL: 24_migrations-precio-por-medidor-y-fix-overload.sql
-- ============================================================================
-- ============================================================================
-- 24_migrations-precio-por-medidor-y-fix-overload.sql
--
-- Encontré un bug latente al implementar el precio editable por medidor:
-- la migración 11 creó calcular_periodo_servicio(uuid,uuid,text,uuid,jsonb,
-- numeric) — 6 parámetros, con p_precio_unitario_override. La migración 21
-- (fix de contrato multi-sección) hizo "create or replace" de
-- calcular_periodo_servicio(uuid,uuid,text,uuid,jsonb) — SOLO 5 parámetros,
-- sin el override — que en Postgres NO reemplaza a la función de 6
-- parámetros: crea una SEGUNDA función distinta (mismo nombre, distinta
-- firma). El frontend (supabase-data.js) siempre llama al RPC pasando
-- p_precio_unitario_override, así que sigue usando la versión VIEJA de 6
-- parámetros — la que NO tiene el fix de contrato_alquiler_secciones. El
-- bug de Piso 4/Piso 5 de Polonia se "arregló" solo porque el script 22
-- corrigió los datos ya calculados a mano; cualquier cálculo NUEVO habría
-- vuelto a fallar igual. Este script:
--   1) Elimina explícitamente ambas versiones (5 y 6 parámetros) para que
--      no quede ninguna ambigüedad de ahora en adelante.
--   2) Crea UNA sola función de 6 parámetros con el fix de contrato
--      multi-sección (de 21) + el override de precio a nivel de recibo
--      (de 11).
--   3) Agrega soporte de precio POR ÍTEM: cada elemento de p_detalles puede
--      traer su propio "precio_unitario" (ej. un medidor con tarifa propia
--      distinta al resto de la cuenta); si no lo trae, usa el precio
--      general de la cuenta como antes. Se guarda en
--      calculo_servicios_detalle.precio_unitario_aplicado por fila.
-- ============================================================================

drop function if exists calcular_periodo_servicio(uuid, uuid, text, uuid, jsonb);
drop function if exists calcular_periodo_servicio(uuid, uuid, text, uuid, jsonb, numeric);

create or replace function calcular_periodo_servicio(
  p_propiedad_id uuid,
  p_tipo_servicio_id uuid,
  p_periodo text,
  p_recibo_general_id uuid,
  p_detalles jsonb,
  p_precio_unitario_override numeric(12,4) default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recibo record;
  v_precio_unitario numeric(12,4);
  v_periodo_id uuid;
  v_item jsonb;
  v_item_precio numeric(12,4);
  v_monto numeric(12,2);
  v_contrato_id uuid;
begin
  if auth_rol() not in ('administrador', 'operador') then
    raise exception 'No autorizado para calcular servicios';
  end if;

  if exists (
    select 1 from calculo_servicios_periodo where recibo_general_id = p_recibo_general_id
  ) then
    raise exception 'Ya existe un calculo confirmado para este recibo.';
  end if;

  select * into v_recibo from recibos_generales_servicio where id = p_recibo_general_id;
  if not found then
    raise exception 'Recibo general % no existe', p_recibo_general_id;
  end if;

  -- Precio general de la cuenta: si el usuario lo corrigió a mano antes de
  -- confirmar, se respeta ese valor (p_precio_unitario_override).
  v_precio_unitario := coalesce(p_precio_unitario_override, v_recibo.precio_unitario,
    case when coalesce(v_recibo.consumo_total_recibo, 0) > 0
      then round(v_recibo.monto_total_recibo / v_recibo.consumo_total_recibo, 4)
      else null end);

  insert into calculo_servicios_periodo
    (propiedad_id, tipo_servicio_id, periodo, recibo_general_id, precio_unitario_aplicado, generado_por, estado)
  values
    (p_propiedad_id, p_tipo_servicio_id, p_periodo, p_recibo_general_id, v_precio_unitario, auth.uid(), 'confirmado')
  returning id into v_periodo_id;

  for v_item in select * from jsonb_array_elements(p_detalles)
  loop
    -- Precio de ESTA fila: si el ítem trae su propio precio_unitario (el
    -- usuario lo fijó distinto al general en la columna "Precio" de la
    -- vista previa), se usa ese; si no, cae al precio general de la cuenta.
    v_item_precio := coalesce((v_item->>'precio_unitario')::numeric, v_precio_unitario);

    if (v_item->>'metodo') = 'medidor' then
      v_monto := round(coalesce((v_item->>'consumo')::numeric, 0) * coalesce(v_item_precio, 0), 2);
    else
      v_monto := round(coalesce((v_item->>'n_personas')::numeric, 0) * coalesce((v_item->>'tarifa_por_persona')::numeric, 0), 2);
    end if;

    -- Busca el contrato de alquiler vigente que cubre esta sección a través
    -- de contratos_alquiler_secciones (incluye tanto la sección "original"
    -- como cualquier sección agregada como adenda).
    select ca.id into v_contrato_id
    from contratos_alquiler_secciones cas
    join contratos_alquiler ca on ca.id = cas.contrato_alquiler_id
    where cas.seccion_id = (v_item->>'seccion_id')::uuid and ca.estado in ('vigente', 'por_vencer')
    order by ca.fecha_inicio desc limit 1;

    insert into calculo_servicios_detalle
      (calculo_periodo_id, seccion_id, metodo, lectura_id, consumo, precio_unitario_aplicado,
       n_personas, tarifa_por_persona, monto_calculado, contrato_alquiler_id)
    values
      (v_periodo_id, (v_item->>'seccion_id')::uuid, v_item->>'metodo',
       nullif(v_item->>'lectura_id', '')::uuid, (v_item->>'consumo')::numeric, v_item_precio,
       (v_item->>'n_personas')::int, (v_item->>'tarifa_por_persona')::numeric, v_monto, v_contrato_id);
  end loop;

  return v_periodo_id;
end;
$$;

notify pgrst, 'reload schema';


-- ============================================================================
-- ARCHIVO ORIGINAL: dev-open-access.sql
-- ============================================================================
-- ============================================================================
-- MODO DESARROLLO — Acceso abierto temporal (SOLO mientras AUTH_ENABLED en
-- assets/js/config.js esté en `false`, es decir, mientras no se gestionan
-- logins).
--
-- ⚠️  ADVERTENCIA DE SEGURIDAD ⚠️
-- Este script agrega políticas que permiten al rol "anon" (cualquier
-- visitante sin iniciar sesión, usando solo la anon key pública) leer y
-- escribir TODAS las tablas y el bucket de Storage. Es equivalente a
-- desactivar la seguridad del sistema. Úsalo solo:
--   - en desarrollo local, o
--   - en un repositorio/GitHub Pages que NO compartas públicamente todavía.
-- Antes de compartir la URL con nadie más o de operar con datos reales de
-- cobranzas, vuelve a poner AUTH_ENABLED = true en config.js y corre la
-- sección "REVERTIR" al final de este archivo.
--
-- Ejecutar DESPU�S de schema.sql + rls-policies.sql (+ seed.sql opcional).
-- ============================================================================

do $$
declare
  t text;
  tablas text[] := array[
    'empresas','usuarios_roles','personas','personas_roles','catalogos','tipos_servicio',
    'propiedades','propiedades_fotos','propiedades_documentos','secciones','secciones_fotos',
    'historial_precios','comisiones_agentes','contratos_alquiler','contratos_venta',
    'oportunidades','cuotas','pagos','medidores','lecturas_medidores',
    'recibos_generales_servicio','calculo_servicios_periodo','calculo_servicios_detalle',
    'incidencias_mantenimiento','notificaciones','configuracion',
    'mantenimientos','mantenimientos_comprobantes','tributos_municipales','cuentas_servicio',
    'medidores_reparto','configuracion_sistema','contratos_alquiler_servicios_fijos',
    'contratos_alquiler_secciones'
  ];
begin
  foreach t in array tablas loop
    execute format('drop policy if exists dev_anon_all on %I;', t);
    execute format('create policy dev_anon_all on %I for all to anon using (true) with check (true);', t);
  end loop;
end $$;

-- Storage: acceso abierto al bucket "inmuebles" para el rol anon.
drop policy if exists dev_anon_storage_select on storage.objects;
create policy dev_anon_storage_select on storage.objects
  for select to anon using (bucket_id = 'inmuebles');
drop policy if exists dev_anon_storage_insert on storage.objects;
create policy dev_anon_storage_insert on storage.objects
  for insert to anon with check (bucket_id = 'inmuebles');
drop policy if exists dev_anon_storage_update on storage.objects;
create policy dev_anon_storage_update on storage.objects
  for update to anon using (bucket_id = 'inmuebles');
drop policy if exists dev_anon_storage_delete on storage.objects;
create policy dev_anon_storage_delete on storage.objects
  for delete to anon using (bucket_id = 'inmuebles');

-- ============================================================================
-- REVERTIR (cuando actives AUTH_ENABLED = true en config.js otra vez):
-- copia y ejecuta el bloque de abajo en el SQL Editor de Supabase.
-- ============================================================================
--
-- do $$
-- declare
--   t text;
--   tablas text[] := array[
--     'empresas','usuarios_roles','personas','personas_roles','catalogos','tipos_servicio',
--     'propiedades','propiedades_fotos','propiedades_documentos','secciones','secciones_fotos',
--     'historial_precios','comisiones_agentes','contratos_alquiler','contratos_venta',
--     'oportunidades','cuotas','pagos','medidores','lecturas_medidores',
--     'recibos_generales_servicio','calculo_servicios_periodo','calculo_servicios_detalle',
--     'incidencias_mantenimiento','notificaciones','configuracion',
--     'mantenimientos','mantenimientos_comprobantes','tributos_municipales','cuentas_servicio',
--     'medidores_reparto','configuracion_sistema','contratos_alquiler_servicios_fijos',
--     'contratos_alquiler_secciones'
--   ];
-- begin
--   foreach t in array tablas loop
--     execute format('drop policy if exists dev_anon_all on %I;', t);
--   end loop;
-- end $$;
--
-- drop policy if exists dev_anon_storage_select on storage.objects;
-- drop policy if exists dev_anon_storage_insert on storage.objects;
-- drop policy if exists dev_anon_storage_update on storage.objects;
-- drop policy if exists dev_anon_storage_delete on storage.objects;
--
-- ============================================================================
-- FIN dev-open-access.sql
-- ============================================================================

