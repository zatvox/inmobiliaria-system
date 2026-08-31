-- ============================================================================
-- 18_migrations-color-lineas-tabla.sql
-- Color de las líneas de la tabla del "cuadro de consumo" (el recibo que se
-- le presenta al inquilino) — configurable desde Configuración en vez de
-- venir fijo en el código, por si más adelante se quiere otro estilo.
-- ============================================================================

alter table configuracion_sistema
  add column if not exists color_lineas_tabla text not null default '#D1D5DB';

notify pgrst, 'reload schema';
