'use client';

import { ReactNode } from 'react';
import type { Session } from 'next-auth';
import { SessionProvider } from './session-provider';
import { ThemeProvider } from './theme-provider';
import { QueryProvider } from './query-provider';
import { ThemeInitializer } from './theme-initializer';
import { DeploymentReloadGuard } from './deployment-reload-guard';

export function Providers({ children, session }: { children: ReactNode; session: Session | null }) {
  return (
    <SessionProvider session={session}>
      <DeploymentReloadGuard />
      <QueryProvider>
        <ThemeProvider
          attribute="class"
          storageKey="validteam-color-mode"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange={false}
        >
          <ThemeInitializer />
          {children}
        </ThemeProvider>
      </QueryProvider>
    </SessionProvider>
  );
}
