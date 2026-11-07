import React, { useState } from 'react';
import { useCollaboration } from './collaboration-provider.js';
import { NicknameModal } from './nickname-modal.js';

export const CollaboratorAvatars: React.FC = () => {
  const collab = useCollaboration();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  if (!collab) return null;

  const { currentUser, remoteUsers, updateNickname, connectionStatus } = collab;

  return (
    <div className="flex items-center gap-2">
      {/* 协同连接状态指示 */}
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border"
        style={{
          borderColor: 'var(--fs-border-primary, #e5e7eb)',
          backgroundColor: 'var(--fs-bg-canvas, #f9fafb)',
          color: 'var(--fs-text-secondary, #6b7280)',
        }}
      >
        <span
          className={`w-2 h-2 rounded-full ${
            connectionStatus === 'connected'
              ? 'bg-emerald-500 animate-pulse'
              : connectionStatus === 'connecting'
              ? 'bg-amber-500'
              : 'bg-rose-500'
          }`}
        />
        <span>
          {connectionStatus === 'connected'
            ? '已同步'
            : connectionStatus === 'connecting'
            ? '连接中'
            : '已断开'}
        </span>
      </div>

      {/* 头像组 */}
      <div className="flex items-center -space-x-1.5 overflow-hidden">
        {/* 当前用户头像（点击可修改昵称） */}
        <button
          type="button"
          title={`当前身份: ${currentUser.nickname} (点击修改)`}
          onClick={() => setIsEditModalOpen(true)}
          className="relative inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-bold border-2 border-white ring-1 ring-black/10 transition-transform hover:scale-110 hover:z-10 cursor-pointer shadow-xs"
          style={{ backgroundColor: currentUser.color }}
        >
          {currentUser.nickname.slice(0, 1)}
        </button>

        {/* 远端用户头像 */}
        {remoteUsers.slice(0, 4).map((user) => (
          <div
            key={user.clientId}
            title={`协作者: ${user.nickname}`}
            className="relative inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-bold border-2 border-white ring-1 ring-black/10 shadow-xs"
            style={{ backgroundColor: user.color }}
          >
            {user.nickname.slice(0, 1)}
          </div>
        ))}

        {remoteUsers.length > 4 && (
          <div
            className="relative inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium border-2 border-white ring-1 ring-black/10 shadow-xs"
            style={{
              backgroundColor: 'var(--fs-bg-surface, #e5e7eb)',
              color: 'var(--fs-text-secondary, #4b5563)',
            }}
          >
            +{remoteUsers.length - 4}
          </div>
        )}
      </div>

      <NicknameModal
        isOpen={isEditModalOpen}
        currentUser={currentUser}
        onSave={updateNickname}
        onClose={() => setIsEditModalOpen(false)}
      />
    </div>
  );
};
