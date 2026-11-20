/**
 * Deactivates a former employee, or reactivates them.
 *
 * Deactivating blocks sign-in to both apps (a Supabase Auth ban), stops
 * claim emails going to them, and keeps every claim they submitted or signed
 * off. Nothing is deleted, so reactivating puts them back exactly as they were.
 */

// Supabase has no "ban forever", so use 100 years.
const BAN_FOREVER = '876000h'

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event, ['admin'])

  const body = await readBody<{ userId?: unknown, deactivate?: unknown }>(event)
  const userId = typeof body?.userId === 'string' ? body.userId : ''
  if (!userId || typeof body?.deactivate !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'userId and deactivate are required' })
  }
  const deactivate = body.deactivate
  if (deactivate && userId === caller.id) {
    throw createError({ statusCode: 400, statusMessage: 'You cannot deactivate your own account' })
  }

  const admin = useSupabaseAdmin()

  // Block (or restore) sign-in first, so a failure part-way never leaves
  // someone marked deactivated who can still get in.
  const { error: banError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: deactivate ? BAN_FOREVER : 'none',
  })
  if (banError) {
    const notFound = banError.status === 404
    throw createError({
      statusCode: notFound ? 404 : 502,
      statusMessage: notFound
        ? 'No sign-in account found for this user'
        : `Could not ${deactivate ? 'block' : 'restore'} their sign-in: ${banError.message}`,
    })
  }

  const deactivatedAt = deactivate ? new Date().toISOString() : null
  const { data: updated, error: updateError } = await admin
    .from('users')
    .update({ deactivated_at: deactivatedAt })
    .eq('id', userId)
    .select('id, role, department')
  if (updateError || !updated?.length) {
    throw createError({
      statusCode: 500,
      statusMessage: `Sign-in was ${deactivate ? 'blocked' : 'restored'}, but the profile could not be updated. Try again.`,
    })
  }

  // Claims are routed by role (and, for managers, by department), so warn
  // when this was the last active person doing that job.
  let noOneLeft: string | null = null
  const { role, department } = updated[0]
  if (deactivate && role && role !== 'employee') {
    let others = admin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', role)
      .is('deactivated_at', null)
    if (role === 'manager') others = others.eq('department', department)
    const { count, error } = await others
    if (!error && count === 0) {
      noOneLeft = role === 'manager' ? `manager for ${department || 'their department'}` : role
    }
  }

  return { userId, deactivatedAt, noOneLeft }
})
