-- ============================================================================
-- FUNCION: verificar si un correo ya está registrado y validado (tiene fila
-- en usuarios_roles) — Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase.
--
-- La usa pages/login.html para decidir qué hace el botón "Ingresar":
--   - correo ya registrado y validado  -> envía el enlace de acceso directo.
--   - correo nuevo / sin rol asignado  -> no envía nada automáticamente;
--     muestra el enlace secundario "Enviar enlace de acceso" para que el
--     usuario lo pida explícitamente (y tú le asignes el rol después).
--
-- Es "security definer" pero solo expone true/false — nunca datos de la
-- tabla usuarios_roles ni de auth.users. Seguro de exponer a "anon".
-- ============================================================================
create or replace function public.email_esta_registrado(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    join usuarios_roles ur on ur.usuario_id = u.id
    where lower(u.email) = lower(p_email)
  );
$$;

grant execute on function public.email_esta_registrado(text) to anon, authenticated;

-- ============================================================================
-- FIN email-lookup-function.sql
-- ============================================================================
