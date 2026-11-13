-- Add reviewer role and split first-line review between admin (overhead + leadership) and reviewer (job-number employee claims).
-- Manager/admin submitted claims skip the manager approval step after first-line review.

ALTER TABLE public.users DROP CONSTRAINT users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role = ANY (ARRAY['employee'::text, 'admin'::text, 'manager'::text, 'accounting'::text, 'reviewer'::text]));

ALTER TABLE public.claim_notes DROP CONSTRAINT claim_notes_role_check;
ALTER TABLE public.claim_notes
  ADD CONSTRAINT claim_notes_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'manager'::text, 'accounting'::text, 'reviewer'::text]));

CREATE OR REPLACE FUNCTION public.is_reviewer()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $fn$
BEGIN
    SET search_path TO public;
    RETURN EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'reviewer'
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.update_claim_status(claim_id uuid, new_status text, rejection_reason text DEFAULT NULL::text)
 RETURNS claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_role TEXT;
  v_claim public.claims%ROWTYPE;
  v_submitter_role TEXT;
  v_has_job BOOLEAN;
  v_action TEXT;
  v_old_status TEXT;
  v_final_status TEXT;
  v_skip_manager BOOLEAN;
BEGIN
  SELECT role INTO v_user_role FROM public.users WHERE id = auth.uid();

  IF v_user_role NOT IN ('manager', 'admin', 'accounting', 'reviewer') THEN
    RAISE EXCEPTION 'You do not have permission to update claim status';
  END IF;

  SELECT c.status, u.role,
         (c.job_number IS NOT NULL AND length(btrim(c.job_number)) > 0)
  INTO v_old_status, v_submitter_role, v_has_job
  FROM public.claims c
  JOIN public.users u ON u.id = c.employee_id
  WHERE c.id = claim_id;

  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Claim not found';
  END IF;

  v_skip_manager := v_submitter_role IN ('manager', 'admin');
  v_final_status := new_status;

  IF new_status = 'verified' AND v_skip_manager THEN
    v_final_status := 'approved';
  END IF;

  CASE v_user_role
    WHEN 'manager' THEN
      IF new_status NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'Managers can only set claims to "approved" or "rejected"';
      END IF;
      IF v_skip_manager THEN
        RAISE EXCEPTION 'Manager and admin submitted claims do not require manager approval';
      END IF;
    WHEN 'admin' THEN
      IF new_status NOT IN ('verified', 'rejected', 'approved', 'completed') THEN
        RAISE EXCEPTION 'Admins can only set claims to "verified" or "rejected"';
      END IF;
      IF new_status IN ('verified', 'rejected') AND v_old_status = 'pending' THEN
        IF v_has_job AND NOT v_skip_manager THEN
          RAISE EXCEPTION 'Claims with job numbers must be reviewed by a reviewer';
        END IF;
      END IF;
    WHEN 'reviewer' THEN
      IF new_status NOT IN ('verified', 'rejected') THEN
        RAISE EXCEPTION 'Reviewers can only set claims to "verified" or "rejected"';
      END IF;
      IF NOT v_has_job OR v_skip_manager THEN
        RAISE EXCEPTION 'Reviewers can only review employee claims that have a job number';
      END IF;
    WHEN 'accounting' THEN
      IF new_status NOT IN ('completed', 'rejected') THEN
        RAISE EXCEPTION 'Accounting can only set claims to "completed" or "rejected"';
      END IF;
  END CASE;

  IF v_final_status = 'rejected' AND update_claim_status.rejection_reason IS NULL THEN
    RAISE EXCEPTION 'A rejection reason must be provided when rejecting a claim';
  END IF;

  UPDATE public.claims
  SET
    status = v_final_status,
    updated_at = CURRENT_TIMESTAMP,
    admin_verified_by = CASE
      WHEN v_user_role IN ('admin', 'reviewer') AND new_status = 'verified' THEN auth.uid()
      ELSE admin_verified_by
    END,
    admin_verified_at = CASE
      WHEN v_user_role IN ('admin', 'reviewer') AND new_status = 'verified' THEN CURRENT_TIMESTAMP
      ELSE admin_verified_at
    END,
    manager_approved_by = CASE
      WHEN (v_user_role IN ('manager', 'admin') AND new_status = 'approved')
        OR (v_user_role IN ('admin', 'reviewer') AND new_status = 'verified' AND v_skip_manager)
      THEN auth.uid()
      ELSE manager_approved_by
    END,
    manager_approved_at = CASE
      WHEN (v_user_role IN ('manager', 'admin') AND new_status = 'approved')
        OR (v_user_role IN ('admin', 'reviewer') AND new_status = 'verified' AND v_skip_manager)
      THEN CURRENT_TIMESTAMP
      ELSE manager_approved_at
    END,
    accounting_processed_by = CASE
      WHEN v_user_role IN ('accounting', 'admin') AND new_status = 'completed' THEN auth.uid()
      ELSE accounting_processed_by
    END,
    accounting_processed_at = CASE
      WHEN v_user_role IN ('accounting', 'admin') AND new_status = 'completed' THEN CURRENT_TIMESTAMP
      ELSE accounting_processed_at
    END,
    rejection_reason = CASE
      WHEN v_final_status = 'rejected' THEN update_claim_status.rejection_reason
      ELSE NULL
    END
  WHERE id = claim_id
  RETURNING * INTO v_claim;

  v_action := v_user_role || '_' || CASE
    WHEN v_final_status = 'verified' THEN 'verified'
    WHEN v_final_status = 'approved' THEN 'approved'
    WHEN v_final_status = 'completed' THEN 'completed'
    WHEN v_final_status = 'rejected' THEN 'rejected'
    ELSE 'updated'
  END;

  INSERT INTO public.audit_logs (
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    performed_by
  )
  VALUES (
    'claims',
    claim_id,
    v_action,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object(
      'status', v_final_status,
      'rejection_reason', update_claim_status.rejection_reason
    ),
    auth.uid()
  );

  RETURN v_claim;
