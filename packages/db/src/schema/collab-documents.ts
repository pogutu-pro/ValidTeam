import { customType, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * Durable Yjs state owned by the database migration layer.
 *
 * Document names are application namespaces such as `issue:<issueId>`.
 * Authorization and tenant isolation are resolved through the referenced
 * application entity before Hocuspocus reads or writes this state.
 */
export const collabDocuments = pgTable('collab_documents', {
  name: text('name').primaryKey(),
  data: bytea('data').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CollabDocument = typeof collabDocuments.$inferSelect;
export type NewCollabDocument = typeof collabDocuments.$inferInsert;
