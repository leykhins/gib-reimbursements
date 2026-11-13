-- Reviewers, admins and managers can correct the descriptive fields of a claim
-- (date, subcategory, job number, description) instead of explaining the
-- mistake in a note. The correction writes the note itself, so accounting reads
-- the right value and its history in the same place. The amount, receipts and
-- mileage stay with the employee, who is asked to revise through a rejection.
--
-- Rules, all enforced here rather than in the interface:
--   * a reason is required;
--   * nobody corrects their own claim;
--   * admins correct any claim, reviewers the job-number claims routed to them,
--     managers the claims of their own department;
--   * rejected claims are with the employee, so they cannot be corrected;
--   * a claim in a downloaded PDF is locked, because the PDF has gone out;
--   * the status does not change;
--   * Car Mileages and Live Out Allowance amounts are calculated from distance or
--     days, so those claims keep their category, and nothing moves into them;
--   * the new subcategory's requirements (job number, licence, client, the
--     employee claimed with) must already be met by the claim.

alter table public.claim_notes
  add column kind text not null default 'note'
  constraint claim_notes_kind_check check (kind in ('note', 'correction'));

comment on column public.claim_notes.kind is
  'note: written by hand. correction: written by correct_claim() to record a change to the claim.';

-- Correction notes are written only by correct_claim(), and nobody edits them
-- afterwards, so the record of a change cannot be forged or rewritten.
alter policy "Only admin, manager, accounting, and reviewer can insert notes"
  on public.claim_notes
  with check (
    kind = 'note'
    and exists (
      select 1 from public.users
      where users.id = (select auth.uid())
        and users.role = any (array['admin', 'manager', 'accounting', 'reviewer'])
    )
  );

alter policy "Only note creator can update their notes"
  on public.claim_notes
  using (user_id = (select auth.uid()) and kind = 'note');

create or replace function public.correct_claim(claim_id uuid, changes jsonb, reason text)
returns public.claim_notes
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor public.users%rowtype;
  v_claim public.claims%rowtype;
  v_submitter public.users%rowtype;
  v_old_category text;
  v_old_subcategory text;
  v_new_category_id uuid;
  v_new_category text;
  v_new_subcategory text;
  v_requires_license boolean;
  v_requires_job boolean;
  v_requires_employee boolean;
  v_requires_client boolean;
  v_new_date timestamptz;
  v_new_mapping uuid;
  v_new_job text;
  v_new_description text;
  v_lines text[] := '{}';
  v_old jsonb := '{}';
  v_new jsonb := '{}';
  v_note public.claim_notes%rowtype;
