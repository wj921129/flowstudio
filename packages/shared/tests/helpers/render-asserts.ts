import type { FlowNode } from '../../src/types.js';
import type { RenderResult } from '../../src/render/types.js';
import type { DiagramSpec } from '../../src/spec/types.js';

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