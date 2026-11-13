/**
 * Claim notification emails, built on the server from database rows so the
 * browser never supplies HTML or recipients.
 */

export interface EmailClaim {
  id: string
  date: string | null
  description: string | null
  amount: number
  job_number: string | null
  category_name: string
  subcategory_name: string
}

export const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export const formatCurrency = (amount: number | string | null | undefined): string =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(amount) || 0)

/** Claim dates are calendar days stored as timestamps, so read the day part and ignore the zone. */
export const formatDate = (value: string | null): string => {
  if (!value) return 'N/A'
  const [y, m, d] = value.split('T')[0].split('-').map(Number)
  if (!y || !m || !d) return escapeHtml(value)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

const claimBlock = (claim: EmailClaim) => `
  <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e5e7eb;">
    <p><strong>Date:</strong> ${formatDate(claim.date)}</p>
    <p><strong>Description:</strong> ${escapeHtml(claim.description || 'N/A')}</p>
    <p><strong>Amount:</strong> ${formatCurrency(claim.amount)}</p>
    <p><strong>Category:</strong> ${escapeHtml(claim.category_name)} - ${escapeHtml(claim.subcategory_name)}</p>
    ${claim.job_number ? `<p><strong>Job Number:</strong> ${escapeHtml(claim.job_number)}</p>` : ''}
  </div>`

const layout = (opts: {
  heading: string
  colour: string
  greeting: string
  intro: string
  summary: string[]
  claims: EmailClaim[]
  callout?: { colour: string, background: string, html: string }
  outro: string
}) => `
  <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
    <h2 style="color: ${opts.colour};">${opts.heading}</h2>
    <p>Hello ${escapeHtml(opts.greeting || 'there')},</p>
    <p>${opts.intro}</p>

    <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
      <h3 style="margin-top: 0;">Summary</h3>
      ${opts.summary.map(line => `<p>${line}</p>`).join('')}
    </div>

    <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
      <h3 style="margin-top: 0;">Claim Details</h3>
      ${opts.claims.map(claimBlock).join('')}
    </div>

    ${opts.callout ? `
    <div style="background-color: ${opts.callout.background}; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid ${opts.callout.colour};">
      ${opts.callout.html}
    </div>` : ''}

    <p>${opts.outro}</p>

    <div style="margin-top: 30px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 15px;">
      <p>This is an automated notification from the GibClaim System.</p>
    </div>
  </div>`

const totals = (claims: EmailClaim[]) => {
  const total = claims.reduce((sum, c) => sum + Number(c.amount || 0), 0)
  return [
    `<strong>Total Claims:</strong> ${claims.length}`,
    `<strong>Total Amount:</strong> ${formatCurrency(total)}`,
  ]
}

export interface Email { subject: string, html: string }

/** To the employee, confirming what they just submitted. */
export const submissionConfirmationEmail = (recipientName: string, claims: EmailClaim[]): Email => ({
  subject: plural(claims.length, 'Claim Submitted Successfully', 'Claims Submitted Successfully'),
  html: layout({
    heading: plural(claims.length, 'Claim Submitted Successfully', 'Claims Submitted Successfully'),
    colour: '#16a34a',
    greeting: recipientName,
    intro: `Your reimbursement ${plural(claims.length, 'claim has', 'claims have')} been successfully submitted and ${plural(claims.length, 'is', 'are')} now under review.`,
    summary: totals(claims),
    claims,
    callout: { colour: '#16a34a', background: '#dcfce7', html: '<p><strong>Status:</strong> Submitted - Under Review</p>' },
    outro: `You'll receive an email once ${plural(claims.length, 'it has', 'they have')} been processed by accounting.`,
  }),
})

/** To the first-line reviewers (reviewer role or admins) for new claims. */
export const newSubmissionEmail = (recipientName: string, employeeName: string, claims: EmailClaim[], dashboard: string): Email => ({
  subject: plural(claims.length, 'New Reimbursement Claim Submitted', 'New Reimbursement Claims Submitted'),
  html: layout({
    heading: plural(claims.length, 'New Claim Submission', 'New Claims Submission'),
    colour: '#2563eb',
    greeting: recipientName,
    intro: `New reimbursement ${plural(claims.length, 'claim has', 'claims have')} been submitted by ${escapeHtml(employeeName)} and ${plural(claims.length, 'requires', 'require')} your verification.`,
    summary: [`<strong>Employee:</strong> ${escapeHtml(employeeName)}`, ...totals(claims)],
    claims,
    outro: `Please review ${plural(claims.length, 'this claim', 'these claims')} in the ${dashboard} dashboard.`,
  }),
})

/** To the department's managers once claims are verified. */
export const verifiedEmail = (recipientName: string, employeeName: string, claims: EmailClaim[]): Email => ({
  subject: `${claims.length} Reimbursement ${plural(claims.length, 'Claim', 'Claims')} Verified`,
  html: layout({
    heading: plural(claims.length, 'Claim Verified', 'Claims Verified'),
    colour: '#2563eb',
    greeting: recipientName,
    intro: `${plural(claims.length, 'A reimbursement claim', 'Reimbursement claims')} from ${escapeHtml(employeeName)} ${plural(claims.length, 'has', 'have')} been verified and ${plural(claims.length, 'requires', 'require')} your approval.`,
    summary: [`<strong>Employee:</strong> ${escapeHtml(employeeName)}`, ...totals(claims)],
    claims,
    outro: `Please review and approve ${plural(claims.length, 'this claim', 'these claims')} in the manager dashboard.`,
  }),
})

/** To accounting once claims are approved. */
export const approvedEmail = (recipientName: string, employeeName: string, claims: EmailClaim[]): Email => ({
  subject: `${claims.length} Reimbursement ${plural(claims.length, 'Claim', 'Claims')} Approved`,
  html: layout({
    heading: plural(claims.length, 'Claim Approved', 'Claims Approved'),
    colour: '#2563eb',
    greeting: recipientName,
    intro: `${plural(claims.length, 'A reimbursement claim', 'Reimbursement claims')} from ${escapeHtml(employeeName)} ${plural(claims.length, 'has', 'have')} been approved and ${plural(claims.length, 'requires', 'require')} your processing.`,
    summary: [`<strong>Employee:</strong> ${escapeHtml(employeeName)}`, ...totals(claims)],
    claims,
    outro: `Please process ${plural(claims.length, 'this claim', 'these claims')} in the accounting dashboard.`,
  }),
})

/** To the employee once accounting processes their claims. */
export const processedEmail = (recipientName: string, claims: EmailClaim[]): Email => ({
  subject: `Your Reimbursement ${plural(claims.length, 'Claim Has', 'Claims Have')} Been Processed`,
  html: layout({
    heading: plural(claims.length, 'Claim Processing Complete', 'Claims Processing Complete'),
    colour: '#16a34a',
    greeting: recipientName,
    intro: `Your reimbursement ${plural(claims.length, 'claim has', 'claims have')} been processed and approved for payment.`,
    summary: totals(claims),
    claims,
    outro: `The approved ${plural(claims.length, 'amount', 'amounts')} will be included in your next payroll cycle.`,
  }),
})

/** To the employee when claims are rejected. Each claim carries its own reason. */
export const rejectedEmail = (
  recipientName: string,
  rejectorName: string,
  claims: Array<EmailClaim & { rejection_reason: string | null }>,
): Email => {
  const reasons = [...new Set(claims.map(c => c.rejection_reason?.trim()).filter(Boolean))] as string[]
  return {
    subject: `Your Reimbursement ${plural(claims.length, 'Claim Has', 'Claims Have')} Been Rejected`,
    html: layout({
      heading: plural(claims.length, 'Claim Rejected', 'Claims Rejected'),
      colour: '#e11d48',
      greeting: recipientName,
      intro: `Your reimbursement ${plural(claims.length, 'claim has', 'claims have')} been rejected.`,
      summary: [...totals(claims), `<strong>Rejected by:</strong> ${escapeHtml(rejectorName)}`],
      claims,
      callout: {
        colour: '#e11d48',
        background: '#fee2e2',
        html: `<h3 style="margin-top: 0; color: #e11d48;">Rejection ${plural(reasons.length, 'Reason', 'Reasons')}</h3>${
          reasons.length ? reasons.map(r => `<p>${escapeHtml(r)}</p>`).join('') : '<p>No specific reason provided.</p>'
        }`,
      },
      outro: 'You can correct and resubmit rejected claims from your dashboard. If you have questions about this decision, please contact your manager or the finance department.',
    }),
  }
}
