-- Household budgets and goals (roadmap item 4, second step).
--
-- One plan per household, kept on the household itself: budgets that pace
-- the spending of the accounts its members share, and goals they save toward
-- together. Every member reads it and every member may change it: they are
-- adults sharing a home, not an owner and guests. It is the same versioned
-- JSON a person's own plan is (profiles.plan_budgets / plan_goals), checked
-- all-or-nothing by the app's validators; null means "never edited".
--
-- Two people editing at once never silently overwrite each other: each list
-- carries a version, and a write names the version it was made from. A write
-- from an older version is refused (40001), and the app shows the newer one.
-- Each list also remembers who last changed it, and when.
--
-- Reads and writes go through the functions below, which make the same checks
-- as every household function: a person, not a connected app, past their own
-- second step. A connected app can't read the household row at all.
-- The plan stays with the household when someone leaves, and goes with it
-- when the last member does.

alter table public.households
  add column plan_budgets jsonb check (plan_budgets is null or (jsonb_typeof(plan_budgets) = 'array' and jsonb_array_length(plan_budgets) <= 9 and pg_column_size(plan_budgets) <= 4096)),
  add column plan_goals jsonb check (plan_goals is null or (jsonb_typeof(plan_goals) = 'array' and jsonb_array_length(plan_goals) <= 8 and pg_column_size(plan_goals) <= 8192)),
  add column budgets_version integer not null default 0,
  add column goals_version integer not null default 0,
  add column budgets_changed_by uuid references auth.users (id) on delete set null,
  add column budgets_changed_at timestamptz,
  add column goals_changed_by uuid references auth.users (id) on delete set null,
  add column goals_changed_at timestamptz;
create index households_budgets_changed_by on public.households (budgets_changed_by);
create index households_goals_changed_by on public.households (goals_changed_by);

-- Nothing of the household reaches a connected app, now that its row holds a plan.
create policy "household: not for connected apps" on public.households as restrictive for select to authenticated
  using (((select auth.jwt()) ->> 'client_id') is null);

-- The caller's household plan, with the first name of whoever last changed
-- each list. No row when they're in no household.
create function public.household_plan() returns table (
  budgets jsonb,
  goals jsonb,
  budgets_version integer,
  goals_version integer,
  budgets_changed_by_name text,
  budgets_changed_at timestamptz,
  goals_changed_by_name text,
  goals_changed_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := public.household_caller();
begin
  return query
    select h.plan_budgets, h.plan_goals, h.budgets_version, h.goals_version,
           (select p.first_name from public.profiles p where p.user_id = h.budgets_changed_by), h.budgets_changed_at,
           (select p.first_name from public.profiles p where p.user_id = h.goals_changed_by), h.goals_changed_at
    from public.households h
    where h.id = public.my_household();
end;
$$;
revoke all on function public.household_plan() from public, anon;
grant execute on function public.household_plan() to authenticated;

-- Replace the household's budgets (null: back to the drafted ones), but only
-- from the version the member was looking at. Returns the new version.
create function public.set_household_budgets(p_budgets jsonb, p_version integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.household_caller();
  hh uuid := public.my_household();
  v integer;
begin
  if hh is null then
    raise exception 'not in a household' using errcode = '42501';
  end if;
  update public.households h
    set plan_budgets = p_budgets, budgets_version = h.budgets_version + 1, budgets_changed_by = me, budgets_changed_at = now()
    where h.id = hh and h.budgets_version = p_version
    returning h.budgets_version into v;
  if v is null then
    raise exception 'someone else changed these budgets first' using errcode = '40001';
  end if;
  return v;
end;
$$;
revoke all on function public.set_household_budgets(jsonb, integer) from public, anon;
grant execute on function public.set_household_budgets(jsonb, integer) to authenticated;

create function public.set_household_goals(p_goals jsonb, p_version integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.household_caller();
  hh uuid := public.my_household();
  v integer;
begin
  if hh is null then
    raise exception 'not in a household' using errcode = '42501';
  end if;
  update public.households h
    set plan_goals = p_goals, goals_version = h.goals_version + 1, goals_changed_by = me, goals_changed_at = now()
    where h.id = hh and h.goals_version = p_version
    returning h.goals_version into v;
  if v is null then
    raise exception 'someone else changed these goals first' using errcode = '40001';
  end if;
  return v;
end;
$$;
revoke all on function public.set_household_goals(jsonb, integer) from public, anon;
grant execute on function public.set_household_goals(jsonb, integer) to authenticated;
