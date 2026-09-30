/* Getting a phone photo small enough to send over wifi.
 *
 * A modern phone camera produces 3-8 MB per shot, which is slow to upload and
 * far more than a vision model can use: it reads a panel the same at 1600
 * pixels as at 4000. The browser does this work because it is the only place
 * that can — the backend has no image library, and adding one to shrink a file
 * the phone already has in memory would be silly. */

/** Longest edge of the image that is actually sent, in pixels. */
export const MAX_EDGE = 1600;

/** JPEG quality for the upload: high enough to read print, small enough to send. */
export const JPEG_QUALITY = 0.8;

export async function downscaleToJpeg(
  file: File,
  maxEdge = MAX_EDGE,
  quality = JPEG_QUALITY,
): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    // `imageOrientation: 'from-image'` applies the EXIF rotation, so a photo
    // taken sideways does not arrive at the model upside down.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('That file could not be read as a photo.');
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('That file could not be read as a photo.');
  }
  // A white background first: a transparent PNG saved as JPEG would otherwise
  // come out with black where the transparency was.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
  if (!blob) {
    throw new Error('That file could not be read as a photo.');
  }
  return blob;
}
