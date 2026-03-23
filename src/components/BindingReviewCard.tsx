'use client';

import { memo } from 'react';
import { ImageReviewBox } from './ImageReviewBox';
import type { BindingImage, BindingImageType } from '@/types';

const BINDING_LABELS: Record<BindingImageType, string> = {
  cover: '封面',
  endpapers: '环衬',
  titlepage: '扉页',
};

interface BindingReviewCardProps {
  binding: BindingImage;
  isProcessing: boolean;
  onEnlarge: (id: string) => void;
  onApprove: (id: string) => void;
  onRegenerate: (id: string) => void;
  onRemoveSeam: (id: string) => void;
  onRevert: (id: string) => void;
  onRedo: (id: string) => void;
  /** 生成中时取消并标记为失败（卡住时可手动重置） */
  onCancelGenerating?: (bindingId: string) => void;
  lazyImage?: boolean;
}

export const BindingReviewCard = memo(function BindingReviewCard({
  binding,
  isProcessing,
  onEnlarge,
  onApprove,
  onRegenerate,
  onRemoveSeam,
  onRevert,
  onRedo,
  onCancelGenerating,
  lazyImage = false,
}: BindingReviewCardProps) {
  const controlsDisabled = isProcessing && binding.status === 'generating';
  const label = BINDING_LABELS[binding.type];

  return (
    <div
      id={`binding-${binding.id}`}
      className={`page-review-card ${binding.approved ? 'approved' : ''}`}
    >
      <div className="page-review-image-wrap">
        {binding.status === 'generating' ? (
          <div className="page-review-loading">
            <span className="spinner" />
            <div className="loading-text">生成中...</div>
            {onCancelGenerating && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 12 }}
                onClick={() => onCancelGenerating(binding.id)}
              >
                取消并标记为失败
              </button>
            )}
          </div>
        ) : binding.imageData ? (
          <ImageReviewBox
            src={binding.imageData}
            alt={label}
            className="page-review-image"
            onEnlarge={() => onEnlarge(binding.id)}
            downloadFilename={label}
            lazy={lazyImage}
          />
        ) : (
          <div className="page-review-loading">
            <div style={{ fontSize: '1.5rem' }}>❌</div>
            <div className="loading-text">生成失败</div>
          </div>
        )}
      </div>
      <div className="page-review-body">
        <div className="page-review-title">
          {binding.type === 'cover' ? '📕' : binding.type === 'endpapers' ? '📗' : '📘'}{' '}
          {label}
        </div>
        <div className="review-reference-summary">
          当前参考：分页宫格图
        </div>
        {binding.status === 'failed' && binding.errorMessage && (
          <div className="review-error-box">
            <div className="review-error-title">失败原因：{binding.errorMessage}</div>
          </div>
        )}
        <div className="page-review-actions">
          <button
            type="button"
            className="btn btn-success btn-sm"
            onClick={() => onApprove(binding.id)}
            disabled={controlsDisabled}
          >
            {binding.approved ? '✅ 已通过' : '☐ 通过'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onRegenerate(binding.id)}
            disabled={controlsDisabled}
          >
            🔄 重新生成
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onRemoveSeam(binding.id)}
            disabled={controlsDisabled}
            title="去除中心书缝/线条/阴影"
          >
            去书缝
          </button>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onRevert(binding.id)}
              disabled={controlsDisabled || (binding.imageHistory?.length ?? 0) === 0}
              title="使用上一张（重新生成前的版本）"
            >
              ⬅ 上一张
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onRedo(binding.id)}
              disabled={controlsDisabled || (binding.imageRedoStack?.length ?? 0) === 0}
              title="使用下一张（恢复重新生成的版本）"
            >
              下一张 ➡
            </button>
            <span className={`badge badge-${binding.status}`}>
              {binding.status === 'done'
                ? '完成'
                : binding.status === 'generating'
                  ? '生成中'
                  : binding.status === 'failed'
                    ? '失败'
                    : '等待'}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
});
