'use client'

import { useState, useCallback, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Lock, Database, Network } from 'lucide-react'

function EncryptionDiagram() {
  return (
    <svg viewBox="0 0 600 400" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      {/* Background */}
      <defs>
        <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#1e293b', stopOpacity: 0.3 }} />
          <stop offset="100%" style={{ stopColor: '#0f172a', stopOpacity: 0.3 }} />
        </linearGradient>
      </defs>
      <rect width="600" height="400" fill="url(#bgGradient)" rx="12" />

      {/* Title */}
      <text x="300" y="35" fontSize="24" fontWeight="bold" fill="#f1f5f9" textAnchor="middle">
        Tus datos, encriptados
      </text>
      <text x="300" y="60" fontSize="14" fill="#cbd5e1" textAnchor="middle">
        Solo tú tienes acceso a tus conversaciones
      </text>

      {/* Left side: Your Client */}
      <g id="client">
        <rect x="30" y="100" width="120" height="100" fill="#334155" stroke="#475569" strokeWidth="2" rx="8" />
        <text x="90" y="130" fontSize="14" fontWeight="bold" fill="#e2e8f0" textAnchor="middle">
          Tu Cliente
        </text>
        <text x="90" y="155" fontSize="11" fill="#cbd5e1" textAnchor="middle">
          Browser
        </text>
        <circle cx="90" cy="185" r="4" fill="#06b6d4" />
      </g>

      {/* Lock icon in transit */}
      <g id="encryption-transit">
        <line x1="160" y1="150" x2="220" y2="150" stroke="#06b6d4" strokeWidth="2" strokeDasharray="5,5" />
        <circle cx="190" cy="140" r="20" fill="#0e7490" stroke="#06b6d4" strokeWidth="2" />
        <Lock x="180" y="130" width="20" height="20" fill="#06b6d4" />
      </g>

      {/* In transit label */}
      <text x="190" y="190" fontSize="12" fontWeight="600" fill="#06b6d4" textAnchor="middle">
        En Tránsito
      </text>
      <text x="190" y="206" fontSize="10" fill="#cbd5e1" textAnchor="middle">
        TLS/SSL
      </text>

      {/* Middle: Server/Database */}
      <g id="database">
        <rect x="240" y="100" width="120" height="100" fill="#334155" stroke="#475569" strokeWidth="2" rx="8" />
        <text x="300" y="130" fontSize="14" fontWeight="bold" fill="#e2e8f0" textAnchor="middle">
          Base de Datos
        </text>
        <text x="300" y="155" fontSize="11" fill="#cbd5e1" textAnchor="middle">
          Supabase
        </text>
        <circle cx="300" cy="185" r="4" fill="#a855f7" />
      </g>

      {/* Lock icon in database */}
      <g id="encryption-db">
        <circle cx="420" cy="150" r="20" fill="#6b21a8" stroke="#a855f7" strokeWidth="2" />
        <Lock x="410" y="140" width="20" height="20" fill="#a855f7" />
      </g>

      {/* Database encryption label */}
      <text x="420" y="190" fontSize="12" fontWeight="600" fill="#a855f7" textAnchor="middle">
        En Reposo
      </text>
      <text x="420" y="206" fontSize="10" fill="#cbd5e1" textAnchor="middle">
        AES-256
      </text>

      {/* Right side: Access control */}
      <g id="access-control">
        <rect x="450" y="100" width="120" height="100" fill="#334155" stroke="#475569" strokeWidth="2" rx="8" />
        <text x="510" y="130" fontSize="14" fontWeight="bold" fill="#e2e8f0" textAnchor="middle">
          Control
        </text>
        <text x="510" y="155" fontSize="11" fill="#cbd5e1" textAnchor="middle">
          Admin Solo
        </text>
        <circle cx="510" cy="185" r="4" fill="#10b981" />
      </g>

      {/* Connections */}
      <line x1="150" y1="150" x2="240" y2="150" stroke="#475569" strokeWidth="1" />
      <line x1="360" y1="150" x2="450" y2="150" stroke="#475569" strokeWidth="1" />

      {/* Bottom features */}
      <g id="features">
        <rect x="50" y="250" width="500" height="120" fill="none" stroke="#475569" strokeWidth="1" rx="8" />

        {/* Feature 1: End-to-End */}
        <circle cx="90" cy="285" r="6" fill="#06b6d4" />
        <text x="110" y="290" fontSize="13" fontWeight="600" fill="#e2e8f0">
          Encriptación E2E
        </text>
        <text x="110" y="310" fontSize="11" fill="#cbd5e1">
          Llave única por usuario, almacenada
        </text>
        <text x="110" y="326" fontSize="11" fill="#cbd5e1">
          en tu navegador. Nunca enviada al servidor.
        </text>

        {/* Feature 2: Admin Control */}
        <circle cx="340" cy="285" r="6" fill="#a855f7" />
        <text x="360" y="290" fontSize="13" fontWeight="600" fill="#e2e8f0">
          Clave de Admin
        </text>
        <text x="360" y="310" fontSize="11" fill="#cbd5e1">
          Solo el administrador puede
        </text>
        <text x="360" y="326" fontSize="11" fill="#cbd5e1">
          descifrar datos en la base de datos.
        </text>
      </g>

      {/* Key icon bottom right */}
      <g id="key-icon">
        <circle cx="540" cy="295" r="35" fill="none" stroke="#fbbf24" strokeWidth="2" opacity="0.3" />
        <Lock x="520" y="275" width="40" height="40" fill="#fbbf24" opacity="0.6" />
      </g>
    </svg>
  )
}

