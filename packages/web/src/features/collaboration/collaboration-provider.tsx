import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import type { UserIdentity } from '@flowstudio/shared';
import type { CollaborationConnectionStatus } from './types.js';
import { YjsDiagramBridge } from './yjs-doc-bridge.js';
import { CollaborativeUndoManager } from './undo-manager.js';
import { getOrCreateUserIdentity, saveUserNickname } from './user-identity.js';
import { useAwareness, type AwarenessUserState } from './use-awareness.js';
import { NicknameModal } from './nickname-modal.js';
import { useFlowStore } from '../../stores/flow-store.js';
import { useSidebarStore } from '../sidebar/sidebar-store.js';
import { bindCommentsYjs, useCommentsStore } from '../comments/index.js';

export interface CollaborationContextValue {
  diagramId: string;
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
  broadcastViewport?: (viewport: { x: number; y: number; zoom: number }) => void;
  broadcastAiPlanning?: (isPlanning: boolean, prompt?: string) => void;
}

interface CollaborationSession {
  doc: Y.Doc;
  bridge: YjsDiagramBridge;
  undoManager: CollaborativeUndoManager;
  provider: HocuspocusProvider;
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
  const [session, setSession] = useState<CollaborationSession | null>(null);

  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);
  const spotlightActive = useFlowStore((s) => s.spotlightActive);
  const spotlightTargetId = useFlowStore((s) => s.spotlightTargetId);

  // 初始化协同会话：在统一的 useEffect 中创建与销毁，彻底杜绝 React 19 StrictMode 下 useMemo 持有已销毁 dead 实例的回归问题
  useEffect(() => {
    setIsSynced(false);
    setConnectionStatus('connecting');

    const d = new Y.Doc();
    const b = new YjsDiagramBridge(d, { localClientId: currentUser.clientId });
    const u = new CollaborativeUndoManager(d, currentUser.clientId);

    const url =
      wsUrl ||
      `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/collaboration`;

    const p = new HocuspocusProvider({
      url,
      name: diagramId,
      document: d,
    });

    const handleStatus = ({ status }: { status: string }) => {
      if (status === 'connected') setConnectionStatus('connected');
      else if (status === 'connecting') setConnectionStatus('connecting');
      else setConnectionStatus('disconnected');
    };

    const handleSynced = ({ state }: { state: boolean }) => {
      setIsSynced(state);
    };

    p.on('status', handleStatus);
    p.on('synced', handleSynced);

    const unbindStore = useFlowStore.getState().bindCollaboration(b, u);
    const unbindComments = bindCommentsYjs(d, currentUser.clientId);
    const unbindTheme = b.subscribe((state) => {
      if (state.themeId) {
        useSidebarStore.getState().setActiveThemeId(state.themeId);
      }
    });

    setSession({ doc: d, bridge: b, undoManager: u, provider: p });

    return () => {
      p.off('status', handleStatus);
      p.off('synced', handleSynced);
      unbindStore();
      unbindComments();
      unbindTheme();
      p.destroy();
      b.destroy();
      d.destroy();
      u.destroy();
      useFlowStore.getState().resetDiagramState();
      useCommentsStore.getState().reset();
      setSession(null);
    };
  }, [diagramId, wsUrl, currentUser.clientId]);

  // 首次访问自动弹窗提醒
  useEffect(() => {
    if (currentUser.isFirstVisit) {
      setIsNicknameModalOpen(true);
    }
  }, [currentUser.isFirstVisit]);

  // 协同感知 Hook
  const { remoteUsers, broadcastCursor, broadcastViewport, broadcastAiPlanning } = useAwareness({
    provider: session?.provider ?? null,
    currentUser,
    selectedNodeIds,
    spotlightTargetId: spotlightActive ? spotlightTargetId : null,
  });

  const handleUpdateNickname = useCallback((name: string) => {
    const updated = saveUserNickname(name);
    setCurrentUser(updated);
  }, []);

  const contextValue = useMemo<CollaborationContextValue | null>(() => {
    if (!session) return null;
    return {
      diagramId,
      provider: session.provider,
      doc: session.doc,
      bridge: session.bridge,
      undoManager: session.undoManager,
      connectionStatus,
      isSynced,
      remoteUsers,
      currentUser,
      updateNickname: handleUpdateNickname,
      broadcastCursor,
      broadcastViewport,
      broadcastAiPlanning,
    };
  }, [
    session,
    diagramId,
    connectionStatus,
    isSynced,
    remoteUsers,
    currentUser,
    handleUpdateNickname,
    broadcastCursor,
    broadcastViewport,
    broadcastAiPlanning,
  ]);

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
