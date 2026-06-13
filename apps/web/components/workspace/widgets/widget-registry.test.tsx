'use client'

/**
 * widget-registry.test.tsx
 *
 * Tests the extensible widget registry Map (D-06):
 * - All 4 widget_type keys resolve to components (not undefined)
 * - An unknown key returns undefined
 * - BentoGrid renders one card per cards entry
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { widgetRegistry } from './widget-registry'
import type { PanelWidget } from '@panelito/types'

describe('widgetRegistry', () => {
  it('resolves bento to a component', () => {
    expect(widgetRegistry.get('bento')).toBeDefined()
  })

  it('resolves radar to a component', () => {
    expect(widgetRegistry.get('radar')).toBeDefined()
  })

  it('resolves scatter to a component', () => {
    expect(widgetRegistry.get('scatter')).toBeDefined()
  })

  it('resolves pie to a component', () => {
    expect(widgetRegistry.get('pie')).toBeDefined()
  })

  it('returns undefined for an unknown key', () => {
    // Cast to any to test invalid key handling
    expect(widgetRegistry.get('unknown' as PanelWidget['widget_type'])).toBeUndefined()
  })

  it('BentoGrid renders one card per data.cards entry', () => {
    const BentoGrid = widgetRegistry.get('bento')
    expect(BentoGrid).toBeDefined()

    const data: PanelWidget = {
      widget_type: 'bento',
      cards: [
        { category: 'Cat A', concept: 'Concept A', relevance_score: 80 },
        { category: 'Cat B', concept: 'Concept B' },
      ],
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const Grid = BentoGrid!
    render(<Grid data={data} />)

    // Each card should show its concept text
    expect(screen.getByText('Concept A')).toBeDefined()
    expect(screen.getByText('Concept B')).toBeDefined()
  })
})
