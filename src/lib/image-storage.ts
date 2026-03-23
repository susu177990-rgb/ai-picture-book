// ============================================================
// IndexedDB Image Storage - Persist large base64 images across refresh
// ============================================================
// localStorage 约 5MB 限制，无法存储多张高清 AI 图。使用 IndexedDB 单独存储图片数据。

const DB_NAME = 'ai-picture-book-images';
const DB_VERSION = 1;
const STORE_NAME = 'images';
const STYLE_REF_ID = '__style_ref__';
const PAGE_GRID_ID = '__page_grid__';

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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

/** 保存单张图片到 IndexedDB */
export async function saveImageToIndexedDB(id: string, imageData: string): Promise<void> {
  if (!imageData || typeof window === 'undefined') return;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ id, imageData });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 静默失败，不影响主流程
  }
}

/** 从 IndexedDB 读取单张图片 */
export async function loadImageFromIndexedDB(id: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    const result = await new Promise<{ id: string; imageData: string } | undefined>(
      (resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      },
    );
    db.close();
    return result?.imageData ?? null;
  } catch {
    return null;
  }
}

/** 批量读取所有图片 */
export async function loadAllImagesFromIndexedDB(): Promise<Record<string, string>> {
  if (typeof window === 'undefined') return {};
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    const items = await new Promise<{ id: string; imageData: string }[]>(
      (resolve, reject) => {
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => reject(req.error);
      },
    );
    db.close();
    const map: Record<string, string> = {};
    for (const { id, imageData } of items) {
      if (id && imageData) map[id] = imageData;
    }
    return map;
  } catch {
    return {};
  }
}

/** 批量保存图片 */
export async function saveImagesToIndexedDB(
  items: { id: string; imageData: string }[],
): Promise<void> {
  if (typeof window === 'undefined' || items.length === 0) return;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const { id, imageData } of items) {
      if (id && imageData) store.put({ id, imageData });
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 静默失败
  }
}

/** 删除单张图片 */
export async function removeImageFromIndexedDB(id: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 静默失败
  }
}

/** 保存风格参考图（大图不存 localStorage） */
export async function saveStyleRefToIndexedDB(imageData: string): Promise<void> {
  if (!imageData || typeof window === 'undefined') return;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id: STYLE_REF_ID, imageData });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 静默失败
  }
}

/** 从 IndexedDB 读取风格参考图 */
export async function loadStyleRefFromIndexedDB(): Promise<string | null> {
  return loadImageFromIndexedDB(STYLE_REF_ID);
}

/** 保存宫格图到 IndexedDB（刷新后恢复） */
export async function savePageGridToIndexedDB(imageData: string): Promise<void> {
  if (!imageData || typeof window === 'undefined') return;
  return saveImageToIndexedDB(PAGE_GRID_ID, imageData);
}

/** 从 IndexedDB 读取宫格图 */
export async function loadPageGridFromIndexedDB(): Promise<string | null> {
  return loadImageFromIndexedDB(PAGE_GRID_ID);
}

/** 清空所有图片缓存 */
export async function clearImageIndexedDB(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 静默失败
  }
}
