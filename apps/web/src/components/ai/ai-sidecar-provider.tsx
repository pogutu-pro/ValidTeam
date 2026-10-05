'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/hooks/use-toast';
import { useOrganization } from '@/lib/hooks/use-organization';
import {
  SidecarContext,
  type SidecarContextValue,
  type SidecarCitation,
  type SidecarEntity,
  type SidecarMessage,
} from '@/lib/ai/sidecar-context';
import { AiSidecar } from './ai-sidecar';
import { AiDisclosureModal } from './ai-disclosure-modal';

type AskStreamEvent =
  | { type: 'token'; text?: string }
  | { type: 'error'; error?: string }
  | { type: 'done' }
  | { type: 'sources'; sources?: unknown[] }
  | { type: 'citations'; citations?: SidecarCitation[]; unresolved?: string[] };

function parseAskFrame(frame: string): AskStreamEvent | null {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .join('\n');

  if (!data || data === '[DONE]') return null;

  try {
    return JSON.parse(data) as AskStreamEvent;
  } catch {
    return null;
  }
}

async function consumeAskStream(
  response: Response,
  onToken: (text: string) => void
): Promise<{ answer: string; citations: SidecarCitation[]; unresolved: string[] }> {
  if (!response.ok || !response.body) {
    throw new Error('ask_request_failed');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let citations: SidecarCitation[] = [];
  let unresolved: string[] = [];

  const consumeFrames = (flush: boolean) => {
    const frames = buffer.split(/\r?\n\r?\n/);
    if (!flush) buffer = frames.pop() ?? '';
    else buffer = '';

    for (const frame of frames) {
      const event = parseAskFrame(frame);
      if (!event) continue;
      if (event.type === 'error') throw new Error('ask_stream_failed');
      if (event.type === 'token' && event.text) {
        answer += event.text;
        onToken(event.text);
      } else if (event.type === 'citations') {
        citations = Array.isArray(event.citations) ? event.citations : [];
        unresolved = Array.isArray(event.unresolved) ? event.unresolved : [];
      }
    }
  };

  let streamDone = false;
  while (!streamDone) {
    const { value, done } = await reader.read();
    if (done) {
      streamDone = true;
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    consumeFrames(false);
  }

  buffer += decoder.decode();
  if (buffer.trim()) consumeFrames(true);
  return { answer, citations, unresolved };
}

interface AiSidecarProviderProps {
  children: ReactNode;
  enabled?: boolean;
}

/**
 * Provides the AI Sidecar global state (open/closed, current entity,
 * message thread) and mounts the floating <AiSidecar /> panel once,
 * above any page layout.
 *
 * Keyboard: Cmd+J (macOS) / Ctrl+J (Win/Linux) toggles. ESC closes
 * (handled inside <AiSidecar />).
 */
export function AiSidecarProvider({ children, enabled = true }: AiSidecarProviderProps) {
  if (!enabled) {
    return <>{children}</>;
  }

  return <AiSidecarProviderInner>{children}</AiSidecarProviderInner>;
}

function AiSidecarProviderInner({ children }: { children: ReactNode }) {
  const t = useTranslations('aiFeatures');
  const tErrors = useTranslations('errorPages');
  const { toast } = useToast();
  const currentOrganizationId = useOrganization((state) => state.currentOrganizationId);
  const [open, setOpenState] = useState(false);
  const [entity, setEntity] = useState<SidecarEntity | null>(null);
  const [messages, setMessages] = useState<SidecarMessage[]>([]);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
  }, []);

  const toggle = useCallback(() => {
    setOpenState((prev) => !prev);
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
  }, []);

  // Cmd+J / Ctrl+J global listener.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isToggle =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        (event.key === 'j' || event.key === 'J');
      if (!isToggle) return;

      // Don't intercept if user is composing in a text field unless they
      // really meant the shortcut (Cmd/Ctrl is held — most browsers treat
      // Cmd+J as reserved anyway, so this is safe).
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  const sendMessage = useCallback(
    async (content: string, organizationIdOverride?: string | null) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const userMessage: SidecarMessage = {
        id:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `u_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        role: 'user',
        content: trimmed,
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);

      const assistantId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `a_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '', createdAt: Date.now() },
      ]);

      try {
        // The command palette can open before this provider has rerendered
        // after organization-store hydration. Prefer the organization captured
        // by that command, then read the live store before falling back to the
        // render snapshot so a valid first request is never dropped as a race.
        const organizationId =
          organizationIdOverride ??
          useOrganization.getState().currentOrganizationId ??
          currentOrganizationId;
        if (!organizationId) throw new Error('ask_organization_required');
        const projectId = entity?.kind === 'project' ? entity.id : undefined;
        const response = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            query: trimmed,
            organizationId,
            ...(projectId ? { projectId } : {}),
          }),
        });

        const result = await consumeAskStream(response, (text) => {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId
                ? { ...message, content: `${message.content}${text}` }
                : message
            )
          );
        });

        if (!result.answer.trim()) throw new Error('ask_empty_response');
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  citations: result.citations,
                  unresolvedCitations: result.unresolved,
                }
              : message
          )
        );
      } catch {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId ? { ...message, content: t('assist.assistFailed') } : message
          )
        );
        toast({
          title: t('assist.assistFailed'),
          description: tErrors('error.description'),
        });
      }
    },
    [currentOrganizationId, entity, toast, t, tErrors]
  );

  // The command palette emits this event when the user chooses its Ask AI
  // action. Keep the two entry points on the same sidecar thread instead of
  // closing the palette and silently dropping the prompt.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onAskAi = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          prompt?: unknown;
          organizationId?: unknown;
        }>
      ).detail;
      const prompt = detail?.prompt;
      if (typeof prompt !== 'string' || !prompt.trim()) return;
      const organizationId =
        typeof detail?.organizationId === 'string' ? detail.organizationId : undefined;

      setOpenState(true);
      void sendMessage(prompt, organizationId);
    };

    window.addEventListener('validteam:ask-ai', onAskAi);
    return () => window.removeEventListener('validteam:ask-ai', onAskAi);
  }, [sendMessage]);

  const value = useMemo<SidecarContextValue>(
    () => ({
      open,
      setOpen,
      toggle,
      entity,
      setEntity,
      messages,
      sendMessage,
      clear,
    }),
    [open, setOpen, toggle, entity, messages, sendMessage, clear]
  );

  return (
    <SidecarContext.Provider value={value}>
      {children}
      <AiSidecar />
      {/* Versioned product-transparency notice. Self-gates on
          the current disclosure version + per-user acknowledgement. */}
      <AiDisclosureModal />
    </SidecarContext.Provider>
  );
}
