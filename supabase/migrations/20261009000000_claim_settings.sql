-- The rates the claim form calculates with, editable by admins and accounting
-- (asked for by the user on 2026-10-09). Until now each was written into the
-- app, so changing one needed a release.
--
-- One row. Everyone signed in reads it, because the employee's claim form
-- does the arithmetic. Nobody writes it directly: update_claim_settings()
-- checks the role and records who changed it.
--
-- Submitted claims keep the amounts they were saved with. The old app on
-- claims.gibraltar.ca does not read this table.

create table public.claim_settings (
  id boolean primary key default true check (id),
  default_mileage_rate numeric(5,3) not null default 0.71
    check (default_mileage_rate > 0 and default_mileage_rate < 10),
  vancouver_mileage_uplift numeric(5,4) not null default 0.02
    check (vancouver_mileage_uplift >= 0 and vancouver_mileage_uplift < 1),
  parking_gst_rate numeric(5,4) not null default 0.05
    check (parking_gst_rate >= 0 and parking_gst_rate < 1),
  live_out_night_rate numeric(8,2) not null default 50
    check (live_out_night_rate > 0),
  -- Live out pays weekday nights only, so a week has at most five.
  live_out_max_nights_per_week integer not null default 5
    check (live_out_max_nights_per_week between 1 and 5),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

comment on table public.claim_settings is 'The one row of rates the claim form calculates with. Change it through update_claim_settings().';
comment on column public.claim_settings.default_mileage_rate is 'Dollars per kilometre for new people, and for everyone on the previous default when it changes.';
comment on column public.claim_settings.vancouver_mileage_uplift is 'Fraction added to a mileage trip whose start or end address contains Vancouver.';
comment on column public.claim_settings.parking_gst_rate is 'GST rate inside a parking total: GST = total / (1 + rate) x rate.';

insert into public.claim_settings default values;

alter table public.claim_settings enable row level security;

create policy "Signed-in users can read claim settings" on public.claim_settings
  for select to authenticated using (true);

revoke all on public.claim_settings from anon;
revoke insert, update, delete, truncate on public.claim_settings from authenticated;
grant select on public.claim_settings to authenticated;

-- New people start on the configured rate. handle_new_user() and the invite
-- route leave mileage_rate out, so the column default applies.
create function public.default_mileage_rate()
returns numeric
language sql
stable
security definer
set search_path to ''
as $function$
  select default_mileage_rate from public.claim_settings
$function$;

alter table public.users alter column mileage_rate set default public.default_mileage_rate();
comment on column public.users.mileage_rate is 'Mileage rate per kilometre for this person. Starts at claim_settings.default_mileage_rate; set it here to give someone their own rate.';

-- Saves every rate at once. When the default mileage rate changes, people on
-- the old default move with it, and people with their own rate keep theirs.
-- Returns the saved row plus people_moved.
create function public.update_claim_settings(
  default_mileage_rate numeric,
  vancouver_mileage_uplift numeric,
  parking_gst_rate numeric,
  live_out_night_rate numeric,
  live_out_max_nights_per_week integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_role text;
  v_old public.claim_settings%rowtype;
  v_new public.claim_settings%rowtype;
  v_moved integer := 0;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is null or v_role not in ('admin', 'accounting') then
    raise exception 'Only admins and accounting can change claim rates';
  end if;

  select * into v_old from public.claim_settings where id for update;

  if update_claim_settings.default_mileage_rate is distinct from v_old.default_mileage_rate then
    update public.users u
       set mileage_rate = update_claim_settings.default_mileage_rate
     where u.mileage_rate = v_old.default_mileage_rate or u.mileage_rate is null;
    get diagnostics v_moved = row_count;
  end if;

  update public.claim_settings s
     set default_mileage_rate = update_claim_settings.default_mileage_rate,
         vancouver_mileage_uplift = update_claim_settings.vancouver_mileage_uplift,
         parking_gst_rate = update_claim_settings.parking_gst_rate,
         live_out_night_rate = update_claim_settings.live_out_night_rate,
         live_out_max_nights_per_week = update_claim_settings.live_out_max_nights_per_week,
         updated_at = now(),
         updated_by = auth.uid()
   where s.id
  returning * into v_new;

  return to_jsonb(v_new) || jsonb_build_object('people_moved', v_moved);
end;
$function$;

revoke all on function public.update_claim_settings(numeric, numeric, numeric, numeric, integer) from public, anon;
grant execute on function public.update_claim_settings(numeric, numeric, numeric, numeric, integer) to authenticated;
