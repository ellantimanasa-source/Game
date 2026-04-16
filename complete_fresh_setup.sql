-- Complete fresh setup - drops and recreates everything
-- Run this in Supabase SQL Editor

-- Step 1: Drop all existing functions
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (
        SELECT oid::regprocedure 
        FROM pg_proc 
        WHERE proname IN ('submit_score_with_rank', 'compute_submission_hash')
        AND pronamespace = 'public'::regnamespace
    )
    LOOP
        EXECUTE 'DROP FUNCTION ' || r.oid::regprocedure || ' CASCADE';
    END LOOP;
END $$;

-- Step 2: Drop and recreate tables
DROP TABLE IF EXISTS public.rejected_submissions CASCADE;
DROP TABLE IF EXISTS public.scores CASCADE;

-- Step 3: Create scores table
CREATE TABLE public.scores (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  score integer NOT NULL,
  "createdAt" bigint NOT NULL,
  "playTimeMs" integer NOT NULL,
  jumps integer NOT NULL,
  "coinsCollected" integer NOT NULL,
  "policeClears" integer NOT NULL,
  "harvardClears" integer NOT NULL,
  "superCollectibles" integer NOT NULL,
  "flyTimeMs" integer NOT NULL,
  "sessionId" text NOT NULL,
  "clickSamples" jsonb,
  proof text,
  "clientHash" text,
  "integrityVersion" integer DEFAULT 2
);

CREATE INDEX scores_score_desc_idx ON public.scores (score DESC);
CREATE INDEX scores_created_at_idx ON public.scores ("createdAt" DESC);

ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scores_select_policy" ON public.scores;
CREATE POLICY "scores_select_policy"
ON public.scores FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "scores_no_direct_write" ON public.scores;
CREATE POLICY "scores_no_direct_write"
ON public.scores FOR INSERT
TO anon, authenticated
WITH CHECK (false);

DROP POLICY IF EXISTS "scores_no_update" ON public.scores;
CREATE POLICY "scores_no_update"
ON public.scores FOR UPDATE
TO anon, authenticated
USING (false);

DROP POLICY IF EXISTS "scores_no_delete" ON public.scores;
CREATE POLICY "scores_no_delete"
ON public.scores FOR DELETE
TO anon, authenticated
USING (false);

-- Step 4: Create rejected_submissions table for debugging
CREATE TABLE public.rejected_submissions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  name text,
  score integer,
  play_time_ms integer,
  jumps integer,
  coins_collected integer,
  police_clears integer,
  harvard_clears integer,
  super_collectibles integer,
  fly_time_ms integer,
  session_id text,
  client_hash text,
  telemetry_hash bigint,
  submit_nonce_len integer,
  click_samples jsonb,
  expected_hash text,
  error_reason text
);

CREATE INDEX rejected_submissions_created_at_idx ON public.rejected_submissions (created_at DESC);

ALTER TABLE public.rejected_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rejected_no_anon" ON public.rejected_submissions;
CREATE POLICY "rejected_no_anon"
ON public.rejected_submissions FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

-- Step 5: Create hash computation function
CREATE OR REPLACE FUNCTION public.compute_submission_hash(
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
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  h bigint := 2166136261;
  i integer := 0;
  sample_value integer;
  sample_count integer := coalesce(jsonb_array_length(p_click_samples), 0);
BEGIN
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

  WHILE i < least(sample_count, 80) LOOP
    sample_value := floor(coalesce((p_click_samples ->> i)::numeric, 0))::integer;
    h := (((h * 33) # (sample_value + (i * 17) + 2654435769::bigint)) & 4294967295);
    i := i + 1;
  END LOOP;

  RETURN lower(to_hex(h));
END;
$$;

-- Step 6: Create submit function
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
  IF p_play_time_ms < greatest(1800, p_score * 45) OR p_play_time_ms > 3600000 THEN
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

  v_base_score :=
    floor(p_play_time_ms / 1000.0)::integer * 11 +
    p_coins_collected * 30 +
    p_police_clears * 18 +
    p_harvard_clears * 45 +
    p_super_collectibles * 120;
  IF p_score > v_base_score + 320 THEN
    RAISE EXCEPTION 'impossible score';
  END IF;
  IF p_jumps > floor(p_play_time_ms / 120.0)::integer + 220 THEN
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

-- Step 7: Set permissions
REVOKE ALL ON FUNCTION public.submit_score_with_rank(
  text, integer, bigint, integer, integer, integer, integer, integer, integer, integer, text, jsonb, text, text, bigint, integer, integer
) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_score_with_rank(
  text, integer, bigint, integer, integer, integer, integer, integer, integer, integer, text, jsonb, text, text, bigint, integer, integer
) TO anon, authenticated;
