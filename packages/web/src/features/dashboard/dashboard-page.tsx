import React, { useEffect, useState, useCallback, useMemo } from 'react';
import type { DiagramSummary, UserIdentity } from '@flowstudio/shared';
import { Plus, Search, Sun, Moon, X, AlertTriangle, FolderKanban, Clock, LayoutTemplate, ArrowRight, Sparkles } from 'lucide-react';
import { apiClient } from '../../lib/api-client.js';
import { DiagramCard } from './diagram-card.js';
import { TemplateCard } from './template-card.js';
import { CreateDiagramModal } from './create-diagram-modal.js';
import { getOrCreateUserIdentity, saveUserNickname } from '../collaboration/user-identity.js';
import { NicknameModal } from '../collaboration/nickname-modal.js';
import { BrandLogo } from '../../components/brand-logo.js';
import { TEMPLATES_REGISTRY, type DiagramTemplate, type TemplateCategory } from '../sidebar/templates/index.js';

type DashboardView = 'all' | 'recent' | 'templates';

const TEMPLATE_CATEGORY_ORDER: readonly TemplateCategory[] = ['flowchart', 'swimlane', 'topology', 'org-chart'];

const TEMPLATE_CATEGORY_LABELS: Record<'all' | TemplateCategory, string> = {
  all: '全部',
  flowchart: '流程图',
  swimlane: '泳道图',
  topology: '拓扑图',
  'org-chart': '组织架构',
};

