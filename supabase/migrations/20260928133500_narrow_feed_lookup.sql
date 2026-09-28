-- Only a calendar app needs the feed lookup, and it never signs in: the
-- feed route calls it with a session-less client (the anon role). Signed-in
-- people reach their own feed through its table, under row-level security.
revoke execute on function public.calendar_feed_snapshot(text) from authenticated;

-- Supabase's advisor flags both remaining SECURITY DEFINER functions; each is
-- deliberate and documented here so nobody "fixes" it into a hole:
--   calendar_feed_snapshot — anon only; returns a snapshot for an exact
--     sha256 match and nothing else. As SECURITY INVOKER it would need an
--     anon policy on calendar_feeds, exposing whole rows.
--   delete_my_account — authenticated only; deletes auth.uid() and nobody else.
comment on function public.calendar_feed_snapshot(text) is 'Anon-only by design: exact sha256 of a feed secret -> that feed''s snapshot.';
comment on function public.delete_my_account() is 'By design: a signed-in person deletes their own account (auth.uid()) and nothing else.';
