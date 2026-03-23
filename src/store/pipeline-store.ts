// ============================================================
// Pipeline Store - Global State Management (Zustand)
// ============================================================

import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import {
  PipelineStage,
  Stage1Step,
  PageSlice,
  CharacterSlice,
  AssetImage,
  PageImage,
  BindingImage,
  GalleryProjectStatus,
  WorkbenchProjectSnapshot,
} from '@/types';
import {
  saveImageToIndexedDB,
  saveImagesToIndexedDB,
  saveStyleRefToIndexedDB,
  savePageGridToIndexedDB,
  loadImageFromIndexedDB,
  loadStyleRefFromIndexedDB,
  loadPageGridFromIndexedDB,
  clearImageIndexedDB,
  removeImageFromIndexedDB,
} from '@/lib/image-storage';

interface PipelineState {
  // — Current stage —
  currentStage: PipelineStage;
  stage1Step: Stage1Step | null;

  // — Raw inputs —
  scriptFileName: string;
  scriptRawText: string;
  scriptPages: PageSlice[];
  styleRefImage: string; // Base64 data URL

  // — Stage 1 outputs —
  styleModule: string; // 1_1 content
  characterPromptsRaw: string; // 1_2 raw text
  characterSlices: CharacterSlice[]; // 1_2 parsed

  // — Stage 2 outputs —
  assets: AssetImage[];

  // — Stage 3 outputs —
  finalPages: PageImage[];

  // — Stage 5 outputs —
  bookTitle: string;
  bindingImages: BindingImage[];
  pageGridImage: string;
  lastUpdatedAt: number;
  activeProjectId: string;
  activeProjectName: string;
  activeProjectStatus: GalleryProjectStatus | null;

  // — Loading state —
  isProcessing: boolean;
  progressMessage: string;
  errorMessage: string;

  // — System Logs —
  logs: {
    time: string;
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
  }[];
  addLog: (
    message: string,
    type?: 'info' | 'success' | 'warning' | 'error',
  ) => void;
  clearLogs: () => void;

  // — Actions —
  setActiveProjectMeta: (meta: {
    id: string;
    name: string;
    status: GalleryProjectStatus;
  } | null) => void;
  setStage: (stage: PipelineStage) => void;
  setStage1Step: (step: Stage1Step | null) => void;
  setScriptFileName: (name: string) => void;
  setScriptRawText: (text: string) => void;
  setScriptPages: (pages: PageSlice[]) => void;
  setStyleRefImage: (base64: string) => void;
  setStyleModule: (text: string) => void;
  setCharacterPromptsRaw: (text: string) => void;
  setCharacterSlices: (slices: CharacterSlice[]) => void;
  setAssets: (assets: AssetImage[]) => void;
  updateAsset: (id: string, updates: Partial<AssetImage>) => void;
  addAsset: (asset: AssetImage) => void;
  removeAsset: (id: string) => void;
  setFinalPages: (pages: PageImage[]) => void;
  updateFinalPage: (id: string, updates: Partial<PageImage>) => void;
  setBookTitle: (title: string) => void;
  setBindingImages: (images: BindingImage[]) => void;
  updateBindingImage: (id: string, updates: Partial<BindingImage>) => void;
  setPageGridImage: (base64: string) => void;
  setProcessing: (isProcessing: boolean, message?: string) => void;
  setError: (message: string) => void;
  clearError: () => void;
  resetAll: () => void;
  resetStage5: () => void;
  exportProjectSnapshot: () => WorkbenchProjectSnapshot;
  restoreProjectSnapshot: (snapshot: WorkbenchProjectSnapshot) => Promise<void>;
}

const initialState = {
  currentStage: 'upload' as PipelineStage,
  stage1Step: null as Stage1Step | null,
  scriptFileName: '',
  scriptRawText: '',
  scriptPages: [] as PageSlice[],
  styleRefImage: '',
  styleModule: '',
  characterPromptsRaw: '',
  characterSlices: [] as CharacterSlice[],
  assets: [] as AssetImage[],
  finalPages: [] as PageImage[],
  bookTitle: '',
  bindingImages: [] as BindingImage[],
  pageGridImage: '',
  lastUpdatedAt: 0,
  activeProjectId: '',
  activeProjectName: '',
  activeProjectStatus: null as GalleryProjectStatus | null,
  isProcessing: false,
  progressMessage: '',
  errorMessage: '',
  logs: [] as {
    time: string;
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
  }[],
};

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

