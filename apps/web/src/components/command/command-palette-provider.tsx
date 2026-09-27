'use client';

import * as React from 'react';

import { CommandPalette } from '@/components/command/command-palette';
import {
  CommandPaletteContext,
  type CommandPaletteContextValue,
} from '@/lib/command/use-command-palette';

interface CommandPaletteProviderProps {
  children: React.ReactNode;
  hasWorkspaceAccess?: boolean;
  defaultOrganizationId?: string | null;
}

/**
 * Mounts the global Power-K command palette and exposes imperative
 * controls (`open` / `close` / `setOpen`) via React context.
 *
 * Behavior:
 *  - Cmd+K (macOS) / Ctrl+K (Win/Linux) toggles the palette.
 *  - ESC is handled inside the dialog (Radix) and via the chord state
 *    machine in <CommandPalette/>.
 *  - The keydown listener intentionally lives at `window` so it works
 *    no matter which element currently has focus.
 */
export function CommandPaletteProvider({
  children,
  hasWorkspaceAccess = true,
  defaultOrganizationId = null,
}: CommandPaletteProviderProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);

  const rememberFocus = React.useCallback(() => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body) {
      returnFocusRef.current = activeElement;
    }
  }, []);

  const open = React.useCallback(() => {
    rememberFocus();
    setIsOpen(true);
  }, [rememberFocus]);
  const close = React.useCallback(() => setIsOpen(false), []);
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (next) rememberFocus();
      setIsOpen(next);
    },
    [rememberFocus]
  );

  const restoreFocus = React.useCallback<
    NonNullable<React.ComponentProps<typeof CommandPalette>['onCloseAutoFocus']>
  >((event) => {
    const returnTarget = returnFocusRef.current;
    returnFocusRef.current = null;

    if (returnTarget?.isConnected) {
      event.preventDefault();
      returnTarget.focus({ preventScroll: true });
    }
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isToggle = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (!isToggle) return;

      // Don't fight the browser when the user is in some other shortcut
      // combination (e.g. Cmd+Shift+K is "clear console" in DevTools).
      if (event.shiftKey || event.altKey) return;

      event.preventDefault();
      if (!isOpen) rememberFocus();
      setIsOpen((previous) => !previous);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, rememberFocus]);

  const value = React.useMemo<CommandPaletteContextValue>(
    () => ({ isOpen, open, close, setOpen }),
    [isOpen, open, close, setOpen]
  );

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <CommandPalette
        open={isOpen}
        onOpenChange={setOpen}
        onCloseAutoFocus={restoreFocus}
        hasWorkspaceAccess={hasWorkspaceAccess}
        defaultOrganizationId={defaultOrganizationId}
      />
    </CommandPaletteContext.Provider>
  );
}
