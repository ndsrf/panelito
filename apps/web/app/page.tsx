import Link from 'next/link'
import {
  GitBranch,
  GitMerge,
  Monitor,
  Key,
  Activity,
  ArrowRight,
} from 'lucide-react'
import { FeaturesTabs } from '@/components/features-tabs'
import { HeroPixels } from '@/components/hero-pixels'
import { HeroCarousel } from '@/components/hero-carousel'
import { ScrollLogo } from '@/components/scroll-logo'

// ── Portrait SVGs ──────────────────────────────────────────────────────────────
// Stroke-only line art, 40×40 viewBox. Color comes from the parent (currentColor).

function EinsteinPortrait() {
  return (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Wild hair */}
      <path d="M10 19C10 10 13 4 20 4C27 4 30 10 30 19" strokeWidth="1.5"/>
      <path d="M10 15C8 9 12 4 11 7" strokeWidth="1"/>
      <path d="M30 15C32 9 28 4 29 7" strokeWidth="1"/>
      {/* Face */}
      <ellipse cx="20" cy="23" rx="9" ry="10" strokeWidth="1.5"/>
      {/* Round glasses */}
      <circle cx="16" cy="22" r="3" strokeWidth="1"/>
      <circle cx="24" cy="22" r="3" strokeWidth="1"/>
      <line x1="19" y1="22" x2="21" y2="22" strokeWidth="1"/>
      <line x1="13" y1="21" x2="11" y2="20" strokeWidth="1"/>
      {/* Mustache */}
      <path d="M16 28Q20 31 24 28" strokeWidth="1.5"/>
      {/* Shoulders */}
      <path d="M6 38C8 32 13 30 20 30C27 30 32 32 34 38" strokeWidth="1.5"/>
    </svg>
  )
}

function DescartesPortrait() {
  return (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Long 17th-century hair, flows to shoulders */}
      <path d="M11 18C10 10 13 4 20 4C27 4 30 10 29 18" strokeWidth="1.5"/>
      <path d="M11 18C9 25 9 33 11 37" strokeWidth="1.5"/>
      <path d="M29 18C31 25 31 33 29 37" strokeWidth="1.5"/>
      {/* Face */}
      <ellipse cx="20" cy="21" rx="9" ry="10" strokeWidth="1.5"/>
      {/* Period thin mustache */}
      <path d="M16 27Q20 29 24 27" strokeWidth="1"/>
      {/* Lace collar zigzag */}
      <path d="M11 33C13 30 15 32 17 30C19 32 21 30 23 32C25 30 27 32 29 33" strokeWidth="1"/>
      {/* Shoulders */}
      <path d="M6 38C8 34 12 32 20 32C28 32 32 34 34 38" strokeWidth="1.5"/>
    </svg>
  )
}

function SocratesPortrait() {
  return (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Bald head */}
      <circle cx="20" cy="17" r="11" strokeWidth="1.5"/>
      {/* Full beard */}
      <path d="M9 22C8 29 12 36 16 37C18 38 22 38 24 37C28 36 32 29 31 22" strokeWidth="1.5"/>
      <path d="M13 29C16 33 20 35 20 35" strokeWidth="1"/>
      <path d="M27 29C24 33 20 35 20 35" strokeWidth="1"/>
      {/* Toga */}
      <path d="M5 40C7 33 12 31 20 31C28 31 33 33 35 40" strokeWidth="1.5"/>
    </svg>
  )
}

function CuriePortrait() {
  return (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Hair bun */}
      <ellipse cx="20" cy="8" rx="5" ry="4" strokeWidth="1.5"/>
      <line x1="15" y1="10" x2="13" y2="14" strokeWidth="1.5"/>
      <line x1="25" y1="10" x2="27" y2="14" strokeWidth="1.5"/>
      {/* Face */}
      <ellipse cx="20" cy="22" rx="9" ry="10" strokeWidth="1.5"/>
      {/* High collar blouse */}
      <path d="M13 31C14 34 20 35 20 35C20 35 26 34 27 31" strokeWidth="1"/>
      {/* Shoulders */}
      <path d="M6 38C8 33 13 31 20 31C27 31 32 33 34 38" strokeWidth="1.5"/>
    </svg>
  )
}

function SunTzuPortrait() {
  return (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Topknot */}
      <ellipse cx="20" cy="7" rx="3" ry="3" strokeWidth="1.5"/>
      <line x1="20" y1="4" x2="20" y2="2" strokeWidth="2"/>
      {/* Head */}
      <circle cx="20" cy="19" r="11" strokeWidth="1.5"/>
      {/* Sparse goatee */}
      <path d="M18 28C19 32 21 32 22 28" strokeWidth="1.5"/>
      {/* Robe collar */}
      <path d="M10 30C11 27 15 26 20 26C25 26 29 27 30 30" strokeWidth="1.5"/>
      <path d="M5 38C7 33 12 31 20 31C28 31 33 33 35 38" strokeWidth="1.5"/>
    </svg>
  )
}

