import { Resend } from 'resend'
import { isReviewerQueueClaim } from '~/lib/claimRouting'
import type { EmailClaim } from '../utils/emailTemplates'

/**
 * Sends the emails for a claim step the caller has just taken.
 *
 * The browser names the step and the claims; everything else (who receives
 * the email, what it says) comes from the database. The caller must be the
 * person who took the step, within the last few minutes, so this cannot be
 * used to send mail on someone else's behalf, to arbitrary addresses, or
 * with arbitrary content. A claim that already had its email for that step
 * is skipped, so repeating a call does not send twice.
 *
 *   submitted  the caller submitted these claims
 *   advanced   the caller verified, approved or processed these claims; the
 *              email follows the status each claim is now in
 *   rejected   the caller rejected these claims
 */

type NotifyEvent = 'submitted' | 'advanced' | 'rejected'
type NotificationType = 'submission' | 'verified' | 'approved' | 'processed' | 'rejection'

const RECENT_MS = 15 * 60 * 1000
const MAX_CLAIMS = 200
const STAFF = ['admin', 'manager', 'accounting', 'reviewer'] as const

interface Person { id?: string, email: string, first_name: string | null, last_name: string | null, role?: string | null, department?: string | null }

interface ClaimRow {
  id: string
  employee_id: string
  description: string | null
  amount: number
  date: string | null
  job_number: string | null
  status: string
  rejection_reason: string | null
  created_at: string | null
  admin_verified_by: string | null
  admin_verified_at: string | null
  manager_approved_by: string | null
  manager_approved_at: string | null
  accounting_processed_by: string | null
  accounting_processed_at: string | null
  claim_categories: { category_name: string | null } | null
  category_subcategory_mapping: { claim_subcategories: { subcategory_name: string | null } | null } | null
  users: Person | null
}

interface Outgoing {
  to: string
  subject: string
  html: string
  type: NotificationType
  claimIds: string[]
}

