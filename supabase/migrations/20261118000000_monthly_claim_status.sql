-- Month status dots, counted in the database.
--
-- The expense pages draw a red or green dot on each month tab. They worked it
-- out by reading the date and status of every claim in the year and looping
-- over them in the browser. PostgREST caps a response at 1000 rows, so once a
-- year passed 1000 claims the dots were drawn from a slice of the table: a
-- month with open claims could show green because its open claims fell outside
-- the first 1000 rows. Counting here removes the cap and sends 12 small rows
-- instead of thousands.
--
-- One row per month that has claims, rejected claims excluded. The pages turn
-- the counts into dots: finance goes green when every claim is completed, the
-- approval pages go red when any claim is pending.
--
-- Months are taken from the stored date in UTC, which is how the pages already
-- read it (the date string's year and month).
--
-- p_employee_ids narrows the count to those employees (the employee page passes
-- the caller, the manager page passes the department). Null counts every claim
-- the caller can see.
--
-- The function is security invoker, so row-level security still applies and a
-- caller can only ever count claims they can already read.

create or replace function public.monthly_claim_status(
  p_year integer,
  p_employee_ids uuid[] default null
)
returns table (
  month integer,
  total bigint,
  pending bigint,
  completed bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    extract(month from c.date at time zone 'UTC')::integer,
    count(*),
    count(*) filter (where c.status = 'pending'),
    count(*) filter (where c.status = 'completed')
  from public.claims c
  where c.status <> 'rejected'
    and c.date >= make_timestamptz(p_year, 1, 1, 0, 0, 0, 'UTC')
    and c.date <  make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'UTC')
    and (p_employee_ids is null or c.employee_id = any (p_employee_ids))
  group by 1
  order by 1;
$$;

comment on function public.monthly_claim_status(integer, uuid[]) is
  'Per-month claim counts (total, pending, completed; rejected excluded) for the month status dots, aggregated server side so the pages are not limited to the first 1000 rows.';

revoke execute on function public.monthly_claim_status(integer, uuid[]) from public, anon;
grant execute on function public.monthly_claim_status(integer, uuid[]) to authenticated;
