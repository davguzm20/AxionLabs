const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 6000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);
const ALLOWED_IMAGE_EXTENSIONS = /\.(jpe?g|png)$/i;

export async function validateReceiptImage(file: File): Promise<string | null> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type) || !ALLOWED_IMAGE_EXTENSIONS.test(file.name)) {
    return 'Solo aceptamos imágenes JPG o PNG.';
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return 'La imagen supera los 8 MB.';
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<string | null>((resolve) => {
      const image = new Image();
      image.onload = () => {
        if (image.naturalWidth < 640 || image.naturalHeight < 480) {
          resolve('La imagen debe medir al menos 640 × 480 píxeles.');
        } else if (image.naturalWidth > MAX_IMAGE_DIMENSION || image.naturalHeight > MAX_IMAGE_DIMENSION) {
          resolve('La imagen no puede superar los 6000 × 6000 píxeles.');
        } else {
          resolve(null);
        }
      };
      image.onerror = () => resolve('No se pudo abrir la imagen. Elige una foto JPG o PNG válida.');
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
