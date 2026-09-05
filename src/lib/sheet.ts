/**
 * Cheat-sheet page geometry and packing.
 *
 * A cheat sheet is a constrained-space problem: you are given a page count and
 * a page size, and the job is to get as much of the material onto it as will
 * still be readable. So this does real typesetting rather than approximating
 * with CSS columns and hoping the printer agrees.
 *
 * Items are measured at a candidate type size, packed greedily into columns of
 * known height, and columns into pages. "Fit to N pages" then binary-searches
 * the type size for the largest that still fits. Because the packing is done
 * against measured heights, the on-screen preview and the printed output show
 * the same page breaks.
 */

/* ------------------------------------------------------------------ *
 * Page sizes
 * ------------------------------------------------------------------ */

export interface PageSize {
  id: string
  label: string
  widthMm: number
  heightMm: number
}

export const PAGE_SIZES: PageSize[] = [
  { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297 },
  { id: 'letter', label: 'US Letter', widthMm: 215.9, heightMm: 279.4 },
  { id: 'a5', label: 'A5', widthMm: 148, heightMm: 210 },
  { id: 'a3', label: 'A3', widthMm: 297, heightMm: 420 },
  { id: 'legal', label: 'US Legal', widthMm: 215.9, heightMm: 355.6 },
  { id: 'index-card', label: 'Index card (6×4in)', widthMm: 152.4, heightMm: 101.6 },
]

export function pageSizeById(id: string): PageSize {
  return PAGE_SIZES.find((p) => p.id === id) ?? PAGE_SIZES[0]
}

/** CSS reference pixels per millimetre, at the 96dpi the print box assumes. */
export const PX_PER_MM = 96 / 25.4

