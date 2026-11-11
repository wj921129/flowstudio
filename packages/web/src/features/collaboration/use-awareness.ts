import { useEffect, useState, useRef, useCallback } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { AwarenessUserState as SharedAwarenessUserState, UserIdentity } from '@flowstudio/shared';

export type AwarenessUserState = SharedAwarenessUserState & {
  spotlightTargetId?: string | null;
  spotlightNodeIds?: string[];
};

export interface UseAwarenessOptions {
  provider: HocuspocusProvider | null;
  currentUser: UserIdentity;
  selectedNodeIds: string[];
  spotlightTargetId?: string | null;
  spotlightNodeIds?: string[];
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
      item.viewport?.x === other.viewport?.x &&
      item.viewport?.y === other.viewport?.y &&
      item.viewport?.zoom === other.viewport?.zoom &&
      joinIds(item.selectedNodeIds) === joinIds(other.selectedNodeIds) &&
      item.spotlightTargetId === other.spotlightTargetId &&
      joinIds(item.spotlightNodeIds) === joinIds(other.spotlightNodeIds) &&
      item.isAi === other.isAi &&
      item.agentName === other.agentName &&
      item.aiPlanning?.isPlanning === other.aiPlanning?.isPlanning &&
      item.aiPlanning?.prompt === other.aiPlanning?.prompt
    );
  });
}

export function useAwareness({
  provider,
  currentUser,
  selectedNodeIds,
  spotlightTargetId,
  spotlightNodeIds,
}: UseAwarenessOptions) {
  const [remoteUsers, setRemoteUsers] = useState<AwarenessUserState[]>([]);
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
    broadcastCursor,
    broadcastViewport,
    broadcastAiPlanning,
  };
}
