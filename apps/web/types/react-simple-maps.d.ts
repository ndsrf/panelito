declare module 'react-simple-maps' {
  import type { ComponentType, SVGProps, ReactNode } from 'react'

  export interface ComposableMapProps {
    projection?: string
    projectionConfig?: Record<string, unknown>
    width?: number
    height?: number
    style?: React.CSSProperties
    className?: string
    children?: ReactNode
  }

  export interface GeographiesProps {
    geography: string | object
    children: (args: { geographies: Geography[] }) => ReactNode
  }

  export interface Geography {
    rsmKey: string
    id: string
    properties: Record<string, unknown>
    geometry: object
  }

  export interface GeographyProps extends SVGProps<SVGPathElement> {
    geography: Geography
    style?: {
      default?: React.CSSProperties
      hover?: React.CSSProperties
      pressed?: React.CSSProperties
    }
  }

  export const ComposableMap: ComponentType<ComposableMapProps>
  export const Geographies: ComponentType<GeographiesProps>
  export const Geography: ComponentType<GeographyProps>
}
