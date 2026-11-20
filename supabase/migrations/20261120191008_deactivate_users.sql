-- Deactivating former employees (decided with the user on 2026-11-20).
-- Deleting someone also deletes their claims and every claim they signed off
-- (ON DELETE CASCADE), so people who leave are deactivated instead. Their
-- sign-in is blocked with a Supabase Auth ban, set by
-- server/api/admin/deactivate-user.post.ts. This column records it on the
-- profile so the app can show it, stop emailing them, and refuse their
-- remaining session. Clearing it (with the ban) reactivates them.
-- Shared database: gibclaim reads public.users too; a new nullable column
-- doesn't affect it.

alter table public.users add column deactivated_at timestamptz;

comment on column public.users.deactivated_at is
  'When an admin deactivated this person. Null means active. Claim history is kept.';

-- Same as 20261009010000_guard_user_role_and_rate.sql, plus deactivated_at:
-- people can still edit their own name, but only admins (or the service role)
-- can deactivate or reactivate anyone.
create or replace function public.guard_user_role_and_rate()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- An upsert fires this before it falls through to the update, so a
    -- proposed row on the column defaults must pass.
    if (new.role is not null and new.role <> 'employee')
       or new.mileage_rate is distinct from public.default_mileage_rate()
       or new.deactivated_at is not null then
      raise exception 'Only admins can set a role, mileage rate or deactivation';
    end if;
  elsif new.role is distinct from old.role
     or new.mileage_rate is distinct from old.mileage_rate
     or new.deactivated_at is distinct from old.deactivated_at then
    raise exception 'Only admins can change a role, mileage rate or deactivation';
  end if;

  return new;
end;
$function$;
