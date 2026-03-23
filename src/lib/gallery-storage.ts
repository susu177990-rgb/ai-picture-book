// ============================================================
// Gallery Storage - IndexedDB for Saved Projects
// ============================================================
// 画廊持久化存储：保存用户「保存到画廊」的项目快照

import type {
  AssetImage,
  BindingImage,
  GalleryProjectStatus,
  PageImage,
  WorkbenchProjectSnapshot,
} from '@/types';

export interface GalleryImageItem {
  id: string;
  title: string;
  imageData: string;
  type: 'asset' | 'page' | 'cover' | 'endpapers' | 'titlepage';
  pageNumber?: number;
  /** 资产类型：角色或物品，用于下载时生成文件名 */
  assetType?: 'character' | 'item';
}

export interface GalleryProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: GalleryProjectStatus;
  images: GalleryImageItem[];
  /** 项目总图数，列表仅加载首图时用于展示 */
  totalCount?: number;
  assetCount?: number;
  pageCount?: number;
  bindingCount?: number;
  hasCover?: boolean;
  hasEndpapers?: boolean;
  hasTitlePage?: boolean;
  canResume?: boolean;
}

export interface GalleryProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: GalleryProjectStatus;
  imageKeys: string[];
  assetCount: number;
  pageCount: number;
  bindingCount: number;
  hasCover: boolean;
  hasEndpapers: boolean;
  hasTitlePage: boolean;
  canResume: boolean;
}

export interface GalleryProjectSnapshotRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: GalleryProjectStatus;
  snapshot: WorkbenchProjectSnapshot;
}

interface PersistedImageFields {
  imageKey?: string;
  imageHistoryKeys?: string[];
  imageRedoKeys?: string[];
}

interface PersistedAssetSnapshot
  extends Omit<AssetImage, 'imageData' | 'imageHistory' | 'imageRedoStack'>,
    PersistedImageFields {}

interface PersistedPageSnapshot
  extends Omit<PageImage, 'imageData' | 'imageHistory' | 'imageRedoStack'>,
    PersistedImageFields {}

interface PersistedBindingSnapshot
  extends Omit<BindingImage, 'imageData' | 'imageHistory' | 'imageRedoStack'>,
    PersistedImageFields {}

interface PersistedWorkbenchProjectSnapshot {
  currentStage: WorkbenchProjectSnapshot['currentStage'];
  stage1Step: WorkbenchProjectSnapshot['stage1Step'];
  scriptFileName: string;
  scriptRawText: string;
  scriptPages: WorkbenchProjectSnapshot['scriptPages'];
  styleRefImageKey?: string;
  styleModule: string;
  characterPromptsRaw: string;
  characterSlices: WorkbenchProjectSnapshot['characterSlices'];
  assets: PersistedAssetSnapshot[];
  finalPages: PersistedPageSnapshot[];
  bookTitle: string;
  bindingImages: PersistedBindingSnapshot[];
  pageGridImageKey?: string;
  lastUpdatedAt: number;
  activeProjectId: string;
  activeProjectName: string;
  activeProjectStatus: GalleryProjectStatus | null;
}

interface ProjectMetaRow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
  status?: GalleryProjectStatus;
  imageKeys?: string[];
  allImageKeys?: string[];
  coverImageKey?: string;
  assetCount?: number;
  pageCount?: number;
  bindingCount?: number;
  hasCover?: boolean;
  hasEndpapers?: boolean;
  hasTitlePage?: boolean;
  snapshot?: PersistedWorkbenchProjectSnapshot;
  images?: GalleryImageItem[];
}

interface StoredImageRow extends Partial<GalleryImageItem> {
  key: string;
  imageData: string;
}

export interface SaveGalleryProjectInput {
  projectId?: string;
  name: string;
  status: GalleryProjectStatus;
  images: GalleryImageItem[];
  snapshot: WorkbenchProjectSnapshot;
}

