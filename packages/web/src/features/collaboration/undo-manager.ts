import * as Y from 'yjs';

export interface UndoStatus {
  canUndo: boolean;
  canRedo: boolean;
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

    this.undoManager = new Y.UndoManager([nodesMap, edgesMap], {
      trackedOrigins: new Set([localClientId]),
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
