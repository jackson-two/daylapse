-- Freeze the obsolete store during import and after activation, including old Workers.
CREATE TRIGGER legacy_state_update_locked BEFORE UPDATE ON household_state
WHEN EXISTS (SELECT 1 FROM installation_settings WHERE storage_mode = 'rows' OR import_state <> 'empty')
BEGIN SELECT RAISE(ABORT, 'reload_required_row_storage'); END;
--> statement-breakpoint
CREATE TRIGGER legacy_state_delete_locked BEFORE DELETE ON household_state
WHEN EXISTS (SELECT 1 FROM installation_settings WHERE storage_mode = 'rows' OR import_state <> 'empty')
BEGIN SELECT RAISE(ABORT, 'reload_required_row_storage'); END;
--> statement-breakpoint
CREATE TRIGGER legacy_state_insert_locked BEFORE INSERT ON household_state
WHEN EXISTS (SELECT 1 FROM installation_settings WHERE storage_mode = 'rows' OR import_state <> 'empty')
BEGIN SELECT RAISE(ABORT, 'reload_required_row_storage'); END;
--> statement-breakpoint
DROP TRIGGER row_mutation_precondition;
--> statement-breakpoint
CREATE TRIGGER row_mutation_precondition BEFORE INSERT ON mutations
WHEN NOT EXISTS (SELECT 1 FROM mutations WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'row_storage_disabled') WHERE NOT EXISTS (SELECT 1 FROM installation_settings WHERE id = 1 AND storage_mode = 'rows' AND import_state = 'ready');
  SELECT RAISE(ABORT, 'household_sequence_conflict') WHERE NEW.operation = 'household.restore' AND NEW.expected_version <> (SELECT COALESCE(MAX(sequence),0) FROM changes);
  SELECT RAISE(ABORT, 'event_version_conflict') WHERE NEW.operation <> 'household.restore' AND NEW.expected_version = 0 AND EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id);
  SELECT RAISE(ABORT, 'event_version_conflict') WHERE NEW.operation <> 'household.restore' AND NEW.expected_version > 0 AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id AND version = NEW.expected_version);
  SELECT RAISE(ABORT, 'event_version_conflict') WHERE NEW.expected_version < 0;
END;
--> statement-breakpoint
CREATE TRIGGER row_import_source_guard BEFORE INSERT ON migration_runs
WHEN EXISTS (SELECT 1 FROM household_state WHERE id=1 AND revision <> NEW.source_revision)
BEGIN SELECT RAISE(ABORT, 'legacy_source_changed'); END;
