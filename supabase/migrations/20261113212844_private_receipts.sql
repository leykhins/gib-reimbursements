-- The receipts bucket is private, but two leftover policies let anyone (even
-- signed out) read every receipt, and any signed-in user could upload
-- anywhere in the bucket. Nobody could delete, so removing a receipt before
-- submitting, or after deleting a rejected claim, silently left the file.
--
-- After this:
--   read    your own folder, or a file attached to a claim you can see
--           (claims RLS decides that, so staff see what their role allows)
--   upload  your own folder only ({user id}/...), which is where both apps
--           already put files
--   delete  files in your own folder that no claim uses

drop policy if exists "Give public access to receipts" on storage.objects;
drop policy if exists "Give users authenticated access to folder 1lnm9mj_0" on storage.objects;
drop policy if exists "Authenticated Upload Policy" on storage.objects;

-- The read and delete checks look claims up by receipt path.
create index if not exists claims_receipt_url_idx on public.claims (receipt_url);
create index if not exists claims_receipt_url_2_idx on public.claims (receipt_url_2);

create policy "Receipts: read own files or files on visible claims"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (select 1 from public.claims c where c.receipt_url = objects.name)
      or exists (select 1 from public.claims c where c.receipt_url_2 = objects.name)
    )
  );

create policy "Receipts: upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Receipts: delete own unused files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (select 1 from public.claims c where c.receipt_url = objects.name)
    and not exists (select 1 from public.claims c where c.receipt_url_2 = objects.name)
  );
