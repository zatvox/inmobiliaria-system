# SETUP — Guía de configuración inicial

Sigue estos pasos en orden. Tiempo estimado: 20-30 minutos la primera vez.

> ⚡ **Login solo con correo (sin contraseña) por ahora.** `AUTH_ENABLED = true` en `assets/js/config.js`, pero en vez de pedir contraseña, `pages/login.html` envía un **enlace de acceso** ("magic link") al correo — se hace clic y entra directo, sin escribir ningún código. La seguridad real sigue siendo la de `rls-policies.sql` — **no hace falta correr `assets/sql/dev-open-access.sql`**, ese archivo quedó solo como referencia de un modo totalmente abierto que ya no se está usando.

## 1. Crear el proyecto en Supabase

1. Entra a [supabase.com](https://supabase.com) y crea una cuenta (o inicia sesión).
2. **New Project** → elige un nombre (ej. `inmobiliaria-luis`), una contraseña de base de datos segura (guárdala en un lugar seguro) y la región más cercana a Perú (`South America (São Paulo)` si está disponible).
3. Espera 1-2 minutos a que aprovisione el proyecto.

## 2. Correr el esquema, RLS y datos semilla

En el panel de Supabase, ve a **SQL Editor** → **New query**, y ejecuta los archivos **en este orden exacto** (copia y pega el contenido completo de cada uno, un archivo por query, y dale "Run"):

1. `assets/sql/schema.sql` — crea todas las tablas, triggers y funciones.
2. `assets/sql/rls-policies.sql` — activa Row Level Security y las políticas por rol.
3. `assets/sql/seed.sql` — carga los catálogos, tipos de servicio y las 3 propiedades reales.
4. `assets/sql/email-lookup-function.sql` — crea la función que usa el botón "Ingresar" del login para saber si un correo ya está registrado antes de mandar el enlace.

No corras `assets/sql/dev-open-access.sql` — es de un modo totalmente abierto (sin login) que ya no se está usando; ábrelo solo si en algún momento quieres volver a ese modo.

Si algún paso falla, revisa el mensaje de error antes de continuar — no saltes al siguiente archivo con un paso fallido.

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
