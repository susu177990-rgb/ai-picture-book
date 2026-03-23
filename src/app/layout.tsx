'use client';

import './globals.css';
import { Inter } from 'next/font/google';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { usePipelineStore } from '@/store/pipeline-store';
import { useShallow } from 'zustand/react/shallow';
import { restartWorkbenchWithAutosave, saveCurrentWorkbenchProject } from '@/lib/workbench-project';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
        <title>AI 儿童绘本生成器</title>
        <meta
          name="description"
          content="全自动AI儿童绘本生成软件 - 上传故事与风格参考图，一键生成高品质绘本插画"
        />
      </head>
      <body className={inter.className}>
        <div className="app-layout">
          <TopNav />
          <MainContent>{children}</MainContent>
        </div>
      </body>
    </html>
  );
}

function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [isRestarting, setIsRestarting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const store = usePipelineStore(
    useShallow((s) => ({
      currentStage: s.currentStage,
      bookTitle: s.bookTitle,
      scriptPages: s.scriptPages,
      isProcessing: s.isProcessing,
    })),
  );

  const navItems = [
    { href: '/write-story', icon: '✍️', label: '写故事' },
    { href: '/', icon: '🎨', label: '工作台' },
    { href: '/gallery', icon: '🖼️', label: '画廊' },
    { href: '/settings', icon: '⚙️', label: '设置' },
  ];
  const routeLabel =
    pathname === '/'
      ? '绘本工作台'
      : pathname === '/write-story'
        ? '故事开发台'
        : pathname === '/gallery'
          ? '项目画廊'
          : '系统设置';
  const stageLabel =
    store.currentStage === 'upload'
      ? '上传素材'
      : store.currentStage === 'stage1'
        ? '全局解析'
        : store.currentStage === 'stage2'
          ? '角色资产'
        : store.currentStage === 'stage3'
          ? '分页审核'
          : '装帧审核';
  const handleRestart = async () => {
    if (pathname !== '/') return;
    if (store.isProcessing || isRestarting || isSavingDraft) {
      window.alert('当前仍有任务在生成中，请等待完成后再重新开始。');
      return;
    }
    if (window.confirm('确定要清空当前所有进度并重新开始吗？此操作无法撤销。')) {
      try {
        setIsRestarting(true);
        await restartWorkbenchWithAutosave();
        router.push('/');
        router.refresh();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : '重新开始失败');
      } finally {
        setIsRestarting(false);
      }
    }
  };

  const handleSaveDraft = async () => {
    if (pathname !== '/') return;
    if (store.isProcessing || isRestarting || isSavingDraft) {
      window.alert('当前仍有任务在执行中，请稍后再保存草稿。');
      return;
    }

    try {
      setIsSavingDraft(true);
      const saved = await saveCurrentWorkbenchProject({ status: 'draft' });
      if (!saved) {
        window.alert('当前还没有可保存的流程内容。');
        return;
      }
      window.alert(`草稿已保存到画廊：${saved.name}`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '保存草稿失败');
    } finally {
      setIsSavingDraft(false);
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="topbar-brand-icon">📖</span>
        <div>
          <div className="topbar-brand-title">AI 绘本工坊</div>
          <div className="topbar-brand-subtitle">Picture Book Creation System</div>
        </div>
      </div>
      <nav className="topbar-nav">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`topbar-link ${pathname === item.href ? 'active' : ''}`}
          >
            <span className="topbar-link-icon">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="topbar-right">
        {pathname === '/' && (
          <div className="topbar-status-pill">
            <span className="topbar-status-label">当前阶段</span>
            <strong>{stageLabel}</strong>
          </div>
        )}
        <div className="topbar-meta-pill">
          <span>{routeLabel}</span>
          {pathname === '/' && store.bookTitle ? <strong>{store.bookTitle}</strong> : <strong>{pathname === '/' ? `${store.scriptPages.length} 页剧本` : '儿童绘本创作系统'}</strong>}
        </div>
        {pathname === '/' && (
          <button
            type="button"
            className="btn btn-secondary btn-sm topbar-action-button"
            onClick={handleSaveDraft}
            disabled={store.isProcessing || isRestarting || isSavingDraft}
          >
            {isSavingDraft ? '保存中...' : '存草稿'}
          </button>
        )}
        {pathname === '/' && (
          <button
            type="button"
            className="btn btn-danger btn-sm topbar-action-button"
            onClick={handleRestart}
            disabled={store.isProcessing || isRestarting || isSavingDraft}
          >
            {isRestarting ? '保存中...' : '重新开始'}
          </button>
        )}
      </div>
    </header>
  );
}

function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isWidePage = pathname === '/write-story';

  return (
    <main className={`main-content ${isWidePage ? 'main-content-wide' : ''}`}>
      {children}
    </main>
  );
}
