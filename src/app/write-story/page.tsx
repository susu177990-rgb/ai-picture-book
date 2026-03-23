'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSettings } from '@/lib/storage';
import StoryAgentSidebar from '@/components/story-agent/StoryAgentSidebar';
import StoryAgentChat from '@/components/story-agent/StoryAgentChat';
import StoryAgentSummaryPanel from '@/components/story-agent/StoryAgentSummaryPanel';
import {
  DEFAULT_STORY_AGENT_METADATA,
  normalizeStoryAgentMetadata,
  type StoryAgentMetadata,
} from '@/lib/story-agent-types';

interface Message {
  role: string;
  content: string;
}

interface StoryAgentConversationResponse {
  sessionId: string | null;
  title?: string;
  messages?: Message[];
  metadata?: StoryAgentMetadata;
}

export default function WriteStoryPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [metadata, setMetadata] = useState<StoryAgentMetadata>(DEFAULT_STORY_AGENT_METADATA);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sidebarRefreshNonce, setSidebarRefreshNonce] = useState(0);
  const [showConversationPanel, setShowConversationPanel] = useState(false);
  const [showSummaryPanel, setShowSummaryPanel] = useState(false);
  const [api, setApi] = useState<{
    baseUrl: string;
    apiKey: string;
    llmModel: string;
  } | null>(null);

  useEffect(() => {
    const settings = getSettings();
    setApi({
      baseUrl: settings.api.baseUrl,
      apiKey: settings.api.apiKey,
      llmModel: settings.api.llmModel,
    });
  }, []);

  const applyConversationState = useCallback((data: StoryAgentConversationResponse) => {
    setSessionId(data.sessionId);
    setTitle(data.title ?? '');
    setMessages(data.messages ?? []);
    setMetadata(normalizeStoryAgentMetadata(data.metadata));
    setSidebarRefreshNonce((value) => value + 1);
  }, []);

  const resetConversationState = useCallback(() => {
    setSessionId(null);
    setTitle('');
    setMessages([]);
    setMetadata(DEFAULT_STORY_AGENT_METADATA);
  }, []);

  const handleNewConversation = useCallback(async () => {
    try {
      const res = await fetch('/api/story-agent/conversations', {
        method: 'POST',
      });
      const data = (await res.json()) as StoryAgentConversationResponse;
      if (res.ok && data.sessionId) {
        applyConversationState({
          sessionId: data.sessionId,
          title: data.title,
          messages: [],
          metadata: data.metadata,
        });
      } else {
        resetConversationState();
      }
    } catch {
      resetConversationState();
    }
  }, [applyConversationState, resetConversationState]);

  const handleSelectConversation = useCallback(
    async (id: string) => {
      if (id === sessionId) return;
      setLoadingConversation(true);
      try {
        const res = await fetch(`/api/story-agent/conversations/${id}`);
        const data = (await res.json()) as StoryAgentConversationResponse;
        if (res.ok) {
          applyConversationState({
            sessionId: data.sessionId,
            title: data.title,
            messages: data.messages,
            metadata: data.metadata,
          });
        } else {
          resetConversationState();
        }
      } catch {
        resetConversationState();
      } finally {
        setLoadingConversation(false);
      }
    },
    [applyConversationState, resetConversationState, sessionId],
  );

  const patchConversation = useCallback(
    async (payload: { title?: string; metadata?: Partial<StoryAgentMetadata> }) => {
      if (!sessionId) return;
      const res = await fetch(`/api/story-agent/conversations/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        title?: string;
        metadata?: StoryAgentMetadata;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || '保存失败');
      }
      setTitle(data.title ?? title);
      setMetadata(normalizeStoryAgentMetadata(data.metadata));
      setSidebarRefreshNonce((value) => value + 1);
    },
    [sessionId, title],
  );

  const handleSaveSummary = useCallback(
    async (payload: { title: string; metadata: StoryAgentMetadata }) => {
      await patchConversation({
        title: payload.title,
        metadata: payload.metadata,
      });
    },
    [patchConversation],
  );

  const handleChatUpdate = useCallback(
    (data: StoryAgentConversationResponse) => {
      applyConversationState({
        sessionId: data.sessionId,
        title: data.title,
        messages: data.messages,
        metadata: data.metadata,
      });
    },
    [applyConversationState],
  );

  const apiConfigured = Boolean(api?.baseUrl && api?.llmModel);

  return (
    <div
      className={`story-agent-page ${sessionId ? 'session-active' : 'session-empty'} ${showSummaryPanel ? 'summary-open' : 'summary-closed'}`}
    >
      <div className="page-header story-agent-page-header">
        <div>
          <h1 className="page-title">纪言 · 故事开发台</h1>
          <p className="page-description">
            在同一套工作流里推进故事立意、角色世界、剧情铺排和分镜整理，并把成熟剧本直接送进绘本工作台。
          </p>
        </div>
        <div className="story-agent-page-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowConversationPanel((value) => !value)}
          >
            {showConversationPanel ? '收起项目' : '故事项目'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowSummaryPanel((value) => !value)}
          >
            {showSummaryPanel ? '收起摘要' : '故事摘要'}
          </button>
        </div>
      </div>

      {!apiConfigured && (
        <div className="alert alert-info story-agent-config-alert">
          ℹ️ 当前未配置完整的 Story Agent 模型连接。你仍可整理故事摘要，但正式对话前请先在设置页补全 Base URL、API Key 和 LLM Model。
        </div>
      )}

      <div className="story-agent-layout">
        <main className="story-agent-main">
          <StoryAgentChat
            sessionId={sessionId}
            title={title}
            metadata={metadata}
            messages={messages}
            onUpdate={handleChatUpdate}
            onPersistMetadata={patchConversation}
            loadingConversation={loadingConversation}
            api={api}
          />
        </main>

        {showConversationPanel && (
          <button
            type="button"
            className="story-agent-sidebar-backdrop"
            aria-label="关闭故事项目列表"
            onClick={() => setShowConversationPanel(false)}
          />
        )}

        <div className={`story-agent-sidebar-drawer ${showConversationPanel ? 'is-open' : ''}`}>
          <StoryAgentSidebar
            currentId={sessionId}
            refreshNonce={sidebarRefreshNonce}
            onSelect={(id) => {
              setShowConversationPanel(false);
              void handleSelectConversation(id);
            }}
            onNew={() => {
              setShowConversationPanel(false);
              void handleNewConversation();
            }}
          />
        </div>

        {showSummaryPanel && (
          <button
            type="button"
            className="story-agent-summary-backdrop"
            aria-label="关闭故事摘要"
            onClick={() => setShowSummaryPanel(false)}
          />
        )}

        <StoryAgentSummaryPanel
          sessionId={sessionId}
          title={title}
          metadata={metadata}
          onSave={handleSaveSummary}
          onClose={() => setShowSummaryPanel(false)}
          className={`story-agent-summary ${showSummaryPanel ? 'is-open' : ''} ${sessionId ? 'has-session' : 'no-session'}`}
        />
      </div>
    </div>
  );
}
