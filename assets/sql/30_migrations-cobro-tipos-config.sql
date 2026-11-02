-- ============================================================================
-- 30 · Series y colores editables por tipo de cuota (Configuración)
--  · cobro_tipos: por cada tipo ('ALQ', 'SAGUA', 'SLUZ', …) el prefijo base de la
--    serie (solo letras, 2–8), el color del documento y los dígitos del número.
--  · El número final = prefijo + ordinal del propietario + '-' + correlativo
--    (ej. ALQ1-0001). Cambiar el prefijo NO toca los números ya emitidos: la
--    serie nueva empieza en 0001 (los contadores son por prefijo completo).
-- Re-ejecutable. Requiere el SQL 29.
-- ============================================================================
create table if not exists cobro_tipos (
  tipo_clave text primary key,
  etiqueta text,
  prefijo text not null check (prefijo ~ '^[A-Z]{2,8}$'),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  digitos int not null default 4 check (digitos between 3 and 8)
);

insert into cobro_tipos (tipo_clave, etiqueta, prefijo, color) values
  ('ALQ',   'Alquiler',        'ALQ',   '#1D4ED8'),
  ('SAGUA', 'Servicio · Agua', 'SAGUA', '#0891B2'),
  ('SLUZ',  'Servicio · Luz',  'SLUZ',  '#D97706')
on conflict (tipo_clave) do nothing;

alter table cobro_tipos enable row level security;
drop policy if exists cobro_tipos_select on cobro_tipos;
create policy cobro_tipos_select on cobro_tipos for select using (true);
drop policy if exists cobro_tipos_write on cobro_tipos;
create policy cobro_tipos_write on cobro_tipos for all to anon, authenticated using (true) with check (true);

-- Vista previa y asignación usando el prefijo/dígitos configurados --------------
create or replace function previsualizar_nro_cobro(p_cuota_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nro text; v_tipo text; v_prop uuid; v_key text; v_ord int; v_pref text; v_ult int; v_dig int; v_base text; v_digcfg int;
begin
  select nro_cobro into v_nro from cuotas where id = p_cuota_id;
  if v_nro is not null then return v_nro; end if;
  select tipo_clave, propietario_id into v_tipo, v_prop from _cobro_contexto(p_cuota_id);
  if v_tipo is null then return null; end if;
  v_key := coalesce(v_prop::text, 'sin-propietario');
  select ordinal into v_ord from cobro_propietarios where owner_key = v_key;
  if v_ord is null then select coalesce(max(ordinal), 0) + 1 into v_ord from cobro_propietarios; end if;
  select prefijo, digitos into v_base, v_digcfg from cobro_tipos where tipo_clave = v_tipo;
  v_pref := coalesce(v_base, v_tipo) || v_ord;
  select ultimo, digitos into v_ult, v_dig from cobro_series where prefijo = v_pref;
  return v_pref || '-' || lpad((coalesce(v_ult, 0) + 1)::text, coalesce(v_dig, v_digcfg, 4), '0');
end;
$$;

create or replace function asignar_nro_cobro(p_cuota_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c cuotas%rowtype;
  v_tipo text; v_prop uuid; v_key text; v_ord int; v_pref text; v_n int; v_dig int; v_nro text; v_base text; v_digcfg int;
begin
  select * into c from cuotas where id = p_cuota_id for update;
  if not found then raise exception 'La cuota no existe.'; end if;
  if c.nro_cobro is not null then return c.nro_cobro; end if;
  if c.estado = 'anulada' then raise exception 'No se puede numerar una cuota anulada.'; end if;
  if coalesce(c.monto, 0) + coalesce(c.mora_aplicada, 0) <= 0 then
    raise exception 'La cuota tiene importe 0: no hay nada que cobrar ni imprimir.';
  end if;

  select tipo_clave, propietario_id into v_tipo, v_prop from _cobro_contexto(p_cuota_id);
  if v_tipo is null then raise exception 'Solo las cuotas de alquiler y servicio llevan correlativo.'; end if;

  v_key := coalesce(v_prop::text, 'sin-propietario');
  perform pg_advisory_xact_lock(hashtext('cobro_series'));
  select ordinal into v_ord from cobro_propietarios where owner_key = v_key;
  if v_ord is null then
    select coalesce(max(ordinal), 0) + 1 into v_ord from cobro_propietarios;
    insert into cobro_propietarios (owner_key, propietario_id, ordinal) values (v_key, v_prop, v_ord);
  end if;
  select prefijo, digitos into v_base, v_digcfg from cobro_tipos where tipo_clave = v_tipo;
  v_pref := coalesce(v_base, v_tipo) || v_ord;
  insert into cobro_series (prefijo, owner_key, tipo_clave, digitos) values (v_pref, v_key, v_tipo, coalesce(v_digcfg, 4))
  on conflict (prefijo) do nothing;

  update cobro_series set ultimo = ultimo + 1 where prefijo = v_pref
  returning ultimo, digitos into v_n, v_dig;

  v_nro := v_pref || '-' || lpad(v_n::text, v_dig, '0');
  update cuotas set nro_cobro = v_nro, nro_cobro_serie = v_pref, nro_cobro_at = now() where id = p_cuota_id;
  return v_nro;
end;
$$;

grant execute on function previsualizar_nro_cobro(uuid) to anon, authenticated;
grant execute on function asignar_nro_cobro(uuid) to anon, authenticated;
