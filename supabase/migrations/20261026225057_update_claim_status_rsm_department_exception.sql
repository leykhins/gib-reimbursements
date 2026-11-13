-- RSM department claims with a job number go to the admins, not the reviewers.
--
-- Applied to production on 2026-10-26 without a file in either repo. This is
-- the SQL recorded in supabase_migrations.schema_migrations for this version.

CREATE OR REPLACE FUNCTION public.update_claim_status(claim_id uuid, new_status text, rejection_reason text DEFAULT NULL::text)
 RETURNS claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- The reviewer's own job-number claims, and RSM department claims, go to the admins instead.
  v_reviewer_queue := v_has_job
    and v_submitter.role not in ('manager', 'admin', 'reviewer')
    and lower(btrim(coalesce(v_submitter.department, ''))) <> 'rsm';

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
$function$
;
