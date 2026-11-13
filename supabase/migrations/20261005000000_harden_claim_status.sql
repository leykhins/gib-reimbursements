-- Claim status changes go through update_claim_status() and nowhere else, and
-- the function now checks the claim as well as the caller. Before this, it
-- checked only the caller's role and the status asked for, so a reviewer could
-- verify a claim that was already paid, a manager could approve another
-- department's claims, and anyone holding the anon key could call it. The
-- "Role-based claim status updates" policy also let any staff member update
-- any column of any claim straight through the API, around the function.
--
-- Rules, matching canReview() in lib/workspacePolicy.ts:
--   * reviewers verify or reject pending job-number claims from employees;
--   * admins verify or reject the other pending claims (overhead claims, and
--     everything managers, admins and the reviewer submit), and can also
--     approve verified claims and process approved ones, so they can walk a
--     claim through every step when testing;
--   * managers approve or reject verified claims from their own department,
--     except those from managers and admins, which skip the step;
--   * accounting processes or rejects approved claims;
--   * nobody but an admin reviews their own claim (decided 2026-10-05; a
--     manager's claims skip the manager step, so they never need to);
--   * a rejection needs a reason;
--   * the claim row is locked while it changes, so two reviewers acting at
--     once cannot both move it.
--
-- The accounting PDF marks the claims it includes through
-- mark_claims_downloaded(), the one other column staff wrote directly.
--
-- admin_claim_stats() counts the reviewer's job-number claims in the admin
-- queue, since that is now where they go.

create or replace function public.update_claim_status(claim_id uuid, new_status text, rejection_reason text default null::text)
returns public.claims
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor public.users%rowtype;
  v_claim public.claims%rowtype;
  v_submitter public.users%rowtype;
  v_has_job boolean;
  v_skip_manager boolean;
  v_reviewer_queue boolean;
  v_old_status text;
  v_final_status text;
  v_reason text := nullif(btrim(coalesce(update_claim_status.rejection_reason, '')), '');
begin
  select * into v_actor from public.users where id = auth.uid();
  if v_actor.role is null or v_actor.role not in ('manager', 'admin', 'accounting', 'reviewer') then
    raise exception 'You do not have permission to update claim status';
  end if;

  select * into v_claim from public.claims c where c.id = update_claim_status.claim_id for update;
  if v_claim.id is null then
    raise exception 'Claim not found';
  end if;
  select * into v_submitter from public.users where id = v_claim.employee_id;

  if v_claim.employee_id = v_actor.id and v_actor.role <> 'admin' then
    raise exception 'You cannot review your own claim';
  end if;

  v_old_status := v_claim.status;
  v_has_job := v_claim.job_number is not null and btrim(v_claim.job_number) <> '';
  v_skip_manager := v_submitter.role in ('manager', 'admin');
  -- The reviewer's own job-number claims go to the admins instead.
  v_reviewer_queue := v_has_job and v_submitter.role not in ('manager', 'admin', 'reviewer');

  case v_actor.role
    when 'reviewer' then
      if new_status not in ('verified', 'rejected') then
        raise exception 'Reviewers can only verify or reject claims';
      end if;
      if v_old_status <> 'pending' then
        raise exception 'Only pending claims can be verified';
      end if;
      if not v_reviewer_queue then
        raise exception 'Reviewers can only review employee claims that have a job number';
      end if;
    when 'admin' then
      if new_status not in ('verified', 'approved', 'completed', 'rejected') then
        raise exception 'Admins can only verify, approve, process or reject claims';
      end if;
      if new_status = 'verified' and v_old_status <> 'pending' then
        raise exception 'Only pending claims can be verified';
      end if;
      if new_status = 'approved' and v_old_status <> 'verified' then
        raise exception 'Only verified claims can be approved';
      end if;
      if new_status = 'completed' and v_old_status <> 'approved' then
        raise exception 'Only approved claims can be processed';
      end if;
      if new_status = 'rejected' and v_old_status not in ('pending', 'verified', 'approved') then
        raise exception 'Only claims still under review can be rejected';
      end if;
      if v_old_status = 'pending' and v_reviewer_queue then
        raise exception 'Claims with job numbers must be reviewed by a reviewer';
      end if;
    when 'manager' then
      if new_status not in ('approved', 'rejected') then
        raise exception 'Managers can only approve or reject claims';
      end if;
      if v_old_status <> 'verified' then
        raise exception 'Only verified claims can be approved';
      end if;
      if v_skip_manager then
        raise exception 'Manager and admin submitted claims do not require manager approval';
      end if;
      if v_actor.department is null or v_submitter.department is distinct from v_actor.department then
        raise exception 'Managers can only review claims from their own department';
      end if;
    when 'accounting' then
      if new_status not in ('completed', 'rejected') then
        raise exception 'Accounting can only process or reject claims';
      end if;
      if v_old_status <> 'approved' then
        raise exception 'Only approved claims can be processed';
      end if;
  end case;

  v_final_status := case
    when new_status = 'verified' and v_skip_manager then 'approved'
    else new_status
  end;

  if v_final_status = 'rejected' and v_reason is null then
    raise exception 'A rejection reason must be provided when rejecting a claim';
  end if;

  update public.claims
  set
    status = v_final_status,
    updated_at = current_timestamp,
    admin_verified_by = case when new_status = 'verified' then v_actor.id else admin_verified_by end,
    admin_verified_at = case when new_status = 'verified' then current_timestamp else admin_verified_at end,
    manager_approved_by = case when v_final_status = 'approved' then v_actor.id else manager_approved_by end,
    manager_approved_at = case when v_final_status = 'approved' then current_timestamp else manager_approved_at end,
    accounting_processed_by = case when new_status = 'completed' then v_actor.id else accounting_processed_by end,
    accounting_processed_at = case when new_status = 'completed' then current_timestamp else accounting_processed_at end,
    rejection_reason = case when v_final_status = 'rejected' then v_reason else null end
  where id = v_claim.id
  returning * into v_claim;

  insert into public.audit_logs (table_name, record_id, action, old_data, new_data, performed_by)
  values (
    'claims',
    v_claim.id,
    v_actor.role || '_' || v_final_status,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', v_final_status, 'rejection_reason', v_reason),
    v_actor.id
  );

  return v_claim;
end;
$function$;

-- Functions are executable by PUBLIC unless revoked, and the baseline also
-- granted this one to anon. Only signed-in users call it.
revoke all on function public.update_claim_status(uuid, text, text) from public, anon;
grant execute on function public.update_claim_status(uuid, text, text) to authenticated, service_role;

-- The accounting PDF records which processed claims it has included, so the
-- next export can leave them out and corrections can stop. Only the timestamp
-- is written, only on processed claims, and only once.
create or replace function public.mark_claims_downloaded(claim_ids uuid[])
returns setof uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_role text;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is null or v_role not in ('accounting', 'admin') then
    raise exception 'You do not have permission to export claims';
  end if;

  return query
    update public.claims
    set pdf_downloaded_at = current_timestamp
    where id = any (claim_ids)
      and status = 'completed'
      and pdf_downloaded_at is null
    returning id;
end;
$function$;

revoke all on function public.mark_claims_downloaded(uuid[]) from public, anon;
grant execute on function public.mark_claims_downloaded(uuid[]) to authenticated, service_role;

-- Staff no longer update claims directly. These policies let them change any
-- column of a claim (the amount, the employee, the status) so long as the
-- status ended up as one their role could set, which made the checks in
-- update_claim_status() optional.
drop policy if exists "Role-based claim status updates" on public.claims;
drop policy if exists "Accounting can process approved claims" on public.claims;
drop policy if exists "Admins can verify claims" on public.claims;
drop policy if exists "Admins can reject claims" on public.claims;

-- The admin queue now takes the reviewer's own job-number claims as well,
-- matching isAdminQueueClaim() in lib/claimRouting.ts.
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
       or u.role in ('manager', 'admin', 'reviewer')
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
