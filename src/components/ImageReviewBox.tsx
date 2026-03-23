'use client';

import { useCallback, memo } from 'react';
import { Base64Image } from './Base64Image';
import { ThumbnailBase64Image } from './ThumbnailBase64Image';
import { downloadBase64Image } from '@/lib/image-utils';

interface ImageReviewBoxProps {
  src: string;
  alt: string;
  className?: string;
  onEnlarge?: () => void;
  downloadFilename?: string;
  onError?: () => void;
  /** 列表场景：缩略图展示 + 懒加载，下载/放大用原图 */
  lazy?: boolean;
}

/**
 * 审核用图片框：点击放大、下载（上一张/下一张在卡片操作行）
 */
export const ImageReviewBox = memo(function ImageReviewBox({
  src,
  alt,
  className,
  onEnlarge,
  downloadFilename,
  onError,
  lazy = false,
}: ImageReviewBoxProps) {
  const handleDownload = useCallback(() => {
    if (!src) return;
    const ext = src.startsWith('data:image/png') ? 'png' : 'jpg';
    const name = downloadFilename || alt || 'image';
    downloadBase64Image(src, `${name}.${ext}`);
  }, [src, downloadFilename, alt]);

  const ImageComponent = lazy ? ThumbnailBase64Image : Base64Image;

  return (
    <div className="image-review-box">
      <div
        className="image-review-box-inner"
        onClick={onEnlarge}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onEnlarge?.()}
        aria-label="点击放大"
      >
        <ImageComponent
          src={src}
          alt={alt}
          className={className}
          onError={onError}
        />
        <div className="image-review-box-overlay">
          <button
            type="button"
            className="image-review-btn"
            onClick={(e) => {
              e.stopPropagation();
              onEnlarge?.();
            }}
            title="放大"
          >
            🔍 放大
          </button>
          <button
            type="button"
            className="image-review-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleDownload();
            }}
            title="下载"
          >
            📥 下载
          </button>
        </div>
      </div>
    </div>
  );
});
