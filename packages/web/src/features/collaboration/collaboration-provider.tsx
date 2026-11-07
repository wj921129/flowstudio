import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { AwarenessUserState, UserIdentity } from '@flowstudio/shared';
import type { CollaborationConnectionStatus } from './types.js';
import { YjsDiagramBridge } from './yjs-doc-bridge.js';
import { CollaborativeUndoManager } from './undo-manager.js';
import { getOrCreateUserIdentity, saveUserNickname } from './user-identity.js';
import { useAwareness } from './use-awareness.js';
import { NicknameModal } from './nickname-modal.js';
import { useFlowStore } from '../../stores/flow-store.js';

export interface CollaborationContextValue {
  provider: HocuspocusProvider | null;
  doc: Y.Doc;
  bridge: YjsDiagramBridge;
  undoManager: CollaborativeUndoManager;
  connectionStatus: CollaborationConnectionStatus;
  isSynced: boolean;
  remoteUsers: AwarenessUserState[];
  currentUser: UserIdentity;
  updateNickname: (name: string) => void;
  broadcastCursor: (cursor: { x: number; y: number } | null) => void;
}

const CollaborationContext = createContext<CollaborationContextValue | null>(null);

export interface CollaborationProviderProps {
  diagramId: string;
  wsUrl?: string;
  children: React.ReactNode;
}

export const CollaborationProvider: React.FC<CollaborationProviderProps> = ({
  diagramId,
  wsUrl,
  children,
}) => {
  const [currentUser, setCurrentUser] = useState<UserIdentity>(() => getOrCreateUserIdentity());
  const [isNicknameModalOpen, setIsNicknameModalOpen] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<CollaborationConnectionStatus>('connecting');
  const [isSynced, setIsSynced] = useState(false);

  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);

  // 初始化 Y.Doc 与桥接管理器
  const { doc, bridge, undoManager } = useMemo(() => {
    const d = new Y.Doc();
    const b = new YjsDiagramBridge(d, { localClientId: currentUser.clientId });
    const u = new CollaborativeUndoManager(d, currentUser.clientId);
    return { doc: d, bridge: b, undoManager: u };
  }, [currentUser.clientId]);

  // 绑定至 zustand flow-store
  useEffect(() => {
    const unbind = useFlowStore.getState().bindCollaboration(bridge, undoManager);
    return () => {
      unbind();
    };
  }, [bridge, undoManager]);

  // 构建 HocuspocusProvider
  const provider = useMemo(() => {
    const url =
      wsUrl ||
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/collaboration`;

    const p = new HocuspocusProvider({
      url,
      name: diagramId,
      document: doc,
    });

    return p;
  }, [diagramId, wsUrl, doc]);

  // 监听连接状态与同步事件
  useEffect(() => {
    const handleStatus = ({ status }: { status: string }) => {
      if (status === 'connected') setConnectionStatus('connected');
      else if (status === 'connecting') setConnectionStatus('connecting');
      else setConnectionStatus('disconnected');
    };

    const handleSynced = ({ state }: { state: boolean }) => {
      setIsSynced(state);
    };

    provider.on('status', handleStatus);
    provider.on('synced', handleSynced);

    return () => {
      provider.off('status', handleStatus);
      provider.off('synced', handleSynced);
      provider.destroy();
    };
  }, [provider]);

  // 首次访问自动弹窗提醒
  useEffect(() => {
    if (currentUser.isFirstVisit) {
      setIsNicknameModalOpen(true);
    }
  }, [currentUser.isFirstVisit]);

  // 协同感知 Hook
  const { remoteUsers, broadcastCursor } = useAwareness({
    provider,
    currentUser,
    selectedNodeIds,
  });

  const handleUpdateNickname = (name: string) => {
    const updated = saveUserNickname(name);
    setCurrentUser(updated);
  };

  const contextValue = useMemo<CollaborationContextValue>(
    () => ({
      provider,
      doc,
      bridge,
      undoManager,
      connectionStatus,
      isSynced,
      remoteUsers,
      currentUser,
      updateNickname: handleUpdateNickname,
      broadcastCursor,
    }),
    [
      provider,
      doc,
      bridge,
      undoManager,
      connectionStatus,
      isSynced,
      remoteUsers,
      currentUser,
      broadcastCursor,
    ]
  );

  return (
    <CollaborationContext.Provider value={contextValue}>
      {children}
      <NicknameModal
        isOpen={isNicknameModalOpen}
        currentUser={currentUser}
        onSave={handleUpdateNickname}
        onClose={() => setIsNicknameModalOpen(false)}
      />
    </CollaborationContext.Provider>
  );
};

export function useCollaboration(): CollaborationContextValue | null {
  return useContext(CollaborationContext);
}
