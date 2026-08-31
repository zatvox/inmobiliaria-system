-- ============================================================================
-- MIGRACION: catálogo completo de los 43 distritos de Lima Metropolitana.
-- Antes solo estaban sembrados "San Juan de Lurigancho" y "Ate" (los que
-- ya usan las 3 propiedades reales). Esta lista es la división político-
-- administrativa oficial de la provincia de Lima (INEI) — no depende de
-- ninguna librería externa, se mantiene como datos propios del sistema
-- para no añadir dependencias a un stack sin build step.
--
-- Ejecutar UNA VEZ, en cualquier momento. Usa ON CONFLICT DO NOTHING, así
-- que es seguro correrla aunque ya existan algunos distritos cargados.
-- ============================================================================

insert into catalogos (tipo, valor, orden) values
  ('distrito','Ancón',1),
  ('distrito','Ate',2),
  ('distrito','Barranco',3),
  ('distrito','Breña',4),
  ('distrito','Carabayllo',5),
  ('distrito','Chaclacayo',6),
  ('distrito','Chorrillos',7),
  ('distrito','Cieneguilla',8),
  ('distrito','Comas',9),
  ('distrito','El Agustino',10),
  ('distrito','Independencia',11),
  ('distrito','Jesús María',12),
  ('distrito','La Molina',13),
  ('distrito','La Victoria',14),
  ('distrito','Lima (Cercado)',15),
  ('distrito','Lince',16),
  ('distrito','Los Olivos',17),
  ('distrito','Lurigancho (Chosica)',18),
  ('distrito','Lurín',19),
  ('distrito','Magdalena del Mar',20),
  ('distrito','Miraflores',21),
  ('distrito','Pachacámac',22),
  ('distrito','Pucusana',23),
  ('distrito','Pueblo Libre',24),
  ('distrito','Puente Piedra',25),
  ('distrito','Punta Hermosa',26),
  ('distrito','Punta Negra',27),
  ('distrito','Rímac',28),
  ('distrito','San Bartolo',29),
  ('distrito','San Borja',30),
  ('distrito','San Isidro',31),
  ('distrito','San Juan de Lurigancho',32),
  ('distrito','San Juan de Miraflores',33),
  ('distrito','San Luis',34),
  ('distrito','San Martín de Porres',35),
  ('distrito','San Miguel',36),
  ('distrito','Santa Anita',37),
  ('distrito','Santa María del Mar',38),
  ('distrito','Santa Rosa',39),
  ('distrito','Santiago de Surco',40),
  ('distrito','Surquillo',41),
  ('distrito','Villa El Salvador',42),
  ('distrito','Villa María del Triunfo',43)
on conflict (tipo, valor) do nothing;

-- ============================================================================
-- FIN migrations-distritos-lima.sql
-- ============================================================================
