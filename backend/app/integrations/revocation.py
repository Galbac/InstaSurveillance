"""DB-owned one-shot logout capability; API can request it but cannot read ciphertext."""

CREATE_FUNCTION = """
CREATE OR REPLACE FUNCTION public.prepare_instagram_logout(p_profile text, p_owner text, p_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO public.instagram_session_revocations (id, profile_id, encrypted_settings, key_version, expires_at)
  SELECT p_id, s.profile_id, s.encrypted_settings, s.key_version, clock_timestamp() + interval '120 seconds'
  FROM public.instagram_session_secrets s JOIN public.instagram_profiles p ON p.id=s.profile_id
  WHERE p.id=p_profile AND p.user_id=p_owner;
  RETURN FOUND;
END;
$$
"""
