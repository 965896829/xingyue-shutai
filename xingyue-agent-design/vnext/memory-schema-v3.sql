PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS v3_memory_branch (
  id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, parent_branch_id TEXT,
  fork_revision_id TEXT, head_revision_id TEXT, overlay_manifest_hash TEXT NOT NULL,
  UNIQUE(project_id, id), CHECK(parent_branch_id IS NULL OR parent_branch_id <> id),
  CHECK((parent_branch_id IS NULL) = (fork_revision_id IS NULL)),
  FOREIGN KEY(project_id, parent_branch_id) REFERENCES v3_memory_branch(project_id, id),
  FOREIGN KEY(fork_revision_id, parent_branch_id) REFERENCES v3_memory_revision(id, branch_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(head_revision_id, id) REFERENCES v3_memory_revision(id, branch_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE IF NOT EXISTS v3_memory_revision (
  id TEXT PRIMARY KEY NOT NULL, branch_id TEXT NOT NULL REFERENCES v3_memory_branch(id),
  sequence INTEGER NOT NULL CHECK(typeof(sequence)='integer' AND sequence >= 0), parent_revision_id TEXT REFERENCES v3_memory_revision(id),
  authority_changeset_id TEXT NOT NULL, recorded_at TEXT NOT NULL,
  UNIQUE(branch_id, sequence), UNIQUE(id, branch_id)
);
CREATE TABLE IF NOT EXISTS v3_memory_overlay (
  project_id TEXT NOT NULL, branch_id TEXT NOT NULL, ancestor_branch_id TEXT NOT NULL,
  through_revision_id TEXT NOT NULL, precedence INTEGER NOT NULL CHECK(typeof(precedence)='integer' AND precedence >= 0),
  PRIMARY KEY(branch_id, ancestor_branch_id), UNIQUE(branch_id, precedence),
  FOREIGN KEY(project_id, branch_id) REFERENCES v3_memory_branch(project_id, id),
  FOREIGN KEY(project_id, ancestor_branch_id) REFERENCES v3_memory_branch(project_id, id),
  FOREIGN KEY(through_revision_id, ancestor_branch_id) REFERENCES v3_memory_revision(id, branch_id)
);
CREATE TABLE IF NOT EXISTS v3_memory_source_version (
  id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, branch_id TEXT NOT NULL, revision_id TEXT NOT NULL,
  owner TEXT NOT NULL CHECK(owner IN ('existing_document','existing_fact_document','existing_author_decision')),
  existing_source_id TEXT NOT NULL, existing_snapshot_id TEXT NOT NULL, path TEXT NOT NULL,
  body_hash TEXT NOT NULL CHECK(length(body_hash)=64), accepted INTEGER NOT NULL CHECK(accepted IN (0,1)),
  source_role TEXT NOT NULL CHECK(source_role IN ('original','legacy_fact_document','derived_projection')),
  recorded_at TEXT NOT NULL, UNIQUE(branch_id, existing_source_id, revision_id),
  CHECK((owner='existing_fact_document') = (source_role='legacy_fact_document')),
  FOREIGN KEY(project_id, branch_id) REFERENCES v3_memory_branch(project_id, id),
  FOREIGN KEY(revision_id, branch_id) REFERENCES v3_memory_revision(id, branch_id)
);
CREATE TABLE IF NOT EXISTS v3_memory_evidence (
  id TEXT PRIMARY KEY NOT NULL, source_version_id TEXT NOT NULL REFERENCES v3_memory_source_version(id),
  offset_unit TEXT NOT NULL DEFAULT 'unicode_codepoint' CHECK(offset_unit='unicode_codepoint'),
  start_offset INTEGER NOT NULL CHECK(typeof(start_offset)='integer' AND start_offset>=0), end_offset INTEGER NOT NULL CHECK(typeof(end_offset)='integer' AND end_offset>start_offset),
  quote TEXT NOT NULL CHECK(length(quote)>0), quote_hash TEXT NOT NULL CHECK(length(quote_hash)=64),
  UNIQUE(source_version_id, start_offset, end_offset, quote_hash)
);
CREATE TABLE IF NOT EXISTS v3_memory_claim_projection (
  id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, branch_id TEXT NOT NULL, revision_id TEXT NOT NULL,
  existing_fact_id TEXT NOT NULL, existing_fact_hash TEXT NOT NULL CHECK(length(existing_fact_hash)=64),
  legacy_fact_document_version_id TEXT REFERENCES v3_memory_source_version(id),
  authority_changeset_id TEXT, existing_candidate_id TEXT,
  derivation_artifact_id TEXT REFERENCES v3_memory_artifact(id),
  kind TEXT NOT NULL CHECK(kind IN ('world','belief','utterance','inference','plan')),
  lane TEXT NOT NULL CHECK(lane IN ('accepted','candidate','derived')),
  subject_entity_id TEXT NOT NULL, predicate TEXT NOT NULL, cached_value_json TEXT NOT NULL CHECK(json_valid(cached_value_json)),
  holder_actor_id TEXT, speaker_actor_id TEXT, epistemic_json TEXT NOT NULL CHECK(json_valid(epistemic_json)),
  revealed_chapter_id TEXT NOT NULL, revealed_chapter_order INTEGER NOT NULL CHECK(typeof(revealed_chapter_order)='integer' AND revealed_chapter_order>=0),
  revealed_scene_id TEXT NOT NULL, revealed_event_order INTEGER NOT NULL CHECK(typeof(revealed_event_order)='integer' AND revealed_event_order>=0),
  revealed_scene_order INTEGER NOT NULL CHECK(typeof(revealed_scene_order)='integer' AND revealed_scene_order>=0), revealed_codepoint INTEGER NOT NULL CHECK(typeof(revealed_codepoint)='integer' AND revealed_codepoint>=0),
  story_window_json TEXT NOT NULL CHECK(json_valid(story_window_json)), evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json)),
  related_claim_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(related_claim_ids_json) AND json_type(related_claim_ids_json)='array'),
  binding_state TEXT NOT NULL DEFAULT 'active' CHECK(binding_state IN ('active','stale')),
  CHECK(json_extract(epistemic_json,'$.kind') IS kind),
  CHECK(kind <> 'belief' OR holder_actor_id IS NOT NULL), CHECK(kind <> 'utterance' OR speaker_actor_id IS NOT NULL),
  CHECK(lane<>'accepted' OR (authority_changeset_id IS NOT NULL AND existing_candidate_id IS NULL AND derivation_artifact_id IS NULL)),
  CHECK(lane<>'candidate' OR (existing_candidate_id IS NOT NULL AND authority_changeset_id IS NULL AND derivation_artifact_id IS NULL)),
  CHECK(lane<>'derived' OR (derivation_artifact_id IS NOT NULL AND authority_changeset_id IS NULL AND existing_candidate_id IS NULL)),
  CHECK(json_type(evidence_ids_json)='array'),
  UNIQUE(branch_id, existing_fact_id, revision_id),
  FOREIGN KEY(project_id, branch_id) REFERENCES v3_memory_branch(project_id, id),
  FOREIGN KEY(revision_id, branch_id) REFERENCES v3_memory_revision(id, branch_id)
);
CREATE INDEX IF NOT EXISTS v3_claim_lookup ON v3_memory_claim_projection(branch_id, subject_entity_id, predicate, kind, revealed_chapter_order);
CREATE INDEX IF NOT EXISTS v3_claim_source ON v3_memory_claim_projection(legacy_fact_document_version_id);
CREATE TABLE IF NOT EXISTS v3_memory_claim_evidence (
  claim_id TEXT NOT NULL REFERENCES v3_memory_claim_projection(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES v3_memory_evidence(id), PRIMARY KEY(claim_id,evidence_id)
);
CREATE INDEX IF NOT EXISTS v3_claim_evidence_reverse ON v3_memory_claim_evidence(evidence_id,claim_id);
CREATE TRIGGER IF NOT EXISTS v3_claim_evidence_insert AFTER INSERT ON v3_memory_claim_projection BEGIN
  INSERT INTO v3_memory_claim_evidence(claim_id,evidence_id) SELECT NEW.id,value FROM json_each(NEW.evidence_ids_json);
END;
CREATE TRIGGER IF NOT EXISTS v3_claim_evidence_update AFTER UPDATE OF evidence_ids_json ON v3_memory_claim_projection BEGIN
  DELETE FROM v3_memory_claim_evidence WHERE claim_id=NEW.id;
  INSERT INTO v3_memory_claim_evidence(claim_id,evidence_id) SELECT NEW.id,value FROM json_each(NEW.evidence_ids_json);
END;

CREATE TABLE IF NOT EXISTS v3_memory_story_anchor (
  id TEXT PRIMARY KEY NOT NULL, timeline_id TEXT NOT NULL, label TEXT NOT NULL,
  existing_fact_id TEXT NOT NULL, source_version_id TEXT NOT NULL REFERENCES v3_memory_source_version(id)
);
CREATE TABLE IF NOT EXISTS v3_memory_story_order (
  id TEXT PRIMARY KEY NOT NULL, from_anchor_id TEXT NOT NULL REFERENCES v3_memory_story_anchor(id),
  to_anchor_id TEXT NOT NULL REFERENCES v3_memory_story_anchor(id),
  relation TEXT NOT NULL CHECK(relation IN ('before','same_time','overlaps')),
  revision_id TEXT NOT NULL REFERENCES v3_memory_revision(id), evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json)),
  CHECK(from_anchor_id <> to_anchor_id), UNIQUE(from_anchor_id,to_anchor_id,relation,revision_id)
);
CREATE TABLE IF NOT EXISTS v3_memory_knowledge (
  id TEXT PRIMARY KEY NOT NULL, branch_id TEXT NOT NULL, revision_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, proposition_claim_id TEXT NOT NULL REFERENCES v3_memory_claim_projection(id),
  mode TEXT NOT NULL CHECK(mode IN ('seen','heard','inferred','misunderstood')),
  acquired_chapter_id TEXT NOT NULL, acquired_chapter_order INTEGER NOT NULL CHECK(typeof(acquired_chapter_order)='integer' AND acquired_chapter_order>=0),
  acquired_scene_id TEXT NOT NULL, acquired_event_order INTEGER NOT NULL CHECK(typeof(acquired_event_order)='integer' AND acquired_event_order>=0),
  acquired_scene_order INTEGER NOT NULL CHECK(typeof(acquired_scene_order)='integer' AND acquired_scene_order>=0), acquired_codepoint INTEGER NOT NULL CHECK(typeof(acquired_codepoint)='integer' AND acquired_codepoint>=0),
  story_window_json TEXT NOT NULL CHECK(json_valid(story_window_json)), evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json)),
  FOREIGN KEY(revision_id, branch_id) REFERENCES v3_memory_revision(id, branch_id)
);
CREATE INDEX IF NOT EXISTS v3_knowledge_actor ON v3_memory_knowledge(branch_id,actor_id,acquired_chapter_order,acquired_scene_order);
CREATE TABLE IF NOT EXISTS v3_memory_lifecycle_event (
  event_sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL, revision_id TEXT NOT NULL, claim_id TEXT NOT NULL REFERENCES v3_memory_claim_projection(id),
  kind TEXT NOT NULL CHECK(kind IN ('state_ended','correction_retracted','branch_hidden','restored')),
  authority_changeset_id TEXT NOT NULL, at_story_anchor_id TEXT REFERENCES v3_memory_story_anchor(id),
  revealed_at_json TEXT CHECK(revealed_at_json IS NULL OR json_valid(revealed_at_json)),
  replacement_claim_id TEXT REFERENCES v3_memory_claim_projection(id), reverses_event_id TEXT REFERENCES v3_memory_lifecycle_event(id),
  reason TEXT, evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json)),
  CHECK(kind<>'state_ended' OR (at_story_anchor_id IS NOT NULL AND revealed_at_json IS NOT NULL)),
  CHECK(kind NOT IN ('correction_retracted','branch_hidden') OR (reason IS NOT NULL AND length(reason)>0)), CHECK(kind<>'restored' OR reverses_event_id IS NOT NULL),
  FOREIGN KEY(revision_id, branch_id) REFERENCES v3_memory_revision(id, branch_id)
);
CREATE INDEX IF NOT EXISTS v3_lifecycle_claim ON v3_memory_lifecycle_event(branch_id,claim_id,event_sequence);

