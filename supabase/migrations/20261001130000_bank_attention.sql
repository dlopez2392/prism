-- A linked bank's warnings from Plaid, kept so Prism can say so before the
-- person's next visit finds out the hard way (and, later, email it).
--
--   sign-in        Plaid's ITEM ERROR with ITEM_LOGIN_REQUIRED: the bank wants
--                  its owner to sign in again; it has stopped updating.
--   disconnecting  PENDING_DISCONNECT (US and Canada) or PENDING_EXPIRATION
--                  (Europe): the bank's consent ends at disconnect_at, about a
--                  week out, unless its owner signs in again first.
--   revoked        USER_PERMISSION_REVOKED / USER_ACCOUNT_REVOKED: access was
--                  withdrawn.
--
-- Plain columns, not sealed: a state and a time say nothing about the money.
-- Set only by plaid_bank_warning below, which the Plaid webhook calls once
-- Plaid's signature checks out (src/app/api/plaid/webhook/route.ts), like
-- plaid_item_changed: it can touch these three columns and nothing else, and
-- returns nothing. Cleared by the owner's own session after a successful sync
-- or a finished "Sign in again" (the owner's existing update policy).

alter table public.plaid_items
  add column attention text check (attention is null or attention in ('sign-in', 'disconnecting', 'revoked')),
  add column attention_at timestamptz,
  add column disconnect_at timestamptz,
  add constraint plaid_items_attention_whole check (
    (attention is null and attention_at is null and disconnect_at is null)
    or (attention is not null and attention_at is not null and (attention = 'disconnecting') = (disconnect_at is not null))
  );

comment on column public.plaid_items.attention is
  'What Plaid last warned about this bank: sign-in, disconnecting or revoked; null when nothing is wrong.';
comment on column public.plaid_items.disconnect_at is
  'When a disconnecting bank stops updating unless its owner signs in again.';

-- Events, in Plaid's order of seriousness: a revoked bank stays revoked until a
-- sync or a sign-in proves otherwise; a bank wanting a sign-in isn't downgraded
-- to a mere warning; LOGIN_REPAIRED clears only the sign-in it repairs.
create function public.plaid_bank_warning(p_item_id text, p_event text, p_at timestamptz default null) returns void
language sql security definer set search_path = '' as $$
  update public.plaid_items set
    attention = case p_event
      when 'login-required' then case when attention = 'revoked' then attention else 'sign-in' end
      when 'disconnecting' then case when attention in ('sign-in', 'revoked') then attention else 'disconnecting' end
      when 'revoked' then 'revoked'
      when 'repaired' then case when attention = 'sign-in' then null else attention end
    end,
    attention_at = case p_event
      when 'repaired' then case when attention = 'sign-in' then null else attention_at end
      when 'disconnecting' then case when attention in ('sign-in', 'revoked') then attention_at else now() end
      else now()
    end,
    disconnect_at = case p_event
      when 'disconnecting' then case when attention in ('sign-in', 'revoked') then null else p_at end
      when 'repaired' then disconnect_at
      else null
    end
  where p_item_id ~ '^[A-Za-z0-9_-]{1,200}$' and item_id = p_item_id
    and p_event in ('login-required', 'disconnecting', 'revoked', 'repaired')
    and (p_event <> 'disconnecting' or (p_at is not null and p_at > now() - interval '1 day' and p_at < now() + interval '90 days'))
$$;
revoke all on function public.plaid_bank_warning(text, text, timestamptz) from public, authenticated;
grant execute on function public.plaid_bank_warning(text, text, timestamptz) to anon;
comment on function public.plaid_bank_warning(text, text, timestamptz) is
  'Plaid webhook only: records a warning about a linked bank. Touches attention, attention_at and disconnect_at and nothing else; returns nothing.';
