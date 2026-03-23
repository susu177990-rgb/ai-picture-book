'use client';

import { useEffect, useCallback } from 'react';
import { Base64Image } from './Base64Image';
import { downloadBase64Image } from '@/lib/image-utils';

interface GalleryLightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
  /** 可选：多图列表，用于上一张/下一张切换 */
  items?: { src: string; alt: string }[];
  currentIndex?: number;
  onPrev?: () => void;
  onNext?: () => void;
  /** 可选：直接指定是否显示上一张/下一张按钮（用于按需加载场景） */
  canPrev?: boolean;
  canNext?: boolean;
}

export function GalleryLightbox({
  src,
  alt,
  onClose,
  items,
  currentIndex = 0,
  onPrev,
  onNext,
  canPrev: canPrevProp,
  canNext: canNextProp,
}: GalleryLightboxProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev?.();
      if (e.key === 'ArrowRight') onNext?.();
    },
    [onClose, onPrev, onNext],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  const handleDownload = useCallback(() => {
    const ext = src.startsWith('data:image/png') ? 'png' : 'jpg';
    downloadBase64Image(src, `${alt || 'image'}.${ext}`);
  }, [src, alt]);

  const canPrev =
    canPrevProp ?? (items && items.length > 0 && currentIndex > 0);
  const canNext =
    canNextProp ?? (items && items.length > 0 && currentIndex < items.length - 1);

  return (
    <div
      className="gallery-lightbox-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
    >
      <div
        className="gallery-lightbox-content"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="gallery-lightbox-close"
          onClick={onClose}
          aria-label="关闭"
        >
          ✕
        </button>
        {canPrev && (
          <button
            type="button"
            className="gallery-lightbox-nav gallery-lightbox-prev"
            onClick={(e) => {
              e.stopPropagation();
              onPrev?.();
            }}
            aria-label="上一张"
          >
            ‹
          </button>
        )}
        {canNext && (
          <button
            type="button"
            className="gallery-lightbox-nav gallery-lightbox-next"
            onClick={(e) => {
              e.stopPropagation();
              onNext?.();
            }}
            aria-label="下一张"
          >
            ›
          </button>
        )}
        <div className="gallery-lightbox-image-wrapper">
          <Base64Image src={src} alt={alt} className="gallery-lightbox-image" />
        </div>
        <div className="gallery-lightbox-toolbar">
          <button
            type="button"
            className="gallery-lightbox-download"
            onClick={(e) => {
              e.stopPropagation();
              handleDownload();
            }}
          >
            📥 下载
          </button>
          <span className="gallery-lightbox-caption">{alt}</span>
        </div>
      </div>
    </div>
  );
}
