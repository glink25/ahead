import {
  database,
  initializeData,
  activeSpace,
  mutateProfile,
  replaceLocalProfile,
} from '../data/local'
import { materializeProfile, PERSONAL_FEED } from '../data/model'
import { create } from 'zustand'
import { useAuthSession } from '../stores'
import { sourceKey } from '@ahead/protocol'
import type { Subscription, UserData } from '@ahead/schema'
import { emptyProfile, type ProfileAction } from '../lib/local-profile'
import type { MarketListing } from '../lib/market'
import type { LoadedFeed } from '../lib/feed-loader'
import { marketApi } from '../services/market'
import type { ReadEvent } from '../services/market-api'
import { isAbort } from '../services/public-read-client'
import type { ExposureSignal } from '@ahead/recommendation'
import type { DiscoverMarketSession, MarketEvent } from '../services/market-api'
import { discoverHistory } from '../services/discover-history'

export type MarketStatus =
  'idle' | 'initial' | 'appending' | 'paused' | 'complete' | 'failed'
interface FeedStore {
  profile: UserData
  feeds: LoadedFeed[]
  listings: MarketListing[]
  users: { user: UserData; sourceLocator: string }[]
  refreshing: boolean
  hydrated: boolean
  errors: string[]
  loginSuggested: boolean
  marketStatus: MarketStatus
  marketLoaded: number
  marketActive: boolean
  discoverAvailable: number
  exposures: Record<string, ExposureSignal>
  revision: number
  undoProfile?: UserData
  undoOperation?: { id: string; spaceId: string }
  expireUndo(id: string): void
  initialize(): Promise<void>
  refresh(options?: { force?: boolean; restart?: boolean }): Promise<void>
  retry(): Promise<void>
  setMarketActive(active: boolean): void
  reportDiscoverVisible(eventId: string, index: number, available: number): void
  setDiscoverAvailable(available: number): void
  act(action: ProfileAction): void
  undo(id?: string): Promise<void>
  replaceProfile(profile: UserData): void
}
let initializing: Promise<void> | undefined
let sourcesController: AbortController | undefined
let generation = 0
let undoGeneration = 0
let marketSession: DiscoverMarketSession | undefined
const sessionSeen = new Set<string>()
const localWriteError = 'messages.could_not_save_check_browser_storage_permissions_and_retry'

