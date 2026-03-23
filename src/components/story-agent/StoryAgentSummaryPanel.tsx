'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  STORY_AGENT_STAGE_ORDER,
  deriveStoryAgentStatus,
  getStoryAgentCompletion,
  getStoryAgentStageLabel,
  getStoryAgentStatusLabel,
  type StoryAgentMetadata,
} from '@/lib/story-agent-types';

interface StoryAgentSummaryPanelProps {
  sessionId: string | null;
  title: string;
  metadata: StoryAgentMetadata;
  onSave: (payload: { title: string; metadata: StoryAgentMetadata }) => Promise<void>;
  className?: string;
  onClose?: () => void;
}

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return '暂无记录';
  return new Date(timestamp).toLocaleString('zh-CN');
}

export default function StoryAgentSummaryPanel({
  sessionId,
  title,
  metadata,
  onSave,
  className,
  onClose,
}: StoryAgentSummaryPanelProps) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftMetadata, setDraftMetadata] = useState<StoryAgentMetadata>(metadata);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setDraftTitle(title);
    setDraftMetadata(metadata);
  }, [metadata, title, sessionId]);

  const completion = useMemo(
    () => getStoryAgentCompletion(draftMetadata),
    [draftMetadata],
  );

  const nextStatus = useMemo(
    () => deriveStoryAgentStatus(draftMetadata, metadata.status),
    [draftMetadata, metadata.status],
  );

  const handleSave = async () => {
    if (!sessionId) return;
    setSaving(true);
    setNotice(null);
    try {
      const payload = {
        title: draftTitle.trim() || draftMetadata.storyTitle.trim() || '新对话',
        metadata: {
          ...draftMetadata,
          storyTitle: draftTitle.trim() || draftMetadata.storyTitle.trim(),
          status: nextStatus,
        },
      };
      await onSave(payload);
      setNotice({ type: 'success', message: '故事摘要已保存' });
    } catch (error) {
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : '保存失败',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className={className}>
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">故事摘要</div>
            <div className="card-subtitle">
              显式保存当前故事信息，建立后续导出与交接的基础
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              className="story-agent-summary-close"
              onClick={onClose}
              aria-label="关闭故事摘要"
            >
              ×
            </button>
          )}
        </div>

        {!sessionId ? (
          <div className="story-agent-summary-empty">
            <div className="card-subtitle">
              先新建一个故事项目，或直接开始第一轮对话。会话建立后，这里会持续保存故事摘要。
            </div>
          </div>
        ) : (
          <>
            <div className="story-agent-summary-status story-agent-summary-status-hero">
              <div className="story-agent-summary-status-row">
                <span className="story-agent-summary-status-label">当前状态</span>
                <span className={`badge badge-${nextStatus === 'draft' ? 'pending' : nextStatus === 'ready_for_storyboard' ? 'success' : 'done'}`}>
                  {getStoryAgentStatusLabel(nextStatus)}
                </span>
              </div>
              <div className="story-agent-summary-status-row">
                <span className="story-agent-summary-status-label">阶段完成度</span>
                <strong>{completion.ratio}%</strong>
              </div>
              <div className="story-agent-summary-progress">
                <div
                  className="story-agent-summary-progress-fill"
                  style={{ width: `${completion.ratio}%` }}
                />
              </div>
              <div className="card-subtitle">{completion.message}</div>
            </div>

            <div className="story-agent-summary-form">
              <div className="form-group story-agent-summary-span-2">
                <label className="form-label">标题</label>
                <input
                  type="text"
                  className="form-input"
                  value={draftTitle}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDraftTitle(value);
                    setDraftMetadata((prev) => ({ ...prev, storyTitle: value }));
                  }}
                  placeholder="例如：小立春不想起床"
                />
              </div>

              <div className="form-group story-agent-summary-span-2">
                <label className="form-label">Logline</label>
                <textarea
                  className="form-input story-agent-summary-textarea"
                  value={draftMetadata.logline}
                  onChange={(e) =>
                    setDraftMetadata((prev) => ({ ...prev, logline: e.target.value }))
                  }
                  placeholder="一句话概括这个故事最核心的戏剧张力"
                />
              </div>

              <div className="form-group">
                <label className="form-label">目标年龄</label>
                <input
                  type="text"
                  className="form-input"
                  value={draftMetadata.targetAge}
                  onChange={(e) =>
                    setDraftMetadata((prev) => ({ ...prev, targetAge: e.target.value }))
                  }
                  placeholder="例如：5 岁左右"
                />
              </div>

              <div className="form-group">
                <label className="form-label">主角</label>
                <input
                  type="text"
                  className="form-input"
                  value={draftMetadata.protagonist}
                  onChange={(e) =>
                    setDraftMetadata((prev) => ({ ...prev, protagonist: e.target.value }))
                  }
                  placeholder="例如：拟人化的小立春"
                />
              </div>

              <div className="form-group story-agent-summary-span-2">
                <label className="form-label">核心矛盾</label>
                <textarea
                  className="form-input story-agent-summary-textarea"
                  value={draftMetadata.coreConflict}
                  onChange={(e) =>
                    setDraftMetadata((prev) => ({ ...prev, coreConflict: e.target.value }))
                  }
                  placeholder="例如：害怕新旧更替，不愿从冬眠里走出来"
                />
              </div>

              <div className="form-group story-agent-summary-span-2">
                <label className="form-label">系列定位</label>
                <textarea
                  className="form-input story-agent-summary-textarea"
                  value={draftMetadata.seriesContext}
                  onChange={(e) =>
                    setDraftMetadata((prev) => ({ ...prev, seriesContext: e.target.value }))
                  }
                  placeholder="例如：24 节气系列中的第 1 本，主题是迎接变化"
                />
              </div>

              <div className="form-group">
                <label className="form-label">当前阶段</label>
                <select
                  className="form-input"
                  value={draftMetadata.stage}
                  onChange={(e) =>
                    setDraftMetadata((prev) => ({
                      ...prev,
                      stage: e.target.value as StoryAgentMetadata['stage'],
                    }))
                  }
                >
                  {STORY_AGENT_STAGE_ORDER.map((stage) => (
                    <option key={stage} value={stage}>
                      {getStoryAgentStageLabel(stage)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="story-agent-summary-meta-list">
              <div className="story-agent-summary-meta-item">
                最近导出：{formatTimestamp(metadata.lastExportedAt)}
              </div>
              <div className="story-agent-summary-meta-item">
                最近发送到工作台：{formatTimestamp(metadata.lastSentToWorkbenchAt)}
              </div>
            </div>

            {notice && (
              <div className={`alert ${notice.type === 'success' ? 'alert-success' : 'alert-error'}`}>
                {notice.type === 'success' ? '✅' : '❌'} {notice.message}
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary w-full"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? '保存中...' : '保存故事摘要'}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