begin
  if reason is null or btrim(reason) = '' then
    raise exception 'Give a reason for the correction';
  end if;
  if changes is null or jsonb_typeof(changes) <> 'object' then
    raise exception 'Nothing to correct';
  end if;
  if exists (select 1 from jsonb_object_keys(changes) k
             where k not in ('date', 'subcategory_mapping_id', 'job_number', 'description')) then
    raise exception 'Only the date, subcategory, job number and description can be corrected';
  end if;

  select * into v_actor from public.users where id = auth.uid();
  if v_actor.role is null or v_actor.role not in ('admin', 'reviewer', 'manager') then
    raise exception 'You do not have permission to correct claims';
  end if;

  select * into v_claim from public.claims c where c.id = correct_claim.claim_id for update;
  if v_claim.id is null then
    raise exception 'Claim not found';
  end if;
  select * into v_submitter from public.users where id = v_claim.employee_id;

  if v_claim.employee_id = v_actor.id then
    raise exception 'You cannot correct your own claim';
  end if;
  if v_claim.status = 'rejected' then
    raise exception 'This claim is with the employee to revise';
  end if;
  if v_claim.pdf_downloaded_at is not null then
    raise exception 'This claim is in a downloaded PDF, so it can no longer be changed';
  end if;

  if v_actor.role = 'reviewer' and (
    v_claim.job_number is null or btrim(v_claim.job_number) = ''
    or v_submitter.role in ('manager', 'admin')
  ) then
    raise exception 'Reviewers can correct only the job-number claims routed to them';
  end if;
  if v_actor.role = 'manager' and (
    v_actor.department is null or v_submitter.department is distinct from v_actor.department
  ) then
    raise exception 'Managers can correct only claims from their own department';
  end if;

  select cat.category_name, sub.subcategory_name
    into v_old_category, v_old_subcategory
  from public.claim_categories cat
  left join public.category_subcategory_mapping m on m.id = v_claim.subcategory_mapping_id
  left join public.claim_subcategories sub on sub.id = m.subcategory_id
  where cat.id = v_claim.category_id;

  -- Start from the claim as it stands; each change below replaces one value.
  v_new_date := v_claim.date;
  v_new_mapping := v_claim.subcategory_mapping_id;
  v_new_category_id := v_claim.category_id;
  v_new_job := nullif(btrim(coalesce(v_claim.job_number, '')), '');
  v_new_description := nullif(btrim(coalesce(v_claim.description, '')), '');

  if changes ? 'date' then
    if jsonb_typeof(changes->'date') <> 'string' or (changes->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'The date must be a calendar date';
    end if;
    -- Claims are stored at local midnight. Keep the time of day the claim
    -- already has, so the date reads the same everywhere the old one did.
    v_new_date := ((changes->>'date')::date + (v_claim.date at time zone 'UTC')::time) at time zone 'UTC';
    if (changes->>'date')::date > (now() at time zone 'America/Vancouver')::date then
      raise exception 'The date cannot be in the future';
    end if;
  end if;

  if changes ? 'subcategory_mapping_id' then
    v_new_mapping := (changes->>'subcategory_mapping_id')::uuid;
    if v_new_mapping is null then
      raise exception 'Choose a subcategory';
    end if;
  end if;

  if changes ? 'job_number' then
    v_new_job := nullif(btrim(coalesce(changes->>'job_number', '')), '');
  end if;

  if changes ? 'description' then
    v_new_description := nullif(btrim(coalesce(changes->>'description', '')), '');
  end if;

  select m.category_id, cat.category_name, sub.subcategory_name, cat.requires_license_number,
         m.requires_job_number, m.requires_employee_name, m.requires_client_info
    into v_new_category_id, v_new_category, v_new_subcategory, v_requires_license,
         v_requires_job, v_requires_employee, v_requires_client
  from public.category_subcategory_mapping m
  join public.claim_categories cat on cat.id = m.category_id
  join public.claim_subcategories sub on sub.id = m.subcategory_id
  where m.id = v_new_mapping;

  if v_new_mapping is not null and v_new_category_id is null then
    raise exception 'That subcategory does not exist';
  end if;
  if v_new_mapping is null then
    -- An old claim with no subcategory keeps its category and has no
    -- subcategory rules to meet.
    v_new_category_id := v_claim.category_id;
    v_new_category := v_old_category;
  end if;

  if v_new_category_id is distinct from v_claim.category_id and (
    v_old_category in ('Car Mileages', 'Live Out Allowance')
    or v_new_category in ('Car Mileages', 'Live Out Allowance')
    or coalesce(v_claim.is_travel, false)
  ) then
    raise exception 'Mileage and live-out claims are calculated, so their category cannot change. Reject the claim so the employee can resubmit it.';
  end if;

  if coalesce(v_requires_job, false) and v_new_job is null then
    raise exception '% needs a job number', v_new_subcategory;
  end if;
  if coalesce(v_requires_license, false) and nullif(btrim(coalesce(v_claim.license_number, '')), '') is null then
    raise exception '% needs a licence number, which only the employee can add', v_new_category;
  end if;
  if coalesce(v_requires_employee, false) and nullif(btrim(coalesce(v_claim.related_employee, '')), '') is null then
    raise exception '% needs the employee it was claimed with, which only the employee can add', v_new_subcategory;
  end if;
  if coalesce(v_requires_client, false) and (
    nullif(btrim(coalesce(v_claim.client_name, '')), '') is null
    or nullif(btrim(coalesce(v_claim.company_name, '')), '') is null
  ) then
    raise exception '% needs a client, which only the employee can add', v_new_subcategory;
  end if;

  -- One sentence per change, in the order the fields appear on the claim.
  if v_new_date is distinct from v_claim.date then
    v_lines := v_lines || format('Changed the date from %s to %s.',
      to_char(v_claim.date at time zone 'UTC', 'Mon FMDD, YYYY'),
      to_char(v_new_date at time zone 'UTC', 'Mon FMDD, YYYY'));
    v_old := v_old || jsonb_build_object('date', v_claim.date);
    v_new := v_new || jsonb_build_object('date', v_new_date);
  end if;
  if v_new_mapping is distinct from v_claim.subcategory_mapping_id then
    v_lines := v_lines || format('Changed the category from %s to %s.',
      coalesce(v_old_category, 'none') || coalesce(' / ' || v_old_subcategory, ''),
      coalesce(v_new_category, 'none') || coalesce(' / ' || v_new_subcategory, ''));
    v_old := v_old || jsonb_build_object('category_id', v_claim.category_id, 'subcategory_mapping_id', v_claim.subcategory_mapping_id);
    v_new := v_new || jsonb_build_object('category_id', v_new_category_id, 'subcategory_mapping_id', v_new_mapping);
  end if;
  if v_new_job is distinct from nullif(btrim(coalesce(v_claim.job_number, '')), '') then
    v_lines := v_lines || format('Changed the job number from %s to %s.',
      coalesce(nullif(btrim(coalesce(v_claim.job_number, '')), ''), 'none'), coalesce(v_new_job, 'none'));
    v_old := v_old || jsonb_build_object('job_number', v_claim.job_number);
    v_new := v_new || jsonb_build_object('job_number', v_new_job);
  end if;
  if v_new_description is distinct from nullif(btrim(coalesce(v_claim.description, '')), '') then
    v_lines := v_lines || format('Changed the description from %s to %s.',
      coalesce('"' || nullif(btrim(coalesce(v_claim.description, '')), '') || '"', 'none'),
      coalesce('"' || v_new_description || '"', 'none'));
    v_old := v_old || jsonb_build_object('description', v_claim.description);
    v_new := v_new || jsonb_build_object('description', v_new_description);
  end if;

  if cardinality(v_lines) = 0 then
    raise exception 'Nothing has changed';
  end if;

  update public.claims c
  set date = v_new_date,
      category_id = v_new_category_id,
      subcategory_mapping_id = v_new_mapping,
      job_number = v_new_job,
      description = v_new_description,
      updated_at = current_timestamp
  where c.id = correct_claim.claim_id;

  insert into public.claim_notes (claim_id, note, role, user_id, kind)
  values (
    correct_claim.claim_id,
    array_to_string(v_lines, ' ') || ' Reason: ' || btrim(reason),
    v_actor.role,
    v_actor.id,
    'correction'
  )
  returning * into v_note;

  insert into public.audit_logs (table_name, record_id, action, old_data, new_data, performed_by)
  values ('claims', correct_claim.claim_id, v_actor.role || '_corrected', v_old,
          v_new || jsonb_build_object('reason', btrim(reason)), v_actor.id);

  return v_note;
end;
$function$;

revoke all on function public.correct_claim(uuid, jsonb, text) from public, anon;
grant execute on function public.correct_claim(uuid, jsonb, text) to authenticated;
