'use client';

import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import {
  usePipelineStore,
  restoreMissingPipelineImagesFromIndexedDB,
} from '@/store/pipeline-store';
import { useShallow } from 'zustand/react/shallow';
import {
  parseScript,
  parseCharacterPrompts,
  extractCaptionFromPageContent,
} from '@/lib/text-parser';
import {
  fuseStyleAnalysis,
  fuseCharacterExtraction,
  fuseAssetGeneration,
  fusePageGeneration,
  fuseCoverGeneration,
  fuseEndpapersGeneration,
  fuseTitlePageGeneration,
} from '@/lib/prompt-fusion';
import { callLLM, callImageGen } from '@/lib/api-client';
import {
  getSettings,
  saveApiSettings,
  syncUserPromptsFromFile,
} from '@/lib/storage';
import {
  fileToBase64,
  downloadAsZip,
  normalizeImageDataUrl,
  createPageGridImage,
} from '@/lib/image-utils';
import { loadImageFromIndexedDB } from '@/lib/image-storage';
import { classifyPipelineError } from '@/lib/pipeline-feedback';
import { saveCurrentWorkbenchProject } from '@/lib/workbench-project';
import { AssetCard } from '@/components/AssetCard';
import { ManualAssetAddCard } from '@/components/ManualAssetAddCard';
import { PageReviewCard } from '@/components/PageReviewCard';
import { BindingReviewCard } from '@/components/BindingReviewCard';
import { GalleryLightbox } from '@/components/GalleryLightbox';
import { ThumbnailBase64Image } from '@/components/ThumbnailBase64Image';
import type { AspectRatioType, ImageSizeType, AssetImage } from '@/types';

/** 分页参考图默认选择：全选所有资产 */
function computeAutoSelectedAssetIds(
  _pageContent: string,
  assets: AssetImage[],
): string[] {
  return assets.map((a) => a.id);
}

/** 根据选中的 asset id 构建参考图列表，缺失 imageData 时从 IndexedDB 加载，确保与分页卡选中一致 */
async function resolveCharAssetImages(
  selectedIds: string[],
  assets: { id: string; characterSlice: { nameCN: string }; imageData?: string }[],
  onDropped?: (ids: string[]) => void,
): Promise<{ name: string; imageBase64: string }[]> {
  const result: { name: string; imageBase64: string }[] = [];
  const dropped: string[] = [];

  for (const assetId of selectedIds) {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) {
      dropped.push(assetId);
      continue;
    }
    let imageData = asset.imageData;
    if (!imageData && typeof window !== 'undefined') {
      imageData = (await loadImageFromIndexedDB(assetId)) ?? undefined;
    }
    if (imageData) {
      result.push({
        name: asset.characterSlice.nameCN,
        imageBase64: imageData,
      });
    } else {
      dropped.push(assetId);
    }
  }

  if (dropped.length > 0 && onDropped) {
    onDropped(dropped);
  }
  return result;
}

function formatCardError(error: unknown): string {
  const classified = classifyPipelineError(error);
  return `${classified.summary}\n建议：${classified.suggestion}`;
}

