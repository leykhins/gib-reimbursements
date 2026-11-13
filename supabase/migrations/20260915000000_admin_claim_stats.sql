-- Admin dashboard counts, aggregated in the database.
--
-- The dashboard used to pull every claim over PostgREST and count them in the
-- browser. PostgREST caps a response at 1000 rows, so with 6,000+ claims the
-- page was counting a slice of the table and reporting, for example, 1 pending
-- claim when there were 8. Counting here removes the cap and gives the
-- dashboard cards and the review-queue badge one number to share.
--
-- Only claims that route to the admin queue are counted, matching
-- isAdminQueueClaim() in lib/claimRouting.ts: a claim goes to the project
-- reviewer when it carries a job number and its employee is neither a manager
-- nor an admin, and to admin otherwise.
--
-- The function is security invoker, so row-level security still applies and a
-- non-admin can only ever count their own rows.

create or replace function public.admin_claim_stats()
returns table (
  total_users bigint,
  total_claims bigint,
  pending_claims bigint,
  verified_claims bigint,
  approved_claims bigint,
  completed_claims bigint,
  rejected_claims bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with admin_queue as (
    select c.status
    from public.claims c
    left join public.users u on u.id = c.employee_id
    where btrim(coalesce(c.job_number, '')) = ''
       or u.role in ('manager', 'admin')
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
$$;

comment on function public.admin_claim_stats() is
  'Admin queue claim counts and the user total, aggregated server side so the dashboard is not limited to the first 1000 rows.';

grant execute on function public.admin_claim_stats() to authenticated;
