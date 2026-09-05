/**
 * Getting packs into the app.
 *
 * Three routes in, because "point it at a folder" means different things in
 * different browsers and none of them work everywhere:
 *
 *   bundled  — packs shipped in public/packs, listed by public/packs/index.json
 *   folder   — a directory the user picks or drops
 *   file     — a single self-contained .json
 *
 * The folder route prefers the File System Access API where it exists
 * (Chrome, Edge), falls back to <input webkitdirectory> (everywhere current),
 * and also accepts a dropped folder via the entries API. All three converge on
 * the same `FileMap` before parsing, so there is only one code path that
 * actually understands the pack format.
 */

import type { Pack, PackManifest, PackOrigin, Topic } from '../types/pack'
import {
  checkIdCollisions,
  hasErrors,
  summarise,
  validateManifest,
  validateTopic,
  type Issue,
} from './validate'

export interface LoadReport {
  pack: Pack | null
  issues: Issue[]
  summary?: { topics: number; subtopics: number; questions: number }
}

/** Path (relative to the pack root) -> file contents. */
type FileMap = Map<string, string>

/* ------------------------------------------------------------------ *
 * Parsing a resolved set of files
 * ------------------------------------------------------------------ */

function normalisePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * Find pack.json and return it with the prefix it sits under, so a folder
 * containing the pack one level down (the usual result of picking a parent
 * directory) still works.
 */
function findManifest(files: FileMap): { text: string; prefix: string } | null {
  let best: { text: string; prefix: string } | null = null

  for (const [path, text] of files) {
    const normalised = normalisePath(path)
    if (!normalised.endsWith('pack.json')) continue
    const prefix = normalised.slice(0, normalised.length - 'pack.json'.length)
    // Prefer the shallowest manifest.
    if (!best || prefix.length < best.prefix.length) best = { text, prefix }
  }

  return best
}

function readJson(text: string, path: string): { value: unknown; issue?: Issue } {
  try {
    return { value: JSON.parse(text) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      value: null,
      issue: { path, message: `not valid JSON — ${message}`, severity: 'error' },
    }
  }
}

function parsePack(files: FileMap, origin: PackOrigin): LoadReport {
  const issues: Issue[] = []

  const found = findManifest(files)
  if (!found) {
    return {
      pack: null,
      issues: [
        {
          path: '(folder)',
          message:
            'no pack.json found. A pack folder must contain pack.json at its root, alongside a topics/ folder.',
          severity: 'error',
        },
      ],
    }
  }

  const manifestJson = readJson(found.text, 'pack.json')
  if (manifestJson.issue) return { pack: null, issues: [manifestJson.issue] }

  const manifestResult = validateManifest(manifestJson.value)
  issues.push(...manifestResult.issues)
  if (!manifestResult.value) return { pack: null, issues }

  const manifest: PackManifest = manifestResult.value
  const topics: Topic[] = []

  for (const ref of manifest.topics) {
    const relative = normalisePath(ref.file)
    const key = found.prefix + relative

    // Tolerate a manifest that points at "topics/x.json" while the picked
    // folder gave us paths with a different root.
    const text = files.get(key) ?? files.get(relative) ?? findBySuffix(files, relative)

    if (text === undefined) {
      issues.push({
        path: `pack.json topics["${ref.id}"]`,
        message: `file "${ref.file}" was not found in the pack folder`,
        severity: 'error',
      })
      continue
    }

    const parsed = readJson(text, ref.file)
    if (parsed.issue) {
      issues.push(parsed.issue)
      continue
    }

    const topicResult = validateTopic(parsed.value, ref.file)
    issues.push(...topicResult.issues)
    if (topicResult.value) {
      if (topicResult.value.id !== ref.id) {
        issues.push({
          path: ref.file,
          message: `topic id "${topicResult.value.id}" does not match the manifest's "${ref.id}"`,
          severity: 'error',
        })
      }
      topics.push(topicResult.value)
    }
  }

  issues.push(...checkIdCollisions(topics))

  if (hasErrors(issues)) return { pack: null, issues }

  return {
    pack: { manifest, topics, origin, loadedAt: Date.now() },
    issues,
    summary: summarise(topics),
  }
}

function findBySuffix(files: FileMap, relative: string): string | undefined {
  for (const [path, text] of files) {
    if (normalisePath(path).endsWith('/' + relative) || normalisePath(path) === relative) {
      return text
    }
  }
  return undefined
}

