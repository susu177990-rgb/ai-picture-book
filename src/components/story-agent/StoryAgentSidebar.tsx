'use client';

import { useEffect, useState } from 'react';
import {
  getStoryAgentStageLabel,
  getStoryAgentStatusLabel,
  type StoryAgentConversationSummary,
} from '@/lib/story-agent-types';

function formatTime(ts: number) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

interface StoryAgentSidebarProps {
  currentId: string | null;
  refreshNonce: number;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export default function StoryAgentSidebar({
  currentId,
  refreshNonce,
  onSelect,
  onNew,
}: StoryAgentSidebarProps) {
  const [list, setList] = useState<StoryAgentConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);

  const fetchList = async () => {
    try {
      const res = await fetch('/api/story-agent/conversations');
      setApiError(!res.ok);
      if (res.ok) {
        const data = (await res.json()) as StoryAgentConversationSummary[];
        setList(Array.isArray(data) ? data : []);
      } else {
        setList([]);
      }
    } catch {
      setList([]);
      setApiError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchList();
    const interval = setInterval(() => void fetchList(), 5000);
    return () => clearInterval(interval);
  }, [currentId, refreshNonce]);

  const handleDelete = async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    if (!confirm('确定删除此对话？')) return;
    try {
      const res = await fetch(`/api/story-agent/conversations/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        if (currentId === id) onNew();
        await fetchList();
      }
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <aside className="story-agent-sidebar">
      <div className="story-agent-sidebar-head">
        <div>
          <div className="story-agent-sidebar-title">故事项目</div>
          <div className="story-agent-sidebar-subtitle">
            持续管理你的故事立意、分镜状态和导出进度
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={onNew}>
          + 新建项目
        </button>
      </div>

      <div className="story-agent-sidebar-body">
        {apiError ? (
          <div className="alert alert-error">
            ❌ 连接失败，请检查网络或刷新页面
          </div>
        ) : loading ? (
          <div className="story-agent-sidebar-empty">加载中...</div>
        ) : list.length === 0 ? (
          <div className="story-agent-sidebar-empty">
            暂无故事项目。点击“新建项目”开始第一轮创作。
          </div>
        ) : (
          list.map((item) => {
            const isActive = currentId === item.id;
            return (
              <div
                key={item.id}
                className={`story-agent-conversation-card ${isActive ? 'active' : ''}`}
                onClick={() => onSelect(item.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(item.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="story-agent-conversation-card-top">
                  <div className="story-agent-conversation-title">
                    {item.title || '新对话'}
                  </div>
                  <button
                    type="button"
                    className="story-agent-conversation-delete"
                    onClick={(event) => handleDelete(event, item.id)}
                    title="删除项目"
                  >
                    ×
                  </button>
                </div>
                <div className="story-agent-conversation-badges">
                  <span className="badge badge-pending">
                    {getStoryAgentStageLabel(item.stage)}
                  </span>
                  <span className={`badge ${item.status === 'draft' ? 'badge-pending' : 'badge-done'}`}>
                    {getStoryAgentStatusLabel(item.status)}
                  </span>
                </div>
                <div className="story-agent-conversation-meta">
                  最近更新：{formatTime(item.updatedAt)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
