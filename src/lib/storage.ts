// ============================================================
// Local Storage Management - Settings & Prompt Templates
// ============================================================

import {
  ApiSettings,
  AppSettings,
  AspectRatioType,
  ImageSizeType,
  PromptTemplateKey,
} from '@/types';

const STORAGE_KEY = 'ai-picture-book-settings';

const VALID_ASPECT_RATIOS: AspectRatioType[] = [
  'auto',
  '1:1',
  '1:2',
  '2:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '9:16',
  '16:9',
  '19:7',
  '21:9',
];

function toAspectRatio(v: unknown): AspectRatioType {
  if (typeof v === 'string' && VALID_ASPECT_RATIOS.includes(v as AspectRatioType)) {
    return v as AspectRatioType;
  }
  return 'auto';
}

function toImageSize(v: unknown): ImageSizeType {
  const s = String(v || '1K').toUpperCase();
  if (s === '2K' || s === '4K') return s;
  return '1K';
}

/** 默认 API 配置（按报告） */
const DEFAULT_API_SETTINGS: ApiSettings = {
  baseUrl: 'https://api.laozhang.ai',
  apiKey: '',
  llmModel: 'gpt-4o',
  imageModel: 'gemini-3-pro-image-preview',
  imageAspectRatioStage2: '16:9',
  imageSizeStage2: '1K',
  imageAspectRatioStage3: 'auto',
  imageSizeStage3: '1K',
  imageAspectRatioStage5: '21:9',
  imageSizeStage5: '4K',
};

/** 空提示词模板。实际可用提示词以用户已保存内容为准。 */
const EMPTY_PROMPTS: Record<PromptTemplateKey, string> = {
  prompt_0_0: '',
  prompt_0_3: '',
  prompt_0_4: '',
  prompt_0_5: '',
  prompt_0_6: '',
  prompt_0_7: '',
  prompt_0_8: '',
  prompt_stage4_remove_text: '',
  prompt_stage4_remove_seam: '',
  prompt_stage4_add_caption: '',
};

function mergePrompts(
  prompts?: Partial<Record<PromptTemplateKey, string>>,
): Record<PromptTemplateKey, string> {
  return {
    ...EMPTY_PROMPTS,
    ...prompts,
  };
}

/** 从项目文件 data/user-prompts.json 同步用户提示词到 localStorage */
export async function syncUserPromptsFromFile(): Promise<
  Record<PromptTemplateKey, string>
> {
  const current = getSettings();
  if (typeof window === 'undefined') return current.prompts;

  try {
    const res = await fetch('/api/settings/prompts', { cache: 'no-store' });
    if (res.status === 404) return current.prompts;
    if (!res.ok) return current.prompts;
    const data = (await res.json()) as { prompts?: Partial<Record<PromptTemplateKey, string>> };
    const filePrompts = data.prompts;
    if (!filePrompts || Object.keys(filePrompts).length === 0) return current.prompts;

    const mergedPrompts = mergePrompts({
      ...current.prompts,
      ...filePrompts,
    });
    saveSettings({ ...current, prompts: mergedPrompts });
    return mergedPrompts;
  } catch {
    return current.prompts;
  }

  return current.prompts;
}

/** 将用户提示词持久化到项目文件（永久保存） */
async function saveUserPromptsToFile(
  prompts: Record<PromptTemplateKey, string>,
): Promise<void> {
  const res = await fetch('/api/settings/prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompts }),
  });

  if (!res.ok) {
    throw new Error('提示词写入项目文件失败');
  }
}

/** 获取完整设置 */
export function getSettings(): AppSettings {
  if (typeof window === 'undefined') {
    return { api: DEFAULT_API_SETTINGS, prompts: EMPTY_PROMPTS };
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AppSettings> & {
        api?: Partial<ApiSettings> & {
          imageQualityStage2?: string;
          imageQualityStage3?: string;
          imageAspectRatio?: string;
        };
      };
      const api = { ...DEFAULT_API_SETTINGS, ...parsed.api } as ApiSettings;
      // 迁移：旧版 imageQualityStage2/3 → imageSizeStage2/3
      if (parsed.api?.imageQualityStage2 != null) {
        api.imageSizeStage2 = toImageSize(parsed.api.imageQualityStage2);
      }
      if (parsed.api?.imageQualityStage3 != null) {
        api.imageSizeStage3 = toImageSize(parsed.api.imageQualityStage3);
      }
      api.imageAspectRatioStage2 = toAspectRatio(
        parsed.api?.imageAspectRatioStage2 ?? parsed.api?.imageAspectRatio,
      );
      api.imageAspectRatioStage3 = toAspectRatio(
        parsed.api?.imageAspectRatioStage3 ?? parsed.api?.imageAspectRatio,
      );
      api.imageAspectRatioStage5 = toAspectRatio(parsed.api?.imageAspectRatioStage5 ?? '21:9');
      api.imageSizeStage5 = toImageSize(parsed.api?.imageSizeStage5 ?? '4K');
      return {
        api,
        prompts: mergePrompts(parsed.prompts),
      };
    }
  } catch {
    // Ignore parse errors
  }

  return { api: DEFAULT_API_SETTINGS, prompts: EMPTY_PROMPTS };
}

/** 保存完整设置 */
export function saveSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** 获取 API 设置 */
export function getApiSettings(): ApiSettings {
  return getSettings().api;
}

/** 保存 API 设置 */
export function saveApiSettings(api: ApiSettings): void {
  const current = getSettings();
  saveSettings({ ...current, api });
}

/** 获取指定提示词模板 */
export function getPromptTemplate(key: PromptTemplateKey): string {
  return getSettings().prompts[key];
}

/** 保存指定提示词模板（同时写入 localStorage 与项目文件，永久保存） */
export async function savePromptTemplate(
  key: PromptTemplateKey,
  value: string,
): Promise<Record<PromptTemplateKey, string>> {
  const current = getSettings();
  const nextPrompts = mergePrompts({ ...current.prompts, [key]: value });
  saveSettings({
    ...current,
    prompts: nextPrompts,
  });
  await saveUserPromptsToFile(nextPrompts);
  return nextPrompts;
}