const DB_NAME = 'ai-picture-book-gallery';
const DB_VERSION = 3;
const STORE_PROJECTS = 'projects';
const STORE_IMAGES = 'projectImages';

function computeGallerySummary(images: GalleryImageItem[]) {
  const assetCount = images.filter((img) => img.type === 'asset').length;
  const pageCount = images.filter((img) => img.type === 'page').length;
  const bindingCount = images.filter(
    (img) => img.type === 'cover' || img.type === 'endpapers' || img.type === 'titlepage',
  ).length;

  return {
    assetCount,
    pageCount,
    bindingCount,
    hasCover: images.some((img) => img.type === 'cover'),
    hasEndpapers: images.some((img) => img.type === 'endpapers'),
    hasTitlePage: images.some((img) => img.type === 'titlepage'),
  };
}

function computeSnapshotSummary(snapshot: WorkbenchProjectSnapshot) {
  return {
    assetCount: snapshot.assets.length,
    pageCount: snapshot.finalPages.length,
    bindingCount: snapshot.bindingImages.length,
    hasCover: snapshot.bindingImages.some((img) => img.type === 'cover'),
    hasEndpapers: snapshot.bindingImages.some((img) => img.type === 'endpapers'),
    hasTitlePage: snapshot.bindingImages.some((img) => img.type === 'titlepage'),
  };
}

function readProjectSummary(
  row: Record<string, unknown>,
  fallbackImages: GalleryImageItem[],
) {
  const fallback = computeGallerySummary(fallbackImages);
  return {
    assetCount: typeof row.assetCount === 'number' ? row.assetCount : fallback.assetCount,
    pageCount: typeof row.pageCount === 'number' ? row.pageCount : fallback.pageCount,
    bindingCount: typeof row.bindingCount === 'number' ? row.bindingCount : fallback.bindingCount,
    hasCover: typeof row.hasCover === 'boolean' ? row.hasCover : fallback.hasCover,
    hasEndpapers: typeof row.hasEndpapers === 'boolean' ? row.hasEndpapers : fallback.hasEndpapers,
    hasTitlePage: typeof row.hasTitlePage === 'boolean' ? row.hasTitlePage : fallback.hasTitlePage,
  };
}

function readProjectStatus(row: Record<string, unknown>): GalleryProjectStatus {
  return row.status === 'draft' ? 'draft' : 'completed';
}

function readProjectUpdatedAt(row: Record<string, unknown>): string {
  return typeof row.updatedAt === 'string' ? row.updatedAt : (row.createdAt as string);
}

function openDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB only in browser'));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        const store = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'key' });
      }
    };
  });
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function buildSnapshotImageKey(
  projectId: string,
  scope: 'styleRef' | 'pageGrid' | 'asset' | 'page' | 'binding',
  itemId?: string,
  variant?: 'current' | 'history' | 'redo',
  index?: number,
) {
  if (scope === 'styleRef') return `${projectId}:snapshot:style-ref`;
  if (scope === 'pageGrid') return `${projectId}:snapshot:page-grid`;
  if (!itemId || !variant) return `${projectId}:snapshot:${scope}`;
  if (variant === 'current') return `${projectId}:snapshot:${scope}:${itemId}:current`;
  return `${projectId}:snapshot:${scope}:${itemId}:${variant}:${index ?? 0}`;
}

function buildDisplayImageKey(projectId: string, image: GalleryImageItem) {
  if (image.type === 'asset') {
    return buildSnapshotImageKey(projectId, 'asset', image.id, 'current');
  }
  if (image.type === 'page') {
    return buildSnapshotImageKey(projectId, 'page', image.id, 'current');
  }
  return buildSnapshotImageKey(projectId, 'binding', image.id, 'current');
}

function pushImageEntry(
  entries: Map<string, StoredImageRow>,
  key: string,
  imageData?: string,
  image?: Omit<GalleryImageItem, 'imageData'>,
) {
  if (!imageData) return;
  const existing = entries.get(key);
  entries.set(key, {
    key,
    imageData,
    ...existing,
    ...(image ?? {}),
  });
}

