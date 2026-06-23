/**
 * panelStore — Zustand store for the analytics panel widget state (D-05).
 *
 * Holds:
 * - widgetType: the active widget type (null when no widget rendered)
 * - widgetData: the full PanelWidget payload (null when no widget rendered)
 * - branchId: active conversation branch (default 'main')
 * - snapshotState: last persisted canvas_snapshot_state for time-travel (D-07)
 *
 * Actions:
 * - setWidget(widget) — sets widgetType + widgetData + snapshotState from a validated PanelWidget
 * - clearWidget() — nulls widgetType + widgetData (snapshotState preserved for branch switch)
 * - setBranchId(id) — updates active branch
 * - hydrateFromSnapshot(snapshot) — restores panel from a canvas_snapshot_state on branch switch (D-07)
 */

import { create } from 'zustand'
import type { PanelWidget } from '@panelito/types'

interface PanelStoreState {
  widgetType: PanelWidget['widget_type'] | null
  widgetData: PanelWidget | null
  branchId: string
  snapshotState: PanelWidget | null
  fullscreenWidget: PanelWidget | null

  /**
   * setWidget — update active widget from a schema-validated PanelWidget.
   * Also stores the widget as snapshotState for PANEL-04 time-travel.
   */
  setWidget: (widget: PanelWidget) => void

  /**
   * clearWidget — remove active widget display.
   * snapshotState is preserved so the last state can be recovered on branch switch.
   */
  clearWidget: () => void

  /**
   * setBranchId — update the active branch identifier.
   * Triggers Framer Motion key change in AnalyticsPanel (D-08).
   */
  setBranchId: (branchId: string) => void

  /**
   * hydrateFromSnapshot — restore panel from canvas_snapshot_state on branch switch (D-07).
   * If snapshot is null (branch has no AI history), clears the widget display.
   */
  hydrateFromSnapshot: (snapshot: PanelWidget | null) => void

  /**
   * setFullscreenWidget — set or clear the widget currently displayed in fullscreen mode.
   */
  setFullscreenWidget: (widget: PanelWidget | null) => void
}

export const usePanelStore = create<PanelStoreState>((set) => ({
  widgetType: null,
  widgetData: null,
  branchId: 'main',
  snapshotState: null,
  fullscreenWidget: null,

  setWidget: (widget) =>
    set({
      widgetType: widget.widget_type,
      widgetData: widget,
      snapshotState: widget,
    }),

  clearWidget: () =>
    set({ widgetType: null, widgetData: null, fullscreenWidget: null }),

  setBranchId: (branchId) => set({ branchId }),

  // D-07: hydrate from canvas_snapshot_state on branch switch
  // Restores widgetType from the snapshot (or null if no snapshot) and widgetData
  hydrateFromSnapshot: (snapshot) =>
    set({
      widgetType: snapshot?.widget_type ?? null,
      widgetData: snapshot,
      fullscreenWidget: null,
    }),

  setFullscreenWidget: (fullscreenWidget) => set({ fullscreenWidget }),
}))
