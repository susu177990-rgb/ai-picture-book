// ============================================================
// Prompt Fusion Matrix - Template String Assembly Engine
// ============================================================

import {
  ChatMessage,
  MessageContent,
  CharacterSlice,
  PageSlice,
} from '@/types';

/**
 * 阶段1A：风格解析融合
 * 公式: 0_1全文 + 0_2图(Base64) + 0_3风格分析指令
 * → 调用 LLM → 产出 1_1 绘画风格与视觉质感控制模块
 */
export function fuseStyleAnalysis(
  scriptFullText: string,
  styleRefImageBase64: string,
  prompt_0_3: string,
): ChatMessage[] {
  const content: MessageContent[] = [
    {
      type: 'image_url',
      image_url: { url: styleRefImageBase64 },
    },
    {
      type: 'text',
      text: `${prompt_0_3}\n\n————————————————————————————————\n【艺术风格参考图】已附在上方。\n\n————————————————————————————————\n【绘本完整分页内容】\n\n${scriptFullText}`,
    },
  ];

  return [
    {
      role: 'user',
      content,
    },
  ];
}

/**
 * 阶段1B：角色/物品提取融合
 * 公式: 0_1全文 + 0_4角色设计指令
 * → 调用 LLM → 产出 1_2 角色/物品三视图设计提示词
 */
export function fuseCharacterExtraction(
  scriptFullText: string,
  prompt_0_4: string,
): ChatMessage[] {
  return [
    {
      role: 'user',
      content: `${prompt_0_4}\n\n————————————————————————————————\n【儿童绘本分页文件】\n\n${scriptFullText}`,
    },
  ];
}

/**
 * 阶段2：角色/物品资产生成融合
 * 公式: 0_5三视图指令 + 1_2(角色切片) + 1_1(风格模块) + 0_2(垫图)
 * → 调用生图模型 → 产出 2_x 资产图
 */
export function fuseAssetGeneration(
  characterSlice: CharacterSlice,
  styleModule: string,
  styleRefImageBase64: string,
  prompt_0_5: string,
): ChatMessage[] {
  // 将 0_5 模板中的占位区域填入角色设定 (发送 1_2 中两个横线间被提取的完整纯文本区段块)
  const filledPrompt = `${prompt_0_5}\n\n### 1. 【角色/物品完整构建设定】\n\n${characterSlice.rawText}\n\n### 2. 【绘画风格与视觉质感控制 (风格变量模块)】\n\n${styleModule}`;

  const content: MessageContent[] = [
    {
      type: 'image_url',
      image_url: { url: styleRefImageBase64 },
    },
    {
      type: 'text',
      text: `【风格参考图】已附在上方，请以此为最高视觉标准。\n\n${filledPrompt}`,
    },
  ];

  return [
    {
      role: 'user',
      content,
    },
  ];
}

/**
 * 阶段3：分页量产融合
 * 公式: 0_0通用设置(含1_1风格模块&分页剧本) + 2_x(出场角色垫图) + 0_2(风格参考图)
 * → 调用生图模型 → 产出 3_x 分页成品图
 */
export function fusePageGeneration(
  pageSlice: PageSlice,
  styleModule: string,
  styleRefImageBase64: string | undefined,
  characterAssetImages: { name: string; imageBase64: string }[],
  prompt_0_0: string,
): ChatMessage[] {
  // 将 0_0 模板中的占位符替换
  let filledPrompt = prompt_0_0;
  filledPrompt = filledPrompt.replace(
    '{{绘画风格与视觉质感控制 (风格变量模块)}}',
    styleModule,
  );
  filledPrompt = filledPrompt.replace(
    '{{绘本第X分页剧本内容}}',
    pageSlice.content,
  );

  // 构建多模态内容：风格参考图（可选）+ 各角色参考图 + 指令文本
  const content: MessageContent[] = [];

  // 1. 风格参考图（可选）
  if (styleRefImageBase64) {
    content.push({
      type: 'image_url',
      image_url: { url: styleRefImageBase64 },
    });
  }

  // 2. 角色/物品参考图
  for (const asset of characterAssetImages) {
    content.push({
      type: 'image_url',
      image_url: { url: asset.imageBase64 },
    });
  }

  // 3. 指令文本
  const styleRefLine = styleRefImageBase64 ? '【图1/艺术风格参考图】已附在上方。\n' : '';
  const charRefLine = characterAssetImages.length > 0
    ? `【角色/物品参考图】(${characterAssetImages.map((a) => a.name).join('、')}) 已附在上方。\n`
    : '';
  content.push({
    type: 'text',
    text: `${styleRefLine}${charRefLine}\n${filledPrompt}`,
  });

  return [
    {
      role: 'user',
      content,
    },
  ];
}

/**
 * 阶段5：封面生成融合
 * 公式: prompt_0_6 + {{书名}} + {{绘画风格与视觉质感控制}} + 全部分页宫格图
 */
export function fuseCoverGeneration(
  bookTitle: string,
  styleModule: string,
  gridImageBase64: string,
  prompt_0_6: string,
): ChatMessage[] {
  const filledPrompt = prompt_0_6
    .replace(/\{\{书名\}\}/g, bookTitle)
    .replace(/\{\{绘画风格与视觉质感控制\}\}/g, styleModule);

  const content: MessageContent[] = [
    { type: 'image_url', image_url: { url: gridImageBase64 } },
    {
      type: 'text',
      text: `【全部分页宫格图】已附在上方，请以此为画风与角色的唯一视觉锚点。\n\n${filledPrompt}`,
    },
  ];

  return [{ role: 'user', content }];
}

/**
 * 阶段5：环衬生成融合
 * 公式: prompt_0_7 + {{绘画风格与视觉质感控制}} + 全部分页宫格图
 */
export function fuseEndpapersGeneration(
  styleModule: string,
  gridImageBase64: string,
  prompt_0_7: string,
): ChatMessage[] {
  const filledPrompt = prompt_0_7.replace(
    /\{\{绘画风格与视觉质感控制\}\}/g,
    styleModule,
  );

  const content: MessageContent[] = [
    { type: 'image_url', image_url: { url: gridImageBase64 } },
    {
      type: 'text',
      text: `【全部分页宫格图】已附在上方，请以此为画风与调色板的唯一视觉锚点。\n\n${filledPrompt}`,
    },
  ];

  return [{ role: 'user', content }];
}

/**
 * 阶段5：扉页生成融合
 * 公式: prompt_0_8 + {{书名}} + {{绘画风格与视觉质感控制}} + 全部分页宫格图
 */
export function fuseTitlePageGeneration(
  bookTitle: string,
  styleModule: string,
  gridImageBase64: string,
  prompt_0_8: string,
): ChatMessage[] {
  const filledPrompt = prompt_0_8
    .replace(/\{\{书名\}\}/g, bookTitle)
    .replace(/\{\{绘画风格与视觉质感控制\}\}/g, styleModule);

  const content: MessageContent[] = [
    { type: 'image_url', image_url: { url: gridImageBase64 } },
    {
      type: 'text',
      text: `【全部分页宫格图】已附在上方，请以此为画风与微观装饰的唯一视觉锚点。\n\n${filledPrompt}`,
    },
  ];

  return [{ role: 'user', content }];
}
