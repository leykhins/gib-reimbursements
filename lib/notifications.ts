/**
 * Claim notification emails.
 *
 * The browser only says which step it just took and on which claims. The
 * server (server/api/notify.post.ts) checks that the signed-in user really
 * took that step, then works out the recipients and builds the email from
 * the database. Nothing here can choose a recipient or the email content.
 *
 * The several names below are kept so existing pages keep working; they all
 * map onto one of three events.
 */

import { authHeaders } from './apiAuth'

export interface NotificationResult {
  success: boolean
  sent?: number
  failed?: number
  skipped?: number
  error?: string
}

type NotifyEvent = 'submitted' | 'advanced' | 'rejected'

const notify = async (event: NotifyEvent, claimIds: string | string[]): Promise<NotificationResult> => {
  const ids = (Array.isArray(claimIds) ? claimIds : [claimIds]).filter(Boolean)
  if (!ids.length) return { success: true, sent: 0, failed: 0, skipped: 0 }

  try {
    return await $fetch<NotificationResult>('/api/notify', {
      method: 'POST',
      headers: await authHeaders(),
      body: { event, claimIds: ids },
    })
  } catch (err: any) {
    const error = err?.data?.statusMessage || err?.statusMessage || err?.message || 'Could not send notification'
    console.error(`Notification (${event}) failed:`, error)
    return { success: false, error }
  }
}

/** The employee just submitted these claims. */
export const sendEnhancedConsolidatedClaimSubmissionEmail = (claimIds: string[]) =>
  notify('submitted', claimIds)

/**
 * The caller just verified, approved or processed these claims. The server
 * picks the email from each claim's new status, so these are interchangeable.
 */
export const sendEnhancedAdminVerificationEmail = (claimId: string) => notify('advanced', claimId)
export const sendConsolidatedAdminVerificationEmail = (claimIds: string[]) => notify('advanced', claimIds)
export const sendEnhancedManagerApprovalEmail = (claimId: string) => notify('advanced', claimId)
export const sendConsolidatedManagerApprovalEmail = (claimIds: string[]) => notify('advanced', claimIds)
export const sendManagerApprovalEmail = (claimId: string, ..._ignored: unknown[]) => notify('advanced', claimId)
export const sendClaimProcessedEmail = (claimId: string) => notify('advanced', claimId)
export const sendConsolidatedProcessingCompleteEmail = (claimIds: string[]) => notify('advanced', claimIds)

/**
 * The caller just rejected these claims. The rejector's name and the reason
 * come from the database; the extra arguments are accepted and ignored.
 */
export const sendClaimRejectionEmail = (claimId: string, ..._ignored: unknown[]) => notify('rejected', claimId)
export const sendEnhancedClaimRejectionEmail = (claimId: string, ..._ignored: unknown[]) => notify('rejected', claimId)
export const sendConsolidatedRejectionEmail = (claimIds: string[], ..._ignored: unknown[]) => notify('rejected', claimIds)
