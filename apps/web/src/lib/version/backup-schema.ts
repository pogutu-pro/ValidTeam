import { z } from 'zod';
import type { SelfUpdateBackupSnapshot } from './backup';

const artifactSchema = z
  .object({
    path: z.string().min(1).max(4096).nullable(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .nullable(),
    sizeBytes: z.number().int().safe().nonnegative().nullable(),
  })
  .strict();

export const selfUpdateBackupSnapshotSchema = z
  .object({
    id: z.string().min(8).max(128),
    status: z.enum(['pending', 'succeeded', 'failed', 'skipped']),
    required: z.boolean(),
    directory: z.string().max(4096),
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).nullable(),
    database: artifactSchema.nullable(),
    uploads: artifactSchema.nullable(),
    manifest: artifactSchema.nullable(),
    failureReason: z.string().max(500).nullable(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.status === 'pending' && snapshot.completedAt !== null) {
      context.addIssue({ code: 'custom', path: ['completedAt'], message: 'pending_not_complete' });
    }
    if (snapshot.status === 'succeeded') {
      if (!snapshot.completedAt) {
        context.addIssue({ code: 'custom', path: ['completedAt'], message: 'success_incomplete' });
      }
      for (const key of ['database', 'uploads', 'manifest'] as const) {
        const artifact = snapshot[key];
        if (!artifact?.path || !artifact.sha256 || artifact.sizeBytes === null) {
          context.addIssue({ code: 'custom', path: [key], message: 'success_artifact_missing' });
        }
      }
    }
    if (snapshot.status === 'failed' && (!snapshot.completedAt || !snapshot.failureReason)) {
      context.addIssue({ code: 'custom', path: ['failureReason'], message: 'failure_incomplete' });
    }
    if (snapshot.status === 'skipped' && snapshot.required) {
      context.addIssue({ code: 'custom', path: ['required'], message: 'required_backup_skipped' });
    }
  });

export function parseSelfUpdateBackupSnapshot(value: unknown): SelfUpdateBackupSnapshot | null {
  const parsed = selfUpdateBackupSnapshotSchema.safeParse(value);
  return parsed.success ? (parsed.data as SelfUpdateBackupSnapshot) : null;
}