END;
$function$;

DROP POLICY IF EXISTS "Reviewers can view all claims" ON public.claims;
CREATE POLICY "Reviewers can view all claims"
  ON public.claims
  FOR SELECT
  USING (is_reviewer());

DROP POLICY IF EXISTS "Role-based claim status updates" ON public.claims;
CREATE POLICY "Role-based claim status updates"
  ON public.claims
  FOR UPDATE
  USING (
    (SELECT users.role FROM users WHERE users.id = auth.uid()) = ANY (ARRAY['manager'::text, 'admin'::text, 'accounting'::text, 'reviewer'::text])
  )
  WITH CHECK (
    (((SELECT users.role FROM users WHERE users.id = auth.uid()) = 'manager'::text) AND (status = ANY (ARRAY['approved'::text, 'rejected'::text])))
    OR (((SELECT users.role FROM users WHERE users.id = auth.uid()) = 'admin'::text) AND (status = ANY (ARRAY['verified'::text, 'approved'::text, 'rejected'::text, 'completed'::text])))
    OR (((SELECT users.role FROM users WHERE users.id = auth.uid()) = 'reviewer'::text) AND (status = ANY (ARRAY['verified'::text, 'approved'::text, 'rejected'::text])))
    OR (((SELECT users.role FROM users WHERE users.id = auth.uid()) = 'accounting'::text) AND (status = ANY (ARRAY['completed'::text, 'rejected'::text])))
  );

DROP POLICY IF EXISTS "Only admin, manager, and accounting can insert notes" ON public.claim_notes;
CREATE POLICY "Only admin, manager, accounting, and reviewer can insert notes"
  ON public.claim_notes
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = ANY (ARRAY['admin'::text, 'manager'::text, 'accounting'::text, 'reviewer'::text])
    )
  );

DROP POLICY IF EXISTS "Users can view notes for claims they have access to" ON public.claim_notes;
CREATE POLICY "Users can view notes for claims they have access to"
  ON public.claim_notes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM claims
      WHERE claims.id = claim_notes.claim_id
        AND (
          claims.employee_id = (SELECT auth.uid())
          OR EXISTS (
            SELECT 1 FROM users
            WHERE users.id = (SELECT auth.uid())
              AND users.role = ANY (ARRAY['admin'::text, 'manager'::text, 'accounting'::text, 'reviewer'::text])
          )
        )
    )
  );

DROP POLICY IF EXISTS "Accountant  & Managers can view all users" ON public.users;
CREATE POLICY "Accountant, Managers, and Reviewers can view all users"
  ON public.users
  FOR SELECT
  USING (is_accounting() OR is_managers() OR is_reviewer());

UPDATE public.claims c
SET
  status = 'approved',
  manager_approved_at = COALESCE(c.manager_approved_at, c.admin_verified_at, now()),
  manager_approved_by = COALESCE(c.manager_approved_by, c.admin_verified_by),
  updated_at = now()
FROM public.users u
WHERE c.employee_id = u.id
  AND c.status = 'verified'
  AND u.role IN ('manager', 'admin');
