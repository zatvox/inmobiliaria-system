-- Cuotas con importe 0 (monto + mora = 0) no tienen nada que cobrar:
-- pasan automaticamente a 'pagada' (no quedan como pendiente/vencida).

-- 1) Corrige las existentes
update cuotas set estado = 'pagada'
where estado in ('pendiente', 'vencida', 'parcial')
  and coalesce(monto, 0) + coalesce(mora_aplicada, 0) <= 0;

-- 2) Trigger para las nuevas / editadas
create or replace function trg_fn_cuota_importe_cero()
returns trigger
language plpgsql
as $$
begin
  if new.estado in ('pendiente', 'vencida', 'parcial')
     and coalesce(new.monto, 0) + coalesce(new.mora_aplicada, 0) <= 0 then
    new.estado := 'pagada';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cuota_importe_cero on cuotas;
create trigger trg_cuota_importe_cero
  before insert or update on cuotas
  for each row execute function trg_fn_cuota_importe_cero();