export function mmToPx(mm: number): number {
  return mm * PX_PER_MM
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

export type SheetOrder = 'pack' | 'alpha' | 'weakest'

export interface SheetSettings {
  pageSizeId: string
  orientation: 'portrait' | 'landscape'
  /** Page margin, in millimetres. */
  marginMm: number
  columns: number
  /** Gutter between columns, in millimetres. */
  columnGapMm: number
  /** Base type size in points. Ignored while autoFit is on. */
  fontPt: number
  lineHeight: number
  /** Shrink the type until the content fits `targetPages`. */
  autoFit: boolean
  targetPages: number

  includeFormulas: boolean
  includeDefinitions: boolean
  /** The explanatory note under a formula. First thing worth cutting. */
  includeNotes: boolean
  /** "c2 · slide 15" citations. Useful for checking, dead weight on paper. */
  includeCitations: boolean
  /** FORMULAS / DEFINITIONS section headings. */
  showSectionHeadings: boolean
  /** Which topic each item came from, as a small label. */
  showTopicLabels: boolean
  showTitle: boolean

  weakOnly: boolean
  order: SheetOrder
  /** Topic ids to include. Empty means all. */
  topicIds: string[]
}

export const DEFAULT_SHEET_SETTINGS: SheetSettings = {
  pageSizeId: 'a4',
  orientation: 'portrait',
  marginMm: 10,
  columns: 2,
  columnGapMm: 6,
  fontPt: 9,
  lineHeight: 1.35,
  autoFit: true,
  // Two pages by default: a cheat sheet allowance is normally "one sheet,
  // double-sided", which is two printed sides.
  targetPages: 2,

  includeFormulas: true,
  includeDefinitions: true,
  includeNotes: true,
  includeCitations: false,
  showSectionHeadings: true,
  showTopicLabels: false,
  showTitle: true,

  weakOnly: false,
  order: 'pack',
  topicIds: [],
}

/** The range auto-fit searches, and the manual slider allows. */
export const MIN_FONT_PT = 5
export const MAX_FONT_PT = 14
export const FONT_STEP = 0.25

/* ------------------------------------------------------------------ *
 * Derived geometry
 * ------------------------------------------------------------------ */

export interface Geometry {
  pageWidthMm: number
  pageHeightMm: number
  /** Printable area. */
  contentWidthMm: number
  contentHeightMm: number
  columnWidthMm: number
  columnWidthPx: number
  columnHeightPx: number
}

export function geometryOf(settings: SheetSettings): Geometry {
  const size = pageSizeById(settings.pageSizeId)
  const landscape = settings.orientation === 'landscape'

  const pageWidthMm = landscape ? size.heightMm : size.widthMm
  const pageHeightMm = landscape ? size.widthMm : size.heightMm

  const contentWidthMm = Math.max(10, pageWidthMm - settings.marginMm * 2)
  const contentHeightMm = Math.max(10, pageHeightMm - settings.marginMm * 2)

  const columns = Math.max(1, settings.columns)
  const gutters = settings.columnGapMm * (columns - 1)
  const columnWidthMm = Math.max(8, (contentWidthMm - gutters) / columns)

  return {
    pageWidthMm,
    pageHeightMm,
    contentWidthMm,
    contentHeightMm,
    columnWidthMm,
    columnWidthPx: mmToPx(columnWidthMm),
    columnHeightPx: mmToPx(contentHeightMm),
  }
}

/* ------------------------------------------------------------------ *
 * Items
 * ------------------------------------------------------------------ */

export type SheetItemKind = 'section' | 'topic' | 'formula' | 'fact'

export interface SheetItem {
  key: string
  kind: SheetItemKind
  /** Heading text, formula name, or defined term. */
  title: string
  /** The expression, or the definition body. */
  body?: string
  note?: string
  source?: string
  topicTitle?: string
}

/** Headings must not be stranded at the foot of a column. */
function isHeading(item: SheetItem): boolean {
  return item.kind === 'section' || item.kind === 'topic'
}

/* ------------------------------------------------------------------ *
 * Packing
 * ------------------------------------------------------------------ */

export interface Layout {
  /** pages[pageIndex][columnIndex] = item indices, in order. */
  pages: number[][][]
  /** Used height of each column, in px, for the fullness readout. */
  columnFill: number[][]
  /** True when an item was taller than a whole column and had to be forced. */
  hasOverflowingItem: boolean
}

/**
 * Greedy top-to-bottom, left-to-right packing.
 *
 * Greedy rather than balanced on purpose: a reader scans a cheat sheet in
 * reading order, and reordering items to even out column lengths makes it
 * harder to find things than a slightly ragged final column does.
 */
export function packColumns(
  items: SheetItem[],
  heights: number[],
  gapPx: number,
  columnHeightPx: number,
  columnsPerPage: number,
): Layout {
  const pages: number[][][] = []
  const columnFill: number[][] = []
  let hasOverflowingItem = false

  let page: number[][] = []
  let column: number[] = []
  let used = 0

  const pushColumn = () => {
    page.push(column)
    if (!columnFill[pages.length]) columnFill[pages.length] = []
    columnFill[pages.length][page.length - 1] = used
    column = []
    used = 0

    if (page.length >= columnsPerPage) {
      pages.push(page)
      page = []
    }
  }

  for (let i = 0; i < items.length; i++) {
    const height = heights[i] ?? 0
    const needed = column.length === 0 ? height : height + gapPx

    if (height > columnHeightPx) {
      // Nothing can be done about an item taller than the column; place it and
      // let the caller warn, rather than looping forever trying to fit it.
      hasOverflowingItem = true
    }

    if (used + needed > columnHeightPx && column.length > 0) {
      // Don't leave a heading alone at the bottom of a column — carry it over
      // with the item that follows it.
      const trailingHeadings: number[] = []
      while (column.length > 0 && isHeading(items[column[column.length - 1]])) {
        const moved = column.pop()
        if (moved === undefined) break
        trailingHeadings.unshift(moved)
        used -= (heights[moved] ?? 0) + (column.length > 0 ? gapPx : 0)
      }

      pushColumn()

      for (const index of trailingHeadings) {
        const h = heights[index] ?? 0
        used += column.length === 0 ? h : h + gapPx
        column.push(index)
      }

      used += column.length === 0 ? height : height + gapPx
      column.push(i)
      continue
    }

    used += needed
    column.push(i)
  }

  if (column.length > 0) pushColumn()
  if (page.length > 0) {
    pages.push(page)
  }

  return { pages, columnFill, hasOverflowingItem }
}

/**
 * Pack, then even out the columns.
 *
 * Straight greedy packing fills column one to the brim and can leave the last
 * column of the last page empty, which looks like a mistake rather than a
 * choice. Squeezing the working column height down as far as it will go
 * without costing a page spreads the same items evenly, in the same reading
 * order, and fills the sheet.
 */
export function packBalanced(
  items: SheetItem[],
  heights: number[],
  gapPx: number,
  columnHeightPx: number,
  columnsPerPage: number,
): Layout {
  const full = packColumns(items, heights, gapPx, columnHeightPx, columnsPerPage)
  if (items.length === 0 || columnsPerPage <= 1) return full

  const targetPages = full.pages.length

  // Smallest working height that still fits the same number of pages.
  let low = 1
  let high = columnHeightPx
  let best = full

  for (let i = 0; i < 22 && high - low > 1; i++) {
    const mid = (low + high) / 2
    const trial = packColumns(items, heights, gapPx, mid, columnsPerPage)

    if (trial.pages.length <= targetPages && !trial.hasOverflowingItem) {
      best = trial
      high = mid
    } else {
      low = mid
    }
  }

  return best
}

/* ------------------------------------------------------------------ *
 * Fitting
 * ------------------------------------------------------------------ */

export interface FitResult {
  fontPt: number
  layout: Layout
  /** True when the content fits within the target page count. */
  fits: boolean
}

/**
 * Find the largest type size at which the content still fits `targetPages`.
 *
 * `measure` renders the items at a candidate size and returns their heights.
 * It is called O(log n) times over the discrete size ladder, so it can afford
 * to force a real layout each time.
 */
export function fitToPages(
  items: SheetItem[],
  targetPages: number,
  gapPx: number,
  columnHeightPx: number,
  columnsPerPage: number,
  measure: (fontPt: number) => number[],
): FitResult {
  const sizes: number[] = []
  for (let pt = MIN_FONT_PT; pt <= MAX_FONT_PT + 1e-9; pt += FONT_STEP) {
    sizes.push(Math.round(pt * 100) / 100)
  }

  const layoutAt = (fontPt: number): Layout =>
    packBalanced(items, measure(fontPt), gapPx, columnHeightPx, columnsPerPage)

  // Binary search for the largest size whose layout is within the target.
  let low = 0
  let high = sizes.length - 1
  let bestIndex = -1
  let bestLayout: Layout | null = null

  while (low <= high) {
    const mid = (low + high) >> 1
    const layout = layoutAt(sizes[mid])

    if (layout.pages.length <= targetPages) {
      bestIndex = mid
      bestLayout = layout
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  if (bestIndex >= 0 && bestLayout) {
    return { fontPt: sizes[bestIndex], layout: bestLayout, fits: true }
  }

  // The budget cannot be met at any size.
  //
  // Rendering at the smallest size would be the worst of both worlds: still
  // over budget, and now illegible. Since the page count is going to be
  // exceeded either way, spend the surplus on readability — find the fewest
  // pages actually achievable, then the largest size that still achieves it.
  const floorLayout = layoutAt(sizes[0])
  const minPages = floorLayout.pages.length

  let readableLow = 0
  let readableHigh = sizes.length - 1
  let readableIndex = 0
  let readableLayout = floorLayout

  while (readableLow <= readableHigh) {
    const mid = (readableLow + readableHigh) >> 1
    const layout = layoutAt(sizes[mid])

    if (layout.pages.length <= minPages) {
      readableIndex = mid
      readableLayout = layout
      readableLow = mid + 1
    } else {
      readableHigh = mid - 1
    }
  }

  return { fontPt: sizes[readableIndex], layout: readableLayout, fits: false }
}

/* ------------------------------------------------------------------ *
 * Readouts
 * ------------------------------------------------------------------ */

/** How full the last page is, 0–1. Useful for judging whether to add material. */
export function lastPageFill(layout: Layout, columnHeightPx: number, columnsPerPage: number): number {
  const pageIndex = layout.pages.length - 1
  if (pageIndex < 0) return 0

  const fills = layout.columnFill[pageIndex] ?? []
  const total = columnHeightPx * columnsPerPage
  if (total <= 0) return 0

  const used = fills.reduce((sum, value) => sum + (value ?? 0), 0)
  return Math.min(1, used / total)
}

export function countByKind(items: SheetItem[]): { formulas: number; facts: number } {
  let formulas = 0
  let facts = 0
  for (const item of items) {
    if (item.kind === 'formula') formulas++
    else if (item.kind === 'fact') facts++
  }
  return { formulas, facts }
}
