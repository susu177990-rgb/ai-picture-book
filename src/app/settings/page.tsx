'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getSettings,
  saveApiSettings,
  savePromptTemplate,
  saveRoutePresets,
  syncUserPromptsFromFile,
} from '@/lib/storage';
import { testConnection, testImageConnection } from '@/lib/api-client';
import { formatSaveTime } from '@/lib/pipeline-feedback';
import type {
  ApiSettings,
  ImageProtocolType,
  PromptTemplateKey,
  RoutePreset,
} from '@/types';

type StoryAgentRuleKey =
  | 'main_prompt'
  | 'role'
  | 'rule'
  | 'skill'
  | 'flowchart'
  | 'character_reference'
  | 'story_bible_template'
  | 'spread_pacing_template'
  | 'story_page_script_template';

const PROMPT_LABELS: { key: PromptTemplateKey; label: string; desc: string }[] =
  [
    {
      key: 'prompt_0_0',
      label: '0_0 绘本生成通用设置',
      desc: '控制分辨率、全局起手式、构图法则、负面提示词等',
    },
    {
      key: 'prompt_0_3',
      label: '0_3 绘画风格分析指令',
      desc: '控制 AI 如何从参考图中提取笔触、色彩和材质',
    },
    {
      key: 'prompt_0_4',
      label: '0_4 角色/物品三视图设计指令',
      desc: '控制 AI 如何从剧本中提炼人设和物品设定',
    },
    {
      key: 'prompt_0_5',
      label: '0_5 三视图生成指令',
      desc: '控制资产图的排版与呈现逻辑',
    },
    {
      key: 'prompt_0_6',
      label: '0_6 封面生成设置',
      desc: '控制封面插画的构图、书名植入、画风克隆等',
    },
    {
      key: 'prompt_0_7',
      label: '0_7 环衬生成设置',
      desc: '控制环衬的装饰风格、图案与氛围',
    },
    {
      key: 'prompt_0_8',
      label: '0_8 扉页生成设置',
      desc: '控制扉页的克制美学、微装饰与书名设计',
    },
    {
      key: 'prompt_stage4_remove_text',
      label: '阶段4 去文字',
      desc: '以当前分页图为参考，去除画外文字',
    },
    {
      key: 'prompt_stage4_remove_seam',
      label: '阶段4 去书缝',
      desc: '以当前分页图为参考，去除中心书缝/线条/阴影',
    },
    {
      key: 'prompt_stage4_add_caption',
      label: '阶段4 添加配文',
      desc: '以当前分页图为参考，添加绘本文案，支持 {{绘本文案}} 占位符',
    },
  ];

const STORY_AGENT_RULE_LABELS: {
  key: StoryAgentRuleKey;
  label: string;
  desc: string;
}[] = [
  {
    key: 'main_prompt',
    label: 'main_prompt.md',
    desc: '纪言总控启动协议，定义阶段推进与整体输出方式。',
  },
  {
    key: 'role',
    label: 'role.md',
    desc: '纪言的人设、语气和创作身份设定。',
  },
  {
    key: 'rule',
    label: 'rule.md',
    desc: '纪言的硬性红线、格式纪律和禁止项。',
  },
  {
    key: 'skill',
    label: 'skill.md',
    desc: '纪言在搭建故事、切片和分镜时调用的内部方法。',
  },
  {
    key: 'flowchart',
    label: 'flowchart.md',
    desc: '纪言和你对话时遵循的阶段流程与推进顺序。',
  },
  {
    key: 'character_reference',
    label: 'character_reference.md',
    desc: '纪言进行角色锚定和物理细节推演时参考的角色基准文件。',
  },
  {
    key: 'story_bible_template',
    label: 'Story Bible & Treatment Template.md',
    desc: '阶段 2 输出《剧本大本营》时使用的模板。',
  },
  {
    key: 'spread_pacing_template',
    label: 'Spread Pacing Template.md',
    desc: '阶段 3 输出跨页剧情分配表时使用的模板。',
  },
  {
    key: 'story_page_script_template',
    label: 'Story Page Script & Template.md',
    desc: '阶段 4 输出分页视觉分镜时使用的模板。',
  },
];

