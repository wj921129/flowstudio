import type { FlowNode } from '../../src/types.js';
import type { RenderResult } from '../../src/render/types.js';
import type { DiagramSpec } from '../../src/spec/types.js';
import { DIAGRAM_PRESETS } from '../../src/spec/presets.js';

export function preset(id: string): DiagramSpec {
  const p = DIAGRAM_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`缺少预设 ${id}`);
  return p.spec;
}

export function noOverlap(nodes: FlowNode[]): boolean {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const aw = a.width ?? 0;
      const ah = a.height ?? 0;
      const bw = b.width ?? 0;
      const bh = b.height ?? 0;
      if (a.position.x < b.position.x + bw && b.position.x < a.position.x + aw && a.position.y < b.position.y + bh && b.position.y < a.position.y + ah) return false;
    }
  }
  return true;
}

export function byId(r: RenderResult, id: string): FlowNode {
  const n = r.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`渲染结果缺少节点 ${id}`);
  return n;
}

export function columnsOf(r: RenderResult, hostId: string): number {
  return new Set(r.nodes.filter((n) => n.data!.attachTo === hostId).map((n) => n.position.x)).size;
}

export function laneContainsAllChildren(r: RenderResult): boolean {
  const lanes = r.nodes.filter((n) => n.type === 'lane');
  return lanes.every((lane) => r.nodes
    .filter((n) => n.parentId === lane.id)
    .every((c) => c.position.x >= 0 && c.position.y >= 0 && c.position.x + c.width! <= lane.width! && c.position.y + c.height! <= lane.height!));
}

export function annotationLaneIdInherited(r: RenderResult): boolean {
  return r.nodes.filter((n) => n.data!.role === 'annotation').every((a) => {
    const host = r.nodes.find((h) => h.id === a.data!.attachTo);
    return Boolean(host) && host!.parentId === a.parentId;
  });
}

