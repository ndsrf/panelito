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

// API key types + schemas (multi-provider: D-10, D-11, D-13)
export type {
  ApiKeyVerifyRequest,
  ApiKeyVerifyResponse,
  CreatorSettings,
  ProviderKeyStatus,
  MultiProviderStatus,
} from "./api-key";
export {
  ApiKeyVerifyRequestSchema,
  ApiKeyVerifyResponseSchema,
  CreatorSettingsSchema,
  ProviderKeyStatusSchema,
  MultiProviderStatusSchema,
} from "./api-key";

// Panel widget types + schemas (AI-05, PANEL-01)
// FrontendStreamEvent renamed from AIStreamEvent to avoid clash with adapter-side AIStreamEvent
export type { PanelWidget, BasePanelWidget, FrontendStreamEvent } from "./panel";
export { PanelWidgetSchema, BasePanelWidgetSchema } from "./panel";

// Provider-agnostic AI interface + types (D-01, D-02, Phase 4)
export type {
  ProviderMessage,
  ProviderTool,
  ProviderCapabilities,
  AIProvider,
  AIStreamEvent,
  ProviderName,
} from "./ai";
export { ProviderSchema, renderPanelTool } from "./ai";
export { canvasMutationTool } from "./canvas-tool";

// Reaction types + schemas (REACT-01 through REACT-04)
export type { Reaction, ReactionCount } from "./reaction";
export { ReactionSchema, ReactionCountSchema } from "./reaction";

// Persona types + library (PERSONA-01)
export type { PersonaConfig, PersonaId } from "./persona";
export { PersonaConfigSchema, PERSONA_LIBRARY, PERSONA_IDS } from "./persona";

// Canvas types + schemas (CanvasNode, CanvasEdge, CanvasOp — CANVAS-01, INFRA-03)
export type { CanvasNode, CanvasEdge, CanvasOp, CanvasNodeStatus } from "./canvas";
export { CanvasNodeSchema, CanvasEdgeSchema, CanvasOpSchema, CanvasNodeStatusSchema } from "./canvas";

// Blueprint types + schemas (Blueprint, sub-schemas — BLUE-01, INFRA-03)
export type { Blueprint, NodeTypeConfig, EdgeTypeConfig, PhaseSequence } from "./blueprint";
export { BlueprintSchema, NodeTypeConfigSchema, EdgeTypeConfigSchema, PhaseSequenceSchema } from "./blueprint";

// Bot infrastructure types + schemas (ArgNode, ArgEdge, BotBudgetResult, TriggerMetadata — BOT-01, BOT-02, BOT-05)
export type { ArgNode, ArgEdge, BotBudgetResult, TriggerMetadata, TriggerMetadataEntry } from "./bot";
export { ArgNodeSchema, ArgEdgeSchema, BotBudgetResultSchema, TriggerMetadataSchema, TriggerMetadataEntrySchema } from "./bot";