function serializeImageFields(
  projectId: string,
  scope: 'asset' | 'page' | 'binding',
  item: { id: string; imageData: string; imageHistory?: string[]; imageRedoStack?: string[] },
  entries: Map<string, StoredImageRow>,
): PersistedImageFields {
  const imageKey = item.imageData
    ? buildSnapshotImageKey(projectId, scope, item.id, 'current')
    : undefined;
  if (imageKey) {
    pushImageEntry(entries, imageKey, item.imageData);
  }

  const imageHistoryKeys = (item.imageHistory ?? []).map((imageData, index) => {
    const key = buildSnapshotImageKey(projectId, scope, item.id, 'history', index);
    pushImageEntry(entries, key, imageData);
    return key;
  });
  const imageRedoKeys = (item.imageRedoStack ?? []).map((imageData, index) => {
    const key = buildSnapshotImageKey(projectId, scope, item.id, 'redo', index);
    pushImageEntry(entries, key, imageData);
    return key;
  });

  return {
    imageKey,
    imageHistoryKeys,
    imageRedoKeys,
  };
}

function stripRuntimeImageFields<
  T extends { imageData: string; imageHistory?: string[]; imageRedoStack?: string[] },
>(item: T): Omit<T, 'imageData' | 'imageHistory' | 'imageRedoStack'> {
  const next = { ...item } as Partial<T>;
  delete next.imageData;
  delete next.imageHistory;
  delete next.imageRedoStack;
  return next as Omit<T, 'imageData' | 'imageHistory' | 'imageRedoStack'>;
}

function stripPersistedImageFields<T extends PersistedImageFields>(
  item: T,
): Omit<T, keyof PersistedImageFields> {
  const next = { ...item } as Partial<T>;
  delete next.imageKey;
  delete next.imageHistoryKeys;
  delete next.imageRedoKeys;
  return next as Omit<T, keyof PersistedImageFields>;
}

function serializeAssetSnapshots(
  projectId: string,
  assets: AssetImage[],
  entries: Map<string, StoredImageRow>,
): PersistedAssetSnapshot[] {
  return assets.map((asset) => {
    return {
      ...stripRuntimeImageFields(asset),
      ...serializeImageFields(projectId, 'asset', asset, entries),
    };
  });
}

function serializePageSnapshots(
  projectId: string,
  pages: PageImage[],
  entries: Map<string, StoredImageRow>,
): PersistedPageSnapshot[] {
  return pages.map((page) => {
    return {
      ...stripRuntimeImageFields(page),
      ...serializeImageFields(projectId, 'page', page, entries),
    };
  });
}

function serializeBindingSnapshots(
  projectId: string,
  bindings: BindingImage[],
  entries: Map<string, StoredImageRow>,
): PersistedBindingSnapshot[] {
  return bindings.map((binding) => {
    return {
      ...stripRuntimeImageFields(binding),
      ...serializeImageFields(projectId, 'binding', binding, entries),
    };
  });
}

function serializeSnapshot(
  projectId: string,
  snapshot: WorkbenchProjectSnapshot,
  entries: Map<string, StoredImageRow>,
): PersistedWorkbenchProjectSnapshot {
  const styleRefImageKey = snapshot.styleRefImage
    ? buildSnapshotImageKey(projectId, 'styleRef')
    : undefined;
  const pageGridImageKey = snapshot.pageGridImage
    ? buildSnapshotImageKey(projectId, 'pageGrid')
    : undefined;

  if (styleRefImageKey) {
    pushImageEntry(entries, styleRefImageKey, snapshot.styleRefImage);
  }
  if (pageGridImageKey) {
    pushImageEntry(entries, pageGridImageKey, snapshot.pageGridImage);
  }

  return {
    currentStage: snapshot.currentStage,
    stage1Step: snapshot.stage1Step,
    scriptFileName: snapshot.scriptFileName,
    scriptRawText: snapshot.scriptRawText,
    scriptPages: snapshot.scriptPages,
    styleRefImageKey,
    styleModule: snapshot.styleModule,
    characterPromptsRaw: snapshot.characterPromptsRaw,
    characterSlices: snapshot.characterSlices,
    assets: serializeAssetSnapshots(projectId, snapshot.assets, entries),
    finalPages: serializePageSnapshots(projectId, snapshot.finalPages, entries),
    bookTitle: snapshot.bookTitle,
    bindingImages: serializeBindingSnapshots(projectId, snapshot.bindingImages, entries),
    pageGridImageKey,
    lastUpdatedAt: snapshot.lastUpdatedAt,
    activeProjectId: projectId,
    activeProjectName: snapshot.activeProjectName,
    activeProjectStatus: snapshot.activeProjectStatus,
  };
}

