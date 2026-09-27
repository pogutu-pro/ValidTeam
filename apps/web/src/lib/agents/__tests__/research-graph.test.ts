/**
 * @jest-environment node
 */

import { GRAPH_END } from '../graph-runtime';
import { runResearchGraph, type ResearchAdapters, type ResearchSource } from '../research-graph';

function source(id: string, round: number): ResearchSource {
  return {
    id,
    kind: 'document',
    title: `Source ${id}`,
    uri: `/docs/${id}`,
    excerpt: `Evidence from round ${round}`,
    retrievedAt: '2026-08-12T00:00:00.000Z',
    contentHash: `hash-${id}-${round}`,
  };
}

function adapters(): ResearchAdapters {
  return {
    plan: jest.fn(async () => ({
      questions: ['What evidence answers the request?'],
      sourceKinds: ['document' as const],
    })),
    retrieve: jest.fn(async ({ round }) => [source(`doc-${round}`, round)]),
    gradeEvidence: jest.fn(async ({ sources }) => ({
      sufficient: sources.length >= 2,
      gaps: sources.length >= 2 ? [] : ['A second independent source is required.'],
    })),
    synthesize: jest.fn(async ({ sources }) => ({
      answer: 'Grounded answer [DOC-doc-1] [DOC-doc-2].',
      claims: [
        {
          id: 'claim-1',
          text: 'Grounded answer.',
          sourceIds: sources.map((item) => item.id),
          confidence: 0.9,
        },
      ],
    })),
    verifyCitations: jest.fn(async ({ claims, sources }) => ({
      unresolvedClaimIds: claims
        .filter((claim) =>
          claim.sourceIds.some((id) => !sources.some((sourceItem) => sourceItem.id === id))
        )
        .map((claim) => claim.id),
    })),
  };
}

describe('research graph', () => {
  it('rejects an empty research question before calling an adapter', () => {
    expect(() => runResearchGraph(adapters(), '   ')).toThrow('Research question is required');
  });

  it('loops through evidence gaps, verifies claims, then pauses for review', async () => {
    const researchAdapters = adapters();
    const result = await runResearchGraph(researchAdapters, 'What changed?', {
      policy: { maxRetrievalRounds: 3, requireHumanReview: true },
      maxSteps: 16,
    });

    expect(result.status).toBe('interrupted');
    expect(result.state.retrievalRound).toBe(2);
    expect(result.state.sources).toHaveLength(2);
    expect(result.state.unresolvedClaimIds).toEqual([]);
    expect(result.checkpoint.currentNode).toBe('human_review');
    expect(researchAdapters.retrieve).toHaveBeenCalledTimes(2);
  });

  it('resumes an approved review without repeating retrieval or synthesis', async () => {
    const researchAdapters = adapters();
    const first = await runResearchGraph(researchAdapters, 'What changed?', {
      policy: { maxRetrievalRounds: 3, requireHumanReview: true },
    });
    expect(first.status).toBe('interrupted');

    const checkpoint = {
      ...first.checkpoint,
      state: { ...first.state, reviewDecision: 'approved' as const },
    };
    const resumed = await runResearchGraph(researchAdapters, first.state.question, {
      policy: { maxRetrievalRounds: 3, requireHumanReview: true },
      checkpoint,
    });

    expect(resumed.status).toBe('completed');
    expect(resumed.state.outcome).toBe('approved');
    expect(resumed.checkpoint.currentNode).toBe(GRAPH_END);
    expect(researchAdapters.retrieve).toHaveBeenCalledTimes(2);
    expect(researchAdapters.synthesize).toHaveBeenCalledTimes(1);
  });

  it('finishes without an interrupt when review is disabled', async () => {
    const researchAdapters = adapters();
    const result = await runResearchGraph(researchAdapters, 'What changed?', {
      policy: { maxRetrievalRounds: 2, requireHumanReview: false },
    });

    expect(result.status).toBe('completed');
    expect(result.checkpoint.currentNode).toBe(GRAPH_END);
  });

  it('honors the retrieval-round bound and fails closed to review when evidence stays insufficient', async () => {
    const researchAdapters = adapters();
    researchAdapters.gradeEvidence = jest.fn(async () => ({
      sufficient: false,
      gaps: ['Still missing evidence.'],
    }));

    const result = await runResearchGraph(researchAdapters, 'What changed?', {
      policy: { maxRetrievalRounds: 2, requireHumanReview: false },
    });

    expect(result.status).toBe('interrupted');
    expect(result.state.retrievalRound).toBe(2);
    expect(researchAdapters.retrieve).toHaveBeenCalledTimes(2);
  });

  it('keeps one unambiguous snapshot for a refreshed source id', async () => {
    const researchAdapters = adapters();
    researchAdapters.retrieve = jest.fn(async ({ round }) => [source('doc-stable', round)]);
    researchAdapters.gradeEvidence = jest.fn(async ({ sources }) => ({
      sufficient: sources[0]?.contentHash === 'hash-doc-stable-2',
      gaps: sources[0]?.contentHash === 'hash-doc-stable-2' ? [] : ['Refresh the source.'],
    }));

    const result = await runResearchGraph(researchAdapters, 'What changed?', {
      policy: { maxRetrievalRounds: 2, requireHumanReview: true },
    });

    expect(result.state.sources).toHaveLength(1);
    expect(result.state.sources[0]?.contentHash).toBe('hash-doc-stable-2');
  });
});
