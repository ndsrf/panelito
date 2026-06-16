import { ImageResponse } from '@vercel/og';

export const runtime = 'nodejs';

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          fontSize: 60,
          color: 'white',
          background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
          width: '100%',
          height: '100%',
          padding: '60px',
          textAlign: 'left',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        {/* Left side - Logo and branding */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: '20px',
          }}
        >
          {/* Logo */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '20px',
            }}
          >
            <svg
              width="140"
              height="140"
              viewBox="0 0 32 32"
              style={{
                background: '#0F172A',
                borderRadius: '12px',
                padding: '12px',
                border: '2px solid #38BDF8',
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
            <h1
              style={{
                fontSize: '80px',
                fontWeight: 'bold',
                margin: 0,
                letterSpacing: '-2px',
              }}
            >
              Panelito
            </h1>
          </div>

          {/* Subtitle and description */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '15px',
              marginLeft: '0px',
            }}
          >
            <div
              style={{
                fontSize: '44px',
                color: '#93C5FD',
                fontWeight: 'bold',
                lineHeight: '1.2',
              }}
            >
              Pensamiento colectivo<br />
              en tiempo real
            </div>
            <div
              style={{
                fontSize: '32px',
                color: '#CBD5E1',
                lineHeight: '1.4',
              }}
            >
              Debate síncrono potenciado por IA<br />
              con análisis visual en tiempo real
            </div>
          </div>
        </div>

        {/* Decorative elements */}
        <div
          style={{
            position: 'absolute',
            right: '60px',
            top: '60px',
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: '#818CF8',
            opacity: 0.3,
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: '150px',
            bottom: '80px',
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: '#38BDF8',
            opacity: 0.2,
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
