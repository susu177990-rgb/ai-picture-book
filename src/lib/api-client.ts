// ============================================================
// API Client - OpenAI-Compatible Chat Completions (LLM 文本生成)
// ============================================================

import { ChatMessage, ImageProtocolType, LLMResponse } from '@/types';
import { generateImage } from '@/lib/geminiService';
import type { AspectRatioType, ImageSizeType } from '@/types';

/** 解析 API 错误响应，提取可读的错误信息（支持 OpenAI / Gemini / 通用格式） */
function parseApiErrorResponse(rawText: string, status: number): string {
  try {
    const json = JSON.parse(rawText);
    const msg =
      json?.error?.message ??
      json?.error?.details?.[0]?.message ??
      json?.message ??
      json?.error ??
      rawText;
    return `API 请求失败 (${status}): ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`;
  } catch {
    return `API 请求失败 (${status}): ${rawText.slice(0, 500)}`;
  }
}

interface CallOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 是否需要图片输出 */
  wantImage?: boolean;
  /** 最大 token */
  maxTokens?: number;
}

/**
 * 调用 OpenAI 兼容的 chat completions 端点。
 * 同时支持纯文本和多模态（Gemini 生图走 response_modalities）。
 */
export async function callChatCompletions(
  messages: ChatMessage[],
  options: CallOptions,
): Promise<LLMResponse> {
  const { baseUrl, apiKey, model, wantImage, maxTokens } = options;
  // Deeply clean configuration to prevent DOMException strict character parsing errors in browsers
  let cleanBaseUrl = baseUrl.replace(/[\r\n\t\s"“”'‘’]/g, '');
  if (!cleanBaseUrl) {
    throw new Error('API 接口地址 (Base URL) 不能为空');
  }
  if (!/^https?:\/\//i.test(cleanBaseUrl)) {
    cleanBaseUrl = 'https://' + cleanBaseUrl;
  }
  if (
    !cleanBaseUrl.includes('/v1') &&
    !cleanBaseUrl.includes('generativelanguage')
  ) {
    cleanBaseUrl = cleanBaseUrl.replace(/\/+$/, '') + '/v1';
  }
  const cleanApiKey = apiKey.replace(/[^\x20-\x7E]/g, '').trim();

  const url = `${cleanBaseUrl.replace(/\/+$/, '')}/chat/completions`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    model,
    messages,
    max_tokens: maxTokens ?? 8192,
  };

  if (wantImage) {
    body.response_modalities = ['TEXT', 'IMAGE'];
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (cleanApiKey) {
    headers['Authorization'] = `Bearer ${cleanApiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errMsg: string;
    try {
      const errJson = JSON.parse(errorText);
      errMsg =
        errJson?.error ?? errJson?.detail ?? parseApiErrorResponse(errorText, response.status);
    } catch {
      errMsg = parseApiErrorResponse(errorText, response.status);
    }
    throw new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
  }

  const textData = await response.text();
  let data;
  try {
    data = JSON.parse(textData);
  } catch {
    throw new Error(
      `Invalid JSON response (might be an HTML error page). Response preview: ${textData.slice(0, 100)}...`,
    );
  }

  return extractResponse(data);
}

/**
 * 从 OpenAI/Gemini 格式的 response 中提取文本和图片。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractResponse(data: any): LLMResponse {
  const result: LLMResponse = {};
  const choice = data.choices?.[0];

  if (!choice) {
    throw new Error('API 响应中未包含 choices 节点，可能请求失败。');
  }

  const message = choice.message;
  const content = message?.content;

  // --- 兼容性检测 1: 遍历提取 ---
  // 很多 Gemini 中转站会将图片放到 message.image 或 inlineData 中
  const rawImage =
    message?.image ||
    message?.inlineData ||
    message?.inline_data ||
    choice.inlineData ||
    data.image;
  if (rawImage && typeof rawImage === 'string') {
    const b64 = rawImage.trim().startsWith('data:')
      ? rawImage.trim()
      : `data:image/jpeg;base64,${rawImage.trim().replace(/\s/g, '')}`;
    result.images = [b64];
  }

  if (typeof content === 'string') {
    result.text = content;
    // 兼容性检测 2: 某些模型会把 base64 放在文本内容里（Markdown 格式）
    const b64Pattern = /data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g;
    const matches = content.match(b64Pattern);
    if (matches && matches.length > 0) {
      result.images = [
        ...(result.images || []),
        ...matches.map((m) => m.trim().replace(/\s/g, '')),
      ];
    }
  } else if (Array.isArray(content)) {
    const texts: string[] = [];
    const images: string[] = [];

    for (const part of content) {
      if (part.type === 'text') {
        texts.push(part.text);
      } else if (part.type === 'image_url') {
        let url = (part.image_url?.url ?? '').replace(/\s/g, '');
        if (url && !url.startsWith('http') && !url.startsWith('data:')) {
          url = `data:image/jpeg;base64,${url}`;
        }
        images.push(url);
      } else if (part.type === 'image') {
        let imgData = (part.image || '').replace(/\s/g, '');
        if (imgData && !imgData.startsWith('data:')) {
          imgData = `data:image/jpeg;base64,${imgData}`;
        }
        images.push(imgData);
      }
    }

    if (texts.length > 0) result.text = texts.join('\n');
    if (images.length > 0) {
      result.images = [...(result.images || []), ...images];
    }
  }

  return result;
}

/**
 * 快捷调用：纯文本 LLM 调用
 */
export async function callLLM(
  messages: ChatMessage[],
  options: Omit<CallOptions, 'wantImage'>,
): Promise<string> {
  const response = await callChatCompletions(messages, {
    ...options,
    wantImage: false,
  });
  return response.text ?? '';
}

export interface CallImageGenOptions {
  baseUrl: string;
  apiKey: string;
  imageProtocol: ImageProtocolType;
  model: string;
  imageAspectRatio: AspectRatioType;
  imageSize: ImageSizeType;
}

/**
 * 生图：按当前协议分发到对应的图片接口
 */
export async function callImageGen(
  messages: ChatMessage[],
  options: CallImageGenOptions,
): Promise<string[]> {
  let prompt = '';
  const refImages: string[] = [];

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      prompt += msg.content + '\n';
    } else if (Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (c.type === 'text' && c.text) {
          prompt += c.text + '\n';
        } else if (c.type === 'image_url' && c.image_url?.url) {
          refImages.push(c.image_url.url);
        }
      }
    }
  }

  const apiConfig = {
    baseUrl: options.baseUrl.replace(/\/+$/, ''),
    apiKey: options.apiKey,
    protocol: options.imageProtocol,
    modelName: options.model,
  };
  const protocolConfig = {
    aspectRatio: options.imageAspectRatio,
    imageSize: options.imageSize,
  };

  return generateImage(
    prompt.trim() || 'Generate an image.',
    refImages,
    apiConfig,
    protocolConfig,
  );
}

export async function testImageConnection(
  options: CallImageGenOptions,
): Promise<{ success: boolean; message: string }> {
  try {
    const images = await callImageGen(
      [{ role: 'user', content: 'Generate a simple red circle on white background.' }],
      options,
    );
    return {
      success: images.length > 0,
      message: images.length > 0 ? '生图接口连接成功，已返回图片' : '生图接口响应成功，但未返回图片',
    };
  } catch (err) {
    return {
      success: false,
      message: `生图连接失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 测试 API 连通性（发送一个最小请求）
 */
export async function testConnection(
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const text = await callLLM(
      [{ role: 'user', content: 'Say "OK" in one word.' }],
      { baseUrl, apiKey, model, maxTokens: 10 },
    );
    return {
      success: true,
      message: `连接成功！模型回复: ${text.slice(0, 50)}`,
    };
  } catch (err) {
    return {
      success: false,
      message: `连接失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
