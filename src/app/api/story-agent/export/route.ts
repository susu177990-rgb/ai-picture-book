// ============================================================
// API Route: Story Agent Export (Markdown -> DOCX -> ZIP)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/story-agent-sessions';
import { storyAgentChat } from '@/lib/story-agent-llm';
import { buildStoryAgentExportDraft } from '@/lib/story-agent-export-draft';
import { exportToZipBuffer } from '@/lib/story-agent-word-export';

const PAGE_FORMAT = `
每页必须严格使用以下分隔格式，不得省略横线：

———————————————————————
第 [页码] 页 

【本页叙事切片】
[内容]

【全局视觉与环境工程】
- 构图与画幅张力：[内容]
- 场景与生活痕迹：[内容]
- 原生光影系统：[内容]

【角色微观状态系统】
    角色名：
    - 躯体张力与空间互动：[内容]
    - 面部微表情与质感：[内容]
    - 累积性物理战损：[内容]
    （如有核心道具，同上格式）

【跨页视觉隐喻与锚点】
[内容]

【绘本文案】
[内容，每页不少于 2 句]

【本页出现的角色/物品】
[仅列出当前页出现的角色名、物品名，每个断行写，不用逗号隔开]

———————————————————————
`;

const EXPORT_PROMPT = `你是一位专业的绘本项目文档整理员。请根据以下对话记录，整理出一份完整的绘本分镜脚本文档（Markdown 格式）。

【核心要求 - 内容不得缩水】
1. **完整保留**：对话中已生成的每一页分镜内容必须原样保留，不得省略、缩写、概括或合并。若对话中有 20 页，输出必须也有 20 页。
2. **格式严格**：跨页视觉分镜脚本的每一页必须使用下方「每页格式」中的分隔线（———————————————————————）和区块标题，不得自行简化。

【文档结构】
- ## 一、项目概要（含 Logline）
- ## 二、剧本大本营
- ## 三、跨页剧情分配表
- ## 四、跨页视觉分镜脚本

【跨页剧情分配表 - 表格格式强制】
- 必须使用标准 Markdown GFM 表格，否则导出后无法形成 Word 表格。
- 表头行：| 页码 | 剧情切片（一句话） | 起承转合 | 备注 |
- 分隔行：|------|-------------------|----------|------|（不可省略）
- 数据行：每行严格 4 列，用 | 分隔。例：| 第 1 页 | 主角登场，日常建立 | 起 | 日常建立 |
- 剧情切片列：保持一句话，勿换行；若内容较长可适当精简。
- 起承转合列：仅填「起」「承」「转」「合」之一。

【每页格式】跨页视觉分镜脚本中，每一页必须严格按此格式输出：
${PAGE_FORMAT}

【其他】
- 故事标题从对话中解析，用于文档标题。若无法解析则使用「绘本分镜脚本」。
- 若某部分未在对话中出现则标注「待补充」。
- 输出纯 Markdown，不要包含解释性文字或代码块标记，直接输出文档正文。`;

interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, api, output } = body as {
      sessionId?: string;
      api?: ApiConfig;
      output?: 'zip' | 'markdown';
    };

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400 },
      );
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 },
      );
    }

    const localDraft = buildStoryAgentExportDraft(session);
    if (localDraft) {
      if (output === 'markdown') {
        return new NextResponse(localDraft.markdown, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Story-Agent-Export-Source': 'session',
          },
        });
      }

      const { zipBuffer, title } = await exportToZipBuffer(localDraft.markdown);
      const filename = `${title}.zip`;

      return new NextResponse(new Uint8Array(zipBuffer), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          'X-Story-Agent-Export-Source': 'session',
        },
      });
    }

    if (!api?.baseUrl || !api?.model) {
      return NextResponse.json(
        { error: '当前会话尚未形成可直接导出的分镜内容，请先完成分镜，或在设置中配置 API 以启用模型整理导出。' },
        { status: 400 },
      );
    }

    const conversationText = session.messages
      .map((m) => `【${m.role}】\n${m.content}`)
      .join('\n\n---\n\n');

    const exportMessages = [
      { role: 'system' as const, content: EXPORT_PROMPT },
      {
        role: 'user' as const,
        content: `请整理以下对话为完整分镜脚本文档：\n\n${conversationText}`,
      },
    ];

    const doc = await storyAgentChat(exportMessages, api, 32768);

    if (output === 'markdown') {
      return new NextResponse(doc, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
        },
      });
    }

    const { zipBuffer, title } = await exportToZipBuffer(doc);
    const filename = `${title}.zip`;

    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    console.error('[story-agent/export]', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Export failed',
      },
      { status: 500 },
    );
  }
}
