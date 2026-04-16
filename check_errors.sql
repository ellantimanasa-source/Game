SELECT 
  created_at, 
  name, 
  score, 
  play_time_ms,
  jumps,
  coins_collected,
  client_hash,
  expected_hash,
  error_reason,
  telemetry_hash,
  submit_nonce_len,
  click_samples
FROM public.rejected_submissions 
ORDER BY created_at DESC 
LIMIT 5;
