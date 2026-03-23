'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ThumbnailBase64Image } from '@/components/ThumbnailBase64Image';
import { GalleryModalThumbnail } from '@/components/GalleryModalThumbnail';
import { GalleryLightbox } from '@/components/GalleryLightbox';
import {
  loadAllGalleryProjects,
  loadFullProject,
  loadProjectMeta,
  loadProjectImageByKey,
  deleteGalleryProject,
  type GalleryProject,
  type GalleryImageItem,
  type GalleryProjectMeta,
} from '@/lib/gallery-storage';
import { downloadAsZip } from '@/lib/image-utils';
import { restoreGalleryProjectToWorkbench } from '@/lib/workbench-project';

export default function GalleryPage() {
  const router = useRouter();
  const [savedProjects, setSavedProjects] = useState<GalleryProject[]>([]);
  const [projectImagesModal, setProjectImagesModal] = useState<{
    meta: GalleryProjectMeta;
    legacyImages?: GalleryImageItem[];
  } | null>(null);
  const [lightboxItem, setLightboxItem] = useState<GalleryImageItem | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [resumingProjectId, setResumingProjectId] = useState('');

  const reloadSavedProjects = useCallback(async () => {
    setLoading(true);
    try {
      const projects = await loadAllGalleryProjects();
      setSavedProjects(projects);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialProjects() {
      try {
        const projects = await loadAllGalleryProjects();
        if (!cancelled) {
          setSavedProjects(projects);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadInitialProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDeleteProject = useCallback(
    async (id: string) => {
      if (confirm('确定要删除此项目吗？')) {
        await deleteGalleryProject(id);
        await reloadSavedProjects();
        setProjectImagesModal(null);
      }
    },
    [reloadSavedProjects],
  );

  const handleDownloadProject = useCallback(
    async (project: GalleryProject) => {
      const full =
        (project.totalCount ?? project.images.length) > project.images.length
          ? await loadFullProject(project.id)
          : project;
      const images = (full?.images ?? project.images).map((img) => {
        const ext = img.imageData.startsWith('data:image/png') ? 'png' : 'jpg';
        let filename: string;
        if (img.type === 'asset') {
          filename = `${(img.assetType || 'character') === 'item' ? '物品' : '角色'}：${img.title}.${ext}`;
        } else if (img.type === 'cover' || img.type === 'endpapers' || img.type === 'titlepage') {
          const bindingName =
            img.type === 'cover'
              ? '0_1封面'
              : img.type === 'endpapers'
                ? '0_2环衬'
                : '0_3扉页';
          filename = `${bindingName}.${ext}`;
        } else {
          filename = `${img.title}-${img.id}.${ext}`;
        }
        return { filename, base64: img.imageData };
      });
      await downloadAsZip(images);
    },
    [],
  );

  const handleContinueProject = useCallback(
    async (projectId: string) => {
      try {
        setResumingProjectId(projectId);
        await restoreGalleryProjectToWorkbench(projectId);
        router.push('/');
        router.refresh();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : '继续制作失败');
      } finally {
        setResumingProjectId('');
      }
    },
    [router],
  );

  const handleProjectThumbClick = useCallback(
    async (project: GalleryProject) => {
      const meta = await loadProjectMeta(project.id);
      if (meta?.imageKeys?.length) {
        setProjectImagesModal({ meta });
        return;
      }
      const full = await loadFullProject(project.id);
      if (full) {
        setProjectImagesModal({
          meta: {
            id: full.id,
            name: full.name,
            createdAt: full.createdAt,
            updatedAt: full.updatedAt,
            status: full.status,
            imageKeys: full.images.map((img, index) => `legacy-${img.id}-${index}`),
            assetCount: full.assetCount ?? full.images.filter((img) => img.type === 'asset').length,
            pageCount: full.pageCount ?? full.images.filter((img) => img.type === 'page').length,
            bindingCount:
              full.bindingCount ??
              full.images.filter(
                (img) => img.type === 'cover' || img.type === 'endpapers' || img.type === 'titlepage',
              ).length,
            hasCover: full.hasCover ?? full.images.some((img) => img.type === 'cover'),
            hasEndpapers: full.hasEndpapers ?? full.images.some((img) => img.type === 'endpapers'),
            hasTitlePage: full.hasTitlePage ?? full.images.some((img) => img.type === 'titlepage'),
            canResume: Boolean(full.canResume),
          },
          legacyImages: full.images,
        });
      }
    },
    [],
  );

  const handleThumbnailEnlarge = useCallback(
    (img: GalleryImageItem, imageKey: string) => {
      setLightboxItem(img);
      if (projectImagesModal) {
        const idx = projectImagesModal.meta.imageKeys.indexOf(imageKey);
        setLightboxIndex(idx >= 0 ? idx : 0);
      }
    },
    [projectImagesModal],
  );

  const getImageLabel = (img: GalleryImageItem) => {
    if (img.type === 'asset') {
      return `${(img.assetType || 'character') === 'item' ? '物品' : '角色'}：${img.title}`;
    }
    return img.title;
  };

  const getProjectStatusLabel = (project: Pick<GalleryProject, 'status'>) =>
    project.status === 'draft' ? '草稿中' : '已完成';

  const visibleProjects = [...savedProjects]
    .filter((project) =>
      project.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

  return (
    <>
      <div className="gallery-page gallery-page-wide">
        <div className="page-header">
          <div>
            <h1 className="page-title">画廊</h1>
            <p className="page-description">
              浏览已保存的绘本项目，按归档维度查看、继续制作、打包下载和清理。
            </p>
          </div>
        </div>

        <div className="gallery-toolbar">
          <input
            type="search"
            className="form-input gallery-search-input"
            placeholder="搜索绘本名称"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="gallery-loading">
            <span className="spinner" style={{ width: 32, height: 32 }} />
            <div>加载中...</div>
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="gallery-empty">
            <div className="gallery-empty-icon">📁</div>
            <div className="gallery-empty-text">
              当前没有匹配的绘本项目。
            </div>
          </div>
        ) : (
          <div className="gallery-saved-list">
            {visibleProjects.map((project) => {
              const isResuming = resumingProjectId === project.id;

              return (
                <div key={project.id} className="gallery-saved-card">
                  <div className="gallery-saved-header">
                    <div>
                      <div className="gallery-saved-title-row">
                        <h3 className="gallery-saved-title">{project.name}</h3>
                        <span className={`gallery-project-status ${project.status}`}>
                          {getProjectStatusLabel(project)}
                        </span>
                      </div>
                      <div className="gallery-saved-meta">
                        最近更新 {new Date(project.updatedAt).toLocaleString()} ·{' '}
                        {project.totalCount ?? project.images.length} 张预览图
                      </div>
                      <div className="gallery-archive-summary">
                        角色 {project.assetCount ?? 0} · 分页 {project.pageCount ?? 0} · 装帧{' '}
                        {project.bindingCount ?? 0}
                      </div>
                    </div>
                    <div className="gallery-saved-header-actions">
                      <button
                        type="button"
                        className="btn btn-success btn-sm"
                        onClick={() => handleContinueProject(project.id)}
                        disabled={!project.canResume || Boolean(resumingProjectId)}
                        title={project.canResume ? '恢复到工作台继续制作' : '旧项目缺少工作台快照，暂时无法恢复'}
                      >
                        {isResuming ? '恢复中...' : '继续制作'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => handleDownloadProject(project)}
                        disabled={Boolean(resumingProjectId)}
                      >
                        打包下载
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => handleDeleteProject(project.id)}
                        disabled={Boolean(resumingProjectId)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <div className="gallery-saved-grid">
                    {project.images.length > 0 ? (
                      project.images.map((img) => (
                        <div
                          key={img.id}
                          className="gallery-saved-thumb"
                          onClick={() => handleProjectThumbClick(project)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) =>
                            e.key === 'Enter' && handleProjectThumbClick(project)
                          }
                        >
                          <ThumbnailBase64Image
                            src={img.imageData}
                            alt={img.title}
                            className="gallery-saved-thumb-img"
                            maxSize={800}
                          />
                          <span className="gallery-saved-thumb-label">
                            {img.title}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="gallery-saved-empty-preview">
                        当前暂无预览图，可继续制作补全内容。
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {projectImagesModal && (
        <div
          className="gallery-modal-overlay gallery-project-images-overlay"
          onClick={() => {
            setProjectImagesModal(null);
            setLightboxItem(null);
          }}
        >
          <div
            className="gallery-project-images-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gallery-project-images-header">
              <div>
                <div className="gallery-saved-title-row">
                  <h3>{projectImagesModal.meta.name}</h3>
                  <span className={`gallery-project-status ${projectImagesModal.meta.status}`}>
                    {getProjectStatusLabel(projectImagesModal.meta)}
                  </span>
                </div>
                <div className="gallery-saved-meta">
                  最近更新 {new Date(projectImagesModal.meta.updatedAt).toLocaleString()}
                </div>
                <div className="gallery-archive-summary">
                  角色 {projectImagesModal.meta.assetCount} · 分页 {projectImagesModal.meta.pageCount} · 装帧{' '}
                  {projectImagesModal.meta.bindingCount}
                </div>
              </div>
              <div className="gallery-project-images-header-actions">
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  onClick={() => handleContinueProject(projectImagesModal.meta.id)}
                  disabled={!projectImagesModal.meta.canResume || Boolean(resumingProjectId)}
                  title={
                    projectImagesModal.meta.canResume
                      ? '恢复到工作台继续制作'
                      : '旧项目缺少工作台快照，暂时无法恢复'
                  }
                >
                  {resumingProjectId === projectImagesModal.meta.id ? '恢复中...' : '继续制作'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() =>
                    handleDownloadProject({
                      id: projectImagesModal.meta.id,
                      name: projectImagesModal.meta.name,
                      createdAt: projectImagesModal.meta.createdAt,
                      updatedAt: projectImagesModal.meta.updatedAt,
                      status: projectImagesModal.meta.status,
                      images: [],
                      totalCount: projectImagesModal.meta.imageKeys.length,
                      assetCount: projectImagesModal.meta.assetCount,
                      pageCount: projectImagesModal.meta.pageCount,
                      bindingCount: projectImagesModal.meta.bindingCount,
                      hasCover: projectImagesModal.meta.hasCover,
                      hasEndpapers: projectImagesModal.meta.hasEndpapers,
                      hasTitlePage: projectImagesModal.meta.hasTitlePage,
                      canResume: projectImagesModal.meta.canResume,
                    })
                  }
                  disabled={Boolean(resumingProjectId)}
                >
                  打包下载
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setProjectImagesModal(null);
                    setLightboxItem(null);
                  }}
                  disabled={Boolean(resumingProjectId)}
                >
                  关闭
                </button>
              </div>
            </div>
            <div className="gallery-project-images-grid">
              {projectImagesModal.legacyImages
                ? projectImagesModal.legacyImages.map((img, index) => (
                    <div
                      key={`${img.id}-${index}`}
                      className="gallery-project-images-item"
                      onClick={() => {
                        setLightboxItem(img);
                        setLightboxIndex(index);
                      }}
                    >
                      <ThumbnailBase64Image
                        src={img.imageData}
                        alt={img.title}
                        className="gallery-project-images-img"
                        maxSize={800}
                      />
                    </div>
                  ))
                : projectImagesModal.meta.imageKeys.map((imageKey) => (
                    <GalleryModalThumbnail
                      key={imageKey}
                      imageKey={imageKey}
                      alt=""
                      className="gallery-project-images-item"
                      imgClassName="gallery-project-images-img"
                      onClick={handleThumbnailEnlarge}
                    />
                  ))}
            </div>
          </div>
        </div>
      )}

      {lightboxItem && projectImagesModal && (
        <GalleryLightbox
          src={lightboxItem.imageData}
          alt={getImageLabel(lightboxItem)}
          onClose={() => setLightboxItem(null)}
          canPrev={lightboxIndex > 0}
          canNext={lightboxIndex < projectImagesModal.meta.imageKeys.length - 1}
          onPrev={async () => {
            if (lightboxIndex <= 0) return;
            if (projectImagesModal.legacyImages) {
              setLightboxItem(projectImagesModal.legacyImages[lightboxIndex - 1]);
              setLightboxIndex(lightboxIndex - 1);
              return;
            }
            const key = projectImagesModal.meta.imageKeys[lightboxIndex - 1];
            const img = await loadProjectImageByKey(key);
            if (img) {
              setLightboxItem(img);
              setLightboxIndex(lightboxIndex - 1);
            }
          }}
          onNext={async () => {
            if (lightboxIndex >= projectImagesModal.meta.imageKeys.length - 1) return;
            if (projectImagesModal.legacyImages) {
              setLightboxItem(projectImagesModal.legacyImages[lightboxIndex + 1]);
              setLightboxIndex(lightboxIndex + 1);
              return;
            }
            const key = projectImagesModal.meta.imageKeys[lightboxIndex + 1];
            const img = await loadProjectImageByKey(key);
            if (img) {
              setLightboxItem(img);
              setLightboxIndex(lightboxIndex + 1);
            }
          }}
        />
      )}
    </>
  );
}
