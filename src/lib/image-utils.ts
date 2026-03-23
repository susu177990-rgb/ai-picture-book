// ============================================================
// Image Utilities - Base64 Conversion & File Handling
// ============================================================

/**
 * 规范化 API 返回的图片数据为可用的 data URL。
 * 修复：数据头缺失、换行/空格、Base64 填充、非法字符等导致的加载失败。
 */
export function normalizeImageDataUrl(input: string): string {
  if (!input || typeof input !== 'string') return '';

  let b64 = input.trim().replace(/[\n\r\t\s]/g, '');
  if (!b64) return '';

  // 若已有 data: 前缀，提取 MIME 和纯 base64
  let mime = 'image/jpeg';
  if (b64.toLowerCase().startsWith('data:')) {
    const commaIdx = b64.indexOf(',');
    if (commaIdx > 0) {
      const header = b64.slice(0, commaIdx);
      const mimeMatch = header.match(/data:([^;]+)/);
      if (mimeMatch) mime = mimeMatch[1].trim();
      b64 = b64.slice(commaIdx + 1);
    }
  }

  // 移除可能混入的 data URL 片段（如从 Markdown 提取时）
  b64 = b64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');

  // 支持 Base64url（部分 API 用 - 和 _ 替代 + 和 /）
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  // 仅保留合法 Base64 字符
  b64 = b64.replace(/[^A-Za-z0-9+/=]/g, '');

  // 补齐 Base64 填充（长度需为 4 的倍数）
  const pad = b64.length % 4;
  if (pad > 0) b64 += '='.repeat(4 - pad);

  if (!b64) return '';

  return `data:${mime};base64,${b64}`;
}

/**
 * 将 Base64/data URL 转为 Blob URL 用于显示。
 * 避免浏览器对 data URL 的 ~2MB 长度限制导致的加载失败。
 */
export function toBlobUrl(input: string): string | null {
  const dataUrl = normalizeImageDataUrl(input);
  if (!dataUrl) return null;
  try {
    const blob = base64ToBlob(dataUrl);
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/**
 * 更稳妥地加载 base64 图片：
 * 1. 优先转 Blob URL，避免超长 data URL 在浏览器里卡住不回调
 * 2. 增加超时，防止缩略图/格式转换一直 pending
 */
function loadImageElement(input: string, timeoutMs = 12000): Promise<HTMLImageElement> {
  const normalized = normalizeImageDataUrl(input) || input;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const blobUrl = toBlobUrl(normalized);
    const src = blobUrl || normalized;
    let settled = false;

    const cleanup = () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Image load timeout'));
    }, timeoutMs);

    img.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(img);
      cleanup();
    };

    img.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      cleanup();
      reject(new Error('Image load failed'));
    };

    img.src = src;
  });
}

/**
 * 将 File 对象转换为 Base64 data URL
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 将 Base64 data URL 转换为 Blob
 */
export function base64ToBlob(base64: string): Blob {
  // Handle both with and without data URL prefix
  const parts = base64.split(',');
  const mimeMatch = parts[0]?.match(/:(.*?);/);
  const mime = mimeMatch?.[1] ?? 'image/png';
  const data = parts.length > 1 ? parts[1] : parts[0];

  const byteString = atob(data);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);

  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }

  return new Blob([ab], { type: mime });
}

/** 缩略图缓存：避免重复生成，用内容哈希作 key 防止不同图错用 */
const thumbnailCache = new Map<string, string>();

/** 并发限制：同时最多 2 个缩略图生成，避免主线程被多张大图解码阻塞 */
const THUMBNAIL_CONCURRENCY = 2;
let thumbnailActive = 0;
const thumbnailQueue: Array<() => void> = [];

function runNextThumbnail(): void {
  if (thumbnailActive >= THUMBNAIL_CONCURRENCY || thumbnailQueue.length === 0) return;
  thumbnailActive++;
  const next = thumbnailQueue.shift()!;
  next();
}

function thumbnailDone(): void {
  thumbnailActive--;
  runNextThumbnail();
}

/** 对 base64 做快速哈希，确保不同图片不会共用缓存 */
function hashBase64(b64: string): string {
  let h = 0;
  const step = Math.max(1, Math.floor(b64.length / 500));
  for (let i = 0; i < b64.length; i += step) {
    h = ((h << 5) - h + b64.charCodeAt(i)) | 0;
  }
  return `${h.toString(36)}_${b64.length}`;
}

/**
 * 用 Canvas 将原图缩成缩略图（客户端生成，不调用 API）。
 * 并发限制 2，避免同时解码多张大图导致卡顿。
 */
