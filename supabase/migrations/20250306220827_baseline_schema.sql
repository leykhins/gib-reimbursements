-- Baseline schema for GibClaim.
--
-- Everything in this project's database was built through the Supabase
-- dashboard before migrations were kept in the repo, so there was no file that
-- described the schema. This is a pg_dump of the live schema taken on
-- 2026-09-15, backdated to the project's creation timestamp so it sorts ahead
-- of the tracked migrations and a fresh database can be built from scratch.
--
-- Because it is a snapshot of the current state, the migrations dated after it
-- describe changes this file already contains. Re-running them on a fresh
-- database is harmless: they replace functions and policies that are already
-- there, and their one data statement touches an empty table.
--
-- Regenerate with: npx supabase db dump --linked -f <this file>



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "app_auth";


ALTER SCHEMA "app_auth" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pgsodium";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "auth";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "app_auth"."is_admin"() RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = auth.uid() 
    AND role = 'admin'
  );
$$;


ALTER FUNCTION "app_auth"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_claim_stats"() RETURNS TABLE("total_users" bigint, "total_claims" bigint, "pending_claims" bigint, "verified_claims" bigint, "approved_claims" bigint, "completed_claims" bigint, "rejected_claims" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  with admin_queue as (
    select c.status
    from public.claims c
    left join public.users u on u.id = c.employee_id
    where btrim(coalesce(c.job_number, '')) = ''
       or u.role in ('manager', 'admin')
  )
  select
    (select count(*) from public.users),
    count(*),
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'verified'),
    count(*) filter (where status = 'approved'),
    count(*) filter (where status = 'completed'),
    count(*) filter (where status = 'rejected')
  from admin_queue;
$$;


ALTER FUNCTION "public"."admin_claim_stats"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_claim_stats"() IS 'Admin queue claim counts and the user total, aggregated server side so the dashboard is not limited to the first 1000 rows.';



CREATE OR REPLACE FUNCTION "public"."audit_log_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$BEGIN
    SET search_path = '';
    IF TG_OP = 'UPDATE' THEN
        INSERT INTO public.audit_logs (table_name, record_id, action, old_data, new_data, performed_by)
        VALUES (TG_TABLE_NAME, NEW.id, TG_OP, row_to_json(OLD), row_to_json(NEW), auth.uid());
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO public.audit_logs (table_name, record_id, action, new_data, performed_by)
        VALUES (TG_TABLE_NAME, NEW.id, TG_OP, row_to_json(NEW), auth.uid());
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.audit_logs (table_name, record_id, action, old_data, performed_by)
        VALUES (TG_TABLE_NAME, OLD.id, TG_OP, row_to_json(OLD), auth.uid());
    END IF;
    RETURN NULL;
END;$$;


ALTER FUNCTION "public"."audit_log_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.users (id, email, first_name, last_name, department, role)
  VALUES (
    NEW.id, 
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'department', 'Unassigned'),
    'employee'  -- Default role for new users
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  DELETE FROM public.users
  WHERE id = OLD.id;
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."handle_user_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE public.users
  SET 
    email = NEW.email,
    first_name = COALESCE(NEW.raw_user_meta_data->>'first_name', first_name),
    last_name = COALESCE(NEW.raw_user_meta_data->>'last_name', last_name),
    updated_at = NOW()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_user_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_accounting"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$BEGIN
    SET search_path TO public;
    RETURN EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'accounting'
    );
END;$$;


ALTER FUNCTION "public"."is_accounting"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$BEGIN
    SET search_path TO public;
    RETURN EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'admin'
    );
END;$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_manager"("user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  SELECT role = 'manager' FROM users WHERE id = user_id
$$;


ALTER FUNCTION "public"."is_manager"("user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_managers"() RETURNS boolean
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$SELECT EXISTS(
    SELECT 1 
    FROM public.users 
    WHERE public.users.role = 'manager' 
    AND public.users.id = (SELECT auth.uid())
  );$$;


ALTER FUNCTION "public"."is_managers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_reviewer"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    SET search_path TO public;
    RETURN EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'reviewer'
    );
