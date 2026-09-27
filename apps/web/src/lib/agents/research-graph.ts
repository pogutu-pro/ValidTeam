import {
  GRAPH_END,
  runBoundedGraph,
  type GraphDefinition,
  type GraphRunOptions,
  type GraphRunResult,
} from './graph-runtime';

export type ResearchNodeName =
  | 'plan'
  | 'retrieve'
  | 'grade_evidence'
  | 'synthesize'
  | 'verify_citations'
  | 'human_review';

export type ResearchSourceKind = 'issue' | 'document' | 'web';

export interface ResearchSource {
  id: string;
  kind: ResearchSourceKind;
  title: string;
  uri: string | null;
  excerpt: string;
  retrievedAt: string;
  /** Hash of the exact content snapshot used by the run. */
  contentHash: string;
}

export interface ResearchClaim {
  id: string;
  text: string;
  sourceIds: string[];
  confidence: number;
}

export interface ResearchPlan {
  questions: string[];
  sourceKinds: ResearchSourceKind[];
}

export interface ResearchState {
  question: string;
  plan: ResearchPlan | null;
  sources: ResearchSource[];
  gaps: string[];
  retrievalRound: number;
  answer: string | null;
  claims: ResearchClaim[];
  unresolvedClaimIds: string[];
  evidenceSufficient: boolean | null;
  reviewDecision: 'approved' | 'rejected' | null;
  outcome: 'running' | 'completed' | 'approved' | 'rejected';
}

export interface ResearchAdapters {
  plan: (input: { question: string; signal: AbortSignal }) => Promise<ResearchPlan>;
  retrieve: (input: {
    question: string;
    plan: ResearchPlan;
    gaps: string[];
    round: number;
    signal: AbortSignal;
  }) => Promise<ResearchSource[]>;
  gradeEvidence: (input: {
    question: string;
    plan: ResearchPlan;
    sources: ResearchSource[];
    signal: AbortSignal;
  }) => Promise<{ sufficient: boolean; gaps: string[] }>;
  synthesize: (input: {
    question: string;
    plan: ResearchPlan;
    sources: ResearchSource[];
    signal: AbortSignal;
  }) => Promise<{ answer: string; claims: ResearchClaim[] }>;
  verifyCitations: (input: {
    answer: string;
    claims: ResearchClaim[];
    sources: ResearchSource[];
    signal: AbortSignal;
  }) => Promise<{ unresolvedClaimIds: string[] }>;
}

export interface ResearchGraphPolicy {
  maxRetrievalRounds: number;
  requireHumanReview: boolean;
}

export const DEFAULT_RESEARCH_GRAPH_POLICY: ResearchGraphPolicy = {
  maxRetrievalRounds: 3,
  requireHumanReview: true,
};

export function createInitialResearchState(question: string): ResearchState {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion) {
    throw new Error('Research question is required.');
  }
  return {
    question: normalizedQuestion,
    plan: null,
    sources: [],
    gaps: [],
    retrievalRound: 0,
    answer: null,
    claims: [],
    unresolvedClaimIds: [],
    evidenceSufficient: null,
    reviewDecision: null,
    outcome: 'running',
  };
}

function mergeSources(current: ResearchSource[], incoming: ResearchSource[]): ResearchSource[] {
  // One source id must resolve to exactly one content snapshot in a state.
  // A refreshed retrieval replaces the older snapshot so claim sourceIds stay
  // unambiguous; the content hash still records the exact version synthesized.
  const byId = new Map(current.map((source) => [source.id, source]));
  for (const source of incoming) {
    byId.set(source.id, source);
  }
  return Array.from(byId.values());
}

/**
 * Build the canonical research topology. It is intentionally adapter-based:
 * provider calls, browser retrieval and persistence remain outside the graph,
 * while routing and termination stay testable and deterministic.
 */
