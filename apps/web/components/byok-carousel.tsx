'use client'

import { useState, useCallback, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Lock, Database, Network } from 'lucide-react'

function EncryptionDiagram() {
  return (
    <svg viewBox="0 0 500 300" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      {/* Title */}
      <text x="250" y="28" fontSize="20" fontWeight="bold" fill="#f1f5f9" textAnchor="middle">
        Datos encriptados, solo tú tienes acceso
      </text>

      {/* Browser box */}
      <rect x="30" y="60" width="100" height="80" fill="none" stroke="#06b6d4" strokeWidth="2" rx="6" />
      <text x="80" y="105" fontSize="12" fontWeight="600" fill="#06b6d4" textAnchor="middle">
        Tu navegador
      </text>

      {/* Arrow 1 - In Transit */}
      <line x1="130" y1="100" x2="190" y2="100" stroke="#fbbf24" strokeWidth="2" markerEnd="url(#arrowYellow)" />
      <text x="160" y="120" fontSize="10" fontWeight="600" fill="#fbbf24" textAnchor="middle">
        TLS/SSL
      </text>

      {/* Server/Database box */}
      <rect x="190" y="60" width="100" height="80" fill="none" stroke="#a855f7" strokeWidth="2" rx="6" />
      <text x="240" y="105" fontSize="12" fontWeight="600" fill="#a855f7" textAnchor="middle">
        Base de datos
      </text>

      {/* Arrow 2 - At Rest */}
      <line x1="290" y1="100" x2="350" y2="100" stroke="#10b981" strokeWidth="2" markerEnd="url(#arrowGreen)" />
      <text x="320" y="120" fontSize="10" fontWeight="600" fill="#10b981" textAnchor="middle">
        AES-256
      </text>

      {/* Lock box */}
      <rect x="350" y="60" width="100" height="80" fill="none" stroke="#10b981" strokeWidth="2" rx="6" />
      <text x="400" y="105" fontSize="12" fontWeight="600" fill="#10b981" textAnchor="middle">
        Encriptado
      </text>

      {/* Bottom row - Access control */}
      <g>
        <rect x="80" y="180" width="140" height="90" fill="none" stroke="#cbd5e1" strokeWidth="1" rx="6" />
        <text x="150" y="202" fontSize="11" fontWeight="600" fill="#e2e8f0" textAnchor="middle">
          Solo Admin
        </text>
        <text x="150" y="220" fontSize="9" fill="#94a3b8" textAnchor="middle">
          tiene la clave
        </text>
        <text x="150" y="234" fontSize="9" fill="#94a3b8" textAnchor="middle">
          para desencriptar
        </text>
        <text x="150" y="248" fontSize="9" fill="#94a3b8" textAnchor="middle">
          datos en el servidor
        </text>
      </g>

      <g>
        <rect x="280" y="180" width="140" height="90" fill="none" stroke="#cbd5e1" strokeWidth="1" rx="6" />
        <text x="350" y="202" fontSize="11" fontWeight="600" fill="#e2e8f0" textAnchor="middle">
          Tu clave
        </text>
        <text x="350" y="220" fontSize="9" fill="#94a3b8" textAnchor="middle">
          almacenada
        </text>
        <text x="350" y="234" fontSize="9" fill="#94a3b8" textAnchor="middle">
          en tu navegador
        </text>
        <text x="350" y="248" fontSize="9" fill="#94a3b8" textAnchor="middle">
          nunca se envía
        </text>
      </g>

      {/* Arrow markers */}
      <defs>
        <marker id="arrowYellow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#fbbf24" />
        </marker>
        <marker id="arrowGreen" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#10b981" />
        </marker>
      </defs>
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

  useEffect(() => {
    const id = setInterval(next, 4000)
    return () => clearInterval(id)
  }, [next])

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
        {slides.map((slide, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`h-2 rounded-full transition-all duration-300 ${
              i === current ? 'w-6 bg-white' : 'w-2 bg-white/30 hover:bg-white/50'
            }`}
            aria-label={`Slide ${i + 1}`}
            title={slide.title}
          />
        ))}
      </div>
    </div>
  )
}
