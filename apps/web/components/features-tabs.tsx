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
    <section className="py-32 relative overflow-hidden">
      {/* B2B ambient gradient */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-700 ${
          context === 'b2b' ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] rounded-full bg-indigo-900/15 blur-3xl" />
        <div className="absolute top-0 right-0 w-[400px] h-[400px] rounded-full bg-blue-900/10 blur-3xl" />
      </div>

      {/* B2C ambient gradient */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-700 ${
          context === 'b2c' ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] rounded-full bg-cyan-900/15 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-emerald-900/10 blur-3xl" />
      </div>

      <div className="relative max-w-7xl mx-auto px-6">
        {/* Section header */}
        <div className="flex flex-col items-center text-center mb-14">
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-indigo-400 mb-4">
            ¿Para qué lo usas?
          </p>
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-10 leading-[1.05]">
            Adaptado a tu contexto
          </h2>

          {/* Toggle pill */}
          <div className="inline-flex bg-slate-950 border border-slate-800 p-1 rounded-full">
            <button
              onClick={() => setContext('b2b')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
                context === 'b2b'
                  ? 'bg-white text-black shadow-lg'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Profesional
            </button>
            <button
              onClick={() => setContext('b2c')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Red Team — 2 cols */}
            <div className="md:col-span-2 bg-slate-950/50 border border-slate-900 backdrop-blur-sm rounded-2xl p-8 hover:border-indigo-900/50 transition-colors duration-300">
              <div className="flex items-start justify-between mb-10">
                <ShieldAlert className="w-8 h-8 text-red-400" strokeWidth={1.5} />
                <span className="text-[10px] font-mono tracking-[0.12em] uppercase text-slate-600 border border-slate-800 rounded-full px-2.5 py-1">
                  Modo Adversarial
                </span>
              </div>
              <h3 className="text-2xl font-bold tracking-tight mb-1.5">Simulador Red Team</h3>
              <p className="text-xs font-medium text-red-400/60 uppercase tracking-[0.15em] mb-5">Abogado del Diablo</p>
              <p className="text-slate-400 leading-relaxed text-sm max-w-md">
                Pon a prueba tus planes corporativos contra un agente implacable que busca
                vulnerabilidades ocultas de mercado y riesgos de liquidez. Cada hipótesis
                sale reforzada o eliminada.
              </p>
            </div>

            {/* GROW — 1 col, 2 rows */}
            <div className="md:row-span-2 bg-slate-950/50 border border-slate-900 backdrop-blur-sm rounded-2xl p-8 flex flex-col hover:border-indigo-900/50 transition-colors duration-300">
              <Target className="w-8 h-8 text-amber-400 mb-10" strokeWidth={1.5} />
              <h3 className="text-2xl font-bold tracking-tight mb-1.5">Facilitador GROW</h3>
              <p className="text-xs font-medium text-amber-400/60 uppercase tracking-[0.15em] mb-5">Para Equipos</p>
              <p className="text-slate-400 leading-relaxed text-sm mb-8">
                Una dinámica estructurada guiada por un Coach IA que transforma debates
                abstractos en tableros Kanban de acciones ejecutables.
              </p>
              <div className="mt-auto border-t border-slate-900 pt-6 space-y-5">
                {growSteps.map(({ k, name, note, color }) => (
                  <div key={k} className="flex items-center gap-4">
                    <span className={`font-bold font-mono text-sm ${color} w-4 shrink-0`}>{k}</span>
                    <span className="text-slate-300 text-sm font-medium flex-1">{name}</span>
                    <span className="text-slate-600 text-xs font-mono">{note}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Blind Impact — 2 cols */}
            <div className="md:col-span-2 bg-slate-950/50 border border-slate-900 backdrop-blur-sm rounded-2xl p-8 hover:border-indigo-900/50 transition-colors duration-300">
              <div className="flex items-start justify-between mb-10">
                <EyeOff className="w-8 h-8 text-slate-400" strokeWidth={1.5} />
                <span className="text-[10px] font-mono tracking-[0.12em] uppercase text-slate-600 border border-slate-800 rounded-full px-2.5 py-1">
                  Anti-sesgo
                </span>
              </div>
              <h3 className="text-2xl font-bold tracking-tight mb-1.5">Estudio de Impacto Ciego</h3>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-[0.15em] mb-5">Meritocracia de Ideas</p>
              <p className="text-slate-400 leading-relaxed text-sm max-w-md">
                Anonimiza la sala para evaluar las estrategias de la reunión basándote
                exclusivamente en datos y méritos, eliminando los sesgos de jerarquía empresarial.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Culinary Lab — 2 cols */}
            <div className="md:col-span-2 bg-slate-950/50 border border-slate-900 backdrop-blur-sm rounded-2xl p-8 hover:border-cyan-900/50 transition-colors duration-300">
              <div className="flex items-start justify-between mb-10">
                <ChefHat className="w-8 h-8 text-cyan-400" strokeWidth={1.5} />
                <span className="text-[10px] font-mono tracking-[0.12em] uppercase text-slate-600 border border-slate-800 rounded-full px-2.5 py-1">
                  Alta Precisión
                </span>
              </div>
              <h3 className="text-2xl font-bold tracking-tight mb-1.5">Laboratorio Culinario</h3>
              <p className="text-xs font-medium text-cyan-400/60 uppercase tracking-[0.15em] mb-5">Gastronomía de Alta Precisión</p>
              <p className="text-slate-400 leading-relaxed text-sm max-w-md">
                Diseña menús o balancea fórmulas de recetas complejas (fats, sugars, stabilizers).
                Explora variantes de sabor en ramas paralelas mientras el panel superior calcula
                los sectores nutricionales en tiempo real.
              </p>
            </div>

            {/* Travel — 1 col, 2 rows */}
            <div className="md:row-span-2 bg-slate-950/50 border border-slate-900 backdrop-blur-sm rounded-2xl p-8 flex flex-col hover:border-emerald-900/50 transition-colors duration-300">
              <Compass className="w-8 h-8 text-emerald-400 mb-10" strokeWidth={1.5} />
              <h3 className="text-2xl font-bold tracking-tight mb-1.5">Itinerarios y Viajes</h3>
              <p className="text-xs font-medium text-emerald-400/60 uppercase tracking-[0.15em] mb-5">Co-Creación Grupal</p>
              <p className="text-slate-400 leading-relaxed text-sm">
                Termina con el caos de organizar rutas con amigos. Bifurca el viaje para comparar
                destinos alternativos con mapas logísticos y presupuestos grupales dinámicos arriba.
              </p>
            </div>

            {/* Game Master — 2 cols */}
            <div className="md:col-span-2 bg-slate-950/50 border border-slate-900 backdrop-blur-sm rounded-2xl p-8 hover:border-purple-900/50 transition-colors duration-300">
              <div className="flex items-start justify-between mb-10">
                <Gamepad2 className="w-8 h-8 text-purple-400" strokeWidth={1.5} />
                <span className="text-[10px] font-mono tracking-[0.12em] uppercase text-slate-600 border border-slate-800 rounded-full px-2.5 py-1">
                  Rol Sincrónico
                </span>
              </div>
              <h3 className="text-2xl font-bold tracking-tight mb-1.5">Director de Juego</h3>
              <p className="text-xs font-medium text-purple-400/60 uppercase tracking-[0.15em] mb-5">Narración Adaptativa</p>
              <p className="text-slate-400 leading-relaxed text-sm max-w-md">
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