export function buildSvnSpec(): DiagramSpec {
  const mainLabels = [
    'r473840｜2023-06-15 renzw·通道上线',
    'r474089｜2023-06-15 renzw·通道上线',
    'r474100｜2023-06-15 renzw·通道上线',
    'r474465｜2023-06-16 renzw·修复传参',
    'r477987｜2023-06-29 renzw·无代码改动',
    'r481791｜2023-07-10 renzw·地址超180自定义',
    'r488102｜2023-07-27 renzw·商户映射配置',
    'r521572｜2023-11-10 renzw·VA特配优先',
    'r634444｜2024-09-05 renzw·港企证件前8位',
    'r729120｜2025-05-27 raowh·新增Alias',
    'r729376｜2025-05-27 raowh·括号替换',
    'r731070｜2025-05-30 raowh·回滚替换',
    'r828402｜2025-12-22 zhanghh·其他国家入网',
    'r830890｜2025-12-25 zhanghh·仅告警文案',
    'r969084｜2026-10-15 zhanghh·报文升级',
  ];
  const annots: Array<[string, string[]]> = [
    ['t1', [
      'TxnType/RequestType=CREATE枚举；CustomerType=CORPORATION',
      'AccountNo/CorpCode=读配置；DateOfIncorporation=注册日期（空取营业起始）',
      'VaPrefix=硬编码79；VaNumber=前缀+CorpCode+rowId补零6位',
      'VaName=中文名直传；PlaceOfBiz/street=拼音地址',
      'CustomerId=解密mOrgId',
      'CtryOfIncorporation/address.country=HKG?HK:CN',
      'IdType=6/7数字码；IdCountry=HK/CN（按mLocationType）',
    ]],
    ['t2', ['新增PpobCountry=HK/CN（随国家分支）']],
    ['t3', ['IdType：6/7→CERTIFICATE OF INCORPORATION（NON HK）']],
    ['t4', ['VaPrefix：79→配置；VaNumber：去前缀，补零6→11位', 'PlaceOfBiz/street：拼音→百度翻译zh2En']],
    ['t6', ['PlaceOfBiz/street：翻译加mUserId，超180位自定义']],
    ['t7', ['VaName：中文名→getUserNameEn映射英文名', 'PlaceOfBiz/street：翻译→getAddr映射表']],
    ['t8', ['VaNumber：特配getVaNumber优先，无则rowId补零11位']],
    ['t9', ['CustomerId：有mOrgRegId取前8位，否则解密mOrgId']],
    ['t10', ['新增Alias：港企=空串；其他=mUserNm']],
    ['t11', ['Alias：中文括号（）→英文()']],
    ['t12', ['Alias：回滚括号替换，直传mUserNm']],
    ['t13', [
      '国家四字段（注册/经营/证件/地址）统一=两位国家码',
      'PlaceOfBiz/street：实际地址→注册地址getAddrForAcnt',
      'IdType分支条件：Constant→MerLocationTypeEnum',
      'Alias独立赋值：isHkProcess？空串：mUserNm',
    ]],
    ['t15', ['国家两位码收口=getRegisterCountryCd', 'Address.city：空串→注册城市getRegisterCityNmEn']],
  ];
  const nodes: DiagramSpec['nodes'] = mainLabels.map((label, i) => ({ id: `t${i + 1}`, label }));
  let k = 0;
  for (const [host, labels] of annots) {
    for (const label of labels) nodes.push({ id: `a${++k}`, label, attachTo: host });
  }
  const edges: DiagramSpec['edges'] = mainLabels.slice(1).map((_, i) => ({ from: `t${i + 1}`, to: `t${i + 2}` }));
  return { paradigm: 'timeline-annotated', nodes, edges };
}
export function buildYeepaySpec(): DiagramSpec {
  const nodes: DiagramSpec['nodes'] = [
    { id: "s0", label: "易宝限额判定入口 isYeePayQuota(bea…", type: "start-end", description: "返回 true 表示易宝通道限额不可用，false 表示可用" },
    { id: "d1", label: "收款账户类型 = 员工薪酬？", type: "decision" },
    { id: "b1", label: "委派薪酬通道限额判定 年度 30 万元（易宝不校验月…", type: "start-end" },
    { id: "d2", label: "大陆公司 且 对公收款 （企业 / 企业供应商）？", type: "decision" },
    { id: "b2", label: "不限额 · 对公豁免直接放行", type: "start-end" },
    { id: "p1", label: "解析年度限额档位 resolveYeePayLimi…", type: "process" },
    { id: "d3", label: "档位匹配成功？", type: "decision" },
    { id: "b3", label: "限额 · 收款订单缺失 或贸易类型冲突 / 未匹配", type: "start-end" },
    { id: "d4", label: "个人供应商收款 且 命中 易宝更换申报主体白名单(1…", type: "decision" },
    { id: "p2", label: "HSM 解密商户申报主体证件号 mTrusteeCe…", type: "process" },
    { id: "d5", label: "非大陆公司 且 证件号 非有效大陆二代身份证？", type: "decision" },
    { id: "d6", label: "第一层：企业法人 / 董事 是否限额？", type: "decision" },
    { id: "b6", label: "不限额 · 以商户申报主体下发", type: "start-end" },
    { id: "d7", label: "收款账户类型 = 个人供应商？", type: "decision" },
    { id: "b7", label: "限额 · 无可降级申报主体", type: "start-end" },
    { id: "d8", label: "第二层：订单所属个人供应商 记录存在？", type: "decision" },
    { id: "b8", label: "限额 · 易宝通道查询不到个人供应记录", type: "start-end" },
    { id: "d9", label: "证件号非空 且 未命中手动限额名单？", type: "decision" },
    { id: "p3", label: "汇总个人供应商自然年已用额度 quota = max…", type: "process" },
    { id: "d10", label: "quota + 本笔金额 < 档位上限？", type: "decision" },
    { id: "b10", label: "不限额 · 回写 LIMIT_LABEL = 供应商…", type: "start-end" },
    { id: "d11", label: "快捷提现 TS17？", type: "decision" },
    { id: "b11", label: "限额 · 交由外层通道路由 另行补校验固定个人供应商", type: "start-end" },
    { id: "d12", label: "第三层：固定个人供应商池 selectFixedBy…", type: "decision" },
    { id: "b12", label: "限额 · 易宝通道无可用申报主体", type: "start-end" },
    { id: "p4", label: "遍历固定个人供应商 跳过无证件号 / 命中手动名单者", type: "process" },
    { id: "d13", label: "存在 quota + 本笔 < 档位 的供应商？", type: "decision" },
    { id: "b13", label: "不限额 · 回写 LIMIT_LABEL = 命中 …", type: "start-end" },
    { id: "e1", label: "限额 · 易宝通道无可用申报主体", type: "start-end" },
    { id: "o1", label: "交易类型 ∈ TS07 / TS09 / TS17？", type: "decision" },
    { id: "o2", label: "收款为个人供应商？", type: "decision" },
    { id: "o3", label: "境外个人供应商校验 记录 + 证件号 + 手动名单 …", type: "subprocess" },
    { id: "o3d", label: "校验通过？", type: "decision" },
    { id: "o4", label: "收款为企业供应商 / 供应商法人 / 供应商股东？", type: "decision" },
    { id: "o5", label: "易宝 KYC 备案记录存在？", type: "decision" },
    { id: "o6", label: "供应商年度累计 + 本笔 < 档位？", type: "decision" },
    { id: "o7", label: "仅校验单笔：本笔金额 < 档位？", type: "decision" },
    { id: "o-pass", label: "不限额 · 境外分支放行", type: "start-end" },
    { id: "o-limit", label: "限额 · 境外分支拦截", type: "start-end" },
    { id: "a1", label: "调用入口：提现免审 isChnlQuota / ge…", type: "comment" },
    { id: "a2", label: "年度限额档位（单位：分）｜货物贸易 orderTp=…", type: "comment" },
    { id: "a3", label: "白名单：T_GPAY_B2B_USER_MCSP_W…", type: "comment" },
    { id: "a4", label: "第一层判定口径：① 申报主体证件号或法人证件号命中手…", type: "comment" },
    { id: "a5", label: "手动限额名单：fuiou.properties 的 …", type: "comment" },
    { id: "a6", label: "累计额度数据源：解付表 T_GPAY_B2B_CHN…", type: "comment" },
    { id: "a7", label: "70% 预警邮件：quota ≥ 档位/10*7 触…", type: "comment" },
    { id: "a8", label: "LIMIT_LABEL 回写：常规订单调 updat…", type: "comment" },
    { id: "a9", label: "快捷提现补偿：外层排除易宝后若无任何可用通道且收款为…", type: "comment" },
  ];
  const edges: DiagramSpec['edges'] = [
    { from: "s0", to: "d1" },
    { from: "d1", to: "b1", kind: "branch", label: "是" },
    { from: "d1", to: "d2", label: "否" },
    { from: "d2", to: "b2", kind: "branch", label: "是" },
    { from: "d2", to: "p1", label: "否" },
    { from: "p1", to: "d3" },
    { from: "d3", to: "b3", kind: "branch", label: "否" },
    { from: "d3", to: "d4", label: "是" },
    { from: "d4", to: "d8", kind: "jump", label: "是·跳过法人层" },
    { from: "d4", to: "p2", label: "否" },
    { from: "p2", to: "d5" },
    { from: "d5", to: "o1", kind: "branch", label: "是·境外公司" },
    { from: "d5", to: "d6", label: "否" },
    { from: "d6", to: "b6", kind: "branch", label: "否·法人层可用" },
    { from: "d6", to: "d7", label: "是·已限额" },
    { from: "d7", to: "b7", kind: "branch", label: "否" },
    { from: "d7", to: "d8", label: "是" },
    { from: "d8", to: "b8", kind: "branch", label: "否" },
    { from: "d8", to: "d9", label: "是" },
    { from: "d9", to: "d11", kind: "jump", label: "否·降级第三层" },
    { from: "d9", to: "p3", label: "是" },
    { from: "p3", to: "d10" },
    { from: "d10", to: "b10", kind: "branch", label: "是" },
    { from: "d10", to: "d11", label: "否·已超限" },
    { from: "d11", to: "b11", kind: "branch", label: "是" },
    { from: "d11", to: "d12", label: "否·常规交易" },
    { from: "d12", to: "b12", kind: "branch", label: "否" },
    { from: "d12", to: "p4", label: "是" },
    { from: "p4", to: "d13" },
    { from: "d13", to: "b13", kind: "branch", label: "是·命中" },
    { from: "d13", to: "p4", kind: "loop", label: "否·取下一个" },
    { from: "d13", to: "e1", label: "池已耗尽" },
    { from: "o1", to: "o-limit", kind: "branch", label: "否" },
    { from: "o1", to: "o2", label: "是" },
    { from: "o2", to: "o3", kind: "branch", label: "是" },
    { from: "o2", to: "o4", label: "否" },
    { from: "o3", to: "o3d" },
    { from: "o3d", to: "o-pass", kind: "branch", label: "是" },
    { from: "o3d", to: "o-limit", label: "否" },
    { from: "o4", to: "o5", kind: "branch", label: "是" },
    { from: "o4", to: "o7", label: "否·其他类型" },
    { from: "o5", to: "o-pass", kind: "branch", label: "否·未备案" },
    { from: "o5", to: "o6", label: "是" },
    { from: "o6", to: "o-pass", kind: "branch", label: "是" },
    { from: "o6", to: "o-limit", label: "否" },
    { from: "o7", to: "o-pass", kind: "branch", label: "是" },
    { from: "o7", to: "o-limit", label: "否" },
    { from: "s0", to: "a1", kind: "annotate" },
    { from: "p1", to: "a2", kind: "annotate" },
    { from: "d4", to: "a3", kind: "annotate" },
    { from: "d6", to: "a4", kind: "annotate" },
    { from: "d9", to: "a5", kind: "annotate" },
    { from: "p3", to: "a6", kind: "annotate" },
    { from: "d10", to: "a7", kind: "annotate" },
    { from: "d10", to: "a8", kind: "annotate" },
    { from: "d11", to: "a9", kind: "annotate" },
  ];
  return { paradigm: 'vertical-flow', nodes, edges };
}
