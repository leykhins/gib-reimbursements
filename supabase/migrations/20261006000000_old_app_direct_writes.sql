-- claims.gibraltar.ca still serves the app from before the redesign, and that
-- app writes two things straight to the claims table rather than through a
-- function:
--   * the accounting dashboard's "mark as processed" sets status = 'completed'
--     with accounting_processed_by and accounting_processed_at;
--   * the accounting PDF stamps pdf_downloaded_at on the processed claims it
--     includes.
-- 20261005000000 dropped the staff UPDATE policies, so both have updated no
-- rows, silently, since 2026-10-05. These two policies let accounting and
-- admins make exactly those writes again, and the trigger refuses any other
-- column on the way, so the loophole that migration closed (any staff member
-- changing any column of any claim) stays closed.
--
-- The redesign uses update_claim_status() and mark_claims_downloaded() and
-- does not need any of this. Drop it once the domain serves the redesign.

-- Same rule as update_claim_status(): nobody but an admin processes their own
-- claim.
create policy "Old app: accounting processes approved claims"
  on public.claims for update to authenticated
  using ((public.is_accounting() or public.is_admin()) and status = 'approved'
    and (employee_id <> (select auth.uid()) or public.is_admin()))
  with check (status = 'completed');

create policy "Old app: accounting marks processed claims downloaded"
  on public.claims for update to authenticated
  using ((public.is_accounting() or public.is_admin()) and status = 'completed' and pdf_downloaded_at is null)
  with check (status = 'completed' and pdf_downloaded_at is not null);

-- Runs on direct API writes only. The functions that change claims are
-- security definer, so inside them current_user is their owner, not
-- authenticated. Employees' own updates reach pending and rejected claims
-- only, which this leaves alone.
create or replace function public.guard_direct_claim_update()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_changed text[];
begin
  if current_user <> 'authenticated' or old.status not in ('approved', 'completed') then
    return new;
  end if;

  select coalesce(array_agg(n.key), '{}') into v_changed
  from jsonb_each(to_jsonb(new)) n
  where n.value is distinct from to_jsonb(old) -> n.key;

  if old.status = 'approved' and new.status = 'completed'
    and v_changed <@ array['status', 'accounting_processed_by', 'accounting_processed_at', 'updated_at'] then
    -- Who and when come from the server, not from the request.
    new.accounting_processed_by := auth.uid();
    new.accounting_processed_at := current_timestamp;
    new.updated_at := current_timestamp;
    return new;
  end if;

  if old.status = 'completed' and old.pdf_downloaded_at is null and new.pdf_downloaded_at is not null
    and v_changed <@ array['pdf_downloaded_at', 'updated_at'] then
    new.pdf_downloaded_at := current_timestamp;
    new.updated_at := current_timestamp;
    return new;
  end if;

  raise exception 'Only the status or the PDF download time can change here; use update_claim_status()'
    using errcode = '42501';
end;
$function$;

revoke all on function public.guard_direct_claim_update() from public, anon, authenticated;

create trigger guard_direct_claim_update
  before update on public.claims
  for each row execute function public.guard_direct_claim_update();
