'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { parseScript } from '@/lib/text-parser';
import { usePipelineStore } from '@/store/pipeline-store';
import {
  STORY_AGENT_STAGE_ORDER,
  getStoryAgentStageLabel,
  type StoryAgentMetadata,
} from '@/lib/story-agent-types';

interface Message {
  role: string;
  content: string;
}

interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  llmModel: string;
}

interface StoryAgentChatProps {
  sessionId: string | null;
  title: string;
  metadata: StoryAgentMetadata;
  messages: Message[];
  onUpdate: (payload: {
    sessionId: string | null;
    title?: string;
    metadata?: StoryAgentMetadata;
    messages?: Message[];
  }) => void;
  onPersistMetadata: (payload: {
    title?: string;
    metadata?: Partial<StoryAgentMetadata>;
  }) => Promise<void>;
  loadingConversation: boolean;
  api: ApiConfig | null;
}

function extractStoryboardMarkdown(markdown: string): string {
  const marker = '## 四、跨页视觉分镜脚本';
  const index = markdown.indexOf(marker);
  if (index >= 0) {
    return markdown.slice(index + marker.length).trim();
  }
  return markdown.trim();
}

const STARTER_CARDS = [
  {
    title: '选择年龄段',
    desc: '先钉住受众年龄，后面的语言密度和情绪强度才不会跑偏。',
    prompt: '我们先确定这本绘本的目标年龄段。请你帮我判断这个故事更适合几岁孩子，并说明原因。',
  },
  {
    title: '确认主角',
    desc: '主角必须具体，后面的人物行动和情绪驱动力才会稳定。',
    prompt: '请帮我明确这本绘本的主角设定。我要一个适合儿童绘本、可持续展开的主角方案。',
  },
  {
    title: '明确小麻烦',
    desc: '先找到孩子的心理小麻烦，故事才会有真实的情绪抓手。',
    prompt: '请帮我找到这个故事最适合孩子的“心理小麻烦”，让故事拥有清晰的情绪核心。',
  },
  {
    title: '开始第一轮对话',
    desc: '从立意切入，快速建立故事方向和后续可推进的结构。',
    prompt: '我们开始第一轮，请按故事立意阶段帮我搭建这个绘本项目，先从主题、主角和核心矛盾开始。',
  },
];

