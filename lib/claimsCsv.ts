import { claimantName } from '~/lib/queueStats'

/**
 * Claims as a CSV for a spreadsheet, as loaded on the accounting expenses
 * page (claims with profiles, category and subcategory_mapping joined).
 * Ported from gibclaim's CSV export.
 */

// A leading = + @ or - would run as a formula in Excel, so it is quoted out.
const cell = (value: unknown) => `"${String(value ?? '').replace(/^[=+@\-]/, "'$&").replaceAll('"', '""')}"`
const money = (value: unknown) => (value === null || value === undefined || value === '' ? '' : Number(value).toFixed(2))

const HEADER = ['Employee', 'Department', 'Date', 'Description', 'Category', 'Subcategory', 'Job number', 'Company vehicle licence', 'Distance km', 'Status', 'GST', 'PST', 'Amount CAD', 'In a PDF']

export function claimsCsv(claims: any[]): string {
  const rows = claims.map(c => [
    claimantName(c.profiles),
    c.profiles?.department || '',
    String(c.date || '').slice(0, 10),
    c.description || '',
    c.category?.category_name || '',
    c.subcategory_mapping?.subcategory?.subcategory_name || '',
    c.job_number || '',
    c.license_number || '',
    c.travel_distance ?? '',
    c.status || '',
    money(c.gst_amount),
    money(c.pst_amount),
    money(c.amount),
    c.pdf_downloaded_at ? String(c.pdf_downloaded_at).slice(0, 10) : '',
  ])
  return [HEADER, ...rows].map(row => row.map(cell).join(',')).join('\r\n')
}

/** Downloads the claims as a CSV. The byte order mark makes Excel read it as UTF-8. */
export function downloadClaimsCsv(claims: any[], filename: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + claimsCsv(claims)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export const fileSlug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