function getPipelineStorage(): StateStorage {
  if (typeof window === 'undefined') {
    return noopStorage;
  }
  return localStorage;
}

function markUpdated<T extends object>(updates: T): T & { lastUpdatedAt: number } {
  return {
    ...updates,
    lastUpdatedAt: Date.now(),
  };
}

function getMissingImageRestoreMessage(kind: 'asset' | 'page' | 'binding'): string {
  if (kind === 'asset') {
    return '刷新后未恢复到角色/物品图片缓存\n建议：请点击「重新生成」或重新上传图片';
  }
  if (kind === 'binding') {
    return '刷新后未恢复到装帧图片缓存\n建议：请点击「重新生成」';
  }
  return '刷新后未恢复到分页图片缓存\n建议：请点击「重新生成」';
}

type PipelineProgressState = Pick<
  PipelineState,
  'scriptRawText' | 'styleRefImage' | 'assets' | 'finalPages' | 'bindingImages'
>;

export function hasPipelineProgress(state: PipelineProgressState): boolean {
  return (
    Boolean(state.scriptRawText) ||
    Boolean(state.styleRefImage) ||
    state.assets.length > 0 ||
    state.finalPages.length > 0 ||
    state.bindingImages.length > 0
  );
}

type PersistedImageSnapshot = Pick<
  PipelineState,
  'styleRefImage' | 'pageGridImage' | 'assets' | 'finalPages' | 'bindingImages'
>;

export async function restoreMissingPipelineImagesFromIndexedDB(
  state: PersistedImageSnapshot,
): Promise<void> {
  if (typeof window === 'undefined') return;

  const styleRefPromise = !state.styleRefImage
    ? loadStyleRefFromIndexedDB().then((styleRef) => {
        if (styleRef) usePipelineStore.setState({ styleRefImage: styleRef });
      })
    : Promise.resolve();

  const pageGridPromise = !state.pageGridImage
    ? loadPageGridFromIndexedDB().then((grid) => {
        if (grid) usePipelineStore.setState({ pageGridImage: grid });
      })
    : Promise.resolve();

  const BATCH_SIZE = 3;
  const batch = {
    assets: new Map<string, string>(),
    pages: new Map<string, string>(),
    bindings: new Map<string, string>(),
  };
  const restored = {
    assets: new Set<string>(),
    pages: new Set<string>(),
    bindings: new Set<string>(),
  };
  const requested = {
    assets: new Set(
      state.assets.filter((a) => !a.imageData).map((item) => item.id),
    ),
    pages: new Set(
      state.finalPages.filter((p) => !p.imageData).map((item) => item.id),
    ),
    bindings: new Set(
      state.bindingImages.filter((b) => !b.imageData).map((item) => item.id),
    ),
  };

  const flushBatch = () => {
    if (batch.assets.size === 0 && batch.pages.size === 0 && batch.bindings.size === 0) return;
    usePipelineStore.setState((s) => ({
      assets: s.assets.map((a) =>
        batch.assets.has(a.id) ? { ...a, imageData: batch.assets.get(a.id)! } : a,
      ),
      finalPages: s.finalPages.map((p) =>
        batch.pages.has(p.id) ? { ...p, imageData: batch.pages.get(p.id)! } : p,
      ),
      bindingImages: s.bindingImages.map((b) =>
        batch.bindings.has(b.id) ? { ...b, imageData: batch.bindings.get(b.id)! } : b,
      ),
    }));
    batch.assets.clear();
    batch.pages.clear();
    batch.bindings.clear();
  };

  const finalizeRestore = () => {
    usePipelineStore.setState((s) => ({
      assets: s.assets.map((a) =>
        requested.assets.has(a.id) && a.status === 'done' && !restored.assets.has(a.id)
          ? {
              ...a,
              status: 'failed' as const,
              approved: false,
              errorMessage: getMissingImageRestoreMessage('asset'),
            }
          : a,
      ),
      finalPages: s.finalPages.map((p) =>
        requested.pages.has(p.id) && p.status === 'done' && !restored.pages.has(p.id)
          ? {
              ...p,
              status: 'failed' as const,
              approved: false,
              errorMessage: getMissingImageRestoreMessage('page'),
            }
          : p,
      ),
      bindingImages: s.bindingImages.map((b) =>
        requested.bindings.has(b.id) && b.status === 'done' && !restored.bindings.has(b.id)
          ? {
              ...b,
              status: 'failed' as const,
              approved: false,
              errorMessage: getMissingImageRestoreMessage('binding'),
            }
          : b,
      ),
    }));
  };

  const loadNext = async (
    queue: { id: string; type: 'asset' | 'page' | 'binding' }[],
    index: number,
  ): Promise<void> => {
    if (index >= queue.length) {
      flushBatch();
      return;
    }
    const slice = queue.slice(index, index + BATCH_SIZE);
    const results = await Promise.all(
      slice.map(async (item) => {
        const img = await loadImageFromIndexedDB(item.id);
        return { item, img };
      }),
    );
    for (const { item, img } of results) {
      if (!img) continue;
      if (item.type === 'asset') {
        batch.assets.set(item.id, img);
        restored.assets.add(item.id);
      } else if (item.type === 'page') {
        batch.pages.set(item.id, img);
        restored.pages.add(item.id);
      } else {
        batch.bindings.set(item.id, img);
        restored.bindings.add(item.id);
      }
    }
    flushBatch();
    await loadNext(queue, index + BATCH_SIZE);
  };

  const queue = [
    ...state.assets
      .filter((a) => !a.imageData)
      .map((a) => ({ id: a.id, type: 'asset' as const })),
    ...state.finalPages
      .filter((p) => !p.imageData)
      .map((p) => ({ id: p.id, type: 'page' as const })),
    ...state.bindingImages
      .filter((b) => !b.imageData)
      .map((b) => ({ id: b.id, type: 'binding' as const })),
  ];

  await Promise.all([
    styleRefPromise,
    pageGridPromise,
    queue.length > 0 ? loadNext(queue, 0) : Promise.resolve(),
  ]);
  finalizeRestore();
}

