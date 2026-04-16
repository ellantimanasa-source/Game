create table if not exists public.scores (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 12),
  score integer not null check (score >= 0 and score <= 200000),
  "createdAt" bigint not null,
  "playTimeMs" integer not null check ("playTimeMs" >= 1800 and "playTimeMs" <= 3600000),
  jumps integer not null check (jumps >= 0),
  "coinsCollected" integer not null check ("coinsCollected" >= 0),
  "policeClears" integer not null check ("policeClears" >= 0),
  "harvardClears" integer not null check ("harvardClears" >= 0),
  "superCollectibles" integer not null check ("superCollectibles" >= 0),
  "flyTimeMs" integer not null check ("flyTimeMs" >= 0),
  "sessionId" text not null check (char_length("sessionId") between 10 and 60),
  proof text not null check (proof ~ '^[0-9a-f]{6,32}$'),
  "integrityVersion" integer not null check ("integrityVersion" = 2)
);

create index if not exists scores_score_desc_idx on public.scores (score desc);

alter table public.scores enable row level security;

drop policy if exists "scores_select_public" on public.scores;
create policy "scores_select_public"
on public.scores
for select
to anon, authenticated
using (true);

drop policy if exists "scores_no_direct_insert" on public.scores;
create policy "scores_no_direct_insert"
on public.scores
for insert
to anon, authenticated
with check (false);

drop policy if exists "scores_no_direct_update" on public.scores;
create policy "scores_no_direct_update"
on public.scores
for update
to anon, authenticated
using (false)
with check (false);

drop policy if exists "scores_no_direct_delete" on public.scores;
create policy "scores_no_direct_delete"
on public.scores
for delete
to anon, authenticated
using (false);

create or replace function public.submit_score_with_rank(
  p_name text,
  p_score integer,
  p_created_at bigint,
  p_play_time_ms integer,
  p_jumps integer,
  p_coins_collected integer,
  p_police_clears integer,
  p_harvard_clears integer,
  p_super_collectibles integer,
  p_fly_time_ms integer,
  p_session_id text,
  p_proof text,
  p_integrity_version integer
)
returns table(rank bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_ms bigint := floor(extract(epoch from now()) * 1000)::bigint;
  v_base_score integer;
begin
  if p_integrity_version <> 2 then
    raise exception 'version mismatch';
  end if;
  if p_score < 0 or p_score > 200000 then
    raise exception 'bad score';
  end if;
  if p_play_time_ms < greatest(1800, p_score * 45) or p_play_time_ms > 3600000 then
    raise exception 'bad playtime';
  end if;
  if p_jumps < 0 or p_coins_collected < 0 or p_police_clears < 0 or p_harvard_clears < 0 or p_super_collectibles < 0 or p_fly_time_ms < 0 then
    raise exception 'negative telemetry';
  end if;
  if p_fly_time_ms > p_play_time_ms then
    raise exception 'bad flytime';
  end if;
  if char_length(coalesce(p_session_id, '')) < 10 or char_length(p_session_id) > 60 then
    raise exception 'bad session';
  end if;
  if p_proof !~ '^[0-9a-f]{6,32}$' then
    raise exception 'bad proof';
  end if;
  if abs(v_now_ms - p_created_at) > 5 * 60 * 1000 then
    raise exception 'stale timestamp';
  end if;

  v_base_score :=
    floor(p_play_time_ms / 1000.0)::integer * 11 +
    p_coins_collected * 30 +
    p_police_clears * 18 +
    p_harvard_clears * 45 +
    p_super_collectibles * 120;
  if p_score > v_base_score + 320 then
    raise exception 'impossible score';
  end if;
  if p_jumps > floor(p_play_time_ms / 120.0)::integer + 220 then
    raise exception 'impossible jumps';
  end if;

  insert into public.scores (
    name, score, "createdAt", "playTimeMs", jumps, "coinsCollected", "policeClears",
    "harvardClears", "superCollectibles", "flyTimeMs", "sessionId", proof, "integrityVersion"
  ) values (
    left(coalesce(trim(p_name), 'Guest'), 12),
    p_score, p_created_at, p_play_time_ms, p_jumps, p_coins_collected, p_police_clears,
    p_harvard_clears, p_super_collectibles, p_fly_time_ms, p_session_id, p_proof, p_integrity_version
  );

  return query
  select count(*)::bigint + 1
  from public.scores
  where score > p_score;
end;
$$;

revoke all on function public.submit_score_with_rank(
  text, integer, bigint, integer, integer, integer, integer, integer, integer, integer, text, text, integer
) from public;
grant execute on function public.submit_score_with_rank(
  text, integer, bigint, integer, integer, integer, integer, integer, integer, integer, text, text, integer
) to anon, authenticated;
