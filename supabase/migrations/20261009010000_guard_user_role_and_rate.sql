-- Only admins change a person's role or mileage rate (decided with the user on
-- 2026-10-09). Until now the "Users and admins profile update" policy let
-- anyone update their own row, every column included, so an employee could
-- call the API with their own session and make themselves an admin or raise
-- their rate. The "Allow service role to insert users" policy also lets any
-- signed-in user insert a row with any role.
--
-- The policies stay, because both apps let people save their own name: the
-- redesign's Account settings, the old app's /e/settings upsert, and sign-up.
-- None of those send role or mileage_rate. This trigger stops only direct
-- API calls (current_user authenticated or anon) by non-admins. Security
-- definer functions such as update_claim_settings() and handle_new_user(),
-- and the service role used by the invite route, run as other roles and pass.

create function public.guard_user_role_and_rate()
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
       or new.mileage_rate is distinct from public.default_mileage_rate() then
      raise exception 'Only admins can set a role or mileage rate';
    end if;
  elsif new.role is distinct from old.role or new.mileage_rate is distinct from old.mileage_rate then
    raise exception 'Only admins can change a role or mileage rate';
  end if;

  return new;
end;
$function$;

create trigger guard_user_role_and_rate
  before insert or update on public.users
  for each row execute function public.guard_user_role_and_rate();
