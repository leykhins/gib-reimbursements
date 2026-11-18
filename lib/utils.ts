import { getLocalTimeZone, parseDate } from '@internationalized/date'

/**
 * Gets a signed URL for a receipt and determines if it's an image
 * @param client Supabase client instance
 * @param receiptUrl The storage path to the receipt
 * @returns Object containing the signed URL and whether it's an image
 */
export const getReceiptSignedUrl = async (
  client: any,
  receiptUrl: string
): Promise<{ signedUrl: string | null; isImage: boolean }> => {
  // Early return if no receipt URL provided
  if (!receiptUrl) return { signedUrl: null, isImage: false };
  
  try {
    // Ensure client is properly initialized before using
    if (!client || !client.storage) {
      console.error('Invalid Supabase client');
      return { signedUrl: null, isImage: false };
    }
    
    const { data, error } = await client.storage
      .from('receipts')
      // Long enough for the lightbox's "open in a new tab" and PDF frames to keep working.
      .createSignedUrl(receiptUrl, 60 * 10);
    
    if (error) {
      console.error('Supabase storage error:', error);
      throw error;
    }
    
    // Helper function defined within the same module or imported
    const isImage = isImageFile(receiptUrl);
    
    return {
      signedUrl: data?.signedUrl || null,
      isImage
    };
  } catch (err) {
    console.error('Error getting signed URL:', err);
    return { signedUrl: null, isImage: false };
  }
};

/**
 * Determines if a file is an image based on its extension
 */
export function isImageFile(filename: string): boolean {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
  const lowerCaseFilename = filename.toLowerCase();
  return imageExtensions.some(ext => lowerCaseFilename.endsWith(ext));
}

/**
 * Parses a date-only string (YYYY-MM-DD) into a local Date.
 * If an ISO datetime is passed, only the date part is used.
 */
export function parseLocalDateString(dateString: string): Date {
  return parseDate(dateString.split('T')[0]).toDate(getLocalTimeZone())
}

export type MonthlyClaimStatusValue = 'completed' | 'has-claims' | undefined

export interface MonthlyClaimCounts { month: number; total: number; pending: number; completed: number }

/**
 * Per-month claim counts for a year, from the monthly_claim_status() database
 * function (rejected claims excluded). `month` is 1-12 as the database sends it.
 * Pass employeeIds to count only those employees' claims.
 */
export async function fetchMonthlyClaimCounts(
  client: any,
  year: number,
  employeeIds: string[] | null = null
): Promise<MonthlyClaimCounts[]> {
  const { data, error } = await client.rpc('monthly_claim_status', {
    p_year: year,
    p_employee_ids: employeeIds
  })
  if (error) throw error
  return (data || []).map((r: any) => ({
    month: Number(r.month),
    total: Number(r.total),
    pending: Number(r.pending),
    completed: Number(r.completed)
  }))
}

/** Finance and employee dots: green when every claim in the month is completed, red otherwise. */
export function completionStatusFromCounts(counts: MonthlyClaimCounts[], monthCount = 12): Record<number, MonthlyClaimStatusValue> {
  const status: Record<number, MonthlyClaimStatusValue> = {}
  for (let i = 0; i < monthCount; i++) status[i] = undefined
  counts.forEach((c) => {
    if (c.total > 0) status[c.month - 1] = c.total === c.completed ? 'completed' : 'has-claims'
  })
  return status
}

/** Approval page dots: red when any claim is pending, green when the rest have moved on. */
export function reviewStatusFromCounts(counts: MonthlyClaimCounts[], monthCount = 12): Record<number, 'pending' | 'verified' | undefined> {
  const status: Record<number, 'pending' | 'verified' | undefined> = {}
  for (let i = 0; i < monthCount; i++) status[i] = undefined
  counts.forEach((c) => {
    if (c.total > 0) status[c.month - 1] = c.pending > 0 ? 'pending' : 'verified'
  })
  return status
}

/**
 * Computes per-month status dots for a year from claim date + status.
 * Rejected claims are excluded. Green (completed) only when all claims in the month are completed.
 */
export function computeMonthlyClaimStatus(
  claims: Array<{ date: string; status: string }>,
  selectedYear: number,
  monthCount = 12
): Record<number, MonthlyClaimStatusValue> {
  const status: Record<number, MonthlyClaimStatusValue> = {}
  const monthCounts: Record<number, { total: number; completed: number }> = {}

  for (let i = 0; i < monthCount; i++) {
    status[i] = undefined
  }

  claims.forEach((claim) => {
    if (claim.status === 'rejected') return

    const dateParts = claim.date.split('-')
    if (dateParts.length !== 3) return

    const year = parseInt(dateParts[0], 10)
    const month = parseInt(dateParts[1], 10) - 1

    if (year !== selectedYear) return

    if (!monthCounts[month]) {
      monthCounts[month] = { total: 0, completed: 0 }
    }
    monthCounts[month].total++
    if (claim.status === 'completed') {
      monthCounts[month].completed++
    }
  })

  Object.entries(monthCounts).forEach(([monthStr, counts]) => {
    const month = parseInt(monthStr, 10)
    if (counts.total > 0) {
      status[month] = counts.total === counts.completed ? 'completed' : 'has-claims'
    }
  })

  return status
}

/** Overwrites base month statuses with values recomputed from loaded claims for those months. */
export function mergeMonthlyClaimStatus(
  base: Record<number, MonthlyClaimStatusValue>,
  loadedClaims: Array<{ date: string; status: string }>,
  selectedYear: number
): Record<number, MonthlyClaimStatusValue> {
  const status = { ...base }
  const claimsByMonth: Record<number, Array<{ date: string; status: string }>> = {}

  loadedClaims.forEach((claim) => {
    if (claim.status === 'rejected') return

    const dateParts = claim.date.split('-')
    if (dateParts.length !== 3) return

    const year = parseInt(dateParts[0], 10)
    const month = parseInt(dateParts[1], 10) - 1

    if (year !== selectedYear) return

    if (!claimsByMonth[month]) {
      claimsByMonth[month] = []
    }
    claimsByMonth[month].push(claim)
  })

  Object.entries(claimsByMonth).forEach(([monthStr, monthClaims]) => {
    const month = parseInt(monthStr, 10)
    const computed = computeMonthlyClaimStatus(monthClaims, selectedYear)
    if (computed[month] !== undefined) {
      status[month] = computed[month]
    }
  })

  return status
}
export interface WaitingMonth { year: number; month: number; count: number }

/**
 * Counts claims by month, oldest first, for the queue pages' "Waiting in"
 * strip. `month` is 0-based to match the pages' month tabs.
 */
export function countWaitingMonths(claims: Array<{ date: string }>): WaitingMonth[] {
  const counts = new Map<string, number>()
  for (const claim of claims) {
    const period = claim.date?.slice(0, 7)
    if (period && /^\d{4}-\d{2}$/.test(period)) counts.set(period, (counts.get(period) || 0) + 1)
  }
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, count]) => ({ year: Number(period.slice(0, 4)), month: Number(period.slice(5, 7)) - 1, count }))
}
