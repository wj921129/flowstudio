/**
 * @fileoverview @flowstudio/shared 统一导出入口
 */

export const VERSION = '0.1.0';

export * from './types.js';
export * from './node-registry.js';
export * from './constants.js';
export * from './schemas/index.js';
export * from './mermaid-bridge.js';
export * from './interop/xml-parser.js';
export * from './interop/drawio-bridge.js';
export * from './interop/bpmn-bridge.js';
export * from './snapshot-diff.js';
export * from './spec/types.js';
export * from './spec/spec-schema.js';
export * from './spec/normalize.js';
export * from './spec/presets.js';
export * from './render/types.js';
export * from './render/constants.js';
export * from './render/index.js';

