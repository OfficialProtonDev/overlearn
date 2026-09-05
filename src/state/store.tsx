/**
 * Application state.
 *
 * One context holding the loaded packs, the active pack's progress, and
 * settings. Progress is written back to localStorage on every change, because
 * a four-hour session that loses its history to a crashed tab is worse than
 * useless — it's discouraging.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Pack } from '../types/pack'
import {
  closeSession as closeSessionRecord,
  emptyProgress,
  recordAnswer,
  toggleFlag,
  type PackProgress,
  type SessionRecord,
} from '../lib/progress'
import type { Verdict } from '../lib/grading'
import {
  DEFAULT_SETTINGS,
  clearProgress as clearStoredProgress,
  deletePack as deleteStoredPack,
  loadLastPackId,
  loadPacks,
  loadProgress,
  loadSettings,
  savePack,
  saveLastPackId,
  saveProgress,
  saveSettings,
  type Settings,
  type ThemeChoice,
} from '../lib/storage'
import { loadBundledPacks } from '../lib/packLoader'

interface StoreValue {
  ready: boolean
  packs: Pack[]
  activePack: Pack | null
  progress: PackProgress
  settings: Settings

  selectPack: (packId: string | null) => void
  addPack: (pack: Pack) => Promise<void>
  removePack: (packId: string) => Promise<void>

  answer: (questionId: string, verdict: Verdict) => void
  flag: (questionId: string) => void
  finishSession: (record: SessionRecord) => void
  resetProgress: (packId: string) => void
  replaceProgress: (progress: PackProgress) => void

  setTheme: (theme: ThemeChoice) => void
  updateSettings: (patch: Partial<Settings>) => void
}

const StoreContext = createContext<StoreValue | null>(null)

export function useStore(): StoreValue {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useStore must be used inside <StoreProvider>')
  return value
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [packs, setPacks] = useState<Pack[]>([])
  const [activePackId, setActivePackId] = useState<string | null>(null)
  const [progress, setProgress] = useState<PackProgress>(() => emptyProgress(''))
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)

  /* -- boot ---------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false

    async function boot() {
      setSettings(loadSettings())

      const [stored, bundledReports] = await Promise.all([loadPacks(), loadBundledPacks()])
      if (cancelled) return

      const bundled = bundledReports
        .map((r) => r.pack)
        .filter((p): p is Pack => p !== null)

      // A bundled pack is the source of truth for its id: shipping an updated
      // pack should replace the cached copy rather than be shadowed by it.
      const byId = new Map<string, Pack>()
      for (const pack of stored) byId.set(pack.manifest.id, pack)
      for (const pack of bundled) byId.set(pack.manifest.id, pack)

      const all = [...byId.values()].sort((a, b) =>
        a.manifest.title.localeCompare(b.manifest.title),
      )
      setPacks(all)

      const last = loadLastPackId()
      const initial = all.find((p) => p.manifest.id === last) ?? (all.length === 1 ? all[0] : null)
      if (initial) {
        setActivePackId(initial.manifest.id)
        setProgress(loadProgress(initial.manifest.id))
      }

      setReady(true)
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  /* -- theme --------------------------------------------------------- */

  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', settings.theme)
  }, [settings.theme])

  /* -- persistence --------------------------------------------------- */

  // Debounced so a fast rapid-fire run doesn't write on every keystroke.
  const saveTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!progress.packId) return
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => saveProgress(progress), 250)
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    }
  }, [progress])

  // A tab closing mid-session must not lose the last few answers.
  useEffect(() => {
    const flush = () => {
      if (progress.packId) saveProgress(progress)
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [progress])

  /* -- actions ------------------------------------------------------- */

  const selectPack = useCallback((packId: string | null) => {
    setActivePackId(packId)
    saveLastPackId(packId)
    setProgress(packId ? loadProgress(packId) : emptyProgress(''))
  }, [])

  const addPack = useCallback(
    async (pack: Pack) => {
      await savePack(pack)
      setPacks((prev) => {
        const without = prev.filter((p) => p.manifest.id !== pack.manifest.id)
        return [...without, pack].sort((a, b) => a.manifest.title.localeCompare(b.manifest.title))
      })
      setActivePackId(pack.manifest.id)
      saveLastPackId(pack.manifest.id)
      setProgress(loadProgress(pack.manifest.id))
    },
    [],
  )

  const removePack = useCallback(
    async (packId: string) => {
      await deleteStoredPack(packId)
      setPacks((prev) => prev.filter((p) => p.manifest.id !== packId))
      setActivePackId((current) => {
        if (current !== packId) return current
        saveLastPackId(null)
        setProgress(emptyProgress(''))
        return null
      })
    },
    [],
  )

  const answer = useCallback((questionId: string, verdict: Verdict) => {
    setProgress((prev) => recordAnswer(prev, questionId, verdict))
  }, [])

  const flag = useCallback((questionId: string) => {
    setProgress((prev) => toggleFlag(prev, questionId))
  }, [])

  const finishSession = useCallback((record: SessionRecord) => {
    setProgress((prev) => closeSessionRecord(prev, record))
  }, [])

  const resetProgress = useCallback((packId: string) => {
    clearStoredProgress(packId)
    setProgress(emptyProgress(packId))
  }, [])

  const replaceProgress = useCallback((next: PackProgress) => {
    saveProgress(next)
    setProgress(next)
  }, [])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  const setTheme = useCallback(
    (theme: ThemeChoice) => updateSettings({ theme }),
    [updateSettings],
  )

  const activePack = useMemo(
    () => packs.find((p) => p.manifest.id === activePackId) ?? null,
    [packs, activePackId],
  )

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      packs,
      activePack,
      progress,
      settings,
      selectPack,
      addPack,
      removePack,
      answer,
      flag,
      finishSession,
      resetProgress,
      replaceProgress,
      setTheme,
      updateSettings,
    }),
    [
      ready,
      packs,
      activePack,
      progress,
      settings,
      selectPack,
      addPack,
      removePack,
      answer,
      flag,
      finishSession,
      resetProgress,
      replaceProgress,
      setTheme,
      updateSettings,
    ],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
