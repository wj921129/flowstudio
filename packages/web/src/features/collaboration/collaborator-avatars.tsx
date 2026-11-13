import React, { useState, useMemo } from 'react';
import { useCollaboration } from './collaboration-provider.js';
import { NicknameModal } from './nickname-modal.js';
import { useFlowStore } from '../../stores/flow-store.js';

export const CollaboratorAvatars: React.FC = () => {
  const collab = useCollaboration();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const followingUserId = useFlowStore((s) => s.followingUserId);
  const setFollowingUser = useFlowStore((s) => s.setFollowingUser);

  const uniqueRemoteUsers = useMemo(() => {
    if (!collab?.remoteUsers) return [];
    const map = new Map<string, typeof collab.remoteUsers[0]>();
    for (const user of collab.remoteUsers) {
      if (user?.clientId && !map.has(user.clientId)) {
        map.set(user.clientId, user);
      }
    }
    return Array.from(map.values());
  }, [collab?.remoteUsers]);

  if (!collab) return null;

  const { currentUser, updateNickname, connectionStatus } = collab;

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

        {/* 远端用户头像（点击可开启/退出局域网带看跟随模式） */}
        {uniqueRemoteUsers.slice(0, 4).map((user) => {
          const isFollowing = followingUserId === user.clientId;
          const isPlanning = Boolean(user.aiPlanning?.isPlanning);
          return (
            <div key={user.clientId} className="relative inline-flex">
              <button
                type="button"
                onClick={() => setFollowingUser(isFollowing ? null : user.clientId)}
                title={
                  isPlanning
                    ? `${user.nickname} 正在调用 AI 规划中... (点击跟随视角)`
                    : isFollowing
                    ? `正在跟随 ${user.nickname} 的视角 (点击退出跟随)`
                    : `点击跟随 ${user.nickname} 的视角 (实时同步缩放与聚光灯链路)`
                }
                className={`relative inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-bold border-2 transition-transform hover:scale-110 hover:z-10 cursor-pointer shadow-xs ${
                  isFollowing
                    ? 'border-amber-400 ring-2 ring-amber-400/50 scale-110 z-10'
                    : isPlanning
                    ? 'border-purple-400 ring-2 ring-purple-400/60 animate-pulse z-10'
                    : 'border-white ring-1 ring-black/10'
                }`}
                style={{ backgroundColor: user.color }}
              >
                {user.nickname.slice(0, 1)}
              </button>
              {isPlanning && (
                <span
                  title={`${user.nickname} 正在使用 AI 规划中...`}
                  className="absolute -top-1 -right-1 flex h-3 w-3 pointer-events-none z-20"
                >
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-purple-600 text-[8px] text-white items-center justify-center font-bold">
                    ✨
                  </span>
                </span>
              )}
            </div>
          );
        })}

        {uniqueRemoteUsers.length > 4 && (
          <div
            className="relative inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium border-2 border-white ring-1 ring-black/10 shadow-xs"
            style={{
              backgroundColor: 'var(--fs-bg-surface, #e5e7eb)',
              color: 'var(--fs-text-secondary, #4b5563)',
            }}
          >
            +{uniqueRemoteUsers.length - 4}
          </div>
        )}
      </div>

      {/* 跟随状态提示与快捷退出 */}
      {followingUserId && (
        <button
          type="button"
          onClick={() => setFollowingUser(null)}
          title="点击退出视角跟随模式"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-[10px] font-medium hover:bg-amber-500/25 transition-colors cursor-pointer"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          <span>正在跟随</span>
          <span className="font-bold ml-0.5">×</span>
        </button>
      )}

      <NicknameModal
        isOpen={isEditModalOpen}
        currentUser={currentUser}
        onSave={updateNickname}
        onClose={() => setIsEditModalOpen(false)}
      />
    </div>
  );
};
