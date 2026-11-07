import React, { useState } from 'react';
import type { UserIdentity } from '@flowstudio/shared';

export interface NicknameModalProps {
  isOpen: boolean;
  currentUser: UserIdentity;
  onSave: (nickname: string) => void;
  onClose: () => void;
}

export const NicknameModal: React.FC<NicknameModalProps> = ({
  isOpen,
  currentUser,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState(currentUser.nickname);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSave(name.trim());
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
      <div
        className="w-full max-w-md rounded-xl p-6 shadow-2xl border transition-all animate-in fade-in zoom-in-95 duration-150"
        style={{
          backgroundColor: 'var(--fs-bg-surface, #ffffff)',
          borderColor: 'var(--fs-border-primary, #e5e7eb)',
          color: 'var(--fs-text-primary, #111827)',
        }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white shadow-xs"
            style={{ backgroundColor: currentUser.color }}
          >
            {name.slice(0, 1) || '我'}
          </div>
          <div>
            <h3 className="text-lg font-semibold">设置协作者昵称</h3>
            <p className="text-xs text-[var(--fs-text-secondary,#6b7280)]">
              该昵称将与光标和选区一同在局域网内广播
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5 text-[var(--fs-text-secondary,#4b5563)]">
              你的昵称
            </label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              placeholder="请输入你在团队中的昵称"
              className="w-full px-3.5 py-2 rounded-lg border text-sm outline-none transition-all focus:ring-2"
              style={{
                backgroundColor: 'var(--fs-bg-canvas, #f9fafb)',
                borderColor: 'var(--fs-border-primary, #d1d5db)',
                color: 'var(--fs-text-primary, #111827)',
              }}
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-black/5"
              style={{
                borderColor: 'var(--fs-border-primary, #e5e7eb)',
                color: 'var(--fs-text-secondary, #4b5563)',
              }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white shadow-xs transition-opacity disabled:opacity-50"
              style={{ backgroundColor: currentUser.color }}
            >
              保存并进入
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
