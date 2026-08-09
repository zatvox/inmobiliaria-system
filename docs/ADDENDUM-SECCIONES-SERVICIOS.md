# ADDENDUM — Secciones, Agentes y Módulo "Cálculo de Servicios"

> Complementa `SPECS-SISTEMA-INMUEBLES.md`. Nace de la conversación del 2026-08-04 donde Luis detalló cómo administra en la práctica el consumo de luz/agua de sus inmuebles y compartió datos reales de 3 propiedades. Este documento es la fuente de verdad de estas 3 decisiones nuevas y va antes del código, según la regla 5 de `PLANTILLA-MAESTRA-ARQUITECTURA-SISTEMAS.md`.

---

## 1. Concepto nuevo: SECCIONES

Un inmueble (`propiedades`) deja de ser la unidad mínima rentable/vendible. Ahora es el **predio o edificio físico**, y dentro de él se crean **secciones**: la unidad real que se alquila, se vende o se le calcula consumo.

- Una sección puede ser un piso completo, un departamento dentro de un piso, un dúplex, un lote, una oficina, un almacén, etc. (`tipo_seccion`).
- Cada sección tiene su propio estado comercial (`disponible/en_alquiler/alquilado/en_venta/vendido/reservado/inactivo`), precio y — lo nuevo — puede tener **medidor propio de luz y/o agua opcional** (`tiene_medidor_propio_luz`, `tiene_medidor_propio_agua`). Si no lo tiene, se le cobra por tarifa fija por persona.
- Los contratos de alquiler/venta y las oportunidades de venta ahora se anclan a `seccion_id`, no a `propiedad_id` directamente.
- Ejemplo real (Av. República de Polonia 721): 1 propiedad = el edificio de 6 pisos → 5 secciones (dúplex piso 1-2, depto piso 3-A, depto piso 3-B, piso 4-5, piso 6).

## 2. Agentes inmobiliarios y comisiones

Se agrega el rol `agente` en `personas_roles` (mismo catálogo de personas reutilizable) y una tabla `comisiones_agentes` que liga un agente a un contrato de venta o alquiler específico, con monto o porcentaje pactado y su propio estado de pago (`pendiente/pagada/anulada`) y comprobante. Así la comisión queda trazable igual que cualquier otro pago, sin mezclarse con la renta que paga el inquilino.

## 3. Módulo "Cálculo de Servicios" (luz, agua y otros)

Módulo propio, independiente en su operación diaria pero conectado a Cobranzas/Pagos para no duplicar el registro de dinero. Cubre dos flujos de dinero distintos que antes se mezclaban en la conversación y que el sistema separa con claridad:

**A. Lo que la empresa le paga a la compañía de luz/agua (gasto/salida)**
Cada mes llega un recibo general por *propiedad* (no por sección). Se registra en `recibos_generales_servicio`: monto total, consumo total del recibo (si aplica), foto del recibo, y — al pagarlo — foto del voucher/comprobante y fecha. De aquí sale el **precio unitario** (S/ por kWh o por m3) que se usa para prorratear a cada sección.

**B. Lo que cada inquilino le paga a la empresa por su consumo (cobranza/entrada)**
1. Se registra la lectura mensual de cada medidor (`lecturas_medidores`): lectura anterior, lectura actual, foto del medidor. El consumo se calcula solo (columna generada).
2. Para secciones **sin medidor propio**: en vez de lectura, se ingresa la cantidad de personas del mes y se usa la tarifa por persona configurada en `tipos_servicio` (ej. S/20/persona, editable en Configuración).
3. Con la lectura (o el conteo de personas) + el precio unitario del recibo general, se corre el **cálculo del período** (`calculo_servicios_periodo` + `calculo_servicios_detalle`, uno por propiedad+servicio+mes): un detalle por sección con el monto que le corresponde pagar a ese inquilino.
4. Cada línea de detalle genera automáticamente una **cuota** (`cuotas.origen = 'servicio'`) ligada al inquilino — esta cuota aparece en el módulo de **Cobranzas** dentro de un tab **"Servicios"** (junto a las cuotas de renta/venta, pero filtrables por separado), y su pago se registra igual que cualquier otro pago: voucher de depósito/transferencia + foto del recibo de cobranza firmado por el gerente.

**Catálogo de tipos de servicio (`tipos_servicio`)** — no se limita a luz/agua. Incluye gas, internet/wifi, telefonía/celular, cable, u otro que Luis agregue. Cada tipo define, editable desde Configuración:
- `unidad_medida` (kWh, m3, N/A)
- `prorrateable_por_consumo` (true = se calcula por lectura y se cobra a inquilinos; false = gasto fijo de la propiedad, solo se guarda el recibo/foto, no se prorratea)
- `permite_tarifa_fija_por_persona` (para secciones sin medidor)
- `tarifa_por_persona_default`
- `dia_corte_mensual` (19 para luz, 10 para agua, configurable para el resto)