END;
$$;


ALTER FUNCTION "public"."is_reviewer"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."claims" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "description" "text",
    "amount" numeric(10,2) NOT NULL,
    "gst_amount" numeric(10,2),
    "pst_amount" numeric(10,2),
    "category_id" "uuid" NOT NULL,
    "subcategory_mapping_id" "uuid" NOT NULL,
    "job_number" "text",
    "related_employee" "text",
    "client_name" "text",
    "company_name" "text",
    "license_number" "text",
    "is_travel" boolean DEFAULT false,
    "travel_distance" numeric(10,2),
    "travel_type" "text",
    "start_location" "text",
    "destination" "text",
    "receipt_url" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "admin_verified_by" "uuid",
    "admin_verified_at" timestamp with time zone,
    "manager_approved_by" "uuid",
    "manager_approved_at" timestamp with time zone,
    "accounting_processed_by" "uuid",
    "accounting_processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone,
    "date" timestamp with time zone,
    "rejection_reason" "text",
    "pdf_downloaded_at" timestamp with time zone,
    "receipt_url_2" "text",
    CONSTRAINT "claims_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'verified'::"text", 'approved'::"text", 'completed'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."claims" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_claim_status"("claim_id" "uuid", "new_status" "text", "rejection_reason" "text" DEFAULT NULL::"text") RETURNS "public"."claims"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
$$;


ALTER FUNCTION "public"."update_claim_status"("claim_id" "uuid", "new_status" "text", "rejection_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_claim_request"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$DECLARE
    category_requires_license BOOLEAN;
    mapping_requires_job BOOLEAN;
    mapping_requires_employee BOOLEAN;
    mapping_requires_client BOOLEAN;
BEGIN
    SET search_path TO public;
    -- Check if category requires license number
    SELECT requires_license_number 
    INTO category_requires_license
    FROM claim_categories 
    WHERE id = NEW.category_id;
    
    -- Check what the subcategory mapping requires
    SELECT requires_job_number, requires_employee_name, requires_client_info 
    INTO mapping_requires_job, mapping_requires_employee, mapping_requires_client
    FROM category_subcategory_mapping 
    WHERE id = NEW.subcategory_mapping_id;
    
    -- Validate license number
    IF category_requires_license AND (NEW.license_number IS NULL OR NEW.license_number = '') THEN
        RAISE EXCEPTION 'License number is required for this claim category';
    END IF;
    
    -- Validate job number
    IF mapping_requires_job AND (NEW.job_number IS NULL OR NEW.job_number = '') THEN
        RAISE EXCEPTION 'Job number is required for this subcategory';
    END IF;
    
    -- Validate employee name
    IF mapping_requires_employee AND (NEW.related_employee IS NULL OR NEW.related_employee = '') THEN
        RAISE EXCEPTION 'Employee name is required for this subcategory';
    END IF;
    
    -- Validate client info
    IF mapping_requires_client AND (NEW.client_name IS NULL OR NEW.client_name = '' OR NEW.company_name IS NULL OR NEW.company_name = '') THEN
        RAISE EXCEPTION 'Client name and company are required for this subcategory';
    END IF;
    
    -- GST/PST validation removed
    
    -- If travel, validate travel fields
    IF NEW.is_travel AND (NEW.travel_distance IS NULL OR NEW.travel_type IS NULL OR NEW.travel_type = '') THEN
        RAISE EXCEPTION 'Travel distance and type are required for travel expenses';
    END IF;
    
    RETURN NEW;
END;$$;


ALTER FUNCTION "public"."validate_claim_request"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "old_data" "jsonb",
    "new_data" "jsonb",
    "performed_by" "uuid",
    "performed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."category_subcategory_mapping" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category_id" "uuid",
    "subcategory_id" "uuid",
    "requires_job_number" boolean DEFAULT false,
    "requires_employee_name" boolean DEFAULT false,
    "requires_client_info" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."category_subcategory_mapping" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."claim_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category_name" "text" NOT NULL,
    "requires_license_number" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."claim_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."claim_notes" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "claim_id" "uuid",
    "note" "text" NOT NULL,
    "role" "text" NOT NULL,
    "user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    CONSTRAINT "claim_notes_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'manager'::"text", 'accounting'::"text", 'reviewer'::"text"])))
);


