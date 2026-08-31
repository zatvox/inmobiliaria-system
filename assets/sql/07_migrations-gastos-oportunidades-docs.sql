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
