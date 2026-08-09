# ARCHITECTURE — Sistema de Gestión Inmobiliaria

Documentación técnica de la Fase 1. Complementa `SPECS-SISTEMA-INMUEBLES.md` (especificación funcional original) y `docs/ADDENDUM-SECCIONES-SERVICIOS.md` (decisiones nuevas: Secciones, Agentes/Comisiones, módulo Cálculo de Servicios).

## 1. Patrón de capas (three-layer, vanilla JS)

```
┌──────────────────────────────────────────────────────────┐
│ UI LAYER  (dashboard.js, inmuebles.js, personas.js, ...)  │
│  - Manejo del DOM, eventos, render de tablas/tarjetas     │
└───────────────────────┬────────────────────────────────────┘
                         │
┌───────────────────────▼────────────────────────────────────┐
│ DATA LAYER  (supabase-data.js)                              │
│  - Queries y mutaciones a Supabase, una función por caso    │
│  - No conoce el DOM; siempre retorna datos u lanza errores  │
└───────────────────────┬────────────────────────────────────┘
                         │
┌───────────────────────▼────────────────────────────────────┐
│ CLIENT LAYER  (supabase-client.js)                           │
│  - Instancia única (singleton) del cliente Supabase          │
└──────────────────────────────────────────────────────────────┘
```

`auth.js` vive en paralelo: gestiona sesión (Supabase Auth) y resuelve el rol del usuario actual (`usuarios_roles`) una vez por carga de página. `main.js` usa `auth.js` para construir el "shell" (sidebar + topbar) que comparten todas las páginas protegidas.

## 2. Modelo de datos (resumen Fase 1 — esquema completo en `schema.sql`)

```
personas ──┬── personas_roles (comprador / inquilino / propietario / lead / agente / proveedor)
           │
propiedades (predio/edificio físico)
   ├── propiedades_fotos
   ├── propiedades_documentos
   └── secciones (unidad real: piso / depto / dúplex / lote / oficina / almacén / local)
          ├── secciones_fotos
          ├── historial_precios
          ├── contratos_alquiler ── inquilino (→ personas) ── agente (→ personas, opcional)
          ├── contratos_venta ──── comprador (→ personas) ── agente (→ personas, opcional)
          ├── oportunidades_venta (pipeline)
          └── medidores (propios de la sección) ── lecturas_medidores

propiedades ── medidores (generales, uno por servicio) ── recibos_generales_servicio
                                                        └── calculo_servicios_periodo
                                                               └── calculo_servicios_detalle (por sección)
                                                                      └── cuotas (origen='servicio')

contratos_venta / contratos_alquiler ── cuotas (origen='venta'/'alquiler') ── pagos
comisiones_agentes ── agente (→ personas) + referencia lógica a contrato de venta/alquiler
```

**Por qué "Secciones" y no solo "Propiedades":** varios inmuebles de Luis son edificios con múltiples unidades independientes (ej. un edificio de 6 pisos con 5 contratos distintos). Anclar todo a "propiedad" habría mezclado 5 inquilinos, 5 contratos y 5 cálculos de consumo bajo un mismo registro. Con "sección" cada unidad tiene su propio ciclo de vida comercial, mientras que la propiedad concentra lo que es común al edificio entero (dirección, título, medidor general, recibo general del servicio).

**Por qué el módulo de Servicios genera `cuotas` en vez de una tabla propia de cobros:** para que Cobranzas y Pagos —ya diseñados para cuotas de renta/venta— funcionen igual para servicios sin duplicar lógica de estados (pendiente/pagada/parcial/vencida), vouchers, verificación, etc. El campo `cuotas.origen` distingue el tipo, y la UI de Cobranzas (Fase 3) los muestra en un tab separado.

## 3. Seguridad (RLS)

