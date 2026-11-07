import React, { useEffect, useState, useCallback } from 'react';
import type { DiagramSummary, UserIdentity } from '@flowstudio/shared';
import { Plus, Search, Sun, Moon, GitFork } from 'lucide-react';
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
  const [editingDiagram, setEditingDiagram] = useState<DiagramSummary | null>(null);

  const [currentUser, setCurrentUser] = useState<UserIdentity>(() => getOrCreateUserIdentity());
  const [nicknameModalOpen, setNicknameModalOpen] = useState(false);

  // 初始化主题设置
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

  const handleUpdate = async (data: { title: string; description: string }) => {
    if (!editingDiagram) return;
    await apiClient.updateDiagram(editingDiagram.id, data);
    setEditingDiagram(null);
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
        backgroundColor: 'var(--fs-bg-canvas, #f9fafb)',
        color: 'var(--fs-text-primary, #111827)',
      }}
    >
      {/* 顶部全局导航栏 */}
      <header
        className="h-16 px-6 border-b flex items-center justify-between gap-4 sticky top-0 z-20 backdrop-blur-md"
        style={{
          backgroundColor: 'var(--fs-bg-surface, #ffffff)',
          borderColor: 'var(--fs-border-primary, #e5e7eb)',
        }}
      >
        {/* 左侧 Logo */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white shadow-md bg-linear-to-br from-indigo-500 to-indigo-700">
            <GitFork className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">FlowStudio</h1>
            <p className="text-[11px] -mt-0.5 text-[var(--fs-text-secondary,#6b7280)] font-medium">
              局域网协同流程图
            </p>
          </div>
        </div>

        {/* 中间搜索框 */}
        <div className="flex-1 max-w-md relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fs-text-secondary,#9ca3af)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索流程图标题..."
            className="w-full pl-9 pr-4 py-1.5 rounded-lg border text-sm outline-none transition-all focus:ring-2 focus:ring-indigo-500/20"
            style={{
              backgroundColor: 'var(--fs-bg-canvas, #f9fafb)',
              borderColor: 'var(--fs-border-primary, #e5e7eb)',
            }}
          />
        </div>

        {/* 右侧动作与身份 */}
        <div className="flex items-center gap-3">
          {/* 主题切换 */}
          <button
            type="button"
            onClick={toggleTheme}
            title={theme === 'light' ? '切换暗色' : '切换亮色'}
            className="p-2 rounded-lg border text-[var(--fs-text-secondary,#6b7280)] hover:bg-black/5 transition-colors"
            style={{ borderColor: 'var(--fs-border-primary, #e5e7eb)' }}
          >
            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>

          {/* 用户身份头像与昵称修改 */}
          <button
            type="button"
            onClick={() => setNicknameModalOpen(true)}
            className="flex items-center gap-2 px-2.5 py-1 rounded-lg border transition-colors hover:bg-black/5"
            style={{ borderColor: 'var(--fs-border-primary, #e5e7eb)' }}
            title="点击修改昵称"
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-xs"
              style={{ backgroundColor: currentUser.color }}
            >
              {currentUser.nickname.slice(0, 1)}
            </div>
            <span className="text-xs font-medium max-w-[100px] truncate">
              {currentUser.nickname}
            </span>
          </button>

          {/* 新建流程图主按钮 */}
          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white shadow-sm transition-transform active:scale-95 cursor-pointer bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4" />
            <span>新建流程图</span>
          </button>
        </div>
      </header>

      {/* 主体图表网格 */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold tracking-tight">所有流程图</h2>
          <span className="text-xs text-[var(--fs-text-secondary,#6b7280)]">
            共 {diagrams.length} 张图
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64 text-sm text-[var(--fs-text-secondary,#9ca3af)]">
            正在载入图表...
          </div>
        ) : diagrams.length === 0 ? (
          <div
            className="rounded-2xl border border-dashed p-12 text-center flex flex-col items-center justify-center"
            style={{ borderColor: 'var(--fs-border-primary, #d1d5db)' }}
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-indigo-50 dark:bg-indigo-950 text-indigo-600 mb-4">
              <GitFork className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold mb-1">
              {searchQuery ? '未找到相关流程图' : '暂无流程图'}
            </h3>
            <p className="text-xs text-[var(--fs-text-secondary,#6b7280)] mb-4 max-w-sm">
              {searchQuery
                ? '尝试更换搜索关键词查找其它图表'
                : '立即创建一个新图表，并与局域网内的同事一同实时协同绘制'}
            </p>
            {!searchQuery && (
              <button
                type="button"
                onClick={() => setCreateModalOpen(true)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white shadow-sm bg-indigo-600 hover:bg-indigo-700 transition-colors"
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
                onRename={(diag) => setEditingDiagram(diag)}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>

      {/* 弹窗集合 */}
      <CreateDiagramModal
        isOpen={createModalOpen}
        onSave={handleCreate}
        onClose={() => setCreateModalOpen(false)}
      />

      <CreateDiagramModal
        isOpen={editingDiagram !== null}
        isEditing={true}
        initialTitle={editingDiagram?.title}
        initialDescription={editingDiagram?.description}
        onSave={handleUpdate}
        onClose={() => setEditingDiagram(null)}
      />

      <NicknameModal
        isOpen={nicknameModalOpen}
        currentUser={currentUser}
        onSave={handleSaveNickname}
        onClose={() => setNicknameModalOpen(false)}
      />
    </div>
  );
};
