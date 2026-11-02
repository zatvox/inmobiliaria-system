-- ============================================================================
-- 29 · Correlativo único por cuota (ALQ1-0001, SAGUA1-0001, SLUZ1-0001 …)
--
-- Reglas:
--  · Una serie por TIPO de cuota (ALQ = alquiler; S + nombre del servicio) y por
--    PROPIETARIO de la propiedad. Prefijo = base + ordinal del propietario
--    (primer propietario = 1 → ALQ1, SAGUA1, SLUZ1; el segundo → ALQ2 …).
--  · El número se asigna al CONFIRMAR la primera impresión (no al crear la cuota),
--    de forma atómica y sin reutilizarse jamás. Una cuota con número conserva su
--    número aunque se reimprima o se anule (el papel físico sigue existiendo).
--  · Control del archivador: impresa_at / n_impresiones, archivada_at (papel ya
--    guardado en "cancelados") y papel_retirado_at (papel de cuota anulada ya
--    sacado del archivador).
-- Ejecutar completo en el SQL Editor de Supabase. Es re-ejecutable.
-- ============================================================================

-- 1) Columnas nuevas en cuotas ------------------------------------------------
alter table cuotas add column if not exists nro_cobro text;
alter table cuotas add column if not exists nro_cobro_serie text;
alter table cuotas add column if not exists nro_cobro_at timestamptz;
alter table cuotas add column if not exists impresa_at timestamptz;
alter table cuotas add column if not exists n_impresiones int not null default 0;
alter table cuotas add column if not exists archivada_at timestamptz;
alter table cuotas add column if not exists papel_retirado_at timestamptz;

create unique index if not exists uq_cuotas_nro_cobro on cuotas(nro_cobro) where nro_cobro is not null;
create index if not exists idx_cuotas_nro_serie on cuotas(nro_cobro_serie);

-- 2) Ordinal por propietario y contadores por serie --------------------------
create table if not exists cobro_propietarios (
  owner_key text primary key,              -- id del propietario (o 'sin-propietario')
  propietario_id uuid references personas(id),
  ordinal int not null unique
);

create table if not exists cobro_series (
  prefijo text primary key,                -- ALQ1, SAGUA1, SLUZ1 …
  owner_key text not null references cobro_propietarios(owner_key),
  tipo_clave text not null,                -- 'ALQ' o 'S<NOMBRE>'
  ultimo int not null default 0,
  digitos int not null default 4
);

alter table cobro_propietarios enable row level security;
alter table cobro_series enable row level security;
drop policy if exists cobro_prop_select on cobro_propietarios;
create policy cobro_prop_select on cobro_propietarios for select using (true);
drop policy if exists cobro_series_select on cobro_series;
create policy cobro_series_select on cobro_series for select using (true);

