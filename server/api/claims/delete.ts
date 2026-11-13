/**
 * The employee deletes one of their own rejected claims. Runs with the
 * service role, so the ownership and status checks here are what keep it safe.
 */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)

  const body = await readBody<{ claimId?: unknown }>(event)
  const claimId = typeof body?.claimId === 'string' ? body.claimId : ''
  if (!claimId) {
    throw createError({ statusCode: 400, statusMessage: 'claimId is required' })
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
    throw createError({ statusCode: 403, statusMessage: 'Only rejected claims can be deleted' })
  }

  const { error: deleteError } = await admin
    .from('claims')
    .delete()
    .eq('id', claimId)
    .eq('employee_id', caller.id)
    .eq('status', 'rejected')

  if (deleteError) {
    console.error('Could not delete claim:', deleteError.message)
    throw createError({ statusCode: 500, statusMessage: 'Could not delete claim' })
  }

  return { success: true }
})
