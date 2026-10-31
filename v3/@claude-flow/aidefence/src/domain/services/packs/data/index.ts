/**
 * Embedded AIMDS pattern packs (midstream commit abe78d6).
 */

import type { PatternPack } from '../pattern-loader.js';
import { CORE_PACK } from './core.js';
import { ENCODED_INSTRUCTION_PACK } from './encoded-instruction.js';
import { EXFIL_URL_PACK } from './exfil-url.js';
import { INSTRUCTION_OVERRIDE_I18N_PACK } from './instruction-override-i18n.js';
import { SLACK_MARKUP_FORGERY_PACK } from './slack-markup-forgery.js';
import { TOOL_INVOCATION_PACK } from './tool-invocation.js';

/** Every vendored pack, in file-name order. */
export const EMBEDDED_PACKS: readonly PatternPack[] = [
  CORE_PACK,
  ENCODED_INSTRUCTION_PACK,
  EXFIL_URL_PACK,
  INSTRUCTION_OVERRIDE_I18N_PACK,
  SLACK_MARKUP_FORGERY_PACK,
  TOOL_INVOCATION_PACK,
];
