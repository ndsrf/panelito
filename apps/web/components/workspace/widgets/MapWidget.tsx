'use client'

/**
 * MapWidget — world SVG map with highlighted countries.
 *
 * Uses react-simple-maps for the composable SVG map.
 * Topojson fetched from jsDelivr CDN at runtime (no API key needed).
 * T-1pn-01: CDN fetch is a static asset; map renders blank if unavailable.
 * T-1pn-02: country codes used only as Map lookup keys — no code execution.
 * T-1pn-03: highlight_color used as SVG fill — React escapes attribute values.
 */

import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import type { PanelWidget } from '@panelito/types'

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

interface MapWidgetProps {
  data: Extract<PanelWidget, { widget_type: 'map' }>
  isFullscreen?: boolean
}

export function MapWidget({ data, isFullscreen }: MapWidgetProps) {
  const highlighted = new Map(data.countries.map((c) => [c.code.toUpperCase(), c]))
  const highlightColor = data.highlight_color ?? '#6366f1'

  const maxLegend = isFullscreen ? 30 : 10
  const legendItems = data.countries.slice(0, maxLegend)
  const overflow = data.countries.length - maxLegend

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {data.title && (
        <h3 className="text-[13px] font-semibold text-foreground mb-1 px-1 shrink-0">
          {data.title}
        </h3>
      )}
      {/* Map */}
      <div className="flex-1 min-h-0">
        <ComposableMap
          projection="geoNaturalEarth1"
          style={{ width: '100%', height: '100%' }}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const isoA2 = (geo.properties as Record<string, string>).iso_a2?.toUpperCase() ?? ''
                const isHighlighted = highlighted.has(isoA2)
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={isHighlighted ? highlightColor : '#27272a'}
                    stroke="#3f3f46"
                    style={{
                      default: { outline: 'none' },
                      hover: {
                        fill: isHighlighted ? highlightColor : '#3f3f46',
                        stroke: '#52525b',
                        outline: 'none',
                      },
                      pressed: { outline: 'none' },
                    }}
                  />
                )
              })
            }
          </Geographies>
        </ComposableMap>
      </div>
      {/* Legend */}
      {data.countries.length > 0 && (
        <div className="shrink-0 flex flex-wrap gap-1 px-1 pt-1 pb-0.5">
          {legendItems.map((country) => (
            <span
              key={country.code}
              className="inline-flex items-center gap-1 text-[11px] text-zinc-300 bg-zinc-800 rounded px-2 py-0.5"
            >
              {country.label}
              {country.value !== undefined && (
                <span className="text-zinc-400">: {country.value}</span>
              )}
            </span>
          ))}
          {overflow > 0 && (
            <span className="inline-flex items-center text-[11px] text-zinc-500 px-1">
              …and {overflow} more
            </span>
          )}
        </div>
      )}
    </div>
  )
}
