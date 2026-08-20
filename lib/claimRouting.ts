export function hasJobNumber(jobNumber?: string | null): boolean {
  return Boolean(jobNumber && jobNumber.trim() !== '')
}

export function skipsManagerApproval(role?: string | null): boolean {
  return role === 'manager' || role === 'admin'
}

export function splitFirstReviewNotificationIds(
  claims: Array<{ id: string, users?: { role?: string | null } | null }>,
  ids: string[]
): { skipManagerIds: string[], managerReviewIds: string[] } {
  const skipManagerIds: string[] = []
  const managerReviewIds: string[] = []

  for (const id of ids) {
    const claim = claims.find(c => c.id === id)
    if (skipsManagerApproval(claim?.users?.role)) {
      skipManagerIds.push(id)
    } else {
      managerReviewIds.push(id)
    }
  }

  return { skipManagerIds, managerReviewIds }
}

/** Job-number claims from non-leadership staff go to the reviewer. */
export function isReviewerQueueClaim(claim: {
  job_number?: string | null
  users?: { role?: string | null } | null
}): boolean {
  return hasJobNumber(claim.job_number) && !skipsManagerApproval(claim.users?.role)
}

/** Overhead claims and leadership-submitted claims go to admin. */
export function isAdminQueueClaim(claim: {
  job_number?: string | null
  users?: { role?: string | null } | null
}): boolean {
  return !isReviewerQueueClaim(claim)
}