function DarwinPortrait() {
  return (
    <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Balding head — hair on sides only */}
      <path d="M12 17C12 10 15 5 20 5C25 5 28 10 28 17" strokeWidth="1.5"/>
      <path d="M11 17C10 13 11 9 12 10" strokeWidth="1"/>
      <path d="M29 17C30 13 29 9 28 10" strokeWidth="1"/>
      {/* Face */}
      <ellipse cx="20" cy="21" rx="9" ry="10" strokeWidth="1.5"/>
      {/* Long patriarch beard */}
      <path d="M11 25C9 30 10 37 14 39C17 40 20 40 20 40C20 40 23 40 26 39C30 37 31 30 29 25" strokeWidth="1.5"/>
      <path d="M13 33C16 37 20 38 20 38" strokeWidth="1"/>
      <path d="M27 33C24 37 20 38 20 38" strokeWidth="1"/>
    </svg>
  )
}

// ── Agent roster ───────────────────────────────────────────────────────────────

type Stat = { label: string; value: number; width: string; color: string }

type Agent = {
  Portrait: () => React.ReactElement
  name: string
  tag: string
  stats: [Stat, Stat, Stat]
}

const agents: Agent[] = [
  {
    Portrait: EinsteinPortrait,
    name: 'Albert Einstein',
    tag: 'Síntesis Cuantitativa',
    stats: [
      { label: 'Neutralidad',  value: 82, width: 'w-[82%]', color: 'bg-sky-500/60' },
      { label: 'Rigor',        value: 94, width: 'w-[94%]', color: 'bg-indigo-400/60' },
      { label: 'Síntesis',     value: 88, width: 'w-[88%]', color: 'bg-emerald-400/60' },
    ],
  },
  {
    Portrait: DescartesPortrait,
    name: 'René Descartes',
    tag: 'Duda Metódica / Red Team',
    stats: [
      { label: 'Asertividad',  value: 95, width: 'w-[95%]', color: 'bg-red-500/60' },
      { label: 'Rigor',        value: 91, width: 'w-[91%]', color: 'bg-indigo-400/60' },
      { label: 'Crítica',      value: 97, width: 'w-[97%]', color: 'bg-red-600/60' },
    ],
  },
  {
    Portrait: SocratesPortrait,
    name: 'Sócrates',
    tag: 'Método Maiéutico',
    stats: [
      { label: 'Equilibrio',   value: 68, width: 'w-[68%]', color: 'bg-indigo-400/60' },
      { label: 'Empatía',      value: 85, width: 'w-[85%]', color: 'bg-purple-400/60' },
      { label: 'Síntesis',     value: 76, width: 'w-[76%]', color: 'bg-emerald-400/60' },
    ],
  },
  {
    Portrait: CuriePortrait,
    name: 'Marie Curie',
    tag: 'Rigor Clínico',
    stats: [
      { label: 'Neutralidad',  value: 88, width: 'w-[88%]', color: 'bg-sky-500/60' },
      { label: 'Rigor',        value: 97, width: 'w-[97%]', color: 'bg-indigo-400/60' },
      { label: 'Pragmatismo',  value: 80, width: 'w-[80%]', color: 'bg-amber-500/60' },
    ],
  },
  {
    Portrait: SunTzuPortrait,
    name: 'Sun Tzu',
    tag: 'Arte de la Estrategia',
    stats: [
      { label: 'Asertividad',  value: 79, width: 'w-[79%]', color: 'bg-amber-500/60' },
      { label: 'Síntesis',     value: 88, width: 'w-[88%]', color: 'bg-emerald-400/60' },
      { label: 'Pragmatismo',  value: 92, width: 'w-[92%]', color: 'bg-amber-400/60' },
    ],
  },
  {
    Portrait: DarwinPortrait,
    name: 'Charles Darwin',
    tag: 'Síntesis Sistémica',
    stats: [
      { label: 'Neutralidad',  value: 91, width: 'w-[91%]', color: 'bg-sky-500/60' },
      { label: 'Síntesis',     value: 95, width: 'w-[95%]', color: 'bg-emerald-400/60' },
      { label: 'Rigor',        value: 87, width: 'w-[87%]', color: 'bg-indigo-400/60' },
    ],
  },
]

