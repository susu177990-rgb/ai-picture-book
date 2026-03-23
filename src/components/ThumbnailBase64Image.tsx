'use client';

import { useEffect, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { createImageThumbnail } from '@/lib/image-utils';
import { Base64Image } from './Base64Image';

interface ThumbnailBase64ImageProps {
  /** 原图 base64，列表展示用缩略图，下载/放大时由父组件传原图 */
  src: string;
  alt: string;
  className?: string;
  onError?: () => void;
  aspectRatio?: string;
  /** 缩略图最大宽高，默认 1200，仅超大图会缩小 */
  maxSize?: number;
}

/**
 * 列表用缩略图：客户端 Canvas 自动缩小显示，减少解码压力。
 * 父组件需保留原图，下载/放大时传原图。
 */
export function ThumbnailBase64Image({
  src,
  alt,
  className,
  onError,
  aspectRatio = '16/9',
  maxSize = 1200,
}: ThumbnailBase64ImageProps) {
  const { ref, inView } = useInView({
    threshold: 0.01,
    rootMargin: '50px',
    triggerOnce: true,
  });
  const [thumbnailState, setThumbnailState] = useState<{
    src: string;
    thumbnail: string | null;
    failed: boolean;
    useOriginal: boolean;
  }>({
    src: '',
    thumbnail: null,
    failed: false,
    useOriginal: false,
  });
  const currentThumbnailState = thumbnailState.src === src
    ? thumbnailState
    : {
        src,
        thumbnail: null,
        failed: false,
        useOriginal: false,
      };

  useEffect(() => {
    if (!inView || !src) return;
    let cancelled = false;
    const fallbackTimer = window.setTimeout(() => {
      if (!cancelled) {
        setThumbnailState({
          src,
          thumbnail: null,
          failed: false,
          useOriginal: true,
        });
      }
    }, 8000);

    async function loadThumbnail() {
      try {
        const thumbnail = await createImageThumbnail(src, maxSize, maxSize);
        if (!cancelled) {
          window.clearTimeout(fallbackTimer);
          setThumbnailState({
            src,
            thumbnail,
            failed: false,
            useOriginal: false,
          });
        }
      } catch {
        if (!cancelled) {
          window.clearTimeout(fallbackTimer);
          setThumbnailState({
            src,
            thumbnail: null,
            failed: false,
            useOriginal: true,
          });
        }
      }
    }

    void loadThumbnail();
    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
    };
  }, [inView, src, maxSize]);

  if (!inView) {
    return (
      <div
        ref={ref}
        className={className}
        style={{
          aspectRatio,
          background: 'var(--bg-tertiary)',
          minHeight: 120,
        }}
      />
    );
  }

  if (currentThumbnailState.useOriginal) {
    return (
      <div ref={ref} style={{ minHeight: 0 }}>
        <Base64Image
          src={src}
          alt={alt}
          className={className}
          onError={onError}
        />
      </div>
    );
  }

  if (currentThumbnailState.failed || !currentThumbnailState.thumbnail) {
    return (
      <div
        ref={ref}
        className={className}
        style={{
          aspectRatio,
          background: 'var(--bg-tertiary)',
          minHeight: 120,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
        }}
      >
        {currentThumbnailState.failed ? '加载失败' : '加载中...'}
      </div>
    );
  }

  return (
    <div ref={ref} style={{ minHeight: 0 }}>
      <Base64Image
        src={currentThumbnailState.thumbnail}
        alt={alt}
        className={className}
        onError={onError}
      />
    </div>
  );
}
