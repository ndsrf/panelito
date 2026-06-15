import Link from 'next/link'
import Image from 'next/image'
import type { LucideIcon } from 'lucide-react'
import {
  GitBranch,
  GitMerge,
  Monitor,
  Key,
  Activity,
  ArrowRight,
  TrendingUp,
  ShieldAlert,
  Target,
  BookOpen,
  Network,
  Scale,
} from 'lucide-react'
import { FeaturesTabs } from '@/components/features-tabs'

type Agent = {
  Icon: LucideIcon
  name: string
  tag: string
  statLabel: 'Asertividad' | 'Neutralidad' | 'Equilibrio'
  statValue: number
  statWidth: string
  statColor: string
  iconColor: string
}

const agents: Agent[] = [
  {
    Icon: TrendingUp,
    name: 'MUTA.ANALISTA',
    tag: 'Síntesis Cuantitativa',
    statLabel: 'Neutralidad',
    statValue: 82,
    statWidth: 'w-[82%]',
    statColor: 'bg-sky-500/60',
    iconColor: 'text-sky-400',
  },
  {
    Icon: ShieldAlert,
    name: 'MUTA.ADVERSARIO',
    tag: 'Red Team',
    statLabel: 'Asertividad',
    statValue: 95,
    statWidth: 'w-[95%]',
    statColor: 'bg-red-500/60',
    iconColor: 'text-red-400',
  },
  {
    Icon: Target,
    name: 'MUTA.COACH',
    tag: 'Framework GROW',
    statLabel: 'Equilibrio',
    statValue: 70,
    statWidth: 'w-[70%]',
    statColor: 'bg-indigo-400/60',
    iconColor: 'text-amber-400',
  },
  {
    Icon: BookOpen,
    name: 'MUTA.RIGORISTA',
    tag: 'Rigor Clínico',
    statLabel: 'Neutralidad',
    statValue: 88,
    statWidth: 'w-[88%]',
    statColor: 'bg-sky-500/60',
    iconColor: 'text-slate-300',
  },
  {
    Icon: Network,
    name: 'MUTA.ESTRATEGA',
    tag: 'Visión Sistémica',
    statLabel: 'Asertividad',
    statValue: 73,
    statWidth: 'w-[73%]',
    statColor: 'bg-amber-500/60',
    iconColor: 'text-amber-400',
  },
  {
    Icon: Scale,
    name: 'MUTA.MEDIADOR',
    tag: 'Dialéctica Socrática',
    statLabel: 'Neutralidad',
    statValue: 94,
    statWidth: 'w-[94%]',
    statColor: 'bg-sky-500/60',
    iconColor: 'text-purple-400',
  },
]

export default function LandingPage() {
  return (
    <div className="bg-black text-slate-100 overflow-x-hidden">

      {/* ── NAV ──────────────────────────────────────────────────── */}
      <header className="fixed top-0 inset-x-0 z-50 border-b border-white/[0.04] bg-black/70 backdrop-blur-xl">
        <nav className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect width="32" height="32" rx="6" fill="#0F172A"/>
              <path d="M11 22V10H17C18.6569 10 20 11.3431 20 13C20 14.6569 18.6569 16 17 16H11" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="22" cy="22" r="2" fill="#38BDF8"/>
              <circle cx="24" cy="12" r="1.5" fill="#818CF8"/>
              <circle cx="8" cy="18" r="1.5" fill="#F472B6"/>
            </svg>
            <span className="text-sm font-bold tracking-wider text-white">Panelito</span>
          </div>
          <Link
            href="/auth/sign-in"
            className="text-sm bg-white text-black px-4 py-1.5 rounded-md font-medium hover:bg-slate-200 transition-all"
          >
            Entrar →
          </Link>
        </nav>
      </header>

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="relative pt-14 min-h-[88vh] flex flex-col justify-center overflow-hidden">
        {/* Dot grid */}
        <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:32px_32px] opacity-30 pointer-events-none" />

        {/* Ambient glows */}
        <div className="absolute -top-64 left-1/2 -translate-x-1/2 w-[900px] h-[700px] rounded-full bg-indigo-900/20 blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 right-0 w-[350px] h-[500px] rounded-full bg-cyan-900/8 blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 py-28">
          {/* Badge */}
          <div className="mb-10">
            <span className="inline-flex items-center gap-2 text-xs text-slate-400 bg-white/5 border border-white/10 rounded-full px-3 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              Beta Abierta
            </span>
          </div>

          {/* H1 */}
          <h1 className="text-5xl sm:text-6xl lg:text-[5.25rem] font-bold tracking-tight leading-[0.92] max-w-5xl">
            Desata la Inteligencia
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-br from-white via-slate-300 to-slate-600">
              Colectiva de tus Reuniones
            </span>
          </h1>

          {/* Subtitle + CTA */}
          <div className="mt-12 flex flex-col lg:flex-row lg:items-end justify-between gap-10 max-w-5xl">
            <p className="text-slate-400 text-base md:text-lg leading-relaxed max-w-lg">
              El primer espacio de debate síncrono potenciado por IA con árbol de conversación
              ramificado y análisis visual en tiempo real. Divide la pantalla, explora hipótesis
              paralelas y fusiona ideas sin perder el rumbo.
            </p>
            <div className="shrink-0">
              <Link
                href="/auth/sign-in"
                className="inline-flex items-center gap-2.5 bg-white text-black px-7 py-3.5 rounded-lg text-sm font-medium hover:bg-slate-200 transition-all"
              >
                Entrar a la Aplicación
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── HERO MOCKUP ──────────────────────────────────────────── */}
      <div className="relative px-4 sm:px-6 pb-4">
        <div className="absolute inset-x-0 top-0 flex justify-center pointer-events-none">
          <div className="w-[700px] h-[120px] bg-indigo-500/25 blur-3xl opacity-20 rounded-full" />
        </div>
        <div className="max-w-7xl mx-auto">
          <div className="border border-slate-800/50 rounded-xl overflow-hidden shadow-2xl shadow-black/60">
            <Image
              src="/hero.svg"
              alt="Interfaz Panelito — panel analítico sincronizado con árbol de conversación ramificado en tiempo real"
              width={1200}
              height={750}
              className="w-full h-auto"
              priority
              unoptimized
            />
          </div>
        </div>
      </div>

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
            {agents.map(({ Icon, name, tag, statLabel, statValue, statWidth, statColor, iconColor }) => (
              <div
                key={name}
                className="bg-slate-950/40 border border-slate-900 rounded-xl p-6 hover:border-indigo-500/50 transition-all group"
              >
                {/* Avatar + identity */}
                <div className="flex items-start gap-4 mb-6">
                  <div className="w-10 h-10 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0 group-hover:border-indigo-800/60 transition-colors">
                    <Icon className={`w-5 h-5 ${iconColor}`} strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold font-mono tracking-[0.1em] text-slate-200 mb-1.5 truncate">
                      {name}
                    </p>
                    <span className="inline-block text-[10px] font-mono tracking-wider text-slate-500 border border-slate-800 rounded-full px-2 py-0.5">
                      [{tag}]
                    </span>
                  </div>
                </div>

                {/* Stat bar */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-slate-700">
                      {statLabel}
                    </span>
                    <span className="text-[10px] font-mono text-slate-700">{statValue}%</span>
                  </div>
                  <div className="h-px bg-slate-900 rounded-full overflow-hidden">
                    <div className={`h-full ${statWidth} ${statColor} rounded-full`} />
                  </div>
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