CREATE TABLE IF NOT EXISTS v3_memory_read_set (
  id TEXT PRIMARY KEY NOT NULL, scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
  source_set_hash TEXT NOT NULL, predicate_epoch_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v3_memory_artifact (
  id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, branch_id TEXT NOT NULL, revision_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('character','chapter','relationship','promise','summary','index','retrieval_packet')), scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
  payload_schema_id TEXT NOT NULL, payload_ref TEXT NOT NULL, read_set_id TEXT NOT NULL REFERENCES v3_memory_read_set(id),
  through_event_sequence INTEGER NOT NULL CHECK(typeof(through_event_sequence)='integer' AND through_event_sequence>=0), input_hash TEXT NOT NULL, output_hash TEXT,
  compiler_version TEXT NOT NULL, model_version TEXT, prompt_hash TEXT,
  state TEXT NOT NULL CHECK(state IN ('building','ready','stale','failed')),
  CHECK(state<>'ready' OR output_hash IS NOT NULL),
  FOREIGN KEY(project_id, branch_id) REFERENCES v3_memory_branch(project_id, id),
  FOREIGN KEY(revision_id, branch_id) REFERENCES v3_memory_revision(id, branch_id)
);
CREATE INDEX IF NOT EXISTS v3_artifact_scope ON v3_memory_artifact(branch_id,kind,state,revision_id);
CREATE TABLE IF NOT EXISTS v3_memory_dependency (
  id TEXT PRIMARY KEY NOT NULL, read_set_id TEXT NOT NULL REFERENCES v3_memory_read_set(id),
  kind TEXT NOT NULL CHECK(kind IN ('source','fact','artifact','predicate','absence')),
  source_version_id TEXT REFERENCES v3_memory_source_version(id), existing_fact_id TEXT,
  input_artifact_id TEXT REFERENCES v3_memory_artifact(id), expected_hash TEXT,
  query_fingerprint TEXT, predicate_json TEXT CHECK(predicate_json IS NULL OR json_valid(predicate_json)),
  result_ids_json TEXT CHECK(result_ids_json IS NULL OR json_valid(result_ids_json)), result_set_hash TEXT,
  partition_epochs_json TEXT CHECK(partition_epochs_json IS NULL OR json_valid(partition_epochs_json)),
  complete_within_scope INTEGER CHECK(complete_within_scope IN (0,1)), expected_empty INTEGER CHECK(expected_empty IN (0,1)),
  CHECK(kind<>'source' OR (source_version_id IS NOT NULL AND expected_hash IS NOT NULL)),
  CHECK(kind<>'fact' OR (existing_fact_id IS NOT NULL AND expected_hash IS NOT NULL)),
  CHECK(kind<>'artifact' OR (input_artifact_id IS NOT NULL AND expected_hash IS NOT NULL)),
  CHECK(kind NOT IN ('predicate','absence') OR (predicate_json IS NOT NULL AND partition_epochs_json IS NOT NULL AND query_fingerprint IS NOT NULL)),
  CHECK(kind<>'predicate' OR (complete_within_scope IS NOT NULL AND result_ids_json IS NOT NULL AND json_type(result_ids_json)='array' AND result_set_hash IS NOT NULL)),
  CHECK(kind<>'absence' OR (complete_within_scope IS 1 AND expected_empty IS 1))
);
CREATE INDEX IF NOT EXISTS v3_dependency_source ON v3_memory_dependency(source_version_id);
CREATE INDEX IF NOT EXISTS v3_dependency_fact ON v3_memory_dependency(existing_fact_id);
CREATE INDEX IF NOT EXISTS v3_dependency_query ON v3_memory_dependency(query_fingerprint);
CREATE TABLE IF NOT EXISTS v3_memory_partition_epoch (
  branch_id TEXT NOT NULL REFERENCES v3_memory_branch(id), partition_key TEXT NOT NULL,
  epoch INTEGER NOT NULL CHECK(typeof(epoch)='integer' AND epoch>=0), PRIMARY KEY(branch_id,partition_key)
);
CREATE TABLE IF NOT EXISTS v3_memory_outbox (
  id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('extract','index','project','invalidate','consolidate')),
  authority_changeset_id TEXT NOT NULL, expected_revision_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, payload_ref TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0 CHECK(typeof(attempt)='integer' AND attempt>=0),
  state TEXT NOT NULL CHECK(state IN ('queued','leased','done','failed','cancelled','outcome_unknown')), lease_until TEXT,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64), existing_run_attempt_id TEXT,
  retry_disposition TEXT NOT NULL CHECK(retry_disposition IN ('local_retry','gateway_managed','manual_review')),
  result_artifact_id TEXT REFERENCES v3_memory_artifact(id),
  CHECK(state<>'outcome_unknown' OR (existing_run_attempt_id IS NOT NULL AND retry_disposition IN ('gateway_managed','manual_review'))),
  UNIQUE(branch_id,kind,idempotency_key),
  FOREIGN KEY(project_id,branch_id) REFERENCES v3_memory_branch(project_id,id),
  FOREIGN KEY(expected_revision_id,branch_id) REFERENCES v3_memory_revision(id,branch_id)
);
CREATE INDEX IF NOT EXISTS v3_outbox_dispatch ON v3_memory_outbox(state,lease_until);
CREATE TABLE IF NOT EXISTS v3_memory_watermark (
  branch_id TEXT NOT NULL, pipeline TEXT NOT NULL,
  through_event_sequence INTEGER NOT NULL CHECK(typeof(through_event_sequence)='integer' AND through_event_sequence>=0), through_revision_id TEXT NOT NULL,
  pending_required_ids_json TEXT NOT NULL CHECK(json_valid(pending_required_ids_json)),
  PRIMARY KEY(branch_id,pipeline),
  FOREIGN KEY(through_revision_id,branch_id) REFERENCES v3_memory_revision(id,branch_id)
);
CREATE TABLE IF NOT EXISTS v3_memory_chapter_batch (
  id TEXT PRIMARY KEY NOT NULL, branch_id TEXT NOT NULL, revision_id TEXT NOT NULL,
  chapter_source_version_id TEXT NOT NULL REFERENCES v3_memory_source_version(id),
  expected_actor_ids_json TEXT NOT NULL CHECK(json_valid(expected_actor_ids_json)), roster_hash TEXT NOT NULL,
  existing_candidate_id TEXT NOT NULL, existing_changeset_id TEXT,
  read_set_id TEXT NOT NULL REFERENCES v3_memory_read_set(id), idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('proposed','validated','committed','stale','failed')),
  CHECK(state<>'committed' OR existing_changeset_id IS NOT NULL), UNIQUE(branch_id,idempotency_key),
  FOREIGN KEY(revision_id,branch_id) REFERENCES v3_memory_revision(id,branch_id)
);
CREATE TABLE IF NOT EXISTS v3_memory_character_coverage (
  batch_id TEXT NOT NULL REFERENCES v3_memory_chapter_batch(id), actor_id TEXT NOT NULL,
  observed_name TEXT NOT NULL,
  appearance TEXT NOT NULL CHECK(appearance IN ('present','recollection','offscreen_affected','mentioned_only','unresolved')),
  status TEXT NOT NULL CHECK(status IN ('changed','reviewed_no_change','insufficient_evidence','mentioned_only','unresolved_identity')),
  evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json)), delta_artifact_id TEXT REFERENCES v3_memory_artifact(id),
  changed_facets_json TEXT NOT NULL CHECK(json_valid(changed_facets_json)),
  unchanged_facets_json TEXT NOT NULL CHECK(json_valid(unchanged_facets_json)),
  unresolved_facets_json TEXT NOT NULL CHECK(json_valid(unresolved_facets_json)),
  not_applicable_facets_json TEXT NOT NULL CHECK(json_valid(not_applicable_facets_json)), reason TEXT NOT NULL,
  CHECK(status<>'changed' OR delta_artifact_id IS NOT NULL), PRIMARY KEY(batch_id,actor_id)
);
