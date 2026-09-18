-- ═══════════════════════════════════════════════════════════════
-- COMPASS Platform — SIH26101 (MoSPI) — initial schema
-- Target: Supabase Postgres
-- Tables: profiles, materials, quizzes, questions, attempts,
--         competency_mastery, igot_courses, recommendations
-- RLS on every table. Profile auto-created on signup via trigger.
-- ═══════════════════════════════════════════════════════════════

-- ── 0. Extensions & enum types ────────────────────────────────
create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('officer', 'admin');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.attempt_status as enum ('completed', 'abandoned');
exception
  when duplicate_object then null;
end $$;

-- ── 1. profiles ───────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  department  text,
  designation text,
  role        public.user_role not null default 'officer',
  created_at  timestamptz not null default now()
);

-- ── 2. materials (uploaded learning material) ─────────────────
create table if not exists public.materials (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  source_type text not null default 'text' check (source_type in ('pdf', 'text')),
  raw_text    text not null,
  status      text not null default 'ready' check (status in ('processing', 'ready', 'error')),
  created_at  timestamptz not null default now()
);

-- ── 3. quizzes, questions, attempts ───────────────────────────
create table if not exists public.quizzes (
  id             uuid primary key default gen_random_uuid(),
  material_id    uuid not null references public.materials (id) on delete cascade,
  created_by     uuid not null references auth.users (id) on delete cascade,
  title          text not null,
  difficulty     text not null default 'medium',
  question_count int  not null default 0,
  created_at     timestamptz not null default now()
);

create table if not exists public.questions (
  id             uuid primary key default gen_random_uuid(),
  quiz_id        uuid not null references public.quizzes (id) on delete cascade,
  idx            int  not null,
  text           text not null,
  options        jsonb not null,
  correct_idx    int  not null,
  explanation    text,
  competency_tag text not null,
  difficulty     text not null default 'medium',
  unique (quiz_id, idx)
);

create table if not exists public.attempts (
  id           uuid primary key default gen_random_uuid(),
  quiz_id      uuid not null references public.quizzes (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  answers      jsonb not null,
  score        int  not null,
  total        int  not null,
  status       public.attempt_status not null default 'completed',
  submitted_at timestamptz not null default now()
);

create table if not exists public.competency_mastery (
  -- References profiles (not auth.users) so PostgREST can embed the officer's
  -- name/department off this table. profiles.id cascades from auth.users.id,
  -- so the delete cascade still reaches the auth row.
  user_id        uuid not null references public.profiles (id) on delete cascade,
  competency_tag text not null,
  mastery        numeric not null default 0,
  attempts       int not null default 0,
  correct        int not null default 0,
  total          int not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (user_id, competency_tag)
);

-- ── 4. iGOT Karmayogi catalog + recommendations ───────────────
create table if not exists public.igot_courses (
  id              uuid primary key default gen_random_uuid(),
  external_id     text not null unique,
  title           text not null,
  provider        text not null,
  duration_hrs    numeric(5,1) not null default 1.0,
  competency_tags text[] not null default '{}',
  url             text not null default '#',
  is_mock         boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists public.recommendations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  course_id      uuid not null references public.igot_courses (id) on delete cascade,
  competency_tag text not null,
  reason         text,
  status         text not null default 'recommended'
                 check (status in ('recommended', 'enrolled', 'in_progress', 'completed')),
  progress       int not null default 0 check (progress between 0 and 100),
  created_at     timestamptz not null default now(),
  -- backs the adapter's upsert(..., { onConflict: 'user_id,course_id' });
  -- without it PostgREST answers 42P10 and the iGOT page cannot persist
  unique (user_id, course_id)
);

create index if not exists idx_materials_user       on public.materials (user_id);
create index if not exists idx_quizzes_material     on public.quizzes (material_id);
create index if not exists idx_questions_quiz       on public.questions (quiz_id);
create index if not exists idx_attempts_user        on public.attempts (user_id);
create index if not exists idx_mastery_user         on public.competency_mastery (user_id);
create index if not exists idx_recommendations_user on public.recommendations (user_id);

-- ── 5. profile creation trigger on signup ─────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, department, designation)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    nullif(new.raw_user_meta_data->>'department', ''),
    nullif(new.raw_user_meta_data->>'designation', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 6. helper: is current user an admin? ──────────────────────
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ── 7. Row Level Security ─────────────────────────────────────
alter table public.profiles           enable row level security;
alter table public.materials          enable row level security;
alter table public.quizzes            enable row level security;
alter table public.questions          enable row level security;
alter table public.attempts           enable row level security;
alter table public.competency_mastery enable row level security;
alter table public.igot_courses       enable row level security;
alter table public.recommendations    enable row level security;

-- profiles: readable by all authenticated; self-update allowed but
-- a non-admin can never write role = 'admin' (no self-promotion).
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and (role = 'officer' or public.is_admin()));
create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- materials: owner-only
create policy "materials_all" on public.materials
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- quizzes: creator inserts against own material; creator or admin reads
create policy "quizzes_insert" on public.quizzes
  for insert to authenticated with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.materials m
      where m.id = material_id and m.user_id = auth.uid()
    )
  );
