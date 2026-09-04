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

export type MarketStatus =
  'idle' | 'initial' | 'appending' | 'paused' | 'complete' | 'failed'
interface FeedStore {
  profile: UserData
  feeds: LoadedFeed[]
  listings: MarketListing[]
  users: { user: UserData; sourceLocator: string }[]
  loading: boolean
  ready: boolean
  errors: string[]
  loginSuggested: boolean
  marketStatus: MarketStatus
  marketLoaded: number
  marketActive: boolean
  revision: number
  undoProfile?: UserData
  undoOperation?: { id: string; spaceId: string }
  expireUndo(id: string): void
  initialize(): Promise<void>
  refresh(options?: { force?: boolean; restart?: boolean }): Promise<void>
  retry(): Promise<void>
  setMarketActive(active: boolean): void
  act(action: ProfileAction): void
  undo(id?: string): Promise<void>
  replaceProfile(profile: UserData): void
}
let initializing: Promise<void> | undefined
let marketController: AbortController | undefined
let sourcesController: AbortController | undefined
let cursor: string | undefined
let generation = 0
let undoGeneration = 0
let forceMarket = false
let freshListings: MarketListing[] = []
const localWriteError = '保存失败，请检查浏览器存储权限后重试。'

export const useFeedStore = create<FeedStore>((set, get) => {
  const updateLoading = () =>
    set({ loading: Boolean(marketController || sourcesController) })
  const receive = (event: ReadEvent) => {
    if (event.type === 'feed')
      set((s) => ({
        feeds: [
          ...s.feeds.filter(
            (f) => f.sourceLocator !== event.feed.sourceLocator,
          ),
          event.feed,
        ],
      }))
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
  const pump = async () => {
    if (
      marketController ||
      !get().marketActive ||
      !get().ready ||
      useAuthSession.getState().loading ||
      get().marketStatus === 'complete'
    )
      return
    const controller = new AbortController(),
      round = generation
    marketController = controller
    set({ marketStatus: get().feeds.length ? 'appending' : 'initial' })
    updateLoading()
    let failed = false
    try {
      const stream = marketApi().market.stream({
        cursor,
        refresh: forceMarket,
        signal: controller.signal,
      })
      for await (const event of stream) {
        if (controller.signal.aborted || round !== generation) break
        if (event.type === 'listings') {
          if (!event.cached) freshListings = event.listings
          set((s) => ({
            listings: [
              ...new Map(
                [...s.listings, ...event.listings].map((l) => [
                  sourceKey(l.source),
                  l,
                ]),
              ).values(),
            ],
          }))
        } else if (event.type === 'progress') {
          cursor = event.cursor
          set({ marketLoaded: event.loaded })
          if (event.complete)
            set({ marketStatus: 'complete', listings: freshListings })
        } else {
          receive(event)
          if (event.type === 'error') failed = true
          if (event.type === 'feed') set({ marketStatus: 'appending' })
        }
      }
      if (
        round === generation &&
        !controller.signal.aborted &&
        get().marketStatus !== 'complete'
      )
        set({ marketStatus: failed ? 'failed' : 'paused' })
    } catch (error) {
      if (!isAbort(error) && round === generation) {
        set((s) => ({
          marketStatus: 'failed',
          errors: [...s.errors, String(error)],
        }))
      }
    } finally {
      if (marketController === controller) {
        marketController = undefined
        updateLoading()
      }
    }
  }
  return {
    profile: emptyProfile(),
    feeds: [],
    listings: [],
    users: [],
    loading: false,
    ready: false,
    errors: [],
    loginSuggested: false,
    marketStatus: 'idle',
    marketLoaded: 0,
    marketActive: false,
    revision: 0,
    initialize() {
      initializing ??= (async () => {
        await initializeData()
        const initial = await database.query()
        set({
          profile: materializeProfile(initial.spaces[initial.active]!.records),
          ready: true,
        })
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
            set({
              feeds: [],
              listings: [],
              users: [],
              undoProfile: undefined,
              undoOperation: undefined,
            })
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
        await get().refresh({ force: false })
      })()
      return initializing
    },
    setMarketActive(active) {
      set({ marketActive: active })
      if (!active) {
        marketController?.abort()
        marketController = undefined
        if (
          get().marketStatus === 'initial' ||
          get().marketStatus === 'appending'
        )
          set({ marketStatus: 'paused' })
        updateLoading()
      } else if (get().marketStatus !== 'failed') void pump()
    },
    async retry() {
      set({
        errors: get().errors.filter((e) => e === localWriteError),
        loginSuggested: false,
      })
      if (get().marketStatus === 'failed') await pump()
      else await get().refresh({ force: false })
    },
    async refresh(options = {}) {
      if (useAuthSession.getState().loading || !get().ready) return
      const restart = options.restart ?? true
      if (restart) {
        generation++
        marketController?.abort()
        marketController = undefined
        cursor = undefined
        freshListings = []
        forceMarket = options.force ?? true
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
          (e) => e === localWriteError || e.includes('无法恢复本地数据'),
        ),
        loginSuggested: false,
      })
      updateLoading()
      const api = marketApi()
      try {
        const snapshot = await api.market.snapshot()
        if (round !== generation || controller.signal.aborted) return
        if (snapshot)
          set((s) => ({
            listings: [
              ...new Map(
                [...snapshot, ...s.listings].map((l) => [
                  sourceKey(l.source),
                  l,
                ]),
              ).values(),
            ],
          }))
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
              updateLoading()
            }
          }
        }
        await Promise.all([readSources(), pump()])
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
          updateLoading()
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
      if (!id) throw new Error('本机资料尚未就绪')
      void replaceLocalProfile(id, profile).catch(() =>
        set((s) => ({ errors: [...s.errors, localWriteError] })),
      )
    },
  }
})
