import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCollabDocumentsSchema, createDocumentPersistence } from './persistence.mjs';

test('schema readiness is a read-only probe owned by migrations', async () => {
  const calls = [];
  const pool = {
    async query(statement, values) {
      calls.push({ statement, values });
      return { rows: [] };
    },
  };

  await assertCollabDocumentsSchema(pool);

  assert.equal(calls.length, 1);
  assert.match(calls[0].statement, /^\s*SELECT\b/i);
  assert.match(calls[0].statement, /\bFROM\s+"collab_documents"/i);
  assert.doesNotMatch(calls[0].statement, /\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i);
});

test('document persistence returns null for a missing document', async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };
  const { fetchDocument } = createDocumentPersistence(pool);

  assert.equal(await fetchDocument({ documentName: 'issue:missing' }), null);
});

test('document persistence reads and upserts binary Yjs state', async () => {
  const stored = Buffer.from([1, 2, 3]);
  const calls = [];
  const pool = {
    async query(statement, values) {
      calls.push({ statement, values });
      if (/^SELECT\s+"data"/i.test(statement)) return { rows: [{ data: stored }] };
      return { rows: [] };
    },
  };
  const { fetchDocument, storeDocument } = createDocumentPersistence(pool);

  assert.equal(await fetchDocument({ documentName: 'issue:one' }), stored);
  await storeDocument({ documentName: 'issue:one', state: new Uint8Array([4, 5, 6]) });

  assert.equal(calls.length, 2);
  assert.match(calls[1].statement, /^INSERT INTO "collab_documents"/);
  assert.match(calls[1].statement, /ON CONFLICT \("name"\) DO UPDATE/);
  assert.equal(calls[1].values[0], 'issue:one');
  assert.deepEqual(calls[1].values[1], Buffer.from([4, 5, 6]));
});
