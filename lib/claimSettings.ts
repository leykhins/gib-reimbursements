/**
 * The rates the claim form calculates with. Admins and accounting change them
 * on the Rates page; they live in the one `claim_settings` row.
 */
export interface ClaimSettings {
  /** Dollars per kilometre for new people. Each person can have their own. */
  defaultMileageRate: number
  /** Fraction added to a trip that starts or ends in Vancouver, e.g. 0.02. */
  vancouverMileageUplift: number
  /** GST rate inside a parking total, e.g. 0.05. */
  parkingGstRate: number
  /** Live Out Allowance (Overnight with Kitchen), per day of the stay. */
  liveOutNightRate: number
  /** Live Out Allowance (Without Kitchen), per day of the stay. */
  liveOutWithoutKitchenRate: number
  /** Live Out Allowance (Day Trip), flat per day trip. */
  liveOutDayTripRate: number
  /** Most With Kitchen days paid in a Monday to Sunday week. Without Kitchen has no limit. */
  liveOutMaxNightsPerWeek: number
  updatedAt?: string
  updatedBy?: string | null
}

/** The values the migration seeds, used until the row loads. */
export const DEFAULT_CLAIM_SETTINGS: ClaimSettings = {
  defaultMileageRate: 0.71,
  vancouverMileageUplift: 0.02,
  parkingGstRate: 0.05,
  liveOutNightRate: 50,
  liveOutWithoutKitchenRate: 75,
  liveOutDayTripRate: 50,
  liveOutMaxNightsPerWeek: 5,
}

export interface ClaimSettingsRow {
  default_mileage_rate: number | string
  vancouver_mileage_uplift: number | string
  parking_gst_rate: number | string
  live_out_night_rate: number | string
  live_out_without_kitchen_rate?: number | string | null
  live_out_day_trip_rate?: number | string | null
  live_out_max_nights_per_week: number | string
  updated_at?: string
  updated_by?: string | null
}

export function toClaimSettings(row: ClaimSettingsRow): ClaimSettings {
  return {
    defaultMileageRate: Number(row.default_mileage_rate),
    vancouverMileageUplift: Number(row.vancouver_mileage_uplift),
    parkingGstRate: Number(row.parking_gst_rate),
    liveOutNightRate: Number(row.live_out_night_rate),
    liveOutWithoutKitchenRate: Number(row.live_out_without_kitchen_rate ?? DEFAULT_CLAIM_SETTINGS.liveOutWithoutKitchenRate),
    liveOutDayTripRate: Number(row.live_out_day_trip_rate ?? DEFAULT_CLAIM_SETTINGS.liveOutDayTripRate),
    liveOutMaxNightsPerWeek: Number(row.live_out_max_nights_per_week),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ?? null,
  }
}

/**
 * The three live out categories: a day trip pays a flat amount for one date,
 * and the two overnight kinds pay per day of the stay, weekends included.
 * With Kitchen is capped per week; Without Kitchen is not.
 */
export type LiveOutKind = 'dayTrip' | 'withKitchen' | 'withoutKitchen'

/** Which live out kind a category is, or null when it is not live out. */
export function liveOutKind(categoryName?: string | null): LiveOutKind | null {
  const name = (categoryName || '').toLowerCase()
  if (!name.startsWith('live out allowance')) return null
  if (name.includes('day trip')) return 'dayTrip'
  if (name.includes('without kitchen')) return 'withoutKitchen'
  return 'withKitchen'
}

/** The rate a live out kind pays: per day of the stay, or flat for a day trip. */
export function liveOutRate(settings: ClaimSettings, kind: LiveOutKind): number {
  if (kind === 'dayTrip') return settings.liveOutDayTripRate
  if (kind === 'withoutKitchen') return settings.liveOutWithoutKitchenRate
  return settings.liveOutNightRate
}

/** Parking receipts show a GST-inclusive total, so the GST is the share inside it. */
export function parkingGst(total: number, rate: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  return (total / (1 + rate)) * rate
}

/** A substring match, so North and West Vancouver count too. */
export function isVancouverTrip(start?: string | null, destination?: string | null): boolean {
  return `${start || ''} ${destination || ''}`.toLowerCase().includes('vancouver')
}

export function mileageAmount(km: number, rate: number, uplift: number, start?: string | null, destination?: string | null): number {
  if (!Number.isFinite(km) || km <= 0) return 0
  const amount = km * rate
  return isVancouverTrip(start, destination) ? amount * (1 + uplift) : amount
}

/** 0.02 as "2%", 0.025 as "2.5%". */
export function percentLabel(fraction: number): string {
  return `${Number((fraction * 100).toFixed(2))}%`
}
