import { isReviewerQueueClaim } from './claimRouting'

/**
 * Categories whose amounts the form calculates, so a correction keeps the
 * category: mileage and the three live out allowances. Matches `correct_claim()`.
 */
export function isCalculatedCategory(name?: string | null): boolean {
  return name === 'Car Mileages' || (name || '').startsWith('Live Out Allowance')
}

/** A claim row as the staff queue pages load it. */
export interface CorrectableClaim {
  id: string
  employee_id: string
  status: string
  date: string
  job_number?: string | null
  description?: string | null
  subcategory_mapping_id?: string | null
  license_number?: string | null
  related_employee?: string | null
  client_name?: string | null
  company_name?: string | null
  is_travel?: boolean | null
  pdf_downloaded_at?: string | null
  category?: { id?: string, category_name?: string | null } | null
  subcategory_mapping?: { subcategory?: { subcategory_name?: string | null } | null } | null
  users?: { role?: string | null, department?: string | null } | null
}

/**
 * Whether the signed-in user may correct a claim's date, subcategory, job
 * number or description: `edit`, `locked` once the claim is in a downloaded
 * PDF, or `none`. Mirrors `correct_claim()` in the database, which has the
 * final say. Admins correct any claim, their own included, and everyone else
 * any claim but their own: reviewers the job-number claims routed to them,
 * managers their own department's. A rejected claim is with the employee to
 * revise.
 */
export function correctionAccess(
  claim: CorrectableClaim,
  role?: string | null,
  userId?: string | null,
  department?: string | null,
): 'edit' | 'locked' | 'none' {
  if (!userId || !role || !['admin', 'reviewer', 'manager', 'accounting'].includes(role)) return 'none'
  if (claim.status === 'rejected') return 'none'
  if (claim.employee_id === userId && role !== 'admin') return 'none'
  if (role === 'reviewer' && !isReviewerQueueClaim(claim)) return 'none'
  if (role === 'manager' && (!department || claim.users?.department !== department)) return 'none'
  return claim.pdf_downloaded_at ? 'locked' : 'edit'
}

/** The claim's date as YYYY-MM-DD, as `correct_claim()` takes it. */
export const claimDay = (date: string) => String(date || '').slice(0, 10)
