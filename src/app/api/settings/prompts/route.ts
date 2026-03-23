// ============================================================
// API Route: 持久化用户提示词到项目文件
// 解决 localStorage 在重启/换端口/清缓存后丢失的问题
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import type { PromptTemplateKey } from '@/types';
import { getAppDataPath } from '@/lib/app-data-dir';

const PROMPTS_FILE = 'user-prompts.json';
const VALID_KEYS: PromptTemplateKey[] = [
  'prompt_0_0',
  'prompt_0_3',
  'prompt_0_4',
  'prompt_0_5',
  'prompt_0_6',
  'prompt_0_7',
  'prompt_0_8',
  'prompt_stage4_remove_text',
  'prompt_stage4_remove_seam',
  'prompt_stage4_add_caption',
];

function isValidPrompts(
  obj: unknown,
): obj is Partial<Record<PromptTemplateKey, string>> {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!VALID_KEYS.includes(key as PromptTemplateKey)) {
      return false;
    }
    if (typeof o[key] !== 'string') {
      return false;
    }
  }
  return true;
}

/** GET: 读取用户自定义提示词 */
export async function GET() {
  try {
    const filePath = getAppDataPath(PROMPTS_FILE);

    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;

    if (!isValidPrompts(parsed)) {
      return NextResponse.json(
        { error: '无效的提示词格式' },
        { status: 400 },
      );
    }

    return NextResponse.json({ prompts: parsed });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return NextResponse.json({ prompts: null }, { status: 404 });
    }
    console.error('读取提示词文件失败:', err);
    return NextResponse.json(
      { error: '读取失败' },
      { status: 500 },
    );
  }
}

/** POST: 保存用户自定义提示词 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { prompts?: unknown };

    if (!body.prompts || !isValidPrompts(body.prompts)) {
      return NextResponse.json(
        { error: '无效的提示词格式' },
        { status: 400 },
      );
    }

    const filePath = getAppDataPath(PROMPTS_FILE);
    const dir = path.dirname(filePath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify(body.prompts, null, 2),
      'utf-8',
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('保存提示词文件失败:', err);
    return NextResponse.json(
      { error: '保存失败' },
      { status: 500 },
    );
  }
}
