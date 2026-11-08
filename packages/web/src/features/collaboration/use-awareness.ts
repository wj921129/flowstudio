import { useEffect, useState, useRef, useCallback } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { AwarenessUserState, UserIdentity } from '@flowstudio/shared';

export interface UseAwarenessOptions {
  provider: HocuspocusProvider | null;
  currentUser: UserIdentity;
  selectedNodeIds: string[];
}

/**
 * 逐字段比对远端用户状态：本地 setLocalStateField 同样会触发 awareness change，
 * 若无条件写入新数组，CollaborationContext 的全部消费者都会随之重渲染
 */
function isSameRemoteUsers(a: AwarenessUserState[], b: AwarenessUserState[]): boolean {
  if (a.length !== b.length) return false;

  // 远端 awareness 载荷来自其他客户端，字段可能缺失，比对时统一按空集合处理
  const joinIds = (ids: string[] | undefined) => (ids ?? []).join(',');

  return a.every((item, index) => {
    const other = b[index];
    return (
      item.clientId === other.clientId &&
      item.nickname === other.nickname &&
      item.color === other.color &&
      item.cursor?.x === other.cursor?.x &&
      item.cursor?.y === other.cursor?.y &&
      joinIds(item.selectedNodeIds) === joinIds(other.selectedNodeIds)
    );
  });
}

export function useAwareness({ provider, currentUser, selectedNodeIds }: UseAwarenessOptions) {
  const [remoteUsers, setRemoteUsers] = useState<AwarenessUserState[]>([]);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);

  // 广播本地用户状态
  const broadcastLocalState = useCallback(
    (cursor: { x: number; y: number } | null) => {
      if (!provider || !provider.awareness) return;

      cursorRef.current = cursor;
      const localState: AwarenessUserState = {
        clientId: currentUser.clientId,
        nickname: currentUser.nickname,
        color: currentUser.color,
        cursor,
        selectedNodeIds,
      };

      provider.awareness.setLocalStateField('user', localState);
    },
    [provider, currentUser, selectedNodeIds]
  );

  // 监听选中节点与当前身份变化，自动同步 Awareness
  useEffect(() => {
    broadcastLocalState(cursorRef.current);
  }, [broadcastLocalState]);

  // 监听远端 awareness 变更
  useEffect(() => {
    if (!provider || !provider.awareness) return;

    const handleAwarenessChange = () => {
      const states = provider.awareness?.getStates();
      if (!states) return;

      const remotes: AwarenessUserState[] = [];
      states.forEach((state, clientID) => {
        // 排除自己
        if (clientID === provider.awareness?.clientID) return;

        const userState = state.user as AwarenessUserState | undefined;
        if (userState && userState.clientId && userState.nickname) {
          remotes.push(userState);
        }
      });

      setRemoteUsers((prev) => (isSameRemoteUsers(prev, remotes) ? prev : remotes));
    };

    provider.awareness.on('change', handleAwarenessChange);
    handleAwarenessChange();

    return () => {
      provider.awareness?.off('change', handleAwarenessChange);
    };
  }, [provider]);

  return {
    remoteUsers,
    broadcastCursor: broadcastLocalState,
  };
}
