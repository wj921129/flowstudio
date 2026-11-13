import React, { useEffect, useState, useCallback } from 'react';
import type { DiagramSummary, UserIdentity } from '@flowstudio/shared';
import { Plus, Search, Sun, Moon, GitFork, X, AlertTriangle } from 'lucide-react';
import { apiClient } from '../../lib/api-client.js';
import { DiagramCard } from './diagram-card.js';
import { CreateDiagramModal } from './create-diagram-modal.js';
import { getOrCreateUserIdentity, saveUserNickname } from '../collaboration/user-identity.js';
import { NicknameModal } from '../collaboration/nickname-modal.js';

export const DashboardPage: React.FC = () => {
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deletingDiagram, setDeletingDiagram] = useState<DiagramSummary | null>(null);

  const [currentUser, setCurrentUser] = useState<UserIdentity>(() => getOrCreateUserIdentity());
  const [nicknameModalOpen, setNicknameModalOpen] = useState(false);

  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'dark' : 'light');
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    if (nextTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const loadDiagrams = useCallback(async (query?: string) => {
    try {
      setLoading(true);
      const list = await apiClient.listDiagrams(query);
      setDiagrams(list);
    } catch (err) {
      console.error('[DashboardPage] 加载图表失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadDiagrams(searchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, loadDiagrams]);

  const handleCreate = async (data: { title: string; description: string }) => {
    const created = await apiClient.createDiagram(data);
    window.location.hash = `#/diagram/${created.id}`;
  };

  const handleInlineRename = async (id: string, newTitle: string) => {
    await apiClient.updateDiagram(id, { title: newTitle });
    loadDiagrams(searchQuery);
  };

  const handleDuplicate = async (id: string) => {
    await apiClient.duplicateDiagram(id);
    loadDiagrams(searchQuery);
  };

  const handleDelete = async (id: string) => {
    await apiClient.deleteDiagram(id);
    loadDiagrams(searchQuery);
  };

  const handleConfirmDelete = async () => {
    if (!deletingDiagram) return;
    const id = deletingDiagram.id;
    setDeletingDiagram(null);
    await apiClient.deleteDiagram(id);
    loadDiagrams(searchQuery);
  };

  const handleOpenDiagram = (id: string) => {
    window.location.hash = `#/diagram/${id}`;
  };

  const handleSaveNickname = (name: string) => {
    const updated = saveUserNickname(name);
    setCurrentUser(updated);
  };

  return (
    <div
      className="min-h-screen flex flex-col transition-colors duration-150"
      style={{
        backgroundColor: 'var(--fs-bg)',
        color: 'var(--fs-text)',
      }}
    >
      <header
        className="h-16 px-3 sm:px-6 border-b flex items-center justify-between gap-2 sm:gap-4 sticky top-0 z-20 backdrop-blur-md"
        style={{
          backgroundColor: 'var(--fs-surface)',
          borderColor: 'var(--fs-border)',
        }}
      >
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center font-bold text-white shadow-md bg-linear-to-br from-indigo-500 to-indigo-700">
            <GitFork className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold tracking-tight">FlowStudio</h1>
            <p className="hidden sm:block text-[11px] -mt-0.5 text-[var(--fs-text-muted)] font-medium">
              局域网协同流程图
            </p>
          </div>
        </div>

        <div className="flex-1 min-w-0 max-w-xs sm:max-w-md relative mx-1 sm:mx-0">
          <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 text-[var(--fs-text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索流程图标题..."
            className="w-full pl-8 sm:pl-9 pr-7 sm:pr-8 py-1 sm:py-1.5 rounded-lg border text-xs sm:text-sm outline-none transition-all focus:ring-2 focus:ring-indigo-500/20"
            style={{
              backgroundColor: 'var(--fs-bg)',
              borderColor: 'var(--fs-border)',
              color: 'var(--fs-text)',
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-[var(--fs-text-muted)] cursor-pointer"
              title="清除搜索"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'light' ? '切换暗色' : '切换亮色'}
            className="p-1.5 sm:p-2 rounded-lg border text-[var(--fs-text-muted)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
            style={{ borderColor: 'var(--fs-border)' }}
          >
            {theme === 'light' ? <Moon className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Sun className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setNicknameModalOpen(true)}
            className="flex items-center gap-1.5 px-2 py-1 sm:px-2.5 sm:py-1 rounded-lg border transition-colors hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
            style={{ borderColor: 'var(--fs-border)' }}
            title="点击修改昵称"
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-xs shrink-0"
              style={{ backgroundColor: currentUser.color }}
            >
              {currentUser.nickname.slice(0, 1)}
            </div>
            <span className="hidden sm:inline text-xs font-medium max-w-[100px] truncate text-[var(--fs-text)]">
              {currentUser.nickname}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium text-white shadow-sm transition-transform active:scale-95 cursor-pointer bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">新建流程图</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold tracking-tight">所有流程图</h2>
          <span className="text-xs text-[var(--fs-text-muted)]">
            共 {diagrams.length} 张图
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64 text-sm text-[var(--fs-text-muted)]">
            正在载入图表...
          </div>
        ) : diagrams.length === 0 ? (
          <div
            className="rounded-2xl border border-dashed p-12 text-center flex flex-col items-center justify-center"
            style={{ borderColor: 'var(--fs-border)' }}
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 mb-4">
              <GitFork className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold mb-1">
              {searchQuery ? '未找到相关流程图' : '暂无流程图'}
            </h3>
            <p className="text-xs text-[var(--fs-text-muted)] mb-4 max-w-sm">
              {searchQuery
                ? `未找到与「${searchQuery}」相关的图表，可尝试更换关键词或清除搜索条件`
                : '立即创建一个新图表，并与局域网内的同事一同实时协同绘制'}
            </p>
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                style={{
                  borderColor: 'var(--fs-border)',
                  backgroundColor: 'var(--fs-surface)',
                  color: 'var(--fs-text)',
                }}
              >
                清除搜索条件
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCreateModalOpen(true)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white shadow-sm bg-indigo-600 hover:bg-indigo-700 transition-colors cursor-pointer"
              >
                创建第一个流程图
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {diagrams.map((d) => (
              <DiagramCard
                key={d.id}
                diagram={d}
                onOpen={handleOpenDiagram}
                onRenameTitle={handleInlineRename}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
                onRequestDelete={(diag) => setDeletingDiagram(diag)}
              />
            ))}
          </div>
        )}
      </main>

      <CreateDiagramModal
        isOpen={createModalOpen}
        onSave={handleCreate}
        onClose={() => setCreateModalOpen(false)}
      />

      <NicknameModal
        isOpen={nicknameModalOpen}
        currentUser={currentUser}
        onSave={handleSaveNickname}
        onClose={() => setNicknameModalOpen(false)}
      />

      {deletingDiagram && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
          <div
            className="w-full max-w-md mx-4 rounded-xl p-6 shadow-2xl border transition-all animate-in fade-in zoom-in-95 duration-150"
            style={{
              backgroundColor: 'var(--fs-surface)',
              borderColor: 'var(--fs-border)',
              color: 'var(--fs-text)',
            }}
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/60 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold leading-6 mb-1">
                  删除流程图
                </h3>
                <p className="text-xs leading-5 text-[var(--fs-text-muted)]">
                  确定要永久删除流程图「<span className="font-semibold text-[var(--fs-text)]">{deletingDiagram.title}</span>」吗？此操作无法撤销，所有画布节点、连线与协同历史将被彻底清除。
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-5">
              <button
                type="button"
                onClick={() => setDeletingDiagram(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                style={{
                  borderColor: 'var(--fs-border)',
                  color: 'var(--fs-text-muted)',
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white shadow-xs bg-rose-600 hover:bg-rose-700 transition-colors cursor-pointer"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
