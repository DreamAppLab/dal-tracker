import { compressBlogImage } from './compressBlogImage';

const MAX_BYTES = 2.5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

export async function uploadBlogImage(file) {
  if (!file) throw new Error('Choose an image to upload.');
  const type = String(file.type || '').toLowerCase();
  if (type && !ALLOWED.includes(type)) {
    throw new Error('Use a JPG, PNG, GIF, or WebP image.');
  }

  const compressed = await compressBlogImage(file);
  if (compressed.size > MAX_BYTES) {
    throw new Error('Image must be 2.5MB or smaller.');
  }

  const data = await fileToBase64(compressed);
  const res = await fetch('/api/blog/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: compressed.name,
      contentType: 'image/jpeg',
      data,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.url) {
    throw new Error(json.detail || json.error || 'Image upload failed.');
  }
  return json.url;
}
