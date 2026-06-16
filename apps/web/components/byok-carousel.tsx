'use client'

import { useState, useCallback, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Lock, Database, Network } from 'lucide-react'

function EncryptionDiagram() {
  return (
    <svg viewBox="0 0 800 400" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      {/* Title */}
      <text x="400" y="50" fontSize="32" fontWeight="bold" fill="#f1f5f9" textAnchor="middle">
        Tus datos encriptados
      </text>
      <text x="400" y="85" fontSize="18" fill="#cbd5e1" textAnchor="middle">
        Solo tú tienes acceso
      </text>

      {/* Step 1: Browser */}
      <circle cx="120" cy="200" r="50" fill="none" stroke="#06b6d4" strokeWidth="3" />
      <text x="120" y="200" fontSize="24" fontWeight="bold" fill="#06b6d4" textAnchor="middle" dominantBaseline="middle">
        🔑
      </text>
      <text x="120" y="270" fontSize="16" fontWeight="600" fill="#e2e8f0" textAnchor="middle">
        Tu clave
      </text>
      <text x="120" y="295" fontSize="13" fill="#cbd5e1" textAnchor="middle">
        en navegador
      </text>

      {/* Arrow 1 */}
      <line x1="170" y1="200" x2="270" y2="200" stroke="#fbbf24" strokeWidth="4" markerEnd="url(#arrowYellow)" />
      <text x="220" y="180" fontSize="14" fontWeight="600" fill="#fbbf24" textAnchor="middle">
        TLS/SSL
      </text>
      <text x="220" y="228" fontSize="13" fill="#cbd5e1" textAnchor="middle">
        En tránsito
      </text>

      {/* Step 2: Server */}
      <circle cx="400" cy="200" r="50" fill="none" stroke="#a855f7" strokeWidth="3" />
      <text x="400" y="200" fontSize="24" fontWeight="bold" fill="#a855f7" textAnchor="middle" dominantBaseline="middle">
        🗄️
      </text>
      <text x="400" y="270" fontSize="16" fontWeight="600" fill="#e2e8f0" textAnchor="middle">
        Servidor
      </text>
      <text x="400" y="295" fontSize="13" fill="#cbd5e1" textAnchor="middle">
        Encriptado
      </text>

      {/* Arrow 2 */}
      <line x1="450" y1="200" x2="550" y2="200" stroke="#10b981" strokeWidth="4" markerEnd="url(#arrowGreen)" />
      <text x="500" y="180" fontSize="14" fontWeight="600" fill="#10b981" textAnchor="middle">
        AES-256
      </text>
      <text x="500" y="228" fontSize="13" fill="#cbd5e1" textAnchor="middle">
        En reposo
      </text>

      {/* Step 3: Access Control */}
      <circle cx="680" cy="200" r="50" fill="none" stroke="#10b981" strokeWidth="3" />
      <text x="680" y="200" fontSize="24" fontWeight="bold" fill="#10b981" textAnchor="middle" dominantBaseline="middle">
        🔒
      </text>
      <text x="680" y="270" fontSize="16" fontWeight="600" fill="#e2e8f0" textAnchor="middle">
        Solo Admin
      </text>
      <text x="680" y="295" fontSize="13" fill="#cbd5e1" textAnchor="middle">
        accede
      </text>

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
