// Schema DDL — the five Data Objects the engine owns, with full-text search
// (tsvector + GIN) and proper field indexes. Applied idempotently at startup
// and by the migrate script (Local start composition).
//
// There is no "model": an element's scope is its System — system_id for every
// element but a System, and the System's own id for a System (COALESCE below).
// Names are unique within that scope (the System's own name included), and
// System names are unique among Systems, so a name always resolves to exactly
// one element of a System (Requirement: Element Name Is Unique Within Its System).
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS contour_element (
  id            uuid PRIMARY KEY,
  name          varchar(512) NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  system_id     uuid,
  element_type  varchar(32) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Migration from the model-scoped schema (v0.5.0): the model is replaced by the System.
ALTER TABLE contour_element DROP COLUMN IF EXISTS model_id;
CREATE INDEX IF NOT EXISTS ix_element_type   ON contour_element (element_type);
CREATE INDEX IF NOT EXISTS ix_element_system ON contour_element (system_id);
CREATE INDEX IF NOT EXISTS ix_element_name   ON contour_element (name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_element_name_in_system
  ON contour_element ((COALESCE(system_id, id)), name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_name
  ON contour_element (name) WHERE system_id IS NULL;

CREATE TABLE IF NOT EXISTS contour_relationship (
  id              uuid PRIMARY KEY,
  from_element_id uuid NOT NULL REFERENCES contour_element(id) ON DELETE CASCADE,
  to_element_id   uuid NOT NULL REFERENCES contour_element(id) ON DELETE CASCADE,
  verb            varchar(32) NOT NULL,
  CONSTRAINT uq_rel_edge UNIQUE (from_element_id, to_element_id, verb)
);
ALTER TABLE contour_relationship DROP COLUMN IF EXISTS model_id;
CREATE INDEX IF NOT EXISTS ix_rel_from  ON contour_relationship (from_element_id);
CREATE INDEX IF NOT EXISTS ix_rel_to    ON contour_relationship (to_element_id);

CREATE TABLE IF NOT EXISTS contour_record (
  id          uuid PRIMARY KEY,
  element_id  uuid NOT NULL REFERENCES contour_element(id) ON DELETE CASCADE,
  body        jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_text text NOT NULL DEFAULT '',
  search_tsv  tsvector
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_record_element ON contour_record (element_id);
CREATE INDEX IF NOT EXISTS ix_record_tsv ON contour_record USING gin (search_tsv);

CREATE TABLE IF NOT EXISTS contour_requirement (
  id          uuid PRIMARY KEY,
  name        varchar(512) NOT NULL UNIQUE,
  description text NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  search_tsv  tsvector
);
CREATE INDEX IF NOT EXISTS ix_requirement_tsv ON contour_requirement USING gin (search_tsv);

CREATE TABLE IF NOT EXISTS contour_guardrail (
  id          uuid PRIMARY KEY,
  name        varchar(512) NOT NULL UNIQUE,
  description text NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  search_tsv  tsvector
);
CREATE INDEX IF NOT EXISTS ix_guardrail_tsv ON contour_guardrail USING gin (search_tsv);

-- Append-only history. Store Element and Store Requirement/Guardrail copy the record body (or
-- description) they are about to replace into these tables, at its current version, BEFORE the
-- live row advances — so every prior revision is kept and Diff Element has a "before" to compare
-- an "after" against (Requirement: Record History Is Kept; Guardrail: History Is Append Only).
-- The live row remains the current version; these tables hold only the superseded ones.
CREATE TABLE IF NOT EXISTS contour_element_version (
  element_id  uuid NOT NULL REFERENCES contour_element(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  body        jsonb NOT NULL,
  change_note text,
  changed_by  varchar(64),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (element_id, version)
);
CREATE INDEX IF NOT EXISTS ix_element_version_element ON contour_element_version (element_id);

CREATE TABLE IF NOT EXISTS contour_definition_version (
  definition_id uuid NOT NULL,
  kind          varchar(16) NOT NULL,
  version       integer NOT NULL,
  description   text NOT NULL,
  change_note   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (definition_id, version)
);
CREATE INDEX IF NOT EXISTS ix_definition_version_def ON contour_definition_version (definition_id);
`;