export default function StoryAgentChat({
  sessionId,
  title,
  metadata,
  messages,
  onUpdate,
  onPersistMetadata,
  loadingConversation,
  api,
}: StoryAgentChatProps) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sendingToWorkbench, setSendingToWorkbench] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasWorkbenchProgress = usePipelineStore(
    (state) =>
      Boolean(state.scriptRawText) ||
      state.scriptPages.length > 0 ||
      Boolean(state.styleRefImage) ||
      state.assets.length > 0 ||
      state.finalPages.length > 0 ||
      state.bindingImages.length > 0,
  );

  const currentStageIndex = STORY_AGENT_STAGE_ORDER.indexOf(metadata.stage);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    if (!api?.baseUrl || !api?.llmModel) {
      setNotice({
        type: 'error',
        message: '请先在设置页面配置 Base URL、API Key 和 LLM Model。',
      });
      return;
    }

    setNotice(null);
    setInput('');
    setLoading(true);
    const optimisticMessages = [...messages, { role: 'user', content: text }];
    onUpdate({
      sessionId,
      title,
      metadata,
      messages: optimisticMessages,
    });

    try {
      const res = await fetch('/api/story-agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: text,
          api: {
            baseUrl: api.baseUrl,
            apiKey: api.apiKey,
            model: api.llmModel,
          },
        }),
      });
      const data = (await res.json()) as {
        sessionId: string;
        title?: string;
        metadata?: StoryAgentMetadata;
        messages?: Message[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || 'Request failed');

      onUpdate({
        sessionId: data.sessionId,
        title: data.title,
        metadata: data.metadata,
        messages: data.messages,
      });
    } catch (error) {
      onUpdate({
        sessionId,
        title,
        metadata,
        messages: [
          ...optimisticMessages,
          {
            role: 'assistant',
            content: `错误：${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      });
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : '发送失败',
      });
    } finally {
      setLoading(false);
    }
  };

  const saveZipWithDialog = async (
    blob: Blob,
    suggestedName = '分镜脚本.zip',
  ) => {
    const fallbackDownload = () => {
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);
      anchor.download = suggestedName;
      anchor.click();
      URL.revokeObjectURL(anchor.href);
    };

    try {
      if ('showSaveFilePicker' in window) {
        const handle = await (
          window as Window & {
            showSaveFilePicker?: (options: {
              suggestedName: string;
              types: { description: string; accept: Record<string, string[]> }[];
            }) => Promise<FileSystemFileHandle>;
          }
        ).showSaveFilePicker?.({
          suggestedName,
          types: [
            {
              description: 'ZIP 压缩包',
              accept: { 'application/zip': ['.zip'] },
            },
          ],
        });
        if (handle) {
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          return;
        }
      }
    } catch {
      // fallback below
    }

    fallbackDownload();
  };

  const markExported = async () => {
    if (!sessionId) return;
    await onPersistMetadata({
      metadata: {
        status: 'exported',
        lastExportedAt: Date.now(),
      },
    });
  };

  const markSentToWorkbench = async () => {
    if (!sessionId) return;
    await onPersistMetadata({
      metadata: {
        status: 'sent_to_workbench',
        lastSentToWorkbenchAt: Date.now(),
      },
    });
  };

  const readResponseError = async (response: Response, fallback: string) => {
    const text = await response.text();
    if (!text) return fallback;

    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      return parsed.error || parsed.message || fallback;
    } catch {
      return text;
    }
  };

  const handleExport = async () => {
    if (!sessionId || exporting) {
      if (!sessionId) {
        setNotice({ type: 'info', message: '请先开始对话，再导出分镜。' });
      }
      return;
    }

    setExporting(true);
    setNotice(null);
    try {
      const res = await fetch('/api/story-agent/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          ...(api?.baseUrl || api?.llmModel
            ? {
                api: {
                  baseUrl: api.baseUrl,
                  apiKey: api.apiKey,
                  model: api.llmModel,
                },
              }
            : {}),
        }),
      });
      const contentType = res.headers.get('content-type') || '';

      if (contentType.includes('application/zip')) {
        const blob = await res.blob();
        const disposition = res.headers.get('content-disposition') || '';
        const matched = disposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
        const filename = matched
          ? decodeURIComponent(matched[1].replace(/^["']|["']$/g, ''))
          : '分镜脚本.zip';
        await saveZipWithDialog(blob, filename);
        await markExported();
        setNotice({ type: 'success', message: '分镜 ZIP 已导出。' });
        return;
      }

      if (!res.ok) {
        throw new Error(await readResponseError(res, '导出失败'));
      }

      const text = await res.text();
      const trimmed = text.trim();
      if (!trimmed.startsWith('#')) {
        throw new Error('响应格式异常');
      }

      const saveRes = await fetch('/api/story-agent/export/save-markdown', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: trimmed,
      });
      if (!saveRes.ok) {
        throw new Error(await readResponseError(saveRes, 'Markdown 保存失败'));
      }
      const blob = await saveRes.blob();
      const disposition = saveRes.headers.get('content-disposition') || '';
      const matched = disposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
      const filename = matched
        ? decodeURIComponent(matched[1].replace(/^["']|["']$/g, ''))
        : '分镜脚本.zip';
      await saveZipWithDialog(blob, filename);
      await markExported();
      setNotice({ type: 'success', message: '分镜 ZIP 已导出。' });
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : '导出失败',
      });
    } finally {
      setExporting(false);
    }
  };

  const handleSendToWorkbench = async () => {
    if (!sessionId || sendingToWorkbench) {
      if (!sessionId) {
        setNotice({ type: 'info', message: '请先开始对话，再发送到工作台。' });
      }
      return;
    }
    if (
      hasWorkbenchProgress &&
      !window.confirm('导入将覆盖当前工作台的剧本与后续产物，但不会影响设置页内容。是否继续？')
    ) {
      return;
    }

    setSendingToWorkbench(true);
    setNotice(null);
    try {
      const res = await fetch('/api/story-agent/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          output: 'markdown',
          ...(api?.baseUrl || api?.llmModel
            ? {
                api: {
                  baseUrl: api.baseUrl,
                  apiKey: api.apiKey,
                  model: api.llmModel,
                },
              }
            : {}),
        }),
      });
      if (!res.ok) {
        throw new Error(await readResponseError(res, '导出 Markdown 失败'));
      }
      const markdown = await res.text();
      const storyboardMarkdown = extractStoryboardMarkdown(markdown);
      const parsedPages = parseScript(storyboardMarkdown);
      if (parsedPages.length === 0) {
        throw new Error('导出的 Markdown 未解析出分页');
      }

      const store = usePipelineStore.getState();
      store.resetAll();
      store.setScriptRawText(storyboardMarkdown);
      store.setScriptPages(parsedPages);
      sessionStorage.setItem(
        'story-agent-handoff-message',
        '剧本已从纪言导入，请继续上传风格参考图',
      );
      await markSentToWorkbench();
      router.push('/');
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : '发送失败',
      });
    } finally {
      setSendingToWorkbench(false);
    }
  };

  if (loadingConversation) {
    return (
      <div className="story-agent-loading">
        <span className="spinner" style={{ width: 32, height: 32 }} />
        <div>加载项目中...</div>
      </div>
    );
  }

  return (
    <div className="story-agent-chat-shell">
      <div className="card story-agent-chat-card">
        {notice && (
          <div className={`alert ${notice.type === 'success' ? 'alert-success' : notice.type === 'error' ? 'alert-error' : 'alert-info'}`}>
            {notice.type === 'success' ? '✅' : notice.type === 'error' ? '❌' : 'ℹ️'} {notice.message}
          </div>
        )}

        <div className="story-agent-message-list">
          {messages.length === 0 ? (
            <div className="story-agent-empty-state">
              <div className="story-agent-empty-copy">
                <h3>从故事立意开始</h3>
                <p>
                  先明确年龄段、主角和心理小麻烦。你可以直接输入想法，或先用下面几张起步卡生成第一轮问题。
                </p>
              </div>
              <div className="story-agent-starter-grid">
                {STARTER_CARDS.map((card) => (
                  <button
                    key={card.title}
                    type="button"
                    className="story-agent-starter-card"
                    onClick={() => setInput(card.prompt)}
                  >
                    <div className="story-agent-starter-title">{card.title}</div>
                    <div className="story-agent-starter-desc">{card.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`story-agent-message-row ${message.role === 'user' ? 'user' : 'assistant'}`}
              >
                <div className={`story-agent-message-bubble ${message.role === 'user' ? 'user' : 'assistant'}`}>
                  {message.role === 'assistant' ? (
                    <div className="story-agent-markdown">
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
                  )}
                </div>
              </div>
            ))
          )}

          {loading && (
            <div className="story-agent-thinking">
              <span className="spinner" />
              <span>纪言正在整理这一轮内容...</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="story-agent-composer">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="直接输入你现在想推进的问题、设定或片段，按 Enter 发送，Shift + Enter 换行。"
            rows={4}
            disabled={loading}
            className="form-input story-agent-composer-textarea"
          />
          <div className="story-agent-composer-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void sendMessage()}
              disabled={loading || !input.trim()}
            >
              {loading ? '发送中...' : '发送'}
            </button>
            <div className="story-agent-composer-tools">
              <div className="story-agent-composer-stage-progress">
                {STORY_AGENT_STAGE_ORDER.map((stage, index) => {
                  const state =
                    index < currentStageIndex ? 'done' : index === currentStageIndex ? 'active' : 'pending';
                  return (
                    <div key={stage} className={`story-agent-stage-item ${state}`}>
                      <div className={`story-agent-stage-dot ${state}`}>{index + 1}</div>
                      <div className="story-agent-stage-label">{getStoryAgentStageLabel(stage)}</div>
                    </div>
                  );
                })}
              </div>
              <div className="story-agent-composer-hint">
                {metadata.stage === 'storyboard'
                  ? '可直接导出或发送到工作台'
                  : '建议整理到分镜阶段后再导出'}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void handleExport()}
                disabled={!sessionId || exporting}
              >
                {exporting ? '导出中...' : '导出分镜'}
              </button>
              <button
                type="button"
                className={`btn btn-sm ${metadata.stage === 'storyboard' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => void handleSendToWorkbench()}
                disabled={!sessionId || sendingToWorkbench}
              >
                {sendingToWorkbench ? '发送中...' : '发送到工作台'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
