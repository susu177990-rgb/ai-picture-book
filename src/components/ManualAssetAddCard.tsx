'use client';

import { useState, useRef } from 'react';
import { fileToBase64, normalizeImageDataUrl } from '@/lib/image-utils';
import type { AssetImage, CharacterSlice } from '@/types';

interface ManualAssetAddCardProps {
  onAdd: (asset: AssetImage) => void;
  disabled?: boolean;
}

export function ManualAssetAddCard({ onAdd, disabled }: ManualAssetAddCardProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'character' | 'item'>('character');
  const [imagePreview, setImagePreview] = useState<string>('');
  const [isAdding, setIsAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const b64 = await fileToBase64(file);
      setImagePreview(normalizeImageDataUrl(b64));
    } catch {
      setImagePreview('');
    }
    e.target.value = '';
  };

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed || !imagePreview) return;
    setIsAdding(true);
    const characterSlice: CharacterSlice = {
      type,
      index: -1,
      name: trimmed,
      nameCN: trimmed,
      designAnalysis: '(手动添加)',
      prompt: '',
      rawText: '',
    };
    const asset: AssetImage = {
      id: `asset-manual-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      characterSlice,
      imageData: imagePreview,
      status: 'done',
      approved: false,
      manual: true,
    };
    onAdd(asset);
    setName('');
    setType('character');
    setImagePreview('');
    setIsAdding(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const canAdd = name.trim().length > 0 && imagePreview.length > 0 && !disabled;

  return (
    <div className="gallery-item manual-add-card">
      <div className="manual-add-preview" style={{ aspectRatio: '16/9' }}>
        {imagePreview ? (
          // eslint-disable-next-line @next/next/no-img-element -- 这里展示本地 data URL 预览，不走 Next 图片优化链路
          <img
            src={imagePreview}
            alt="预览"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              borderRadius: 8,
              background: '#f0f0f0',
            }}
          />
        ) : (
          <button
            type="button"
            className="manual-add-upload-area"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
          >
            <span style={{ fontSize: '2rem' }}>📷</span>
            <span>点击上传图片</span>
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>
      <div className="gallery-item-body">
        <div className="gallery-item-title">➕ 手动添加角色/物品</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              className="form-input"
              style={{ padding: '4px 6px', fontSize: '0.85rem', width: 56, flexShrink: 0 }}
              value={type}
              onChange={(e) => setType(e.target.value as 'character' | 'item')}
              disabled={disabled}
            >
              <option value="character">角色</option>
              <option value="item">物品</option>
            </select>
            <input
              type="text"
              className="form-input"
              placeholder="名称（如：小兔子）"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={disabled}
              style={{ flex: 1, padding: '6px 10px', fontSize: '0.9rem' }}
            />
          </div>
          {imagePreview && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
            >
              更换图片
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm w-full"
            onClick={handleAdd}
            disabled={!canAdd || isAdding}
          >
            {isAdding ? '添加中...' : '添加'}
          </button>
        </div>
      </div>
    </div>
  );
}
