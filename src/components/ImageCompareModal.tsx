'use client';

import { Base64Image } from './Base64Image';

interface ImageCompareModalProps {
  title: string;
  referenceSummary?: string;
  detailSummary?: string;
  previousImage: string;
  currentImage: string;
  onClose: () => void;
}

export function ImageCompareModal({
  title,
  referenceSummary,
  detailSummary,
  previousImage,
  currentImage,
  onClose,
}: ImageCompareModalProps) {
  return (
    <div className="gallery-modal-overlay" onClick={onClose}>
      <div className="image-compare-modal" onClick={(e) => e.stopPropagation()}>
        <div className="image-compare-header">
          <div>
            <h3>{title}</h3>
            {referenceSummary && (
              <div className="image-compare-meta">{referenceSummary}</div>
            )}
            {detailSummary && (
              <div className="image-compare-meta">{detailSummary}</div>
            )}
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="image-compare-grid">
          <div className="image-compare-panel">
            <div className="image-compare-label">上一版</div>
            <div className="image-compare-image-wrap">
              <Base64Image src={previousImage} alt={`${title} 上一版`} className="image-compare-image" />
            </div>
          </div>
          <div className="image-compare-panel">
            <div className="image-compare-label">当前版</div>
            <div className="image-compare-image-wrap">
              <Base64Image src={currentImage} alt={`${title} 当前版`} className="image-compare-image" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