const IMAGE_PROTOCOL_LABELS: Array<{
  value: ImageProtocolType;
  label: string;
  desc: string;
}> = [
  {
    value: 'gemini-native',
    label: 'Gemini 兼容 generateContent',
    desc: '调用 /v1beta/models/{model}:generateContent',
  },
  {
    value: 'nano-banana-generations',
    label: 'Nano Banana Generations',
    desc: '调用 /v1/images/generations',
  },
  {
    value: 'nano-banana-draw',
    label: 'Nano Banana Draw',
    desc: '调用 /v1/draw/nano-banana + /v1/draw/result',
  },
];

function getImageProtocolLabel(protocol: ImageProtocolType): string {
  return IMAGE_PROTOCOL_LABELS.find((item) => item.value === protocol)?.label ?? protocol;
}

export default function SettingsPage() {
  const [api, setApi] = useState<ApiSettings>({
    baseUrl: '',
    apiKey: '',
    llmModel: '',
    imageProtocol: 'gemini-native',
    imageModel: '',
    imageAspectRatioStage2: '16:9',
    imageSizeStage2: '1K',
    imageAspectRatioStage3: 'auto',
    imageSizeStage3: '1K',
    imageAspectRatioStage5: '21:9',
    imageSizeStage5: '4K',
  });
  const [routePresets, setRoutePresets] = useState<RoutePreset[]>([]);

  const [prompts, setPrompts] = useState<Record<PromptTemplateKey, string>>({
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
  });
  const [storyAgentRules, setStoryAgentRules] = useState<Record<StoryAgentRuleKey, string>>({
    main_prompt: '',
    role: '',
    rule: '',
    skill: '',
    flowchart: '',
    character_reference: '',
    story_bible_template: '',
    spread_pacing_template: '',
    story_page_script_template: '',
  });

  const [openPanels, setOpenPanels] = useState<Set<string>>(new Set());
  const [llmTestResult, setLlmTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [imageTestResult, setImageTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [isTestingLlm, setIsTestingLlm] = useState(false);
  const [isTestingImage, setIsTestingImage] = useState(false);
  const [apiSavedAt, setApiSavedAt] = useState('');
  const [savingRoutePresetId, setSavingRoutePresetId] = useState<string | null>(null);
  const [routePresetSavedId, setRoutePresetSavedId] = useState<string | null>(null);
  const [routePresetSavedAt, setRoutePresetSavedAt] = useState('');
  const [routePresetErrorId, setRoutePresetErrorId] = useState<string | null>(null);
  const [routePresetErrorMessage, setRoutePresetErrorMessage] = useState('');
  const [savingPromptKey, setSavingPromptKey] = useState<PromptTemplateKey | null>(null);
  const [promptSavedKey, setPromptSavedKey] = useState<PromptTemplateKey | null>(null);
  const [promptSavedAt, setPromptSavedAt] = useState('');
  const [promptErrorKey, setPromptErrorKey] = useState<PromptTemplateKey | null>(null);
  const [promptErrorMessage, setPromptErrorMessage] = useState('');
  const [savingStoryRuleKey, setSavingStoryRuleKey] = useState<StoryAgentRuleKey | null>(null);
  const [storyRuleSavedKey, setStoryRuleSavedKey] = useState<StoryAgentRuleKey | null>(null);
  const [storyRuleSavedAt, setStoryRuleSavedAt] = useState('');
  const [storyRuleErrorKey, setStoryRuleErrorKey] = useState<StoryAgentRuleKey | null>(null);
  const [storyRuleErrorMessage, setStoryRuleErrorMessage] = useState('');
  const [activeSection, setActiveSection] = useState<'api' | 'prompts' | 'story-agent'>('api');

  // Load settings on mount
  useEffect(() => {
    async function init() {
      const syncedPrompts = await syncUserPromptsFromFile();
      let nextStoryAgentRules: Record<StoryAgentRuleKey, string> = {
        main_prompt: '',
        role: '',
        rule: '',
        skill: '',
        flowchart: '',
        character_reference: '',
        story_bible_template: '',
        spread_pacing_template: '',
        story_page_script_template: '',
      };
      const settings = getSettings();
      setApi(settings.api);
      setRoutePresets(settings.routePresets);
      setPrompts(syncedPrompts);
      try {
        const res = await fetch('/api/settings/story-agent-prompts', { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as {
            prompts?: Partial<Record<StoryAgentRuleKey, string>>;
          };
          nextStoryAgentRules = {
            ...nextStoryAgentRules,
            ...(data.prompts ?? {}),
          };
        }
      } catch {
        // ignore story-agent prompt load failures
      }
      setStoryAgentRules(nextStoryAgentRules);
    }
    init();
  }, []);

  const handleSaveApi = useCallback(() => {
    saveApiSettings(api);
    setApiSavedAt(formatSaveTime());
  }, [api]);

  const handleRoutePresetChange = useCallback(
    (id: string, patch: Partial<RoutePreset>) => {
      setRoutePresets((prev) =>
        prev.map((preset) => (preset.id === id ? { ...preset, ...patch } : preset)),
      );
      setRoutePresetSavedId(null);
      setRoutePresetErrorId(null);
      setRoutePresetErrorMessage('');
    },
    [],
  );

  const handleSaveRoutePreset = useCallback(
    (id: string) => {
      setSavingRoutePresetId(id);
      setRoutePresetSavedId(null);
      setRoutePresetErrorId(null);
      setRoutePresetErrorMessage('');

      try {
        saveRoutePresets(routePresets);
        setRoutePresetSavedId(id);
        setRoutePresetSavedAt(formatSaveTime());
      } catch (error) {
        setRoutePresetErrorId(id);
        setRoutePresetErrorMessage(
          error instanceof Error ? error.message : '路线预设保存失败',
        );
      } finally {
        setSavingRoutePresetId(null);
      }
    },
    [routePresets],
  );

  const handleApplyRoutePreset = useCallback(
    (preset: RoutePreset) => {
      const nextApi: ApiSettings = {
        ...api,
        baseUrl: preset.baseUrl,
        imageProtocol: preset.imageProtocol,
        imageModel: preset.imageModel,
      };
      saveRoutePresets(routePresets);
      saveApiSettings(nextApi);
      setApi(nextApi);
      setApiSavedAt(formatSaveTime());
      setRoutePresetSavedId(preset.id);
      setRoutePresetSavedAt(formatSaveTime());
      setRoutePresetErrorId(null);
      setRoutePresetErrorMessage('');
    },
    [api, routePresets],
  );

  const handleSavePrompt = useCallback(
    async (key: PromptTemplateKey, value: string) => {
      setSavingPromptKey(key);
      setPromptSavedKey(null);
      setPromptErrorKey(null);
      setPromptErrorMessage('');

      try {
        const nextPrompts = await savePromptTemplate(key, value);
        setPrompts(nextPrompts);
        setPromptSavedKey(key);
        setPromptSavedAt(formatSaveTime());
      } catch (error) {
        setPromptErrorKey(key);
        setPromptErrorMessage(
          error instanceof Error ? error.message : '提示词写入项目文件失败',
        );
      } finally {
        setSavingPromptKey(null);
      }
    },
    [],
  );

  const handleSaveStoryAgentRule = useCallback(
    async (key: StoryAgentRuleKey, value: string) => {
      setSavingStoryRuleKey(key);
      setStoryRuleSavedKey(null);
      setStoryRuleErrorKey(null);
      setStoryRuleErrorMessage('');

      try {
        const res = await fetch('/api/settings/story-agent-prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, content: value }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          throw new Error(data.error || '纪言规则写入失败');
        }
        setStoryRuleSavedKey(key);
        setStoryRuleSavedAt(formatSaveTime());
      } catch (error) {
        setStoryRuleErrorKey(key);
        setStoryRuleErrorMessage(
          error instanceof Error ? error.message : '纪言规则写入失败',
        );
      } finally {
        setSavingStoryRuleKey(null);
      }
    },
    [],
  );

  const handleTestConnection = useCallback(async () => {
    setIsTestingLlm(true);
    setLlmTestResult(null);
    const result = await testConnection(api.baseUrl, api.apiKey, api.llmModel);
    setLlmTestResult(result);
    setIsTestingLlm(false);
  }, [api]);

  const handleTestImageConnection = useCallback(async () => {
    setIsTestingImage(true);
    setImageTestResult(null);
    const result = await testImageConnection({
      baseUrl: api.baseUrl,
      apiKey: api.apiKey,
      imageProtocol: api.imageProtocol,
      model: api.imageModel,
      imageAspectRatio: '1:1',
      imageSize: '1K',
    });
    setImageTestResult(result);
    setIsTestingImage(false);
  }, [api]);

  const togglePanel = (key: string) => {
    setOpenPanels((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  let statusText: string | null = null;
  if (routePresetErrorId) {
    statusText = routePresetErrorMessage;
  } else if (storyRuleErrorKey) {
    statusText = storyRuleErrorMessage;
  } else if (promptErrorKey) {
    statusText = promptErrorMessage;
  } else if (savingRoutePresetId) {
    statusText = '路线预设正在保存...';
  } else if (routePresetSavedId) {
    statusText = `路线预设已保存/应用 · ${routePresetSavedAt}`;
  } else if (savingStoryRuleKey) {
    statusText = '纪言规则正在写入项目文件...';
  } else if (savingPromptKey) {
    statusText = '提示词正在写入项目文件...';
  } else if (storyRuleSavedKey) {
    statusText = `纪言规则已写入项目文件 · ${storyRuleSavedAt}`;
  } else if (promptSavedKey) {
    statusText = `提示词已写入项目文件与浏览器 · ${promptSavedAt}`;
  } else if (apiSavedAt) {
    statusText = `API 配置已保存到当前浏览器 · ${apiSavedAt}`;
  }

  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-title">设置目录</div>
        <button type="button" className={`settings-nav-item ${activeSection === 'api' ? 'active' : ''}`} onClick={() => setActiveSection('api')}>
          API 连接
        </button>
        <button type="button" className={`settings-nav-item ${activeSection === 'prompts' ? 'active' : ''}`} onClick={() => setActiveSection('prompts')}>
          提示词模板
        </button>
        <button type="button" className={`settings-nav-item ${activeSection === 'story-agent' ? 'active' : ''}`} onClick={() => setActiveSection('story-agent')}>
          纪言规则
        </button>
        <div className="settings-sidebar-note">
          写故事里的固定规则、人格与流程约束，都在这里直接修改项目文件。
        </div>
      </aside>

      <div className="settings-main">
        <div className="page-header">
          <h1 className="page-title">设置</h1>
          <p className="page-description">
            统一管理 API、绘本提示词和纪言规则。修改后点击保存即可生效。
          </p>
        </div>

      {/* API Configuration */}
      {activeSection === 'api' && (
        <>
          <div className="card mb-16">
            <div className="card-header">
              <div>
                <div className="card-title">API 连接配置</div>
                <div className="card-subtitle">
                  当前配置同时服务 LLM 与生图；生图路线支持 Gemini 兼容、Nano Banana
                  Generations 和 Nano Banana Draw。
                </div>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">API 接口地址 (Base URL)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="https://api.laozhang.ai"
                  value={api.baseUrl}
                  onChange={(e) => setApi({ ...api, baseUrl: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">API 密钥 (API Key)</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="sk-..."
                  value={api.apiKey}
                  onChange={(e) => setApi({ ...api, apiKey: e.target.value })}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">大语言模型 (LLM Model)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="gpt-4o"
                  value={api.llmModel}
                  onChange={(e) => setApi({ ...api, llmModel: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">生图路线 (Image Protocol)</label>
                <select
                  className="form-input"
                  value={api.imageProtocol}
                  onChange={(e) =>
                    setApi({
                      ...api,
                      imageProtocol: e.target.value as ImageProtocolType,
                    })
                  }
                >
                  {IMAGE_PROTOCOL_LABELS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <div className="card-subtitle" style={{ marginTop: 4, fontSize: 12 }}>
                  {IMAGE_PROTOCOL_LABELS.find((item) => item.value === api.imageProtocol)?.desc}
                </div>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">生图模型 (Image Model)</label>
                <div
                  style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
                >
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      setApi({
                        ...api,
                        imageProtocol: 'gemini-native',
                        imageModel: 'gemini-3.1-flash-image-preview',
                      })
                    }
                  >
                    Gemini 3.1 Flash
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      setApi({
                        ...api,
                        imageProtocol: 'gemini-native',
                        imageModel: 'gemini-3-pro-image-preview',
                      })
                    }
                  >
                    Gemini 3 Pro
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      setApi({
                        ...api,
                        imageProtocol: 'gemini-native',
                        imageModel: 'nano-banana-fast',
                      })
                    }
                  >
                    Nano Banana Fast
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() =>
                      setApi({
                        ...api,
                        imageProtocol: 'nano-banana-generations',
                        imageModel: 'nano-banana-2',
                      })
                    }
                  >
                    Nano Banana 2
                  </button>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="nano-banana-fast"
                    value={api.imageModel}
                    onChange={(e) => setApi({ ...api, imageModel: e.target.value })}
                    style={{ flex: 1, minWidth: 220 }}
                  />
                </div>
                <div className="card-subtitle" style={{ marginTop: 4, fontSize: 12 }}>
                  当前路线：{getImageProtocolLabel(api.imageProtocol)}
                </div>
              </div>
            </div>

            {llmTestResult && (
              <div
                className={`alert ${llmTestResult.success ? 'alert-success' : 'alert-error'}`}
              >
                {llmTestResult.success ? '✅' : '❌'} LLM：{llmTestResult.message}
              </div>
            )}

            {imageTestResult && (
              <div
                className={`alert ${imageTestResult.success ? 'alert-success' : 'alert-error'}`}
              >
                {imageTestResult.success ? '✅' : '❌'} 生图：{imageTestResult.message}
              </div>
            )}

            <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" onClick={handleSaveApi}>
                {apiSavedAt ? '✅ 已保存' : '💾 保存配置'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleTestConnection}
                disabled={isTestingLlm || !api.baseUrl || !api.apiKey || !api.llmModel}
              >
                {isTestingLlm ? (
                  <>
                    <span className="spinner" /> 测试中...
                  </>
                ) : (
                  '🔗 测试 LLM'
                )}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleTestImageConnection}
                disabled={isTestingImage || !api.baseUrl || !api.apiKey || !api.imageModel}
              >
                {isTestingImage ? (
                  <>
                    <span className="spinner" /> 测试中...
                  </>
                ) : (
                  '🖼️ 测试当前生图路线'
                )}
              </button>
            </div>
            {apiSavedAt && (
              <div className="card-subtitle" style={{ marginTop: 10 }}>
                已保存到当前浏览器 · {apiSavedAt}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">路线预设</div>
                <div className="card-subtitle">
                  预设只负责快捷切换 Host、生图路线和生图模型，不会覆盖 API Key 与
                  LLM Model。
                </div>
              </div>
            </div>

            {routePresets.map((preset) => (
              <div className="collapsible" key={preset.id}>
                <button
                  type="button"
                  className="collapsible-header"
                  onClick={() => togglePanel(`route-preset:${preset.id}`)}
                >
                  <div>
                    <span>{preset.name || '未命名预设'}</span>
                    <div className="card-subtitle" style={{ fontWeight: 400 }}>
                      {preset.baseUrl || '未填写 Host'} · {getImageProtocolLabel(preset.imageProtocol)} ·{' '}
                      {preset.imageModel || '未填写模型'}
                    </div>
                  </div>
                  <span
                    className={`collapsible-chevron ${openPanels.has(`route-preset:${preset.id}`) ? 'open' : ''}`}
                  >
                    ▼
                  </span>
                </button>
                <div
                  className={`collapsible-body ${openPanels.has(`route-preset:${preset.id}`) ? 'open' : ''}`}
                >
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">预设名称</label>
                      <input
                        type="text"
                        className="form-input"
                        value={preset.name}
                        onChange={(e) =>
                          handleRoutePresetChange(preset.id, { name: e.target.value })
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Host</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="https://grsai.dakka.com.cn"
                        value={preset.baseUrl}
                        onChange={(e) =>
                          handleRoutePresetChange(preset.id, { baseUrl: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">生图路线</label>
                      <select
                        className="form-input"
                        value={preset.imageProtocol}
                        onChange={(e) =>
                          handleRoutePresetChange(preset.id, {
                            imageProtocol: e.target.value as ImageProtocolType,
                          })
                        }
                      >
                        {IMAGE_PROTOCOL_LABELS.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">默认生图模型</label>
                      <input
                        type="text"
                        className="form-input"
                        value={preset.imageModel}
                        onChange={(e) =>
                          handleRoutePresetChange(preset.id, { imageModel: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleSaveRoutePreset(preset.id)}
                      disabled={savingRoutePresetId === preset.id}
                    >
                      {savingRoutePresetId === preset.id
                        ? '保存中...'
                        : routePresetSavedId === preset.id
                          ? '✅ 已保存'
                          : '💾 保存预设'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleApplyRoutePreset(preset)}
                      disabled={!preset.baseUrl || !preset.imageModel}
                    >
                      ⚡ 应用到当前配置
                    </button>
                    {routePresetErrorId === preset.id && (
                      <span
                        className="card-subtitle"
                        style={{ fontSize: 12, color: 'var(--error)' }}
                      >
                        {routePresetErrorMessage}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Prompt Templates */}
      {activeSection === 'prompts' && (
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">提示词模板 (Prompt Templates)</div>
            <div className="card-subtitle">
              编辑核心指令模板。修改后请点击「保存」按钮，系统会同时写入浏览器本地存储与项目文件，保证重启后仍可恢复。
            </div>
          </div>
        </div>

        {PROMPT_LABELS.map(({ key, label, desc }) => (
          <div className="collapsible" key={key}>
            <button
              type="button"
              className="collapsible-header"
              onClick={() => togglePanel(key)}
            >
              <div>
                <span>{label}</span>
                <div className="card-subtitle" style={{ fontWeight: 400 }}>
                  {desc}
                </div>
              </div>
              <span
                className={`collapsible-chevron ${openPanels.has(key) ? 'open' : ''}`}
              >
                ▼
              </span>
            </button>
            <div
              className={`collapsible-body ${openPanels.has(key) ? 'open' : ''}`}
            >
              <textarea
                className="form-input form-textarea"
                style={{ minHeight: '240px' }}
                value={prompts[key]}
                onChange={(e) => {
                  const newVal = e.target.value;
                  setPrompts((prev) => ({ ...prev, [key]: newVal }));
                }}
              />
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => handleSavePrompt(key, prompts[key])}
                  disabled={savingPromptKey === key}
                >
                  {savingPromptKey === key
                    ? '保存中...'
                    : promptSavedKey === key
                      ? '✅ 已保存'
                      : '💾 保存'}
                </button>
                {promptSavedKey === key && (
                  <span className="card-subtitle" style={{ fontSize: 12 }}>
                    已写入项目文件与当前浏览器 · {promptSavedAt}
                  </span>
                )}
                {promptErrorKey === key && (
                  <span className="card-subtitle" style={{ fontSize: 12, color: 'var(--error)' }}>
                    {promptErrorMessage}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      )}

      {activeSection === 'story-agent' && (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">纪言固定规则</div>
              <div className="card-subtitle">
                直接编辑写故事里纪言使用的核心规则文件。保存后会写回项目内的 Markdown 文件。
              </div>
            </div>
          </div>
          {STORY_AGENT_RULE_LABELS.map(({ key, label, desc }) => (
            <div className="collapsible" key={key}>
              <button
                type="button"
                className="collapsible-header"
                onClick={() => togglePanel(`story-agent:${key}`)}
              >
                <div>
                  <span>{label}</span>
                  <div className="card-subtitle" style={{ fontWeight: 400 }}>
                    {desc}
                  </div>
                </div>
                <span
                  className={`collapsible-chevron ${openPanels.has(`story-agent:${key}`) ? 'open' : ''}`}
                >
                  ▼
                </span>
              </button>
              <div
                className={`collapsible-body ${openPanels.has(`story-agent:${key}`) ? 'open' : ''}`}
              >
                <textarea
                  className="form-input form-textarea"
                  style={{ minHeight: '280px' }}
                  value={storyAgentRules[key]}
                  onChange={(e) => {
                    const newVal = e.target.value;
                    setStoryAgentRules((prev) => ({ ...prev, [key]: newVal }));
                  }}
                />
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => handleSaveStoryAgentRule(key, storyAgentRules[key])}
                    disabled={savingStoryRuleKey === key}
                  >
                    {savingStoryRuleKey === key
                      ? '保存中...'
                      : storyRuleSavedKey === key
                        ? '✅ 已保存'
                        : '💾 保存'}
                  </button>
                  {storyRuleSavedKey === key && (
                    <span className="card-subtitle" style={{ fontSize: 12 }}>
                      已写入项目文件 · {storyRuleSavedAt}
                    </span>
                  )}
                  {storyRuleErrorKey === key && (
                    <span className="card-subtitle" style={{ fontSize: 12, color: 'var(--error)' }}>
                      {storyRuleErrorMessage}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {statusText && (
        <div
          className={`settings-status-bar ${routePresetErrorId || promptErrorKey || storyRuleErrorKey ? 'error' : ''}`}
        >
          {statusText}
        </div>
      )}
      </div>
    </div>
  );
}
