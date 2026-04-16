-- Update validation to account for unicorn power-up
CREATE OR REPLACE FUNCTION public.submit_score_with_rank(
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
RETURNS TABLE(rank bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now_ms bigint := floor(extract(epoch from now()) * 1000)::bigint;
  v_base_score integer;
  v_expected_hash text;
  v_hash_matches boolean;
BEGIN
  IF p_integrity_version <> 2 THEN
    RAISE EXCEPTION 'version mismatch';
  END IF;
  IF p_score < 0 OR p_score > 200000 THEN
    RAISE EXCEPTION 'bad score';
  END IF;
  -- More realistic playtime check: at least 1.2 seconds minimum, and max 1 hour
  IF p_play_time_ms < 1200 OR p_play_time_ms > 3600000 THEN
    RAISE EXCEPTION 'bad playtime';
  END IF;
  IF p_jumps < 0 OR p_coins_collected < 0 OR p_police_clears < 0 OR p_harvard_clears < 0 OR p_super_collectibles < 0 OR p_fly_time_ms < 0 THEN
    RAISE EXCEPTION 'negative telemetry';
  END IF;
  IF p_fly_time_ms > p_play_time_ms THEN
    RAISE EXCEPTION 'bad flytime';
  END IF;
  IF char_length(coalesce(p_session_id, '')) < 10 OR char_length(p_session_id) > 60 THEN
    RAISE EXCEPTION 'bad session';
  END IF;
  IF p_proof !~ '^[0-9a-f]{6,64}$' OR p_client_hash !~ '^[0-9a-f]{6,64}$' THEN
    RAISE EXCEPTION 'bad proof/hash';
  END IF;
  IF p_telemetry_hash < 0 OR p_telemetry_hash > 4294967295::bigint THEN
    RAISE EXCEPTION 'bad telemetry hash';
  END IF;
  IF p_submit_nonce_len < 1 OR p_submit_nonce_len > 120 THEN
    RAISE EXCEPTION 'bad nonce length';
  END IF;
  IF abs(v_now_ms - p_created_at) > 5 * 60 * 1000 THEN
    RAISE EXCEPTION 'stale timestamp';
  END IF;
  IF coalesce(jsonb_typeof(p_click_samples), '') <> 'array' THEN
    RAISE EXCEPTION 'bad click samples';
  END IF;
  IF jsonb_array_length(p_click_samples) > 80 THEN
    RAISE EXCEPTION 'too many click samples';
  END IF;

  -- Relaxed sanity check accounting for unicorns and power-ups
  -- Base: time*11 + coins*50(max with unicorn) + obstacles + super items*120 + unicorns*150
  -- Add generous buffer for power-ups and bonuses
  v_base_score :=
    floor(p_play_time_ms / 1000.0)::integer * 11 +
    p_coins_collected * 50 +
    p_police_clears * 18 +
    p_harvard_clears * 45 +
    p_super_collectibles * 150;
  IF p_score > v_base_score + 2000 THEN
    RAISE EXCEPTION 'impossible score';
  END IF;
  IF p_jumps > floor(p_play_time_ms / 60.0)::integer + 400 THEN
    RAISE EXCEPTION 'impossible jumps';
  END IF;

  -- Compute expected hash and compare (but don't reject on mismatch - just log it).
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
  v_hash_matches := (lower(p_client_hash) = v_expected_hash AND lower(p_proof) = lower(p_client_hash));

  -- If hash doesn't match, log to rejected table but continue insert (temporary for debugging).
  IF NOT v_hash_matches THEN
    INSERT INTO public.rejected_submissions (
      name, score, play_time_ms, jumps, coins_collected, police_clears, harvard_clears,
      super_collectibles, fly_time_ms, session_id, client_hash, telemetry_hash,
      submit_nonce_len, click_samples, expected_hash, error_reason
    ) VALUES (
      left(coalesce(trim(p_name), 'Guest'), 12),
      p_score, p_play_time_ms, p_jumps, p_coins_collected, p_police_clears, p_harvard_clears,
      p_super_collectibles, p_fly_time_ms, p_session_id, p_client_hash, p_telemetry_hash,
      p_submit_nonce_len, p_click_samples, v_expected_hash, 'hash mismatch (logged but accepted)'
    );
  END IF;

  -- Insert the score
  INSERT INTO public.scores (
    name, score, "createdAt", "playTimeMs", jumps, "coinsCollected", "policeClears",
    "harvardClears", "superCollectibles", "flyTimeMs", "sessionId", "clickSamples",
    proof, "clientHash", "integrityVersion"
  ) VALUES (
    left(coalesce(trim(p_name), 'Guest'), 12),
    p_score, p_created_at, p_play_time_ms, p_jumps, p_coins_collected, p_police_clears,
    p_harvard_clears, p_super_collectibles, p_fly_time_ms, p_session_id, p_click_samples,
    p_proof, p_client_hash, p_integrity_version
  );

  -- Calculate and return rank
  RETURN QUERY
  SELECT count(*)::bigint + 1
  FROM public.scores
  WHERE score > p_score;
END;
$$;
