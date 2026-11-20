/**
 * Lets an admin set a new password for someone who is locked out.
 * Accounts with an unconfirmed email can't sign in with any password, so
 * they are refused (pending invitees get pointed at Resend invite).
 */
const MIN_LENGTH = 6

export default defineEventHandler(async (event) => {
  await requireCaller(event, ['admin'])

  const body = await readBody<{ userId?: unknown, password?: unknown }>(event)
  const userId = typeof body?.userId === 'string' ? body.userId : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!userId) {
    throw createError({ statusCode: 400, statusMessage: 'userId is required' })
  }
  if (password.length < MIN_LENGTH) {
    throw createError({ statusCode: 400, statusMessage: `Password must be at least ${MIN_LENGTH} characters` })
  }

  const admin = useSupabaseAdmin()
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error || !data?.user) {
    throw createError({ statusCode: 404, statusMessage: 'No sign-in account found for this user' })
  }
  // Supabase won't let anyone sign in until their email is confirmed, whatever their password
  if (isPendingInvite(data.user)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This person has not accepted their invite yet, so a password will not let them in. Use Resend invite instead.',
    })
  }
  if (!data.user.email_confirmed_at) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This account never confirmed its email address, so a password will not let them in.',
    })
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password })
  if (updateError) {
    throw createError({ statusCode: 400, statusMessage: `Could not update the password: ${updateError.message}` })
  }
  return { email: data.user.email }
})