export default function LandingPage() {
  return (
    <div className="bg-black text-slate-100 overflow-x-hidden">

      {/* ── NAV ──────────────────────────────────────────────────── */}
      <header className="fixed top-0 inset-x-0 z-50 border-b border-white/[0.04] bg-black/70 backdrop-blur-xl">
        <nav className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <ScrollLogo />
          <Link
            href="/auth/sign-in"
            className="text-sm bg-white text-black px-4 py-1.5 rounded-md font-medium hover:bg-slate-200 transition-all"
          >
            Entrar →
          </Link>
        </nav>
      </header>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="relative pt-14 min-h-screen flex flex-col justify-center overflow-hidden">
        {/* Dot grid */}
        <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:32px_32px] opacity-30 pointer-events-none" />

        {/* Ambient glows */}
        <div className="absolute -top-64 left-1/2 -translate-x-1/2 w-[900px] h-[700px] rounded-full bg-indigo-900/20 blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 right-0 w-[350px] h-[500px] rounded-full bg-cyan-900/8 blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 py-12 w-full">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] gap-10 lg:gap-14 items-center">

            {/* Left column: text + CTA */}
            <div className="flex flex-col gap-7">
              {/* Badge */}
              <div>
                <span className="inline-flex items-center gap-2 text-xs text-slate-400 bg-white/5 border border-white/10 rounded-full px-3 py-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  Beta Abierta
                </span>
              </div>

              {/* H1 */}
              <div className="relative inline-block">
                <HeroPixels />
                <h1 className="text-4xl sm:text-5xl lg:text-5xl xl:text-[3.5rem] font-bold tracking-tight leading-[0.92]">
                  Desata la Inteligencia
                  <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-br from-white via-slate-300 to-slate-600">
                    Colectiva de tus Reuniones
                  </span>
                </h1>
              </div>

              {/* Subtitle */}
              <p className="text-slate-400 text-base leading-relaxed">
                Debate en grupo con IA en tiempo real. Ramifica ideas, explora caminos en
                paralelo y fusiona lo mejor sin perder el hilo.
              </p>

              {/* CTA */}
              <div>
                <Link
                  href="/auth/sign-in"
                  className="inline-flex items-center gap-2.5 bg-white text-black px-7 py-3.5 rounded-lg text-sm font-medium hover:bg-slate-200 transition-all"
                >
                  Entrar a la Aplicación
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            {/* Right column: Carousel */}
            <HeroCarousel />
          </div>
        </div>
      </section>

      {/* ── WORKFLOW ─────────────────────────────────────────────── */}
      <section className="py-32">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-baseline justify-between mb-16">
            <p className="text-xs font-semibold tracking-[0.2em] uppercase text-indigo-400">
              El flujo de trabajo Panelito
            </p>
            <p className="text-xs text-slate-800 font-mono hidden sm:block">core / 3 mecánicas</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-slate-900 border border-slate-900 rounded-2xl overflow-hidden">
            <div className="bg-black p-8 xl:p-12 flex flex-col gap-7">
              <GitBranch className="w-7 h-7 text-indigo-400" strokeWidth={1.5} />
              <div>
                <p className="text-[10px] font-mono text-slate-800 mb-3 tracking-widest">01</p>
                <h3 className="text-xl font-semibold tracking-tight mb-1">Bifurcación Instantánea</h3>
                <p className="text-xs font-medium text-indigo-400 uppercase tracking-[0.18em] mb-5">Forking</p>
                <p className="text-slate-500 text-sm leading-relaxed">
                  Mantén pulsado cualquier mensaje para abrir una línea temporal alternativa.
                  Explora escenarios en paralelo sin romper el hilo principal.
                </p>
              </div>
            </div>

            <div className="bg-black p-8 xl:p-12 flex flex-col gap-7">
              <Monitor className="w-7 h-7 text-cyan-400" strokeWidth={1.5} />
              <div>
                <p className="text-[10px] font-mono text-slate-800 mb-3 tracking-widest">02</p>
                <h3 className="text-xl font-semibold tracking-tight mb-1">Panel Analítico Sincronizado</h3>
                <p className="text-xs font-medium text-cyan-400 uppercase tracking-[0.18em] mb-5">40 / 60 Split</p>
                <p className="text-slate-500 text-sm leading-relaxed">
                  El 40% superior muestra radares de riesgo, matrices estratégicas y tableros
                  de control que mutan en vivo según el contexto del chat inferior.
                </p>
              </div>
            </div>

            <div className="bg-black p-8 xl:p-12 flex flex-col gap-7">
              <GitMerge className="w-7 h-7 text-emerald-400" strokeWidth={1.5} />
              <div>
                <p className="text-[10px] font-mono text-slate-800 mb-3 tracking-widest">03</p>
                <h3 className="text-xl font-semibold tracking-tight mb-1">Fusión de Caminos</h3>
                <p className="text-xs font-medium text-emerald-400 uppercase tracking-[0.18em] mb-5">Merge</p>
                <p className="text-slate-500 text-sm leading-relaxed">
                  Combina los mejores atributos de dos ramas independientes en un único
                  vector de consenso mediante síntesis inteligente de IA.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES CONTEXT TABS (client component) ─────────────── */}
      <FeaturesTabs />

      {/* ── AGENT ROSTER ─────────────────────────────────────────── */}
      <section className="py-32 border-t border-slate-900">
        <div className="max-w-7xl mx-auto px-6">
          {/* Header with floating badge */}
          <div className="mb-16 relative">
            <div className="absolute -top-6 right-0 hidden sm:inline-flex items-center gap-1.5 bg-indigo-950/80 border border-indigo-800/50 text-indigo-300 text-xs px-3 py-1.5 rounded-full backdrop-blur-sm whitespace-nowrap">
              🧠 Personalizables: Crea tus propios prompts de identidad en v2
            </div>
            <p className="text-xs font-semibold tracking-[0.2em] uppercase text-indigo-400 mb-5">
              Agentes Modulares
            </p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 max-w-2xl leading-[1.05]">
              Una biblioteca de mentes a tu disposición
            </h2>
            <p className="text-slate-400 max-w-xl leading-relaxed">
              No hables con una IA genérica. Invoca a un comité de expertos modulares
              adaptados a la naturaleza de tu debate.
            </p>
          </div>

          {/* Agent cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map(({ Portrait, name, tag, stats }) => (
              <div
                key={name}
                className="bg-slate-950/40 border border-slate-900 rounded-xl p-6 hover:border-indigo-500/50 transition-all group"
              >
                {/* Avatar + identity */}
                <div className="flex items-start gap-4 mb-6">
                  <div className="w-12 h-12 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0 p-1.5 text-slate-600 group-hover:text-slate-300 group-hover:border-slate-700 transition-all">
                    <Portrait />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-200 mb-1.5 leading-tight">
                      {name}
                    </p>
                    <span className="inline-block text-[10px] font-mono tracking-wider text-slate-500 border border-slate-800 rounded-full px-2 py-0.5">
                      [{tag}]
                    </span>
                  </div>
                </div>

                {/* 3 stat bars */}
                <div className="space-y-3">
                  {stats.map(({ label, value, width, color }) => (
                    <div key={label}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-mono uppercase tracking-widest text-slate-700">
                          {label}
                        </span>
                        <span className="text-[10px] font-mono text-slate-700">{value}%</span>
                      </div>
                      <div className="h-px bg-slate-900 rounded-full overflow-hidden">
                        <div className={`h-full ${width} ${color} rounded-full`} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BYOK ─────────────────────────────────────────────────── */}
      <section className="py-24 border-t border-slate-900">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row items-start gap-20">
            <div className="flex-1 max-w-md">
              <Key className="w-7 h-7 text-slate-500 mb-8" strokeWidth={1.5} />
              <h2 className="text-4xl font-bold tracking-tight mb-6 leading-[1.05]">
                Tu software.
                <br />
                Tu infraestructura.
              </h2>
              <p className="text-slate-400 leading-relaxed">
                Conecta tu propia llave de acceso de IA en un solo clic y mantén el control
                absoluto de tus costes y tokens. Cero margen de plataforma. Cero opacidad.
                Tu API key, tus reglas.
              </p>
            </div>

            <div className="flex-1 w-full max-w-xl">
              <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 bg-slate-900/50 border-b border-slate-800">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-red-900/60" />
                    <div className="w-3 h-3 rounded-full bg-amber-900/60" />
                    <div className="w-3 h-3 rounded-full bg-emerald-900/60" />
                  </div>
                  <span className="ml-2 text-slate-600 text-xs font-mono">.env.local</span>
                </div>
                <div className="p-6 font-mono text-[13px] leading-7 space-y-0.5">
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
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <footer className="border-t border-slate-900 py-12">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6 sm:gap-10">
            <div className="flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <rect width="32" height="32" rx="6" fill="#0F172A"/>
                <path d="M11 22V10H17C18.6569 10 20 11.3431 20 13C20 14.6569 18.6569 16 17 16H11" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="22" cy="22" r="2" fill="#38BDF8"/>
                <circle cx="24" cy="12" r="1.5" fill="#818CF8"/>
                <circle cx="8" cy="18" r="1.5" fill="#F472B6"/>
              </svg>
              <span className="text-xs font-bold tracking-widest uppercase text-slate-700">Panelito</span>
            </div>
            <div className="flex items-center gap-6 text-xs text-slate-700">
              <Link href="/auth/sign-in" className="hover:text-slate-400 transition-colors">Acceder</Link>
              <span className="cursor-default hover:text-slate-400 transition-colors">Documentación</span>
              <span className="cursor-default hover:text-slate-400 transition-colors">Privacidad</span>
              <span>© 2026</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs text-emerald-400 font-medium">Todos los sistemas operativos</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
