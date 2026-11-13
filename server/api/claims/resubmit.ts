/**
 * The employee corrects one of their rejected claims and sends it back for
 * review. Runs with the service role because the RLS update policy does not
 * let an employee move a claim out of rejected, so the ownership, status and
 * column checks here are what keep it safe.
 */

/** The fields an employee may change when correcting a rejected claim. */
const EDITABLE = [
  'description', 'amount', 'gst_amount', 'pst_amount', 'date',
  'category_id', 'subcategory_mapping_id', 'job_number',
  'license_number', 'related_employee', 'client_name', 'company_name',
  'start_location', 'destination', 'travel_distance',
] as const

const NUMERIC = new Set(['amount', 'gst_amount', 'pst_amount', 'travel_distance'])

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)

  const body = await readBody<{ claimId?: unknown, updates?: Record<string, unknown> }>(event)
  const claimId = typeof body?.claimId === 'string' ? body.claimId : ''
  const updates = body?.updates
  if (!claimId || !updates || typeof updates !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'claimId and updates are required' })
  }

  const changes: Record<string, unknown> = {}
  for (const key of EDITABLE) {
    if (!(key in updates)) continue
    const value = updates[key]
    if (NUMERIC.has(key)) {
      if (value === null && key === 'travel_distance') {
        changes[key] = null
        continue
      }
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) {
        throw createError({ statusCode: 400, statusMessage: `${key} must be a number of zero or more` })
      }
      changes[key] = n
    } else {
      if (value !== null && typeof value !== 'string') {
        throw createError({ statusCode: 400, statusMessage: `${key} must be text` })
      }
      changes[key] = value
    }
  }
  if (typeof changes.amount === 'number' && changes.amount <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'amount must be more than zero' })
  }

  const admin = useSupabaseAdmin()

  const { data: claim, error: fetchError } = await admin
    .from('claims')
    .select('id, status, employee_id')
    .eq('id', claimId)
    .maybeSingle()

  if (fetchError || !claim || claim.employee_id !== caller.id) {
    throw createError({ statusCode: 404, statusMessage: 'Claim not found' })
  }
  if (claim.status !== 'rejected') {
    throw createError({ statusCode: 403, statusMessage: 'Only rejected claims can be resubmitted' })
  }

  const { error: updateError } = await admin
    .from('claims')
    .update({ ...changes, status: 'pending', updated_at: new Date().toISOString() })
    .eq('id', claimId)
    .eq('employee_id', caller.id)
    .eq('status', 'rejected')

  if (updateError) {
    console.error('Could not resubmit claim:', updateError.message)
    throw createError({ statusCode: 500, statusMessage: 'Could not resubmit claim' })
  }

  return { success: true }
})
