/* ------------------------------------------------------------------
   Le logo est un SVG (net à toutes les tailles dans l'interface).
   Pour le PDF il faut du JPEG : on le rastérise une fois sur fond
   blanc, puis on garde le résultat en mémoire — un rapport de 8
   photos ne repasse pas 8 fois par le canvas.
   ------------------------------------------------------------------ */

let cachedSvg = null;
const cachedJpeg = new Map();

export async function logoSvgText() {
  if (cachedSvg) return cachedSvg;
  try {
    const r = await fetch('./logo.svg');
    cachedSvg = await r.text();
  } catch { cachedSvg = null; }
  return cachedSvg;
}

export async function logoDataUrl() {
  const svg = await logoSvgText();
  if (!svg) return null;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export async function logoJpeg(w = 560, h = 206) {
  const key = `${w}x${h}`;
  if (cachedJpeg.has(key)) return cachedJpeg.get(key);
  const url = await logoDataUrl();
  if (!url) return null;
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej;
      i.src = url;
    });
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    cachedJpeg.set(key, bytes);
    return bytes;
  } catch { return null; }
}
