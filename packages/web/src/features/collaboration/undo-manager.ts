import * as Y from 'yjs';

export interface UndoStatus {
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * 自定义 trackedOrigins 集合：
 * 不仅匹配精确 localClientId，还将前缀匹配 'snapshot-restore:' 的事务 origin 纳入撤销栈捕获范围，
 * 满足 PRD Top 1 要求：服务端差量快照恢复可协同撤销
 */
export class TrackedOriginsSet extends Set<any> {
  override has(origin: any): boolean {
    if (super.has(origin)) return true;
    if (typeof origin === 'string') {
      if (origin.startsWith('snapshot-restore:') || origin === 'snapshot-restore') {
        return true;
      }
    }
    return false;
  }
}

export class CollaborativeUndoManager {
  private undoManager: Y.UndoManager;
  private listeners: Set<(status: UndoStatus) => void> = new Set();
  private unbindHandlers: Array<() => void> = [];

  constructor(
    doc: Y.Doc,
    localClientId: string,
    captureTimeout: number = 500,
  ) {
    const nodesMap = doc.getMap('nodes');
    const edgesMap = doc.getMap('edges');

    const trackedOrigins = new TrackedOriginsSet([localClientId]);

    this.undoManager = new Y.UndoManager([nodesMap, edgesMap], {
      trackedOrigins,
      captureTimeout,
    });

    const notify = () => {
      const status: UndoStatus = {
        canUndo: this.canUndo(),
        canRedo: this.canRedo(),
      };
      for (const listener of this.listeners) {
        listener(status);
      }
    };

    const onStackItemAdded = () => notify();
    const onStackItemPopped = () => notify();
    const onStackCleared = () => notify();

    this.undoManager.on('stack-item-added', onStackItemAdded);
    this.undoManager.on('stack-item-popped', onStackItemPopped);
    this.undoManager.on('stack-cleared', onStackCleared);

    this.unbindHandlers.push(() => {
      this.undoManager.off('stack-item-added', onStackItemAdded);
      this.undoManager.off('stack-item-popped', onStackItemPopped);
      this.undoManager.off('stack-cleared', onStackCleared);
    });
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  undo(): void {
    if (this.canUndo()) {
      this.undoManager.undo();
    }
  }

  redo(): void {
    if (this.canRedo()) {
      this.undoManager.redo();
    }
  }

  stopCapturing(): void {
    this.undoManager.stopCapturing();
  }

  clear(): void {
    this.undoManager.clear();
  }

  addTrackedOrigin(origin: any): void {
    this.undoManager.trackedOrigins.add(origin);
  }

  removeTrackedOrigin(origin: any): void {
    this.undoManager.trackedOrigins.delete(origin);
  }

  subscribe(listener: (status: UndoStatus) => void): () => void {
    this.listeners.add(listener);
    // 立即广播当前状态
    listener({
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  destroy(): void {
    for (const unbind of this.unbindHandlers) {
      unbind();
    }
    this.unbindHandlers = [];
    this.listeners.clear();
    this.undoManager.destroy();
  }
}