-- 3) Resolver tipo de serie y propietario de una cuota ------------------------
create or replace function _cobro_contexto(p_cuota_id uuid)
returns table (tipo_clave text, propietario_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origen text;
  v_contrato uuid;
  v_detalle uuid;
  v_nombre text;
  v_prop uuid;
begin
  select origen, contrato_id, calculo_servicio_detalle_id
    into v_origen, v_contrato, v_detalle
  from cuotas where id = p_cuota_id;

  if v_origen = 'alquiler' then
    select p.propietario_id into v_prop
    from contratos_alquiler c
    join secciones s on s.id = c.seccion_id
    join propiedades p on p.id = s.propiedad_id
    where c.id = v_contrato;
    return query select 'ALQ'::text, v_prop;
  elsif v_origen = 'servicio' then
    select ts.nombre, p.propietario_id into v_nombre, v_prop
    from calculo_servicios_detalle d
    join calculo_servicios_periodo cp on cp.id = d.calculo_periodo_id
    join tipos_servicio ts on ts.id = cp.tipo_servicio_id
    join propiedades p on p.id = cp.propiedad_id
    where d.id = v_detalle;
    -- Agua → SAGUA, Luz → SLUZ, Gas → SGAS …
    return query select 'S' || left(upper(regexp_replace(
        translate(coalesce(v_nombre, 'X'), 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu'), '[^A-Za-z]', '', 'g')), 6), v_prop;
  else
    return;  -- venta u otros: sin correlativo de cobro
  end if;
end;
$$;

-- 4) Vista previa del número (solo lectura, para el diálogo de confirmación) --
create or replace function previsualizar_nro_cobro(p_cuota_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nro text; v_tipo text; v_prop uuid; v_key text; v_ord int; v_pref text; v_ult int; v_dig int;
begin
  select nro_cobro into v_nro from cuotas where id = p_cuota_id;
  if v_nro is not null then return v_nro; end if;
  select tipo_clave, propietario_id into v_tipo, v_prop from _cobro_contexto(p_cuota_id);
  if v_tipo is null then return null; end if;
  v_key := coalesce(v_prop::text, 'sin-propietario');
  select ordinal into v_ord from cobro_propietarios where owner_key = v_key;
  if v_ord is null then select coalesce(max(ordinal), 0) + 1 into v_ord from cobro_propietarios; end if;
  v_pref := v_tipo || v_ord;
  select ultimo, digitos into v_ult, v_dig from cobro_series where prefijo = v_pref;
  return v_pref || '-' || lpad((coalesce(v_ult, 0) + 1)::text, coalesce(v_dig, 4), '0');
end;
$$;

-- 5) Asignar el número (idempotente y atómico) -------------------------------
create or replace function asignar_nro_cobro(p_cuota_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c cuotas%rowtype;
  v_tipo text; v_prop uuid; v_key text; v_ord int; v_pref text; v_n int; v_dig int; v_nro text;
begin
  select * into c from cuotas where id = p_cuota_id for update;
  if not found then raise exception 'La cuota no existe.'; end if;
  if c.nro_cobro is not null then return c.nro_cobro; end if;   -- ya numerada: mismo número siempre
  if c.estado = 'anulada' then raise exception 'No se puede numerar una cuota anulada.'; end if;
  if coalesce(c.monto, 0) + coalesce(c.mora_aplicada, 0) <= 0 then
    raise exception 'La cuota tiene importe 0: no hay nada que cobrar ni imprimir.';
  end if;

  select tipo_clave, propietario_id into v_tipo, v_prop from _cobro_contexto(p_cuota_id);
  if v_tipo is null then raise exception 'Solo las cuotas de alquiler y servicio llevan correlativo.'; end if;

  v_key := coalesce(v_prop::text, 'sin-propietario');
  -- Serializa la creación de propietarios/series nuevas.
  perform pg_advisory_xact_lock(hashtext('cobro_series'));
  select ordinal into v_ord from cobro_propietarios where owner_key = v_key;
  if v_ord is null then
    select coalesce(max(ordinal), 0) + 1 into v_ord from cobro_propietarios;
    insert into cobro_propietarios (owner_key, propietario_id, ordinal) values (v_key, v_prop, v_ord);
  end if;
  v_pref := v_tipo || v_ord;
  insert into cobro_series (prefijo, owner_key, tipo_clave) values (v_pref, v_key, v_tipo)
  on conflict (prefijo) do nothing;

  update cobro_series set ultimo = ultimo + 1 where prefijo = v_pref
  returning ultimo, digitos into v_n, v_dig;

  v_nro := v_pref || '-' || lpad(v_n::text, v_dig, '0');
  update cuotas set nro_cobro = v_nro, nro_cobro_serie = v_pref, nro_cobro_at = now() where id = p_cuota_id;
  return v_nro;
end;
$$;

-- 6) Registrar una impresión (1.ª o reimpresión) -----------------------------
create or replace function registrar_impresion_cuota(p_cuota_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  update cuotas
     set impresa_at = coalesce(impresa_at, now()), n_impresiones = n_impresiones + 1
   where id = p_cuota_id
   returning n_impresiones into v_n;
  return v_n;
end;
$$;

grant execute on function _cobro_contexto(uuid) to anon, authenticated;
grant execute on function previsualizar_nro_cobro(uuid) to anon, authenticated;
grant execute on function asignar_nro_cobro(uuid) to anon, authenticated;
grant execute on function registrar_impresion_cuota(uuid) to anon, authenticated;
