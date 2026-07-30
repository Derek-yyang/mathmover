-- Fix daily credits reset timezone issue.
-- Supabase Postgres uses UTC for CURRENT_DATE by default. China-local users
-- who log in between 00:00 and 08:00 would otherwise still be evaluated as
-- the previous UTC date and miss that day's free credit reset.

CREATE OR REPLACE FUNCTION public.sync_user_credits(user_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sub_type text;
    v_last_reset date;
    v_expires_at timestamptz;
    v_now_date date := (timezone('Asia/Shanghai', now()))::date;
BEGIN
    SELECT subscription_type, last_credit_reset, subscription_expires_at
    INTO v_sub_type, v_last_reset, v_expires_at
    FROM public.profiles
    WHERE id = user_uuid;

    -- Expire memberships before deciding whether free daily credits apply.
    IF v_expires_at IS NOT NULL AND v_expires_at <= now() THEN
        UPDATE public.profiles
        SET subscription_type = 'free',
            is_pro = false
        WHERE id = user_uuid;

        v_sub_type := 'free';
    END IF;

    -- Free users receive 3 monthly credits once per China-local day.
    IF v_sub_type = 'free' OR v_sub_type IS NULL THEN
        IF v_last_reset IS NULL OR v_last_reset < v_now_date THEN
            UPDATE public.profiles
            SET monthly_credits = 3,
                last_credit_reset = v_now_date
            WHERE id = user_uuid;
        END IF;
    END IF;
END;
$$;

-- Initialize new users using the same China-local date.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, permanent_credits, monthly_credits, subscription_type, last_credit_reset)
  VALUES (NEW.id, 5, 3, 'free', (timezone('Asia/Shanghai', now()))::date);
  RETURN NEW;
END;
$$;
