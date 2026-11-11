import type { SlashCommandItem } from './copilot-types';

export const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    cmd: '/refine',
    title: '文本与排版润色',
    desc: '优化选中节点或当前流程图文案规范与因果排版',
    example: '/refine',
  },
  {
    cmd: '/branch',
    title: '补充异常分支',
    desc: '为当前节点补充风控/校验判断与异常回退分支',
    example: '/branch 失败时驳回重试',
  },
  {
    cmd: '/testcase',
    title: '生成因果测试用例',
    desc: '遍历因果拓扑与决策分支，生成完整测试用例清单',
    example: '/testcase',
  },
];
