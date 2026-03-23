'use client';

import { memo } from 'react';
import { ImageReviewBox } from './ImageReviewBox';
import type { AssetImage } from '@/types';

interface AssetCardProps {
  asset: AssetImage;
  currentStage: string;
  isProcessing: boolean;
  onEnlarge: (assetId: string) => void;
  onError: (assetId: string) => void;
  onApprove: (assetId: string) => void;
  onRegenerate: (assetId: string) => void;
  onRevert: (assetId: string) => void;
  onRedo: (assetId: string) => void;
  /** 生成中时取消并标记为失败（卡住时可手动重置） */
  onCancelGenerating?: (assetId: string) => void;
  /** 手动资产可删除 */
  onRemove?: (assetId: string) => void;
  /** 列表场景启用图片懒加载 */
  lazyImage?: boolean;
}

export const AssetCard = memo(function AssetCard({
  asset,
  currentStage,
  isProcessing,
  onEnlarge,
  onError,
  onApprove,
  onRegenerate,
  onRevert,
  onRedo,
  onCancelGenerating,
  onRemove,
  lazyImage = false,
}: AssetCardProps) {
  const controlsDisabled = isProcessing && asset.status === 'generating';
  const showActions =
    currentStage === 'stage2' || currentStage === 'stage3' || currentStage === 'stage5' || currentStage === 'done';

  return (
    <div
      id={`asset-${asset.id}`}
      className={`gallery-item ${asset.approved ? 'approved' : ''}`}
    >
      {asset.status === 'generating' ? (
        <div
          className="loading-overlay"
          style={{ aspectRatio: '16/9' }}
        >
          <span className="spinner" />
          <div className="loading-text">生成中...</div>
          {!asset.manual && onCancelGenerating && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 12 }}
              onClick={(e) => {
                e.stopPropagation();
                onCancelGenerating(asset.id);
              }}
            >
              取消并标记为失败
            </button>
          )}
        </div>
      ) : asset.imageData ? (
        <ImageReviewBox
          src={asset.imageData}
          alt={asset.characterSlice.nameCN}
          className="gallery-item-image portrait"
          onEnlarge={() => onEnlarge(asset.id)}
          downloadFilename={asset.characterSlice.nameCN}
          onError={() => onError(asset.id)}
          lazy={lazyImage}
        />
      ) : asset.status === 'done' ? (
        <div
          className="loading-overlay"
          style={{ aspectRatio: '16/9' }}
        >
          <span className="spinner" />
          <div className="loading-text">加载中...</div>
        </div>
      ) : (
        <div
          className="loading-overlay"
          style={{ aspectRatio: '16/9' }}
        >
          <div style={{ fontSize: '1.5rem' }}>❌</div>
          <div className="loading-text">生成失败</div>
        </div>
      )}
      <div className="gallery-item-body">
        <div className="gallery-item-title">
          {asset.characterSlice.type === 'character' ? '👤' : '🎒'}{' '}
          {asset.characterSlice.nameCN}
        </div>
        <div className="review-reference-summary">
          当前参考：{asset.characterSlice.type === 'character' ? '角色' : '物品'} · {asset.characterSlice.nameCN}
        </div>
        {asset.status === 'failed' && asset.errorMessage && (
          <div className="review-error-box">
            <div className="review-error-title">失败原因：{asset.errorMessage}</div>
          </div>
        )}
        <div className="gallery-item-actions">
          {showActions && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  onClick={() => onApprove(asset.id)}
                  disabled={controlsDisabled}
                >
                  {asset.approved ? '✅ 已通过' : '☐ 通过'}
                </button>
                {!asset.manual && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onRegenerate(asset.id)}
                    disabled={controlsDisabled}
                  >
                    🔄 重新生成
                  </button>
                )}
                <span className={`badge badge-${asset.status}`} style={{ marginLeft: 'auto' }}>
                  {asset.status === 'done'
                    ? asset.manual
                      ? '手动'
                      : '完成'
                    : asset.status === 'generating'
                      ? '生成中'
                      : asset.status === 'failed'
                        ? '失败'
                        : '等待'}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
                {!asset.manual && (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onRevert(asset.id)}
                      disabled={controlsDisabled || (asset.imageHistory?.length ?? 0) === 0}
                      title="使用上一张（重新生成前的版本）"
                    >
                      ⬅ 上一张
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onRedo(asset.id)}
                      disabled={controlsDisabled || (asset.imageRedoStack?.length ?? 0) === 0}
                      title="使用下一张（恢复重新生成的版本）"
                    >
                      下一张 ➡
                    </button>
                  </>
                )}
                {asset.manual && onRemove && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ marginLeft: 'auto' }}
                    disabled={controlsDisabled}
                    onClick={() => onRemove(asset.id)}
                    title="删除此手动资产"
                  >
                    🗑 删除
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
