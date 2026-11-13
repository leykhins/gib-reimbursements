-- Receipts must open in the browser for reviewers and embed in accounting's PDF.
-- Outlook .msg files arrive as application/octet-stream and do neither, so the
-- bucket now accepts only PDF, JPEG and PNG. HEIC is converted to JPEG in the
-- browser before upload, and stays listed in case a conversion is skipped.
-- The same list is checked in the form by lib/receiptFiles.ts.
--
-- Existing objects are not touched; this only applies to new uploads.

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif'
]
where id = 'receipts';
