import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useUser } from './use-user';

interface PresenceUser {
  userId: string;
  userName: string;
  userEmail: string;
  lastSeen: number;
}

export function usePresence(issueId: string | null) {
  const { user } = useUser();
  const t = useTranslations('hookErrors.presence');
  const [isActive, setIsActive] = useState(true);

  // Fetch active users
  const { data: presenceData } = useQuery({
    queryKey: ['presence', issueId],
    queryFn: async () => {
      if (!issueId) return { users: [] };
      const response = await fetch(`/api/presence/${issueId}`);
      if (!response.ok) {
        throw new Error(t('fetch'));
      }
      return response.json() as Promise<{ users: PresenceUser[] }>;
    },
    enabled: !!issueId,
    refetchInterval: 10000, // Poll every 10 seconds
  });

  // Update presence mutation
  const { mutate: updatePresence } = useMutation({
    mutationFn: async (issueId: string) => {
      const response = await fetch(`/api/presence/${issueId}`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(t('update'));
      }
      return response.json();
    },
  });

  // Remove presence mutation
  const { mutate: removePresence } = useMutation({
    mutationFn: async (issueId: string) => {
      const response = await fetch(`/api/presence/${issueId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(t('remove'));
      }
      return response.json();
    },
  });

  // Update presence on mount and periodically
  useEffect(() => {
    if (!issueId || !user || !isActive) return;

    // Initial presence update
    updatePresence(issueId);

    // Update presence every 30 seconds
    const interval = setInterval(() => {
      if (isActive) {
        updatePresence(issueId);
      }
    }, 30000);

    return () => {
      clearInterval(interval);
    };
  }, [issueId, user, isActive, updatePresence]);

  // Remove presence on unmount
  useEffect(() => {
    if (!issueId || !user) return;

    return () => {
      removePresence(issueId);
    };
  }, [issueId, user, removePresence]);

  // Handle visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsActive(!document.hidden);

      if (!document.hidden && issueId && user) {
        // Update presence when tab becomes visible
        updatePresence(issueId);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [issueId, user, updatePresence]);

  // Filter out current user from presence list
  const otherUsers = presenceData?.users.filter((u) => u.userId !== user?.id) || [];

  return {
    users: otherUsers,
    count: otherUsers.length,
  };
}