ALTER TABLE "public"."claim_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."claim_subcategories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subcategory_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."claim_subcategories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "first_name" "text" NOT NULL,
    "department" "text" DEFAULT 'Unassigned'::"text",
    "role" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "last_name" "text" NOT NULL,
    "mileage_rate" numeric(5,3) DEFAULT 0.71,
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['employee'::"text", 'admin'::"text", 'manager'::"text", 'accounting'::"text", 'reviewer'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON COLUMN "public"."users"."mileage_rate" IS 'Custom mileage rate per kilometer for this user (default: 0.61)';



CREATE OR REPLACE VIEW "public"."claim_workflow_status" WITH ("security_invoker"='on') AS
 SELECT "c"."id",
    "c"."status",
    "c"."created_at",
    "c"."date" AS "claim_date",
    "c"."amount",
    "emp"."id" AS "employee_id",
    (("emp"."first_name" || ' '::"text") || "emp"."last_name") AS "employee_name",
    "emp"."department" AS "employee_department",
    "cat"."category_name",
    "sub"."subcategory_name",
    "c"."admin_verified_by",
    (("admin"."first_name" || ' '::"text") || "admin"."last_name") AS "admin_name",
    "c"."admin_verified_at",
    "c"."manager_approved_by",
    (("mgr"."first_name" || ' '::"text") || "mgr"."last_name") AS "manager_name",
    "c"."manager_approved_at",
    "c"."accounting_processed_by",
    (("acc"."first_name" || ' '::"text") || "acc"."last_name") AS "accounting_name",
    "c"."accounting_processed_at",
    "c"."rejection_reason",
        CASE
            WHEN ("c"."admin_verified_at" IS NOT NULL) THEN EXTRACT(day FROM ("c"."admin_verified_at" - "c"."created_at"))
            WHEN ("c"."status" = 'pending'::"text") THEN EXTRACT(day FROM (CURRENT_TIMESTAMP - "c"."created_at"))
            ELSE NULL::numeric
        END AS "days_in_pending",
        CASE
            WHEN ("c"."manager_approved_at" IS NOT NULL) THEN EXTRACT(day FROM ("c"."manager_approved_at" - "c"."admin_verified_at"))
            WHEN ("c"."status" = 'verified'::"text") THEN EXTRACT(day FROM (CURRENT_TIMESTAMP - "c"."admin_verified_at"))
            ELSE NULL::numeric
        END AS "days_in_verification",
        CASE
            WHEN ("c"."accounting_processed_at" IS NOT NULL) THEN EXTRACT(day FROM ("c"."accounting_processed_at" - "c"."manager_approved_at"))
            WHEN ("c"."status" = 'approved'::"text") THEN EXTRACT(day FROM (CURRENT_TIMESTAMP - "c"."manager_approved_at"))
            ELSE NULL::numeric
        END AS "days_in_approval",
        CASE
            WHEN ("c"."status" = 'completed'::"text") THEN EXTRACT(day FROM ("c"."accounting_processed_at" - "c"."created_at"))
            WHEN ("c"."status" = 'rejected'::"text") THEN EXTRACT(day FROM ("c"."updated_at" - "c"."created_at"))
            ELSE EXTRACT(day FROM (CURRENT_TIMESTAMP - "c"."created_at"))
        END AS "total_processing_days"
   FROM ((((((("public"."claims" "c"
     JOIN "public"."users" "emp" ON (("c"."employee_id" = "emp"."id")))
     JOIN "public"."claim_categories" "cat" ON (("c"."category_id" = "cat"."id")))
     JOIN "public"."category_subcategory_mapping" "map" ON (("c"."subcategory_mapping_id" = "map"."id")))
     JOIN "public"."claim_subcategories" "sub" ON (("map"."subcategory_id" = "sub"."id")))
     LEFT JOIN "public"."users" "admin" ON (("c"."admin_verified_by" = "admin"."id")))
     LEFT JOIN "public"."users" "mgr" ON (("c"."manager_approved_by" = "mgr"."id")))
     LEFT JOIN "public"."users" "acc" ON (("c"."accounting_processed_by" = "acc"."id")))
  ORDER BY "c"."created_at" DESC;


ALTER TABLE "public"."claim_workflow_status" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."claims_pending_accounting_processing" WITH ("security_invoker"='on') AS
 SELECT "c"."id",
    "c"."employee_id",
    "c"."description",
    "c"."amount",
    "c"."gst_amount",
    "c"."pst_amount",
    "c"."category_id",
    "c"."subcategory_mapping_id",
    "c"."job_number",
    "c"."related_employee",
    "c"."client_name",
    "c"."company_name",
    "c"."license_number",
    "c"."is_travel",
    "c"."travel_distance",
    "c"."travel_type",
    "c"."start_location",
    "c"."destination",
    "c"."receipt_url",
    "c"."status",
    "c"."admin_verified_by",
    "c"."admin_verified_at",
    "c"."manager_approved_by",
    "c"."manager_approved_at",
    "c"."accounting_processed_by",
    "c"."accounting_processed_at",
    "c"."created_at",
    "c"."updated_at",
    "c"."date",
    "c"."rejection_reason",
    (("u"."first_name" || ' '::"text") || "u"."last_name") AS "employee_name",
    "u"."department" AS "employee_department",
    "cat"."category_name",
    "sub"."subcategory_name"
   FROM (((("public"."claims" "c"
     JOIN "public"."users" "u" ON (("c"."employee_id" = "u"."id")))
     JOIN "public"."claim_categories" "cat" ON (("c"."category_id" = "cat"."id")))
     JOIN "public"."category_subcategory_mapping" "map" ON (("c"."subcategory_mapping_id" = "map"."id")))
     JOIN "public"."claim_subcategories" "sub" ON (("map"."subcategory_id" = "sub"."id")))
  WHERE (("c"."status" = 'approved'::"text") AND ("c"."accounting_processed_by" IS NULL))
  ORDER BY "c"."created_at";


ALTER TABLE "public"."claims_pending_accounting_processing" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."claims_pending_admin_verification" WITH ("security_invoker"='on') AS
 SELECT "c"."id",
    "c"."employee_id",
    "c"."description",
    "c"."amount",
    "c"."gst_amount",
    "c"."pst_amount",
    "c"."category_id",
    "c"."subcategory_mapping_id",
    "c"."job_number",
    "c"."related_employee",
    "c"."client_name",
    "c"."company_name",
    "c"."license_number",
    "c"."is_travel",
    "c"."travel_distance",
    "c"."travel_type",
    "c"."start_location",
    "c"."destination",
    "c"."receipt_url",
    "c"."status",
    "c"."admin_verified_by",
    "c"."admin_verified_at",
    "c"."manager_approved_by",
    "c"."manager_approved_at",
    "c"."accounting_processed_by",
    "c"."accounting_processed_at",
    "c"."created_at",
    "c"."updated_at",
    "c"."date",
    "c"."rejection_reason",
    (("u"."first_name" || ' '::"text") || "u"."last_name") AS "employee_name",
    "u"."department" AS "employee_department",
    "cat"."category_name",
    "sub"."subcategory_name"
   FROM (((("public"."claims" "c"
     JOIN "public"."users" "u" ON (("c"."employee_id" = "u"."id")))
     JOIN "public"."claim_categories" "cat" ON (("c"."category_id" = "cat"."id")))
     JOIN "public"."category_subcategory_mapping" "map" ON (("c"."subcategory_mapping_id" = "map"."id")))
     JOIN "public"."claim_subcategories" "sub" ON (("map"."subcategory_id" = "sub"."id")))
  WHERE (("c"."status" = 'pending'::"text") AND ("c"."admin_verified_by" IS NULL))
  ORDER BY "c"."created_at";


ALTER TABLE "public"."claims_pending_admin_verification" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."department_managers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "department" "text" NOT NULL,
    "manager_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."department_managers" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."claims_pending_manager_approval" WITH ("security_invoker"='on') AS
 SELECT "c"."id",
    "c"."employee_id",
    "c"."description",
    "c"."amount",
    "c"."gst_amount",
    "c"."pst_amount",
    "c"."category_id",
    "c"."subcategory_mapping_id",
    "c"."job_number",
    "c"."related_employee",
    "c"."client_name",
    "c"."company_name",
    "c"."license_number",
    "c"."is_travel",
    "c"."travel_distance",
    "c"."travel_type",
    "c"."start_location",
    "c"."destination",
    "c"."receipt_url",
    "c"."status",
    "c"."admin_verified_by",
    "c"."admin_verified_at",
    "c"."manager_approved_by",
    "c"."manager_approved_at",
    "c"."accounting_processed_by",
    "c"."accounting_processed_at",
    "c"."created_at",
    "c"."updated_at",
    "c"."date",
    "c"."rejection_reason",
    (("u"."first_name" || ' '::"text") || "u"."last_name") AS "employee_name",
    "u"."department" AS "employee_department",
    "cat"."category_name",
    "sub"."subcategory_name"
   FROM (((("public"."claims" "c"
     JOIN "public"."users" "u" ON (("c"."employee_id" = "u"."id")))
     JOIN "public"."claim_categories" "cat" ON (("c"."category_id" = "cat"."id")))
     JOIN "public"."category_subcategory_mapping" "map" ON (("c"."subcategory_mapping_id" = "map"."id")))
     JOIN "public"."claim_subcategories" "sub" ON (("map"."subcategory_id" = "sub"."id")))
  WHERE (("c"."status" = 'verified'::"text") AND ("c"."manager_approved_by" IS NULL) AND ("u"."department" IN ( SELECT "department_managers"."department"
           FROM "public"."department_managers"
          WHERE ("department_managers"."manager_id" = "auth"."uid"()))))
  ORDER BY "c"."created_at";


ALTER TABLE "public"."claims_pending_manager_approval" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_notifications" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "claim_id" "uuid",
    "recipient_email" "text" NOT NULL,
    "notification_type" "text" NOT NULL,
    "sent_at" timestamp with time zone NOT NULL,
    "sent_by" "uuid",
    "status" "text" NOT NULL
);