/* ------------------------------------------------------------------ *
 * Bundled packs
 * ------------------------------------------------------------------ */

interface BundledIndex {
  packs: { id: string; path: string }[]
}

/** Resolve a path against the app's base URL so it works under a subpath. */
function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  return base.replace(/\/$/, '') + '/' + path.replace(/^\//, '')
}

/**
 * Read public/packs/index.json and load everything it lists.
 * A missing index is normal — it just means no packs were shipped with
 * this build — so it resolves to an empty list rather than an error.
 */
export async function loadBundledPacks(): Promise<LoadReport[]> {
  let index: BundledIndex
  try {
    const response = await fetch(assetUrl('packs/index.json'), { cache: 'no-cache' })
    if (!response.ok) return []
    index = (await response.json()) as BundledIndex
  } catch {
    return []
  }

  if (!Array.isArray(index?.packs)) return []

  const reports = await Promise.all(index.packs.map((entry) => loadBundledPack(entry.path)))
  return reports.filter((r): r is LoadReport => r !== null)
}

async function loadBundledPack(path: string): Promise<LoadReport | null> {
  const root = `packs/${path.replace(/^\/|\/$/g, '')}`

  try {
    const manifestResponse = await fetch(assetUrl(`${root}/pack.json`), { cache: 'no-cache' })
    if (!manifestResponse.ok) return null
    const manifestText = await manifestResponse.text()

    const files: FileMap = new Map([['pack.json', manifestText]])

    // Fetch the topic files the manifest names.
    const parsed = JSON.parse(manifestText) as PackManifest
    if (Array.isArray(parsed?.topics)) {
      await Promise.all(
        parsed.topics.map(async (ref) => {
          if (typeof ref?.file !== 'string') return
          const response = await fetch(assetUrl(`${root}/${ref.file}`), { cache: 'no-cache' })
          if (response.ok) files.set(normalisePath(ref.file), await response.text())
        }),
      )
    }

    return parsePack(files, { kind: 'bundled', path: root })
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * Folder: File System Access API
 * ------------------------------------------------------------------ */

interface FsDirectoryHandle {
  kind: 'directory'
  name: string
  entries(): AsyncIterableIterator<[string, FsDirectoryHandle | FsFileHandle]>
}
interface FsFileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
}

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: string }) => Promise<FsDirectoryHandle>
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function'
}

const MAX_DEPTH = 4

async function readDirectory(
  dir: FsDirectoryHandle,
  files: FileMap,
  prefix = '',
  depth = 0,
): Promise<void> {
  if (depth > MAX_DEPTH) return

  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith('.')) continue
    const path = prefix ? `${prefix}/${name}` : name

    if (handle.kind === 'file') {
      if (!name.toLowerCase().endsWith('.json')) continue
      const file = await handle.getFile()
      files.set(path, await file.text())
    } else {
      await readDirectory(handle, files, path, depth + 1)
    }
  }
}

export async function openPackFromDirectoryPicker(): Promise<LoadReport | null> {
  const picker = (window as PickerWindow).showDirectoryPicker
  if (!picker) return null

  let handle: FsDirectoryHandle
  try {
    handle = await picker({ mode: 'read' })
  } catch {
    return null // the user cancelled
  }

  const files: FileMap = new Map()
  try {
    await readDirectory(handle, files)
  } catch (error) {
    return {
      pack: null,
      issues: [
        {
          path: handle.name,
          message: `could not read the folder — ${error instanceof Error ? error.message : String(error)}`,
          severity: 'error',
        },
      ],
    }
  }

  return parsePack(files, { kind: 'folder', name: handle.name })
}

/* ------------------------------------------------------------------ *
 * Folder: <input webkitdirectory> and drag-and-drop
 * ------------------------------------------------------------------ */

interface RelativeFile {
  path: string
  file: File
}

async function toFileMap(entries: RelativeFile[]): Promise<FileMap> {
  const files: FileMap = new Map()
  await Promise.all(
    entries
      .filter((e) => e.file.name.toLowerCase().endsWith('.json'))
      .map(async (e) => {
        files.set(normalisePath(e.path), await e.file.text())
      }),
  )
  return files
}

