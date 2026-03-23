'use client';

import { usePipelineStore, hasPipelineProgress } from '@/store/pipeline-store';
import {
  loadProjectSnapshot,
  saveProjectToGallery,
  type GalleryImageItem,
  type GalleryProject,
  type GalleryProjectSnapshotRecord,
} from '@/lib/gallery-storage';
import type { GalleryProjectStatus, WorkbenchProjectSnapshot } from '@/types';

function formatDraftDate(date: Date) {
  const yyyy = date.getFullYear();
  const mm = `${date.getMonth() + 1}`.padStart(2, '0');
  const dd = `${date.getDate()}`.padStart(2, '0');
  const hh = `${date.getHours()}`.padStart(2, '0');
  const min = `${date.getMinutes()}`.padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

export function getDefaultDraftProjectName(snapshot: WorkbenchProjectSnapshot) {
  return (
    snapshot.activeProjectName.trim() ||
    snapshot.bookTitle.trim() ||
    snapshot.scriptFileName.trim() ||
    `未命名草稿 ${formatDraftDate(new Date())}`
  );
}

function collectCompletedGalleryImages(snapshot: WorkbenchProjectSnapshot): GalleryImageItem[] {
  const images: GalleryImageItem[] = [];

  snapshot.assets
    .filter((item) => item.approved && item.imageData)
    .forEach((item) => {
      images.push({
        id: item.id,
        title: item.characterSlice.nameCN,
        imageData: item.imageData,
        type: 'asset',
        assetType: item.characterSlice.type,
      });
    });

  snapshot.finalPages
    .filter((item) => item.approved && item.imageData)
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .forEach((item) => {
      images.push({
        id: item.id,
        title: `第 ${item.pageNumber} 页`,
        imageData: item.imageData,
        type: 'page',
        pageNumber: item.pageNumber,
      });
    });

  snapshot.bindingImages
    .filter((item) => item.approved && item.imageData)
    .forEach((item) => {
      images.push({
        id: item.id,
        title: item.type === 'cover' ? '封面' : item.type === 'endpapers' ? '环衬' : '扉页',
        imageData: item.imageData,
        type: item.type,
      });
    });

  return images;
}

function collectDraftGalleryImages(snapshot: WorkbenchProjectSnapshot): GalleryImageItem[] {
  const images: GalleryImageItem[] = [];

  snapshot.assets
    .filter((item) => item.imageData)
    .forEach((item) => {
      images.push({
        id: item.id,
        title: item.characterSlice.nameCN,
        imageData: item.imageData,
        type: 'asset',
        assetType: item.characterSlice.type,
      });
    });

  snapshot.finalPages
    .filter((item) => item.imageData)
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .forEach((item) => {
      images.push({
        id: item.id,
        title: `第 ${item.pageNumber} 页`,
        imageData: item.imageData,
        type: 'page',
        pageNumber: item.pageNumber,
      });
    });

  snapshot.bindingImages
    .filter((item) => item.imageData)
    .forEach((item) => {
      images.push({
        id: item.id,
        title: item.type === 'cover' ? '封面' : item.type === 'endpapers' ? '环衬' : '扉页',
        imageData: item.imageData,
        type: item.type,
      });
    });

  return images;
}

function collectGalleryImages(
  snapshot: WorkbenchProjectSnapshot,
  status: GalleryProjectStatus,
) {
  return status === 'completed'
    ? collectCompletedGalleryImages(snapshot)
    : collectDraftGalleryImages(snapshot);
}

export async function saveCurrentWorkbenchProject(options: {
  status: GalleryProjectStatus;
  name?: string;
}): Promise<GalleryProject | null> {
  const store = usePipelineStore.getState();
  const snapshot = store.exportProjectSnapshot();

  if (!hasPipelineProgress(snapshot)) {
    return null;
  }

  const name = (options.name ?? '').trim() || getDefaultDraftProjectName(snapshot);
  const nextSnapshot: WorkbenchProjectSnapshot = {
    ...snapshot,
    activeProjectId: snapshot.activeProjectId,
    activeProjectName: name,
    activeProjectStatus: options.status,
    lastUpdatedAt: Date.now(),
  };

  const saved = await saveProjectToGallery({
    projectId: snapshot.activeProjectId || undefined,
    name,
    status: options.status,
    images: collectGalleryImages(nextSnapshot, options.status),
    snapshot: nextSnapshot,
  });

  usePipelineStore.getState().setActiveProjectMeta({
    id: saved.id,
    name: saved.name,
    status: saved.status,
  });

  return saved;
}

export async function restoreGalleryProjectToWorkbench(
  projectId: string,
): Promise<GalleryProjectSnapshotRecord> {
  const store = usePipelineStore.getState();

  if (store.isProcessing) {
    throw new Error('当前仍有任务在生成中，请等待完成后再切换项目。');
  }

  if (hasPipelineProgress(store) && store.activeProjectId === projectId) {
    return {
      id: store.activeProjectId,
      name: store.activeProjectName,
      createdAt: '',
      updatedAt: '',
      status: store.activeProjectStatus ?? 'draft',
      snapshot: store.exportProjectSnapshot(),
    };
  }

  if (hasPipelineProgress(store) && store.activeProjectId !== projectId) {
    await saveCurrentWorkbenchProject({ status: 'draft' });
  }

  const project = await loadProjectSnapshot(projectId);
  if (!project) {
    throw new Error('该项目缺少可恢复的工作台快照，暂时无法继续制作。');
  }

  await usePipelineStore.getState().restoreProjectSnapshot(project.snapshot);
  return project;
}

export async function restartWorkbenchWithAutosave(): Promise<void> {
  const store = usePipelineStore.getState();
  if (store.isProcessing) {
    throw new Error('当前仍有任务在生成中，请等待完成后再重新开始。');
  }

  if (hasPipelineProgress(store)) {
    await saveCurrentWorkbenchProject({ status: 'draft' });
  }

  usePipelineStore.getState().resetAll();
}