function collectSnapshotImageKeys(snapshot: PersistedWorkbenchProjectSnapshot): string[] {
  const keys = new Set<string>();

  if (snapshot.styleRefImageKey) keys.add(snapshot.styleRefImageKey);
  if (snapshot.pageGridImageKey) keys.add(snapshot.pageGridImageKey);

  for (const asset of snapshot.assets) {
    if (asset.imageKey) keys.add(asset.imageKey);
    for (const key of asset.imageHistoryKeys ?? []) keys.add(key);
    for (const key of asset.imageRedoKeys ?? []) keys.add(key);
  }
  for (const page of snapshot.finalPages) {
    if (page.imageKey) keys.add(page.imageKey);
    for (const key of page.imageHistoryKeys ?? []) keys.add(key);
    for (const key of page.imageRedoKeys ?? []) keys.add(key);
  }
  for (const binding of snapshot.bindingImages) {
    if (binding.imageKey) keys.add(binding.imageKey);
    for (const key of binding.imageHistoryKeys ?? []) keys.add(key);
    for (const key of binding.imageRedoKeys ?? []) keys.add(key);
  }

  return [...keys];
}

async function readImageDataMap(db: IDBDatabase, keys: string[]): Promise<Map<string, string>> {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (uniqueKeys.length === 0) return new Map();

  const tx = db.transaction(STORE_IMAGES, 'readonly');
  const store = tx.objectStore(STORE_IMAGES);
  const rows = await Promise.all(
    uniqueKeys.map(
      (key) =>
        new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }),
    ),
  );

  const result = new Map<string, string>();
  rows.forEach((row, index) => {
    if (row?.imageData && typeof row.imageData === 'string') {
      result.set(uniqueKeys[index], row.imageData);
    }
  });
  return result;
}

function deserializeImageFields<T extends PersistedImageFields>(
  item: T,
  imageMap: Map<string, string>,
) {
  return {
    imageData: item.imageKey ? imageMap.get(item.imageKey) ?? '' : '',
    imageHistory: (item.imageHistoryKeys ?? [])
      .map((key) => imageMap.get(key))
      .filter((image): image is string => Boolean(image)),
    imageRedoStack: (item.imageRedoKeys ?? [])
      .map((key) => imageMap.get(key))
      .filter((image): image is string => Boolean(image)),
  };
}

