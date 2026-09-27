'use client';

import { useEffect } from 'react';

export function AppUiScope() {
  useEffect(() => {
    document.body.classList.add('app-workbench');

    return () => {
      document.body.classList.remove('app-workbench');
    };
  }, []);

  return null;
}
