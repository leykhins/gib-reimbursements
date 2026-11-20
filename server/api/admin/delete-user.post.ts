/**
 * Deletes an account that has no history in the app, such as an invite
 * nobody accepted or a stray self-signup.
 *
 * Deleting is refused for anyone with claims or other records. The database
 * cascades a user delete to every claim they submitted, approved, verified or
 * processed (and their claim notes), so deleting a real employee or manager
 * would wipe other people's expense history with it.
 */

type Usage = { label: string, count: number }

async function countRows(table: string, column: string, userId: string): Promise<number> {
  const { count, error } = await useSupabaseAdmin()
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, userId)
  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Could not check ${table} before deleting` })
  }
  return count ?? 0
}

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event, ['admin'])

  const body = await readBody<{ userId?: unknown }>(event)
  const userId = typeof body?.userId === 'string' ? body.userId : ''
  if (!userId) {
    throw createError({ statusCode: 400, statusMessage: 'userId is required' })
  }
  if (userId === caller.id) {
    throw createError({ statusCode: 400, statusMessage: 'You cannot delete your own account' })
  }

  const counts = await Promise.all([
    countRows('claims', 'employee_id', userId).then(count => ({ label: 'claims submitted', count })),
    countRows('claims', 'manager_approved_by', userId).then(count => ({ label: 'claims approved', count })),
    countRows('claims', 'admin_verified_by', userId).then(count => ({ label: 'claims verified', count })),
    countRows('claims', 'accounting_processed_by', userId).then(count => ({ label: 'claims processed', count })),
    countRows('claim_notes', 'user_id', userId).then(count => ({ label: 'claim notes', count })),
    countRows('department_managers', 'manager_id', userId).then(count => ({ label: 'department manager assignments', count })),
    countRows('audit_logs', 'performed_by', userId).then(count => ({ label: 'audit log entries', count })),
    countRows('email_notifications', 'sent_by', userId).then(count => ({ label: 'notifications sent', count })),
  ])
  const inUse = counts.filter((u: Usage) => u.count > 0)
  if (inUse.length) {
    const summary = inUse.map(u => `${u.count} ${u.label}`).join(', ')
    throw createError({
      statusCode: 409,
      statusMessage: `This account has history (${summary}), so it can't be deleted without losing those records.`,
    })
  }

  const admin = useSupabaseAdmin()
  const { data: found, error: findError } = await admin.auth.admin.getUserById(userId)
  if (findError && findError.status !== 404) {
    throw createError({ statusCode: 502, statusMessage: `Could not look up the account: ${findError.message}` })
  }

  if (!found?.user) {
    // Supabase confirmed there is no sign-in account, only a leftover profile row. Remove that directly.
    const { error } = await admin.from('users').delete().eq('id', userId)
    if (error) {
      throw createError({ statusCode: 500, statusMessage: `Could not delete the profile: ${error.message}` })
    }
    return { deleted: userId }
  }

  // The on_auth_user_deleted trigger removes the matching public.users row
  // in the same transaction, so either both go or neither does.
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) {
    throw createError({ statusCode: 500, statusMessage: `Could not delete the account: ${error.message}` })
  }
  return { deleted: userId, email: found.user.email }
})
