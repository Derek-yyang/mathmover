-- Restrict client-side profile updates to non-sensitive BYOK settings only.
-- Sensitive fields such as credits and membership status must be changed only
-- by server-side/security-definer database functions.

DROP TRIGGER IF EXISTS tr_check_profile_update ON public.profiles;
DROP FUNCTION IF EXISTS public.check_profile_update_restricted_fields();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.profiles FROM anon, authenticated;

GRANT UPDATE (
  custom_api_key,
  custom_base_url,
  custom_model_name,
  use_custom_model
) ON public.profiles TO authenticated;

-- Keep normal profile reads controlled by the existing RLS policy.
GRANT SELECT ON public.profiles TO authenticated;
