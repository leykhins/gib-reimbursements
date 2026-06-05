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
      .createSignedUrl(receiptUrl, 60);
    
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