function deserializeSnapshot(
  snapshot: PersistedWorkbenchProjectSnapshot,
  imageMap: Map<string, string>,
  meta: { id: string; name: string; status: GalleryProjectStatus },
): WorkbenchProjectSnapshot {
  return {
    currentStage: snapshot.currentStage,
    stage1Step: snapshot.stage1Step,
    scriptFileName: snapshot.scriptFileName,
    scriptRawText: snapshot.scriptRawText,
    scriptPages: snapshot.scriptPages,
    styleRefImage: snapshot.styleRefImageKey ? imageMap.get(snapshot.styleRefImageKey) ?? '' : '',
    styleModule: snapshot.styleModule,
    characterPromptsRaw: snapshot.characterPromptsRaw,
    characterSlices: snapshot.characterSlices,
    assets: snapshot.assets.map((asset) => {
      return {
        ...stripPersistedImageFields(asset),
        ...deserializeImageFields(asset, imageMap),
      };
    }),
    finalPages: snapshot.finalPages.map((page) => {
      return {
        ...stripPersistedImageFields(page),
        ...deserializeImageFields(page, imageMap),
      };
    }),
    bookTitle: snapshot.bookTitle,
    bindingImages: snapshot.bindingImages.map((binding) => {
      return {
        ...stripPersistedImageFields(binding),
        ...deserializeImageFields(binding, imageMap),
      };
    }),
    pageGridImage: snapshot.pageGridImageKey ? imageMap.get(snapshot.pageGridImageKey) ?? '' : '',
    lastUpdatedAt: snapshot.lastUpdatedAt,
    activeProjectId: meta.id,
    activeProjectName: meta.name,
    activeProjectStatus: meta.status,
  };
}

