/**
 * Admins invite people by email. Supabase sends the invite; the
 * handle_new_user() trigger creates their users row (role employee), and
 * they fill in their name on the signup page.
 */

const MAX_INVITES = 50
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default defineEventHandler(async (event) => {
  await requireCaller(event, ['admin'])

  const body = await readBody<{ users?: Array<{ email?: unknown }> }>(event)
  if (!Array.isArray(body?.users)) {
    throw createError({ statusCode: 400, statusMessage: 'Users must be an array' })
  }
  if (body.users.length > MAX_INVITES) {
    throw createError({ statusCode: 400, statusMessage: `At most ${MAX_INVITES} invitations at once` })
  }

  const redirectTo = inviteRedirectUrl()
  const admin = useSupabaseAdmin()

  const results: Array<{ email: string, success: boolean, message?: string, error?: string }> = []

  // One at a time, spaced out, to stay inside Supabase's email rate limit.
  for (const [i, user] of body.users.entries()) {
    const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : ''
    if (!EMAIL.test(email)) {
      results.push({ email, success: false, error: 'Invalid email' })
      continue
    }
    if (i > 0) await new Promise(resolve => setTimeout(resolve, 500))

    const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
    results.push(error
      ? { email, success: false, error: error.message }
      : { email, success: true, message: 'Invitation sent successfully' })
  }

  const successCount = results.filter(r => r.success).length
  return {
    success: successCount > 0,
    results,
    message: `Successfully sent ${successCount} of ${body.users.length} invitations`,
  }
})