export function createImageThumbnail(
  fullBase64: string,
  maxWidth = 1200,
  maxHeight = 1200,
): Promise<string> {
  const normalized = normalizeImageDataUrl(fullBase64) || fullBase64;
  const cacheKey = `${hashBase64(normalized)}_${maxWidth}_${maxHeight}`;
  const cached = thumbnailCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const run = () => {
      loadImageElement(normalized)
        .then((img) => {
          try {
            let w = img.width;
            let h = img.height;
            if (w > maxWidth || h > maxHeight) {
              const r = Math.min(maxWidth / w, maxHeight / h);
              w = Math.round(w * r);
              h = Math.round(h * r);
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              thumbnailDone();
              reject(new Error('Canvas context unavailable'));
              return;
            }
            ctx.drawImage(img, 0, 0, w, h);
            const mime = normalized.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
            const quality = mime === 'image/png' ? undefined : 0.95;
            const dataUrl = canvas.toDataURL(mime, quality);
            thumbnailCache.set(cacheKey, dataUrl);
            thumbnailDone();
            resolve(dataUrl);
          } catch (e) {
            thumbnailDone();
            reject(e);
          }
        })
        .catch((e) => {
          thumbnailDone();
          reject(e);
        });
    };

    thumbnailQueue.push(run);
    runNextThumbnail();
  });
}

/**
 * 分页图格式转换：不降低画质，仅做格式转换与体积最小化。
 * 保持原始尺寸，绝不缩放。
 */
async function convertPageImageFormat(base64: string): Promise<string> {
  const normalized = normalizeImageDataUrl(base64) || base64;
  const img = await loadImageElement(normalized);
  const w = img.width;
  const h = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context unavailable');
  }
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.95);
}

/**
 * 将已通过的分页图拼成宫格图（全部分页宫格图）。
 * 分页图不缩放，仅格式转换。
 */
export async function createPageGridImage(pageImages: string[]): Promise<string> {
  if (pageImages.length === 0) {
    throw new Error('无分页图可拼接');
  }

  const QUALITY = 0.95;
  const COLS = 5; // 一行 5 个图，5*x 逻辑
  const GAP = 4;

  const converted = await Promise.all(
    pageImages.map((img) => convertPageImageFormat(img)),
  );

  const loaded: { img: HTMLImageElement; w: number; h: number }[] = [];
  for (const dataUrl of converted) {
    const img = await loadImageElement(dataUrl);
    loaded.push({ img, w: img.width, h: img.height });
  }

  const cellW = Math.max(...loaded.map((l) => l.w));
  const cellH = Math.max(...loaded.map((l) => l.h));
  const rows = Math.ceil(loaded.length / COLS);
  const totalW = COLS * cellW + (COLS - 1) * GAP;
  const totalH = rows * cellH + (rows - 1) * GAP;

  // 先计算目标尺寸，避免超出浏览器 Canvas 限制（约 16K）导致黑屏
  const MAX_4K = 4096;
  const scale = totalW > MAX_4K || totalH > MAX_4K
    ? Math.min(MAX_4K / totalW, MAX_4K / totalH)
    : 1;
  const outW = Math.round(totalW * scale);
  const outH = Math.round(totalH * scale);
  const cellWOut = Math.round(cellW * scale);
  const cellHOut = Math.round(cellH * scale);
  const gapOut = Math.max(1, Math.round(GAP * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, outW, outH);

  for (let i = 0; i < loaded.length; i++) {
    const { img, w, h } = loaded[i];
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = col * (cellWOut + gapOut);
    const y = row * (cellHOut + gapOut);
    ctx.drawImage(img, 0, 0, w, h, x, y, cellWOut, cellHOut);
  }

  return canvas.toDataURL('image/jpeg', QUALITY);
}


/**
 * 将 Base64 图片下载为文件
 */
export function downloadBase64Image(base64: string, filename: string): void {
  const blob = base64ToBlob(base64);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 将多张 Base64 图片打包为 ZIP 并下载
 */
export async function downloadAsZip(
  images: { filename: string; base64: string }[],
): Promise<void> {
  // 动态导入 fflate 进行 ZIP 压缩（轻量级，无需外部依赖）
  // 若依赖不可用，则逐张下载
  try {
    const { zipSync } = await import('fflate');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const files: Record<string, any> = {};
    for (const img of images) {
      const blob = base64ToBlob(img.base64);
      const buffer = await blob.arrayBuffer();
      files[img.filename] = new Uint8Array(buffer);
    }

    const zipped = zipSync(files);
    const zipBlob = new Blob([zipped as unknown as BlobPart], {
      type: 'application/zip',
    });
    const url = URL.createObjectURL(zipBlob);

    const a = document.createElement('a');
    a.href = url;
    a.download = '绘本成品.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    // Fallback: download one by one
    for (const img of images) {
      downloadBase64Image(img.base64, img.filename);
    }
  }
}