Seed inicial: Luz (kWh, prorrateable, corte 19), Agua (m3, prorrateable, corte 10), Gas / Internet-Wifi / Telefonía-Celular / Cable (por defecto gasto fijo sin prorrateo — se puede activar el prorrateo por sección si Luis lo necesita para alguna propiedad puntual).

**Fotos y evidencia:** toda la cadena queda respaldada con imagen — foto del medidor en cada lectura, foto del recibo general, foto del voucher de depósito/transferencia del inquilino, y foto del recibo de cobranza firmado por el gerente confirmando el ingreso (efectivo o cuenta bancaria). Todo vía Supabase Storage, igual patrón que el resto del sistema.

## 4. Datos reales recibidos (para seed y verificación)

Luis compartió esta información de memoria — se carga en `seed.sql` pero varios montos están marcados como **por confirmar** porque él mismo los dio con dudas ("creo", "parece que"). Revisar y corregir directamente en el módulo Inmuebles una vez esté disponible.

| Propiedad | Sección | Inquilino | Renta | Certeza |
|---|---|---|---|---|
| Av. República de Polonia 721, SJL | Piso 1-2 (dúplex) | Alizon | S/ 5,000 | Contrato **pendiente de renovar** |
| Av. República de Polonia 721, SJL | Depto Piso 3 (A) ~120m² | Antonio | S/ 1,400 | OK |
| Av. República de Polonia 721, SJL | Depto Piso 3 (B) ~120m² | Rubén | S/ 1,300 | **"Creo" — confirmar** |
| Av. República de Polonia 721, SJL | Piso 4-5 | Alex | S/ 3,600 | OK |
| Av. República de Polonia 721, SJL | Piso 6 | Alex (¿mismo inquilino?) | S/ 1,250 | **"Parece que" — confirmar si es el mismo Alex y el monto exacto, contrato reciente** |
| Av. Santa Rosa de Lima Mz. S, SJL | Lote 15 / Lote 14 / Lote 07 | Negocios varios (sin nombre) | — | **Pendiente: nombre de inquilino y renta de cada lote** |
| Calle Ámsterdam 280, Ate | Dúplex (piso 1-2) + 3 departamentos | — | — | **Pendiente: pisos exactos, áreas, inquilinos si están ocupados** |

También pendiente: quién es la `empresa` activa para esta cartera (¿Jhiro Perú S.A.C., Benji Billion E.I.R.L., o una entidad nueva del rubro inmobiliario?) y los datos del `propietario` (persona/empresa dueña de cada predio) — no se fabricó ningún dato de RUC/DNI, queda para completar en Configuración/Personas.

## 5. Impacto en el modelo de datos original

- `propiedades` deja de tener `estado`/`precio_venta`/`precio_alquiler` propios — esos campos se mueven a `secciones`.
- `contratos_venta`, `contratos_alquiler`, `oportunidades_venta`, `historial_precios` ahora referencian `seccion_id` en vez de `propiedad_id`.
- `cuotas.origen` gana el valor `'servicio'` además de `'venta'`/`'alquiler'`, con referencia a `calculo_servicios_detalle_id`.
- Tablas nuevas: `secciones`, `secciones_fotos`, `comisiones_agentes`, `tipos_servicio`, `medidores`, `lecturas_medidores`, `recibos_generales_servicio`, `calculo_servicios_periodo`, `calculo_servicios_detalle`.

## 6. Plan de fases (acordado con Luis: entrega por fases, revisando módulo por módulo)

1. **Fase 1 (esta entrega):** esquema completo de Supabase (todas las tablas de arriba) + RLS + datos semilla de las 3 propiedades reales + scaffold del proyecto + módulo **Inmuebles y Secciones** + módulo **Personas** funcionando end-to-end.
2. **Fase 2:** Contratos (alquiler y venta) + generación automática de cuotas.
3. **Fase 3:** Cobranzas + Pagos (con tab Servicios) + módulo Cálculo de Servicios (medidores/lecturas/recibos/cálculo).
4. **Fase 4:** Ventas (pipeline), Documentos, Reportes.
5. **Fase 5:** Configuración completa (plantillas de contrato con editor visual + generación de PDF), Usuarios y Roles, Notificaciones.

Cada fase se revisa con Luis antes de avanzar a la siguiente.