ALTER TABLE "public"."email_notifications" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."category_subcategory_mapping"
    ADD CONSTRAINT "category_subcategory_mapping_category_id_subcategory_id_key" UNIQUE ("category_id", "subcategory_id");



ALTER TABLE ONLY "public"."category_subcategory_mapping"
    ADD CONSTRAINT "category_subcategory_mapping_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."claim_categories"
    ADD CONSTRAINT "claim_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."claim_notes"
    ADD CONSTRAINT "claim_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."claim_subcategories"
    ADD CONSTRAINT "claim_subcategories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."department_managers"
    ADD CONSTRAINT "department_managers_department_manager_id_key" UNIQUE ("department", "manager_id");



ALTER TABLE ONLY "public"."department_managers"
    ADD CONSTRAINT "department_managers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_notifications"
    ADD CONSTRAINT "email_notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "audit_logs_performed_by_idx" ON "public"."audit_logs" USING "btree" ("performed_by");



CREATE INDEX "category_subcategory_mapping_subcategory_id_idx" ON "public"."category_subcategory_mapping" USING "btree" ("subcategory_id");



CREATE INDEX "claim_notes_claim_id_user_id_idx" ON "public"."claim_notes" USING "btree" ("claim_id", "user_id");



CREATE INDEX "claims_accounting_processed_by_admin_verified_by_manager_ap_idx" ON "public"."claims" USING "btree" ("accounting_processed_by", "admin_verified_by", "manager_approved_by");



