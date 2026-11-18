import { create } from 'zustand';
import type { AwarenessUserState as SharedAwarenessUserState } from '@flowstudio/shared';

export type AwarenessUserState = SharedAwarenessUserState & {
  spotlightTargetId?: string | null;
  spotlightNodeIds?: string[];
};

export interface RemoteNodeSelector {
  clientId: string;
  nickname: string;
  color: string;
}

export function isSameRemoteUsers(a: AwarenessUserState[], b: AwarenessUserState[]): boolean {
  if (a.length !== b.length) return false;
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

function buildSelectedByNodeId(
  users: AwarenessUserState[],
  prevMap: Map<string, RemoteNodeSelector>
): Map<string, RemoteNodeSelector> {
  const nextMap = new Map<string, RemoteNodeSelector>();
  let sameAsPrev = true;

  for (const user of users) {
    if (!user.selectedNodeIds?.length) continue;
    for (const nodeId of user.selectedNodeIds) {
      if (nextMap.has(nodeId)) continue;
      const prevEntry = prevMap.get(nodeId);
      if (
        prevEntry &&
        prevEntry.clientId === user.clientId &&
        prevEntry.nickname === user.nickname &&
        prevEntry.color === user.color
      ) {
        nextMap.set(nodeId, prevEntry);
      } else {
        sameAsPrev = false;
        nextMap.set(nodeId, {
          clientId: user.clientId,
          nickname: user.nickname,
          color: user.color,
        });
      }
    }
  }

  if (sameAsPrev && nextMap.size === prevMap.size) {
    return prevMap;
  }
  return nextMap;
}

interface RemoteUsersStoreState {
  remoteUsers: AwarenessUserState[];
  selectedByNodeId: Map<string, RemoteNodeSelector>;
  setRemoteUsers: (users: AwarenessUserState[]) => void;
  reset: () => void;
}

const EMPTY_SELECTED_MAP = new Map<string, RemoteNodeSelector>();

export const useRemoteUsersStore = create<RemoteUsersStoreState>((set) => ({
  remoteUsers: [],
  selectedByNodeId: EMPTY_SELECTED_MAP,
  setRemoteUsers: (users) =>
    set((s) => {
      if (isSameRemoteUsers(s.remoteUsers, users)) return s;
      return {
        remoteUsers: users,
        selectedByNodeId: buildSelectedByNodeId(users, s.selectedByNodeId),
      };
    }),
  reset: () =>
    set((s) =>
      s.remoteUsers.length === 0 && s.selectedByNodeId.size === 0
        ? s
        : { remoteUsers: [], selectedByNodeId: new Map() }
    ),
}));

export function useRemoteUsers(): AwarenessUserState[] {
  return useRemoteUsersStore((s) => s.remoteUsers);
}

export function useRemoteNodeSelector(nodeId: string): RemoteNodeSelector | undefined {
  return useRemoteUsersStore((s) => s.selectedByNodeId.get(nodeId));
}
