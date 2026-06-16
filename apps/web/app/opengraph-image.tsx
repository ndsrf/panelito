import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Panelito — Pensamiento colectivo en tiempo real'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          background: '#000000',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 88px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Ambient glow — top right */}
        <div
          style={{
            position: 'absolute',
            top: '-180px',
            right: '-120px',
            width: '700px',
            height: '700px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(99,102,241,0.18) 0%, transparent 60%)',
          }}
        />
        {/* Ambient glow — bottom left */}
        <div
          style={{
            position: 'absolute',
            bottom: '-200px',
            left: '100px',
            width: '500px',
            height: '500px',
            borderRadius: '50%',
            background: 'linear-gradient(315deg, rgba(6,182,212,0.08) 0%, transparent 65%)',
          }}
        />

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '10px',
              background: '#0F172A',
              border: '1px solid #1e293b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="26" height="26" viewBox="0 0 32 32" fill="none">
              <path
                d="M11 22V10H17C18.657 10 20 11.343 20 13C20 14.657 18.657 16 17 16H11"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="22" cy="22" r="2" fill="#38BDF8" />
              <circle cx="24" cy="12" r="1.5" fill="#818CF8" />
              <circle cx="8" cy="18" r="1.5" fill="#F472B6" />
            </svg>
          </div>

          <span
            style={{
              color: '#94a3b8',
              fontSize: '18px',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase' as const,
            }}
          >
            Panelito
          </span>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '9999px',
              padding: '5px 14px',
              marginLeft: '8px',
            }}
          >
            <div
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: '#34d399',
              }}
            />
            <span style={{ color: '#64748b', fontSize: '14px' }}>Beta Abierta</span>
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div
            style={{
              color: '#f8fafc',
              fontSize: '78px',
              fontWeight: 800,
              lineHeight: 1.0,
              letterSpacing: '-0.03em',
              maxWidth: '950px',
            }}
          >
            Pensamiento colectivo
            <br />
            <span style={{ color: '#64748b' }}>en tiempo real.</span>
          </div>

          <div
            style={{
              color: '#475569',
              fontSize: '22px',
              lineHeight: 1.5,
              maxWidth: '680px',
            }}
          >
            Debate síncrono potenciado por IA con árbol de conversación ramificado y
            análisis visual en tiempo real.
          </div>
        </div>

        {/* Tags */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <div
            style={{
              background: 'rgba(99,102,241,0.08)',
              border: '1px solid rgba(99,102,241,0.18)',
              borderRadius: '9999px',
              padding: '7px 18px',
              color: '#6366f1',
              fontSize: '15px',
              letterSpacing: '0.02em',
            }}
          >
            Bifurcación de conversaciones
          </div>
          <div
            style={{
              background: 'rgba(99,102,241,0.08)',
              border: '1px solid rgba(99,102,241,0.18)',
              borderRadius: '9999px',
              padding: '7px 18px',
              color: '#6366f1',
              fontSize: '15px',
              letterSpacing: '0.02em',
            }}
          >
            Panel analítico 40/60
          </div>
          <div
            style={{
              background: 'rgba(99,102,241,0.08)',
              border: '1px solid rgba(99,102,241,0.18)',
              borderRadius: '9999px',
              padding: '7px 18px',
              color: '#6366f1',
              fontSize: '15px',
              letterSpacing: '0.02em',
            }}
          >
            IA modular BYOK
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