create policy "quizzes_select" on public.quizzes
  for select to authenticated
  using (created_by = auth.uid() or public.is_admin());
-- the generate-quiz function rolls back its own quiz row when a later
-- step fails, so it needs the delete half of ownership too
create policy "quizzes_delete" on public.quizzes
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- questions: readable if the parent quiz is readable
create policy "questions_select" on public.questions
  for select to authenticated using (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_id
        and (q.created_by = auth.uid() or public.is_admin())
    )
  );
-- insert half: the server-side generator writes with the caller's JWT, so
-- without this every generation fails *after* creating the quiz row
create policy "questions_insert" on public.questions
  for insert to authenticated with check (
    exists (
      select 1 from public.quizzes q
      where q.id = quiz_id
        and (q.created_by = auth.uid() or public.is_admin())
    )
  );

-- attempts: own rows only
create policy "attempts_all" on public.attempts
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- competency_mastery: own rows; admins read all
create policy "mastery_select" on public.competency_mastery
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "mastery_write" on public.competency_mastery
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- igot_courses: catalog readable by all authenticated; seeded by service role
create policy "igot_select" on public.igot_courses
  for select to authenticated using (true);

-- recommendations: own rows; admins read all
create policy "reco_select" on public.recommendations
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "reco_write" on public.recommendations
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 8. apply_attempt RPC ──────────────────────────────────────
-- Records an attempt and updates competency mastery.
-- New mastery (per competency touched by the quiz):
--   first attempt : mastery := 40 * score_ratio  (conservative prior)
--   repeat        : mastery := 0.6 * old + 0.4 * cumulative_ratio * 100
-- Returns the updated mastery rows so the client can refresh state.
create or replace function public.apply_attempt(
  p_quiz_id uuid,
  p_answers jsonb,
  p_score   int,
  p_total   int
)
returns table (
  competency_tag text,
  mastery        numeric,
  attempts       int,
  correct        int,
  total          int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.attempts (quiz_id, user_id, answers, score, total)
  values (p_quiz_id, v_user, p_answers, p_score, p_total);

  return query
  with per_tag as (
    select
      q.competency_tag,
      count(*)::int as q_total,
      sum(case when (p_answers ->> (q.idx)::text)::int = q.correct_idx
               then 1 else 0 end)::int as q_correct
    from public.questions q
    where q.quiz_id = p_quiz_id
    group by q.competency_tag
  ),
  upserted as (
    insert into public.competency_mastery as cm
      (user_id, competency_tag, mastery, attempts, correct, total, updated_at)
    select
      v_user,
      per_tag.competency_tag,
      greatest(0.4 * (per_tag.q_correct::numeric / per_tag.q_total) * 100, 0),
      1,
      per_tag.q_correct,
      per_tag.q_total,
      now()
    from per_tag
    -- Named-constraint target: returns-table output columns (competency_tag,
    -- mastery, ...) are PL/pgSQL variables that shadow same-named table columns
    -- inside the body, which made the bare column target ambiguous (42702).
    -- SET expressions may reference the target (cm) and EXCLUDED only — never
    -- the source CTE (per_tag), which is out of scope here (42P01) — and
    -- EXCLUDED carries per_tag's proposed values.
    on conflict on constraint competency_mastery_pkey do update set
      mastery    = greatest(
                     0.6 * cm.mastery
                     + 0.4 * ((cm.correct + excluded.correct)::numeric
                              / (cm.total + excluded.total)) * 100,
                     0),
      attempts   = cm.attempts + 1,
      correct    = cm.correct + excluded.correct,
      total      = cm.total + excluded.total,
      updated_at = now()
    returning cm.competency_tag, cm.mastery, cm.attempts, cm.correct, cm.total
  )
  select * from upserted;
end;
$$;
