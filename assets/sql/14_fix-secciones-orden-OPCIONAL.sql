-- fix-secciones-orden.sql
-- Corrige el error "column secciones.orden does not exist" (HTTP 400) que
-- aparece al abrir el selector de secciones en Servicios/Gastos.
-- Causa: la tabla `secciones` en la base de datos real no tiene la columna
-- `orden` que sí existe en schema.sql (probablemente se creó antes de que
-- esa columna se agregara al esquema). Este script es seguro de correr
-- aunque la columna ya exista (no hace nada en ese caso).

alter table secciones add column if not exists orden int not null default 0;

-- Por si acaso, verifica también estas otras tablas que se ordenan por
-- "orden" en el frontend (no debería faltar, pero no cuesta confirmarlo):
alter table catalogos add column if not exists orden int not null default 0;
alter table tipos_servicio add column if not exists orden int not null default 0;
alter table propiedades_fotos add column if not exists orden int not null default 0;

-- Refresca el cache de esquema de PostgREST para que reconozca la columna
-- nueva de inmediato (si no, puede tardar unos minutos en notarlo solo).
notify pgrst, 'reload schema';
