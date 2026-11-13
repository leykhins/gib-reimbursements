export function hasJobNumber(jobNumber?: string | null): boolean {
  return Boolean(jobNumber && jobNumber.trim() !== '')
}

export function skipsManagerApproval(role?: string | null): boolean {
  return role === 'manager' || role === 'admin'
}

export function isRsmDepartment(department?: string | null): boolean {
  return (department ?? '').trim().toLowerCase() === 'rsm'
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

/**
 * Job-number claims from everyone except managers, admins, reviewers and the
 * RSM department go to the reviewer. Matches update_claim_status() in the
 * database; a reviewer's own claims go to admin so nobody reviews their own.
 */
export function isReviewerQueueClaim(claim: {
  job_number?: string | null
  users?: { role?: string | null, department?: string | null } | null
}): boolean {
  return hasJobNumber(claim.job_number)
    && !skipsManagerApproval(claim.users?.role)
    && claim.users?.role !== 'reviewer'
    && !isRsmDepartment(claim.users?.department)
}

/** Overhead claims, leadership and reviewer claims, and RSM department claims go to admin. */
export function isAdminQueueClaim(claim: {
  job_number?: string | null
  users?: { role?: string | null, department?: string | null } | null
}): boolean {
  return !isReviewerQueueClaim(claim)
}
