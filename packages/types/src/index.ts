/**
 * @panelito/types — single source of truth for all shared TypeScript types.
 *
 * Both apps/web and apps/api import from this package via workspace:* dep.
 * Every type has a co-located Zod schema for runtime validation.
 */

// Session types + schemas
export type { Session, SessionCreateInput, SessionStatus, SessionMode } from "./session";
export { SessionSchema, SessionCreateInputSchema } from "./session";

// Message types + schemas
export type { Message, MessageInsertInput } from "./message";
export { MessageSchema, MessageInsertInputSchema } from "./message";

// Branch types + schemas + constants
export type { Branch } from "./branch";
export { BranchSchema, MAIN_BRANCH } from "./branch";

// API key types + schemas
export type { ApiKeyVerifyRequest, ApiKeyVerifyResponse, CreatorSettings } from "./api-key";
export {
  ApiKeyVerifyRequestSchema,
  ApiKeyVerifyResponseSchema,
  CreatorSettingsSchema,
} from "./api-key";
