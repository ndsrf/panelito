'use client'

import { useState } from 'react'
import { ShieldAlert, Target, EyeOff, ChefHat, Compass, Gamepad2 } from 'lucide-react'

type Context = 'b2b' | 'b2c'

const growSteps = [
  { k: 'G', name: 'Goal', note: 'Objetivo', color: 'text-amber-400' },
  { k: 'R', name: 'Reality', note: 'Diagnóstico', color: 'text-sky-400' },
  { k: 'O', name: 'Options', note: 'Escenarios', color: 'text-indigo-400' },
  { k: 'W', name: 'Will', note: 'Compromisos', color: 'text-emerald-400' },
]

export function FeaturesTabs() {
  const [context, setContext] = useState<Context>('b2b')

  return (
    <section className="py-32 lg:py-48 relative overflow-hidden">
      {/* B2B ambient gradient */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-700 ${
          context === 'b2b' ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] lg:w-[1200px] h-[600px] lg:h-[800px] rounded-full bg-indigo-900/15 blur-3xl" />
        <div className="absolute top-0 right-0 w-[400px] lg:w-[600px] h-[400px] lg:h-[600px] rounded-full bg-blue-900/10 blur-3xl" />
      </div>

      {/* B2C ambient gradient */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-700 ${
          context === 'b2c' ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] lg:w-[1200px] h-[600px] lg:h-[800px] rounded-full bg-cyan-900/15 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[400px] lg:w-[600px] h-[400px] lg:h-[600px] rounded-full bg-emerald-900/10 blur-3xl" />
      </div>

      <div className="relative max-w-7xl lg:max-w-full mx-auto px-6 lg:px-12">
        {/* Section header */}
        <div className="flex flex-col items-center text-center mb-14 lg:mb-24">
          <p className="text-xs lg:text-sm font-semibold tracking-[0.2em] uppercase text-indigo-400 mb-4 lg:mb-6">
            ¿Para qué lo usas?
          </p>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-10 lg:mb-16 leading-[1.05]">
            Adaptado a tu contexto
          </h2>

          {/* Toggle pill */}
          <div className="inline-flex bg-slate-950 border border-slate-800 p-1 lg:p-2 rounded-full">
            <button
              onClick={() => setContext('b2b')}
              className={`px-6 lg:px-8 py-2 lg:py-3 rounded-full text-sm lg:text-base font-medium transition-all duration-300 ${
                context === 'b2b'
                  ? 'bg-white text-black shadow-lg'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Profesional
            </button>
            <button
              onClick={() => setContext('b2c')}
              className={`px-6 lg:px-8 py-2 lg:py-3 rounded-full text-sm lg:text-base font-medium transition-all duration-300 ${
                context === 'b2c'
                  ? 'bg-white text-black shadow-lg'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Personal
            </button>
          </div>
        </div>

        {/* Bento content — switches between contexts */}
        {context === 'b2b' ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
            {/* Red Team — 2 cols */}
            <div className="md:col-span-2 bg-slate-950/50 border border-slate-900 backdrop-blur-sm rounded-2xl lg:rounded-3xl p-8 lg:p-12 hover:border-indigo-900/50 transition-colors duration-300">
              <div className="flex items-start justify-between mb-10 lg:mb-16">
                <ShieldAlert className="w-8 h-8 lg:w-10 lg:h-10 text-red-400" strokeWidth={1.5} />
                <span className="text-[10px] lg:text-xs font-mono tracking-[0.12em] uppercase text-slate-600 border border-slate-800 rounded-full px-2.5 lg:px-3 py-1 lg:py-1.5">
                  Modo Adversarial
                </span>
              </div>
              <h3 className="text-2xl lg:text-3xl font-bold tracking-tight mb-1.5 lg:mb-3">Simulador Red Team</h3>
              <p className="text-xs lg:text-sm font-medium text-red-400/60 uppercase tracking-[0.15em] mb-5 lg:mb-8">Abogado del Diablo</p>
              <p className="text-slate-400 leading-relaxed text-sm lg:text-base max-w-md lg:max-w-lg">
                Pon a prueba tus planes corporativos contra un agente implacable que busca
                vulnerabilidades ocultas de mercado y riesgos de liquidez. Cada hipótesis
                sale reforzada o eliminada.
              </p>
            </div>

            {/* GROW — 1 col, 2 rows */}
            <div className="md:row-span-2 bg-slate-950/50 border border-slate-900 backdrop-blur-sm rounded-2xl lg:rounded-3xl p-8 lg:p-12 flex flex-col hover:border-indigo-900/50 transition-colors duration-300">
              <Target className="w-8 h-8 lg:w-10 lg:h-10 text-amber-400 mb-10 lg:mb-16" strokeWidth={1.5} />
              <h3 className="text-2xl lg:text-3xl font-bold tracking-tight mb-1.5 lg:mb-3">Facilitador GROW</h3>
              <p className="text-xs lg:text-sm font-medium text-amber-400/60 uppercase tracking-[0.15em] mb-5 lg:mb-8">Para Equipos</p>
              <p className="text-slate-400 leading-relaxed text-sm lg:text-base mb-8 lg:mb-12">
                Una dinámica estructurada guiada por un Coach IA que transforma debates
                abstractos en tableros Kanban de acciones ejecutables.
              </p>
              <div className="mt-auto border-t border-slate-900 pt-6 lg:pt-10 space-y-5 lg:space-y-6">
                {growSteps.map(({ k, name, note, color }) => (
                  <div key={k} className="flex items-center gap-4 lg:gap-5">
                    <span className={`font-bold font-mono text-sm lg:text-base ${color} w-4 shrink-0`}>{k}</span>
                    <span className="text-slate-300 text-sm lg:text-base font-medium flex-1">{name}</span>
                    <span className="text-slate-600 text-xs lg:text-sm font-mono">{note}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Blind Impact — 2 cols */}
            <div className="md:col-span-2 bg-slate-950/50 border border-slate-900 backdrop-blur-sm rounded-2xl lg:rounded-3xl p-8 lg:p-12 hover:border-indigo-900/50 transition-colors duration-300">
              <div className="flex items-start justify-between mb-10 lg:mb-16">
                <EyeOff className="w-8 h-8 lg:w-10 lg:h-10 text-slate-400" strokeWidth={1.5} />
                <span className="text-[10px] lg:text-xs font-mono tracking-[0.12em] uppercase text-slate-600 border border-slate-800 rounded-full px-2.5 lg:px-3 py-1 lg:py-1.5">
                  Anti-sesgo
                </span>
              </div>
              <h3 className="text-2xl lg:text-3xl font-bold tracking-tight mb-1.5 lg:mb-3">Estudio de Impacto Ciego</h3>
              <p className="text-xs lg:text-sm font-medium text-slate-500 uppercase tracking-[0.15em] mb-5 lg:mb-8">Meritocracia de Ideas</p>
              <p className="text-slate-400 leading-relaxed text-sm lg:text-base max-w-md lg:max-w-lg">
                Anonimiza la sala para evaluar las estrategias de la reunión basándote
                exclusivamente en datos y méritos, eliminando los sesgos de jerarquía empresarial.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
            {/* Culinary Lab — 2 cols */}
            <div className="md:col-span-2 bg-slate-950/50 border border-slate-900 backdrop-blur-sm rounded-2xl lg:rounded-3xl p-8 lg:p-12 hover:border-cyan-900/50 transition-colors duration-300">
              <div className="flex items-start justify-between mb-10 lg:mb-16">
                <ChefHat className="w-8 h-8 lg:w-10 lg:h-10 text-cyan-400" strokeWidth={1.5} />
                <span className="text-[10px] lg:text-xs font-mono tracking-[0.12em] uppercase text-slate-600 border border-slate-800 rounded-full px-2.5 lg:px-3 py-1 lg:py-1.5">
                  Alta Precisión
                </span>
              </div>
              <h3 className="text-2xl lg:text-3xl font-bold tracking-tight mb-1.5 lg:mb-3">Laboratorio Culinario</h3>
              <p className="text-xs lg:text-sm font-medium text-cyan-400/60 uppercase tracking-[0.15em] mb-5 lg:mb-8">Gastronomía de Alta Precisión</p>
              <p className="text-slate-400 leading-relaxed text-sm lg:text-base max-w-md lg:max-w-lg">
                Diseña menús o balancea fórmulas de recetas complejas (fats, sugars, stabilizers).
                Explora variantes de sabor en ramas paralelas mientras el panel superior calcula
                los sectores nutricionales en tiempo real.
              </p>
            </div>

            {/* Travel — 1 col, 2 rows */}
            <div className="md:row-span-2 bg-slate-950/50 border border-slate-900 backdrop-blur-sm rounded-2xl lg:rounded-3xl p-8 lg:p-12 flex flex-col hover:border-emerald-900/50 transition-colors duration-300">
              <Compass className="w-8 h-8 lg:w-10 lg:h-10 text-emerald-400 mb-10 lg:mb-16" strokeWidth={1.5} />
              <h3 className="text-2xl lg:text-3xl font-bold tracking-tight mb-1.5 lg:mb-3">Itinerarios y Viajes</h3>
              <p className="text-xs lg:text-sm font-medium text-emerald-400/60 uppercase tracking-[0.15em] mb-5 lg:mb-8">Co-Creación Grupal</p>
              <p className="text-slate-400 leading-relaxed text-sm lg:text-base">
                Termina con el caos de organizar rutas con amigos. Bifurca el viaje para comparar
                destinos alternativos con mapas logísticos y presupuestos grupales dinámicos arriba.
              </p>
            </div>

            {/* Game Master — 2 cols */}
            <div className="md:col-span-2 bg-slate-950/50 border border-slate-900 backdrop-blur-sm rounded-2xl lg:rounded-3xl p-8 lg:p-12 hover:border-purple-900/50 transition-colors duration-300">
              <div className="flex items-start justify-between mb-10 lg:mb-16">
                <Gamepad2 className="w-8 h-8 lg:w-10 lg:h-10 text-purple-400" strokeWidth={1.5} />
                <span className="text-[10px] lg:text-xs font-mono tracking-[0.12em] uppercase text-slate-600 border border-slate-800 rounded-full px-2.5 lg:px-3 py-1 lg:py-1.5">
                  Rol Sincrónico
                </span>
              </div>
              <h3 className="text-2xl lg:text-3xl font-bold tracking-tight mb-1.5 lg:mb-3">Director de Juego</h3>
              <p className="text-xs lg:text-sm font-medium text-purple-400/60 uppercase tracking-[0.15em] mb-5 lg:mb-8">Narración Adaptativa</p>
              <p className="text-slate-400 leading-relaxed text-sm lg:text-base max-w-md lg:max-w-lg">
                Eleva tus noches de juegos de mesa. Los jugadores debaten las decisiones abajo
                en el chat y la IA actúa como narrador, proyectando arriba mapas de entornos
                o árboles de consecuencias.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
