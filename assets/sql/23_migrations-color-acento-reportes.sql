-- ============================================================================
-- 23_migrations-color-acento-reportes.sql
-- Color del acento/borde que conecta visualmente el encabezado de cada
-- inmueble con sus filas de detalle en el módulo Reportes — configurable
-- desde Configuración, mismo patrón que color_lineas_tabla (18).
-- ============================================================================

alter table configuracion_sistema
  add column if not exists color_acento_reportes text not null default '#1B3A5C';

notify pgrst, 'reload schema';
