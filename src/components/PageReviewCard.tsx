'use client';

import { memo, useState, useCallback } from 'react';
import { ImageReviewBox } from './ImageReviewBox';
import { extractCaptionFromPageContent } from '@/lib/text-parser';
import type { AssetImage, PageImage } from '@/types';

export type PendingModifyAction = 'removeText' | 'removeSeam';

interface PageReviewCardProps {
  page: PageImage;
  assets: AssetImage[];
  styleRefImage: string;
  isProcessing: boolean;
  onEnlarge: (pageId: string) => void;
  onApprove: (pageId: string) => void;
  onRegenerate: (pageId: string) => void;
  onRevert: (pageId: string) => void;
  onRedo: (pageId: string) => void;
  onToggleStyleRef: (pageId: string, currentUseStyleRef: boolean) => void;
  onToggleRefAsset: (pageId: string, assetId: string, selected: boolean) => void;
  onConfirmModify: (pageId: string, actions: PendingModifyAction[]) => void;
  onAddCaption: (pageId: string) => void;
  /** 生成中时取消并标记为失败（卡住时可手动重置） */
  onCancelGenerating?: (pageId: string) => void;
  /** 列表场景启用图片懒加载 */
  lazyImage?: boolean;
}

export const PageReviewCard = memo(function PageReviewCard({
  page,
  assets,
  styleRefImage,
  isProcessing,
  onEnlarge,
  onApprove,
  onRegenerate,
  onRevert,
  onRedo,
  onToggleStyleRef,
  onToggleRefAsset,
  onConfirmModify,
  onAddCaption,
  onCancelGenerating,
  lazyImage = false,
}: PageReviewCardProps) {
  const [pendingModify, setPendingModify] = useState<Set<PendingModifyAction>>(new Set());
  const [showScriptModal, setShowScriptModal] = useState(false);

  const assetsWithImages = assets.filter((a) => a.imageData);
  const selectedIds = page.selectedRefAssetIds ?? [];
  const captionText = extractCaptionFromPageContent(page.pageSlice.content);
  const controlsDisabled = isProcessing && page.status === 'generating';
  const togglePending = useCallback((action: PendingModifyAction) => {
    setPendingModify((prev) => {
      const next = new Set(prev);
      if (next.has(action)) next.delete(action);
      else next.add(action);
      return next;
    });
  }, []);

  const handleConfirmModify = useCallback(() => {
    if (pendingModify.size === 0) return;
    onConfirmModify(page.id, Array.from(pendingModify));
    setPendingModify(new Set());
  }, [page.id, pendingModify, onConfirmModify]);

  return (
    <div
      id={`page-${page.id}`}
      className={`page-review-card ${page.approved ? 'approved' : ''}`}
    >
      <div className="page-review-image-wrap">
        {page.status === 'generating' ? (
          <div className="page-review-loading">
            <span className="spinner" />
            <div className="loading-text">生成中...</div>
            {onCancelGenerating && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 12 }}
                onClick={() => onCancelGenerating(page.id)}
              >
                取消并标记为失败
              </button>
            )}
          </div>
        ) : page.imageData ? (
          <ImageReviewBox
            src={page.imageData}
            alt={`第${page.pageNumber}页`}
            className="page-review-image"
            onEnlarge={() => onEnlarge(page.id)}
            downloadFilename={`第${page.pageNumber}页`}
            lazy={lazyImage}
          />
        ) : page.status === 'done' ? (
          <div className="page-review-loading">
            <span className="spinner" />
            <div className="loading-text">加载中...</div>
          </div>
        ) : (
          <div className="page-review-loading">
            <div style={{ fontSize: '1.5rem' }}>❌</div>
            <div className="loading-text">生成失败</div>
          </div>
        )}
      </div>
      <div className="page-review-body">
        <button
          type="button"
          className="page-review-title page-review-title-button"
          onClick={() => setShowScriptModal(true)}
        >
          📄 第 {page.pageNumber} 页
        </button>
        <div className="page-review-ref-row">
          {styleRefImage && (
            <button
              type="button"
              className={`btn btn-sm ${
                page.useStyleRef !== false ? 'btn-primary' : 'btn-secondary'
              }`}
              onClick={() => onToggleStyleRef(page.id, page.useStyleRef !== false)}
            >
              艺术风格参考图
            </button>
          )}
          {assetsWithImages.map((asset) => {
            const selected = selectedIds.includes(asset.id);
            return (
              <button
                key={asset.id}
                type="button"
                className={`btn btn-sm ${selected ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => onToggleRefAsset(page.id, asset.id, selected)}
              >
                {asset.characterSlice.nameCN}
              </button>
            );
          })}
          {assetsWithImages.length === 0 && (
            <span className="page-review-ref-empty">暂无角色/物品资产</span>
          )}
        </div>
        <div className="page-review-actions">
          <button
            type="button"
            className="btn btn-success btn-sm"
            onClick={() => onApprove(page.id)}
            disabled={controlsDisabled}
          >
            {page.approved ? '✅ 已通过' : '☐ 通过'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onRegenerate(page.id)}
            disabled={controlsDisabled}
          >
            🔄 重新生成
          </button>
          <button
            type="button"
            className={`btn btn-sm ${pendingModify.has('removeText') ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => togglePending('removeText')}
            disabled={controlsDisabled}
            title="去除画外文字（点击选择，再点确定执行）"
          >
            去文字
          </button>
          <button
            type="button"
            className={`btn btn-sm ${pendingModify.has('removeSeam') ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => togglePending('removeSeam')}
            disabled={controlsDisabled}
            title="去除中心书缝/线条/阴影（点击选择，再点确定执行）"
          >
            去书缝
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onAddCaption(page.id)}
            disabled={controlsDisabled || !captionText}
            title={!captionText ? '剧本中需包含【绘本文案】区块' : '添加绘本文案'}
          >
            添加配文
          </button>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
            {pendingModify.size > 0 && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleConfirmModify}
                disabled={controlsDisabled}
                title="执行已选择的修改"
              >
                确定
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onRevert(page.id)}
              disabled={controlsDisabled || (page.imageHistory?.length ?? 0) === 0}
              title="使用上一张（重新生成前的版本）"
            >
              ⬅ 上一张
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onRedo(page.id)}
              disabled={controlsDisabled || (page.imageRedoStack?.length ?? 0) === 0}
              title="使用下一张（恢复重新生成的版本）"
            >
              下一张 ➡
            </button>
          </span>
        </div>
      </div>
      {showScriptModal && (
        <div className="gallery-modal-overlay" onClick={() => setShowScriptModal(false)}>
          <div className="gallery-modal page-script-modal" onClick={(e) => e.stopPropagation()}>
            <h3>第 {page.pageNumber} 页剧情原文</h3>
            <div className="page-script-modal-content">{page.pageSlice.content}</div>
            <div className="gallery-modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowScriptModal(false)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
