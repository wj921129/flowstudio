import React, { useState, useEffect } from 'react';

export interface CreateDiagramModalProps {
  isOpen: boolean;
  initialTitle?: string;
  initialDescription?: string;
  isEditing?: boolean;
  onSave: (data: { title: string; description: string }) => Promise<void>;
  onClose: () => void;
}

export const CreateDiagramModal: React.FC<CreateDiagramModalProps> = ({
  isOpen,
  initialTitle = '',
  initialDescription = '',
  isEditing = false,
  onSave,
  onClose,
}) => {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTitle(initialTitle);
      setDescription(initialDescription);
    }
  }, [isOpen, initialTitle, initialDescription]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || loading) return;

    setLoading(true);
    try {
      await onSave({ title: title.trim(), description: description.trim() });
      onClose();
    } catch (err) {
      console.error(err);
      alert('保存失败，请检查网络或服务端状态');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
      <div
        className="w-full max-w-md rounded-xl p-6 shadow-2xl border transition-all animate-in fade-in zoom-in-95 duration-150"
        style={{
          backgroundColor: 'var(--fs-surface)',
          borderColor: 'var(--fs-border)',
          color: 'var(--fs-text)',
        }}
      >
        <h3 className="text-lg font-semibold mb-4">
          {isEditing ? '修改图表' : '新建流程图'}
        </h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1 text-[var(--fs-text-muted)]">
              图表标题 *
            </label>
            <input
              type="text"
              autoFocus
              required
              maxLength={100}
              placeholder="例如：电商订单支付履约流程"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-all focus:ring-2 focus:ring-blue-500/20"
              style={{
                backgroundColor: 'var(--fs-bg)',
                borderColor: 'var(--fs-border)',
                color: 'var(--fs-text)',
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1 text-[var(--fs-text-muted)]">
              补充描述 (可选)
            </label>
            <textarea
              rows={3}
              maxLength={500}
              placeholder="简要记录该流程图的业务背景与设计说明"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm outline-none transition-all resize-none focus:ring-2 focus:ring-blue-500/20"
              style={{
                backgroundColor: 'var(--fs-bg)',
                borderColor: 'var(--fs-border)',
                color: 'var(--fs-text)',
              }}
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
              style={{
                borderColor: 'var(--fs-border)',
                color: 'var(--fs-text-muted)',
              }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!title.trim() || loading}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white shadow-xs transition-opacity disabled:opacity-50 cursor-pointer"
              style={{ backgroundColor: 'var(--fs-primary)' }}
            >
              {loading ? '正在保存...' : isEditing ? '确定' : '立即创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
