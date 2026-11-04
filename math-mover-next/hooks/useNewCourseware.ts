'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

export function useNewCourseware() {
  const router = useRouter();
  return useCallback(() => {
    router.push('/dashboard?action=new');
  }, [router]);
}
