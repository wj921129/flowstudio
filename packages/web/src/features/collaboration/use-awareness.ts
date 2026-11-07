import { useEffect, useState, useRef, useCallback } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { AwarenessUserState, UserIdentity } from '@flowstudio/shared';

export interface UseAwarenessOptions {
  provider: HocuspocusProvider | null;
  currentUser: UserIdentity;
  selectedNodeIds: string[];
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

      setRemoteUsers(remotes);
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