/** Handles the FileList produced by <input type="file" webkitdirectory>. */
export async function openPackFromFileList(list: FileList): Promise<LoadReport> {
  const entries: RelativeFile[] = []
  let rootName = 'folder'

  for (const file of Array.from(list)) {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    if (!rootName || rootName === 'folder') {
      const first = relative.split('/')[0]
      if (first && first !== file.name) rootName = first
    }
    // Strip the leading directory so paths are relative to the picked folder.
    const trimmed = relative.includes('/') ? relative.slice(relative.indexOf('/') + 1) : relative
    entries.push({ path: trimmed, file })
  }

  if (entries.length === 1 && entries[0].file.name.toLowerCase().endsWith('.json')) {
    return openPackFromFile(entries[0].file)
  }

  const files = await toFileMap(entries)
  return parsePack(files, { kind: 'folder', name: rootName })
}

/** A single self-contained .json file: either a manifest with inline topics
 *  or a bundle written by "Export pack". */
export async function openPackFromFile(file: File): Promise<LoadReport> {
  const text = await file.text()
  const parsed = readJson(text, file.name)
  if (parsed.issue) return { pack: null, issues: [parsed.issue] }

  const raw = parsed.value as Record<string, unknown>

  // Bundle form: { manifest, topics: [...] }
  if (raw && typeof raw === 'object' && 'manifest' in raw && Array.isArray(raw.topics)) {
    const files: FileMap = new Map()
    const manifest = raw.manifest as PackManifest
    const topics = raw.topics as Topic[]

    const refs = topics.map((t, i) => ({ id: t.id, title: t.title, file: `topics/${i}.json` }))
    files.set('pack.json', JSON.stringify({ ...manifest, topics: refs }))
    topics.forEach((t, i) => files.set(`topics/${i}.json`, JSON.stringify(t)))

    return parsePack(files, { kind: 'file', name: file.name })
  }

  return {
    pack: null,
    issues: [
      {
        path: file.name,
        message:
          'this looks like a single JSON file rather than a pack. Drop the whole pack folder, or a file exported with "Export pack".',
        severity: 'error',
      },
    ],
  }
}

/** Handles a drop, whether it carried a folder or loose files. */
export async function openPackFromDrop(dataTransfer: DataTransfer): Promise<LoadReport | null> {
  const items = Array.from(dataTransfer.items ?? [])
  const entries: RelativeFile[] = []
  let rootName = 'folder'

  const roots = items
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null)

  if (roots.length > 0) {
    for (const root of roots) {
      if (root.isDirectory) rootName = root.name
      await walkEntry(root, '', entries, 0)
    }
  } else {
    for (const file of Array.from(dataTransfer.files ?? [])) {
      entries.push({ path: file.name, file })
    }
  }

  if (entries.length === 0) return null

  if (entries.length === 1 && entries[0].file.name.toLowerCase().endsWith('.json')) {
    const single = entries[0].file
    if (single.name.toLowerCase() !== 'pack.json') return openPackFromFile(single)
  }

  const files = await toFileMap(entries)
  return parsePack(files, { kind: 'folder', name: rootName })
}

function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: RelativeFile[],
  depth: number,
): Promise<void> {
  if (depth > MAX_DEPTH) return Promise.resolve()

  if (entry.isFile) {
    return new Promise((resolve) => {
      ;(entry as FileSystemFileEntry).file(
        (file) => {
          out.push({ path: prefix ? `${prefix}/${file.name}` : file.name, file })
          resolve()
        },
        () => resolve(),
      )
    })
  }

  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // At the top level the picked folder itself is the root, so its own name
    // is dropped from the paths we build.
    const nextPrefix = depth === 0 ? '' : prefix ? `${prefix}/${entry.name}` : entry.name

    return new Promise((resolve) => {
      const collected: FileSystemEntry[] = []
      const readBatch = () => {
        reader.readEntries(
          (batch) => {
            if (batch.length === 0) {
              Promise.all(collected.map((e) => walkEntry(e, nextPrefix, out, depth + 1))).then(() =>
                resolve(),
              )
              return
            }
            collected.push(...batch)
            readBatch()
          },
          () => resolve(),
        )
      }
      readBatch()
    })
  }

  return Promise.resolve()
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

/** Flatten a loaded pack back into one shareable file. */
export function exportPack(pack: Pack): string {
  return JSON.stringify({ manifest: pack.manifest, topics: pack.topics }, null, 2)
}
