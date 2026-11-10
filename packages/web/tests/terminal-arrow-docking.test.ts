import { describe, it, expect } from 'vitest';
import { Position } from '@xyflow/react';
import {
  TERMINAL_ARROW_DOCKING_GAP,
  getDockingEndpoint,
  calcStepOffset,
} from '../src/features/canvas/custom-edges/orthogonal-edge.js';

describe('terminal-arrow-docking: Edge Arrow Terminal Docking and Spacing', () => {
  describe('getDockingEndpoint: 法线方向回缩计算', () => {
    it('Position.Top: 沿 Y 轴向上回缩 offset，使箭头停靠在顶部边框外沿', () => {
      const endpoint = getDockingEndpoint(100, 200, Position.Top);
      expect(endpoint).toEqual({ x: 100, y: 200 - TERMINAL_ARROW_DOCKING_GAP });
      expect(endpoint.y).toBe(197.5);

      // 支持字符串 'top'
      const strEndpoint = getDockingEndpoint(100, 200, 'top', 3);
      expect(strEndpoint).toEqual({ x: 100, y: 197 });
    });

    it('Position.Bottom: 沿 Y 轴向下回缩 offset，使箭头停靠在底部边框外沿', () => {
      const endpoint = getDockingEndpoint(100, 200, Position.Bottom);
      expect(endpoint).toEqual({ x: 100, y: 200 + TERMINAL_ARROW_DOCKING_GAP });
      expect(endpoint.y).toBe(202.5);

      const strEndpoint = getDockingEndpoint(100, 200, 'bottom', 3);
      expect(strEndpoint).toEqual({ x: 100, y: 203 });
    });

    it('Position.Left: 沿 X 轴向左回缩 offset，使箭头停靠在左侧边框外沿', () => {
      const endpoint = getDockingEndpoint(150, 80, Position.Left);
      expect(endpoint).toEqual({ x: 150 - TERMINAL_ARROW_DOCKING_GAP, y: 80 });
      expect(endpoint.x).toBe(147.5);

      const strEndpoint = getDockingEndpoint(150, 80, 'left', 4);
      expect(strEndpoint).toEqual({ x: 146, y: 80 });
    });

    it('Position.Right: 沿 X 轴向右回缩 offset，使箭头停靠在右侧边框外沿', () => {
      const endpoint = getDockingEndpoint(300, 80, Position.Right);
      expect(endpoint).toEqual({ x: 300 + TERMINAL_ARROW_DOCKING_GAP, y: 80 });
      expect(endpoint.x).toBe(302.5);

      const strEndpoint = getDockingEndpoint(300, 80, 'right', 4);
      expect(strEndpoint).toEqual({ x: 304, y: 80 });
    });

    it('undefined 或无效 position 保持原点不变', () => {
      expect(getDockingEndpoint(100, 100, undefined)).toEqual({ x: 100, y: 100 });
      expect(getDockingEndpoint(100, 100, 'unknown' as any)).toEqual({ x: 100, y: 100 });
    });
  });

  describe('calcStepOffset: 近距离正交步长自适应计算', () => {
    it('垂直走线距离 >= 40px 时使用标准 offset: 20', () => {
      const offset = calcStepOffset(100, 50, Position.Bottom, 100, 150, Position.Top);
      expect(offset).toBe(20);
    });

    it('垂直走线距离 < 40px 时自适应动态步长，杜绝回折穿透', () => {
      // 距离 30px -> floor(30 / 2) = 15
      const offset30 = calcStepOffset(100, 50, Position.Bottom, 100, 80, Position.Top);
      expect(offset30).toBe(15);

      // 距离 16px -> floor(16 / 2) = 8
      const offset16 = calcStepOffset(100, 50, Position.Bottom, 100, 66, Position.Top);
      expect(offset16).toBe(8);

      // 距离极近 6px -> Math.max(4, 3) = 4 保底
      const offset6 = calcStepOffset(100, 50, Position.Bottom, 100, 56, Position.Top);
      expect(offset6).toBe(4);
    });

    it('水平走线距离 < 40px 时同样自适应半程步长', () => {
      // 距离 24px -> 12
      const offset24 = calcStepOffset(50, 100, Position.Right, 74, 100, Position.Left);
      expect(offset24).toBe(12);
    });

    it('重叠或距离 0 时平稳返回默认值 20', () => {
      const offset0 = calcStepOffset(100, 100, Position.Bottom, 100, 100, Position.Top);
      expect(offset0).toBe(20);
    });
  });

  describe('几何形态一致性保证', () => {
    it('TERMINAL_ARROW_DOCKING_GAP 处于边框 (1.5px) 与选中环 (2px) 外围的黄金自然区间', () => {
      // 保证大于边框厚度 1.5px，杜绝尖端被遮挡
      expect(TERMINAL_ARROW_DOCKING_GAP).toBeGreaterThan(1.5);
      // 保证小于 4px，避免肉眼可察觉的断连悬空感
      expect(TERMINAL_ARROW_DOCKING_GAP).toBeLessThanOrEqual(3.0);
    });
  });
});
