# SETUP — Guía de configuración inicial

Sigue estos pasos en orden. Tiempo estimado: 20-30 minutos la primera vez.

> ⚡ **Login desactivado por ahora (modo desarrollo).** `AUTH_ENABLED = false` en `assets/js/config.js` — el sistema entra directo al dashboard, sin pantalla de login (uso interno mientras se termina de construir). Si tu sesión de Supabase Auth ya está activa en el navegador (por ejemplo porque ya iniciaste sesión antes), RLS sigue funcionando normal con tu rol real. Si abres el sistema desde un navegador **sin sesión activa** (otro dispositivo, modo incógnito, o borraste el localStorage), no vas a ver datos hasta que corras `assets/sql/dev-open-access.sql` (abre RLS al rol `anon` — ver la advertencia de seguridad dentro de ese archivo) o vuelvas a activar el login real (`AUTH_ENABLED = true`, el flujo de "magic link" ya está listo en `auth.js`/`pages/login.html`).

## 1. Crear el proyecto en Supabase

1. Entra a [supabase.com](https://supabase.com) y crea una cuenta (o inicia sesión).
2. **New Project** → elige un nombre (ej. `inmobiliaria-luis`), una contraseña de base de datos segura (guárdala en un lugar seguro) y la región más cercana a Perú (`South America (São Paulo)` si está disponible).
3. Espera 1-2 minutos a que aprovisione el proyecto.

## 2. Correr el esquema, RLS y datos semilla

En el panel de Supabase, ve a **SQL Editor** → **New query**, y ejecuta los archivos **en este orden exacto** (copia y pega el contenido completo de cada uno, un archivo por query, y dale "Run"):

Todos los archivos de `assets/sql/` llevan un número correlativo en el nombre (`01_`, `02_`...) que indica el orden exacto en que se deben correr — sigue ese número, no el orden alfabético por tema:

1. `assets/sql/01_schema.sql` — crea todas las tablas, triggers y funciones.
2. `assets/sql/02_rls-policies.sql` — activa Row Level Security y las políticas por rol.
3. `assets/sql/03_seed.sql` — carga los catálogos, tipos de servicio y las 3 propiedades reales.
4. `assets/sql/04_migrations-fase2-fase3.sql` — funciones y triggers de Fase 2/3: generación de cuotas de venta, recálculo de estado de cuotas al pagar, mora sobre vencidas, y el cálculo de servicios (RPC `calcular_periodo_servicio`). **Obligatorio** para que los módulos Contratos, Cobranzas y Cálculo de Servicios funcionen.
5. `assets/sql/05_migrations-rol-aval.sql` — rol "aval" en Personas + campo opcional en Contratos.
6. `assets/sql/06_migrations-distritos-lima.sql` — catálogo con los 43 distritos de Lima Metropolitana (opcional pero recomendado).
7. `assets/sql/07_migrations-gastos-oportunidades-docs.sql` — módulos de Fase 4: renombra `oportunidades_venta` a `oportunidades` (con tipo venta/alquiler), crea `mantenimientos` + `mantenimientos_comprobantes` + `tributos_municipales`, y agrega partida registral / código PU-HR a Secciones. **Obligatorio** para Oportunidades y Gastos y Mantenimiento.
8. `assets/sql/08_migrations-cuentas-servicio.sql` — crea `cuentas_servicio` (para propiedades con varias cuentas de agua/luz independientes, ej. Lt14/Lt15/Lt7 en Santa Rosa de Lima) y permite varios recibos generales por propiedad/servicio/periodo. **Obligatorio** para Cálculo de Servicios en propiedades con más de una cuenta por servicio.
9. `assets/sql/09_migrations-medidores-compartidos.sql` — permite marcar un medidor como "compartido" entre varias secciones (ej. un baño común entre 2 locales) con reparto por porcentaje. **Obligatorio** si tienes medidores usados por más de una sección.
10. `assets/sql/10_migrations-cobranza-servicios-combinada.sql` — separa "calcular una cuenta" de "generar la cobranza": ahora se puede calcular Lt14, Lt15 y Baño por separado y recién al final generar UNA sola cuota combinada por inquilino. **Obligatorio** para Cálculo de Servicios (reemplaza la función `calcular_periodo_servicio` y agrega `generar_cobranzas_servicio`).
11. `assets/sql/11_migrations-precio-editable-cuadro.sql` — permite editar el precio S/ por m3/kWh al calcular una cuenta (antes era fijo, tomado del recibo general). **Obligatorio** para poder corregir el precio unitario desde el tab Cálculo.
12. `assets/sql/12_migrations-configuracion-sistema.sql` — crea `configuracion_sistema` (tabla de variables globales: precio default de agua/luz, moneda, mora) para el nuevo módulo Configuración. **Obligatorio** para que la pantalla de Configuración (⚙️ en el header) funcione.
13. `assets/sql/13_migrations-deshacer-calculo-servicio.sql` — agrega `eliminar_cuota_servicio` y `deshacer_calculo_servicio`, para poder corregir una lectura después de haber calculado una cuenta o generado su cobranza (ver "Corregir una lectura ya calculada" más abajo). **Obligatorio** para los botones "Deshacer cálculo" (Cálculo) y "Eliminar" (Cobranzas).

14. `assets/sql/16_fix-configuracion-sistema-fila.sql` — corrige el error "406 / Cannot coerce the result to a single JSON object" al guardar en Configuración (la fila única de `configuracion_sistema` no se había creado). **Obligatorio si ya corriste el paso 12 antes de esta corrección.**
15. `assets/sql/17_migrations-lecturas-por-fecha.sql` — las lecturas ya no se organizan por "periodo" elegido a mano: se agrega `fecha_lectura_anterior` y un trigger calcula `periodo` solo, a partir del mes de la fecha de lectura actual. **Obligatorio** para que "Registrar lectura" funcione con los nuevos campos de fecha.
16. `assets/sql/18_migrations-color-lineas-tabla.sql` — agrega `color_lineas_tabla` a Configuración, para poder cambiar el color de las líneas del cuadro de consumo (por defecto gris). **Obligatorio** para el campo de color en Configuración.
17. `assets/sql/19_migrations-montos-fijos-contrato.sql` — agrega `n_ocupantes` a `contratos_alquiler` y la tabla `contratos_alquiler_servicios_fijos` (monto fijo mensual de agua/luz/etc. por contrato, para locales sin medidor propio como los de Edificio Polonia). También habilita `metodo = 'monto_fijo'` en `calculo_servicios_detalle`. **Obligatorio** para el editor de "Montos fijos de servicios" en Contratos y para que el Cálculo de Servicios los use. Después de correrlo, vuelve a correr `dev-open-access.sql` (agrega la tabla nueva a la lista de acceso abierto).
18. `assets/sql/20_migrations-contrato-multi-seccion.sql` — un contrato de alquiler ya puede cubrir varias secciones (ej. un inquilino que toma 2-3 pisos), y ampliarse más adelante agregando otra sección como **adenda** (sin perder el contrato original). Crea la tabla `contratos_alquiler_secciones`, hace el backfill de los contratos existentes (cada uno queda como su propia "sección original") y actualiza los triggers que marcan una sección como alquilada/disponible. **Obligatorio** para el nuevo editor "Secciones del contrato" en Contratos. Después de correrlo, vuelve a correr `dev-open-access.sql`.
19. **PRIMERO** `assets/sql/21a_revertir-mora-erronea-URGENTE.sql` — de un solo uso: quita la mora que "Actualizar vencidas" aplicó de más a cuotas de alquiler, venta y servicios (el bug del paso 20 de abajo). Solo hace falta correrlo si ya usaste ese botón alguna vez. **Después** corre `assets/sql/21_fix-mora-contrato-multiseccion-cobranzas.sql`, que corrige de raíz 3 bugs: (a) la mora usaba el % de una tabla vieja en vez del `% de mora mensual` de Configuración; (b) una sección agregada como adenda no encontraba su contrato al calcular un servicio; (c) `generar_cobranzas_servicio` creaba una cuota por SECCIÓN en vez de una por contrato/inquilino, así que un inquilino con 2+ secciones (ej. Edificio Polonia) salía con cuotas separadas en vez de una combinada. **Obligatorio** si usas contratos multi-sección con monto fijo de servicios o el botón "Actualizar vencidas".
20. `assets/sql/21b_recalcular-contrato-detalle-pendiente.sql` — el fix del paso 19 solo corrige cálculos NUEVOS; si ya habías calculado/generado cobranzas de una sección de adenda ANTES del fix, esa fila quedó con el contrato viejo (null) guardado. Este script recalcula `contrato_alquiler_id` en todo el detalle que todavía no tiene cuota generada, sin tener que rehacer el cálculo desde la UI. **Corre esto** si después del paso 19 sigues viendo cuotas separadas por sección para un mismo inquilino — trae los 3 pasos exactos dentro del archivo (eliminar cuotas → correr el script → generar cobranzas de nuevo).

Los siguientes dos son opcionales, por eso llevan `-OPCIONAL` en el nombre — sáltalos si no aplican a tu caso:

- `assets/sql/14_fix-secciones-orden-OPCIONAL.sql` — solo si tu base de datos ya existía antes de que la columna `orden` estuviera en `01_schema.sql` (parche idempotente, no rompe nada si lo corres de más).
- `assets/sql/15_email-lookup-function-OPCIONAL.sql` — quedó del flujo de login por correo (actualmente desactivado) — no hace falta correrlo mientras `AUTH_ENABLED = false`.

`assets/sql/dev-open-access.sql` no lleva número porque no es parte de la secuencia de un solo uso — es un script que prendes/apagas según necesites (ver nota de abajo). Solo corre `assets/sql/dev-open-access.sql` si necesitas ver datos sin una sesión real de Supabase Auth activa (ver la nota de arriba) — abre RLS al rol `anon`, revisa la advertencia de seguridad dentro del archivo antes de correrlo. Cada vez que agregues una tabla nueva (por ejemplo, al correr una migración nueva) tienes que volver a correr este archivo para que el rol `anon` tenga acceso también a esa tabla.

## Corregir una lectura de un medidor ya calculado

Nunca se edita un cálculo confirmado directamente — siempre se deshace y se rehace, para no perder trazabilidad de lo ya cobrado:

- **Si la cuenta todavía NO generó cobranza:** en el tab Cálculo, con la cuenta marcada "✓ Ya calculado", usa **"↩ Deshacer cálculo"** → corrige la lectura en "Lecturas del mes" → vuelve a **"Calcular esta cuenta"**.
- **Si la cobranza YA se generó** (la cuota aparece en Cobranzas y Pagos): primero usa **"🗑️ Eliminar"** sobre esa cuota en Cobranzas y Pagos (si ya tiene pagos registrados, anúlalos antes desde "Ver") → eso libera el cálculo → "↩ Deshacer cálculo" de la cuenta afectada → corrige la lectura → recalcula esa cuenta → "Generar cobranzas del periodo" de nuevo (solo genera lo que falte, no duplica lo ya facturado).

Si algún paso falla, revisa el mensaje de error antes de continuar — no saltes al siguiente archivo con un paso fallido.

## Contrato que amplía secciones (adenda)

Caso real: un inquilino ya tiene contrato por el 4to y 5to piso, y más adelante toma también el 6to. En el rubro esto se maneja con una **adenda**: un anexo que amplía el contrato original (mismo inquilino, mismo contrato) detallando el inmueble adicional, su propia mensualidad y sus propias fechas — sin anular ni re-firmar el contrato inicial. El sistema lo modela así:

- En **Contratos → Editar** el contrato existente, en "Secciones del contrato" verás las secciones que ya tiene (4to y 5to). Usa **"+ Agregar sección"**, elige el 6to piso, su renta mensual y su fecha de inicio (la de la adenda, no la del contrato original).
- La sección nueva queda etiquetada como **"Adenda 1"** (correlativo, sube con cada ampliación posterior) — el contrato original no se toca ni pierde sus datos.
- La **renta mensual total** del contrato (columna "Renta" en la tabla y las cuotas que se generan) se recalcula automáticamente como la suma de todas sus secciones.
- Si esa sección no tiene medidor propio y paga un monto fijo de agua/luz (ver "Montos fijos de servicios" en el mismo modal), ese monto se reparte en partes iguales entre las secciones del contrato que tampoco tengan medidor.
- Recomendación operativa: sigue firmando la adenda en papel/PDF con el inquilino igual que un contrato normal (referenciando el contrato original) — el sistema solo lleva el registro de a qué secciones y montos corresponde cada ampliación, no reemplaza el documento legal.

## 3. Crear el bucket de Storage

1. Ve a **Storage** → **New bucket**.
2. Nombre: `inmuebles` (debe coincidir exactamente con `STORAGE_BUCKET` en `assets/js/config.js`).
3. **Marca el bucket como privado** (no público) — las políticas de `rls-policies.sql` ya cubren el acceso de `administrador`/`operador` autenticados.

## 4. Entrar por primera vez y asignarte el rol de administrador

Con el login "solo correo" no necesitas crear el usuario a mano en el dashboard — se crea solo la primera vez que pides el enlace. Pero **sin un rol en `usuarios_roles` no vas a ver ningún dato** (RLS lo bloquea), así que:

1. Abre el sistema (ver pasos 5-7 para dejarlo bien configurado primero) → en la pantalla de login escribe tu correo → **Ingresar**.
2. Como es tu primera vez, el sistema no te va a reconocer todavía — debajo del botón va a aparecer el aviso "Este correo no está registrado..." con el enlace secundario **Enviar enlace de acceso**. Haz clic ahí.
3. Revisa tu correo (puede tardar 1-2 minutos; revisa spam/promociones) y haz clic en el enlace **desde el mismo dispositivo/navegador** donde lo pediste. Te lleva directo al sistema ya autenticado, pero verás el aviso "sin rol asignado" y las páginas vacías — es esperado.
4. Ve a Supabase → **Authentication** → **Users** y copia el **UUID** de tu usuario (el que acabas de crear con tu correo).
5. Ve a **SQL Editor** y ejecuta (reemplaza el UUID y tu nombre):

```sql
insert into usuarios_roles (usuario_id, rol, nombre_visible)
values ('PEGA-AQUI-EL-UUID', 'administrador', 'Luis');
```

6. Recarga el sistema — ya deberías ver los datos. Desde ahora, el botón "Ingresar" te va a reconocer de una y mandar el enlace directo, sin pasar por el aviso de correo nuevo.
7. Repite el mismo flujo (login con su correo → aparece el aviso de correo nuevo → tú insertas su fila en `usuarios_roles`) para cada persona adicional que vaya a usar el sistema, usando `'operador'` en vez de `'administrador'` si corresponde.

**Nota sobre el envío de correos:** Supabase usa su propio servidor de correo por defecto, con un límite bajo (unos pocos correos por hora) en el plan gratuito — suficiente para este uso interno, pero si en algún momento deja de llegar el enlace, espera unos minutos antes de reenviar.

## 5. Conectar el frontend a tu proyecto Supabase

1. En Supabase, ve a **Project Settings** → **API**.
2. Copia el **Project URL** y la **anon public key**.
3. Abre `assets/js/config.js` y reemplaza:

```js
export const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
export const SUPABASE_ANON_KEY = 'TU-ANON-KEY-PUBLICA';
```

con tus valores reales. **Nunca pegues aquí la `service_role` key** — la `anon` key es segura para un sitio público porque todo el acceso está controlado por RLS.

## 6. Publicar en GitHub Pages

El enlace de acceso por correo necesita una URL pública real para funcionar bien (por eso conviene publicar antes de hacer el primer login) — ver la nota al final de este paso si prefieres probar en local primero.

1. Crea un repositorio en GitHub (puede ser privado) y sube todo el contenido de esta carpeta a la raíz del repo (o a una rama específica).
2. Ve a **Settings** → **Pages** en el repositorio.
3. En **Source**, selecciona la rama (ej. `main`) y la carpeta `/ (root)`.
4. Guarda. GitHub te dará una URL tipo `https://tu-usuario.github.io/inmobiliaria-system/` — puede tardar 1-2 minutos en propagarse.
5. Verifica que `index.html` cargue (todavía sin poder loguearte — falta el paso 7).

**Nota de seguridad:** si el repositorio es público, cualquiera puede ver `config.js` (URL + anon key) — esto es seguro porque el acceso real está controlado por RLS, no por el secreto de la key. Aun así, si prefieres más privacidad, usa un repositorio privado con GitHub Pages (requiere plan GitHub Pro o superior) o restringe el acceso por otros medios.

**Sobre el login "solo correo":** con `shouldCreateUser: true`, cualquiera que escriba un correo en la pantalla de login puede crear una cuenta y autenticarse — pero sin una fila en `usuarios_roles` (que solo tú puedes crear desde Supabase) no ve ningún dato, porque RLS lo sigue bloqueando. Aun así, si el sistema queda público, revisa de vez en cuando **Authentication → Users** en Supabase para ver si se registró alguien que no reconoces.

**¿Prefieres probar en local antes de publicar?** Puedes correr `python3 -m http.server 8080` desde la carpeta del proyecto (no necesitas Node.js ni build step) y usar `http://localhost:8080/index.html` en el paso 7 — el código ya calcula esa URL solo, no hay que editar ningún archivo para eso.

## 7. Autorizar la URL del enlace de acceso en Supabase (Redirect URLs)

`pages/login.html` calcula automáticamente a dónde debe volver el enlace del correo (a `index.html`, en el mismo dominio/carpeta desde donde se abrió el login) — **no hay que editar ningún archivo para esto**. Pero por seguridad, Supabase solo acepta redirigir a URLs que tú autorizaste explícitamente:

1. En Supabase, ve a **Authentication** → **URL Configuration**.
2. En **Redirect URLs**, agrega la URL real de tu sitio terminada en `/**` (comodín, cubre cualquier página), por ejemplo:
   - `https://tu-usuario.github.io/inmobiliaria-system/**`
   - y, si vas a seguir probando en tu computadora: `http://localhost:8080/**`
3. En **Site URL** puedes dejar la misma URL de GitHub Pages como valor por defecto.
4. Guarda.

**Sin este paso, el enlace del correo va a fallar o a rebotar a una página en blanco** — es la causa más común de que "no pase nada" al hacer clic en el enlace. Si ya lo intentaste antes de configurar esto, simplemente pide un enlace nuevo desde el login después de guardar este paso.

## 8. Verificación rápida (smoke test)

- [ ] `pages/login.html` carga sin errores en la consola del navegador.
- [ ] Con un correo nuevo, "Ingresar" muestra el aviso + enlace secundario "Enviar enlace de acceso" (no manda nada solo).
- [ ] Con un correo ya en `usuarios_roles`, "Ingresar" manda el enlace directo.
- [ ] Al hacer clic en el enlace del correo, entras directo al sistema.
- [ ] El dashboard (`index.html`) muestra 3 propiedades y sus KPIs.
- [ ] `pages/inmuebles.html` lista las 3 propiedades del seed con sus secciones.
- [ ] Puedes crear una propiedad nueva, agregarle una sección, y subir una foto.
- [ ] `pages/personas.html` muestra a Luis, Alizon, Antonio, Rubén y Alex.
- [ ] Puedes crear una persona nueva con un rol.

## Problemas comunes

**"No se pudieron cargar los inmuebles" / pantalla en blanco de datos**
→ Revisa que `assets/js/config.js` tenga la URL y anon key correctas, y que hayas ejecutado los 3 archivos SQL en orden.

**Login funciona pero no aparece ningún dato (RLS rechaza todo)**
→ Verifica que tu usuario tenga una fila en `usuarios_roles` (paso 4). Sin esa fila, `auth_rol()` devuelve `null` y las políticas RLS no dejan pasar nada. Esto es normal la primera vez, antes de insertar tu fila.

**No llega el enlace de acceso al correo**
→ Espera 1-2 minutos y revisa spam/promociones. Si sigue sin llegar, en Supabase ve a **Authentication → Rate Limits** (puede haberse topado el límite de correos por hora del plan gratuito) o revisa **Authentication → Logs** para ver si el envío falló.

**El enlace del correo da error, no hace nada, o te manda a una página en blanco**
→ Casi siempre es el paso 7: la URL desde donde abriste el login no está autorizada en **Authentication → URL Configuration → Redirect URLs** de Supabase. Agrégala (con `/**` al final) y pide un enlace nuevo — el anterior ya no sirve. Si el sistema te devuelve a la pantalla de login, ahora debería mostrarte el motivo exacto del error arriba del formulario.

**`ERR_NAME_NOT_RESOLVED` o "Failed to fetch" al pedir el enlace**
→ `assets/js/config.js` todavía tiene los valores de ejemplo (`SUPABASE_URL`/`SUPABASE_ANON_KEY`) — ver paso 5.

**Error al subir fotos**
→ Confirma que el bucket se llama exactamente `inmuebles` (paso 3) y que las políticas de `storage.objects` de `rls-policies.sql` se ejecutaron sin error.

**CORS o "Failed to fetch" al probar en local**
→ Asegúrate de estar sirviendo el sitio con un servidor local (`python3 -m http.server 8080`, ver nota del paso 6) y no abriendo el archivo directamente con doble clic.
