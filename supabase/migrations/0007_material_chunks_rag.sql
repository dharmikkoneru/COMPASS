-- ═══════════════════════════════════════════════════════════════
-- COMPASS Platform — migration 0007 — pgvector RAG for materials
--
-- Adds "Ask your material": every uploaded material is chunked and
-- embedded; officers query their own chunks by cosine similarity.
-- Self-verifying like 0003–0006: safe to re-run, raises if any step
-- did not take.
--
-- Run in the Supabase SQL editor, whole file at once.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. The vector extension ───────────────────────────────────
-- Hosted Supabase ships pgvector in the available list; this installs
-- it into the extensions schema where the dashboard puts add-ons.
create extension if not exists vector with schema extensions;

-- ── 2. Chunks table ───────────────────────────────────────────
-- text-embedding-004 produces 768-dimension vectors; matching the
-- dimension at the column level makes a wrong model loud at insert
-- time instead of silently wrong at search time.
create table if not exists public.material_chunks (
  id           uuid primary key default gen_random_uuid(),
  material_id  uuid not null references public.materials (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  chunk_index  int  not null,
  content      text not null,
  embedding    extensions.vector(768) not null,
  created_at   timestamptz not null default now(),
  unique (material_id, chunk_index)
);

-- Cosine similarity scans are sequential here; an index keeps room for
-- scale. ivfflat needs rows to train on, so a table that is still empty
-- skips it (create it later once chunks exist, if search slows down).
do $$ begin
  if (select count(*) from public.material_chunks) > 0 then
    create index material_chunks_embedding_idx
      on public.material_chunks
      using ivfflat (embedding extensions.vector_cosine_ops)
      with (lists = 100);
  end if;
exception
  when duplicate_table then null;
  when duplicate_object then null;
end $$;

-- ── 3. RLS: officers touch only their own chunks ──────────────
alter table public.material_chunks enable row level security;

drop policy if exists "chunks_select_own" on public.material_chunks;
create policy "chunks_select_own" on public.material_chunks
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "chunks_insert_own" on public.material_chunks;
create policy "chunks_insert_own" on public.material_chunks
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "chunks_delete_own" on public.material_chunks;
create policy "chunks_delete_own" on public.material_chunks
  for delete to authenticated
  using (user_id = auth.uid());

-- ── 4. Similarity search RPC ──────────────────────────────────
-- SECURITY DEFINER with a pinned search_path; the owner filter is a
-- parameter, not free text. Anon gets no execute grant.
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
    and (p_material_id is null or c.material_id = p_material_id)
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

revoke all on function public.match_chunks(extensions.vector(768), uuid, int, uuid) from anon;
grant execute on function public.match_chunks(extensions.vector(768), uuid, int, uuid) to authenticated;

-- PostgREST caches RPC signatures; pick this up immediately.
notify pgrst, 'reload schema';

-- ── 5. Verify loudly ──────────────────────────────────────────
do $$
declare
  problems text;
begin
  if not exists (select 1 from pg_extension where extname = 'vector') then
    problems := coalesce(problems || ' ', '') || 'pgvector extension missing; ';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name  = 'material_chunks'
      and column_name = 'embedding'
  ) then
    problems := coalesce(problems || ' ', '') || 'material_chunks.embedding missing; ';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'material_chunks'
      and policyname = 'chunks_select_own'
  ) then
    problems := coalesce(problems || ' ', '') || 'chunks_select_own policy missing; ';
  end if;

  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname       = 'match_chunks'
  ) then
    problems := coalesce(problems || ' ', '') || 'match_chunks RPC missing; ';
  end if;

  if problems is not null then
    raise exception 'Migration 0007 did not take effect: % Check that you are running this against the project the app points at (VITE_SUPABASE_URL in .env), then run the whole script again.', problems;
  end if;
end $$;

-- Peek at what you created.
select tablename, policyname
  from pg_policies
 where schemaname = 'public' and tablename = 'material_chunks'
 order by policyname;
