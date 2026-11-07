import type { UserIdentity } from '@flowstudio/shared';
import { COLLABORATOR_COLORS } from '@flowstudio/shared';

const STORAGE_KEY = 'fs-user-identity';

/**
 * 获取或生成当前浏览器客户端的免登身份（保存在 localStorage）
 */
export function getOrCreateUserIdentity(): UserIdentity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as UserIdentity;
      if (parsed.clientId && parsed.nickname && parsed.color) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('[UserIdentity] 读取身份缓存失败，生成新身份', err);
  }

  // 随机分配颜色与默认昵称
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  const colorIndex = Math.floor(Math.random() * COLLABORATOR_COLORS.length);
  const color = COLLABORATOR_COLORS[colorIndex];

  const identity: UserIdentity = {
    clientId: `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    nickname: `协作者${randomSuffix}`,
    color,
    isFirstVisit: true,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch (err) {
    console.warn('[UserIdentity] 写入身份缓存失败', err);
  }

  return identity;
}

/**
 * 更新并持久化用户自定义昵称，同时清除首次访问标记
 */
export function saveUserNickname(nickname: string): UserIdentity {
  const current = getOrCreateUserIdentity();
  const updated: UserIdentity = {
    ...current,
    nickname: nickname.trim() || current.nickname,
    isFirstVisit: false,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn('[UserIdentity] 更新昵称缓存失败', err);
  }

  return updated;
}

/**
 * 画布世界坐标 (Flow Position) 映射为视口像素坐标 (Viewport Pixel Position)
 */
export function worldToViewportPixel(
  point: { x: number; y: number },
  viewport: { x: number; y: number; zoom: number },
): { x: number; y: number } {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
}
