-- Fix Supabase security advisor findings (2026-11-20).
-- Shared database: gibclaim (D:\dev\gibclaim) reads the same tables.

-- 1. email_notifications: policy existed but RLS was off, so anyone with the
--    anon key could read or write every email log. The existing
--    "Notification policy" (TO authenticated) now applies. The service role
--    used by server/api/notify.post.ts bypasses RLS and is unaffected.
alter table public.email_notifications enable row level security;

-- 2. Pin search_path on functions flagged as mutable. A function-level SET
--    also stops the in-body "SET search_path" lines from leaking into the
--    caller's session.
alter function public.validate_claim_request() set search_path = public;
alter function public.is_manager(uuid)         set search_path = public;
alter function public.handle_new_user()        set search_path = public;
alter function public.handle_user_delete()     set search_path = public;
alter function public.handle_user_update()     set search_path = public;
alter function public.audit_log_trigger()      set search_path = public;
alter function public.is_admin()               set search_path = public;
alter function public.is_accounting()          set search_path = public;
alter function public.is_reviewer()            set search_path = public;

-- 3. Trigger functions should never be callable over /rest/v1/rpc.
--    Triggers keep firing: EXECUTE is only checked when a trigger is created.
revoke execute on function public.handle_new_user()    from public, anon, authenticated;
revoke execute on function public.handle_user_delete() from public, anon, authenticated;
revoke execute on function public.handle_user_update() from public, anon, authenticated;
revoke execute on function public.audit_log_trigger()  from public, anon, authenticated;

-- 4. SECURITY DEFINER helpers: signed-out callers have no use for them.
--    authenticated keeps EXECUTE because RLS policies and the
--    users.mileage_rate column default call them.
revoke execute on function public.default_mileage_rate() from public, anon;
revoke execute on function public.is_admin()             from public, anon;
revoke execute on function public.is_accounting()        from public, anon;
revoke execute on function public.is_reviewer()          from public, anon;

-- 5. These policies were TO public and call the helpers above. Without this,
--    a signed-out query on these tables would error instead of returning no
--    rows. Signed-in behaviour is unchanged.
alter policy "Reviewers can view all claims" on public.claims to authenticated;
alter policy "Accountant, Managers, and Reviewers can view all users" on public.users to authenticated;
alter policy "Admins can manage department managers" on public.department_managers to authenticated;