CREATE INDEX "department_managers_manager_id_idx" ON "public"."department_managers" USING "btree" ("manager_id");



CREATE INDEX "email_notifications_claim_id_sent_by_idx" ON "public"."email_notifications" USING "btree" ("claim_id", "sent_by");



CREATE INDEX "idx_claim_notes_user_id" ON "public"."claim_notes" USING "btree" ("user_id");



CREATE INDEX "idx_claims_admin_verified_by" ON "public"."claims" USING "btree" ("admin_verified_by");



CREATE INDEX "idx_claims_category" ON "public"."claims" USING "btree" ("category_id");



CREATE INDEX "idx_claims_employee" ON "public"."claims" USING "btree" ("employee_id");



CREATE INDEX "idx_claims_manager_approved_by" ON "public"."claims" USING "btree" ("manager_approved_by");



CREATE INDEX "idx_claims_status" ON "public"."claims" USING "btree" ("status");



CREATE INDEX "idx_claims_subcategory_mapping" ON "public"."claims" USING "btree" ("subcategory_mapping_id");



CREATE INDEX "idx_email_notifications_sent_by" ON "public"."email_notifications" USING "btree" ("sent_by");



CREATE INDEX "users_role_idx" ON "public"."users" USING "btree" ("role");



CREATE OR REPLACE TRIGGER "check_claim_requirements" BEFORE INSERT OR UPDATE ON "public"."claims" FOR EACH ROW EXECUTE FUNCTION "public"."validate_claim_request"();



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."category_subcategory_mapping"
    ADD CONSTRAINT "category_subcategory_mapping_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."claim_categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."category_subcategory_mapping"
    ADD CONSTRAINT "category_subcategory_mapping_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "public"."claim_subcategories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."claim_notes"
    ADD CONSTRAINT "claim_notes_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."claim_notes"
    ADD CONSTRAINT "claim_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."claim_notes"
    ADD CONSTRAINT "claim_notes_user_id_fkey1" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_accounting_processed_by_fkey" FOREIGN KEY ("accounting_processed_by") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_admin_verified_by_fkey" FOREIGN KEY ("admin_verified_by") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."claim_categories"("id");



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_manager_approved_by_fkey" FOREIGN KEY ("manager_approved_by") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."claims"
    ADD CONSTRAINT "claims_subcategory_mapping_id_fkey" FOREIGN KEY ("subcategory_mapping_id") REFERENCES "public"."category_subcategory_mapping"("id");