export function createResearchGraph(
  adapters: ResearchAdapters,
  policy: ResearchGraphPolicy = DEFAULT_RESEARCH_GRAPH_POLICY
): GraphDefinition<ResearchState, ResearchNodeName> {
  if (!Number.isInteger(policy.maxRetrievalRounds) || policy.maxRetrievalRounds < 1) {
    throw new Error('maxRetrievalRounds must be a positive integer.');
  }

  return {
    version: 'research-v1',
    start: 'plan',
    nodes: {
      plan: {
        routes: ['retrieve'],
        async run({ state, signal }) {
          const plan = await adapters.plan({ question: state.question, signal });
          return {
            state: { ...state, plan },
            next: 'retrieve',
            progressKey: `plan:${plan.questions.join('|')}`,
          };
        },
      },
      retrieve: {
        routes: ['grade_evidence'],
        async run({ state, signal }) {
          if (!state.plan) throw new Error('Research plan is missing.');
          const round = state.retrievalRound + 1;
          const sources = await adapters.retrieve({
            question: state.question,
            plan: state.plan,
            gaps: state.gaps,
            round,
            signal,
          });
          const merged = mergeSources(state.sources, sources);
          return {
            state: { ...state, sources: merged, retrievalRound: round },
            next: 'grade_evidence',
            progressKey: `retrieve:${round}:${merged.length}`,
          };
        },
      },
      grade_evidence: {
        routes: ['retrieve', 'synthesize'],
        async run({ state, signal }) {
          if (!state.plan) throw new Error('Research plan is missing.');
          const grade = await adapters.gradeEvidence({
            question: state.question,
            plan: state.plan,
            sources: state.sources,
            signal,
          });
          const retrieveAgain =
            !grade.sufficient && state.retrievalRound < policy.maxRetrievalRounds;
          return {
            state: { ...state, gaps: grade.gaps, evidenceSufficient: grade.sufficient },
            next: retrieveAgain ? 'retrieve' : 'synthesize',
            progressKey: `grade:${state.retrievalRound}:${grade.sufficient}:${grade.gaps.join('|')}`,
          };
        },
      },
      synthesize: {
        routes: ['verify_citations'],
        async run({ state, signal }) {
          if (!state.plan) throw new Error('Research plan is missing.');
          const synthesis = await adapters.synthesize({
            question: state.question,
            plan: state.plan,
            sources: state.sources,
            signal,
          });
          return {
            state: {
              ...state,
              answer: synthesis.answer,
              claims: synthesis.claims,
              unresolvedClaimIds: [],
            },
            next: 'verify_citations',
            progressKey: `synthesis:${synthesis.claims.length}:${synthesis.answer.length}`,
          };
        },
      },
      verify_citations: {
        routes: ['retrieve', 'human_review', GRAPH_END],
        async run({ state, signal }) {
          if (!state.answer) throw new Error('Research answer is missing.');
          const verification = await adapters.verifyCitations({
            answer: state.answer,
            claims: state.claims,
            sources: state.sources,
            signal,
          });
          const verifiedState: ResearchState = {
            ...state,
            unresolvedClaimIds: verification.unresolvedClaimIds,
            gaps: verification.unresolvedClaimIds.map(
              (claimId) => state.claims.find((claim) => claim.id === claimId)?.text ?? claimId
            ),
          };
          if (
            verification.unresolvedClaimIds.length > 0 &&
            state.retrievalRound < policy.maxRetrievalRounds
          ) {
            return {
              state: verifiedState,
              next: 'retrieve',
              progressKey: `verify:${state.retrievalRound}:${verification.unresolvedClaimIds.join('|')}`,
            };
          }
          const needsReview =
            policy.requireHumanReview ||
            !verifiedState.evidenceSufficient ||
            verification.unresolvedClaimIds.length > 0;
          return {
            state: needsReview ? verifiedState : { ...verifiedState, outcome: 'completed' },
            next: needsReview ? 'human_review' : GRAPH_END,
            progressKey: `verify:${state.retrievalRound}:resolved:${verification.unresolvedClaimIds.length}`,
          };
        },
      },
      human_review: {
        routes: ['human_review', GRAPH_END],
        async run({ state }) {
          if (state.reviewDecision === null) {
            return {
              state,
              resumeAt: 'human_review',
              interrupt: {
                kind: 'human_review',
                reason: 'A human must approve or reject the grounded answer.',
                payload: {
                  sourceCount: state.sources.length,
                  claimCount: state.claims.length,
                  unresolvedClaimIds: state.unresolvedClaimIds,
                },
              },
              progressKey: `review:pending:${state.answer?.length ?? 0}`,
            };
          }
          return {
            state: {
              ...state,
              outcome: state.reviewDecision,
            },
            next: GRAPH_END,
            progressKey: `review:${state.reviewDecision}`,
          };
        },
      },
    },
  };
}

export function runResearchGraph(
  adapters: ResearchAdapters,
  question: string,
  options: GraphRunOptions<ResearchState, ResearchNodeName> & {
    policy?: ResearchGraphPolicy;
  } = {}
): Promise<GraphRunResult<ResearchState, ResearchNodeName>> {
  const { policy, ...runtimeOptions } = options;
  return runBoundedGraph(
    createResearchGraph(adapters, policy),
    createInitialResearchState(question),
    runtimeOptions
  );
}
