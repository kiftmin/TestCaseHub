UPDATE projects
SET is_signed_off = 0, sign_off_data = NULL
WHERE name = 'Gremlin World';
--> statement-breakpoint
DELETE FROM status_audit_log
WHERE entity_type = 'project'
  AND entity_id = (SELECT id FROM projects WHERE name = 'Gremlin World')
  AND to_status IN ('fully_signed_off', 'partially_signed_off');
