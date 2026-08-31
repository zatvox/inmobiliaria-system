-- ============================================================================
-- MIGRACION: rol "aval" en personas + campo opcional de aval en contratos.
-- Ejecutar UNA VEZ, en cualquier momento despues de schema.sql (no depende
-- de migrations-fase2-fase3.sql, pero no hace daño correrla despues).
-- ============================================================================

-- 1. Permitir el rol 'aval' en personas_roles (antes solo: comprador,
--    inquilino, propietario, lead, agente, proveedor).
alter table personas_roles drop constraint if exists personas_roles_rol_check;
alter table personas_roles add constraint personas_roles_rol_check
  check (rol in ('comprador','inquilino','propietario','lead','agente','proveedor','aval'));

-- 2. Columna opcional aval_id en contratos de alquiler y de venta. Un aval es
--    una persona (normalmente con rol 'aval', aunque no se obliga a nivel de
--    base de datos) que respalda al inquilino/comprador del contrato.
alter table contratos_alquiler
  add column if not exists aval_id uuid references personas(id);
alter table contratos_venta
  add column if not exists aval_id uuid references personas(id);

-- ============================================================================
-- FIN migrations-rol-aval.sql
-- ============================================================================
