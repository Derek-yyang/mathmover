'use client';

import { useState } from 'react';
import CoursewareThreadList from '../dashboard/CoursewareThreadList';

export default function ArchivedCoursewares({ onOpen, onOpenRequest }: {
  onOpen: () => void; onOpenRequest?: (proceed: () => void) => void;
}) {
  // Keep archive menus and nested confirmations in Settings' focus scope.
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  return <section ref={setPortalContainer} aria-labelledby="archived-coursewares-title" className="flex min-h-0 flex-col">
    <header className="mb-4">
      <h3 id="archived-coursewares-title" className="text-base font-semibold text-[var(--mm-text-stone-800)]">归档课件</h3>
      <p className="mt-1 text-sm leading-6 text-[var(--mm-text-stone-600)]">保留对话和画板，可随时打开或取消归档。</p>
    </header>
    <CoursewareThreadList archived onOpen={onOpen} onOpenRequest={onOpenRequest} portalContainer={portalContainer} />
  </section>;
}