const nameOf = (p: Person | null | undefined) => {
  const full = `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim()
  return full || p?.email || 'Unknown employee'
}

const isRecent = (at: string | null | undefined) =>
  !!at && Date.now() - new Date(at).getTime() <= RECENT_MS

const toEmailClaim = (c: ClaimRow): EmailClaim & { rejection_reason: string | null } => ({
  id: c.id,
  date: c.date,
  description: c.description,
  amount: Number(c.amount),
  job_number: c.job_number,
  category_name: c.claim_categories?.category_name || 'N/A',
  subcategory_name: c.category_subcategory_mapping?.claim_subcategories?.subcategory_name || 'N/A',
  rejection_reason: c.rejection_reason,
})

const groupBy = <T>(items: T[], key: (item: T) => string) => {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    map.set(k, [...(map.get(k) ?? []), item])
  }
  return map
}

export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const body = await readBody<{ event?: NotifyEvent, claimIds?: unknown }>(event)

  const notifyEvent = body?.event
  if (notifyEvent !== 'submitted' && notifyEvent !== 'advanced' && notifyEvent !== 'rejected') {
    throw createError({ statusCode: 400, statusMessage: 'Unknown event' })
  }

  const claimIds = Array.isArray(body?.claimIds)
    ? [...new Set(body.claimIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : []
  if (!claimIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'claimIds is required' })
  }
  if (claimIds.length > MAX_CLAIMS) {
    throw createError({ statusCode: 400, statusMessage: `At most ${MAX_CLAIMS} claims per call` })
  }

  if (notifyEvent !== 'submitted' && !STAFF.includes(caller.role as typeof STAFF[number])) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const admin = useSupabaseAdmin()

  const { data: rows, error: claimsError } = await admin
    .from('claims')
    .select(`
      id, employee_id, description, amount, date, job_number, status, rejection_reason, created_at,
      admin_verified_by, admin_verified_at, manager_approved_by, manager_approved_at,
      accounting_processed_by, accounting_processed_at,
      claim_categories:category_id(category_name),
      category_subcategory_mapping:subcategory_mapping_id(claim_subcategories:subcategory_id(subcategory_name)),
      users!claims_employee_id_fkey(id, email, first_name, last_name, role, department)
    `)
    .in('id', claimIds)

  if (claimsError) {
    throw createError({ statusCode: 500, statusMessage: 'Could not load claims' })
  }

  const claims = (rows ?? []) as unknown as ClaimRow[]

  // Work out, per claim, which email it is due and when the step happened.
  const due: Array<{ claim: ClaimRow, type: NotificationType, at: string }> = []

  if (notifyEvent === 'submitted') {
    for (const c of claims) {
      if (c.employee_id === caller.id && c.status === 'pending' && isRecent(c.created_at)) {
        due.push({ claim: c, type: 'submission', at: c.created_at! })
      }
    }
  } else if (notifyEvent === 'advanced') {
    for (const c of claims) {
      if (c.status === 'verified' && c.admin_verified_by === caller.id && isRecent(c.admin_verified_at)) {
        due.push({ claim: c, type: 'verified', at: c.admin_verified_at! })
      } else if (c.status === 'approved' && c.manager_approved_by === caller.id && isRecent(c.manager_approved_at)) {
        due.push({ claim: c, type: 'approved', at: c.manager_approved_at! })
      } else if (c.status === 'completed' && c.accounting_processed_by === caller.id && isRecent(c.accounting_processed_at)) {
        due.push({ claim: c, type: 'processed', at: c.accounting_processed_at! })
      }
    }
  } else {
    const rejected = claims.filter(c => c.status === 'rejected')
    if (rejected.length) {
      const { data: logs } = await admin
        .from('audit_logs')
        .select('record_id, performed_at')
        .eq('table_name', 'claims')
        .eq('performed_by', caller.id)
        .like('action', '%_rejected')
        .in('record_id', rejected.map(c => c.id))
        .gte('performed_at', new Date(Date.now() - RECENT_MS).toISOString())
        .order('performed_at', { ascending: false })
      const latest = new Map<string, string>()
      for (const log of logs ?? []) {
        if (!latest.has(log.record_id)) latest.set(log.record_id, log.performed_at)
      }
      for (const c of rejected) {
        const at = latest.get(c.id)
        if (at) due.push({ claim: c, type: 'rejection', at })
      }
    }
  }

  // Drop claims that already had this email since the step happened. A
  // submission's created_at comes from the browser clock, so for those any
  // recent send counts.
  if (due.length) {
    const { data: already } = await admin
      .from('email_notifications')
      .select('claim_id, notification_type, sent_at')
      .in('claim_id', due.map(d => d.claim.id))
      .eq('status', 'sent')
      .gte('sent_at', new Date(Date.now() - RECENT_MS).toISOString())
    const sent = already ?? []
    for (let i = due.length - 1; i >= 0; i--) {
      const d = due[i]
      const stepAt = d.type === 'submission' ? 0 : new Date(d.at).getTime()
      if (sent.some(s => s.claim_id === d.claim.id && s.notification_type === d.type && new Date(s.sent_at).getTime() >= stepAt)) {
        due.splice(i, 1)
      }
    }
  }

  if (!due.length) {
    return { success: true, sent: 0, failed: 0, skipped: claimIds.length }
  }

  // Recipients, looked up once per role.
  const people = new Map<string, Person[]>()
  const peopleWithRole = async (role: string) => {
    if (!people.has(role)) {
      // Former employees who were deactivated keep their role but get no emails
      const { data } = await admin
        .from('users')
        .select('email, first_name, last_name, role, department')
        .eq('role', role)
        .is('deactivated_at', null)
      people.set(role, (data ?? []) as Person[])
    }
    return people.get(role)!
  }

  const outgoing: Outgoing[] = []
  const byTypeAndEmployee = groupBy(due, d => `${d.type}|${d.claim.employee_id}`)

  for (const items of byTypeAndEmployee.values()) {
    const type = items[0].type
    const employee = items[0].claim.users
    const employeeName = nameOf(employee)
    const claimsFor = (list: typeof items) => list.map(d => toEmailClaim(d.claim))
    const idsFor = (list: typeof items) => list.map(d => d.claim.id)

    if (type === 'submission') {
      if (employee?.email) {
        const email = submissionConfirmationEmail(employeeName, claimsFor(items))
        outgoing.push({ to: employee.email, ...email, type, claimIds: idsFor(items) })
      }

      const reviewerItems = items.filter(d => isReviewerQueueClaim({ job_number: d.claim.job_number, users: d.claim.users }))
      const adminItems = items.filter(d => !reviewerItems.includes(d))

      let reviewers = reviewerItems.length ? await peopleWithRole('reviewer') : []
      if (reviewerItems.length && !reviewers.length) reviewers = await peopleWithRole('admin')
      const admins = adminItems.length ? await peopleWithRole('admin') : []

      for (const person of reviewers) {
        const email = newSubmissionEmail(nameOf(person), employeeName, claimsFor(reviewerItems), 'reviewer')
        outgoing.push({ to: person.email, ...email, type, claimIds: idsFor(reviewerItems) })
      }
      for (const person of admins) {
        const email = newSubmissionEmail(nameOf(person), employeeName, claimsFor(adminItems), 'admin')
        outgoing.push({ to: person.email, ...email, type, claimIds: idsFor(adminItems) })
      }
    } else if (type === 'verified') {
      const department = employee?.department
      if (!department) continue
      const managers = (await peopleWithRole('manager')).filter(m => m.department === department)
      for (const person of managers) {
        const email = verifiedEmail(nameOf(person), employeeName, claimsFor(items))
        outgoing.push({ to: person.email, ...email, type, claimIds: idsFor(items) })
      }
    } else if (type === 'approved') {
      for (const person of await peopleWithRole('accounting')) {
        const email = approvedEmail(nameOf(person), employeeName, claimsFor(items))
        outgoing.push({ to: person.email, ...email, type, claimIds: idsFor(items) })
      }
    } else if (type === 'processed') {
      if (employee?.email) {
        const email = processedEmail(employeeName, claimsFor(items))
        outgoing.push({ to: employee.email, ...email, type, claimIds: idsFor(items) })
      }
    } else if (type === 'rejection') {
      if (employee?.email) {
        const email = rejectedEmail(employeeName, nameOf(caller), claimsFor(items))
        outgoing.push({ to: employee.email, ...email, type, claimIds: idsFor(items) })
      }
    }
  }

  // Send in batches of up to 100, which also keeps clear of Resend's per-second limit.
  const config = useRuntimeConfig()
  const resend = new Resend(config.resendApiKey)
  const from = `GibClaim <${config.emailFrom}>`
  const log: Array<Record<string, unknown>> = []
  let sentCount = 0
  let failedCount = 0

  for (let i = 0; i < outgoing.length; i += 100) {
    const chunk = outgoing.slice(i, i + 100)
    let ok = false
    try {
      const { error } = await resend.batch.send(chunk.map(m => ({ from, to: m.to, subject: m.subject, html: m.html })))
      ok = !error
      if (error) console.error('Resend batch failed:', error.message)
    } catch (err) {
      console.error('Resend batch failed:', err instanceof Error ? err.message : err)
    }
    const sentAt = new Date().toISOString()
    for (const m of chunk) {
      if (ok) sentCount++
      else failedCount++
      for (const claimId of m.claimIds) {
        log.push({
          claim_id: claimId,
          recipient_email: m.to,
          notification_type: m.type,
          sent_at: sentAt,
          sent_by: caller.id,
          status: ok ? 'sent' : 'failed',
        })
      }
    }
  }

  if (log.length) {
    const { error: logError } = await admin.from('email_notifications').insert(log)
    if (logError) console.error('Could not log email notifications:', logError.message)
  }

  return { success: failedCount === 0, sent: sentCount, failed: failedCount, skipped: claimIds.length - due.length }
})
