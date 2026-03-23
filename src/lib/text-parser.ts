// ============================================================
// Text Parsing Engine - Script & Character Slicing
// ============================================================

import { PageSlice, CharacterSlice } from '@/types';

/**
 * 解析分页剧本文本。
 * 使用正则匹配连续的 `——————` 分隔符和 `第 x 页` 标题进行精准切割。
 */
export function parseScript(rawText: string): PageSlice[] {
  // 匹配：连续 ——— 分隔线（至少6个连续的 — 或 ─ 字符）
  const separatorPattern = /[—─]{6,}/g;

  // 先用分隔线切割
  const segments = rawText
    .split(separatorPattern)
    .map((s) => s.trim())
    .filter(Boolean);

  const pages: PageSlice[] = [];

  // 尝试从每个 segment 中提取页码
  const pageHeaderPattern = /^第\s*(\d+)\s*页/;
  const pageHeaderPatternAlt = /Page\s*(\d+)/i;

  for (const segment of segments) {
    let pageNumber: number | null = null;
    let content = segment;

    // 尝试匹配中文页码
    const matchCN = segment.match(pageHeaderPattern);
    if (matchCN) {
      pageNumber = parseInt(matchCN[1], 10);
      // 移除标题行
      content = segment.replace(pageHeaderPattern, '').trim();
    } else {
      // 尝试匹配英文页码
      const matchEN = segment.match(pageHeaderPatternAlt);
      if (matchEN) {
        pageNumber = parseInt(matchEN[1], 10);
        content = segment.replace(pageHeaderPatternAlt, '').trim();
      }
    }

    if (content) {
      pages.push({
        pageNumber: pageNumber ?? pages.length + 1,
        content,
      });
    }
  }

  // 如果没有解析到任何分页，将整段文本作为第1页
  if (pages.length === 0 && rawText.trim()) {
    pages.push({ pageNumber: 1, content: rawText.trim() });
  }

  // 按页码排序
  pages.sort((a, b) => a.pageNumber - b.pageNumber);

  return pages;
}

/**
 * 解析 1_2 角色/物品提示词库文本，拆分为独立的角色/物品切片。
 */
