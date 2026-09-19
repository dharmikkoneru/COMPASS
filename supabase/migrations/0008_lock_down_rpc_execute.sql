-- ═══════════════════════════════════════════════════════════════
-- COMPASS Platform — migration 0008 — close the RPC execute gap
--
-- Found by calling the deployed database as `anon` (the public key,
-- no login):  POST /rest/v1/rpc/match_chunks  →  []  — it *ran*.
--
-- Two mistakes combined into a real leak:
--
--   1. `create function` grants EXECUTE to the PUBLIC pseudo-role, and PUBLIC
--      applies to every role, `anon` included. Migration 0007 revoked from
--      `anon` only, which leaves the PUBLIC grant untouched — so the revoke
--      read as protection without being any.
--   2. `match_chunks` is SECURITY DEFINER and takes the owner filter as a
--      *parameter* (p_user_id). Anyone who could call it could name someone
--      else's id and read their indexed material passages.
--
-- The exposure is horizontal, not just anonymous: any signed-in officer could
-- pass another officer's uuid. Both halves are fixed, so neither has to be
-- trusted alone:
--
--   • the function now also requires p_user_id = auth.uid();
--   • EXECUTE is revoked from PUBLIC and anon, then granted to authenticated.
--
-- Legitimate callers are unaffected: the edge function and the FastAPI service
-- both send the caller's own id, which is exactly auth.uid().
--
-- apply_attempt is locked down the same way. It was never exploitable (it reads
-- auth.uid() itself and answered "Not authenticated" to anon), but a function
-- only signed-in officers may call should not be callable by anyone else.
--
-- is_admin() is deliberately left executable: RLS policies evaluate it as the
-- calling role, so revoking it would break every policy that uses it, and it
-- discloses nothing (it answers false for anyone unauthenticated).
--
-- Safe to re-run. Paste the whole file into the Supabase SQL editor and Run.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. match_chunks: the parameter may no longer name another officer ──
-- Return columns are unchanged, as `create or replace` requires.
create or replace function public.match_chunks(
  query_embedding extensions.vector(768),
  p_user_id      uuid,
  match_count    int default 5,
  p_material_id  uuid default null
)
returns table (
  chunk_id    uuid,
  material_id uuid,
  chunk_index int,
  content     text,
  similarity  float
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    c.id,
    c.material_id,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.material_chunks c
  where c.user_id = p_user_id
    -- The guard that makes the parameter harmless: search only ever sees the
    -- caller's own rows, whatever id was sent.
    and p_user_id = auth.uid()
    and (p_material_id is null or c.material_id = p_material_id)
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

-- ── 2. Take EXECUTE away from every unauthenticated role ──────
-- `public` here is the PUBLIC pseudo-role, not the schema.
revoke all on function public.match_chunks(extensions.vector(768), uuid, int, uuid) from public;
revoke all on function public.match_chunks(extensions.vector(768), uuid, int, uuid) from anon;
grant execute on function public.match_chunks(extensions.vector(768), uuid, int, uuid) to authenticated;

revoke all on function public.apply_attempt(uuid, jsonb, int, int) from public;
revoke all on function public.apply_attempt(uuid, jsonb, int, int) from anon;
grant execute on function public.apply_attempt(uuid, jsonb, int, int) to authenticated;

-- PostgREST caches privileges and signatures per instance.
notify pgrst, 'reload schema';

-- ── 3. Fail loudly if this did not take ───────────────────────
-- Read the real ACLs rather than trusting the statements above: a privilege
-- granted through PUBLIC is invisible in `revoke ... from anon`, which is how
-- this slipped through the first time.
do $$
declare
  offenders text;
  problems  text;
begin
  select string_agg(distinct coalesce(r.rolname, 'PUBLIC') || ' → ' || p.proname, ', ')
    into offenders
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    left join pg_roles r on r.oid = acl.grantee
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('match_chunks', 'apply_attempt')
     and acl.privilege_type = 'EXECUTE'
     and (r.rolname is null or r.rolname in ('anon', 'public'));

  if offenders is not null then
    problems := 'these are still executable without signing in: ' || offenders || '; ';
  end if;

  if not exists (
    select 1
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'match_chunks'
       and position('auth.uid()' in pg_get_functiondef(p.oid)) > 0
  ) then
    problems := coalesce(problems, '') || 'match_chunks still trusts its p_user_id parameter; ';
  end if;

  if not exists (
    select 1
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      left join pg_roles r on r.oid = acl.grantee
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'match_chunks'
       and acl.privilege_type = 'EXECUTE'
       and r.rolname = 'authenticated'
  ) then
    problems := coalesce(problems, '') || 'signed-in officers lost access to match_chunks; ';
  end if;

  if problems is not null then
    raise exception 'Migration 0008 did not take effect: % Check that you are running this against the project the app points at (VITE_SUPABASE_URL in .env), then run the whole script again.', problems;
  end if;
end $$;

-- Peek at who may now execute each function.
select
  p.proname,
  coalesce(r.rolname, 'PUBLIC') as grantee,
  acl.privilege_type
from pg_proc p
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
left join pg_roles r on r.oid = acl.grantee
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('match_chunks', 'apply_attempt')
  and acl.privilege_type = 'EXECUTE'
order by p.proname, grantee;
