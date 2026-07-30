-- Normalize expired memberships whenever the profile page syncs credits.
CREATE OR REPLACE FUNCTION public.sync_user_credits(user_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sub_type text;
    v_last_reset date;
    v_expires_at timestamptz;
    v_now_date date := CURRENT_DATE;
BEGIN
    SELECT subscription_type, last_credit_reset, subscription_expires_at
    INTO v_sub_type, v_last_reset, v_expires_at
    FROM public.profiles
    WHERE id = user_uuid;

    IF v_expires_at IS NOT NULL AND v_expires_at <= now() THEN
        UPDATE public.profiles
        SET subscription_type = 'free',
            is_pro = false
        WHERE id = user_uuid;

        v_sub_type := 'free';
    END IF;

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
