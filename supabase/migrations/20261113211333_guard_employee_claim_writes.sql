-- Employees could insert a claim that was already approved, and could change
-- any column of their own pending or rejected claims (status, review stamps,
-- PDF time), because the INSERT and UPDATE policies only check ownership.
--
-- These triggers apply only to browser requests (current_user =
-- 'authenticated'). update_claim_status(), correct_claim() and the other
-- security definer functions run as their owner, and the server routes use
-- the service role, so neither is affected.

-- New claims always start pending with no review history, and their
-- receipts must be in the submitter's own storage folder.
create function public.guard_claim_insert()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if (new.receipt_url is not null and new.receipt_url not like auth.uid()::text || '/%')
    or (new.receipt_url_2 is not null and new.receipt_url_2 not like auth.uid()::text || '/%') then
    raise exception 'Receipts must be uploaded to your own folder' using errcode = '42501';
  end if;

  new.status := 'pending';
  new.admin_verified_by := null;
  new.admin_verified_at := null;
  new.manager_approved_by := null;
  new.manager_approved_at := null;
  new.accounting_processed_by := null;
  new.accounting_processed_at := null;
  new.rejection_reason := null;
  new.pdf_downloaded_at := null;
  new.created_at := current_timestamp;
  new.updated_at := current_timestamp;
  return new;
end;
$function$;

create trigger guard_claim_insert
  before insert on public.claims
  for each row execute function public.guard_claim_insert();

-- Owners may still edit the details of their pending or rejected claims,
-- but not who submitted them, their status or their review history.
create function public.guard_claim_owner_update()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_changed text[];
begin
  if current_user <> 'authenticated' or old.status not in ('pending', 'rejected') then
    return new;
  end if;

  select coalesce(array_agg(n.key), '{}') into v_changed
  from jsonb_each(to_jsonb(new)) n
  where n.value is distinct from to_jsonb(old) -> n.key;

  if v_changed && array[
    'id', 'employee_id', 'status', 'created_at', 'rejection_reason', 'pdf_downloaded_at',
    'admin_verified_by', 'admin_verified_at', 'manager_approved_by', 'manager_approved_at',
    'accounting_processed_by', 'accounting_processed_at'
  ] then
    raise exception 'Status and review fields change only through update_claim_status()'
      using errcode = '42501';
  end if;

  if ('receipt_url' = any(v_changed) and new.receipt_url is not null and new.receipt_url not like old.employee_id::text || '/%')
    or ('receipt_url_2' = any(v_changed) and new.receipt_url_2 is not null and new.receipt_url_2 not like old.employee_id::text || '/%') then
    raise exception 'Receipts must be uploaded to your own folder' using errcode = '42501';
  end if;

  new.updated_at := current_timestamp;
  return new;
end;
$function$;

create trigger guard_claim_owner_update
  before update on public.claims
  for each row execute function public.guard_claim_owner_update();
