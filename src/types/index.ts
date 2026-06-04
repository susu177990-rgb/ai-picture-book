// ============================================================
// AI Picture Book Generator - Core Type Definitions
// ============================================================

/** 报告 3.1：比例类型，覆盖当前项目已开放的全部比例选项 */
export type AspectRatioType =
  | 'auto'
  | '1:1'
  | '1:2'
  | '2:1'
  | '2:3'
  | '3:2'
  | '3:4'
  | '4:3'
  | '4:5'
  | '5:4'
  | '9:16'
  | '16:9'
  | '19:7'
  | '21:9';

/** 报告 4.1：画质类型 */
export type ImageSizeType = '1K' | '2K' | '4K';

/** 生图接口协议 */
export type ImageProtocolType =
  | 'gemini-native'
  | 'nano-banana-generations'
  | 'nano-banana-draw';

/** 路线预设 */
export interface RoutePreset {
  id: string;
  name: string;
  baseUrl: string;
  imageProtocol: ImageProtocolType;
  imageModel: string;
}

/** 用户 API 配置 */
export interface ApiSettings {
  baseUrl: string;
  apiKey: string;
  llmModel: string;
  imageProtocol: ImageProtocolType;
  imageModel: string;
  /** 阶段2 角色/物品三视图 — 图片比例 */
  imageAspectRatioStage2: AspectRatioType;
  /** 阶段2 角色/物品三视图 — 生图画质 */
  imageSizeStage2: ImageSizeType;
  /** 阶段3 分页图 — 图片比例 */
  imageAspectRatioStage3: AspectRatioType;
  /** 阶段3 分页图 — 生图画质 */
  imageSizeStage3: ImageSizeType;
  /** 阶段5 封面/环衬/扉页 — 图片比例 */
  imageAspectRatioStage5: AspectRatioType;
  /** 阶段5 封面/环衬/扉页 — 生图画质 */
  imageSizeStage5: ImageSizeType;
}

/** 提示词模板 key */
export type PromptTemplateKey =
  | 'prompt_0_0'
  | 'prompt_0_3'
  | 'prompt_0_4'
  | 'prompt_0_5'
  | 'prompt_0_6'
  | 'prompt_0_7'
  | 'prompt_0_8'
  | 'prompt_stage4_remove_text'
  | 'prompt_stage4_remove_seam'
  | 'prompt_stage4_add_caption';

/** 全局设置 */
export interface AppSettings {
  api: ApiSettings;
  routePresets: RoutePreset[];
  prompts: Record<PromptTemplateKey, string>;
}

/** 分页剧本切片 */
export interface PageSlice {
  pageNumber: number;
  content: string;
  /** 本页出场的角色名（阶段3动态分配时填充） */
  appearingCharacters?: string[];
}

/** 角色/物品切片 */
export interface CharacterSlice {
  type: 'character' | 'item';
  index: number;
  name: string;
  nameCN: string;
  designAnalysis: string;
  prompt: string;
  rawText: string;
}

/** 资产图片 (阶段2产物 2_x) */
export interface AssetImage {
  id: string;
  characterSlice: CharacterSlice;
  imageData: string; // Base64 or data URL
  status: 'pending' | 'generating' | 'done' | 'failed';
  approved: boolean;
  errorMessage?: string;
  /** 手动添加的资产，不支持重新生成 */
  manual?: boolean;
  /** 重新生成前的历史版本，用于「上一张」回退 */
  imageHistory?: string[];
  /** 执行「上一张」后暂存的新图，用于「下一张」恢复 */
  imageRedoStack?: string[];
}

/** 装帧图类型 (阶段5) */
export type BindingImageType = 'cover' | 'endpapers' | 'titlepage';

/** 装帧图 (阶段5产物：封面、环衬、扉页) */
export interface BindingImage {
  id: string;
  type: BindingImageType;
  imageData: string;
  status: 'pending' | 'generating' | 'done' | 'failed';
  approved: boolean;
  errorMessage?: string;
  /** 选中的角色/物品参考图 asset id 列表，与阶段4 同一逻辑 */
  selectedRefAssetIds?: string[];
  /** 重新生成前的历史版本，用于「上一张」回退 */
  imageHistory?: string[];
  /** 执行「上一张」后暂存的新图，用于「下一张」恢复 */
  imageRedoStack?: string[];
}

/** 分页成品图片 (阶段3产物 3_x) */
export interface PageImage {
  id: string;
  pageNumber: number;
  pageSlice: PageSlice;
  imageData: string;
  status: 'pending' | 'generating' | 'done' | 'failed';
  approved: boolean;
  errorMessage?: string;
  /** 是否使用艺术风格参考图，默认 true */
  useStyleRef?: boolean;
  /** 本页选中的角色/物品参考图 asset id 列表（含自动分配与手动调整） */
  selectedRefAssetIds?: string[];
  /** 重新生成前的历史版本，用于「上一张」回退 */
  imageHistory?: string[];
  /** 执行「上一张」后暂存的新图，用于「下一张」恢复 */
  imageRedoStack?: string[];
}

/** 流水线阶段 */
export type PipelineStage = 'upload' | 'stage1' | 'stage2' | 'stage3' | 'done' | 'stage5';

/** 流水线子步骤 */
export type Stage1Step = 'style_analysis' | 'character_extraction';

/** 画廊项目状态 */
export type GalleryProjectStatus = 'draft' | 'completed';

/** 可恢复的工作台项目快照 */
export interface WorkbenchProjectSnapshot {
  currentStage: PipelineStage;
  stage1Step: Stage1Step | null;
  scriptFileName: string;
  scriptRawText: string;
  scriptPages: PageSlice[];
  styleRefImage: string;
  styleModule: string;
  characterPromptsRaw: string;
  characterSlices: CharacterSlice[];
  assets: AssetImage[];
  finalPages: PageImage[];
  bookTitle: string;
  bindingImages: BindingImage[];
  pageGridImage: string;
  lastUpdatedAt: number;
  activeProjectId: string;
  activeProjectName: string;
  activeProjectStatus: GalleryProjectStatus | null;
}

/** OpenAI 兼容消息格式 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | MessageContent[];
}

export interface MessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string; // Base64 data URL or http URL
  };
}

/** API 响应 */
export interface LLMResponse {
  text?: string;
  images?: string[]; // Base64 encoded images
}

/** 任务调度 */
export interface TaskItem {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  retryCount: number;
  error?: string;
  execute: () => Promise<void>;
}
