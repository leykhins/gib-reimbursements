import { DEFAULT_CLAIM_SETTINGS, toClaimSettings, type ClaimSettings, type ClaimSettingsRow } from '~/lib/claimSettings'

/**
 * The shared claim rates. `settings` holds the seeded defaults until `load()`
 * succeeds, so call it before calculating anything that gets saved.
 */
export function useClaimSettings() {
  const client = useSupabaseClient()
  const settings = useState<ClaimSettings>('claim-settings', () => ({ ...DEFAULT_CLAIM_SETTINGS }))

  async function load() {
    const { data, error } = await client.from('claim_settings').select('*').single()
    if (error) throw error
    settings.value = toClaimSettings(data as ClaimSettingsRow)
    return settings.value
  }

  /** Saves every rate. `peopleMoved` counts those who followed the default mileage rate. */
  async function save(next: ClaimSettings) {
    // The generated database types don't list this function yet
    const { data, error } = await (client as any).rpc('update_claim_settings', {
      default_mileage_rate: next.defaultMileageRate,
      vancouver_mileage_uplift: next.vancouverMileageUplift,
      parking_gst_rate: next.parkingGstRate,
      live_out_night_rate: next.liveOutNightRate,
      live_out_max_nights_per_week: next.liveOutMaxNightsPerWeek,
      live_out_day_trip_rate: next.liveOutDayTripRate,
      live_out_without_kitchen_rate: next.liveOutWithoutKitchenRate,
    })
    if (error) throw error
    const row = data as ClaimSettingsRow & { people_moved: number }
    settings.value = toClaimSettings(row)
    return { settings: settings.value, peopleMoved: row.people_moved }
  }

  return { settings, load, save }
}