export const useFeedStore = create<FeedStore>((set, get) => {
  const updateRefreshing = () => set((state) => ({
    refreshing: Boolean(sourcesController) || state.marketStatus === 'initial' || state.marketStatus === 'appending',
  }))
  const receive = (event: ReadEvent) => {
    if (event.type === 'feed')
      set((s) => {
        const feeds = [
          ...s.feeds.filter(
            (f) => f.sourceLocator !== event.feed.sourceLocator,
          ),
          event.feed,
        ]
        const market = new Set(s.listings.filter((item) => item.source.resourceType === 'event-feed').map((item) => sourceKey(item.source)))
        const retainedMarket = feeds.filter((feed) => market.has(feed.sourceLocator)).slice(-40)
        const retained = new Set(retainedMarket.map((feed) => feed.sourceLocator))
        return { feeds: feeds.filter((feed) => !market.has(feed.sourceLocator) || retained.has(feed.sourceLocator)) }
      })
    if (event.type === 'user')
      set((s) => ({
        users: [
          ...s.users.filter((u) => u.sourceLocator !== event.sourceLocator),
          { user: event.user, sourceLocator: event.sourceLocator },
        ],
      }))
    if (event.type === 'error')
      set((s) => ({
        errors: [...new Set([...s.errors, event.message])],
        loginSuggested:
          s.loginSuggested || (event.limited && event.authenticated === false),
      }))
  }
  const receiveMarket = (event: MarketEvent) => {
    if (event.type === 'listings') set((state) => ({
      listings: [...new Map([...state.listings, ...event.listings].map((item) => [sourceKey(item.source), item])).values()].slice(-60),
    }))
    else if (event.type === 'progress') set({ marketLoaded: event.loaded })
    else receive(event)
  }
  const ensureMarketSession = () => marketSession ??= marketApi().market.openSession({
    receive: receiveMarket,
    status: (status) => {
      set({ marketStatus: status === 'restoring' ? 'initial' : status === 'expanding' ? 'appending' : status })
      updateRefreshing()
    },
    available: () => get().discoverAvailable,
  })
  return {
    profile: emptyProfile(),
    feeds: [],
    listings: [],
    users: [],
    refreshing: false,
    hydrated: false,
    errors: [],
    loginSuggested: false,
    marketStatus: 'idle',
    marketLoaded: 0,
    marketActive: false,
    discoverAvailable: 0,
    exposures: {},
    revision: 0,
    initialize() {
      initializing ??= (async () => {
        await initializeData()
        const initial = await database.query()
        const profile = materializeProfile(initial.spaces[initial.active]!.records)
        set({
          profile,
        })
        const api = marketApi()
        const [exposures, listings] = await Promise.all([
          discoverHistory().snapshot(),
          api.market.snapshot(),
        ])
        if (listings?.length)
          receiveMarket({ type: 'listings', listings, cached: true })
        const personal = profile.extensions?.[PERSONAL_FEED] as Subscription | undefined
        const sources = (await api.relatedSources(profile)).filter(
          (source) => !personal || sourceKey(source) !== sourceKey(personal),
        )
        for await (const event of api.sources.snapshot(sources)) receive(event)
        set({ exposures, hydrated: true })
        let previousActive = initial.active
        let previousSubscriptions = JSON.stringify(get().profile.subscriptions)
        useAuthSession.subscribe((current, previous) => {
          if (
            !current.loading &&
            (previous.loading ||
              current.session?.identity.id !== previous.session?.identity.id ||
              current.session?.providerId !== previous.session?.providerId)
          ) {
            undoGeneration++
            marketSession?.close()
            marketSession = undefined
            sessionSeen.clear()
            set({
              feeds: [],
              users: [],
              discoverAvailable: 0,
              undoProfile: undefined,
              undoOperation: undefined,
            })
            void discoverHistory().snapshot().then((exposures) => set({ exposures }))
            void get().refresh({ force: false })
          }
        })
        database.subscribe((db) => {
          const changedProfile = previousActive !== db.active
          if (changedProfile) undoGeneration++
          previousActive = db.active
          const space = db.spaces[db.active]
          if (space)
            set({
              profile: materializeProfile(space.records),
              ...(changedProfile
                ? {
                    undoProfile: undefined,
                    undoOperation: undefined,
                    users: [],
                  }
                : {}),
            })
          const subscriptions = JSON.stringify(get().profile.subscriptions)
          const changedSubscriptions = subscriptions !== previousSubscriptions
          previousSubscriptions = subscriptions
          if (changedProfile || changedSubscriptions)
            void get().refresh({ force: false, restart: changedProfile })
        })
        void get().refresh({ force: false })
      })()
      return initializing
    },
    setMarketActive(active) {
      set({ marketActive: active })
      if (active) ensureMarketSession().setActive(true)
      else marketSession?.setActive(false)
    },
    reportDiscoverVisible(eventId, index, available) {
      ensureMarketSession().reportVisible(index, available)
      if (sessionSeen.has(eventId)) return
      sessionSeen.add(eventId)
      void discoverHistory().record(eventId).then((exposures) => set({ exposures }))
    },
    setDiscoverAvailable(available) {
      set({ discoverAvailable: available })
    },
    async retry() {
      set({
        errors: get().errors.filter((e) => e === localWriteError),
        loginSuggested: false,
      })
      if (get().marketStatus === 'failed') await ensureMarketSession().retry()
      else await get().refresh({ force: false })
    },
    async refresh(options = {}) {
      if (useAuthSession.getState().loading || !get().hydrated) return
      const restart = options.restart ?? true
      if (restart) {
        generation++
        sessionSeen.clear()
        set((s) => ({
          revision: s.revision + 1,
          marketLoaded: 0,
          marketStatus: get().marketActive ? 'initial' : 'paused',
        }))
      }
      sourcesController?.abort()
      const controller = new AbortController(),
        round = generation
      sourcesController = controller
      const profile = get().profile
      set({
        errors: get().errors.filter(
          (e) => e === localWriteError || e.includes('messages.could_not_restore_local_data'),
        ),
        loginSuggested: false,
      })
      updateRefreshing()
      const api = marketApi()
      try {
        // Metadata snapshots are bounded by the API and are safe to expose to
        // non-Discover views without starting a Market traversal.
        const snapshot = await api.market.snapshot()
        if (round !== generation || controller.signal.aborted) return
        if (snapshot?.length) receiveMarket({
          type: 'listings',
          listings: snapshot,
          cached: true,
        })
        const personal = profile.extensions?.[PERSONAL_FEED] as
          Subscription | undefined
        const sources = (await api.relatedSources(profile)).filter(
          (source) => !personal || sourceKey(source) !== sourceKey(personal),
        )
        if (round !== generation || controller.signal.aborted) return
        for await (const event of api.sources.snapshot(sources)) {
          if (round !== generation || controller.signal.aborted) return
          receive(event)
        }
        const readSources = async () => {
          try {
            for await (const event of api.sources.read({
              sources,
              refresh: options.force ?? true,
              signal: controller.signal,
            })) {
              if (round !== generation || controller.signal.aborted) break
              receive(event)
            }
          } catch (error) {
            if (
              !isAbort(error) &&
              round === generation &&
              !controller.signal.aborted
            )
              set((s) => ({ errors: [...s.errors, String(error)] }))
          } finally {
            if (sourcesController === controller) {
              sourcesController = undefined
              updateRefreshing()
            }
          }
        }
        await readSources()
        if (restart && get().marketActive) await ensureMarketSession().refresh()
      } catch (error) {
        if (
          !isAbort(error) &&
          round === generation &&
          !controller.signal.aborted
        )
          set((s) => ({ errors: [...s.errors, String(error)] }))
      } finally {
        if (sourcesController === controller) {
          sourcesController = undefined
          updateRefreshing()
        }
      }
    },
    act(action) {
      const id = activeSpace()?.id
      if (!id) return
      const generation = ++undoGeneration
      void mutateProfile(id, action)
        .then((previous) => {
          if (activeSpace()?.id === id && generation === undoGeneration)
            set((s) => ({
              undoProfile: previous,
              undoOperation: { id: crypto.randomUUID(), spaceId: id },
              errors: s.errors.filter((e) => e !== localWriteError),
            }))
        })
        .catch(() =>
          set((s) => ({
            errors: [
              ...s.errors.filter((e) => e !== localWriteError),
              localWriteError,
            ],
          })),
        )
    },
    expireUndo(id) {
      if (get().undoOperation?.id === id)
        set({ undoProfile: undefined, undoOperation: undefined })
    },
    async undo(id = get().undoOperation?.id) {
      const operation = get().undoOperation,
        profile = get().undoProfile
      if (
        !operation ||
        operation.id !== id ||
        operation.spaceId !== activeSpace()?.id ||
        !profile
      )
        return
      set({ undoProfile: undefined, undoOperation: undefined })
      try {
        await replaceLocalProfile(operation.spaceId, profile)
      } catch (error) {
        set((s) => ({ errors: [...s.errors, localWriteError] }))
        throw error
      }
    },
    replaceProfile(profile) {
      const id = activeSpace()?.id
      if (!id) throw new Error('messages.local_profile_is_not_ready')
      void replaceLocalProfile(id, profile).catch(() =>
        set((s) => ({ errors: [...s.errors, localWriteError] })),
      )
    },
  }
})