export const DashboardPage: React.FC = () => {
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deletingDiagram, setDeletingDiagram] = useState<DiagramSummary | null>(null);

  const [currentUser, setCurrentUser] = useState<UserIdentity>(() => getOrCreateUserIdentity());
  const [nicknameModalOpen, setNicknameModalOpen] = useState(false);
  const [activeView, setActiveView] = useState<DashboardView>('all');
  const [templateCategory, setTemplateCategory] = useState<'all' | TemplateCategory>('all');
  const [creatingTemplateId, setCreatingTemplateId] = useState<string | null>(null);

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

  const handleCreateFromTemplate = async (tpl: DiagramTemplate) => {
    if (creatingTemplateId) return;
    try {
      setCreatingTemplateId(tpl.id);
      const created = await apiClient.createDiagram({
        title: tpl.title,
        description: tpl.description,
      });
      window.location.hash = `#/diagram/${created.id}?template=${encodeURIComponent(tpl.id)}`;
    } catch (err) {
      console.error('[DashboardPage] 从模板创建失败:', err);
      setCreatingTemplateId(null);
    }
  };

  const recentDiagrams = useMemo(
    () => [...diagrams].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)).slice(0, 8),
    [diagrams]
  );

  const visibleDiagrams = activeView === 'recent' ? recentDiagrams : diagrams;

  const featuredTemplates = useMemo(() => {
    const buckets = TEMPLATE_CATEGORY_ORDER.map((cat) =>
      TEMPLATES_REGISTRY.filter((tpl) => tpl.category === cat)
    );
    const picked: DiagramTemplate[] = [];
    const seen = new Set<string>();
    let round = 0;
    while (picked.length < 6 && buckets.some((b) => round < b.length)) {
      for (const bucket of buckets) {
        const tpl = bucket[round];
        if (tpl && !seen.has(tpl.id)) {
          seen.add(tpl.id);
          picked.push(tpl);
          if (picked.length >= 6) break;
        }
      }
      round += 1;
    }
    return picked;
  }, []);

  const filteredTemplates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return TEMPLATES_REGISTRY.filter((tpl) => {
      if (templateCategory !== 'all' && tpl.category !== templateCategory) return false;
      if (!q) return true;
      return tpl.title.toLowerCase().includes(q) || tpl.description.toLowerCase().includes(q);
    });
  }, [templateCategory, searchQuery]);

  return (
    <div
      className="min-h-screen flex flex-col transition-colors duration-150"
      style={{
        backgroundColor: 'var(--fs-bg)',
        color: 'var(--fs-text)',
      }}
    >
      <header
        className="h-16 border-b flex items-center sticky top-0 z-20 backdrop-blur-md"
        style={{
          backgroundColor: 'var(--fs-surface)',
          borderColor: 'var(--fs-border)',
        }}
      >
        <div
          className="md:w-56 xl:w-60 md:border-r md:px-5 px-3 shrink-0 h-full flex items-center gap-2.5"
          style={{ borderColor: 'var(--fs-border)' }}
        >
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center font-bold text-white shadow-md bg-fs-primary shrink-0">
            <BrandLogo className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold tracking-tight truncate">FlowStudio</h1>
            <p className="hidden sm:block text-[11px] -mt-0.5 text-[var(--fs-text-muted)] font-medium truncate">
              局域网协同流程图
            </p>
          </div>
        </div>

        <div className="flex-1 min-w-0 h-full px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0 max-w-xl relative">
            <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 text-[var(--fs-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索流程图或模板..."
              className="w-full pl-8 sm:pl-9 pr-7 sm:pr-8 py-1.5 rounded-lg border text-xs sm:text-sm outline-none transition-all focus:ring-2 focus:ring-fs-primary/20"
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
              className="flex items-center gap-1.5 px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium text-white shadow-sm transition-transform active:scale-95 cursor-pointer bg-fs-primary hover:opacity-90"
            >
              <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">新建流程图</span>
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 w-full flex flex-col md:flex-row">
        <aside
          className="md:w-56 xl:w-60 shrink-0 border-b md:border-b-0 md:border-r md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:overflow-y-auto px-3 py-2.5 md:p-4 flex md:flex-col gap-1.5 overflow-x-auto"
          style={{
            backgroundColor: 'var(--fs-surface)',
            borderColor: 'var(--fs-border)',
          }}
        >
          {[
            { id: 'all' as const, label: '全部流程图', icon: FolderKanban, count: diagrams.length },
            { id: 'recent' as const, label: '最近编辑', icon: Clock, count: recentDiagrams.length },
            { id: 'templates' as const, label: '模板库', icon: LayoutTemplate, count: TEMPLATES_REGISTRY.length },
          ].map((nav) => {
            const Icon = nav.icon;
            const isActive = activeView === nav.id;
            return (
              <button
                key={nav.id}
                type="button"
                onClick={() => setActiveView(nav.id)}
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                  isActive
                    ? 'bg-fs-primary/10 text-fs-primary font-semibold'
                    : 'text-[var(--fs-text-muted)] hover:text-[var(--fs-text)] hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{nav.label}</span>
                </span>
                <span className="text-[11px] font-mono opacity-75">{nav.count}</span>
              </button>
            );
          })}
        </aside>

        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
          {activeView === 'templates' ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-lg font-semibold tracking-tight">模板库</h2>
                  <span className="text-xs text-[var(--fs-text-muted)]">
                    共 {filteredTemplates.length} 套模板
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['all', ...TEMPLATE_CATEGORY_ORDER] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setTemplateCategory(cat)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        templateCategory === cat
                          ? 'bg-fs-primary text-white'
                          : 'bg-[var(--fs-surface)] border border-[var(--fs-border)] text-[var(--fs-text-muted)] hover:text-[var(--fs-text)]'
                      }`}
                    >
                      {TEMPLATE_CATEGORY_LABELS[cat]}
                    </button>
                  ))}
                </div>
              </div>

              {filteredTemplates.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-12 text-center text-xs text-[var(--fs-text-muted)]" style={{ borderColor: 'var(--fs-border)' }}>
                  未找到匹配的模板
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] 2xl:grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-5">
                  {filteredTemplates.map((tpl) => (
                    <TemplateCard
                      key={tpl.id}
                      template={tpl}
                      categoryLabel={TEMPLATE_CATEGORY_LABELS[tpl.category]}
                      variant="default"
                      isCreating={creatingTemplateId === tpl.id}
                      disabled={Boolean(creatingTemplateId)}
                      onSelect={handleCreateFromTemplate}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {activeView === 'all' && !searchQuery && featuredTemplates.length > 0 && (
                <section className="mb-8">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--fs-text-muted)]">
                      <Sparkles className="w-3.5 h-3.5 text-fs-primary" />
                      <span>快速从模板开始</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveView('templates')}
                      className="inline-flex items-center gap-1 text-xs font-medium text-fs-primary hover:opacity-80 cursor-pointer"
                    >
                      <span>查看全部模板</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 min-[1920px]:grid-cols-6 gap-4">
                    {featuredTemplates.map((tpl, idx) => (
                      <div
                        key={tpl.id}
                        className={
                          idx === 4
                            ? 'hidden xl:block'
                            : idx === 5
                              ? 'hidden min-[1920px]:block'
                              : ''
                        }
                      >
                        <TemplateCard
                          template={tpl}
                          categoryLabel={TEMPLATE_CATEGORY_LABELS[tpl.category]}
                          variant="compact"
                          isCreating={creatingTemplateId === tpl.id}
                          disabled={Boolean(creatingTemplateId)}
                          className="w-full h-full"
                          onSelect={handleCreateFromTemplate}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-semibold tracking-tight">
                  {activeView === 'recent' ? '最近编辑' : '所有流程图'}
                </h2>
                <span className="text-xs text-[var(--fs-text-muted)]">
                  共 {visibleDiagrams.length} 张图
                </span>
              </div>

              {loading ? (
                <div className="flex items-center justify-center h-64 text-sm text-[var(--fs-text-muted)]">
                  正在载入图表...
                </div>
              ) : visibleDiagrams.length === 0 ? (
                <div
                  className="rounded-2xl border border-dashed p-12 text-center flex flex-col items-center justify-center"
                  style={{ borderColor: 'var(--fs-border)' }}
                >
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-fs-primary/10 text-fs-primary mb-4">
                    <BrandLogo className="w-6 h-6" />
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
                      className="px-4 py-2 rounded-lg text-sm font-medium text-white shadow-sm bg-fs-primary hover:opacity-90 transition-opacity cursor-pointer"
                    >
                      创建第一个流程图
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(260px,1fr))] 2xl:grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-5">
                  {visibleDiagrams.map((d) => (
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
            </>
          )}
        </main>
      </div>

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
