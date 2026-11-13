import type { DiagramSpec } from './types.js';

export interface DiagramPreset {
  id: string;
  title: string;
  category: 'flowchart' | 'swimlane' | 'topology' | 'org-chart';
  description: string;
  spec: DiagramSpec;
}

export const DIAGRAM_PRESETS: DiagramPreset[] = [
  {
    id: 'flowchart-approval',
    title: '请假审批标准业务流',
    category: 'flowchart',
    description: '涵盖发起申请、主管审批、条件分支判定及人事复核的标准流程',
    spec: {
      paradigm: 'vertical-flow',
      nodes: [
        { id: 'start-1', label: '发起请假申请', type: 'start-end' },
        { id: 'proc-1', label: '填写假期与交接人' },
        { id: 'dec-1', label: '主管审批？', type: 'decision' },
        { id: 'proc-2', label: '人事复核与考勤登记' },
        { id: 'proc-reject', label: '退回修改并通知' },
        { id: 'end-1', label: '流程归档结束', type: 'start-end' },
        { id: 'note-1', label: '主管审批通过后进入人事复核与考勤登记', type: 'comment', attachTo: 'dec-1' },
      ],
      edges: [
        { from: 'start-1', to: 'proc-1' },
        { from: 'proc-1', to: 'dec-1' },
        { from: 'dec-1', to: 'proc-2', label: '同意' },
        { from: 'dec-1', to: 'proc-reject', kind: 'branch', label: '驳回' },
        { from: 'proc-reject', to: 'proc-1', kind: 'loop' },
        { from: 'proc-2', to: 'end-1' },
        { from: 'dec-1', to: 'note-1', kind: 'annotate' },
      ],
    },
  },
  {
    id: 'flowchart-retry-compensation',
    title: '任务重试与补偿控制流',
    category: 'flowchart',
    description: '异步任务调度、失败自旋重试限制与降级告警补偿体系',
    spec: {
      paradigm: 'vertical-flow',
      nodes: [
        { id: 'start-2', label: '接收调度指令', type: 'start-end' },
        { id: 'proc-task', label: '执行核心远程调用' },
        { id: 'dec-status', label: '调用成功？', type: 'decision' },
        { id: 'dec-retry', label: '重试 < 3次？', type: 'decision' },
        { id: 'proc-alarm', label: '熔断降级与报警通知' },
        { id: 'end-success', label: '任务成功提交', type: 'start-end' },
        { id: 'note-2', label: '调用失败按指数退避重试至多3次，超限即熔断降级并报警补偿', type: 'comment', attachTo: 'dec-status' },
      ],
      edges: [
        { from: 'start-2', to: 'proc-task' },
        { from: 'proc-task', to: 'dec-status' },
        { from: 'dec-status', to: 'end-success', label: '是' },
        { from: 'dec-status', to: 'dec-retry', kind: 'branch', label: '否' },
        { from: 'dec-retry', to: 'proc-task', kind: 'loop', label: '指数退避' },
        { from: 'dec-retry', to: 'proc-alarm', label: '超限' },
        { from: 'dec-status', to: 'note-2', kind: 'annotate' },
      ],
    },
  },
  {
    id: 'swimlane-cross-department',
    title: '跨部门业务协同泳道图',
    category: 'swimlane',
    description: '涵盖业务部门、技术团队与运营中心的多方职责流转与协同闭环',
    spec: {
      paradigm: 'swimlane',
      lanes: [
        { id: 'lane-biz', label: '业务部门' },
        { id: 'lane-tech', label: '技术团队' },
        { id: 'lane-ops', label: '运营中心' },
      ],
      nodes: [
        { id: 'node-b1', label: '提出业务需求', type: 'start-end', laneId: 'lane-biz' },
        { id: 'node-t1', label: '架构评估与实现', laneId: 'lane-tech' },
        { id: 'node-o1', label: '联调演练与部署上线', laneId: 'lane-ops' },
        { id: 'node-b2', label: '验收上线成效', type: 'start-end', laneId: 'lane-biz' },
      ],
      edges: [
        { from: 'node-b1', to: 'node-t1' },
        { from: 'node-t1', to: 'node-o1' },
        { from: 'node-o1', to: 'node-b2' },
      ],
    },
  },
  {
    id: 'swimlane-dev-pipeline',
    title: '敏捷研发发布标准流水线',
    category: 'swimlane',
    description: '标准 DevSecOps 流程：需求规划、代码联调、自动化测试与灰度发布',
    spec: {
      paradigm: 'swimlane',
      lanes: [
        { id: 'lane-dev', label: '开发与构建' },
        { id: 'lane-qa', label: '质量保障' },
      ],
      nodes: [
        { id: 'dev-1', label: '特性分支开发', type: 'start-end', laneId: 'lane-dev' },
        { id: 'dev-2', label: 'CI 代码静态门禁', laneId: 'lane-dev' },
        { id: 'qa-1', label: '自动化用例通过？', type: 'decision', laneId: 'lane-qa' },
        { id: 'qa-2', label: '生产环境发布', type: 'start-end', laneId: 'lane-qa' },
      ],
      edges: [
        { from: 'dev-1', to: 'dev-2' },
        { from: 'dev-2', to: 'qa-1' },
        { from: 'qa-1', to: 'qa-2', label: '通过' },
        { from: 'qa-1', to: 'dev-1', kind: 'loop', label: '不通过' },
      ],
    },
  },
  {
    id: 'topology-three-tier',
    title: '经典三层应用拓扑',
    category: 'topology',
    description: '客户端、网关、应用集群与数据层的标准三层部署拓扑',
    spec: {
      paradigm: 'tiered-dag',
      nodes: [
        { id: 'node-client', label: 'Web / App 客户端', type: 'io' },
        { id: 'node-lb', label: '反向代理 / Nginx 网关' },
        { id: 'node-app1', label: '应用节点 A (Node/Go)', type: 'subprocess' },
        { id: 'node-app2', label: '应用节点 B (Node/Go)', type: 'subprocess' },
        { id: 'node-redis', label: 'Redis 高性能缓存', type: 'database' },
        { id: 'node-db', label: 'PostgreSQL 主从集群', type: 'database' },
      ],
      edges: [
        { from: 'node-client', to: 'node-lb' },
        { from: 'node-lb', to: 'node-app1' },
        { from: 'node-lb', to: 'node-app2' },
        { from: 'node-app1', to: 'node-redis' },
        { from: 'node-app2', to: 'node-db' },
      ],
    },
  },
  {
    id: 'topology-cloud-native',
    title: '云原生高可用服务集群',
    category: 'topology',
    description: 'API 网关统一鉴权、服务网格通信、消息队列削峰解耦架构',
    spec: {
      paradigm: 'tiered-dag',
      nodes: [
        { id: 'cloud-gw', label: 'API 网关 / 统一鉴权' },
        { id: 'srv-order', label: '订单服务 (Service)', type: 'subprocess' },
        { id: 'srv-user', label: '用户服务 (Service)', type: 'subprocess' },
        { id: 'mq-kafka', label: 'Kafka 消息总线', type: 'io' },
        { id: 'srv-notify', label: '消息通知与审计消费者' },
      ],
      edges: [
        { from: 'cloud-gw', to: 'srv-order' },
        { from: 'cloud-gw', to: 'srv-user' },
        { from: 'srv-order', to: 'mq-kafka' },
        { from: 'mq-kafka', to: 'srv-notify' },
      ],
    },
  },
  {
    id: 'org-management-hierarchy',
    title: '企业管理层汇报阵型',
    category: 'org-chart',
    description: '总经理统辖产研、营销与运营三条线的标准汇报层级',
    spec: {
      paradigm: 'tree',
      nodes: [
        { id: 'org-ceo', label: '总经理 / CEO' },
        { id: 'org-cto', label: '产研副总 (CTO/CPO)' },
        { id: 'org-cmo', label: '营销副总 (CMO)' },
        { id: 'org-coo', label: '运营总监 (COO)' },
        { id: 'org-team-dev', label: '核心技术研发中心', type: 'subprocess' },
        { id: 'org-team-market', label: '品牌与商务拓展部', type: 'subprocess' },
        { id: 'org-team-ops', label: '客户成功与运营支持', type: 'subprocess' },
      ],
      edges: [
        { from: 'org-ceo', to: 'org-cto', kind: 'tree' },
        { from: 'org-ceo', to: 'org-cmo', kind: 'tree' },
        { from: 'org-ceo', to: 'org-coo', kind: 'tree' },
        { from: 'org-cto', to: 'org-team-dev', kind: 'tree' },
        { from: 'org-cmo', to: 'org-team-market', kind: 'tree' },
        { from: 'org-coo', to: 'org-team-ops', kind: 'tree' },
      ],
    },
  },
  {
    id: 'org-agile-squad',
    title: '敏捷产研跨职能团队阵型',
    category: 'org-chart',
    description: '以产品负责人 (PO) 与敏捷教练 (Scrum Master) 为双核心的敏捷 Squad',
    spec: {
      paradigm: 'tiered-dag',
      nodes: [
        { id: 'squad-po', label: '产品负责人 (PO)' },
        { id: 'squad-sm', label: '敏捷教练 (SM)' },
        { id: 'squad-fe', label: '前端研发小组 (3人)', type: 'subprocess' },
        { id: 'squad-be', label: '后端微服务小组 (4人)', type: 'subprocess' },
        { id: 'squad-qa', label: '测试与质量保证 (2人)', type: 'subprocess' },
      ],
      edges: [
        { from: 'squad-po', to: 'squad-fe' },
        { from: 'squad-po', to: 'squad-be' },
        { from: 'squad-sm', to: 'squad-be' },
        { from: 'squad-sm', to: 'squad-qa' },
      ],
    },
  },
];