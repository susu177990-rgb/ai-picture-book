export type StoryAgentStage = 'concept' | 'character' | 'outline' | 'storyboard';

export type StoryAgentStatus =
  | 'draft'
  | 'ready_for_storyboard'
  | 'exported'
  | 'sent_to_workbench';

export interface StoryAgentMetadata {
  stage: StoryAgentStage;
  storyTitle: string;
  logline: string;
  targetAge: string;
  protagonist: string;
  coreConflict: string;
  seriesContext: string;
  status: StoryAgentStatus;
  lastExportedAt?: number;
  lastSentToWorkbenchAt?: number;
}

export interface StoryAgentConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  createdAt?: number;
  stage: StoryAgentStage;
  status: StoryAgentStatus;
  metadata: StoryAgentMetadata;
}

export const STORY_AGENT_STAGE_ORDER: StoryAgentStage[] = [
  'concept',
  'character',
  'outline',
  'storyboard',
];

export const STORY_AGENT_STAGE_LABELS: Record<StoryAgentStage, string> = {
  concept: '故事立意',
  character: '角色与世界',
  outline: '剧情铺排',
  storyboard: '分镜整理',
};

export const STORY_AGENT_STATUS_LABELS: Record<StoryAgentStatus, string> = {
  draft: '草稿',
  ready_for_storyboard: '可整理分镜',
  exported: '已导出',
  sent_to_workbench: '已发送到工作台',
};

export const DEFAULT_STORY_AGENT_METADATA: StoryAgentMetadata = {
  stage: 'concept',
  storyTitle: '',
  logline: '',
  targetAge: '',
  protagonist: '',
  coreConflict: '',
  seriesContext: '',
  status: 'draft',
};

export function normalizeStoryAgentMetadata(
  metadata?: Partial<StoryAgentMetadata> | null,
): StoryAgentMetadata {
  const stage = STORY_AGENT_STAGE_ORDER.includes(metadata?.stage as StoryAgentStage)
    ? (metadata?.stage as StoryAgentStage)
    : DEFAULT_STORY_AGENT_METADATA.stage;
  const statusValues: StoryAgentStatus[] = [
    'draft',
    'ready_for_storyboard',
    'exported',
    'sent_to_workbench',
  ];
  const status = statusValues.includes(metadata?.status as StoryAgentStatus)
    ? (metadata?.status as StoryAgentStatus)
    : DEFAULT_STORY_AGENT_METADATA.status;

  return {
    stage,
    storyTitle: typeof metadata?.storyTitle === 'string' ? metadata.storyTitle : '',
    logline: typeof metadata?.logline === 'string' ? metadata.logline : '',
    targetAge: typeof metadata?.targetAge === 'string' ? metadata.targetAge : '',
    protagonist: typeof metadata?.protagonist === 'string' ? metadata.protagonist : '',
    coreConflict:
      typeof metadata?.coreConflict === 'string' ? metadata.coreConflict : '',
    seriesContext:
      typeof metadata?.seriesContext === 'string' ? metadata.seriesContext : '',
    status,
    lastExportedAt:
      typeof metadata?.lastExportedAt === 'number' ? metadata.lastExportedAt : undefined,
    lastSentToWorkbenchAt:
      typeof metadata?.lastSentToWorkbenchAt === 'number'
        ? metadata.lastSentToWorkbenchAt
        : undefined,
  };
}

export function getStoryAgentStageLabel(stage: StoryAgentStage): string {
  return STORY_AGENT_STAGE_LABELS[stage];
}

export function getStoryAgentStatusLabel(status: StoryAgentStatus): string {
  return STORY_AGENT_STATUS_LABELS[status];
}

function getRequiredFieldsForStage(stage: StoryAgentStage): Array<keyof StoryAgentMetadata> {
  if (stage === 'concept') {
    return ['targetAge', 'protagonist', 'coreConflict'];
  }
  return ['targetAge', 'protagonist', 'coreConflict', 'seriesContext', 'logline'];
}

export function getStoryAgentCompletion(metadata: StoryAgentMetadata): {
  ready: boolean;
  ratio: number;
  missingFields: string[];
  message: string;
} {
  const required = getRequiredFieldsForStage(metadata.stage);
  const missingFields = required.filter((key) => !String(metadata[key] ?? '').trim());
  const ratio = Math.round(((required.length - missingFields.length) / required.length) * 100);
  const fieldLabels: Record<string, string> = {
    targetAge: '目标年龄',
    protagonist: '主角',
    coreConflict: '核心矛盾',
    seriesContext: '系列定位',
    logline: 'Logline',
  };
  const missingLabels = missingFields.map((key) => fieldLabels[key]);

  let message = '';
  if (missingLabels.length === 0) {
    if (metadata.stage === 'storyboard') {
      message = '当前阶段资料完整，可以整理分镜并导出到工作台。';
    } else {
      message = '当前阶段资料完整，可以继续推进下一阶段。';
    }
  } else {
    message = `当前阶段还缺：${missingLabels.join('、')}`;
  }

  return {
    ready: missingFields.length === 0,
    ratio,
    missingFields: missingLabels,
    message,
  };
}

export function deriveStoryAgentStatus(
  metadata: StoryAgentMetadata,
  currentStatus?: StoryAgentStatus,
): StoryAgentStatus {
  const completion = getStoryAgentCompletion(metadata);
  if (!completion.ready || metadata.stage !== 'storyboard') {
    return 'draft';
  }

  if (currentStatus === 'sent_to_workbench') return 'sent_to_workbench';
  if (currentStatus === 'exported') return 'exported';
  return 'ready_for_storyboard';
}

export function mergeStoryAgentMetadata(
  current: StoryAgentMetadata,
  updates: Partial<StoryAgentMetadata>,
): StoryAgentMetadata {
  const next = normalizeStoryAgentMetadata({
    ...current,
    ...updates,
  });
  next.status = deriveStoryAgentStatus(next, updates.status ?? current.status);
  return next;
}

export function getStoryAgentQuickPrompt(
  action: 'advance' | 'rewrite' | 'summary' | 'storyboard',
  metadata: StoryAgentMetadata,
): string {
  const title = metadata.storyTitle || '当前故事';
  const stageLabel = getStoryAgentStageLabel(metadata.stage);

  if (action === 'advance') {
    return `请继续推进《${title}》的【${stageLabel}】阶段。不要重复前文，直接补足这一阶段还缺的关键内容，并明确下一步建议。`;
  }

  if (action === 'rewrite') {
    return `请重写《${title}》的【${stageLabel}】阶段内容。保持目标年龄、主角和核心矛盾一致，但输出一个质量更高、更适合绘本的版本。`;
  }

  if (action === 'summary') {
    return `请基于当前对话，整理《${title}》的故事摘要，分别给出：标题、Logline、目标年龄、主角、核心矛盾、系列定位。每项单独成行。`;
  }

  return `请把《${title}》整理到【分镜整理】阶段，输出适合导出为绘本分镜脚本的完整结构，并确保分页内容可直接进入工作台。`;
}