- **Deny by default**: RLS activo en todas las tablas de negocio; sin política explícita, nadie ve ni escribe nada.
- **Roles**: función `auth_rol()` (SQL, `security definer`) resuelve el rol del usuario autenticado desde `usuarios_roles`.
- **administrador**: acceso total (`ALL`) en todas las tablas.
- **operador**: lectura en catálogos/propiedades/secciones/personas/contratos; lectura+escritura (sin borrar) en Cobranzas, Pagos y el módulo Cálculo de Servicios — igual criterio que `SPECS-SISTEMA-INMUEBLES.md` sección 12, extendido a Servicios porque es trabajo operativo de campo (tomar lecturas, subir fotos).
- **Storage**: bucket `inmuebles` privado; políticas sobre `storage.objects` replican el mismo criterio de rol.
- Ningún secreto vive en el repo: la `anon key` es pública por diseño de Supabase y depende de RLS para ser segura (nunca se usa la `service_role key` en el frontend).

## 4. Automatizaciones en base de datos (evitan lógica de negocio duplicada en el cliente)

- `generar_cuotas_alquiler(contrato_id)`: al insertar un `contrato_alquiler` con `estado = 'vigente'`, un trigger genera automáticamente el cronograma de cuotas mensuales (hasta `fecha_fin` o 12 meses por defecto).
- Trigger sobre `contratos_alquiler`: marca la `seccion` como `alquilado` automáticamente.
- Trigger sobre `contratos_venta`: marca la `seccion` como `vendido` (si `completado`) o `reservado` (si `vigente`).
- `consumo_calculado` en `lecturas_medidores` es una columna generada (`lectura_actual - lectura_anterior`) — nunca se calcula ni se corrige a mano en el cliente.

Regla de diseño (heredada de `PLANTILLA-MAESTRA-ARQUITECTURA-SISTEMAS.md`): todo lo que sea dinero o estado crítico vive en el servidor (SQL/triggers), nunca solo en JavaScript del navegador.

## 5. Decisiones de esta fase (mini-ADRs)

**Fotos y documentos vía Storage privado + signed URLs**
Contexto: se necesitaba mostrar fotos de propiedades sin exponer un bucket público. Decisión: bucket privado, URLs firmadas con expiración de 1 hora generadas bajo demanda (`getSignedUrl`). Alternativas descartadas: bucket público (expondría fotos de inmuebles y comprobantes de pago a cualquiera con el link). Consecuencia: una llamada extra por foto al renderizar, aceptable para los volúmenes de este sistema.

**IDs de seed hardcodeados en vez de CTEs encadenados**
Contexto: `seed.sql` necesita referenciar entre sí personas, propiedades, secciones y contratos. Decisión: UUIDs generados una vez y escritos como literales, en vez de encadenar múltiples `INSERT ... RETURNING` en un solo `WITH`. Consecuencia: el script es mucho más legible y fácil de editar a mano; el costo es que hay que generar UUIDs nuevos si se agregan más filas del mismo patrón.

**Datos reales del seed marcados como "por confirmar" en vez de omitidos**
Contexto: Luis dio información de memoria con dudas explícitas ("creo", "parece que"). Decisión: cargar el dato tal como se dio, pero con una nota visible en el registro (`notas`) explicando la duda — nunca inventar un dato no proporcionado (RUC, DNI, fechas exactas de contrato). Consecuencia: el sistema arranca con datos utilizables de inmediato, y las inconsistencias quedan visibles en vez de escondidas.

## 6. Próximos pasos técnicos (Fase 2 en adelante)

- Contratos: formularios de alta con validación de sección disponible, generación del cronograma de cuotas ya soportada por el trigger existente.
- Cobranzas/Pagos: vista de calendario mensual, tab "Servicios" filtrando `cuotas.origen = 'servicio'`, subida de vouchers/comprobantes.
- Cálculo de Servicios: pantallas de medidores (alta con foto), lecturas mensuales, registro de recibo general, y el botón "Calcular período" que genera `calculo_servicios_detalle` + `cuotas` por sección.
- Configuración: pantallas para editar `tipos_servicio`, `configuracion` (mora, numeración) y `catalogos` sin tocar SQL directamente.
