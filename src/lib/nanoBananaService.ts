// ============================================================
// Nano Banana Image Service
// 支持 generations 与 draw 两种接口
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
export function toImageInput(dataUrl: string): string {
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
export function mapAspectRatio(ratio: AspectRatioType): string | undefined {
  if (ratio === 'auto') return undefined;
  if (ratio === '19:7') return '21:9';
  const supported = ['1:1', '1:2', '2:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '4:5', '5:4', '21:9'];
  return supported.includes(ratio) ? ratio : undefined;
}

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const imgRes = await fetch(url);
    if (!imgRes.ok) return null;
    const imgBlob = await imgRes.blob();
    const b64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = reject;
      reader.readAsDataURL(imgBlob);
    });
    return b64 || null;
  } catch {
    return null;
  }
}

async function responseToJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`API 返回了无效 JSON: ${text.slice(0, 300)}`);
  }
}

function ensureSuccessEnvelope(payload: unknown): void {
  if (!payload || typeof payload !== 'object') return;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.code === 'number' && obj.code !== 0) {
    const msg = typeof obj.msg === 'string' ? obj.msg : `业务错误 (${obj.code})`;
    throw new Error(msg);
  }
}

function formatFailureReason(failureReason?: string, errorMessage?: string): string {
  const parts = [failureReason, errorMessage].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : '任务失败';
}

function extractDrawData(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (obj.data && typeof obj.data === 'object') {
      return obj.data as Record<string, unknown>;
    }
    return obj;
  }
  return {};
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
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

  const payload = (await response.json()) as {
    code?: number;
    msg?: string;
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  ensureSuccessEnvelope(payload);

  const images: string[] = [];
  const items = payload.data ?? [];

  for (const item of items) {
    if (item.b64_json) {
      images.push(`data:image/png;base64,${item.b64_json}`);
    } else if (item.url) {
      const b64 = await fetchImageAsDataUrl(item.url);
      if (b64) images.push(b64);
    }
  }

  return images;
}

export async function nanoBananaDraw(
  prompt: string,
  refImages: string[],
  apiConfig: ImageApiConfig,
  protocolConfig: ImageProtocolConfig,
): Promise<string[]> {
  const { baseUrl, apiKey, modelName } = apiConfig;
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  const submitUrl = `${cleanBaseUrl}/v1/draw/nano-banana`;
  const resultUrl = `${cleanBaseUrl}/v1/draw/result`;
  const imageInputs = refImages.map(toImageInput).filter(Boolean);

  const submitBody: Record<string, unknown> = {
    model: modelName,
    prompt: prompt.trim() || 'Generate an image based on the reference.',
    webHook: '-1',
    shutProgress: true,
  };

  if (imageInputs.length > 0) {
    submitBody.urls = imageInputs;
  }

  const aspectRatio = mapAspectRatio(protocolConfig.aspectRatio);
  if (aspectRatio) {
    submitBody.aspectRatio = aspectRatio;
  }

  if (protocolConfig.imageSize) {
    submitBody.imageSize = protocolConfig.imageSize;
  }

  const submitResponse = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(submitBody),
  });

  if (!submitResponse.ok) {
    const errBody = await submitResponse.text();
    throw new Error(`API 错误 (${submitResponse.status}): ${errBody}`);
  }

  const submitPayload = await responseToJson(submitResponse);
  ensureSuccessEnvelope(submitPayload);
  const submitData = extractDrawData(submitPayload);
  const taskId = typeof submitData.id === 'string' ? submitData.id : '';
  if (!taskId) {
    throw new Error('Nano Banana Draw 未返回任务 id');
  }

  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    const pollResponse = await fetch(resultUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ id: taskId }),
    });

    if (!pollResponse.ok) {
      const errBody = await pollResponse.text();
      throw new Error(`结果查询失败 (${pollResponse.status}): ${errBody}`);
    }

    const pollPayload = await responseToJson(pollResponse);
    const pollRecord = pollPayload && typeof pollPayload === 'object'
      ? (pollPayload as Record<string, unknown>)
      : {};
    const code = typeof pollRecord.code === 'number' ? pollRecord.code : 0;
    const msg = typeof pollRecord.msg === 'string' ? pollRecord.msg : '';
    if (code === -22) {
      throw new Error(`任务不存在: ${msg || taskId}`);
    }
    if (code !== 0) {
      throw new Error(`结果查询失败: ${msg || '未知错误'}`);
    }

    const pollData = extractDrawData(pollPayload);
    const status = typeof pollData.status === 'string' ? pollData.status : '';

    if (status === 'succeeded') {
      const results = Array.isArray(pollData.results)
        ? (pollData.results as Array<Record<string, unknown>>)
        : [];
      const images: string[] = [];
      for (const result of results) {
        const url = typeof result.url === 'string' ? result.url : '';
        const dataUrl = await fetchImageAsDataUrl(url);
        if (dataUrl) {
          images.push(dataUrl);
        }
      }
      if (images.length === 0) {
        throw new Error('Nano Banana Draw 已成功，但未返回可用图片');
      }
      return images;
    }

    if (status === 'failed') {
      const failureReason =
        typeof pollData.failure_reason === 'string' ? pollData.failure_reason : '';
      const errorMessage = typeof pollData.error === 'string' ? pollData.error : '';
      throw new Error(`Nano Banana Draw 失败: ${formatFailureReason(failureReason, errorMessage)}`);
    }

    await wait(2_000);
  }

  throw new Error('Nano Banana Draw 结果查询超时，请稍后重试');
}
