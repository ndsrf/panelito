import { ImageResponse } from '@vercel/og';

export const runtime = 'nodejs';

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'flex-start',
          background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
          padding: '60px',
          fontFamily: 'Arial, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Content container */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: '20px',
            maxWidth: '900px',
          }}
        >
          {/* Logo and title row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '24px',
            }}
          >
            <svg
              width="120"
              height="120"
              viewBox="0 0 32 32"
              style={{
                background: '#0F172A',
                borderRadius: '12px',
                padding: '8px',
                border: '2px solid #38BDF8',
                flexShrink: 0,
              }}
            >
              <rect width="32" height="32" rx="6" fill="#0F172A" />
              <path
                d="M11 22V10H17C18.6569 10 20 11.3431 20 13C20 14.6569 18.6569 16 17 16H11"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="22" cy="22" r="2" fill="#38BDF8" />
              <circle cx="24" cy="12" r="1.5" fill="#818CF8" />
              <circle cx="8" cy="18" r="1.5" fill="#F472B6" />
            </svg>
            <div
              style={{
                display: 'flex',
                fontSize: '72px',
                fontWeight: 'bold',
                color: 'white',
                lineHeight: '1',
                letterSpacing: '-1px',
              }}
            >
              Panelito
            </div>
          </div>

          {/* Subtitle - use separate divs instead of br */}
          <div
            style={{
              display: 'flex',
              fontSize: '42px',
              color: '#93C5FD',
              fontWeight: 'bold',
              lineHeight: '1.3',
            }}
          >
            Pensamiento colectivo en tiempo real
          </div>

          {/* Description - use separate divs instead of br */}
          <div
            style={{
              display: 'flex',
              fontSize: '28px',
              color: '#CBD5E1',
              lineHeight: '1.5',
            }}
          >
            Debate síncrono potenciado por IA con análisis visual en tiempo real
          </div>
        </div>

        {/* Decorative circles */}
        <div
          style={{
            position: 'absolute',
            right: '80px',
            top: '100px',
            width: '100px',
            height: '100px',
            borderRadius: '50%',
            background: '#818CF8',
            opacity: 0.15,
            display: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: '60px',
            bottom: '120px',
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: '#38BDF8',
            opacity: 0.1,
            display: 'none',
          }}
        />
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
