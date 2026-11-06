import { notFound } from 'next/navigation';
import PreviewClient from './PreviewClient';

// Local visual review only. This route is unavailable in a production build.
export default function WorkflowPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <PreviewClient />;
}
