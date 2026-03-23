'use client';

import { useInView } from 'react-intersection-observer';
import { Base64Image } from './Base64Image';

interface LazyBase64ImageProps {
  src: string;
  alt: string;
  className?: string;
  onError?: () => void;
  /** 占位区域宽高比，默认 16/9 */
  aspectRatio?: string;
}

/**
 * 懒加载 Base64 图片：仅当进入视口时再渲染，减少初始解码压力。
 */
export function LazyBase64Image({
  src,
  alt,
  className,
  onError,
  aspectRatio = '16/9',
}: LazyBase64ImageProps) {
  const { ref, inView } = useInView({
    threshold: 0.01,
    rootMargin: '100px',
    triggerOnce: true,
  });

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