function APIKeysCode() {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden h-full flex flex-col">
      <div className="flex items-center gap-2 px-5 py-3 bg-slate-900/50 border-b border-slate-800">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-900/60" />
          <div className="w-3 h-3 rounded-full bg-amber-900/60" />
          <div className="w-3 h-3 rounded-full bg-emerald-900/60" />
        </div>
        <span className="ml-2 text-slate-600 text-xs font-mono">.env.local</span>
      </div>
      <div className="p-6 font-mono text-[13px] leading-7 space-y-0.5 flex-1">
        <div className="text-slate-600"># Conecta tu proveedor preferido</div>
        <div>
          <span className="text-indigo-400">ANTHROPIC_API_KEY</span>
          <span className="text-slate-600">=</span>
          <span className="text-emerald-400">sk-ant-api03-...</span>
        </div>
        <div className="text-slate-800 py-1">────────────────────────────</div>
        <div className="text-slate-600"># O cualquier proveedor compatible</div>
        <div>
          <span className="text-indigo-400">OPENAI_API_KEY</span>
          <span className="text-slate-600">=</span>
          <span className="text-emerald-400">sk-proj-...</span>
        </div>
        <div>
          <span className="text-indigo-400">GOOGLE_AI_KEY</span>
          <span className="text-slate-600">=</span>
          <span className="text-emerald-400">AIzaSy...</span>
        </div>
      </div>
    </div>
  )
}

export function BYOKCarousel() {
  const [current, setCurrent] = useState(0)

  const slides = [
    { id: 'api-keys', title: 'Conecta tu API Key', component: APIKeysCode },
    { id: 'encryption', title: 'Datos encriptados', component: EncryptionDiagram },
  ]

  const next = useCallback(() => setCurrent(c => (c + 1) % slides.length), [])
  const prev = useCallback(() => setCurrent(c => (c - 1 + slides.length) % slides.length), [])

  return (
    <div className="relative group">
      <div className="relative border border-slate-800/50 rounded-xl overflow-hidden shadow-2xl shadow-black/60 bg-black">
        <div className="aspect-video flex items-center justify-center">
          {slides.map((slide, i) => {
            const Component = slide.component
            return (
              <div
                key={slide.id}
                className={`absolute inset-0 transition-opacity duration-700 ${
                  i === current ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {i === 0 ? (
                  <div className="w-full h-full p-6 flex items-center justify-center">
                    <Component />
                  </div>
                ) : (
                  <div className="w-full h-full p-12 flex items-center justify-center">
                    <Component />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Navigation buttons */}
      <button
        onClick={prev}
        className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/70 border border-white/10 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
        aria-label="Anterior"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        onClick={next}
        className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/70 border border-white/10 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
        aria-label="Siguiente"
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      {/* Indicators */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`h-2 rounded-full transition-all duration-300 ${
              i === current ? 'w-6 bg-white' : 'w-2 bg-white/30 hover:bg-white/50'
            }`}
            aria-label={`Slide ${i + 1}`}
            title={slides[i].title}
          />
        ))}
      </div>
    </div>
  )
}