export const usePipelineStore = create<PipelineState>()(
  persist(
    (set, get) => ({
      ...initialState,

      addLog: (message, type = 'info') =>
        set((state) => ({
          logs: [
            ...state.logs,
            { time: new Date().toLocaleTimeString(), message, type },
          ],
        })),
      clearLogs: () => set({ logs: [] }),
      setActiveProjectMeta: (meta) =>
        set(
          markUpdated({
            activeProjectId: meta?.id ?? '',
            activeProjectName: meta?.name ?? '',
            activeProjectStatus: meta?.status ?? null,
          }),
        ),

      setStage: (stage) => set(markUpdated({ currentStage: stage })),
      setStage1Step: (step) => set(markUpdated({ stage1Step: step })),
      setScriptFileName: (name) => set(markUpdated({ scriptFileName: name })),
      setScriptRawText: (text) => set(markUpdated({ scriptRawText: text })),
      setScriptPages: (pages) => set(markUpdated({ scriptPages: pages })),
      setStyleRefImage: (base64) => {
        set(markUpdated({ styleRefImage: base64 }));
        if (base64) saveStyleRefToIndexedDB(base64);
      },
      setStyleModule: (text) => set(markUpdated({ styleModule: text })),
      setCharacterPromptsRaw: (text) => set(markUpdated({ characterPromptsRaw: text })),
      setCharacterSlices: (slices) => set(markUpdated({ characterSlices: slices })),
      setAssets: (assets) => {
        set(markUpdated({ assets }));
        const toSave = assets.filter((a) => a.imageData).map((a) => ({ id: a.id, imageData: a.imageData }));
        if (toSave.length > 0) saveImagesToIndexedDB(toSave);
      },
      updateAsset: (id, updates) => {
        if (updates.imageData !== undefined) {
          if (updates.imageData) saveImageToIndexedDB(id, updates.imageData);
          else removeImageFromIndexedDB(id);
        }
        set((state) => ({
          assets: state.assets.map((a) =>
            a.id === id ? { ...a, ...updates } : a,
          ),
          lastUpdatedAt: Date.now(),
        }));
      },
      addAsset: (asset) => {
        if (asset.imageData) saveImageToIndexedDB(asset.id, asset.imageData);
        set((state) => ({
          assets: [...state.assets, asset],
          lastUpdatedAt: Date.now(),
        }));
      },
      removeAsset: (id) => {
        removeImageFromIndexedDB(id);
        set((state) => ({
          assets: state.assets.filter((a) => a.id !== id),
          lastUpdatedAt: Date.now(),
        }));
      },
      setFinalPages: (pages) => {
        set(markUpdated({ finalPages: pages }));
        const toSave = pages.filter((p) => p.imageData).map((p) => ({ id: p.id, imageData: p.imageData }));
        if (toSave.length > 0) saveImagesToIndexedDB(toSave);
      },
      updateFinalPage: (id, updates) => {
        if (updates.imageData !== undefined) {
          if (updates.imageData) saveImageToIndexedDB(id, updates.imageData);
          else removeImageFromIndexedDB(id);
        }
        set((state) => ({
          finalPages: state.finalPages.map((p) =>
            p.id === id ? { ...p, ...updates } : p,
          ),
          lastUpdatedAt: Date.now(),
        }));
      },
      setBookTitle: (title) => set(markUpdated({ bookTitle: title })),
      setBindingImages: (images) => {
        set(markUpdated({ bindingImages: images }));
        const toSave = images.filter((b) => b.imageData).map((b) => ({ id: b.id, imageData: b.imageData }));
        if (toSave.length > 0) saveImagesToIndexedDB(toSave);
      },
      updateBindingImage: (id, updates) => {
        if (updates.imageData !== undefined) {
          if (updates.imageData) saveImageToIndexedDB(id, updates.imageData);
          else removeImageFromIndexedDB(id);
        }
        set((state) => ({
          bindingImages: state.bindingImages.map((b) =>
            b.id === id ? { ...b, ...updates } : b,
          ),
          lastUpdatedAt: Date.now(),
        }));
      },
      setPageGridImage: (base64) => {
        set(markUpdated({ pageGridImage: base64 }));
        if (base64) savePageGridToIndexedDB(base64);
      },
      setProcessing: (isProcessing, message) =>
        set({ isProcessing, progressMessage: message ?? '' }),
      setError: (message) =>
        set((state) => ({
          errorMessage: message,
          isProcessing: false,
          logs: [
            ...state.logs,
            {
              time: new Date().toLocaleTimeString(),
              message: `Error: ${message}`,
              type: 'error',
            },
          ],
        })),
      clearError: () => set({ errorMessage: '' }),
      resetAll: () => {
        clearImageIndexedDB();
        set(initialState);
      },
      resetStage5: () =>
        set((state) => {
          const allApprovedIds = state.assets.filter((a) => a.approved && a.imageData).map((a) => a.id);
          const initialBindings: BindingImage[] = [
            { id: 'binding-cover', type: 'cover', imageData: '', status: 'pending', approved: false, selectedRefAssetIds: [...allApprovedIds] },
            { id: 'binding-endpapers', type: 'endpapers', imageData: '', status: 'pending', approved: false, selectedRefAssetIds: [...allApprovedIds] },
            { id: 'binding-titlepage', type: 'titlepage', imageData: '', status: 'pending', approved: false, selectedRefAssetIds: [...allApprovedIds] },
          ];
          ['binding-cover', 'binding-endpapers', 'binding-titlepage', '__page_grid__'].forEach((id) =>
            removeImageFromIndexedDB(id),
          );
          return {
            bindingImages: initialBindings,
            pageGridImage: '',
            currentStage: 'stage5' as PipelineStage,
            lastUpdatedAt: Date.now(),
          };
        }),
      exportProjectSnapshot: () => {
        const state = get();
        return {
          currentStage: state.currentStage,
          stage1Step: state.stage1Step,
          scriptFileName: state.scriptFileName,
          scriptRawText: state.scriptRawText,
          scriptPages: state.scriptPages,
          styleRefImage: state.styleRefImage,
          styleModule: state.styleModule,
          characterPromptsRaw: state.characterPromptsRaw,
          characterSlices: state.characterSlices,
          assets: state.assets,
          finalPages: state.finalPages,
          bookTitle: state.bookTitle,
          bindingImages: state.bindingImages,
          pageGridImage: state.pageGridImage,
          lastUpdatedAt: state.lastUpdatedAt,
          activeProjectId: state.activeProjectId,
          activeProjectName: state.activeProjectName,
          activeProjectStatus: state.activeProjectStatus,
        };
      },
      restoreProjectSnapshot: async (snapshot) => {
        await clearImageIndexedDB();

        if (snapshot.styleRefImage) {
          await saveStyleRefToIndexedDB(snapshot.styleRefImage);
        }
        if (snapshot.pageGridImage) {
          await savePageGridToIndexedDB(snapshot.pageGridImage);
        }

        const currentImages = [
          ...snapshot.assets
            .filter((item) => item.imageData)
            .map((item) => ({ id: item.id, imageData: item.imageData })),
          ...snapshot.finalPages
            .filter((item) => item.imageData)
            .map((item) => ({ id: item.id, imageData: item.imageData })),
          ...snapshot.bindingImages
            .filter((item) => item.imageData)
            .map((item) => ({ id: item.id, imageData: item.imageData })),
        ];
        if (currentImages.length > 0) {
          await saveImagesToIndexedDB(currentImages);
        }

        set({
          currentStage: snapshot.currentStage,
          stage1Step: snapshot.stage1Step,
          scriptFileName: snapshot.scriptFileName,
          scriptRawText: snapshot.scriptRawText,
          scriptPages: snapshot.scriptPages,
          styleRefImage: snapshot.styleRefImage,
          styleModule: snapshot.styleModule,
          characterPromptsRaw: snapshot.characterPromptsRaw,
          characterSlices: snapshot.characterSlices,
          assets: snapshot.assets,
          finalPages: snapshot.finalPages,
          bookTitle: snapshot.bookTitle,
          bindingImages: snapshot.bindingImages,
          pageGridImage: snapshot.pageGridImage,
          lastUpdatedAt: snapshot.lastUpdatedAt || Date.now(),
          activeProjectId: snapshot.activeProjectId,
          activeProjectName: snapshot.activeProjectName,
          activeProjectStatus: snapshot.activeProjectStatus,
          isProcessing: false,
          progressMessage: '',
          errorMessage: '',
          logs: [],
        });
      },
    }),
    {
      name: 'pipeline-workbench-storage',
      storage: createJSONStorage(getPipelineStorage),
      // 图片与 styleRefImage 存 IndexedDB，避免 localStorage 过大导致解析卡顿
      partialize: (state) => ({
        currentStage: state.currentStage,
        stage1Step: state.stage1Step,
        scriptFileName: state.scriptFileName,
        scriptRawText: state.scriptRawText,
        scriptPages: state.scriptPages,
        styleModule: state.styleModule,
        characterPromptsRaw: state.characterPromptsRaw,
        characterSlices: state.characterSlices,
        lastUpdatedAt: state.lastUpdatedAt,
        activeProjectId: state.activeProjectId,
        activeProjectName: state.activeProjectName,
        activeProjectStatus: state.activeProjectStatus,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- imageData 存 IndexedDB，imageHistory/redo 仅会话内
        assets: state.assets.map(({ imageData, imageHistory, imageRedoStack, ...rest }) => rest),
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- imageData 存 IndexedDB，imageHistory/redo 仅会话内
        finalPages: state.finalPages.map(({ imageData, imageHistory, imageRedoStack, ...rest }) => rest),
        bookTitle: state.bookTitle,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- imageData 存 IndexedDB，imageHistory/redo 仅会话内
        bindingImages: state.bindingImages.map(({ imageData, imageHistory, imageRedoStack, ...rest }) => rest),
        logs: state.logs.slice(-100),
      }),
      onRehydrateStorage: () => (state, err) => {
        if (err || !state) return;
        // 修复：刷新/关闭页面时，生成中的任务已中断，重置为 failed 避免卡在「生成中」
        const hasStuck =
          state.assets?.some((a) => a.status === 'generating') ||
          state.finalPages?.some((p) => p.status === 'generating') ||
          state.bindingImages?.some((b) => b.status === 'generating');
        if (hasStuck) {
          usePipelineStore.setState((s) => ({
            assets: s.assets.map((a) =>
              a.status === 'generating'
                ? {
                    ...a,
                    status: 'failed' as const,
                    errorMessage: a.errorMessage || '请求超时\n建议：请重试；若仍失败，请检查接口配置与网络状态',
                  }
                : a,
            ),
            finalPages: s.finalPages.map((p) =>
              p.status === 'generating'
                ? {
                    ...p,
                    status: 'failed' as const,
                    errorMessage: p.errorMessage || '请求超时\n建议：请重试；若仍失败，请检查接口配置与网络状态',
                  }
                : p,
            ),
            bindingImages: s.bindingImages.map((b) =>
              b.status === 'generating'
                ? {
                    ...b,
                    status: 'failed' as const,
                    errorMessage: b.errorMessage || '请求超时\n建议：请重试；若仍失败，请检查接口配置与网络状态',
                  }
                : b,
            ),
          }));
        }
        // 迁移：旧版 styleRefImage 在 localStorage，若存在则迁入 IndexedDB
        if (state.styleRefImage) {
          saveStyleRefToIndexedDB(state.styleRefImage);
        }
        void restoreMissingPipelineImagesFromIndexedDB(state);
      },
    },
  ),
);
