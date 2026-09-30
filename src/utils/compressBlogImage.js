const MAX_WIDTH = 1200;
const JPEG_QUALITY = 0.85;

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Could not compress image.'));
        else resolve(blob);
      },
      'image/jpeg',
      quality
    );
  });
}

function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image file.'));
    };
    img.src = url;
  });
}

function jpegName(originalName) {
  const base = String(originalName || 'image').replace(/\.[^.]+$/, '');
  return `${base || 'image'}.jpg`;
}

export async function compressBlogImage(file) {
  const source = await loadImage(file);
  try {
    const srcW = source.width;
    const srcH = source.height;
    if (!srcW || !srcH) throw new Error('Could not read image file.');

    const scale = srcW > MAX_WIDTH ? MAX_WIDTH / srcW : 1;
    const width = Math.max(1, Math.round(srcW * scale));
    const height = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not compress image.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, JPEG_QUALITY);
    return new File([blob], jpegName(file.name), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } finally {
    if (source && typeof source.close === 'function') source.close();
  }
}