export function parseCharacterPrompts(rawText: string): CharacterSlice[] {
  const slices: CharacterSlice[] = [];

  // 先用连续的 “——” 切割 (支持多种长短横线，匹配至少 4 个连续的分隔符)
  const separatorPattern = /[—─―-]{4,}/g;
  const segments = rawText
    .split(separatorPattern)
    .map((s) => s.trim())
    .filter(Boolean);

  // 匹配角色和物品块的正则
  const characterPattern = /(?:角色|人物)[^\d]*(\d+)[^\n]*?[：:]\s*([^\n]+)/;
  const itemPattern = /(?:物品|道具)[^\d]*(\d+)[^\n]*?[：:]\s*([^\n]+)/;

  for (const segment of segments) {
    let type: 'character' | 'item' | null = null;
    let index = 0;
    let name = '';

    const charMatch = segment.match(characterPattern);
    const itemMatch = segment.match(itemPattern);

    if (charMatch) {
      type = 'character';
      index = parseInt(charMatch[1], 10);
      name = charMatch[2].trim();
    } else if (itemMatch) {
      type = 'item';
      index = parseInt(itemMatch[1], 10);
      name = itemMatch[2].trim();
    }

    if (type && name) {
      // 提取中英文名称：例如 "小明 (Ming) —— 勇敢的孩子" -> "小明"
      const nameMatch = name.match(/(.+?)(?:[（(](.+?)[）)])?\s*[—─-]{2,}/);
      const finalName = nameMatch
        ? nameMatch[1].trim()
        : name.split(/[—─-]{2,}/)[0].trim();
      const nameCN =
        finalName.match(/(.+?)(?:[（(](.+?)[）)])?$/)?.[1].trim() || finalName;

      // 提取解析，容纳多行直至遇到新字段
      const analysisMatch = segment.match(
        /大师级设计解析.*?[：:]\s*([\s\S]*?)(?=小巧思|英文prompt|三视图提示词|道具提示词|`|Ratio|$)/i,
      );
      const cleverMatch = segment.match(
        /小巧思.*?[：:]\s*([\s\S]*?)(?=英文prompt|三视图提示词|道具提示词|`|Ratio|$)/i,
      );

      let designAnalysis = '';
      if (analysisMatch && analysisMatch[1].trim()) {
        designAnalysis += analysisMatch[1].trim() + '\n';
      }
      if (cleverMatch && cleverMatch[1].trim()) {
        designAnalysis += '小巧思: ' + cleverMatch[1].trim();
      }

      if (!designAnalysis) {
        const cleanSegment = segment
          .replace(characterPattern, '')
          .replace(itemPattern, '')
          .trim();
        const fallbackAnalysis = cleanSegment.match(
          /([\s\S]*?)(?=小巧思|英文prompt|三视图|`|Ratio|$)/i,
        );
        designAnalysis = fallbackAnalysis
          ? fallbackAnalysis[1].trim()
          : cleanSegment;
      }

      // 提取提示词信息
      let prompt = '';
      const tickMatch = segment.match(/`([\s\S]+?)`/);
      if (tickMatch) {
        prompt = tickMatch[1].trim();
      } else {
        // 如果用户模版漏了结尾的 \`，找只有一个首 \` 的行
        const lineTickMatch = segment.match(/`([^\n]+)/);
        if (lineTickMatch) {
          prompt = lineTickMatch[1].trim();
        } else {
          const fallbackPromptMatch = segment.match(
            /(?:prompt|提示词).*?[：:]\s*\n*([\s\S]*?)(?=\n*\*?\s*Ratio|$)/i,
          );
          if (fallbackPromptMatch) prompt = fallbackPromptMatch[1].trim();
        }
      }

      // 清理多余反引号
      prompt = prompt.replace(/^`+|`+$/g, '').trim();

      if (prompt) {
        slices.push({
          type,
          index,
          name,
          nameCN,
          // 去掉星号避免加粗干扰 UI
          designAnalysis: designAnalysis.replace(/\*/g, '').trim(),
          prompt,
          rawText: segment,
        });
      }
    }
  }

  // --- Fallback Strategy ---
  // 如果大模型返回时完全遗忘了输出横线 ——————，我们要用回老逻辑（基于关键词的扫描切割）
  if (slices.length === 0) {
    console.warn(
      'Fallback triggered: LLM failed to use separator, using dynamic splitting.',
    );
    const globalCharPattern =
      /(?:角色|人物)[^\d]*(\d+)[^\n]*?[：:]\s*([^\n]+)/g;
    const globalItemPattern =
      /(?:物品|道具)[^\d]*(\d+)[^\n]*?[：:]\s*([^\n]+)/g;

    interface BlockPos {
      type: 'character' | 'item';
      index: number;
      name: string;
      startIndex: number;
    }

    const blocks: BlockPos[] = [];
    let match: RegExpExecArray | null;

    while ((match = globalCharPattern.exec(rawText)) !== null) {
      blocks.push({
        type: 'character',
        index: parseInt(match[1], 10),
        name: match[2].trim(),
        startIndex: match.index,
      });
    }
    while ((match = globalItemPattern.exec(rawText)) !== null) {
      blocks.push({
        type: 'item',
        index: parseInt(match[1], 10),
        name: match[2].trim(),
        startIndex: match.index,
      });
    }

    blocks.sort((a, b) => a.startIndex - b.startIndex);

    for (let i = 0; i < blocks.length; i++) {
      const start = blocks[i].startIndex;
      const end =
        i + 1 < blocks.length ? blocks[i + 1].startIndex : rawText.length;
      const segment = rawText.slice(start, end).trim();

      const nameMatch = blocks[i].name.match(/(.+?)(?:[（(](.+?)[）)])?$/);
      const nameCN = nameMatch ? nameMatch[1].trim() : blocks[i].name;

      const analysisMatch = segment.match(
        /大师级设计解析.*?[：:]\s*([\s\S]*?)(?=小巧思|英文prompt|三视图提示词|道具提示词|`|Ratio|$)/i,
      );
      const cleverMatch = segment.match(
        /小巧思.*?[：:]\s*([\s\S]*?)(?=英文prompt|三视图提示词|道具提示词|`|Ratio|$)/i,
      );

      let designAnalysis = '';
      if (analysisMatch && analysisMatch[1].trim())
        designAnalysis += analysisMatch[1].trim() + '\n';
      if (cleverMatch && cleverMatch[1].trim())
        designAnalysis += '小巧思: ' + cleverMatch[1].trim();

      let prompt = '';
      const tickMatch = segment.match(/`([\s\S]+?)`/);
      if (tickMatch) {
        prompt = tickMatch[1].trim();
      } else {
        const lineTickMatch = segment.match(/`([^\n]+)/);
        if (lineTickMatch) {
          prompt = lineTickMatch[1].trim();
        } else {
          const fallbackPromptMatch = segment.match(
            /(?:prompt|提示词).*?[：:]\s*\n*([\s\S]*?)(?=\n*\*?\s*Ratio|$)/i,
          );
          if (fallbackPromptMatch) prompt = fallbackPromptMatch[1].trim();
        }
      }

      slices.push({
        type: blocks[i].type,
        index: blocks[i].index,
        name: blocks[i].name,
        nameCN,
        designAnalysis: designAnalysis.replace(/\*/g, '').trim(),
        prompt: prompt.replace(/^`+|`+$/g, '').trim(),
        rawText: segment,
      });
    }
  }

  return slices;
}

/**
 * 从分页剧本 content 的【绘本文案】区块中提取文案文本。
 * 用于阶段4「添加配文」功能。
 */
export function extractCaptionFromPageContent(content: string): string {
  const m = content.match(
    /【绘本文案】\s*([\s\S]*?)(?=【[^】]+】|$)/,
  );
  return m ? m[1].trim() : '';
}

/**
 * 从分页 content 的【本页出现的角色/物品】区块中提取角色/物品名列表。
 * 格式：该区块内每行一个名称。支持 [仅列出...] 模板说明，会跳过明显为说明文字的行。
 */
export function extractAppearingNamesFromSection(content: string): string[] {
  const match = content.match(
    /【本页出现的角色\/物品】\s*([\s\S]*?)(?=【[^】]+】|$)/,
  );
  if (!match) return [];

  const block = match[1].trim();
  const lines = block
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^[-*·]\s*/, '')
        .replace(/\]\s*$/, '')
        .trim(),
    )
    .filter(Boolean);

  const instructionKeywords = /仅列出|每个断行|角色名|物品名|例如[：:]\s*$/;
  return lines.filter(
    (line) =>
      line.length <= 50 &&
      line.length >= 1 &&
      !instructionKeywords.test(line),
  );
}

/**
 * 判断当前页出场的角色。
 * 优先从【本页出现的角色/物品】区块读取名称列表并匹配；
 * 若无该区块则回退到全文关键词匹配。
 */
export function extractAppearingCharacters(
  pageText: string,
  characters: CharacterSlice[],
): CharacterSlice[] {
  const namesFromSection = extractAppearingNamesFromSection(pageText);
  if (namesFromSection.length > 0) {
    const nameSet = new Set(
      namesFromSection.map((n) => n.trim().toLowerCase()).filter(Boolean),
    );
    return characters.filter((char) => {
      const nameCN = char.nameCN?.trim().toLowerCase();
      if (nameCN && nameSet.has(nameCN)) return true;
      const nameParts = char.name
        .split(/[（()）]/)
        .map((p) => p.trim().toLowerCase())
        .filter((p) => p.length >= 2);
      return nameParts.some((part) => nameSet.has(part));
    });
  }

  const pageLower = pageText.toLowerCase();
  return characters.filter((char) => {
    const nameCN = char.nameCN?.trim();
    if (nameCN && pageLower.includes(nameCN.toLowerCase())) return true;
    const nameParts = char.name.split(/[（()）]/).map((p) => p.trim()).filter(Boolean);
    return nameParts.some((part) => part.length >= 2 && pageLower.includes(part.toLowerCase()));
  });
}
