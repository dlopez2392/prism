-- Plaid's warnings about a bank (sign in again, consent ending, access
-- withdrawn) are kept by plaid_bank_warning, which the webhook called with no
-- secret: the webhook route checks Plaid's signature, but anyone holding a
-- bank's Plaid item id could have called the function straight over the API
-- and set a false warning (the v2.0 security review, open item 10).
--
-- Now the webhook calls plaid_bank_warning_signed, which answers only to the
-- scheduled jobs' secret (alert_job_allowed, the sha256 in job_keys), and the
-- anon role can no longer call plaid_bank_warning itself. The rules for what a
-- warning may change stay in plaid_bank_warning, unchanged.

create function public.plaid_bank_warning_signed(p_secret text, p_item_id text, p_event text, p_at timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.alert_job_allowed(p_secret) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform public.plaid_bank_warning(p_item_id, p_event, p_at);
end $$;

revoke all on function public.plaid_bank_warning_signed(text, text, text, timestamptz) from public, authenticated;
grant execute on function public.plaid_bank_warning_signed(text, text, text, timestamptz) to anon;
comment on function public.plaid_bank_warning_signed(text, text, text, timestamptz) is
  'Plaid webhook only (answers to the jobs'' secret): records a warning about a linked bank through plaid_bank_warning.';

revoke execute on function public.plaid_bank_warning(text, text, timestamptz) from anon;
comment on function public.plaid_bank_warning(text, text, timestamptz) is
  'Records a warning about a linked bank: attention, attention_at and disconnect_at, nothing else. Called only by plaid_bank_warning_signed.';
