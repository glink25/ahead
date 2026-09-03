import type { AuthSession } from '@ahead/core'
import type { UserData } from '@ahead/schema'
import { create } from 'zustand'

interface AuthSessionStore {
  session: AuthSession | null
  loading: boolean
  setSession: (session: AuthSession | null) => void
  setLoading: (loading: boolean) => void
}

export const useAuthSession = create<AuthSessionStore>((set) => ({
  session: null,
  loading: true,
  setSession: (session) => set({ session }),
  setLoading: (loading) => set({ loading }),
}))

interface ActiveProfileStore {
  profile: UserData | null
  setProfile: (profile: UserData | null) => void
}

export const useActiveProfile = create<ActiveProfileStore>((set) => ({
  profile: null,
  setProfile: (profile) => set({ profile }),
}))

interface UiStore {
  mobileNavOpen: boolean
  setMobileNavOpen: (open: boolean) => void
}

export const useUi = create<UiStore>((set) => ({
  mobileNavOpen: false,
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
}))
