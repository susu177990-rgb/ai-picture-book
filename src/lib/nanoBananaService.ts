// ============================================================
// Nano-banana-2 Image Service - DALL-E generations 格式（推荐）
// URL: {baseUrl}/v1/images/generations
// 支持参考图数组 image、原生 aspect_ratio，比例与参考还原更好
// 参考: https://gpt-best.apifox.cn/api-341817446
// ============================================================

import type { AspectRatioType, ImageSizeType } from '@/types';

/** 与 geminiService 的 ImageApiConfig 结构一致，避免循环依赖 */
interface ImageApiConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

/** 与 geminiService 的 ImageProtocolConfig 结构一致 */
interface ImageProtocolConfig {
  aspectRatio: AspectRatioType;
  imageSize: ImageSizeType;
}

/** 将 data URL 转为 API 可接受的格式（data URL 或纯 base64） */
function toImageInput(dataUrl: string): string {
  if (!dataUrl || typeof dataUrl !== 'string') return '';
  const trimmed = dataUrl.trim();
  if (trimmed.startsWith('data:')) {
    return trimmed;
  }
  if (/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
}

/** 映射为 generations API 支持的 aspect_ratio；19:7 映射为 21:9（API 不支持 19:7） */
function mapAspectRatio(ratio: AspectRatioType): string | undefined {
  if (ratio === 'auto') return undefined;
  if (ratio === '19:7') return '21:9';
  const supported = ['1:1', '1:2', '2:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '4:5', '5:4', '21:9'];
  return supported.includes(ratio) ? ratio : undefined;
}

/**
 * Nano-banana-2 图生图（DALL-E generations 格式，推荐对接）
 * 支持多张参考图、原生 aspect_ratio，比例与参考还原更准确
 */
export async function nanoBananaGenerations(
  prompt: string,
  refImages: string[],
  apiConfig: ImageApiConfig,
  protocolConfig: ImageProtocolConfig,
): Promise<string[]> {
  const { baseUrl, apiKey } = apiConfig;
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  const url = `${cleanBaseUrl}/v1/images/generations`;

  const imageInputs = refImages
    .map(toImageInput)
    .filter(Boolean);

  const body: Record<string, unknown> = {
    model: 'nano-banana-2',
    prompt: prompt.trim() || 'Generate an image based on the reference.',
    response_format: 'b64_json',
  };

  if (imageInputs.length > 0) {
    body.image = imageInputs;
  }

  const aspectRatio = mapAspectRatio(protocolConfig.aspectRatio);
  if (aspectRatio) {
    body.aspect_ratio = aspectRatio;
  }

  if (protocolConfig.imageSize) {
    body.image_size = protocolConfig.imageSize;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`API 错误 (${response.status}): ${errBody}`);
  }

  const data = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };

  const images: string[] = [];
  const items = data.data ?? [];

  for (const item of items) {
    if (item.b64_json) {
      images.push(`data:image/png;base64,${item.b64_json}`);
    } else if (item.url) {
      try {
        const imgRes = await fetch(item.url);
        if (imgRes.ok) {
          const imgBlob = await imgRes.blob();
          const b64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () =>
              resolve(typeof reader.result === 'string' ? reader.result : '');
            reader.onerror = reject;
            reader.readAsDataURL(imgBlob);
          });
          if (b64) images.push(b64);
        }
      } catch {
        // 跨域或网络错误时跳过
      }
    }
  }

  return images;
}
