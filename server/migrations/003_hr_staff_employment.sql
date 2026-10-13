-- HR can grant operational roles only after a staff member has an active
-- employment record. HR and owner privileges are granted by an owner.
ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_name_check;
ALTER TABLE public.roles
  ADD CONSTRAINT roles_name_check
  CHECK (name IN ('customer', 'kitchen', 'manager', 'rider', 'hr', 'owner'));

INSERT INTO public.roles (name) VALUES ('hr') ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.staff_employment (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  employment_status TEXT NOT NULL DEFAULT 'employed'
    CHECK (employment_status IN ('employed', 'inactive')),
  employee_number TEXT UNIQUE,
  employed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES public.users(id),
  updated_by UUID NOT NULL REFERENCES public.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (employment_status = 'employed' AND ended_at IS NULL)
    OR (employment_status = 'inactive' AND ended_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS staff_employment_status_updated_idx
  ON public.staff_employment(employment_status, updated_at DESC);

CREATE OR REPLACE FUNCTION public.require_employment_for_staff_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  role_name TEXT;
BEGIN
  SELECT name INTO role_name FROM public.roles WHERE id = NEW.role_id;
  IF role_name IN ('kitchen', 'manager', 'rider', 'hr')
     AND NOT EXISTS (
       SELECT 1 FROM public.staff_employment
       WHERE user_id = NEW.user_id AND employment_status = 'employed'
     ) THEN
    RAISE EXCEPTION 'Staff roles require an active employment record';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_require_employment ON public.user_roles;
CREATE TRIGGER user_roles_require_employment
BEFORE INSERT OR UPDATE OF user_id, role_id ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.require_employment_for_staff_role();

CREATE OR REPLACE FUNCTION public.revoke_staff_roles_on_offboarding()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.employment_status = 'inactive' AND OLD.employment_status <> 'inactive' THEN
    DELETE FROM public.user_roles AS user_role
    USING public.roles AS role
    WHERE user_role.role_id = role.id
      AND user_role.user_id = NEW.user_id
      AND role.name IN ('kitchen', 'manager', 'rider', 'hr');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_employment_revoke_roles ON public.staff_employment;
CREATE TRIGGER staff_employment_revoke_roles
AFTER UPDATE OF employment_status ON public.staff_employment
FOR EACH ROW EXECUTE FUNCTION public.revoke_staff_roles_on_offboarding();

ALTER TABLE public.staff_employment ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staff_employment FROM anon, authenticated;
