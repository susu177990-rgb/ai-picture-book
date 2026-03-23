// ============================================================
// Gemini Image Service - Google Gemini 原生 generateContent
// 按 API架构报告.md 实现
// ============================================================

import type { AspectRatioType, ImageSizeType } from '@/types';
import { nanoBananaGenerations } from '@/lib/nanoBananaService';

export interface ImageApiConfig {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

export interface ImageProtocolConfig {
  aspectRatio: AspectRatioType;
  imageSize: ImageSizeType;
}

/** 报告 3.3：auto 时不传 aspectRatio；19:7 映射为 21:9（API 不支持 19:7） */
const getApiSupportedRatio = (
  ratio: AspectRatioType,
): string | undefined => {
  if (ratio === 'auto') return undefined;
  if (ratio === '19:7') return '21:9';
  return ratio;
};

/** 解析 data URL 为 inlineData 格式 */
function parseDataUrlToInlineData(
  url: string,
): { mimeType: string; data: string } | null {
  if (!url || typeof url !== 'string') return null;
  let b64 = url.trim().replace(/[\n\r\t\s]/g, '');
  if (!b64) return null;
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
  b64 = b64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
  b64 = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  if (!b64) return null;
  return { mimeType: mime, data: b64 };
}

/** 报告 2.3：安全设置，全部 BLOCK_NONE */
const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
];

/**
 * 报告 2.2：Google Gemini 原生接口
 * URL: {baseUrl}/v1beta/models/{modelName}:generateContent?key={apiKey}
 */
async function generateViaGoogleNative(
  prompt: string,
  refImages: string[],
  apiConfig: ImageApiConfig,
  protocolConfig: ImageProtocolConfig,
): Promise<string[]> {
  const { baseUrl, apiKey, modelName } = apiConfig;
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  const url = `${cleanBaseUrl}/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

  for (const img of refImages) {
    const parsed = parseDataUrlToInlineData(img);
    if (parsed) parts.push({ inlineData: parsed });
  }
  if (prompt.trim()) {
    parts.push({ text: prompt.trim() });
  }
  if (parts.length === 0) {
    throw new Error('生图请求缺少有效内容（需至少包含文字或图片）');
  }

  const aspectRatioValue = getApiSupportedRatio(protocolConfig.aspectRatio);
  const imageConfig: Record<string, string> = {
    imageSize: protocolConfig.imageSize,
  };
  if (aspectRatioValue) {
    imageConfig.aspectRatio = aspectRatioValue;
  }

  const body = {
    contents: [{ role: 'user', parts }],
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig,
    },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'x-goog-api-key': apiKey,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`API 错误 (${response.status}): ${errBody}`);
  }

  const data = await response.json();
  const responseParts = data.candidates?.[0]?.content?.parts ?? [];
  const images: string[] = [];
  for (const part of responseParts) {
    const raw = part.inlineData ?? part.inline_data;
    if (raw?.data) {
      const mime = raw.mimeType ?? raw.mime_type ?? 'image/jpeg';
      images.push(`data:${mime};base64,${raw.data}`);
    }
  }
  return images;
}

/**
 * 报告 2.1：入口函数 generateImage
 * 校验 baseUrl、modelName、apiKey 必须存在
 */
export async function generateImage(
  prompt: string,
  refImages: string[],
  apiConfig: ImageApiConfig,
  protocolConfig: ImageProtocolConfig,
): Promise<string[]> {
  const { baseUrl, apiKey, modelName } = apiConfig;
  if (!baseUrl?.trim()) {
    throw new Error('请先在设置中配置 API');
  }
  if (!modelName?.trim()) {
    throw new Error('请先在设置中配置 API');
  }
  if (!apiKey?.trim()) {
    throw new Error('请先在设置中配置 API');
  }

  const task =
    modelName === 'nano-banana-2'
      ? nanoBananaGenerations(prompt, refImages, apiConfig, protocolConfig)
      : generateViaGoogleNative(prompt, refImages, apiConfig, protocolConfig);

  return task;
}
