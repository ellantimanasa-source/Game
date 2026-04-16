create or replace function public.compute_submission_hash(
  p_score integer,
  p_play_time_ms integer,
  p_jumps integer,
  p_coins_collected integer,
  p_police_clears integer,
  p_harvard_clears integer,
  p_super_collectibles integer,
  p_fly_time_ms integer,
  p_telemetry_hash bigint,
  p_submit_nonce_len integer,
  p_click_samples jsonb
)
returns text
language plpgsql
as $$
declare
  h bigint := 2166136261;
  i integer := 0;
  sample_value integer;
  sample_count integer := coalesce(jsonb_array_length(p_click_samples), 0);
begin
  h := (((h * 33) # (p_score + 2654435769::bigint)) & 4294967295);
  h := (((h * 33) # (p_play_time_ms + 2654435769::bigint)) & 4294967295);
  h := (((h * 33) # (p_jumps + 2654435769::bigint)) & 4294967295);
  h := (((h * 33) # (p_coins_collected + 2654435769::bigint)) & 4294967295);
  h := (((h * 33) # (p_police_clears + 2654435769::bigint)) & 4294967295);
  h := (((h * 33) # (p_harvard_clears + 2654435769::bigint)) & 4294967295);
  h := (((h * 33) # (p_super_collectibles + 2654435769::bigint)) & 4294967295);
  h := (((h * 33) # (p_fly_time_ms + 2654435769::bigint)) & 4294967295);
  h := (((h * 33) # (p_telemetry_hash + 2654435769::bigint)) & 4294967295);
  h := (((h * 33) # (p_submit_nonce_len + 2654435769::bigint)) & 4294967295);

  while i < least(sample_count, 80) loop
    sample_value := floor(coalesce((p_click_samples ->> i)::numeric, 0))::integer;
    h := (((h * 33) # (sample_value + (i * 17) + 2654435769::bigint)) & 4294967295);
    i := i + 1;
  end loop;

  return lower(to_hex(h));
end;
$$;

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
  p_click_samples jsonb,
  p_proof text,
  p_client_hash text,
  p_telemetry_hash bigint,
  p_submit_nonce_len integer,
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
  v_expected_hash text;
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
  if p_proof !~ '^[0-9a-f]{6,64}$' or p_client_hash !~ '^[0-9a-f]{6,64}$' then
    raise exception 'bad proof/hash';
  end if;
  if p_telemetry_hash < 0 or p_telemetry_hash > 4294967295::bigint then
    raise exception 'bad telemetry hash';
  end if;
  if p_submit_nonce_len < 1 or p_submit_nonce_len > 120 then
    raise exception 'bad nonce length';
  end if;
  if abs(v_now_ms - p_created_at) > 5 * 60 * 1000 then
    raise exception 'stale timestamp';
  end if;
  if coalesce(jsonb_typeof(p_click_samples), '') <> 'array' then
    raise exception 'bad click samples';
  end if;
  if jsonb_array_length(p_click_samples) > 80 then
    raise exception 'too many click samples';
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

  v_expected_hash := public.compute_submission_hash(
    p_score,
    p_play_time_ms,
    p_jumps,
    p_coins_collected,
    p_police_clears,
    p_harvard_clears,
    p_super_collectibles,
    p_fly_time_ms,
    p_telemetry_hash,
    p_submit_nonce_len,
    p_click_samples
  );
  if lower(p_client_hash) <> v_expected_hash or lower(p_proof) <> lower(p_client_hash) then
    raise exception 'hash mismatch';
  end if;

  insert into public.scores (
    name, score, "createdAt", "playTimeMs", jumps, "coinsCollected", "policeClears",
    "harvardClears", "superCollectibles", "flyTimeMs", "sessionId", "clickSamples",
    proof, "clientHash", "integrityVersion"
  ) values (
    left(coalesce(trim(p_name), 'Guest'), 12),
    p_score, p_created_at, p_play_time_ms, p_jumps, p_coins_collected, p_police_clears,
    p_harvard_clears, p_super_collectibles, p_fly_time_ms, p_session_id, p_click_samples,
    p_proof, p_client_hash, p_integrity_version
  );

  return query
  select count(*)::bigint + 1
  from public.scores
  where score > p_score;
end;
$$;

revoke all on function public.submit_score_with_rank(
  text, integer, bigint, integer, integer, integer, integer, integer, integer, integer, text, jsonb, text, text, bigint, integer, integer
) from public;
grant execute on function public.submit_score_with_rank(
  text, integer, bigint, integer, integer, integer, integer, integer, integer, integer, text, jsonb, text, text, bigint, integer, integer
) to anon, authenticated;
