-- Migration: 0003_ai_count_helpers
-- Adds atomic increment function for AI response counting (SESS-12, T-07-02).
--
-- increment_ai_count(s_id uuid) -> table(new_count int, cap int)
-- Atomically increments ai_response_count and returns the new count + cap.
-- Using a single UPDATE ... RETURNING statement ensures atomicity at the row level,
-- preventing race conditions when concurrent /invoke calls hit the same session.

create or replace function public.increment_ai_count(s_id uuid)
returns table(new_count int, cap int)
language sql
security definer
set search_path = public
as $$
  update public.sessions
  set ai_response_count = ai_response_count + 1
  where id = s_id
  returning ai_response_count as new_count, ai_response_cap as cap;
$$;

-- Grant execute to the service role (used by the API's service-role client)
grant execute on function public.increment_ai_count(uuid) to service_role;
