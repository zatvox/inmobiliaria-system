-- ============================================================================
-- 33 · Contratos de PRÉSTAMO con intereses
--  · contratos_prestamo : cabecera (prestamista, prestatario, aval, monto, nº cuotas,
--    tasa anual/mensual, fechas, garantía, estado, datos del documento).
--  · prestamo_cronograma: una fila por cuota (nro, fecha, cuota, capital, interés,
--    saldo capital) enlazada a su cuota por cobrar (cuotas.origen = 'prestamo').
--  · Serie de cobro PRES (PRES1-0001 …), dueña = prestamista.
-- Requiere SQL 29, 30 y 31. Re-ejecutable.
-- ============================================================================

-- 0) Nuevos roles de persona: prestamista y prestatario ------------------------
alter table personas_roles drop constraint if exists personas_roles_rol_check;
alter table personas_roles add constraint personas_roles_rol_check
  check (rol in ('comprador','inquilino','propietario','lead','agente','proveedor','aval','prestamista','prestatario'));

-- 1) Cabecera ------------------------------------------------------------------
create table if not exists contratos_prestamo (
  id uuid primary key default gen_random_uuid(),
  prestamista_id uuid not null references personas(id),
  prestatario_id uuid not null references personas(id),
  aval_id uuid references personas(id),
  moneda text not null default 'PEN' check (moneda in ('PEN','USD')),
  monto numeric(14,2) not null check (monto > 0),
  n_cuotas int not null check (n_cuotas >= 1),
  tasa_valor numeric(9,4) not null default 0 check (tasa_valor >= 0),   -- tal como se ingresó
  tasa_tipo text not null default 'mensual' check (tasa_tipo in ('anual','mensual')),
  tasa_mensual numeric(9,6) not null default 0,                          -- % mensual equivalente
  fecha_desembolso date not null,
  fecha_primera_cuota date not null,
  dia_vencimiento int check (dia_vencimiento between 1 and 31),
  garantia text,
  estado text not null default 'vigente' check (estado in ('vigente','cancelado','vencido','anulado')),
  notas text,
  datos_contrato jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_prestamo_prestatario on contratos_prestamo(prestatario_id);
create index if not exists idx_prestamo_prestamista on contratos_prestamo(prestamista_id);

-- 2) Cronograma ---------------------------------------------------------------
create table if not exists prestamo_cronograma (
  id uuid primary key default gen_random_uuid(),
  prestamo_id uuid not null references contratos_prestamo(id) on delete cascade,
  nro int not null,
  fecha_pago date not null,
  cuota numeric(14,2) not null,        -- monto a pagar = capital + interés
  capital numeric(14,2) not null,
  interes numeric(14,2) not null,
  saldo_capital numeric(14,2) not null,
  cuota_id uuid references cuotas(id),
  unique (prestamo_id, nro)
);
create index if not exists idx_prestamo_cron_prestamo on prestamo_cronograma(prestamo_id);

-- 3) Cuotas por cobrar: nuevo origen 'prestamo' -------------------------------
alter table cuotas drop constraint if exists cuotas_origen_check;
alter table cuotas add constraint cuotas_origen_check
  check (origen in ('venta','alquiler','servicio','mantenimiento','prestamo'));

-- 4) Serie PRES (color y prefijo editables en Configuración) ------------------
insert into cobro_tipos (tipo_clave, etiqueta, prefijo, color) values
  ('PRES', 'Préstamo', 'PRES', '#0F766E')
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
  elsif v_origen = 'prestamo' then
    select prestamista_id into v_prop from contratos_prestamo where id = v_contrato;
    return query select 'PRES'::text, v_prop;
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

-- 5) RLS (mismo nivel que contratos) + acceso abierto de desarrollo -----------
do $$
declare t text;
begin
  foreach t in array array['contratos_prestamo','prestamo_cronograma'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %I on %I;', t || '_rw', t);
    execute format($f$create policy %I on %I for all using (auth_rol() in ('administrador','operador')) with check (auth_rol() in ('administrador','operador'));$f$, t || '_rw', t);
    execute format('drop policy if exists dev_anon_all on %I;', t);
    execute format('create policy dev_anon_all on %I for all to anon using (true) with check (true);', t);
  end loop;
end $$;