ALTER TABLE ONLY "public"."department_managers"
    ADD CONSTRAINT "department_managers_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."email_notifications"
    ADD CONSTRAINT "email_notifications_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_notifications"
    ADD CONSTRAINT "email_notifications_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id");



CREATE POLICY "Accountant, Managers, and Reviewers can view all users" ON "public"."users" FOR SELECT USING (("public"."is_accounting"() OR "public"."is_managers"() OR "public"."is_reviewer"()));



CREATE POLICY "Accounting can process approved claims" ON "public"."claims" FOR UPDATE TO "authenticated" USING ((("public"."is_accounting"() OR "public"."is_admin"()) AND ("status" = 'approved'::"text"))) WITH CHECK (("status" = 'completed'::"text"));



CREATE POLICY "Accounting can view all approved claims" ON "public"."claims" FOR SELECT TO "authenticated" USING ("public"."is_accounting"());



CREATE POLICY "Admins and accounting can view audit logs" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_accounting"()));



CREATE POLICY "Admins can delete users" ON "public"."users" FOR DELETE USING ("app_auth"."is_admin"());



CREATE POLICY "Admins can insert users" ON "public"."users" FOR INSERT WITH CHECK ("app_auth"."is_admin"());



CREATE POLICY "Admins can manage department managers" ON "public"."department_managers" USING ("public"."is_admin"());



CREATE POLICY "Admins can reject claims" ON "public"."claims" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() AND ("status" = 'pending'::"text"))) WITH CHECK (("status" = 'rejected'::"text"));



CREATE POLICY "Admins can verify claims" ON "public"."claims" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() AND ("status" = 'pending'::"text"))) WITH CHECK (("status" = 'verified'::"text"));



CREATE POLICY "Admins can view all claims" ON "public"."claims" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Allow service role to insert users" ON "public"."users" FOR INSERT TO "supabase_admin", "supabase_auth_admin", "authenticator", "dashboard_user", "authenticated", "service_role" WITH CHECK (true);



