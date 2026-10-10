export interface ImageTransform { scale: number; x: number; y: number }
export interface Size { width: number; height: number }

export function fitImage(image: Size, viewport: Size): number {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1;
  return Math.min(1, viewport.width / image.width, viewport.height / image.height);
}

export function constrainImage(transform: ImageTransform, image: Size, viewport: Size): ImageTransform {
  const scale = Math.max(fitImage(image, viewport), Math.min(8, transform.scale));
  const boundX = Math.max(0, (image.width * scale - viewport.width) / 2);
  const boundY = Math.max(0, (image.height * scale - viewport.height) / 2);
  return { scale, x: Math.max(-boundX, Math.min(boundX, transform.x)), y: Math.max(-boundY, Math.min(boundY, transform.y)) };
}

/** Zoom around the cursor, not around the image's origin. */
export function zoomImage(transform: ImageTransform, scale: number, point: { x: number; y: number }, image: Size, viewport: Size): ImageTransform {
  const nextScale = Math.max(fitImage(image, viewport), Math.min(8, scale));
  const ratio = nextScale / transform.scale;
  return constrainImage({ scale: nextScale, x: point.x - (point.x - transform.x) * ratio,
    y: point.y - (point.y - transform.y) * ratio }, image, viewport);
}
