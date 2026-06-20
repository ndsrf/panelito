import { create } from 'zustand'

interface LoginStore {
  open: boolean
  openPanel: () => void
  closePanel: () => void
}

export const useLoginStore = create<LoginStore>((set) => ({
  open: false,
  openPanel: () => set({ open: true }),
  closePanel: () => set({ open: false }),
}))
