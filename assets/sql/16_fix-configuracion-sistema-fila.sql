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
