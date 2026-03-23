'use client';

import { useEffect, useMemo, useState, memo } from 'react';
import { toBlobUrl, normalizeImageDataUrl } from '@/lib/image-utils';

/**
 * 使用 Blob URL 显示 Base64 图片，避免浏览器对 data URL 的 ~2MB 限制。
 * 大图（如 AI 生成的高清图）用 data URL 会加载失败，改用 Blob URL 可正常显示。
 */
export const Base64Image = memo(function Base64Image({
  src,
  alt,
  className,
  onError,
}: {
  src: string;
  alt: string;
  className?: string;
  onError?: () => void;
}) {
  const [loadState, setLoadState] = useState({
    src,
    retryCount: 0,
    failed: false,
  });
  const currentLoadState = loadState.src === src
    ? loadState
    : { src, retryCount: 0, failed: false };

  const { displayUrl, isBlob } = useMemo(() => {
    if (!src || typeof src !== 'string') return { displayUrl: '', isBlob: false };
    // 优先使用 Blob URL，避免 data URL 超长导致加载失败
    const blobUrl = toBlobUrl(src);
    if (blobUrl) return { displayUrl: blobUrl, isBlob: true };
    const dataUrl = normalizeImageDataUrl(src);
    return { displayUrl: dataUrl, isBlob: false };
  }, [src]);

  const handleError = () => {
    setLoadState((prev) =>
      prev.src === src
        ? { ...prev, failed: true }
        : { src, retryCount: 0, failed: true },
    );
    onError?.();
  };

  // 首次加载失败时自动重试一次（解决批量生成时的时序问题）
  useEffect(() => {
    if (!currentLoadState.failed || currentLoadState.retryCount >= 1) return;
    const t = setTimeout(() => {
      setLoadState((prev) => {
        if (prev.src !== src) {
          return prev;
        }
        return {
          src,
          retryCount: prev.retryCount + 1,
          failed: false,
        };
      });
    }, 200);
    return () => clearTimeout(t);
  }, [currentLoadState.failed, currentLoadState.retryCount, src]);

  useEffect(() => {
    if (isBlob && displayUrl) {
      return () => URL.revokeObjectURL(displayUrl);
    }
  }, [displayUrl, isBlob]);

  if (!displayUrl || currentLoadState.failed) {
    return (
      <div
        className={className}
        style={{
          aspectRatio: '16/9',
          background: 'var(--bg-tertiary)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.9rem',
          gap: '4px',
        }}
      >
        {currentLoadState.failed ? '加载失败' : '数据无效'}
        {currentLoadState.failed && <span style={{ fontSize: '0.75rem' }}>请尝试「重新生成」</span>}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- Base64 动态内容，使用 Blob URL 避免 2MB 限制
    <img
      className={className}
      src={displayUrl}
      alt={alt}
      onError={handleError}
      decoding="async"
    />
  );
});
