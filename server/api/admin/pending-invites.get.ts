/**
 * The people who were invited but have not opened their invite link yet,
 * so the Users page can mark them and offer to send the invite again.
 */
export default defineEventHandler(async (event) => {
  await requireCaller(event, ['admin'])

  const users = await listAllAuthUsers(useSupabaseAdmin())
  return {
    pending: users
      .filter(isPendingInvite)
      .map(u => ({ id: u.id, invitedAt: u.invited_at ?? null })),
  }
})
