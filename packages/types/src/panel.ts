import { z } from 'zod'

// -----------------------------------------------------------------------
// Sub-schemas for each widget variant
// -----------------------------------------------------------------------

const BentoCardSchema = z.object({
  category: z.string().max(60),
  concept: z.string().max(120),
  relevance_score: z.number().min(0).max(100).optional(),
})

const RadarAxisSchema = z.object({
  axis: z.string().max(60),
  value: z.number().min(0).max(100),
})

const ScatterPointSchema = z.object({
  concept: z.string().max(80),
  consensus: z.number().min(0).max(100),
  impact: z.number().min(0).max(100),
})

const PieSegmentSchema = z.object({
  label: z.string().max(60),
  value: z.number().min(0),
})

// -----------------------------------------------------------------------
// PanelWidgetSchema — discriminated union on widget_type
// AI-05: safeParse never throws; malformed payloads silently rejected
// -----------------------------------------------------------------------

export const PanelWidgetSchema = z.discriminatedUnion('widget_type', [
  z.object({
    widget_type: z.literal('bento'),
    title: z.string().optional(),
    cards: z.array(BentoCardSchema).min(1).max(6),
  }),
  z.object({
    widget_type: z.literal('radar'),
    title: z.string().optional(),
    axes: z.array(RadarAxisSchema).min(3).max(8),
  }),
  z.object({
    widget_type: z.literal('scatter'),
    title: z.string().optional(),
    points: z.array(ScatterPointSchema).min(1).max(20),
  }),
  z.object({
    widget_type: z.literal('pie'),
    title: z.string().optional(),
    segments: z.array(PieSegmentSchema).min(2).max(8),
  }),
])

export type PanelWidget = z.infer<typeof PanelWidgetSchema>

// -----------------------------------------------------------------------
// FrontendStreamEvent — union of SSE event types the frontend consumes (D-03).
// Renamed from AIStreamEvent to avoid clash with the adapter-side AIStreamEvent
// in @panelito/types/ai which uses { type: 'tool_use' } instead of 'panel_update'.
// -----------------------------------------------------------------------

export type FrontendStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'panel_update'; payload: PanelWidget }
  | { type: 'done' }
