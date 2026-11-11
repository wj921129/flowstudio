import React from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData, NodeHealth } from '@flowstudio/shared';
import { Boxes, Router, DatabaseZap, Zap, Ship, Container, type LucideIcon } from 'lucide-react';
import { BaseNodeWrapper } from './base-node-wrapper';

const ARCH_ICONS: Record<string, LucideIcon> = {
  'arch-microservice': Boxes,
  'arch-gateway': Router,
  'arch-db-shard': DatabaseZap,
  'arch-cache': Zap,
  'arch-k8s-pod': Ship,
  'arch-docker': Container,
};

const ARCH_ACCENTS: Record<string, string> = {
  'arch-microservice': '#6366f1',
  'arch-gateway': '#0ea5e9',
  'arch-db-shard': '#14b8a6',
  'arch-cache': '#f59e0b',
  'arch-k8s-pod': '#3b82f6',
  'arch-docker': '#0284c7',
};

const HEALTH_COLORS: Record<NodeHealth, string> = {
  ok: '#10b981',
  warn: '#f59e0b',
  error: '#f43f5e',
};

const ENV_COLORS: Record<string, string> = {
  prod: '#f43f5e',
  staging: '#f59e0b',
  dev: '#0ea5e9',
};

const ArchBadge: React.FC<{ text: string; color: string; className?: string }> = ({ text, color, className = '' }) => (
  <span
    className={`absolute z-20 px-1.5 py-px rounded-full text-[9px] font-bold leading-none text-white shadow-xs pointer-events-none ${className}`}
    style={{ backgroundColor: color }}
  >
    {text}
  </span>
);

export const ArchNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => {
  const kind = props.data.type;
  const Icon = ARCH_ICONS[kind] ?? Boxes;
  const accent = ARCH_ACCENTS[kind] ?? '#6366f1';
  const envTag = typeof props.data.envTag === 'string' ? props.data.envTag : '';
  const protocol = typeof props.data.protocol === 'string' ? props.data.protocol : '';
  const health: NodeHealth | undefined = props.data.health;
  return (
    <BaseNodeWrapper {...props} customContent className="!rounded-lg overflow-visible">
      <div className="w-full h-full flex flex-col items-center justify-center gap-1 px-2">
        <div
          className="w-9 h-9 rounded-md flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${accent}1f`, color: accent }}
        >
          <Icon size={20} strokeWidth={1.8} />
        </div>
        <span className="text-xs font-semibold text-[var(--fs-node-text)] text-center leading-tight line-clamp-2">
          {props.data.label}
        </span>
        {protocol ? (
          <span
            className="px-1.5 rounded text-[9px] font-mono leading-4 border pointer-events-none"
            style={{ color: accent, borderColor: `${accent}66`, backgroundColor: `${accent}14` }}
          >
            {protocol}
          </span>
        ) : null}
      </div>
      {health ? (
        <span
          className="absolute top-1.5 left-1.5 z-20 w-2 h-2 rounded-full ring-2 ring-white/70 pointer-events-none"
          style={{ backgroundColor: HEALTH_COLORS[health] ?? HEALTH_COLORS.ok }}
          title={health === 'ok' ? '健康' : health === 'warn' ? '警告' : '故障'}
        />
      ) : null}
      {envTag ? (
        <ArchBadge
          text={envTag}
          color={ENV_COLORS[envTag.toLowerCase()] ?? '#64748b'}
          className="top-1.5 right-1.5"
        />
      ) : null}
    </BaseNodeWrapper>
  );
};

export const ArchMicroserviceNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => <ArchNode {...props} />;
export const ArchGatewayNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => <ArchNode {...props} />;
export const ArchDbShardNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => <ArchNode {...props} />;
export const ArchCacheNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => <ArchNode {...props} />;
export const ArchK8sPodNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => <ArchNode {...props} />;
export const ArchDockerNode: React.FC<NodeProps<Node<FlowNodeData>>> = (props) => <ArchNode {...props} />;
