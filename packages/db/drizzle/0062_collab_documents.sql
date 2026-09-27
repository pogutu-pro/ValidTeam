-- Database-owned persistence for Hocuspocus Yjs document state.
--
-- Older deployments may already have this exact table because the
-- Hocuspocus process used to create it at runtime. CREATE TABLE IF NOT EXISTS
-- deliberately adopts that data in place; no rows are rewritten or dropped.

CREATE TABLE IF NOT EXISTS "collab_documents" (
  "name" text PRIMARY KEY NOT NULL,
  "data" bytea NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
