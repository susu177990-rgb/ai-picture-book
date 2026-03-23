import type { Session } from '@/lib/story-agent-sessions';

const PAGE_SEPARATOR = '———————————————————————';

interface ExtractedPageBlock {
  pageNumber: number;
  content: string;
}

export interface StoryAgentExportDraft {
  markdown: string;
  title: string;
  pageCount: number;
  usedFallback: boolean;
}

function normalizeText(input: string): string {
  return input.replace(/\r\n?/g, '\n').trim();
}

function stripLeadingHeading(input: string, headingPattern: RegExp): string {
  return normalizeText(input).replace(headingPattern, '').trim();
}

function extractTitle(session: Session): string {
  const metadataTitle = session.metadata.storyTitle?.trim();
  if (metadataTitle) {
    return metadataTitle;
  }

  const contents = session.messages.map((message) => message.content || '');

  for (const content of contents) {
    const titleLineMatch = content.match(/故事标题[：:]\s*[《【]?([^》】\n]+)[》】]?/u);
    if (titleLineMatch?.[1]?.trim()) {
      return titleLineMatch[1].trim();
    }
  }

  for (const content of contents) {
    const quotedTitleMatch = content.match(/《([^》\n]{1,80})》/u);
    if (quotedTitleMatch?.[1]?.trim()) {
      return quotedTitleMatch[1].trim();
    }
  }

  const sessionTitle = session.title?.trim();
  if (sessionTitle && sessionTitle !== '新对话') {
    return sessionTitle.slice(0, 40);
  }

  return '绘本分镜脚本';
}

function extractLogline(session: Session): string {
  const metadataLogline = session.metadata.logline?.trim();
  if (metadataLogline) {
    return metadataLogline;
  }

  for (const message of session.messages) {
    if (message.role !== 'assistant') continue;
    const content = message.content || '';
    const match = content.match(
      /(?:核心故事大纲|Logline)[\s\S]{0,200}?>\s*\*\*([\s\S]+?)\*\*/u,
    );
    if (match?.[1]?.trim()) {
      return match[1].replace(/\s+/g, ' ').trim();
    }
  }

  return '';
}

function extractStoryBible(session: Session): string {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message.role !== 'assistant') continue;
    const content = normalizeText(message.content || '');
    if (!content) continue;
    if (/^#\s*剧本大本营\b/mu.test(content) || /##\s*一、\s*核心设定/mu.test(content)) {
      return stripLeadingHeading(
        content,
        /^#\s*剧本大本营[^\n]*\n+/u,
      );
    }
  }

  return '';
}

function extractSpreadPacing(session: Session): string {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message.role !== 'assistant') continue;
    const content = normalizeText(message.content || '');
    if (!content) continue;
    if (
      /^#\s*跨页剧情分配表\b/mu.test(content) ||
      /\|\s*页码\s*\|\s*剧情切片/u.test(content)
    ) {
      return stripLeadingHeading(
        content,
        /^#\s*跨页剧情分配表[^\n]*\n+/u,
      );
    }
  }

  return '';
}

function extractPageBlocksFromMessage(messageContent: string): ExtractedPageBlock[] {
  const content = normalizeText(messageContent);
  if (!content.includes('第 ') || !content.includes('【本页叙事切片】')) {
    return [];
  }

  const pageRegex =
    /(?:^|\n)(?:[—─-]{10,}\s*\n)?第\s*(\d+)\s*页\s*\n([\s\S]*?)(?=(?:\n(?:[—─-]{10,}\s*\n)?第\s*\d+\s*页\s*\n)|$)/gu;
  const blocks: ExtractedPageBlock[] = [];

  for (const match of content.matchAll(pageRegex)) {
    const pageNumber = Number(match[1]);
    const body = (match[2] || '')
      .replace(/\n*工作已结束[\s\S]*$/u, '')
      .replace(/\n*[—─-]{10,}\s*$/u, '')
      .trim();

    if (!Number.isFinite(pageNumber) || pageNumber <= 0) continue;
    if (!body.includes('【本页叙事切片】')) continue;

    blocks.push({
      pageNumber,
      content: `${PAGE_SEPARATOR}\n第 ${pageNumber} 页\n\n${body}`,
    });
  }

  return blocks;
}

function extractStoryboard(session: Session): ExtractedPageBlock[] {
  const pageMap = new Map<number, string>();

  for (const message of session.messages) {
    if (message.role !== 'assistant') continue;
    const blocks = extractPageBlocksFromMessage(message.content || '');
    for (const block of blocks) {
      pageMap.set(block.pageNumber, block.content);
    }
  }

  return Array.from(pageMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([pageNumber, content]) => ({ pageNumber, content }));
}

function buildProjectSummary(title: string, logline: string): string {
  const lines = [`- 标题：${title}`];
  if (logline) {
    lines.push(`- Logline：${logline}`);
  }
  lines.push('- 导出方式：根据当前会话中的已生成内容直接组装，无需再次请求模型。');

  return `## 一、项目概要\n\n${lines.join('\n')}`;
}

export function buildStoryAgentExportDraft(
  session: Session,
): StoryAgentExportDraft | null {
  const storyboardBlocks = extractStoryboard(session);
  if (storyboardBlocks.length === 0) {
    return null;
  }

  const title = extractTitle(session);
  const logline = extractLogline(session);
  const storyBible = extractStoryBible(session);
  const spreadPacing = extractSpreadPacing(session);
  const usedFallback = !storyBible || !spreadPacing;

  const markdown = [
    `# ${title}`,
    buildProjectSummary(title, logline),
    '## 二、剧本大本营',
    storyBible || '待补充',
    '## 三、跨页剧情分配表',
    spreadPacing || '待补充',
    '## 四、跨页视觉分镜脚本',
    storyboardBlocks.map((block) => block.content).join('\n\n'),
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    markdown,
    title,
    pageCount: storyboardBlocks.length,
    usedFallback,
  };
}
