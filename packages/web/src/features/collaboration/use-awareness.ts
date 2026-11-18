import { useEffect, useRef, useCallback } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { UserIdentity } from '@flowstudio/shared';
import { useRemoteUsersStore, type AwarenessUserState } from './remote-users-store.js';

export type { AwarenessUserState };

export interface UseAwarenessOptions {
  provider: HocuspocusProvider | null;
  currentUser: UserIdentity;
  selectedNodeIds: string[];
  spotlightTargetId?: string | null;
  spotlightNodeIds?: string[];
}

export function useAwareness({
  provider,
  currentUser,
  selectedNodeIds,
  spotlightTargetId,
  spotlightNodeIds,
}: UseAwarenessOptions) {
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const viewportRef = useRef<{ x: number; y: number; zoom: number } | undefined>(undefined);
  const lastViewportBroadcastRef = useRef<number>(0);

  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  const selectedNodeIdsRef = useRef(selectedNodeIds);
  selectedNodeIdsRef.current = selectedNodeIds;

  const spotlightTargetIdRef = useRef(spotlightTargetId);
  spotlightTargetIdRef.current = spotlightTargetId;

  const spotlightNodeIdsRef = useRef(spotlightNodeIds);
  spotlightNodeIdsRef.current = spotlightNodeIds;

  const aiPlanningRef = useRef<{ isPlanning: boolean; prompt?: string } | undefined>(undefined);

  const providerRef = useRef(provider);
  providerRef.current = provider;

  const broadcastLocalState = useCallback(
    (cursor?: { x: number; y: number } | null, viewport?: { x: number; y: number; zoom: number }, aiPlanning?: { isPlanning: boolean; prompt?: string }) => {
      const p = providerRef.current;
      if (!p || !p.awareness) return;

      if (cursor !== undefined) cursorRef.current = cursor;
      if (viewport !== undefined) viewportRef.current = viewport;
      if (aiPlanning !== undefined) aiPlanningRef.current = aiPlanning;

      const curUser = currentUserRef.current;
      const localState: AwarenessUserState = {
        clientId: curUser.clientId,
        nickname: curUser.nickname,
        color: curUser.color,
        cursor: cursorRef.current,
        selectedNodeIds: selectedNodeIdsRef.current,
        viewport: viewportRef.current,
        spotlightTargetId: spotlightTargetIdRef.current,
        spotlightNodeIds: spotlightNodeIdsRef.current,
        aiPlanning: aiPlanningRef.current,
      };

      p.awareness.setLocalStateField('user', localState);
    },
    []
  );

  const broadcastCursor = useCallback(
    (cursor: { x: number; y: number } | null) => {
      broadcastLocalState(cursor, viewportRef.current);
    },
    [broadcastLocalState]
  );

  const broadcastViewport = useCallback(
    (viewport: { x: number; y: number; zoom: number }) => {
      const now = performance.now();
      // 50ms 节流，杜绝 pan/zoom 滚轮与拖动触发 awareness 风暴
      if (now - lastViewportBroadcastRef.current < 50) {
        viewportRef.current = viewport;
        return;
      }
      lastViewportBroadcastRef.current = now;
      broadcastLocalState(cursorRef.current, viewport);
    },
    [broadcastLocalState]
  );

  const broadcastAiPlanning = useCallback(
    (isPlanning: boolean, prompt?: string) => {
      broadcastLocalState(cursorRef.current, viewportRef.current, { isPlanning, prompt });
    },
    [broadcastLocalState]
  );

  // 监听选中节点、聚光灯与当前身份变化，自动同步 Awareness
  useEffect(() => {
    broadcastLocalState(cursorRef.current, viewportRef.current);
  }, [selectedNodeIds, currentUser, spotlightTargetId, spotlightNodeIds, broadcastLocalState]);

  // 监听远端 awareness 变更
  useEffect(() => {
    if (!provider || !provider.awareness) {
      useRemoteUsersStore.getState().reset();
      return;
    }

    const handleAwarenessChange = () => {
      const states = provider.awareness?.getStates();
      if (!states) return;

      const userMap = new Map<string, AwarenessUserState>();
      states.forEach((state, clientID) => {
        // 排除自己
        if (clientID === provider.awareness?.clientID) return;

        const userState = state.user as AwarenessUserState | undefined;
        if (userState && userState.clientId && userState.nickname) {
          const existing = userMap.get(userState.clientId);
          if (!existing || (!existing.cursor && userState.cursor)) {
            userMap.set(userState.clientId, userState);
          }
        }
      });

      useRemoteUsersStore.getState().setRemoteUsers(Array.from(userMap.values()));
    };

    provider.awareness.on('change', handleAwarenessChange);
    handleAwarenessChange();

    return () => {
      provider.awareness?.off('change', handleAwarenessChange);
      useRemoteUsersStore.getState().reset();
    };
  }, [provider]);

  return {
    broadcastCursor,
    broadcastViewport,
    broadcastAiPlanning,
  };
}
