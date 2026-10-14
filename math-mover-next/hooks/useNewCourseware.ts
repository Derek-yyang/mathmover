'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAgentRuntimeState } from '@/components/dashboard/AgentRuntimeState';

export function useNewCourseware() {
  const router = useRouter();
  const { busy } = useAgentRuntimeState();
  return useCallback(() => {
    // Keep the running Agent attached to its original page and canvas.
    // Open synchronously in the click handler to preserve browser user activation.
    if (busy) window.open('/dashboard?action=new', '_blank', 'noopener,noreferrer');
    else router.push('/dashboard?action=new');
  }, [busy, router]);
}
