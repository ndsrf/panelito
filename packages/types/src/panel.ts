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

const BarItemSchema = z.object({
  label: z.string().max(60),
  value: z.number(),
})


// line, timeline, map sub-schemas
const LinePointSchema = z.object({
  x: z.string().max(60),
  y: z.number(),
})

const TimelineEventSchema = z.object({
  date: z.string().max(40),
  label: z.string().max(120),
  description: z.string().max(240).optional(),
})

const MapCountrySchema = z.object({
  code: z.string().length(2),
  label: z.string().max(80),
  value: z.number().optional(),
})


// -----------------------------------------------------------------------
// BasePanelWidgetSchema — all variants except layout (no self-reference)
// Used as the type for nested widgets inside the layout variant.
// AI-05: safeParse never throws; malformed payloads silently rejected
// T-1av-01: nested layout.widgets items validated against BasePanelWidgetSchema
// -----------------------------------------------------------------------

export const BasePanelWidgetSchema = z.discriminatedUnion('widget_type', [
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
  z.object({
    widget_type: z.literal('bar'),
    title: z.string().optional(),
    bars: z.array(BarItemSchema).min(2).max(12),
  }),
  z.object({
    widget_type: z.literal('line'),
    title: z.string().optional(),
    line_points: z.array(LinePointSchema).min(2).max(50),
  }),
  z.object({
    widget_type: z.literal('timeline'),
    title: z.string().optional(),
    events: z.array(TimelineEventSchema).min(1).max(20),
  }),
  z.object({
    widget_type: z.literal('map'),
    title: z.string().optional(),
    countries: z.array(MapCountrySchema).min(1).max(50),
    highlight_color: z.string().optional(),
  }),
])

export type BasePanelWidget = z.infer<typeof BasePanelWidgetSchema>

// -----------------------------------------------------------------------
// PanelWidgetSchema — full discriminated union including layout
// layout.widgets items are BasePanelWidget — no recursive nesting allowed
// -----------------------------------------------------------------------

export const PanelWidgetSchema = z.discriminatedUnion('widget_type', [
  ...BasePanelWidgetSchema.options,
  z.object({
    widget_type: z.literal('layout'),
    widgets: z.array(BasePanelWidgetSchema).min(2).max(3),
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
