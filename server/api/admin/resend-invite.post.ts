/**
 * Sends a fresh invite email to someone who has not accepted theirs yet.
 * Supabase reuses their existing account and issues a new link, which
 * replaces the old one, so there is no need to delete and re-invite them.
 */
export default defineEventHandler(async (event) => {
  await requireCaller(event, ['admin'])

  const body = await readBody<{ userId?: unknown }>(event)
  const userId = typeof body?.userId === 'string' ? body.userId : ''
  if (!userId) {
    throw createError({ statusCode: 400, statusMessage: 'userId is required' })
  }

  const admin = useSupabaseAdmin()
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error || !data?.user?.email) {
    throw createError({ statusCode: 404, statusMessage: 'No account found for this user' })
  }

  const user = data.user
  if (!isPendingInvite(user)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This person has already accepted their invite. They can use "Forgot password" on the login page.',
    })
  }

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(user.email!, {
    redirectTo: inviteRedirectUrl(),
  })
  if (inviteError) {
    throw createError({ statusCode: 502, statusMessage: `Could not send the invite: ${inviteError.message}` })
  }

  return { email: user.email }
})