export default function WorkbenchPage() {
  const store = usePipelineStore(
    useShallow((s) => ({
      currentStage: s.currentStage,
      stage1Step: s.stage1Step,
      scriptFileName: s.scriptFileName,
      scriptRawText: s.scriptRawText,
      scriptPages: s.scriptPages,
      styleRefImage: s.styleRefImage,
      styleModule: s.styleModule,
      characterPromptsRaw: s.characterPromptsRaw,
      characterSlices: s.characterSlices,
      assets: s.assets,
      finalPages: s.finalPages,
      bookTitle: s.bookTitle,
      bindingImages: s.bindingImages,
      pageGridImage: s.pageGridImage,
      lastUpdatedAt: s.lastUpdatedAt,
      isProcessing: s.isProcessing,
      progressMessage: s.progressMessage,
      errorMessage: s.errorMessage,
      logs: s.logs,
      setProcessing: s.setProcessing,
      setStage: s.setStage,
      setStage1Step: s.setStage1Step,
      setScriptFileName: s.setScriptFileName,
      setScriptRawText: s.setScriptRawText,
      setScriptPages: s.setScriptPages,
      setStyleRefImage: s.setStyleRefImage,
      setStyleModule: s.setStyleModule,
      setCharacterPromptsRaw: s.setCharacterPromptsRaw,
      setCharacterSlices: s.setCharacterSlices,
      setAssets: s.setAssets,
      updateAsset: s.updateAsset,
      addAsset: s.addAsset,
      removeAsset: s.removeAsset,
      setFinalPages: s.setFinalPages,
      updateFinalPage: s.updateFinalPage,
      setBookTitle: s.setBookTitle,
      setBindingImages: s.setBindingImages,
      updateBindingImage: s.updateBindingImage,
      setPageGridImage: s.setPageGridImage,
      setError: s.setError,
      clearError: s.clearError,
      addLog: s.addLog,
      clearLogs: s.clearLogs,
      resetAll: s.resetAll,
      resetStage5: s.resetStage5,
    })),
  );
  const [docxFile, setDocxFile] = useState<File | null>(null);
  const [styleFile, setStyleFile] = useState<File | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [lightbox, setLightbox] = useState<
    | { type: 'asset'; index: number }
    | { type: 'page'; index: number }
    | { type: 'binding'; index: number }
    | { type: 'pageGrid' }
    | null
  >(null);
  const [showBookTitleModal, setShowBookTitleModal] = useState(false);
  const [bookTitleInput, setBookTitleInput] = useState('');
  const docxInputRef = useRef<HTMLInputElement>(null);
  const styleInputRef = useRef<HTMLInputElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [apiForParams, setApiForParams] = useState<ReturnType<typeof getSettings>['api'] | null>(null);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completeName, setCompleteName] = useState('');
  const [isSavingToGallery, setIsSavingToGallery] = useState(false);
  const [resumeBanner, setResumeBanner] = useState('');
  const [handoffBanner, setHandoffBanner] = useState('');
  const [focusedStep, setFocusedStep] = useState(1);

  useEffect(() => {
    void syncUserPromptsFromFile();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handoffMessage = sessionStorage.getItem('story-agent-handoff-message');
    if (handoffMessage) {
      setHandoffBanner(handoffMessage);
      sessionStorage.removeItem('story-agent-handoff-message');
    }
  }, []);

  useEffect(() => {
    setApiForParams(getSettings().api);
  }, [store.currentStage]);

  const missingPersistedImageSignature = useMemo(() => {
    const missingAssets = store.assets
      .filter((a) => a.status === 'done' && !a.imageData)
      .map((a) => a.id);
    const missingPages = store.finalPages
      .filter((p) => p.status === 'done' && !p.imageData)
      .map((p) => p.id);
    const missingBindings = store.bindingImages
      .filter((b) => b.status === 'done' && !b.imageData)
      .map((b) => b.id);
    const missingStyleRef =
      store.currentStage !== 'upload' && store.currentStage !== 'stage1' && !store.styleRefImage
        ? 'style-ref'
        : '';
    const missingPageGrid =
      (store.currentStage === 'stage5' || store.currentStage === 'done') && !store.pageGridImage
        ? 'page-grid'
        : '';

    return [
      missingStyleRef,
      missingPageGrid,
      ...missingAssets,
      ...missingPages,
      ...missingBindings,
    ]
      .filter(Boolean)
      .join('|');
  }, [
    store.assets,
    store.bindingImages,
    store.currentStage,
    store.finalPages,
    store.pageGridImage,
    store.styleRefImage,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined' || !missingPersistedImageSignature) return;
    void restoreMissingPipelineImagesFromIndexedDB(usePipelineStore.getState());
  }, [missingPersistedImageSignature]);

  useEffect(() => {
    if (showLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [store.logs, showLogs]);

  useEffect(() => {
    if (typeof window === 'undefined' || !store.lastUpdatedAt) return;
    const hasProgress =
      Boolean(store.scriptRawText) ||
      Boolean(store.styleRefImage) ||
      store.assets.length > 0 ||
      store.finalPages.length > 0 ||
      store.bindingImages.length > 0;
    if (!hasProgress) return;
    const hasShown = sessionStorage.getItem('workbench-resume-banner-shown');
    if (hasShown) return;
    const failedCount =
      store.assets.filter((item) => item.status === 'failed').length +
      store.finalPages.filter((item) => item.status === 'failed').length +
      store.bindingImages.filter((item) => item.status === 'failed').length;
    const stageLabels: Record<string, string> = {
      upload: '上传阶段',
      stage1: '全局解析阶段',
      stage2: '角色资产审核阶段',
      stage3: '分页审核阶段',
      stage5: '装帧审核阶段',
      done: '装帧审核阶段',
    };
    setResumeBanner(
      `已恢复上次进度，停留在${stageLabels[store.currentStage] ?? '当前阶段'}；有 ${failedCount} 项失败可继续重试`,
    );
    sessionStorage.setItem('workbench-resume-banner-shown', '1');
  }, [
    store.assets,
    store.bindingImages,
    store.currentStage,
    store.finalPages,
    store.lastUpdatedAt,
    store.scriptRawText,
    store.styleRefImage,
  ]);

  // ===== Step 1: Upload =====
  const handleDocxUpload = useCallback(
    async (file: File) => {
      setDocxFile(file);
      store.setProcessing(true, '正在解析文档...');
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/parse-docx', {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || '解析失败');
        }
      const data = await res.json();
        store.setScriptFileName(file.name);
        store.setScriptRawText(data.text);
        const pages = parseScript(data.text);
        store.setScriptPages(pages);
        store.setProcessing(false);
      } catch (err) {
        store.setError(err instanceof Error ? err.message : '文档解析失败');
      }
    },
    [store],
  );

  const handleStyleUpload = useCallback(
    async (file: File) => {
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'png';
      const renamedFile = new File([file], `艺术风格参考图.${ext}`, {
        type: file.type,
      });
      setStyleFile(renamedFile);
      const base64 = await fileToBase64(file);
      store.setStyleRefImage(base64);
    },
    [store],
  );

  // ===== Start Pipeline =====
  const handleStart = useCallback(async () => {
    await syncUserPromptsFromFile();
    const settings = getSettings();
    const api = apiForParams ?? settings.api;
    const { prompts } = settings;

    if (!api.baseUrl || !api.apiKey) {
      store.setError('请先在设置页面配置 API 连接信息');
      return;
    }
    if (!store.scriptRawText || !store.styleRefImage) {
      store.setError('请先上传剧本文件和风格参考图');
      return;
    }

    store.clearError();

    // ===== Stage 1A: Style Analysis =====
    let freshStyleModule = store.styleModule;
    if (!freshStyleModule) {
      store.setStage('stage1');
      store.setStage1Step('style_analysis');
      store.setProcessing(true, '阶段1A: 正在解析画风与视觉质感...');
      store.addLog(
        '========================= 开始新任务 =========================',
        'info',
      );
      store.addLog('阶段1A: 开始请求风格解析...', 'info');

      try {
        const messages1A = fuseStyleAnalysis(
          store.scriptRawText,
          store.styleRefImage,
          prompts.prompt_0_3,
        );
        freshStyleModule = await callLLM(messages1A, {
          baseUrl: api.baseUrl,
          apiKey: api.apiKey,
          model: api.llmModel,
        });
        store.setStyleModule(freshStyleModule);
        store.addLog('阶段1A已完成。成功生成 [风格变量模块]。', 'success');
        store.addLog(
          `[风格变量模块预览]\n${freshStyleModule.slice(0, 50)}...`,
          'info',
        );
      } catch (err) {
        store.setError(
          `阶段1A失败: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
    }

    // ===== Stage 1B: Character Extraction =====
    let freshSlices = store.characterSlices;
    if (freshSlices.length === 0) {
      store.setStage('stage1');
      store.setStage1Step('character_extraction');
      store.setProcessing(true, '阶段1B: 正在提取角色与物品设定...');

      try {
        const messages1B = fuseCharacterExtraction(
          store.scriptRawText,
          prompts.prompt_0_4,
        );
        const charRaw = await callLLM(messages1B, {
          baseUrl: api.baseUrl,
          apiKey: api.apiKey,
          model: api.llmModel,
        });
        store.setCharacterPromptsRaw(charRaw);
        freshSlices = parseCharacterPrompts(charRaw);
        if (freshSlices.length === 0) {
          throw new Error(
            'LLM 返回的格式未能匹配角色/物品模板，提取数提取为0。请重试或在设置页放宽提示词指令。',
          );
        }
        store.setCharacterSlices(freshSlices);
        store.addLog(
          `阶段1B已完成。成功提取 ${freshSlices.length} 个角色/物品。`,
          'success',
        );
      } catch (err) {
        store.setError(
          `阶段1B失败: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
    }

    // ===== Stage 2: Asset Generation =====
    try {
      if (store.currentStage === 'upload' || store.currentStage === 'stage1') {
        store.setStage('stage2');
      }

      store.addLog('准备进行阶段2: 自动生成角色/物品三视图...', 'info');
      store.setProcessing(true, '阶段2: 正在生成角色/物品三视图...');

      let currentAssets = store.assets;
      const manualAssets = currentAssets.filter((a) => a.manual);
      const autoAssets = currentAssets.filter((a) => !a.manual);
      store.addLog(
        `阶段2启动检查: 现有资产项 ${currentAssets.length} (自动 ${autoAssets.length} + 手动 ${manualAssets.length}), 提取的角色数 ${freshSlices.length}`,
        'info',
      );

      // 自动资产：若为空或数量与提取数不匹配，则重新生成列表；手动资产始终保留
      if (
        autoAssets.length === 0 ||
        autoAssets.length !== freshSlices.length
      ) {
        store.addLog('正在同步资产列表与角色设定...', 'info');
        const newAutoAssets = freshSlices.map((slice, idx) => ({
          id: `asset-${idx}`,
          characterSlice: slice,
          imageData: '',
          status: 'pending' as const,
          approved: false,
        }));
        currentAssets = [...newAutoAssets, ...manualAssets];
        store.setAssets(currentAssets);
        store.addLog(
          `资产列表初始化完成: 共有 ${currentAssets.length} 项目待生成 (自动 ${newAutoAssets.length} + 手动 ${manualAssets.length})。`,
          'info',
        );
      }

      const generationPromises = currentAssets.map(async (asset) => {
        if (asset.manual) return; // 手动添加的资产不参与生成
        if (asset.status === 'done' && asset.imageData) {
          return;
        }

        store.updateAsset(asset.id, { status: 'generating', errorMessage: '' });
        store.addLog(
          `[队列] 开始生成: ${asset.characterSlice.nameCN}...`,
          'info',
        );

        try {
          const messages2 = fuseAssetGeneration(
            asset.characterSlice,
            freshStyleModule,
            store.styleRefImage,
            prompts.prompt_0_5,
          );

          const images = await callImageGen(messages2, {
            baseUrl: api.baseUrl,
            apiKey: api.apiKey,
            model: api.imageModel,
            imageAspectRatio: api.imageAspectRatioStage2,
            imageSize: api.imageSizeStage2,
          });

          if (images.length > 0) {
            const cleanB64 = normalizeImageDataUrl(images[0]);

            store.updateAsset(asset.id, {
              imageData: cleanB64,
              status: 'done',
              errorMessage: '',
            });
            store.addLog(
              `✅ 生成成功: ${asset.characterSlice.nameCN}`,
              'success',
            );
          } else {
            store.updateAsset(asset.id, {
              status: 'failed',
              imageData: '',
              errorMessage: formatCardError('未返回图像'),
            });
            store.addLog(
              `❌ 生成失败(未返回数据): ${asset.characterSlice.nameCN}`,
              'error',
            );
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          store.updateAsset(asset.id, {
            status: 'failed',
            imageData: '',
            errorMessage: formatCardError(err),
          });
          store.addLog(
            `🚨 生成报错: ${asset.characterSlice.nameCN} (${errMsg})`,
            'error',
          );
        }
      });

      await Promise.all(generationPromises);
      store.addLog('阶段2所有并行任务已处理完毕。', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      store.addLog(`阶段2发生同步错误: ${msg}`, 'error');
      store.setError(`阶段2执行意外中断: ${msg}`);
    } finally {
      store.setProcessing(false);
    }
  }, [store, apiForParams]);

  // ===== Stage 2: Regenerate Single Asset =====
  const handleRegenerateAsset = useCallback(
    async (assetId: string) => {
      const asset = store.assets.find((a) => a.id === assetId);
      if (!asset) return;

      const settings = getSettings();
      const api = apiForParams ?? settings.api;
      store.updateAsset(assetId, { status: 'generating', approved: false, errorMessage: '' });
      store.addLog(`🔄 开始重新生成: ${asset.characterSlice.nameCN}...`, 'info');

      try {
        const messages = fuseAssetGeneration(
          asset.characterSlice,
          store.styleModule,
          store.styleRefImage,
          settings.prompts.prompt_0_5,
        );
        const images = await callImageGen(messages, {
          baseUrl: api.baseUrl,
          apiKey: api.apiKey,
          model: api.imageModel,
          imageAspectRatio: api.imageAspectRatioStage2,
          imageSize: api.imageSizeStage2,
        });
        const newImage = images.length > 0 ? normalizeImageDataUrl(images[0]) : '';
        const history = [...(asset.imageHistory ?? []), asset.imageData].filter(Boolean).slice(-5);
        if (newImage) {
          store.updateAsset(assetId, {
            imageData: newImage,
            imageHistory: history,
            imageRedoStack: [],
            status: 'done',
            errorMessage: '',
          });
          store.addLog(`✅ 重新生成成功: ${asset.characterSlice.nameCN}`, 'success');
        } else {
          store.updateAsset(assetId, {
            imageHistory: history,
            imageRedoStack: [],
            status: 'failed',
            errorMessage: formatCardError('未返回图像'),
          });
          store.addLog(`❌ 重新生成失败(未返回数据): ${asset.characterSlice.nameCN}`, 'error');
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        store.addLog(
          `🚨 重新生成失败: ${asset.characterSlice.nameCN} (${errMsg})`,
          'error',
        );
        store.updateAsset(assetId, {
          status: 'failed',
          errorMessage: formatCardError(err),
        });
      }
    },
    [store, apiForParams],
  );

  // ===== Asset/Page 版本回退 =====
  const handleAssetRevert = useCallback(
    (assetId: string) => {
      const asset = store.assets.find((a) => a.id === assetId);
      if (!asset?.imageHistory?.length) return;
      const prev = asset.imageHistory[asset.imageHistory.length - 1];
      const newHistory = asset.imageHistory.slice(0, -1);
      const newRedo = [...(asset.imageRedoStack ?? []), asset.imageData];
      store.updateAsset(assetId, {
        imageData: prev,
        imageHistory: newHistory,
        imageRedoStack: newRedo,
      });
    },
    [store],
  );
  const handleAssetRedo = useCallback(
    (assetId: string) => {
      const asset = store.assets.find((a) => a.id === assetId);
      if (!asset?.imageRedoStack?.length) return;
      const next = asset.imageRedoStack[asset.imageRedoStack.length - 1];
      const newRedo = asset.imageRedoStack.slice(0, -1);
      const newHistory = [...(asset.imageHistory ?? []), asset.imageData];
      store.updateAsset(assetId, {
        imageData: next,
        imageHistory: newHistory,
        imageRedoStack: newRedo,
      });
    },
    [store],
  );
  const handlePageRevert = useCallback(
    (pageId: string) => {
      const page = store.finalPages.find((p) => p.id === pageId);
      if (!page?.imageHistory?.length) return;
      const prev = page.imageHistory[page.imageHistory.length - 1];
      const newHistory = page.imageHistory.slice(0, -1);
      const newRedo = [...(page.imageRedoStack ?? []), page.imageData];
      store.updateFinalPage(pageId, {
        imageData: prev,
        imageHistory: newHistory,
        imageRedoStack: newRedo,
      });
    },
    [store],
  );
  const handlePageRedo = useCallback(
    (pageId: string) => {
      const page = store.finalPages.find((p) => p.id === pageId);
      if (!page?.imageRedoStack?.length) return;
      const next = page.imageRedoStack[page.imageRedoStack.length - 1];
      const newRedo = page.imageRedoStack.slice(0, -1);
      const newHistory = [...(page.imageHistory ?? []), page.imageData];
      store.updateFinalPage(pageId, {
        imageData: next,
        imageHistory: newHistory,
        imageRedoStack: newRedo,
      });
    },
    [store],
  );

  const handleAssetEnlarge = useCallback(
    (assetId: string) => {
      const imgAssets = store.assets.filter((a) => a.imageData);
      const idx = imgAssets.findIndex((a) => a.id === assetId);
      setLightbox({ type: 'asset', index: idx >= 0 ? idx : 0 });
    },
    [store.assets],
  );

  const handleAddManualAsset = useCallback(
    (asset: AssetImage) => {
      store.addAsset(asset);
      store.addLog(`➕ 已添加手动资产: ${asset.characterSlice.nameCN}`, 'success');
    },
    [store],
  );

  const handleRemoveManualAsset = useCallback(
    (assetId: string) => {
      const asset = store.assets.find((a) => a.id === assetId);
      if (asset?.manual) {
        store.removeAsset(assetId);
        store.addLog(`🗑 已删除手动资产: ${asset.characterSlice.nameCN}`, 'info');
      }
    },
    [store],
  );

  const handleAssetError = useCallback(
    (assetId: string) => {
      const asset = store.assets.find((a) => a.id === assetId);
      if (asset) {
        store.addLog(
          `❌ [${asset.characterSlice.nameCN}] 的图片加载失败。若为高清大图，可能是数据过长；请尝试「重新生成」。`,
          'error',
        );
      }
    },
    [store],
  );

  const handleCancelAssetGenerating = useCallback(
    (assetId: string) => {
      store.updateAsset(assetId, {
        status: 'failed',
        errorMessage: '未知错误\n建议：请重试；若仍失败，请检查接口配置与网络状态',
      });
      const asset = store.assets.find((a) => a.id === assetId);
      if (asset) {
        store.addLog(`已取消生成: ${asset.characterSlice.nameCN}`, 'info');
      }
    },
    [store],
  );

  const handleCancelPageGenerating = useCallback(
    (pageId: string) => {
      store.updateFinalPage(pageId, {
        status: 'failed',
        errorMessage: '未知错误\n建议：请重试；若仍失败，请检查接口配置与网络状态',
      });
      const page = store.finalPages.find((p) => p.id === pageId);
      if (page) {
        store.addLog(`已取消生成: 第 ${page.pageNumber} 页`, 'info');
      }
    },
    [store],
  );

  const handleCancelBindingGenerating = useCallback(
    (bindingId: string) => {
      store.updateBindingImage(bindingId, {
        status: 'failed',
        errorMessage: '未知错误\n建议：请重试；若仍失败，请检查接口配置与网络状态',
      });
      const binding = store.bindingImages.find((b) => b.id === bindingId);
      if (binding) {
        const label = binding.type === 'cover' ? '封面' : binding.type === 'endpapers' ? '环衬' : '扉页';
        store.addLog(`已取消生成: ${label}`, 'info');
      }
    },
    [store],
  );

  const handlePageEnlarge = useCallback(
    (pageId: string) => {
      const imgPages = store.finalPages.filter((p) => p.imageData);
      const idx = imgPages.findIndex((p) => p.id === pageId);
      setLightbox({ type: 'page', index: idx >= 0 ? idx : 0 });
    },
    [store.finalPages],
  );

  const handlePageToggleStyleRef = useCallback(
    (pageId: string, currentUseStyleRef: boolean) => {
      store.updateFinalPage(pageId, { useStyleRef: !currentUseStyleRef });
    },
    [store],
  );

  const handlePageToggleRefAsset = useCallback(
    (pageId: string, assetId: string, selected: boolean) => {
      const page = store.finalPages.find((p) => p.id === pageId);
      if (!page) return;
      const ids = page.selectedRefAssetIds ?? [];
      const next = selected
        ? ids.filter((id) => id !== assetId)
        : [...ids, assetId];
      store.updateFinalPage(pageId, { selectedRefAssetIds: next });
    },
    [store],
  );

  const handleApproveAsset = useCallback(
    (assetId: string) => {
      const a = store.assets.find((x) => x.id === assetId);
      if (a) store.updateAsset(assetId, { approved: !a.approved });
    },
    [store],
  );

  const handleApprovePage = useCallback(
    (pageId: string) => {
      const p = store.finalPages.find((x) => x.id === pageId);
      if (p) store.updateFinalPage(pageId, { approved: !p.approved });
    },
    [store],
  );

  // ===== Stage 5: 封面/环衬/扉页 =====
  const allPagesApproved =
    store.finalPages.length > 0 &&
    store.finalPages.every((p) => p.approved && p.imageData);

  const handleStartStage5 = useCallback(() => {
    setBookTitleInput(store.bookTitle || '');
    setShowBookTitleModal(true);
  }, [store.bookTitle]);

  const handleConfirmBookTitle = useCallback(async () => {
    const title = bookTitleInput.trim();
    if (!title) return;

    setShowBookTitleModal(false);
    store.setBookTitle(title);

    const settings = getSettings();
    const api = apiForParams ?? settings.api;
    const { prompts } = settings;

    if (!api.baseUrl || !api.apiKey) {
      store.setError('请先在设置页面配置 API 连接信息');
      return;
    }
    if (!store.styleModule) {
      store.setError('缺少风格模块，请从阶段1重新开始');
      return;
    }

    const approvedPages = store.finalPages
      .filter((p) => p.approved && p.imageData)
      .sort((a, b) => a.pageNumber - b.pageNumber);
    if (approvedPages.length === 0) {
      store.setError('无已通过的分页图');
      return;
    }

    store.setStage('stage5');
    store.clearError();
    store.setProcessing(true, '阶段5: 正在生成宫格图...');
    store.addLog('阶段5: 开始制作封面/环衬/扉页...', 'info');

    try {
      const gridBase64 = await createPageGridImage(
        approvedPages.map((p) => p.imageData!),
      );
      store.setPageGridImage(gridBase64);
      store.addLog('宫格图生成完成，开始并行生图...', 'success');

      const initialBindings = [
        { id: 'binding-cover', type: 'cover' as const, imageData: '', status: 'pending' as const, approved: false },
        { id: 'binding-endpapers', type: 'endpapers' as const, imageData: '', status: 'pending' as const, approved: false },
        { id: 'binding-titlepage', type: 'titlepage' as const, imageData: '', status: 'pending' as const, approved: false },
      ];
      store.setBindingImages(initialBindings);
      store.setProcessing(true, '阶段5: 正在生成封面、环衬、扉页...');

      const coverMsg = fuseCoverGeneration(title, store.styleModule, gridBase64, prompts.prompt_0_6);
      const endpapersMsg = fuseEndpapersGeneration(store.styleModule, gridBase64, prompts.prompt_0_7);
      const titlepageMsg = fuseTitlePageGeneration(title, store.styleModule, gridBase64, prompts.prompt_0_8);

      const genOptions = {
        baseUrl: api.baseUrl,
        apiKey: api.apiKey,
        model: api.imageModel,
        imageAspectRatio: api.imageAspectRatioStage5,
        imageSize: api.imageSizeStage5,
      };

      const runCover = async () => {
        store.updateBindingImage('binding-cover', { status: 'generating', errorMessage: '' });
        store.addLog('[队列] 开始生成封面...', 'info');
        try {
          const imgs = await callImageGen(coverMsg, genOptions);
          const b64 = imgs.length > 0 ? normalizeImageDataUrl(imgs[0]) : '';
          store.updateBindingImage('binding-cover', {
            imageData: b64,
            status: b64 ? 'done' : 'failed',
            errorMessage: b64 ? '' : formatCardError('未返回图像'),
          });
          store.addLog(b64 ? '✅ 封面生成成功' : '❌ 封面生成失败', b64 ? 'success' : 'error');
        } catch (err) {
          store.updateBindingImage('binding-cover', {
            status: 'failed',
            errorMessage: formatCardError(err),
          });
          store.addLog(`🚨 封面生成报错: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
      };
      const runEndpapers = async () => {
        store.updateBindingImage('binding-endpapers', { status: 'generating', errorMessage: '' });
        store.addLog('[队列] 开始生成环衬...', 'info');
        try {
          const imgs = await callImageGen(endpapersMsg, genOptions);
          const b64 = imgs.length > 0 ? normalizeImageDataUrl(imgs[0]) : '';
          store.updateBindingImage('binding-endpapers', {
            imageData: b64,
            status: b64 ? 'done' : 'failed',
            errorMessage: b64 ? '' : formatCardError('未返回图像'),
          });
          store.addLog(b64 ? '✅ 环衬生成成功' : '❌ 环衬生成失败', b64 ? 'success' : 'error');
        } catch (err) {
          store.updateBindingImage('binding-endpapers', {
            status: 'failed',
            errorMessage: formatCardError(err),
          });
          store.addLog(`🚨 环衬生成报错: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
      };
      const runTitlepage = async () => {
        store.updateBindingImage('binding-titlepage', { status: 'generating', errorMessage: '' });
        store.addLog('[队列] 开始生成扉页...', 'info');
        try {
          const imgs = await callImageGen(titlepageMsg, genOptions);
          const b64 = imgs.length > 0 ? normalizeImageDataUrl(imgs[0]) : '';
          store.updateBindingImage('binding-titlepage', {
            imageData: b64,
            status: b64 ? 'done' : 'failed',
            errorMessage: b64 ? '' : formatCardError('未返回图像'),
          });
          store.addLog(b64 ? '✅ 扉页生成成功' : '❌ 扉页生成失败', b64 ? 'success' : 'error');
        } catch (err) {
          store.updateBindingImage('binding-titlepage', {
            status: 'failed',
            errorMessage: formatCardError(err),
          });
          store.addLog(`🚨 扉页生成报错: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
      };

      await Promise.all([runCover(), runEndpapers(), runTitlepage()]);
      store.addLog('阶段5所有任务已处理完毕。', 'success');
    } catch (err) {
      store.setError(
        `阶段5意外中断: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      store.setProcessing(false);
    }
  }, [store, apiForParams, bookTitleInput]);

  const handleRegenerateBinding = useCallback(
    async (id: string) => {
      const binding = store.bindingImages.find((b) => b.id === id);
      if (!binding) return;
      const state = usePipelineStore.getState();
      const gridImage = state.pageGridImage;
      if (!gridImage) {
        store.addLog('宫格图未就绪，请重新进入阶段5', 'error');
        return;
      }

      const settings = getSettings();
      const api = apiForParams ?? settings.api;
      const { prompts } = settings;
      store.updateBindingImage(id, { status: 'generating', approved: false, errorMessage: '' });
      store.addLog(`🔄 开始重新生成: ${binding.type === 'cover' ? '封面' : binding.type === 'endpapers' ? '环衬' : '扉页'}...`, 'info');

      try {
        const title = state.bookTitle;
        let messages;
        if (binding.type === 'cover') {
          messages = fuseCoverGeneration(title, state.styleModule, gridImage, prompts.prompt_0_6);
        } else if (binding.type === 'endpapers') {
          messages = fuseEndpapersGeneration(state.styleModule, gridImage, prompts.prompt_0_7);
        } else {
          messages = fuseTitlePageGeneration(title, state.styleModule, gridImage, prompts.prompt_0_8);
        }
        const imgs = await callImageGen(messages, {
          baseUrl: api.baseUrl,
          apiKey: api.apiKey,
          model: api.imageModel,
          imageAspectRatio: api.imageAspectRatioStage5,
          imageSize: api.imageSizeStage5,
        });
        const newImage = imgs.length > 0 ? normalizeImageDataUrl(imgs[0]) : '';
        const history = [...(binding.imageHistory ?? []), binding.imageData].filter(Boolean).slice(-5);
        if (newImage) {
          store.updateBindingImage(id, {
            imageData: newImage,
            imageHistory: history,
            imageRedoStack: [],
            status: 'done',
            errorMessage: '',
          });
          store.addLog(`✅ 重新生成成功: ${binding.type === 'cover' ? '封面' : binding.type === 'endpapers' ? '环衬' : '扉页'}`, 'success');
        } else {
          store.updateBindingImage(id, {
            imageHistory: history,
            imageRedoStack: [],
            status: 'failed',
            errorMessage: formatCardError('未返回图像'),
          });
          store.addLog('❌ 重新生成失败', 'error');
        }
      } catch (err) {
        store.updateBindingImage(id, {
          status: 'failed',
          errorMessage: formatCardError(err),
        });
        store.addLog(`🚨 重新生成失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    },
    [store, apiForParams],
  );

  const handleBindingRevert = useCallback(
    (id: string) => {
      const b = store.bindingImages.find((x) => x.id === id);
      if (!b?.imageHistory?.length) return;
      const prev = b.imageHistory[b.imageHistory.length - 1];
      const newHistory = b.imageHistory.slice(0, -1);
      const newRedo = [...(b.imageRedoStack ?? []), b.imageData];
      store.updateBindingImage(id, { imageData: prev, imageHistory: newHistory, imageRedoStack: newRedo });
    },
    [store],
  );
  const handleBindingRedo = useCallback(
    (id: string) => {
      const b = store.bindingImages.find((x) => x.id === id);
      if (!b?.imageRedoStack?.length) return;
      const next = b.imageRedoStack[b.imageRedoStack.length - 1];
      const newRedo = b.imageRedoStack.slice(0, -1);
      const newHistory = [...(b.imageHistory ?? []), b.imageData];
      store.updateBindingImage(id, { imageData: next, imageHistory: newHistory, imageRedoStack: newRedo });
    },
    [store],
  );
  const handleBindingRemoveSeam = useCallback(
    async (id: string) => {
      const state = usePipelineStore.getState();
      const binding = state.bindingImages.find((item) => item.id === id);
      if (!binding?.imageData) return;

      const settings = getSettings();
      const api = apiForParams ?? settings.api;
      if (!api.baseUrl || !api.apiKey) {
        store.setError('请先在设置页面配置 API 连接信息');
        return;
      }

      const template = (settings.prompts.prompt_stage4_remove_seam || '').trim();
      if (!template) {
        store.setError('请先在设置中配置「去书缝」的提示词模板');
        store.updateBindingImage(id, {
          status: 'failed',
          errorMessage: '配置缺失\n建议：请先在设置页补全该阶段提示词后再重试',
        });
        return;
      }

      const label = binding.type === 'cover' ? '封面' : binding.type === 'endpapers' ? '环衬' : '扉页';
      store.updateBindingImage(id, { status: 'generating', approved: false, errorMessage: '' });
      store.addLog(`🔄 去书缝: ${label}...`, 'info');

      try {
        const messages = [
          {
            role: 'user' as const,
            content: [
              { type: 'image_url' as const, image_url: { url: binding.imageData } },
              { type: 'text' as const, text: template },
            ],
          },
        ];
        const images = await callImageGen(messages, {
          baseUrl: api.baseUrl,
          apiKey: api.apiKey,
          model: api.imageModel,
          imageAspectRatio: api.imageAspectRatioStage5,
          imageSize: api.imageSizeStage5,
        });
        const newImage = images.length > 0 ? normalizeImageDataUrl(images[0]) : '';
        const history = [...(binding.imageHistory ?? []), binding.imageData].filter(Boolean).slice(-5);
        if (newImage) {
          store.updateBindingImage(id, {
            imageData: newImage,
            imageHistory: history,
            imageRedoStack: [],
            status: 'done',
            errorMessage: '',
          });
          store.addLog(`✅ 去书缝成功: ${label}`, 'success');
        } else {
          store.updateBindingImage(id, {
            imageHistory: history,
            imageRedoStack: [],
            status: 'failed',
            errorMessage: formatCardError('未返回图像'),
          });
          store.addLog(`❌ 去书缝失败: ${label}`, 'error');
        }
      } catch (err) {
        store.updateBindingImage(id, {
          status: 'failed',
          errorMessage: formatCardError(err),
        });
        store.addLog(`🚨 去书缝失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    },
    [store, apiForParams],
  );
  const handleApproveBinding = useCallback(
    (id: string) => {
      const b = store.bindingImages.find((x) => x.id === id);
      if (b) store.updateBindingImage(id, { approved: !b.approved });
    },
    [store],
  );
  const handleBindingEnlarge = useCallback(
    (id: string) => {
      const items = store.bindingImages.filter((b) => b.imageData);
      const idx = items.findIndex((b) => b.id === id);
      setLightbox({ type: 'binding', index: idx >= 0 ? idx : 0 });
    },
    [store.bindingImages],
  );

  // ===== Stage 3: Generate Pages =====
  const handleGeneratePages = useCallback(async () => {
    try {
      const settings = getSettings();
      const api = apiForParams ?? settings.api;
      store.setProcessing(true, '阶段3: 正在生成分页成品...');
      store.clearError();

      const state = usePipelineStore.getState();
      let currentPages = state.finalPages;
      if (
        currentPages.length === 0 ||
        currentPages.length !== state.scriptPages.length
      ) {
        const newPages = state.scriptPages.map((page, idx) => {
          const autoIds = computeAutoSelectedAssetIds(page.content, state.assets);
          return {
            id: `page-${idx}`,
            pageNumber: page.pageNumber,
            pageSlice: page,
            imageData: '',
            status: 'pending' as const,
            approved: false,
            useStyleRef: true,
            selectedRefAssetIds: autoIds,
          };
        });
        store.setFinalPages(newPages);
        currentPages = newPages;
      }

      const pagePromises = currentPages.map(async (pageItem) => {
        if (pageItem.status === 'done' && pageItem.imageData) return;

        store.updateFinalPage(pageItem.id, { status: 'generating', errorMessage: '' });
        store.addLog(
          `[队列] 开始生成分页: 第 ${pageItem.pageNumber} 页...`,
          'info',
        );

        try {
          const state = usePipelineStore.getState();
          const selectedIds = pageItem.selectedRefAssetIds ?? [];
          const charAssetImages = await resolveCharAssetImages(
            selectedIds,
            state.assets,
            (dropped) => {
              if (dropped.length > 0) {
                store.addLog(
                  `⚠️ 第 ${pageItem.pageNumber} 页: ${dropped.length} 张参考图因图片未加载被跳过，请刷新后重试`,
                  'warning',
                );
              }
            },
          );

          const styleRef = pageItem.useStyleRef !== false ? state.styleRefImage : undefined;
          const messages = fusePageGeneration(
            pageItem.pageSlice,
            state.styleModule,
            styleRef,
            charAssetImages,
            settings.prompts.prompt_0_0,
          );

          const images = await callImageGen(messages, {
            baseUrl: api.baseUrl,
            apiKey: api.apiKey,
            model: api.imageModel,
            imageAspectRatio: api.imageAspectRatioStage3,
            imageSize: api.imageSizeStage3,
          });

          if (images.length > 0) {
            const cleanPageB64 = normalizeImageDataUrl(images[0]);

            store.updateFinalPage(pageItem.id, {
              imageData: cleanPageB64,
              status: 'done',
              errorMessage: '',
            });
            store.addLog(`✅ 成功生成第 ${pageItem.pageNumber} 页`, 'success');
          } else {
            store.updateFinalPage(pageItem.id, {
              status: 'failed',
              errorMessage: formatCardError('未返回图像'),
            });
            store.addLog(
              `❌ 生成第 ${pageItem.pageNumber} 页失败: 未返回图像`,
              'error',
            );
          }
        } catch (err) {
          store.updateFinalPage(pageItem.id, {
            status: 'failed',
            errorMessage: formatCardError(err),
          });
          store.addLog(
            `🚨 生成第 ${pageItem.pageNumber} 页报错: ${err instanceof Error ? err.message : String(err)}`,
            'error',
          );
        }
      });

      await Promise.all(pagePromises);
      store.addLog('阶段3所有并行任务已处理完毕。', 'success');
    } catch (err) {
      store.setError(
        `阶段3意外中断: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      store.setProcessing(false);
    }
  }, [store, apiForParams]);

  // ===== Stage 3: Prepare Pages (create cards, auto-start generation) =====
  const handlePreparePages = useCallback(() => {
    store.setStage('stage3');
    store.clearError();
    const currentPages = store.scriptPages.map((page, idx) => {
      const autoIds = computeAutoSelectedAssetIds(page.content, store.assets);
      return {
        id: `page-${idx}`,
        pageNumber: page.pageNumber,
        pageSlice: page,
        imageData: '',
        status: 'pending' as const,
        approved: false,
        useStyleRef: true,
        selectedRefAssetIds: autoIds,
      };
    });
    store.setFinalPages(currentPages);
    store.addLog(
      `已为所有分页全选参考图，共 ${currentPages.length} 页待生成`,
      'info',
    );
    handleGeneratePages();
  }, [store, handleGeneratePages]);

  // ===== Stage 3: Regenerate Single Page =====
  const handleRegeneratePage = useCallback(
    async (pageId: string) => {
      const state = usePipelineStore.getState();
      const page = state.finalPages.find((p) => p.id === pageId);
      if (!page) return;

      const settings = getSettings();
      const api = apiForParams ?? settings.api;
      store.updateFinalPage(pageId, { status: 'generating', approved: false, errorMessage: '' });
      store.addLog(`🔄 开始重新生成: 第 ${page.pageNumber} 页...`, 'info');

      try {
        const selectedIds = page.selectedRefAssetIds ?? [];
        const charAssetImages = await resolveCharAssetImages(
          selectedIds,
          state.assets,
          (dropped) => {
            if (dropped.length > 0) {
              store.addLog(
                `⚠️ 第 ${page.pageNumber} 页: ${dropped.length} 张参考图因图片未加载被跳过，请刷新后重试`,
                'warning',
              );
            }
          },
        );

        const styleRef = page.useStyleRef !== false ? state.styleRefImage : undefined;
        const messages = fusePageGeneration(
          page.pageSlice,
          state.styleModule,
          styleRef,
          charAssetImages,
          settings.prompts.prompt_0_0,
        );
        const images = await callImageGen(messages, {
          baseUrl: api.baseUrl,
          apiKey: api.apiKey,
          model: api.imageModel,
          imageAspectRatio: api.imageAspectRatioStage3,
          imageSize: api.imageSizeStage3,
        });
        const newImage = images.length > 0 ? normalizeImageDataUrl(images[0]) : '';
        const history = [...(page.imageHistory ?? []), page.imageData].filter(Boolean).slice(-5);
        if (newImage) {
          store.updateFinalPage(pageId, {
            imageData: newImage,
            imageHistory: history,
            imageRedoStack: [],
            status: 'done',
            errorMessage: '',
          });
          store.addLog(`✅ 重新生成成功: 第 ${page.pageNumber} 页`, 'success');
        } else {
          store.updateFinalPage(pageId, {
            imageHistory: history,
            imageRedoStack: [],
            status: 'failed',
            errorMessage: formatCardError('未返回图像'),
          });
          store.addLog(`❌ 重新生成第 ${page.pageNumber} 页失败: 未返回图像`, 'error');
        }
      } catch (err) {
        store.addLog(
          `🚨 重新生成第 ${page.pageNumber} 页失败: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
        store.updateFinalPage(pageId, {
          status: 'failed',
          errorMessage: formatCardError(err),
        });
      }
    },
    [store, apiForParams],
  );

  // ===== Stage 4: 去文字 / 去书缝 / 添加配文 =====
  const runStage4Modify = useCallback(
    async (
      pageId: string,
      promptKey: 'prompt_stage4_remove_text' | 'prompt_stage4_remove_seam' | 'prompt_stage4_add_caption',
      label: string,
      getPrompt: (template: string, page: { pageSlice: { content: string } }) => string,
      /** 若提供则跳过模板校验，直接使用 getPrompt 的返回值 */
      skipTemplateCheck?: boolean,
    ) => {
      const state = usePipelineStore.getState();
      const page = state.finalPages.find((p) => p.id === pageId);
      if (!page?.imageData) return;

      const settings = getSettings();
      const api = apiForParams ?? settings.api;
      if (!api.baseUrl || !api.apiKey) {
        store.setError('请先在设置页面配置 API 连接信息');
        return;
      }

      const template = settings.prompts[promptKey] || '';
      if (!skipTemplateCheck && !template.trim()) {
        store.setError(`请先在设置中配置「${label}」的提示词模板`);
        store.updateFinalPage(pageId, {
          status: 'failed',
          errorMessage: '配置缺失\n建议：请先在设置页补全该阶段提示词后再重试',
        });
        return;
      }

      const prompt = getPrompt(template, page);
      if (!prompt.trim()) {
        store.setError(`请先在设置中配置「${label}」的提示词模板`);
        store.updateFinalPage(pageId, {
          status: 'failed',
          errorMessage: '配置缺失\n建议：请先在设置页补全该阶段提示词后再重试',
        });
        return;
      }
      store.updateFinalPage(pageId, { status: 'generating', approved: false, errorMessage: '' });
      store.addLog(`🔄 ${label}: 第 ${page.pageNumber} 页...`, 'info');

      try {
        const messages = [
          {
            role: 'user' as const,
            content: [
              { type: 'image_url' as const, image_url: { url: page.imageData } },
              { type: 'text' as const, text: prompt },
            ],
          },
        ];
        const images = await callImageGen(messages, {
          baseUrl: api.baseUrl,
          apiKey: api.apiKey,
          model: api.imageModel,
          imageAspectRatio: api.imageAspectRatioStage3,
          imageSize: api.imageSizeStage3,
        });
        const newImage = images.length > 0 ? normalizeImageDataUrl(images[0]) : '';
        const history = [...(page.imageHistory ?? []), page.imageData].filter(Boolean).slice(-5);
        if (newImage) {
          store.updateFinalPage(pageId, {
            imageData: newImage,
            imageHistory: history,
            imageRedoStack: [],
            status: 'done',
            errorMessage: '',
          });
          store.addLog(`✅ ${label}成功: 第 ${page.pageNumber} 页`, 'success');
        } else {
          store.updateFinalPage(pageId, {
            imageHistory: history,
            imageRedoStack: [],
            status: 'failed',
            errorMessage: formatCardError('未返回图像'),
          });
          store.addLog(`❌ ${label}第 ${page.pageNumber} 页失败: 未返回图像`, 'error');
        }
      } catch (err) {
        store.addLog(
          `🚨 ${label}第 ${page.pageNumber} 页失败: ${err instanceof Error ? err.message : String(err)}`,
          'error',
        );
        store.updateFinalPage(pageId, {
          status: 'failed',
          errorMessage: formatCardError(err),
        });
      }
    },
    [store, apiForParams],
  );

  const handleConfirmModify = useCallback(
    async (pageId: string, actions: ('removeText' | 'removeSeam')[]) => {
      if (actions.length === 0) return;
      const settings = getSettings();
      const prompts = settings.prompts;
      const textPrompt = (prompts.prompt_stage4_remove_text || '').trim();
      const seamPrompt = (prompts.prompt_stage4_remove_seam || '').trim();

      let mergedPrompt = '';
      let label = '';
      if (actions.length === 1) {
        if (actions[0] === 'removeText') {
          mergedPrompt = textPrompt;
          label = '去文字';
        } else {
          mergedPrompt = seamPrompt;
          label = '去书缝';
        }
      } else {
        mergedPrompt = [textPrompt, seamPrompt].filter(Boolean).join('。同时');
        label = '去文字+去书缝';
      }

      if (!mergedPrompt) {
        store.setError('请先在设置中配置「去文字」和「去书缝」的提示词模板');
        return;
      }

      await runStage4Modify(
        pageId,
        'prompt_stage4_remove_text',
        label,
        () => mergedPrompt,
        true,
      );
    },
    [runStage4Modify, store],
  );

  const handleAddCaption = useCallback(
    (pageId: string) =>
      runStage4Modify(
        pageId,
        'prompt_stage4_add_caption',
        '添加配文',
        (t, p) => t.replace(/\{\{绘本文案\}\}/g, extractCaptionFromPageContent(p.pageSlice.content)),
      ),
    [runStage4Modify],
  );

  // ===== Download =====
  const handleDownload = useCallback(async () => {
    const approvedAssets = store.assets.filter(
      (a) => a.approved && a.imageData,
    );
    const approvedPages = store.finalPages
      .filter((p) => p.imageData)
      .sort((a, b) => a.pageNumber - b.pageNumber);
    const approvedBindingsForDownload = store.bindingImages.filter(
      (b) => b.imageData,
    );
    if (
      approvedAssets.length === 0 &&
      approvedPages.length === 0 &&
      approvedBindingsForDownload.length === 0
    )
      return;

    const images: { filename: string; base64: string }[] = [];

    for (const a of approvedAssets) {
      const prefix = a.characterSlice.type === 'item' ? '物品' : '角色';
      const ext = a.imageData!.startsWith('data:image/png') ? 'png' : 'jpg';
      images.push({
        filename: `角色物品_${prefix}：${a.characterSlice.nameCN}.${ext}`,
        base64: a.imageData!,
      });
    }
    for (const p of approvedPages) {
      images.push({
        filename: `绘本_第${p.pageNumber}页.png`,
        base64: p.imageData,
      });
    }
    for (const b of approvedBindingsForDownload) {
      const label =
        b.type === 'cover'
          ? '0_1封面'
          : b.type === 'endpapers'
            ? '0_2环衬'
            : '0_3扉页';
      const ext = b.imageData!.startsWith('data:image/png') ? 'png' : 'jpg';
      images.push({ filename: `${label}.${ext}`, base64: b.imageData! });
    }

    await downloadAsZip(images);
  }, [store.assets, store.finalPages, store.bindingImages]);

  const handleDownloadApprovedAssets = useCallback(async () => {
    const approvedAssets = store.assets.filter(
      (a) => a.approved && a.imageData,
    );
    if (approvedAssets.length === 0) return;

    const images = approvedAssets.map((a) => {
      const prefix =
        a.characterSlice.type === 'item' ? '物品' : '角色';
      const ext = a.imageData!.startsWith('data:image/png') ? 'png' : 'jpg';
      const filename = `${prefix}：${a.characterSlice.nameCN}.${ext}`;
      return { filename, base64: a.imageData! };
    });

    await downloadAsZip(images);
  }, [store.assets]);

  // ===== Complete: 保存已通过图到画廊 =====
  const approvedAssets = store.assets.filter(
    (a) => a.approved && a.imageData,
  );
  const approvedPages = store.finalPages
    .filter((p) => p.approved && p.imageData)
    .sort((a, b) => a.pageNumber - b.pageNumber);
  const approvedBindings = store.bindingImages.filter(
    (b) => b.approved && b.imageData,
  );
  const canComplete =
    approvedAssets.length > 0 ||
    approvedPages.length > 0 ||
    approvedBindings.length > 0;

  const handleComplete = useCallback(async () => {
    const name = completeName.trim();
    if (!name) return;
    if (isSavingToGallery) return;

    setIsSavingToGallery(true);
    // 让出主线程，使「保存中...」能先渲染，避免用户误以为卡死
    await new Promise<void>((r) => setTimeout(r, 0));

    try {
      await saveCurrentWorkbenchProject({ status: 'completed', name });
      setShowCompleteModal(false);
      setCompleteName('');
      store.addLog(`✅ 已保存「${name}」到画廊`, 'success');
    } catch (err) {
      store.addLog(`保存失败: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setIsSavingToGallery(false);
    }
  }, [store, completeName, isSavingToGallery]);

  // ===== Determine which steps are active/done =====
  const getStepState = (step: number): 'pending' | 'active' | 'done' => {
    const stageMap: Record<string, number> = {
      upload: 1,
      stage1: 2,
      stage2: 3,
      stage3: 4,
      done: 5,
      stage5: 5,
    };
    const current = stageMap[store.currentStage] || 1;
    if (step < current) return 'done';
    if (step === current) return 'active';
    return 'pending';
  };
  const expandedSteps = useMemo(() => new Set([focusedStep]), [focusedStep]);

  const allAssetsApproved =
    store.assets.length > 0 && store.assets.every((a) => a.approved);
  const failedAssetsCount = store.assets.filter((a) => a.status === 'failed').length;
  const failedPagesCount = store.finalPages.filter((p) => p.status === 'failed').length;
  const failedBindingsCount = store.bindingImages.filter((b) => b.status === 'failed').length;
  const pendingAssetReviewCount = store.assets.filter((a) => !a.approved).length;
  const pendingPageReviewCount = store.finalPages.filter((p) => !p.approved).length;
  const pendingBindingReviewCount = store.bindingImages.filter((b) => !b.approved).length;
  const uploadHint = useMemo(() => {
    if (!store.scriptRawText && !store.styleRefImage) return '还缺剧本和风格图，先把这两项上传完整。';
    if (!store.scriptRawText) return '还缺剧本文件，上传 .docx 后才能开始生成。';
    if (!store.styleRefImage) return '还缺风格参考图，上传后才能开始生成。';
    return '素材已齐，可以开始生成绘本。';
  }, [store.scriptRawText, store.styleRefImage]);

  const assetHint = useMemo(() => {
    if (store.assets.length === 0) return '阶段1 完成后会在这里生成角色与物品资产。';
    if (pendingAssetReviewCount > 0) {
      return `还有 ${pendingAssetReviewCount} 个资产待审核，失败 ${failedAssetsCount} 项，全部通过后才能进入分页阶段。`;
    }
    return `资产审核完成${failedAssetsCount > 0 ? `，另有 ${failedAssetsCount} 项失败可重试` : ''}，可以进入分页阶段。`;
  }, [failedAssetsCount, pendingAssetReviewCount, store.assets.length]);

  const pageHint = useMemo(() => {
    if (store.finalPages.length === 0) return '资产审核完成后，会在这里生成分页成品。';
    if (pendingPageReviewCount > 0) {
      return `还有 ${pendingPageReviewCount} 页待审核，失败 ${failedPagesCount} 页，全部通过后才能制作装帧。`;
    }
    return `分页审核完成${failedPagesCount > 0 ? `，另有 ${failedPagesCount} 页失败可重试` : ''}，可以制作装帧。`;
  }, [failedPagesCount, pendingPageReviewCount, store.finalPages.length]);

  const bindingHint = useMemo(() => {
    if (store.bindingImages.length === 0) return '分页审核完成后，会在这里生成封面、环衬和扉页。';
    if (pendingBindingReviewCount > 0) {
      return `还有 ${pendingBindingReviewCount} 张装帧图待审核${failedBindingsCount > 0 ? `，失败 ${failedBindingsCount} 张` : ''}。通过后可保存到画廊。`;
    }
    return `装帧审核完成${failedBindingsCount > 0 ? `，另有 ${failedBindingsCount} 张失败可重试` : ''}，现在可以打包下载或保存到画廊。`;
  }, [failedBindingsCount, pendingBindingReviewCount, store.bindingImages.length]);

  const pendingJumpTargets = useMemo(() => {
    if (store.currentStage === 'stage2') {
      return store.assets
        .filter((item) => !item.approved)
        .map((item) => ({
          id: `asset-${item.id}`,
          step: 3,
          label: item.characterSlice.nameCN,
        }));
    }
    if (store.currentStage === 'stage3') {
      return store.finalPages
        .filter((item) => !item.approved)
        .map((item) => ({
          id: `page-${item.id}`,
          step: 4,
          label: `第 ${item.pageNumber} 页`,
        }));
    }
    if (store.currentStage === 'stage5' || store.currentStage === 'done') {
      return store.bindingImages
        .filter((item) => !item.approved)
        .map((item) => ({
          id: `binding-${item.id}`,
          step: 5,
          label: item.type === 'cover' ? '封面' : item.type === 'endpapers' ? '环衬' : '扉页',
        }));
    }
    return [];
  }, [store.assets, store.bindingImages, store.currentStage, store.finalPages]);

  const currentStageLabel = useMemo(() => {
    if (store.currentStage === 'upload') return '上传素材';
    if (store.currentStage === 'stage1') return '全局解析';
    if (store.currentStage === 'stage2') return '角色资产审核';
    if (store.currentStage === 'stage3') return '分页审核';
    return '装帧审核';
  }, [store.currentStage]);

  useEffect(() => {
    const stageToStep: Record<string, number> = {
      upload: 1,
      stage1: 2,
      stage2: 3,
      stage3: 4,
      stage5: 5,
      done: 5,
    };
    setFocusedStep(stageToStep[store.currentStage] ?? 1);
  }, [store.currentStage]);

  const handleContinueCurrentStep = useCallback(() => {
    const stageToStep: Record<string, number> = {
      upload: 1,
      stage1: 2,
      stage2: 3,
      stage3: 4,
      stage5: 5,
      done: 5,
    };
    const step = stageToStep[store.currentStage] ?? 1;
    setFocusedStep(step);
    window.setTimeout(() => {
      document.querySelector('.step.is-selected')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }, [store.currentStage]);

  return (
    <>
    <div className="workbench-shell">
      <aside className="workbench-sidebar">
        <div className="workbench-sidebar-section">
          <div className="workbench-sidebar-title">项目概览</div>
          <div className="workbench-sidebar-subtitle">当前阶段：{currentStageLabel}</div>
          <div className="workbench-summary-grid">
            <div className="workbench-summary-item">
              <span>剧本页数</span>
              <strong>{store.scriptPages.length}</strong>
            </div>
            <div className="workbench-summary-item">
              <span>通过资产</span>
              <strong>{approvedAssets.length}</strong>
            </div>
            <div className="workbench-summary-item">
              <span>通过分页</span>
              <strong>{approvedPages.length}</strong>
            </div>
            <div className="workbench-summary-item">
              <span>通过装帧</span>
              <strong>{approvedBindings.length}</strong>
            </div>
          </div>
          <div className="workbench-summary-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={handleContinueCurrentStep}>
              继续当前步骤
            </button>
          </div>
        </div>

        <div className="workbench-sidebar-section">
          <div className="workbench-sidebar-title">工作流阶段</div>
          <div className="workbench-stage-nav">
            {[
              { step: 1, title: '上传素材', hint: uploadHint },
              { step: 2, title: '全局解析', hint: store.characterSlices.length > 0 ? `已提取 ${store.characterSlices.length} 个角色/物品` : '等待画风与角色解析' },
              { step: 3, title: '角色资产审核', hint: assetHint },
              { step: 4, title: '分页审核', hint: pageHint },
              { step: 5, title: '装帧审核', hint: bindingHint },
            ].map((item) => (
              <button
                key={item.step}
                type="button"
                className={`workbench-stage-nav-item ${focusedStep === item.step ? 'active' : ''}`}
                onClick={() => setFocusedStep(item.step)}
              >
                <span className={`workbench-stage-nav-index ${getStepState(item.step)}`}>{item.step}</span>
                <span className="workbench-stage-nav-copy">
                  <strong>{item.title}</strong>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="workbench-sidebar-section workbench-sidebar-section-compact">
          <div className="workbench-sidebar-title">未通过跳转</div>
          <div className="workbench-sidebar-subtitle">
            {pendingJumpTargets.length > 0
              ? `当前阶段还有 ${pendingJumpTargets.length} 项未通过`
              : '当前阶段已全部通过'}
          </div>
          {pendingJumpTargets.length > 0 ? (
            <div className="workbench-compact-jumps">
              {pendingJumpTargets.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="workbench-compact-jump"
                  onClick={() => {
                    setFocusedStep(item.step);
                    window.setTimeout(() => {
                      document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 0);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="workbench-compact-empty">当前没有需要跳转处理的项目</div>
          )}
        </div>

      </aside>

      <div className="workbench-main">
        {store.errorMessage && (
          <div className="alert alert-error">
            ❌ {store.errorMessage}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => store.clearError()}
              style={{ marginLeft: 'auto' }}
            >
              ✕
            </button>
          </div>
        )}

        {handoffBanner && (
          <div className="alert alert-info">
            ℹ️ {handoffBanner}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setHandoffBanner('')}
              style={{ marginLeft: 'auto' }}
            >
              ✕
            </button>
          </div>
        )}

        {resumeBanner && (
          <div className="alert alert-info">
            ⏱️ {resumeBanner}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setResumeBanner('')}
              style={{ marginLeft: 'auto' }}
            >
              ✕
            </button>
          </div>
        )}

        <div className="steps-container workbench-stage-panel">
        {/* ========== Step 1: Upload ========== */}
        <div className={`step ${focusedStep === 1 ? 'is-selected' : 'is-hidden'}`}>
          <div className="step-header">
            <button
              type="button"
              className={`step-number step-toggle ${getStepState(1)}`}
              onClick={() => setFocusedStep(1)}
              title="查看上传素材阶段"
            >
              {getStepState(1) === 'done' ? '✓' : '1'}
            </button>
            <div>
              <div className="step-title">上传素材</div>
              <div className="step-status">
                上传故事剧本 (.docx) 和艺术风格参考图 (阶段1)
              </div>
              <div className="step-hint">{uploadHint}</div>
            </div>
          </div>

          {(store.currentStage === 'upload' || getStepState(1) === 'done') &&
            (expandedSteps.has(1) ? (
              <div className="step-content">
                <div className="form-row" style={{ marginBottom: 16 }}>
                {/* DOCX Upload */}
                <div>
                  <input
                    ref={docxInputRef}
                    type="file"
                    accept=".docx"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleDocxUpload(f);
                    }}
                  />
                  <div
                    className={`upload-zone ${docxFile ? '' : ''}`}
                    onClick={() => docxInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.add('drag-over');
                    }}
                    onDragLeave={(e) =>
                      e.currentTarget.classList.remove('drag-over')
                    }
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('drag-over');
                      const f = e.dataTransfer.files[0];
                      if (f && f.name.endsWith('.docx')) handleDocxUpload(f);
                    }}
                  >
                    {docxFile || store.scriptFileName ? (
                      <div className="upload-zone-preview">
                        <span style={{ fontSize: '2.5rem' }}>📄</span>
                        <div className="upload-zone-preview-info">
                          <div className="upload-zone-preview-name">
                            {docxFile?.name || store.scriptFileName}
                          </div>
                          <div className="upload-zone-preview-size">
                            {store.scriptPages.length > 0
                              ? `✅ 已解析 ${store.scriptPages.length} 页`
                              : '解析中...'}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="upload-zone-icon">📄</div>
                        <div className="upload-zone-text">
                          点击或拖拽上传故事剧本
                        </div>
                        <div className="upload-zone-hint">支持 .docx 格式</div>
                      </>
                    )}
                  </div>
                </div>

                {/* Style Image Upload */}
                <div>
                  <input
                    ref={styleInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleStyleUpload(f);
                    }}
                  />
                  <div
                    className="upload-zone"
                    onClick={() => styleInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.add('drag-over');
                    }}
                    onDragLeave={(e) =>
                      e.currentTarget.classList.remove('drag-over')
                    }
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('drag-over');
                      const f = e.dataTransfer.files[0];
                      if (f) handleStyleUpload(f);
                    }}
                  >
                    {store.styleRefImage ? (
                      <div className="upload-zone-preview">
                        {/* eslint-disable-next-line @next/next/no-img-element -- Base64 动态内容不适合 next/image 优化 */}
                        <img src={store.styleRefImage} alt="风格参考图" />
                        <div className="upload-zone-preview-info">
                          <div className="upload-zone-preview-name">
                            {styleFile?.name || '风格参考图'}
                          </div>
                          <div className="upload-zone-preview-size">
                            ✅ 已上传
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="upload-zone-icon">🖼️</div>
                        <div className="upload-zone-text">
                          点击或拖拽上传风格参考图
                        </div>
                        <div className="upload-zone-hint">
                          支持 jpg, png 格式
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Script Preview */}
              {store.scriptPages.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div className="form-label" style={{ marginBottom: 8 }}>
                    📖 剧本分页总览 ({store.scriptPages.length} 页)
                  </div>
                  <div className="script-pages script-pages-compact">
                    {store.scriptPages.map((page) => (
                      <div className="script-page-chip" key={`script-${page.pageNumber}`}>
                        <div className="script-page-number">
                          第 {page.pageNumber} 页
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {store.currentStage === 'upload' && (
                <button
                  type="button"
                  className="btn btn-primary btn-lg w-full"
                  disabled={
                    store.isProcessing ||
                    !store.scriptRawText ||
                    !store.styleRefImage
                  }
                  onClick={handleStart}
                  style={{ marginTop: 8 }}
                >
                  {store.isProcessing ? (
                    <>
                      <span className="spinner" /> {store.progressMessage}
                    </>
                  ) : (
                    '🚀 开始生成绘本'
                  )}
                </button>
              )}
              </div>
            ) : (
              <div className="step-summary">
                剧本 {store.scriptPages.length} 页 · 风格参考图
                {store.styleRefImage ? '已上传' : '未上传'}
              </div>
            ))}
        </div>

        {/* ========== Step 2: Stage 1 - Global Parsing ========== */}
        <div className={`step ${focusedStep === 2 ? 'is-selected' : 'is-hidden'}`}>
          <div className="step-header">
            <button
              type="button"
              className={`step-number step-toggle ${getStepState(2)}`}
              onClick={() => setFocusedStep(2)}
              title="查看全局解析阶段"
            >
              {getStepState(2) === 'done' ? '✓' : '2'}
            </button>
            <div>
              <div className="step-title">全局解析</div>
              <div className="step-status">
                {store.currentStage === 'stage1'
                  ? store.progressMessage
                  : '自动解析画风与角色设定 (阶段2)'}
              </div>
              <div className="step-hint">
                {store.characterSlices.length > 0
                  ? `已提取 ${store.characterSlices.length} 个角色/物品，解析完成后会自动进入资产生成。`
                  : '系统会先分析画风，再提取角色与物品设定。'}
              </div>
            </div>
          </div>

          {(store.currentStage === 'stage1' || getStepState(2) === 'done') &&
            (expandedSteps.has(2) ? (
              <div className="step-content">
                {store.currentStage === 'stage1' && store.isProcessing ? (
                <div className="loading-overlay">
                  <span className="spinner" style={{ width: 32, height: 32 }} />
                  <div className="loading-text">{store.progressMessage}</div>
                  <div
                    style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}
                  >
                    系统正在自动解析，请稍候...
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gap: '16px',
                    gridTemplateColumns: '1fr',
                  }}
                >
                  <div
                    className="script-page-card"
                    style={{ minHeight: '200px' }}
                  >
                    <div className="script-page-number">
                      🌟 画风与视觉质感模块 (1_1)
                    </div>
                    <div
                      className="script-page-content"
                      style={{
                        fontSize: '0.9rem',
                        whiteSpace: 'pre-wrap',
                        maxHeight: '200px',
                        overflowY: 'auto',
                      }}
                    >
                      {store.styleModule || '等待解析...'}
                    </div>
                  </div>
                  <div
                    className="script-page-card"
                    style={{ minHeight: '200px' }}
                  >
                    <div className="script-page-number">
                      👥 提取的角色/物品设定 (1_2)
                    </div>
                    <div
                      className="script-page-content"
                      style={{
                        fontSize: '0.9rem',
                        whiteSpace: 'pre-wrap',
                        maxHeight: '200px',
                        overflowY: 'auto',
                      }}
                    >
                      {store.characterSlices.length > 0
                        ? store.characterSlices.map((c, i) => (
                            <div
                              key={i}
                              style={{
                                marginBottom: 16,
                                paddingBottom: 16,
                                borderBottom: '1px solid var(--border)',
                              }}
                            >
                              {c.rawText}
                            </div>
                          ))
                        : '等待提取...'}
                    </div>
                  </div>
                </div>
              )}

              {!store.isProcessing &&
                store.currentStage === 'stage1' &&
                store.errorMessage && (
                  <button
                    type="button"
                    className="btn btn-primary w-full mt-16"
                    onClick={handleStart}
                  >
                    🚀 尝试继续进行解析
                  </button>
                )}
              </div>
            ) : (
              <div className="step-summary">
                风格模块已解析 · 已提取 {store.characterSlices.length} 个角色/物品
              </div>
            ))}
        </div>

        {/* ========== Step 3: Stage 2 - Asset Review ========== */}
        <div className={`step ${focusedStep === 3 ? 'is-selected' : 'is-hidden'}`}>
          <div className="step-header">
            <button
              type="button"
              className={`step-number step-toggle ${getStepState(3)}`}
              onClick={() => setFocusedStep(3)}
              title="查看角色资产审核阶段"
            >
              {getStepState(3) === 'done' ? '✓' : '3'}
            </button>
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div className="step-title">角色资产审核</div>
                <div className="step-status">
                  {store.currentStage === 'stage2'
                    ? store.isProcessing
                      ? store.progressMessage
                      : '请审核以下角色/物品三视图'
                    : '阶段3'}
                </div>
                <div className="step-hint">{assetHint}</div>
              </div>
              {(apiForParams ?? getSettings().api) && (
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    fontSize: 0.8,
                  }}
                >
                  <select
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: '0.8rem', minWidth: 80 }}
                    value={(apiForParams ?? getSettings().api).imageAspectRatioStage2}
                    onChange={(e) => {
                      const api = getSettings().api;
                      const next = {
                        ...api,
                        imageAspectRatioStage2: e.target.value as AspectRatioType,
                      };
                      saveApiSettings(next);
                      setApiForParams(next);
                    }}
                  >
                    <option value="auto">自适应</option>
                    <option value="1:1">1:1</option>
                    <option value="1:2">1:2</option>
                    <option value="2:1">2:1</option>
                    <option value="2:3">2:3</option>
                    <option value="3:2">3:2</option>
                    <option value="3:4">3:4</option>
                    <option value="4:3">4:3</option>
                    <option value="9:16">9:16</option>
                    <option value="16:9">16:9</option>
                  </select>
                  <select
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: '0.8rem', minWidth: 60 }}
                    value={(apiForParams ?? getSettings().api).imageSizeStage2}
                    onChange={(e) => {
                      const api = getSettings().api;
                      const next = {
                        ...api,
                        imageSizeStage2: e.target.value as ImageSizeType,
                      };
                      saveApiSettings(next);
                      setApiForParams(next);
                    }}
                  >
                    <option value="1K">1K</option>
                    <option value="2K">2K</option>
                    <option value="4K">4K</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {(store.currentStage === 'stage2' ||
            store.currentStage === 'stage3' ||
            store.currentStage === 'stage5' ||
            store.currentStage === 'done') &&
            store.assets.length > 0 &&
            (expandedSteps.has(3) ? (
              <div className="step-content">
                <div className="gallery-grid">
                  {store.assets.map((asset) => (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      currentStage={store.currentStage}
                      isProcessing={store.isProcessing}
                      onEnlarge={handleAssetEnlarge}
                      onError={handleAssetError}
                      onApprove={handleApproveAsset}
                      onRegenerate={handleRegenerateAsset}
                      onRevert={handleAssetRevert}
                      onRedo={handleAssetRedo}
                      onCancelGenerating={handleCancelAssetGenerating}
                      onRemove={handleRemoveManualAsset}
                      lazyImage
                    />
                  ))}
                  {(store.currentStage === 'stage2' ||
                    store.currentStage === 'stage3' ||
                    store.currentStage === 'stage5' ||
                    store.currentStage === 'done') &&
                    !store.isProcessing && (
                      <ManualAssetAddCard
                        onAdd={handleAddManualAsset}
                        disabled={store.isProcessing}
                      />
                    )}
                </div>

                {!store.isProcessing &&
                  store.assets.some(
                    (a) => a.status === 'failed' || a.status === 'pending',
                  ) && (
                    <button
                      type="button"
                      className="btn btn-secondary w-full mt-16"
                      onClick={handleStart}
                    >
                      🔄 重试失败的项目并继续生成
                    </button>
                  )}

                {(store.currentStage === 'stage2' ||
                  store.currentStage === 'stage3' ||
                  store.currentStage === 'stage5' ||
                  store.currentStage === 'done') &&
                  !store.isProcessing &&
                  store.assets.some((a) => a.approved && a.imageData) && (
                    <button
                      type="button"
                      className="btn btn-secondary w-full mb-4"
                      onClick={handleDownloadApprovedAssets}
                    >
                      📥 下载已通过资产
                    </button>
                  )}

                {store.currentStage === 'stage2' && !store.isProcessing && (
                  <button
                    type="button"
                    className="btn btn-primary btn-lg w-full mt-24"
                    disabled={!allAssetsApproved}
                    onClick={handlePreparePages}
                  >
                    {allAssetsApproved
                      ? '▶ 继续，进入分页阶段'
                      : `⏳ 请先审核所有资产 (${store.assets.filter((a) => a.approved).length}/${store.assets.length})`}
                  </button>
                )}
              </div>
            ) : (
              <div className="step-summary">
                角色资产：已通过 {store.assets.filter((a) => a.approved).length} / {store.assets.length}
              </div>
            ))}
        </div>

        {/* ========== Step 4: Stage 3 - Page Review ========== */}
        <div className={`step ${focusedStep === 4 ? 'is-selected' : 'is-hidden'}`}>
          <div className="step-header">
            <button
              type="button"
              className={`step-number step-toggle ${getStepState(4)}`}
              onClick={() => setFocusedStep(4)}
              title="查看分页审核阶段"
            >
              {getStepState(4) === 'done' ? '✓' : '4'}
            </button>
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div className="step-title">分页成品审核</div>
                <div className="step-status">
                  {store.currentStage === 'stage3'
                    ? store.isProcessing
                      ? store.progressMessage
                      : '请审核以下分页成品'
                    : '阶段4'}
                </div>
                <div className="step-hint">{pageHint}</div>
              </div>
              {(apiForParams ?? getSettings().api) && (
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    fontSize: 0.8,
                  }}
                >
                  <select
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: '0.8rem', minWidth: 80 }}
                    value={(apiForParams ?? getSettings().api).imageAspectRatioStage3}
                    onChange={(e) => {
                      const api = getSettings().api;
                      const next = {
                        ...api,
                        imageAspectRatioStage3: e.target.value as AspectRatioType,
                      };
                      saveApiSettings(next);
                      setApiForParams(next);
                    }}
                  >
                    <option value="auto">自适应</option>
                    <option value="1:1">1:1</option>
                    <option value="1:2">1:2</option>
                    <option value="2:1">2:1</option>
                    <option value="2:3">2:3</option>
                    <option value="3:2">3:2</option>
                    <option value="3:4">3:4</option>
                    <option value="4:3">4:3</option>
                    <option value="9:16">9:16</option>
                    <option value="16:9">16:9</option>
                  </select>
                  <select
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: '0.8rem', minWidth: 60 }}
                    value={(apiForParams ?? getSettings().api).imageSizeStage3}
                    onChange={(e) => {
                      const api = getSettings().api;
                      const next = {
                        ...api,
                        imageSizeStage3: e.target.value as ImageSizeType,
                      };
                      saveApiSettings(next);
                      setApiForParams(next);
                    }}
                  >
                    <option value="1K">1K</option>
                    <option value="2K">2K</option>
                    <option value="4K">4K</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {(store.currentStage === 'stage3' ||
            store.currentStage === 'stage5' ||
            store.currentStage === 'done') &&
            store.finalPages.length > 0 &&
            (expandedSteps.has(4) ? (
              <div className="step-content">
                <div className="page-review-grid">
                  {store.finalPages.map((page) => (
                    <PageReviewCard
                      key={page.id}
                      page={page}
                      assets={store.assets}
                      styleRefImage={store.styleRefImage}
                      isProcessing={store.isProcessing}
                      onEnlarge={handlePageEnlarge}
                      onApprove={handleApprovePage}
                      onRegenerate={handleRegeneratePage}
                      onRevert={handlePageRevert}
                      onRedo={handlePageRedo}
                      onToggleStyleRef={handlePageToggleStyleRef}
                      onToggleRefAsset={handlePageToggleRefAsset}
                      onConfirmModify={handleConfirmModify}
                      onAddCaption={handleAddCaption}
                      onCancelGenerating={handleCancelPageGenerating}
                      lazyImage
                    />
                  ))}
                </div>

                {!store.isProcessing &&
                  store.finalPages.some(
                    (p) => p.status === 'failed' || p.status === 'pending',
                  ) && (
                    <div className="mt-16">
                      <p
                        style={{
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          marginBottom: 8,
                        }}
                      >
                        请先为每页勾选角色/物品参考图，再点击下方按钮生成
                      </p>
                      <button
                        type="button"
                        className="btn btn-primary w-full"
                        onClick={handleGeneratePages}
                      >
                        {store.finalPages.some((p) => p.status === 'failed')
                          ? '🔄 重试失败的页面并继续生成'
                          : '▶ 开始生成分页'}
                      </button>
                    </div>
                  )}

                {allPagesApproved && store.currentStage !== 'stage5' && (
                  <button
                    type="button"
                    className="btn btn-primary btn-lg w-full mt-12"
                    style={{ marginTop: 20 }}
                    onClick={handleStartStage5}
                    disabled={store.isProcessing}
                  >
                    {store.isProcessing ? (
                      <>
                        <span className="spinner" /> {store.progressMessage}
                      </>
                    ) : (
                      '📕 制作封面/环衬/扉页'
                    )}
                  </button>
                )}
              </div>
            ) : (
              <div className="step-summary">
                分页成品：已通过 {store.finalPages.filter((p) => p.approved).length} / {store.finalPages.length}
              </div>
            ))}
        </div>

        {/* ========== Step 5: 装帧图（封面/环衬/扉页） ========== */}
        <div className={`step ${focusedStep === 5 ? 'is-selected' : 'is-hidden'}`}>
          <div className="step-header">
            <button
              type="button"
              className={`step-number step-toggle ${getStepState(5)}`}
              onClick={() => setFocusedStep(5)}
              title="查看装帧审核阶段"
            >
              {getStepState(5) === 'done' ? '✓' : '5'}
            </button>
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div className="step-title">装帧图（封面 / 环衬 / 扉页）</div>
                <div className="step-status">
                  {store.currentStage === 'stage5'
                    ? store.isProcessing
                      ? store.progressMessage
                      : '请审核以下装帧图'
                    : '阶段5'}
                </div>
                <div className="step-hint">{bindingHint}</div>
              </div>
              {(apiForParams ?? getSettings().api) && (
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    fontSize: 0.8,
                  }}
                >
                  <select
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: '0.8rem', minWidth: 80 }}
                    value={(apiForParams ?? getSettings().api).imageAspectRatioStage5}
                    onChange={(e) => {
                      const api = getSettings().api;
                      const next = {
                        ...api,
                        imageAspectRatioStage5: e.target.value as AspectRatioType,
                      };
                      saveApiSettings(next);
                      setApiForParams(next);
                    }}
                  >
                    <option value="auto">自适应</option>
                    <option value="1:1">1:1</option>
                    <option value="1:2">1:2</option>
                    <option value="2:1">2:1</option>
                    <option value="2:3">2:3</option>
                    <option value="3:2">3:2</option>
                    <option value="3:4">3:4</option>
                    <option value="4:3">4:3</option>
                    <option value="9:16">9:16</option>
                    <option value="16:9">16:9</option>
                    <option value="19:7">19:7</option>
                    <option value="21:9">21:9</option>
                  </select>
                  <select
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: '0.8rem', minWidth: 60 }}
                    value={(apiForParams ?? getSettings().api).imageSizeStage5}
                    onChange={(e) => {
                      const api = getSettings().api;
                      const next = {
                        ...api,
                        imageSizeStage5: e.target.value as ImageSizeType,
                      };
                      saveApiSettings(next);
                      setApiForParams(next);
                    }}
                  >
                    <option value="1K">1K</option>
                    <option value="2K">2K</option>
                    <option value="4K">4K</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {(store.currentStage === 'stage5' || store.currentStage === 'done') &&
            store.bindingImages.length > 0 &&
            (expandedSteps.has(5) ? (
              <div className="step-content">
                {!store.isProcessing && (
                  <button
                    type="button"
                    className="btn btn-secondary w-full mb-24"
                    onClick={() => {
                      store.resetStage5();
                      store.addLog('已重置阶段5，可重新制作封面/环衬/扉页', 'info');
                    }}
                  >
                    🔄 重新开始此阶段
                  </button>
                )}
                {!store.pageGridImage && allPagesApproved && (
                  <button
                    type="button"
                    className="btn btn-primary btn-lg w-full mb-24"
                    onClick={handleStartStage5}
                    disabled={store.isProcessing}
                  >
                    {store.isProcessing ? (
                      <>
                        <span className="spinner" /> {store.progressMessage}
                      </>
                    ) : (
                      '📕 制作封面/环衬/扉页'
                    )}
                  </button>
                )}
                {store.pageGridImage && (
                  <div style={{ marginBottom: 24 }}>
                    <div className="form-label" style={{ marginBottom: 8 }}>
                      全部分页宫格图
                    </div>
                    <button
                      type="button"
                      className="page-grid-preview"
                      onClick={() => setLightbox({ type: 'pageGrid' })}
                      title="点击放大查看"
                    >
                      <ThumbnailBase64Image
                        src={store.pageGridImage}
                        alt="全部分页宫格图"
                        maxSize={1024}
                        aspectRatio="5/4"
                      />
                    </button>
                  </div>
                )}
                <div className="page-review-grid">
                  {store.bindingImages.map((binding) => (
                    <BindingReviewCard
                      key={binding.id}
                      binding={binding}
                      isProcessing={store.isProcessing}
                      onEnlarge={handleBindingEnlarge}
                      onApprove={handleApproveBinding}
                      onRegenerate={handleRegenerateBinding}
                      onRemoveSeam={handleBindingRemoveSeam}
                      onRevert={handleBindingRevert}
                      onRedo={handleBindingRedo}
                      onCancelGenerating={handleCancelBindingGenerating}
                      lazyImage
                    />
                  ))}
                </div>

                {!store.isProcessing && (
                  <button
                    type="button"
                    className="btn btn-primary btn-lg w-full mt-24"
                    onClick={handleDownload}
                    disabled={
                      store.assets.filter((a) => a.approved && a.imageData).length === 0 &&
                      store.finalPages.filter((p) => p.imageData).length === 0 &&
                      store.bindingImages.filter((b) => b.imageData).length === 0
                    }
                  >
                    📦 打包下载 (
                    {store.assets.filter((a) => a.approved && a.imageData).length +
                      store.finalPages.filter((p) => p.imageData).length +
                      store.bindingImages.filter((b) => b.imageData).length}{' '}
                    张成品图)
                  </button>
                )}

                {!store.isProcessing && canComplete && (
                  <button
                    type="button"
                    className="btn btn-success btn-lg w-full mt-12"
                    onClick={() => setShowCompleteModal(true)}
                  >
                    ✓ 完成
                  </button>
                )}
              </div>
            ) : (
              <div className="step-summary">
                装帧图：已通过 {store.bindingImages.filter((b) => b.approved).length} / 3
              </div>
            ))}
        </div>
      </div>
      </div>
      {/* ========== 阶段5 书名弹窗 ========== */}
      {showBookTitleModal && (
        <div
          className="gallery-modal-overlay"
          onClick={() => setShowBookTitleModal(false)}
        >
          <div
            className="gallery-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>请输入绘本书名</h3>
            <p className="gallery-modal-desc">
              书名将用于封面与扉页的提示词替换。确认后开始生成封面、环衬、扉页。
            </p>
            <input
              type="text"
              className="form-input"
              placeholder="绘本书名（必填）"
              value={bookTitleInput}
              onChange={(e) => setBookTitleInput(e.target.value)}
              autoFocus
            />
            <div className="gallery-modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowBookTitleModal(false);
                  setBookTitleInput('');
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConfirmBookTitle}
                disabled={!bookTitleInput.trim()}
              >
                确认开始
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 完成弹窗：输入绘本名称并保存到画廊 ========== */}
      {showCompleteModal && (
        <div
          className="gallery-modal-overlay"
          onClick={() => setShowCompleteModal(false)}
        >
          <div
            className="gallery-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>完成</h3>
            <p className="gallery-modal-desc">
              将当前所有「已通过」的图按本保存到画廊。请输入绘本名称。
            </p>
            <input
              type="text"
              className="form-input"
              placeholder="绘本名称（必填）"
              value={completeName}
              onChange={(e) => setCompleteName(e.target.value)}
              autoFocus
            />
            <div className="gallery-modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowCompleteModal(false);
                  setCompleteName('');
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleComplete}
                disabled={!completeName.trim() || isSavingToGallery}
              >
                {isSavingToGallery ? '保存中...' : '保存到画廊'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== Lightbox 放大预览 ========== */}
      {lightbox && (() => {
        if (lightbox.type === 'pageGrid' && store.pageGridImage) {
          return (
            <GalleryLightbox
              src={store.pageGridImage}
              alt="全部分页宫格图"
              onClose={() => setLightbox(null)}
            />
          );
        }
        if (lightbox.type === 'asset') {
          const items = store.assets.filter((a) => a.imageData);
          const idx = Math.min(lightbox.index, Math.max(0, items.length - 1));
          const item = items[idx];
          if (!item) return null;
          return (
            <GalleryLightbox
              src={item.imageData}
              alt={item.characterSlice.nameCN}
              onClose={() => setLightbox(null)}
            />
          );
        }
        if (lightbox.type === 'binding') {
          const items = store.bindingImages.filter((b) => b.imageData);
          const idx = Math.min(lightbox.index, Math.max(0, items.length - 1));
          const item = items[idx];
          if (!item) return null;
          const label =
            item.type === 'cover' ? '封面' : item.type === 'endpapers' ? '环衬' : '扉页';
          return (
            <GalleryLightbox
              src={item.imageData}
              alt={label}
              onClose={() => setLightbox(null)}
            />
          );
        }
        if (lightbox.type === 'page') {
          const items = store.finalPages.filter((p) => p.imageData);
          const idx = Math.min(lightbox.index, Math.max(0, items.length - 1));
          const item = items[idx];
          if (!item) return null;
          return (
            <GalleryLightbox
              src={item.imageData}
              alt={`第${item.pageNumber}页`}
              onClose={() => setLightbox(null)}
            />
          );
        }
        return null;
      })()}

      {/* ========== Floating Logs Button (右下角小三角) ========== */}
      <button
        type="button"
        className="btn"
        onClick={() => setShowLogs(!showLogs)}
        title={showLogs ? '收起日志' : '展开日志'}
        style={{
          position: 'fixed',
          bottom: 12,
          right: 12,
          zIndex: 100,
          width: 28,
          height: 28,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          background: showLogs ? 'var(--bg-secondary)' : 'var(--accent)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 0,
            height: 0,
            borderTop: '6px solid transparent',
            borderBottom: '6px solid transparent',
            borderLeft: showLogs ? '8px solid currentColor' : 'none',
            borderRight: showLogs ? 'none' : '8px solid currentColor',
          }}
        />
      </button>

      {/* ========== Logs Drawer ========== */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: showLogs ? 0 : '-400px',
          width: '400px',
          height: '100vh',
          background: 'var(--bg-secondary)',
          borderLeft: '1px solid var(--border)',
          transition: 'right 0.3s ease',
          zIndex: 99,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: showLogs ? '-4px 0 16px rgba(0,0,0,0.5)' : 'none',
        }}
      >
        <div
          style={{
            padding: '16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <h3 style={{ margin: 0, fontSize: '1.2rem' }}>📋 System Logs</h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => store.clearLogs()}
          >
            清空
          </button>
        </div>
        <div
          style={{
            flex: 1,
            padding: '16px',
            overflowY: 'auto',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
          }}
        >
          {store.logs.map((log, idx) => (
            <div
              key={idx}
              style={{
                marginBottom: '8px',
                color:
                  log.type === 'error'
                    ? '#ef4444'
                    : log.type === 'success'
                      ? '#22c55e'
                      : log.type === 'info'
                        ? '#60a5fa'
                        : 'var(--text-muted)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              <span
                style={{
                  color: 'var(--text-muted)',
                  fontSize: '0.75rem',
                  marginRight: '8px',
                }}
              >
                [{log.time}]
              </span>
              {log.message}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
    </>
  );
}
