import type { GeoGebraApi } from '@/components/dashboard/types';

export function getCoursewarePNG(
  api: Pick<GeoGebraApi, 'getPNGBase64'>,
  fallback: () => string | null,
): string {
  // 2× resolution; leaving DPI unset avoids the expensive DPI conversion.
  const image = api.getPNGBase64?.(2, false) || fallback();
  if (!image) throw new Error('无法获取画板截图。');
  return image.startsWith('data:image/png;') ? image : `data:image/png;base64,${image}`;
}
