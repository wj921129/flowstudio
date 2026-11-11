import * as Y from 'yjs';
import type { CanvasComment } from './types';
import { useCommentsStore } from './comments-store';

export function bindCommentsYjs(
  doc: Y.Doc,
  localClientId: string
): () => void {
  const store = useCommentsStore.getState();
  const commentsMap = doc.getMap<Y.Map<unknown>>('comments');

  const readAllComments = (): CanvasComment[] => {
    const list: CanvasComment[] = [];
    commentsMap.forEach((subMap, key) => {
      try {
        const raw = subMap.toJSON();
        if (raw && raw.id) list.push(raw as CanvasComment);
      } catch {
        // ignore malformed
      }
    });
    list.sort((a, b) => a.createdAt - b.createdAt);
    return list;
  };

  const initial = readAllComments();
  if (initial.length > 0) {
    store.syncFromYjs(initial);
  }

  const handleYjsChange = (events: Y.YEvent<any>[], transaction: Y.Transaction) => {
    const isRemote = transaction.origin !== localClientId;
    const currentList = readAllComments();

    if (isRemote) {
      for (const event of events) {
        if (event instanceof Y.YMapEvent) {
          event.changes.keys.forEach((change, key) => {
            if (change.action === 'add') {
              const added = currentList.find((c) => c.id === key);
              if (added && added.authorId !== localClientId) {
                store.setUnreadNotification({
                  commentId: added.id,
                  authorName: added.authorName,
                  text: added.content,
                  position: added.position,
                });
              }
            }
          });
        }
      }
    }

    store.syncFromYjs(currentList);
  };

  commentsMap.observeDeep(handleYjsChange);

  store.setYjsSyncCallback((op, payload) => {
    doc.transact(() => {
      if (op === 'set_comment') {
        const c = payload as CanvasComment;
        let sub = commentsMap.get(c.id);
        if (!sub) {
          sub = new Y.Map<unknown>();
          commentsMap.set(c.id, sub);
        }
        Object.entries(c).forEach(([k, v]) => {
          sub!.set(k, v);
        });
      } else if (op === 'delete_comment') {
        commentsMap.delete(payload.id);
      }
    }, localClientId);
  });

  return () => {
    commentsMap.unobserveDeep(handleYjsChange);
    store.setYjsSyncCallback(null);
  };
}
