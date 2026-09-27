const COLLAB_DOCUMENTS_SCHEMA_PROBE = `
  SELECT "name", "data", "updated_at"
  FROM "collab_documents"
  LIMIT 0
`;

/**
 * Verify that the database migration layer has installed the persistence
 * table. This probe is intentionally read-only: application services must
 * never create or alter production schema during boot.
 */
export async function assertCollabDocumentsSchema(pool) {
  await pool.query(COLLAB_DOCUMENTS_SCHEMA_PROBE);
}

export function createDocumentPersistence(pool) {
  async function fetchDocument({ documentName }) {
    const result = await pool.query(
      'SELECT "data" FROM "collab_documents" WHERE "name" = $1 LIMIT 1',
      [documentName]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].data;
  }

  async function storeDocument({ documentName, state }) {
    await pool.query(
      `INSERT INTO "collab_documents" ("name", "data", "updated_at")
       VALUES ($1, $2, NOW())
       ON CONFLICT ("name") DO UPDATE
       SET "data" = EXCLUDED."data", "updated_at" = NOW()`,
      [documentName, Buffer.from(state)]
    );
  }

  return { fetchDocument, storeDocument };
}
