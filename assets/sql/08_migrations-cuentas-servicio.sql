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
