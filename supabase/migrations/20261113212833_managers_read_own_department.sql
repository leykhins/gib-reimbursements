-- Managers could read every claim in the company: the policy only checked
-- that the reader is a manager. The manager pages already filter to the
-- manager's department, and update_claim_status() only lets a manager act on
-- their own department, so the database now matches.

-- The employees in the caller's department, when the caller is a manager.
-- Security definer so it can read users regardless of the users policies;
-- it returns nothing for anyone else.
create function public.managed_employee_ids()
returns setof uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select e.id
  from public.users m
  join public.users e on e.department = m.department
  where m.id = auth.uid()
    and m.role = 'manager'
    and m.department is not null;
$function$;

revoke execute on function public.managed_employee_ids() from public, anon;
grant execute on function public.managed_employee_ids() to authenticated;

drop policy if exists "Managers can view requests for their departments" on public.claims;

create policy "Managers can view claims from their department"
  on public.claims for select to authenticated
  using (employee_id in (select public.managed_employee_ids()));

-- The admin dashboard counts left out RSM department claims, which
-- update_claim_status() routes to the admins rather than the reviewer.
create or replace function public.admin_claim_stats()
returns table(total_users bigint, total_claims bigint, pending_claims bigint, verified_claims bigint, approved_claims bigint, completed_claims bigint, rejected_claims bigint)
language sql
stable
set search_path to 'public'
as $function$
  with admin_queue as (
    select c.status
    from public.claims c
    left join public.users u on u.id = c.employee_id
    where btrim(coalesce(c.job_number, '')) = ''
       or u.role in ('manager', 'admin', 'reviewer')
       or lower(btrim(coalesce(u.department, ''))) = 'rsm'
  )
  select
    (select count(*) from public.users),
    count(*),
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'verified'),
    count(*) filter (where status = 'approved'),
    count(*) filter (where status = 'completed'),
    count(*) filter (where status = 'rejected')
  from admin_queue;
$function$;
