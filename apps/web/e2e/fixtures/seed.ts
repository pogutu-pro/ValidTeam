/**
 * Deterministic seed helper for the Playwright suite.
 *
 * Creates (idempotently):
 *   - 1 organization: "E2E Workspace" (slug: e2e-workspace)
 *   - 1 admin user:    e2e-admin@tasknebula.test / E2eAdmin!2026
 *   - 1 project:       "E2E Project"  (key: E2E)
 *   - default workflow with statuses Backlog / In Progress / Done
 *   - 5 issues with stable keys E2E-1..E2E-5
 *   - 1 reusable project invitation for signup/join browser coverage
 *
 * Run standalone:
 *   pnpm --filter @tasknebula/web exec tsx e2e/fixtures/seed.ts
 *
 * Used by `auth.setup.ts` (via `ensureSeed`) so the suite is self-contained
 * regardless of whether the demo seed has been applied.
 */

import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
// Import the schema directly to avoid pulling in `@tasknebula/db/client`,
// which would instantiate a postgres connection at module load time.
import * as schema from '../../../../packages/db/src/schema';

function getDatabaseConnectionString(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = process.env.POSTGRES_USER || 'postgres';
  const password = process.env.POSTGRES_PASSWORD || 'postgres';
  const host = process.env.POSTGRES_HOST || 'localhost';
  const port = process.env.DB_PORT || process.env.POSTGRES_PORT || '5432';
  const database = process.env.POSTGRES_DB || 'tasknebula';
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

export const E2E_ADMIN = {
  email: 'e2e-admin@tasknebula.test',
  name: 'E2E Admin',
  password: 'E2eAdmin!2026',
} as const;

export const E2E_ORG = {
  name: 'E2E Workspace',
  slug: 'e2e-workspace',
} as const;

export const E2E_PROJECT = {
  key: 'E2E',
  name: 'E2E Project',
} as const;

export const E2E_PUBLIC_SHARE_TOKEN = 'e2e-public-share-2026';
export const E2E_PROJECT_INVITE_TOKEN = 'e2e-project-invite-2026';

export interface SeededIds {
  organizationId: string;
  userId: string;
  projectId: string;
  workflowId: string;
  sprintId: string;
  initiativeId: string;
  intakeFormId: string;
  publicDocumentPageId: string;
  publicShareToken: string;
  projectInviteToken: string;
  statusIds: { backlog: string; inProgress: string; done: string };
  issueIds: string[];
}

let cachedSeed: SeededIds | null = null;

export async function ensureSeed(): Promise<SeededIds> {
  if (cachedSeed) return cachedSeed;

  const url = getDatabaseConnectionString();
  if (!url) throw new Error('DATABASE_URL not set — cannot seed e2e fixture');

  const client = postgres(url);
  const db = drizzle(client, { schema });

  try {
    // --- User ---------------------------------------------------------------
    const existingUser = (
      await db.select().from(schema.users).where(eq(schema.users.email, E2E_ADMIN.email)).limit(1)
    )[0];

    const passwordHash = await bcrypt.hash(E2E_ADMIN.password, 10);
    const userId = existingUser?.id ?? createId();
    if (!existingUser) {
      await db.insert(schema.users).values({
        id: userId,
        email: E2E_ADMIN.email,
        name: E2E_ADMIN.name,
        password: passwordHash,
        settings: {},
        status: 'active',
        isSuperAdmin: true,
        emailVerified: new Date(),
      });
    }

    // --- Organization -------------------------------------------------------
    const existingOrg = (
      await db
        .select()
        .from(schema.organizations)
        .where(eq(schema.organizations.slug, E2E_ORG.slug))
        .limit(1)
    )[0];
    const organizationId = existingOrg?.id ?? createId();
    if (!existingOrg) {
      await db.insert(schema.organizations).values({
        id: organizationId,
        name: E2E_ORG.name,
        slug: E2E_ORG.slug,
        settings: {},
        plan: 'growth',
        status: 'active',
      });
      await db.insert(schema.organizationMembers).values({
        id: createId(),
        organizationId,
        userId,
        role: 'owner',
      });
    }

    // --- Project ------------------------------------------------------------
    const existingProject = (
      await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.key, E2E_PROJECT.key))
        .limit(1)
    )[0];
    const projectId = existingProject?.id ?? createId();
    if (!existingProject) {
      await db.insert(schema.projects).values({
        id: projectId,
        organizationId,
        key: E2E_PROJECT.key,
        name: E2E_PROJECT.name,
        description: 'Project used by Playwright suite. Do not modify manually.',
        leadId: userId,
        status: 'active',
        settings: {},
        createdBy: userId,
        updatedBy: userId,
      });
    }

    // --- Reusable project invite ------------------------------------------
    // Store only the hash, matching production invite creation. Reset the
    // bounded fixture on each suite setup so repeated local E2E runs remain
    // deterministic without creating an unbounded set of invite rows.
    const projectInviteTokenHash = createHash('sha256')
      .update(E2E_PROJECT_INVITE_TOKEN)
      .digest('hex');
    const existingProjectInvite = (
      await db
        .select({ id: schema.projectInviteLinks.id })
        .from(schema.projectInviteLinks)
        .where(eq(schema.projectInviteLinks.tokenHash, projectInviteTokenHash))
        .limit(1)
    )[0];
    const projectInviteValues = {
      organizationId,
      projectId,
      tokenHash: projectInviteTokenHash,
      role: 'developer' as const,
      maxUses: 25,
      usedCount: 0,
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      revokedAt: null,
      revokedBy: null,
      createdBy: userId,
      updatedAt: new Date(),
    };
    if (existingProjectInvite) {
      await db
        .update(schema.projectInviteLinks)
        .set(projectInviteValues)
        .where(eq(schema.projectInviteLinks.id, existingProjectInvite.id));
    } else {
      await db.insert(schema.projectInviteLinks).values({
        id: createId(),
        ...projectInviteValues,
      });
    }

    // --- Workflow + statuses -----------------------------------------------
    const existingWorkflow = (
      await db
        .select()
        .from(schema.workflows)
        .where(eq(schema.workflows.organizationId, organizationId))
        .limit(1)
    )[0];
    const workflowId = existingWorkflow?.id ?? createId();
    let backlogId: string;
    let inProgressId: string;
    let doneId: string;

    if (!existingWorkflow) {
      // Workflows are now scoped at the organization (workspace) level rather
      // than per-project — the project is linked via projectWorkflows or
      // similar separate table in the canonical schema.
      await db.insert(schema.workflows).values({
        id: workflowId,
        organizationId,
        name: 'Default Workflow',
        description: 'E2E default workflow',
        isDefault: true,
        createdBy: userId,
        updatedBy: userId,
      });

      backlogId = createId();
      inProgressId = createId();
      doneId = createId();
      await db.insert(schema.workflowStatuses).values([
        {
          id: backlogId,
          workflowId,
          name: 'Backlog',
          category: 'backlog',
          color: '#94a3b8',
          position: 0,
        },
        {
          id: inProgressId,
          workflowId,
          name: 'In Progress',
          category: 'in_progress',
          color: '#3b82f6',
          position: 1,
        },
        { id: doneId, workflowId, name: 'Done', category: 'done', color: '#22c55e', position: 2 },
      ]);
    } else {
      const statuses = await db
        .select()
        .from(schema.workflowStatuses)
        .where(eq(schema.workflowStatuses.workflowId, workflowId));
      const byCategory = (cat: string) => statuses.find((s) => s.category === cat);
      backlogId = byCategory('backlog')!.id;
      inProgressId = byCategory('in_progress')!.id;
      doneId = byCategory('done')!.id;
    }

    // Repair older fixture databases that predate explicit project workflow
    // selection. Production transition resolution treats this link as the
    // project's canonical workflow boundary.
    if (existingProject?.defaultWorkflowId !== workflowId) {
      await db
        .update(schema.projects)
        .set({ defaultWorkflowId: workflowId, updatedBy: userId, updatedAt: new Date() })
        .where(
          and(eq(schema.projects.id, projectId), eq(schema.projects.organizationId, organizationId))
        );
    }

    // The transition service requires an exact persisted from→to edge. Keep
    // the fixture idempotent so both fresh and already-seeded databases obey
    // the same policy contract. Backward edges reset E2E-1 after prior runs;
    // forward edges cover lifecycle and Kanban moves.
    const requiredTransitions = [
      { name: 'Start Progress', fromStatusId: backlogId, toStatusId: inProgressId },
      { name: 'Complete', fromStatusId: inProgressId, toStatusId: doneId },
      { name: 'Return to Backlog', fromStatusId: inProgressId, toStatusId: backlogId },
      { name: 'Reopen to Backlog', fromStatusId: doneId, toStatusId: backlogId },
    ];
    for (const transition of requiredTransitions) {
      const existingTransition = (
        await db
          .select({ id: schema.workflowTransitions.id })
          .from(schema.workflowTransitions)
          .where(
            and(
              eq(schema.workflowTransitions.workflowId, workflowId),
              eq(schema.workflowTransitions.fromStatusId, transition.fromStatusId),
              eq(schema.workflowTransitions.toStatusId, transition.toStatusId)
            )
          )
          .limit(1)
      )[0];
      if (!existingTransition) {
        await db.insert(schema.workflowTransitions).values({
          id: createId(),
          workflowId,
          ...transition,
          allowedRoles: ['admin', 'member'],
          requiresApproval: false,
          approverRoles: ['admin'],
          approvedTargetStatusId: null,
          rejectedTargetStatusId: null,
          conditions: [],
          validators: [],
          postActions: [],
        });
      }
    }

    // --- 5 deterministic issues --------------------------------------------
    const issueIds: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const key = `${E2E_PROJECT.key}-${i}`;
      const existing = (
        await db.select().from(schema.issues).where(eq(schema.issues.key, key)).limit(1)
      )[0];
      if (existing) {
        issueIds.push(existing.id);
        continue;
      }
      const id = createId();
      issueIds.push(id);
      await db.insert(schema.issues).values({
        id,
        organizationId,
        projectId,
        key,
        number: i,
        type: i === 1 ? 'epic' : i === 5 ? 'bug' : 'task',
        title: `E2E seed issue ${i}`,
        description: 'Auto-generated by Playwright fixture',
        statusId: i <= 3 ? backlogId : i === 4 ? inProgressId : doneId,
        priority: i === 5 ? 'critical' : 'medium',
        assigneeId: userId,
        reporterId: userId,
        labels: ['e2e'],
        estimate: 3,
        customFields: {},
        metadata: {},
        createdBy: userId,
        updatedBy: userId,
      });
    }

    // --- Stable dynamic-route fixtures -------------------------------------
    const existingSprint = (
      await db.select().from(schema.sprints).where(eq(schema.sprints.projectId, projectId)).limit(1)
    )[0];
    const sprintId = existingSprint?.id ?? createId();
    if (!existingSprint) {
      await db.insert(schema.sprints).values({
        id: sprintId,
        projectId,
        name: 'E2E Sprint',
        goal: 'Stable fixture for dynamic route coverage',
        startDate: new Date('2026-08-10T00:00:00.000Z'),
        endDate: new Date('2026-08-24T00:00:00.000Z'),
        status: 'active',
        createdBy: userId,
        updatedBy: userId,
      });
    }

    const existingInitiative = (
      await db
        .select()
        .from(schema.initiatives)
        .where(
          and(
            eq(schema.initiatives.workspaceId, organizationId),
            eq(schema.initiatives.slug, 'e2e-initiative')
          )
        )
        .limit(1)
    )[0];
    const initiativeId = existingInitiative?.id ?? createId();
    if (!existingInitiative) {
      await db.insert(schema.initiatives).values({
        id: initiativeId,
        workspaceId: organizationId,
        name: 'E2E Initiative',
        slug: 'e2e-initiative',
        description: 'Stable fixture for dynamic route coverage',
        status: 'active',
        ownerUserId: userId,
        createdBy: userId,
        updatedBy: userId,
      });
    }

    const existingIntakeForm = (
      await db
        .select()
        .from(schema.intakeForms)
        .where(eq(schema.intakeForms.slug, 'e2e-intake'))
        .limit(1)
    )[0];
    const intakeFormId = existingIntakeForm?.id ?? createId();
    if (!existingIntakeForm) {
      await db.insert(schema.intakeForms).values({
        id: intakeFormId,
        workspaceId: organizationId,
        projectId,
        slug: 'e2e-intake',
        title: 'E2E Intake',
        description: 'Stable fixture for dynamic route coverage',
        fields: [
          { name: 'summary', label: 'Summary', type: 'text', required: true },
          { name: 'details', label: 'Details', type: 'textarea' },
        ],
      });
    }

    const existingDocumentSpace = (
      await db
        .select()
        .from(schema.documentSpaces)
        .where(
          and(
            eq(schema.documentSpaces.organizationId, organizationId),
            eq(schema.documentSpaces.slug, 'e2e-public-docs')
          )
        )
        .limit(1)
    )[0];
    const documentSpaceId = existingDocumentSpace?.id ?? createId();
    if (!existingDocumentSpace) {
      await db.insert(schema.documentSpaces).values({
        id: documentSpaceId,
        organizationId,
        projectId,
        scope: 'project',
        name: 'E2E Public Docs',
        slug: 'e2e-public-docs',
        description: 'Stable public document fixture for surface coverage',
        isDefault: false,
        createdBy: userId,
        updatedBy: userId,
      });
    }

    const existingPublicDocument = (
      await db
        .select()
        .from(schema.documentPages)
        .where(eq(schema.documentPages.publicShareToken, E2E_PUBLIC_SHARE_TOKEN))
        .limit(1)
    )[0];
    const publicDocumentPageId = existingPublicDocument?.id ?? createId();
    const publicDocumentValues = {
      title:
        'E2E Public Document With A Very Long Unbroken Token ' +
        'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789',
      excerpt: 'Stable public share fixture used to verify responsive and accessible rendering.',
      contentJson: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'This published document is intentionally safe for unauthenticated E2E coverage.',
              },
            ],
          },
        ],
      },
      contentText:
        'This published document is intentionally safe for unauthenticated E2E coverage.',
      publicShareEnabled: true,
      publicShareToken: E2E_PUBLIC_SHARE_TOKEN,
      publicShareAllowSearchIndexing: false,
      publicShareIncludeAttachments: true,
      publicSharePublishedAt: new Date('2026-08-12T00:00:00.000Z'),
      publicSharePublishedBy: userId,
      updatedBy: userId,
    } as const;

    if (existingPublicDocument) {
      await db
        .update(schema.documentPages)
        .set(publicDocumentValues)
        .where(eq(schema.documentPages.id, publicDocumentPageId));
    } else {
      await db.insert(schema.documentPages).values({
        id: publicDocumentPageId,
        spaceId: documentSpaceId,
        organizationId,
        projectId,
        parentId: null,
        slug: 'e2e-public-document',
        icon: 'globe',
        currentRevision: 1,
        position: 0,
        isArchived: false,
        createdBy: userId,
        ...publicDocumentValues,
      });
    }

    const publicAttachmentFileName = 'e2e-' + 'attachment-name-without-breaks-'.repeat(5) + '.txt';
    const existingPublicAttachment = (
      await db
        .select()
        .from(schema.documentPageAttachments)
        .where(
          and(
            eq(schema.documentPageAttachments.pageId, publicDocumentPageId),
            eq(schema.documentPageAttachments.fileName, publicAttachmentFileName)
          )
        )
        .limit(1)
    )[0];
    if (!existingPublicAttachment) {
      await db.insert(schema.documentPageAttachments).values({
        id: createId(),
        pageId: publicDocumentPageId,
        fileName: publicAttachmentFileName,
        fileSize: 42,
        mimeType: 'text/plain',
        filePath: '/tmp/tasknebula-e2e-public-attachment.txt',
        uploadedById: userId,
      });
    }

    cachedSeed = {
      organizationId,
      userId,
      projectId,
      workflowId,
      sprintId,
      initiativeId,
      intakeFormId,
      publicDocumentPageId,
      publicShareToken: E2E_PUBLIC_SHARE_TOKEN,
      projectInviteToken: E2E_PROJECT_INVITE_TOKEN,
      statusIds: { backlog: backlogId, inProgress: inProgressId, done: doneId },
      issueIds,
    };
    return cachedSeed;
  } finally {
    await client.end();
  }
}

// Allow running directly: `tsx e2e/fixtures/seed.ts`
if (require.main === module) {
  ensureSeed()
    .then((ids) => {
      // eslint-disable-next-line no-console
      console.log('E2E seed complete:', ids);
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('E2E seed failed:', err);
      process.exit(1);
    });
}
