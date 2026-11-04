-- ============================================================================
-- 31 · Mantenimiento como CARPETA de trabajo
--  · mantenimientos (ya existe) pasa a ser la ficha del trabajo: equipo, problema,
--    diagnóstico, causa, solución, presupuesto, comisión del contratista, fechas.
--  · mantenimiento_gastos : partidas de gasto (mano de obra, material, repuesto,
--    taller, transporte…) con proveedor, estado estimado/confirmado y comprobante.
--  · mantenimiento_eventos: bitácora cronológica con fotos (reemplaza el WhatsApp).
--  · mantenimiento_reparto: quién paga qué (inquilinos + propietario), por m².
--    Cada parte de inquilino puede convertirse en una cuota de Cobranzas
--    (cuotas.origen = 'mantenimiento', serie MANT).
-- Requiere los SQL 29 y 30. Re-ejecutable.
-- ============================================================================

-- 1) Ficha del trabajo --------------------------------------------------------
alter table mantenimientos add column if not exists titulo text;
alter table mantenimientos add column if not exists equipo text;
alter table mantenimientos add column if not exists problema text;
alter table mantenimientos add column if not exists diagnostico text;
alter table mantenimientos add column if not exists causa text;
alter table mantenimientos add column if not exists solucion text;
alter table mantenimientos add column if not exists fecha_fin date;
alter table mantenimientos add column if not exists presupuesto_estimado numeric(12,2);
alter table mantenimientos add column if not exists comision_pct numeric(5,2) not null default 0;
alter table mantenimientos add column if not exists garantia_hasta date;

alter table mantenimientos drop constraint if exists mantenimientos_estado_check;
alter table mantenimientos add constraint mantenimientos_estado_check
  check (estado in ('planificado','en_proceso','finalizado','reportado','esperando_repuesto','terminado','informado'));

-- 2) Partidas de gasto --------------------------------------------------------
create table if not exists mantenimiento_gastos (
  id uuid primary key default gen_random_uuid(),
  mantenimiento_id uuid not null references mantenimientos(id) on delete cascade,
  fecha date not null default current_date,
  categoria text not null default 'material'
    check (categoria in ('mano_obra','servicio_taller','material','repuesto','transporte','otro')),
  descripcion text not null,
  proveedor text,
  cantidad numeric(12,3) not null default 1,
  monto numeric(12,2) not null default 0,              -- total de la partida
  estado text not null default 'confirmado' check (estado in ('estimado','confirmado')),
  comprobante_tipo text check (comprobante_tipo in ('factura','boleta','recibo','otro')),
  comprobante_nro text,
  comprobante_url text,
  notas text,
  created_at timestamptz not null default now()
);
create index if not exists idx_mant_gastos_mant on mantenimiento_gastos(mantenimiento_id);

-- 3) Bitácora -------------------------------------------------------------------
create table if not exists mantenimiento_eventos (
  id uuid primary key default gen_random_uuid(),
  mantenimiento_id uuid not null references mantenimientos(id) on delete cascade,
  fecha_hora timestamptz not null default now(),
  tipo text not null default 'nota'
    check (tipo in ('reporte','diagnostico','visita','traslado','compra','trabajo','incidencia','pago','nota')),
  nota text not null,
  foto_url text,
  created_at timestamptz not null default now()
);
create index if not exists idx_mant_eventos_mant on mantenimiento_eventos(mantenimiento_id, fecha_hora);

-- 4) Reparto --------------------------------------------------------------------
create table if not exists mantenimiento_reparto (
  id uuid primary key default gen_random_uuid(),
  mantenimiento_id uuid not null references mantenimientos(id) on delete cascade,
  tipo text not null check (tipo in ('inquilino','propietario')),
  contrato_alquiler_id uuid references contratos_alquiler(id),
  persona_id uuid references personas(id),
  nombre text not null,
  detalle text,                                        -- sección(es) que ocupa
  base_m2 numeric(10,2) not null default 0,
  porcentaje numeric(7,3) not null default 0,
  monto numeric(12,2) not null default 0,
  cuota_id uuid references cuotas(id),
  orden int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_mant_reparto_mant on mantenimiento_reparto(mantenimiento_id);

-- 5) Costos de la ficha = suma de las partidas ---------------------------------
create or replace function trg_fn_mant_recalcula_costos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  v_id := coalesce(new.mantenimiento_id, old.mantenimiento_id);
  update mantenimientos m set
    costo_mano_obra = coalesce((select sum(monto) from mantenimiento_gastos g where g.mantenimiento_id = v_id and g.categoria in ('mano_obra','servicio_taller')), 0),
    costo_materiales = coalesce((select sum(monto) from mantenimiento_gastos g where g.mantenimiento_id = v_id and g.categoria not in ('mano_obra','servicio_taller')), 0)
  where m.id = v_id;
  return null;
end;
$$;
drop trigger if exists trg_mant_gastos_costos on mantenimiento_gastos;
create trigger trg_mant_gastos_costos
  after insert or update or delete on mantenimiento_gastos
  for each row execute function trg_fn_mant_recalcula_costos();

-- 6) Cuotas de mantenimiento en Cobranzas --------------------------------------
alter table cuotas drop constraint if exists cuotas_origen_check;
alter table cuotas add constraint cuotas_origen_check check (origen in ('venta','alquiler','servicio','mantenimiento'));

insert into cobro_tipos (tipo_clave, etiqueta, prefijo, color) values
  ('MANT', 'Mantenimiento', 'MANT', '#7C3AED')
on conflict (tipo_clave) do nothing;

create or replace function _cobro_contexto(p_cuota_id uuid)
returns table (tipo_clave text, propietario_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origen text; v_contrato uuid; v_detalle uuid; v_nombre text; v_prop uuid;
begin
  select origen, contrato_id, calculo_servicio_detalle_id into v_origen, v_contrato, v_detalle
  from cuotas where id = p_cuota_id;

  if v_origen in ('alquiler', 'mantenimiento') then
    select p.propietario_id into v_prop
    from contratos_alquiler c
    join secciones s on s.id = c.seccion_id
    join propiedades p on p.id = s.propiedad_id
    where c.id = v_contrato;
    return query select case when v_origen = 'alquiler' then 'ALQ' else 'MANT' end::text, v_prop;
  elsif v_origen = 'servicio' then
    select ts.nombre, p.propietario_id into v_nombre, v_prop
    from calculo_servicios_detalle d
    join calculo_servicios_periodo cp on cp.id = d.calculo_periodo_id
    join tipos_servicio ts on ts.id = cp.tipo_servicio_id
    join propiedades p on p.id = cp.propiedad_id
    where d.id = v_detalle;
    return query select 'S' || left(upper(regexp_replace(
        translate(coalesce(v_nombre, 'X'), 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu'), '[^A-Za-z]', '', 'g')), 6), v_prop;
  else
    return;
  end if;
end;
$$;

-- 7) RLS (mismo nivel que mantenimientos) + acceso abierto de desarrollo --------
do $$
declare t text;
begin
  foreach t in array array['mantenimiento_gastos','mantenimiento_eventos','mantenimiento_reparto'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %I on %I;', t || '_rw', t);
    execute format($f$create policy %I on %I for all using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));$f$, t || '_rw', t);
    execute format('drop policy if exists dev_anon_all on %I;', t);
    execute format('create policy dev_anon_all on %I for all to anon using (true) with check (true);', t);
  end loop;
end $$;