CREATE POLICY "Employees can create claims" ON "public"."claims" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "employee_id"));



CREATE POLICY "Employees can delete their rejected claims" ON "public"."claims" FOR DELETE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "employee_id") AND ("status" = 'rejected'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = 'employee'::"text"))))));



CREATE POLICY "Employees can update their pending claims" ON "public"."claims" FOR UPDATE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "employee_id") AND ("status" = 'pending'::"text")));



CREATE POLICY "Employees can update their rejected claims" ON "public"."claims" FOR UPDATE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "employee_id") AND ("status" = 'rejected'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = 'employee'::"text")))))) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "employee_id") AND ("status" = 'rejected'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = 'employee'::"text"))))));



CREATE POLICY "Employees can view their claims" ON "public"."claims" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "employee_id"));



CREATE POLICY "Enable read access for all users" ON "public"."category_subcategory_mapping" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Everyone can view department managers" ON "public"."department_managers" FOR SELECT USING (true);



CREATE POLICY "Managers can view requests for their departments" ON "public"."claims" FOR SELECT TO "authenticated" USING ("public"."is_manager"("auth"."uid"()));



CREATE POLICY "Notification policy" ON "public"."email_notifications" TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'admin'::"text")))) OR ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'manager'::"text")))) AND (EXISTS ( SELECT 1
   FROM (("public"."claims"
     JOIN "public"."users" "employee_user" ON (("claims"."employee_id" = "employee_user"."id")))
     JOIN "public"."users" "manager_user" ON (("employee_user"."department" = "manager_user"."department")))
  WHERE (("claims"."id" = "email_notifications"."claim_id") AND ("manager_user"."id" = "auth"."uid"()) AND ("manager_user"."role" = 'manager'::"text"))))) OR ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."role" = 'accounting'::"text")))) AND (EXISTS ( SELECT 1
   FROM "public"."claims"
  WHERE (("claims"."id" = "email_notifications"."claim_id") AND ("claims"."status" = ANY (ARRAY['approved'::"text", 'processed'::"text"])))))) OR ("recipient_email" = ( SELECT "users"."email"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR ("sent_by" = "auth"."uid"())));



CREATE POLICY "Only admin, manager, accounting, and reviewer can insert notes" ON "public"."claim_notes" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'manager'::"text", 'accounting'::"text", 'reviewer'::"text"]))))));



CREATE POLICY "Only note creator can update their notes" ON "public"."claim_notes" FOR UPDATE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Reviewers can view all claims" ON "public"."claims" FOR SELECT USING ("public"."is_reviewer"());



