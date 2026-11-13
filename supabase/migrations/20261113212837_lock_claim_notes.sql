-- Notes could be edited forever, and the insert policy did not check whose
-- name the note went under or whether the writer could see the claim.
--
-- Each note now records the claim's status when it was written. Its author
-- can edit it while the claim is still at that status; once the claim moves
-- on (verified, approved, rejected and so on) the note is fixed.

alter table public.claim_notes add column claim_status text;

-- Existing notes stay editable until their claim next moves.
update public.claim_notes n
set claim_status = c.status
from public.claims c
where c.id = n.claim_id;

-- Who wrote a note, under which role, on which claim and at which stage come
-- from the database, not the request, and never change afterwards. Not
-- security definer, so the claim lookup sees only claims the writer can see;
-- correct_claim() is security definer and passes straight through.
create function public.guard_claim_note()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' then
    select c.status into new.claim_status from public.claims c where c.id = new.claim_id;
    if current_user = 'authenticated' then
      new.user_id := auth.uid();
      new.role := (select u.role from public.users u where u.id = auth.uid());
      new.created_at := current_timestamp;
      new.updated_at := current_timestamp;
    end if;
    return new;
  end if;

  if current_user = 'authenticated'
    and (new.claim_id, new.user_id, new.role, new.kind, new.claim_status, new.created_at)
      is distinct from (old.claim_id, old.user_id, old.role, old.kind, old.claim_status, old.created_at) then
    raise exception 'Only the text of a note can change' using errcode = '42501';
  end if;

  new.updated_at := current_timestamp;
  return new;
end;
$function$;

create trigger guard_claim_note
  before insert or update on public.claim_notes
  for each row execute function public.guard_claim_note();

drop policy if exists "Only admin, manager, accounting, and reviewer can insert notes" on public.claim_notes;

create policy "Staff add notes to claims they can see"
  on public.claim_notes for insert to authenticated
  with check (
    kind = 'note'
    and user_id = (select auth.uid())
    and claim_status is not null
    and exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role in ('admin', 'manager', 'accounting', 'reviewer')
    )
  );

drop policy if exists "Only note creator can update their notes" on public.claim_notes;

create policy "Authors edit notes until the claim moves on"
  on public.claim_notes for update to authenticated
  using (
    user_id = (select auth.uid())
    and kind = 'note'
    and exists (
      select 1 from public.claims c
      where c.id = claim_notes.claim_id and c.status = claim_notes.claim_status
    )
  )
  with check (user_id = (select auth.uid()) and kind = 'note');
