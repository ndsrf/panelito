'use client'

import { ArrowRight } from 'lucide-react'
import { useLoginStore } from '@/store/login-store'

export function HeroEntrar() {
  const openPanel = useLoginStore((s) => s.openPanel)

  return (
    <button
      onClick={openPanel}
      className="inline-flex items-center gap-2.5 bg-white text-black px-7 py-3.5 rounded-lg text-sm font-medium hover:bg-slate-200 transition-all cursor-pointer"
    >
      Entrar a la Aplicación
      <ArrowRight className="w-4 h-4" />
    </button>
  )
}
