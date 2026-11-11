import type { XYPosition } from '@flowstudio/shared';

export interface CommentReaction {
  emoji: string;
  userId: string;
  nickname: string;
}

export interface CommentReply {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  content: string;
  createdAt: number;
  reactions?: CommentReaction[];
}

export type CommentTargetType = 'node' | 'edge' | 'canvas';

export interface CanvasComment {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  content: string;
  createdAt: number;
  resolved: boolean;
  resolvedAt?: number;
  resolvedBy?: string;
  targetType: CommentTargetType;
  targetId?: string;
  targetLabel?: string;
  position: XYPosition;
  targetDetached?: boolean;
  replies: CommentReply[];
  reactions: CommentReaction[];
}

export type ReviewFilterMode = 'all' | 'unresolved_only';
