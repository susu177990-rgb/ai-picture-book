// ============================================================
// Story Agent Word Export - Markdown to DOCX, then ZIP
// ============================================================

import { zipSync } from 'fflate';

async function markdownToBuffer(markdown: string): Promise<Buffer> {
  const { convertMarkdownToDocx } = await import('@mohtasham/md-to-docx');
  const blob = await convertMarkdownToDocx(markdown, {
    documentType: 'document',
    style: { fontFamily: 'Microsoft YaHei', paragraphSize: 12 },
  });
  return Buffer.from(await blob.arrayBuffer());
}

export interface ParsedDocSections {
  title: string;
  storyBible: string;
  spreadPacing: string;
  storyboard: string;
}

function sanitizeTitle(title: string): string {
  return title.trim().replace(/[/\\:*?"<>|]/g, '_');
}

function extractDocTitle(doc: string): string {
  const firstHeadingMatch = doc.match(/^#\s+(.+?)\s*$/m);
  if (firstHeadingMatch?.[1]) {
    return sanitizeTitle(firstHeadingMatch[1]);
  }

  const firstNonEmptyLine = doc
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (firstNonEmptyLine) {
    const wrappedTitleMatch = firstNonEmptyLine.match(/^[《【](.+)[》】]$/);
    if (wrappedTitleMatch?.[1]) {
      return sanitizeTitle(wrappedTitleMatch[1]);
    }
  }

  const quotedTitleMatch = doc.match(/《([^》]+)》/);
  if (quotedTitleMatch?.[1]) {
    return sanitizeTitle(quotedTitleMatch[1]);
  }

  return '绘本分镜脚本';
}

/**
 * Parse full doc into 3 sections
 */
export function parseDocSections(doc: string): ParsedDocSections {
  const title = extractDocTitle(doc);

  const findSection = (patterns: string[]): number => {
    for (const p of patterns) {
      const i = doc.indexOf(p);
      if (i >= 0) return i;
    }
    return -1;
  };

  const section2Start = findSection([
    '## 二、剧本大本营',
    '## 三、 剧本大本营',
    '## 二、 剧本大本营',
    '## 剧本大本营',
  ]);
  const section3Start = findSection([
    '## 三、跨页剧情分配表',
    '## 四、 跨页剧情分配表',
    '## 跨页剧情分配表',
  ]);
  const section4Start = findSection([
    '## 四、跨页视觉分镜脚本',
    '## 五、 跨页视觉分镜脚本',
    '## 跨页视觉分镜脚本',
  ]);

  let storyBible = section2Start >= 0 ? doc.substring(section2Start).trim() : doc;
  let spreadPacing = doc;
  let storyboard = doc;

  if (section2Start >= 0 && section3Start >= 0) {
    storyBible = doc.substring(section2Start, section3Start).trim();
  }
  if (section3Start >= 0 && section4Start >= 0) {
    spreadPacing = doc.substring(section3Start, section4Start).trim();
  }
  if (section4Start >= 0) {
    storyboard = doc.substring(section4Start).trim();
    storyboard = storyboard.replace(
      /^#+\s*[四五]?、?\s*跨页视觉分镜脚本\s*\n*/i,
      '',
    );
  }

  if (section2Start < 0) {
    storyBible = doc;
  }
  if (section3Start < 0) {
    spreadPacing = '# 跨页剧情分配表\n\n（跨页剧情分配表未在对话中生成）';
  }
  if (section4Start < 0) {
    storyboard = doc;
  }

  return { title, storyBible, spreadPacing, storyboard };
}

/**
 * Generate 3 Word buffers and pack as ZIP, return zip buffer
 */
export async function exportToZipBuffer(
  fullDoc: string,
): Promise<{ zipBuffer: Buffer; title: string }> {
  const { title, storyBible, spreadPacing, storyboard } =
    parseDocSections(fullDoc);
  const filePrefix = sanitizeTitle(title);

  const [buf1, buf2, buf3] = await Promise.all([
    markdownToBuffer(storyBible),
    markdownToBuffer(spreadPacing),
    markdownToBuffer(storyboard),
  ]);

  const zipped = zipSync(
    {
      [`${filePrefix}_剧本大本营.docx`]: new Uint8Array(buf1),
      [`${filePrefix}_跨页剧情分配表.docx`]: new Uint8Array(buf2),
      [`${filePrefix}_分页脚本合集.docx`]: new Uint8Array(buf3),
    },
    { level: 9 },
  );

  return {
    zipBuffer: Buffer.from(zipped),
    title,
  };
}
