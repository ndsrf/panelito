'use client'

import { useState, useCallback, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Lock, Database, Network } from 'lucide-react'

function EncryptionDiagram() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-8 py-8 lg:gap-12">
      <div className="flex items-center gap-8 lg:gap-12">
        {/* Browser - Key */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-24 h-24 lg:w-32 lg:h-32 rounded-full bg-cyan-950/40 border-2 border-cyan-400 flex items-center justify-center">
            <span className="text-5xl lg:text-7xl">🔑</span>
          </div>
        </div>

        {/* Arrow 1 - TLS */}
        <div className="flex flex-col items-center gap-2">
          <svg width="60" height="40" viewBox="0 0 60 40" className="text-amber-400 lg:w-20 lg:h-14">
            <line x1="10" y1="20" x2="50" y2="20" stroke="currentColor" strokeWidth="3" markerEnd="url(#arrowAlt)" />
          </svg>
          <span className="text-xs lg:text-sm font-semibold text-amber-400">TLS</span>
        </div>

        {/* Server - Database */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-24 h-24 lg:w-32 lg:h-32 rounded-full bg-purple-950/40 border-2 border-purple-400 flex items-center justify-center">
            <span className="text-5xl lg:text-7xl">🗄️</span>
          </div>
        </div>

        {/* Arrow 2 - AES */}
        <div className="flex flex-col items-center gap-2">
          <svg width="60" height="40" viewBox="0 0 60 40" className="text-emerald-400 lg:w-20 lg:h-14">
            <line x1="10" y1="20" x2="50" y2="20" stroke="currentColor" strokeWidth="3" markerEnd="url(#arrowAlt2)" />
          </svg>
          <span className="text-xs lg:text-sm font-semibold text-emerald-400">AES</span>
        </div>

        {/* Lock - Admin Only */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-24 h-24 lg:w-32 lg:h-32 rounded-full bg-emerald-950/40 border-2 border-emerald-400 flex items-center justify-center">
            <span className="text-5xl lg:text-7xl">🔒</span>
          </div>
        </div>
      </div>

      {/* Bottom text */}
      <div className="text-center">
        <p className="text-sm lg:text-base text-slate-300 max-w-sm">
          Solo tú tienes acceso a tus datos
        </p>
      </div>

      {/* SVG markers */}
      <svg width="0" height="0">
        <defs>
          <marker id="arrowAlt" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="currentColor" />
          </marker>
          <marker id="arrowAlt2" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="currentColor" />
          </marker>
        </defs>
      </svg>
    </div>
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
        <span className="ml-2 text-slate-600 text-xs lg:text-sm font-mono">.env.local</span>
      </div>
      <div className="p-6 lg:p-8 font-mono text-[13px] lg:text-base leading-7 lg:leading-8 space-y-0.5 flex-1">
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
      <div className="relative border border-slate-800/50 lg:border-slate-700 rounded-xl lg:rounded-2xl overflow-hidden shadow-2xl shadow-black/60 bg-black lg:shadow-3xl">
        <div className="aspect-video flex items-center justify-center lg:py-8">
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
        className="absolute left-3 lg:left-5 top-1/2 -translate-y-1/2 w-8 lg:w-10 h-8 lg:h-10 rounded-full bg-black/70 border border-white/10 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
        aria-label="Anterior"
      >
        <ChevronLeft className="w-4 lg:w-5 h-4 lg:h-5" />
      </button>
      <button
        onClick={next}
        className="absolute right-3 lg:right-5 top-1/2 -translate-y-1/2 w-8 lg:w-10 h-8 lg:h-10 rounded-full bg-black/70 border border-white/10 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
        aria-label="Siguiente"
      >
        <ChevronRight className="w-4 lg:w-5 h-4 lg:h-5" />
      </button>

      {/* Indicators */}
      <div className="absolute bottom-3 lg:bottom-5 left-1/2 -translate-x-1/2 flex gap-2 lg:gap-3">
        {slides.map((slide, i) => (
          <button
            key={i}
            onClick={() => setCurrent(i)}
            className={`h-2 lg:h-2.5 rounded-full transition-all duration-300 ${
              i === current ? 'w-6 lg:w-8 bg-white' : 'w-2 lg:w-2.5 bg-white/30 hover:bg-white/50'
            }`}
            aria-label={`Slide ${i + 1}`}
            title={slide.title}
          />
        ))}
      </div>
    </div>
  )
}
