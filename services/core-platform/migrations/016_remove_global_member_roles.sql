-- Migration 016: Remove global member roles and drop NOT NULL defaults on user role/scope

-- 1. Allow users to exist without default role/scope until approved
ALTER TABLE users ALTER COLUMN default_role DROP NOT NULL;
ALTER TABLE users ALTER COLUMN default_scope_type DROP NOT NULL;
ALTER TABLE users ALTER COLUMN default_scope_id DROP NOT NULL;
ALTER TABLE users ALTER COLUMN default_role DROP DEFAULT;
ALTER TABLE users ALTER COLUMN default_scope_type DROP DEFAULT;
ALTER TABLE users ALTER COLUMN default_scope_id DROP DEFAULT;

-- 2. Remove all member roles with global scope from auth_user_roles
DELETE FROM auth_user_roles 
WHERE role = 'member' AND scope_type = 'global';

-- 3. For any users whose default_role was 'member' and default_scope_type was 'global',
-- update them to their highest active role from auth_user_roles.
UPDATE users u
SET 
  default_role = highest.role,
  default_scope_type = highest.scope_type,
  default_scope_id = highest.scope_id
FROM (
  SELECT DISTINCT ON (user_id) user_id, role, scope_type, scope_id
  FROM auth_user_roles
  WHERE is_active = TRUE
  ORDER BY user_id, 
    CASE role
      WHEN 'admin' THEN 1
      WHEN 'officer' THEN 2
      WHEN 'lead' THEN 3
      WHEN 'publisher' THEN 4
      WHEN 'event_organizer' THEN 4
      WHEN 'event_scanner' THEN 5
      WHEN 'scanner' THEN 5
      WHEN 'member' THEN 6
      WHEN 'applicant' THEN 7
      ELSE 99
    END ASC
) highest
WHERE u.id = highest.user_id 
  AND u.default_role = 'member' 
  AND u.default_scope_type = 'global';

-- 4. For users who had ('member', 'global') and no other active roles in auth_user_roles:
UPDATE users
SET default_role = NULL, default_scope_type = NULL, default_scope_id = NULL
WHERE default_role = 'member' AND default_scope_type = 'global';
