'use client';

import { useEffect, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { loadProjectImageByKey } from '@/lib/gallery-storage';
import { createImageThumbnail } from '@/lib/image-utils';
import { Base64Image } from './Base64Image';
import type { GalleryImageItem } from '@/lib/gallery-storage';

interface GalleryModalThumbnailProps {
  imageKey: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  onClick?: (fullImage: GalleryImageItem, imageKey: string) => void;
}

/**
 * 画廊弹窗用缩略图：按需从 IndexedDB 加载，仅生成小缩略图展示，
 * 点击时再加载原图放大，避免同时加载多张高清图导致崩溃。
 */
export function GalleryModalThumbnail({
  imageKey,
  alt,
  className,
  imgClassName,
  onClick,
}: GalleryModalThumbnailProps) {
  const { ref, inView } = useInView({
    threshold: 0.01,
    rootMargin: '80px',
    triggerOnce: true,
  });
  const [thumbnailState, setThumbnailState] = useState<{
    imageKey: string;
    thumbnail: string | null;
    label: string;
    failed: boolean;
  }>({
    imageKey: '',
    thumbnail: null,
    label: alt,
    failed: false,
  });
  const currentThumbnailState = thumbnailState.imageKey === imageKey
    ? thumbnailState
    : {
        imageKey,
        thumbnail: null,
        label: alt,
        failed: false,
      };

  useEffect(() => {
    if (!inView || !imageKey) return;
    let cancelled = false;

    async function loadThumbnail() {
      try {
        const img = await loadProjectImageByKey(imageKey);
        if (!img?.imageData) {
          throw new Error('Image not found');
        }
        const label = img.title || alt;
        const thumbnail = await createImageThumbnail(img.imageData, 200, 200);
        if (!cancelled) {
          setThumbnailState({
            imageKey,
            thumbnail,
            label,
            failed: false,
          });
        }
      } catch {
        if (!cancelled) {
          setThumbnailState({
            imageKey,
            thumbnail: null,
            label: alt,
            failed: true,
          });
        }
      }
    }

    void loadThumbnail();

    return () => {
      cancelled = true;
    };
  }, [inView, imageKey, alt]);

  const handleClick = async () => {
    if (!onClick) return;
    const img = await loadProjectImageByKey(imageKey);
    if (img) onClick(img, imageKey);
  };

  if (!inView) {
    return (
      <div
        ref={ref}
        className={className}
        style={{
          aspectRatio: '19/7',
          background: 'var(--bg-tertiary)',
          minHeight: 60,
        }}
      />
    );
  }

  if (currentThumbnailState.failed || !currentThumbnailState.thumbnail) {
    return (
      <div
        ref={ref}
        className={className}
        style={{
          aspectRatio: '19/7',
          background: 'var(--bg-tertiary)',
          minHeight: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.75rem',
        }}
      >
        {currentThumbnailState.failed ? '加载失败' : '加载中...'}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={className}
      onClick={handleClick}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      role="button"
      tabIndex={0}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Base64Image
        src={currentThumbnailState.thumbnail}
        alt={currentThumbnailState.label}
        className={imgClassName}
      />
      <span className="gallery-project-images-label">{currentThumbnailState.label}</span>
    </div>
  );
}