CREATE POLICY "Role-based claim status updates" ON "public"."claims" FOR UPDATE USING ((( SELECT "users"."role"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = ANY (ARRAY['manager'::"text", 'admin'::"text", 'accounting'::"text", 'reviewer'::"text"]))) WITH CHECK ((((( SELECT "users"."role"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = 'manager'::"text") AND ("status" = ANY (ARRAY['approved'::"text", 'rejected'::"text"]))) OR ((( SELECT "users"."role"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = 'admin'::"text") AND ("status" = ANY (ARRAY['verified'::"text", 'approved'::"text", 'rejected'::"text", 'completed'::"text"]))) OR ((( SELECT "users"."role"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = 'reviewer'::"text") AND ("status" = ANY (ARRAY['verified'::"text", 'approved'::"text", 'rejected'::"text"]))) OR ((( SELECT "users"."role"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"())) = 'accounting'::"text") AND ("status" = ANY (ARRAY['completed'::"text", 'rejected'::"text"])))));



CREATE POLICY "Supabase admin can insert and update" ON "public"."users" USING ((CURRENT_USER = 'supabase_auth_admin'::"name")) WITH CHECK ((CURRENT_USER = 'supabase_auth_admin'::"name"));



CREATE POLICY "Users and admins profile access" ON "public"."users" FOR SELECT USING ((("auth"."uid"() = "id") OR "app_auth"."is_admin"()));



CREATE POLICY "Users and admins profile update" ON "public"."users" FOR UPDATE USING ((("auth"."uid"() = "id") OR "app_auth"."is_admin"())) WITH CHECK ((("auth"."uid"() = "id") OR "app_auth"."is_admin"()));



CREATE POLICY "Users can view notes for claims they have access to" ON "public"."claim_notes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."claims"
  WHERE (("claims"."id" = "claim_notes"."claim_id") AND (("claims"."employee_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."users"
          WHERE (("users"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("users"."role" = ANY (ARRAY['admin'::"text", 'manager'::"text", 'accounting'::"text", 'reviewer'::"text"]))))))))));



CREATE POLICY "all_can_view_categories" ON "public"."claim_categories" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "all_can_view_categories" ON "public"."claim_subcategories" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."category_subcategory_mapping" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."claim_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."claim_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."claim_subcategories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."department_managers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "app_auth"."is_admin"() TO "authenticated";

















































































































































































GRANT ALL ON FUNCTION "public"."admin_claim_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_claim_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_claim_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."audit_log_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."audit_log_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."audit_log_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_user_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_user_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_user_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_user_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_user_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_user_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_accounting"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_accounting"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_accounting"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_manager"("user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_manager"("user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_manager"("user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_managers"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_managers"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_managers"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_reviewer"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_reviewer"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_reviewer"() TO "service_role";



GRANT ALL ON TABLE "public"."claims" TO "anon";
GRANT ALL ON TABLE "public"."claims" TO "authenticated";
GRANT ALL ON TABLE "public"."claims" TO "service_role";



GRANT ALL ON FUNCTION "public"."update_claim_status"("claim_id" "uuid", "new_status" "text", "rejection_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_claim_status"("claim_id" "uuid", "new_status" "text", "rejection_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_claim_status"("claim_id" "uuid", "new_status" "text", "rejection_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_claim_request"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_claim_request"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_claim_request"() TO "service_role";



























GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."category_subcategory_mapping" TO "anon";
GRANT ALL ON TABLE "public"."category_subcategory_mapping" TO "authenticated";
GRANT ALL ON TABLE "public"."category_subcategory_mapping" TO "service_role";



GRANT ALL ON TABLE "public"."claim_categories" TO "anon";
GRANT ALL ON TABLE "public"."claim_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."claim_categories" TO "service_role";



GRANT ALL ON TABLE "public"."claim_notes" TO "anon";
GRANT ALL ON TABLE "public"."claim_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."claim_notes" TO "service_role";



GRANT ALL ON TABLE "public"."claim_subcategories" TO "anon";
GRANT ALL ON TABLE "public"."claim_subcategories" TO "authenticated";
GRANT ALL ON TABLE "public"."claim_subcategories" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."claim_workflow_status" TO "anon";
GRANT ALL ON TABLE "public"."claim_workflow_status" TO "authenticated";
GRANT ALL ON TABLE "public"."claim_workflow_status" TO "service_role";



GRANT ALL ON TABLE "public"."claims_pending_accounting_processing" TO "anon";
GRANT ALL ON TABLE "public"."claims_pending_accounting_processing" TO "authenticated";
GRANT ALL ON TABLE "public"."claims_pending_accounting_processing" TO "service_role";



GRANT ALL ON TABLE "public"."claims_pending_admin_verification" TO "anon";
GRANT ALL ON TABLE "public"."claims_pending_admin_verification" TO "authenticated";
GRANT ALL ON TABLE "public"."claims_pending_admin_verification" TO "service_role";



GRANT ALL ON TABLE "public"."department_managers" TO "anon";
GRANT ALL ON TABLE "public"."department_managers" TO "authenticated";
GRANT ALL ON TABLE "public"."department_managers" TO "service_role";



GRANT ALL ON TABLE "public"."claims_pending_manager_approval" TO "anon";
GRANT ALL ON TABLE "public"."claims_pending_manager_approval" TO "authenticated";
GRANT ALL ON TABLE "public"."claims_pending_manager_approval" TO "service_role";



GRANT ALL ON TABLE "public"."email_notifications" TO "anon";
GRANT ALL ON TABLE "public"."email_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."email_notifications" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";






