async function getProjectRow(db: IDBDatabase, id: string): Promise<ProjectMetaRow | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const req = tx.objectStore(STORE_PROJECTS).get(id);
    req.onsuccess = () => resolve(req.result as ProjectMetaRow | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function writeImageEntries(db: IDBDatabase, entries: Map<string, StoredImageRow>) {
  for (const row of entries.values()) {
    await yieldToMain();
    const tx = db.transaction(STORE_IMAGES, 'readwrite');
    tx.objectStore(STORE_IMAGES).put(row);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

async function deleteImageKeys(db: IDBDatabase, keys: string[]) {
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  if (uniqueKeys.length === 0) return;

  const tx = db.transaction(STORE_IMAGES, 'readwrite');
  const store = tx.objectStore(STORE_IMAGES);
  uniqueKeys.forEach((key) => store.delete(key));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveProjectToGallery(
  project: SaveGalleryProjectInput,
): Promise<GalleryProject> {
  if (typeof window === 'undefined') {
    throw new Error('IndexedDB only in browser');
  }

  const db = await openDB();
  const existing = project.projectId ? await getProjectRow(db, project.projectId) : undefined;
  const projectId =
    project.projectId || `gallery-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const createdAt = existing?.createdAt ?? new Date().toISOString();
  const updatedAt = new Date().toISOString();

  const imageEntries = new Map<string, StoredImageRow>();
  const snapshot = serializeSnapshot(projectId, project.snapshot, imageEntries);
  const imageKeys = project.images.map((img) => {
    const key = buildDisplayImageKey(projectId, img);
    pushImageEntry(imageEntries, key, img.imageData, {
      id: img.id,
      title: img.title,
      type: img.type,
      pageNumber: img.pageNumber,
      assetType: img.assetType,
    });
    return key;
  });
  const allImageKeys = [...new Set([...imageKeys, ...collectSnapshotImageKeys(snapshot)])];

  const summary = computeSnapshotSummary(project.snapshot);
  const meta: ProjectMetaRow = {
    id: projectId,
    name: project.name,
    createdAt,
    updatedAt,
    status: project.status,
    imageKeys,
    allImageKeys,
    coverImageKey: imageKeys.find((key, index) => project.images[index]?.type === 'cover') ?? imageKeys[0],
    assetCount: summary.assetCount,
    pageCount: summary.pageCount,
    bindingCount: summary.bindingCount,
    hasCover: summary.hasCover,
    hasEndpapers: summary.hasEndpapers,
    hasTitlePage: summary.hasTitlePage,
    snapshot,
  };

  await writeImageEntries(db, imageEntries);

  const txMeta = db.transaction(STORE_PROJECTS, 'readwrite');
  txMeta.objectStore(STORE_PROJECTS).put(meta);
  await new Promise<void>((resolve, reject) => {
    txMeta.oncomplete = () => resolve();
    txMeta.onerror = () => reject(txMeta.error);
  });

  const staleKeys = (existing?.allImageKeys ?? existing?.imageKeys ?? []).filter(
    (key) => !allImageKeys.includes(key),
  );
  if (staleKeys.length > 0) {
    await deleteImageKeys(db, staleKeys);
  }

  db.close();
  return {
    id: projectId,
    name: project.name,
    createdAt,
    updatedAt,
    status: project.status,
    images: project.images,
    totalCount: imageKeys.length,
    ...summary,
    canResume: true,
  };
}

export async function loadAllGalleryProjects(): Promise<GalleryProject[]> {
  if (typeof window === 'undefined') return [];
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_PROJECTS, 'readonly');
    const req = tx.objectStore(STORE_PROJECTS).getAll();
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });

    const projects: GalleryProject[] = [];
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      if (r.images && Array.isArray(r.images)) {
        const all = r.images as GalleryImageItem[];
        const coverImg = all.find((img) => img.type === 'cover');
        const displayImg = coverImg ?? all[0];
        projects.push({
          id: r.id as string,
          name: r.name as string,
          createdAt: r.createdAt as string,
          updatedAt: readProjectUpdatedAt(r),
          status: readProjectStatus(r),
          images: displayImg ? [displayImg] : [],
          totalCount: all.length,
          ...readProjectSummary(r, all),
          canResume: Boolean(r.snapshot),
        });
        continue;
      }

      const imageKeys = Array.isArray(r.imageKeys) ? (r.imageKeys as string[]) : [];
      let displayKey = typeof r.coverImageKey === 'string' ? (r.coverImageKey as string) : undefined;
      if (!displayKey && imageKeys.length > 0) {
        displayKey = imageKeys[0];
      }

      let images: GalleryImageItem[] = [];
      if (displayKey) {
        const imgMap = await readImageDataMap(db, [displayKey]);
        const imageData = imgMap.get(displayKey);
        if (imageData) {
          const imgRow = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
            const txImg = db.transaction(STORE_IMAGES, 'readonly');
            const reqImg = txImg.objectStore(STORE_IMAGES).get(displayKey);
            reqImg.onsuccess = () => resolve(reqImg.result);
            reqImg.onerror = () => reject(reqImg.error);
          });
          if (imgRow) {
            const img = { ...imgRow };
            delete img.key;
            images = [img as unknown as GalleryImageItem];
          }
        }
      }

      projects.push({
        id: r.id as string,
        name: r.name as string,
        createdAt: r.createdAt as string,
        updatedAt: readProjectUpdatedAt(r),
        status: readProjectStatus(r),
        images,
        totalCount: imageKeys.length,
        ...readProjectSummary(r, images),
        canResume: Boolean(r.snapshot),
      });
    }

    db.close();
    return projects.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  } catch {
    return [];
  }
}

export async function loadProjectMeta(id: string): Promise<GalleryProjectMeta | null> {
  if (typeof window === 'undefined') return null;
  try {
    const db = await openDB();
    const meta = await getProjectRow(db, id);
    db.close();
    if (!meta) return null;

    if (meta.imageKeys && Array.isArray(meta.imageKeys)) {
      return {
        id: meta.id,
        name: meta.name,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt ?? meta.createdAt,
        status: meta.status ?? 'completed',
        imageKeys: meta.imageKeys,
        assetCount: typeof meta.assetCount === 'number' ? meta.assetCount : 0,
        pageCount: typeof meta.pageCount === 'number' ? meta.pageCount : 0,
        bindingCount: typeof meta.bindingCount === 'number' ? meta.bindingCount : 0,
        hasCover: Boolean(meta.hasCover),
        hasEndpapers: Boolean(meta.hasEndpapers),
        hasTitlePage: Boolean(meta.hasTitlePage),
        canResume: Boolean(meta.snapshot),
      };
    }

    const legacyImages = meta.images ?? [];
    const legacySummary = computeGallerySummary(legacyImages);
    return {
      id: meta.id,
      name: meta.name,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt ?? meta.createdAt,
      status: meta.status ?? 'completed',
      imageKeys: legacyImages.map((img, index) => `legacy-${img.id}-${index}`),
      assetCount: legacySummary.assetCount,
      pageCount: legacySummary.pageCount,
      bindingCount: legacySummary.bindingCount,
      hasCover: legacySummary.hasCover,
      hasEndpapers: legacySummary.hasEndpapers,
      hasTitlePage: legacySummary.hasTitlePage,
      canResume: Boolean(meta.snapshot),
    };
  } catch {
    return null;
  }
}

export async function loadProjectImageByKey(key: string): Promise<GalleryImageItem | null> {
  if (typeof window === 'undefined') return null;
  try {
    const db = await openDB();
    const row = await new Promise<Record<string, unknown> | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(STORE_IMAGES, 'readonly');
        const req = tx.objectStore(STORE_IMAGES).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      },
    );
    db.close();
    if (!row) return null;
    const img = { ...row };
    delete img.key;
    return img as unknown as GalleryImageItem;
  } catch {
    return null;
  }
}

export async function loadFullProject(id: string): Promise<GalleryProject | null> {
  if (typeof window === 'undefined') return null;
  try {
    const db = await openDB();
    const meta = await getProjectRow(db, id);
    if (!meta) {
      db.close();
      return null;
    }

    if (meta.images && Array.isArray(meta.images)) {
      db.close();
      return {
        id: meta.id,
        name: meta.name,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt ?? meta.createdAt,
        status: meta.status ?? 'completed',
        images: meta.images,
        ...readProjectSummary(meta as unknown as Record<string, unknown>, meta.images),
        canResume: Boolean(meta.snapshot),
      };
    }

    const imageKeys = meta.imageKeys ?? [];
    const imageMap = await readImageDataMap(db, imageKeys);
    const images: GalleryImageItem[] = [];
    for (const key of imageKeys) {
      const imageData = imageMap.get(key);
      if (!imageData) continue;
      const row = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const txImg = db.transaction(STORE_IMAGES, 'readonly');
        const req = txImg.objectStore(STORE_IMAGES).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (!row) continue;
      const img = { ...row };
      delete img.key;
      images.push(img as unknown as GalleryImageItem);
    }

    db.close();
    return {
      id: meta.id,
      name: meta.name,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt ?? meta.createdAt,
      status: meta.status ?? 'completed',
      images,
      totalCount: imageKeys.length,
      ...readProjectSummary(meta as unknown as Record<string, unknown>, images),
      canResume: Boolean(meta.snapshot),
    };
  } catch {
    return null;
  }
}

export async function loadProjectSnapshot(id: string): Promise<GalleryProjectSnapshotRecord | null> {
  if (typeof window === 'undefined') return null;
  try {
    const db = await openDB();
    const meta = await getProjectRow(db, id);
    if (!meta?.snapshot) {
      db.close();
      return null;
    }

    const snapshotImageKeys = collectSnapshotImageKeys(meta.snapshot);
    const imageMap = await readImageDataMap(db, snapshotImageKeys);
    const snapshot = deserializeSnapshot(meta.snapshot, imageMap, {
      id: meta.id,
      name: meta.name,
      status: meta.status ?? 'completed',
    });
    db.close();

    return {
      id: meta.id,
      name: meta.name,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt ?? meta.createdAt,
      status: meta.status ?? 'completed',
      snapshot,
    };
  } catch {
    return null;
  }
}

export async function deleteGalleryProject(id: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const db = await openDB();
    const meta = await getProjectRow(db, id);

    const txMeta = db.transaction(STORE_PROJECTS, 'readwrite');
    txMeta.objectStore(STORE_PROJECTS).delete(id);
    await new Promise<void>((resolve, reject) => {
      txMeta.oncomplete = () => resolve();
      txMeta.onerror = () => reject(txMeta.error);
    });

    const imageKeys = meta?.allImageKeys ?? meta?.imageKeys ?? [];
    if (imageKeys.length > 0) {
      await deleteImageKeys(db, imageKeys);
    }

    db.close();
  } catch {
    // 静默失败
  }
}
