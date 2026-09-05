/**
 * The cheat sheet.
 *
 * Two uses, both served by the same page. If your test allows a one-pager,
 * this builds it and squeezes it to fit exactly. If it doesn't, assembling one
 * is a decent last pass before you walk in.
 *
 * The layout is genuinely paginated rather than left to CSS columns: items are
 * measured at a candidate type size, packed into columns of known height, and
 * the type size is searched for the largest that still fits your page budget.
 * So the preview shows the real page breaks, and printing gives you what you
 * were looking at.
 *
 * The sheet itself is the page. Everything that adjusts it lives in a drawer
 * that starts closed, because the first thing you want on arriving is to see
 * what you've got, not a control panel.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus, Printer, SlidersHorizontal, X } from 'lucide-react'
import type { Pack } from '../types/pack'
import { useStore } from '../state/store'
import { Markish } from '../components/Markish'
import { masteryOf, type PackProgress } from '../lib/progress'
import {
  DEFAULT_SHEET_SETTINGS,
  FONT_STEP,
  MAX_FONT_PT,
  MIN_FONT_PT,
  PAGE_SIZES,
  countByKind,
  fitToPages,
  geometryOf,
  lastPageFill,
  mmToPx,
  packBalanced,
  pageSizeById,
  type Geometry,
  type Layout,
  type SheetItem,
  type SheetSettings,
} from '../lib/sheet'

const STORAGE_KEY = 'overlearn:sheet'

function loadSheetSettings(): SheetSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SHEET_SETTINGS
    return { ...DEFAULT_SHEET_SETTINGS, ...(JSON.parse(raw) as Partial<SheetSettings>) }
  } catch {
    return DEFAULT_SHEET_SETTINGS
  }
}

function saveSheetSettings(settings: SheetSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* storage unavailable; settings just won't persist */
  }
}

type ZoomMode = 'fit' | number

/* ================================================================== */

export function CheatSheet({ pack }: { pack: Pack }) {
  const { progress } = useStore()
  const [settings, setSettings] = useState<SheetSettings>(loadSheetSettings)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit')

  const update = useCallback((patch: Partial<SheetSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSheetSettings(next)
      return next
    })
  }, [])

  const allTopicIds = useMemo(() => pack.topics.map((t) => t.id), [pack])
  const selectedTopicIds = useMemo(() => {
    const known = settings.topicIds.filter((id) => allTopicIds.includes(id))
    return known.length > 0 ? known : allTopicIds
  }, [settings.topicIds, allTopicIds])

  const items = useMemo(
    () => buildItems(pack, progress, settings, selectedTopicIds),
    [pack, progress, settings, selectedTopicIds],
  )

  const geometry = useMemo(() => geometryOf(settings), [settings])

  /* -- measurement and pagination ------------------------------------- */

  const measureRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<Layout>({
    pages: [],
    columnFill: [],
    hasOverflowingItem: false,
  })
  const [resolvedFontPt, setResolvedFontPt] = useState(settings.fontPt)
  const [fits, setFits] = useState(true)

  useLayoutEffect(() => {
    const node = measureRef.current
    if (!node) return

    if (items.length === 0) {
      setLayout({ pages: [], columnFill: [], hasOverflowingItem: false })
      setFits(true)
      return
    }

    // Measure by mutating the hidden container directly. Doing it imperatively
    // keeps the whole size search inside one layout pass instead of spreading
    // it across a dozen React renders.
    node.style.width = `${geometry.columnWidthPx}px`

    const measure = (fontPt: number): number[] => {
      node.style.fontSize = `${fontPt}pt`
      node.style.lineHeight = String(settings.lineHeight)
      // Reading offsetHeight forces the reflow this depends on.
      return Array.from(node.children).map((child) => (child as HTMLElement).offsetHeight)
    }

    const gapPx = mmToPx(settings.fontPt * 0.16)
    const targetPages = Math.max(1, settings.targetPages)

    if (settings.autoFit) {
      const result = fitToPages(
        items,
        targetPages,
        gapPx,
        geometry.columnHeightPx,
        settings.columns,
        measure,
      )
      setLayout(result.layout)
      setResolvedFontPt(result.fontPt)
      setFits(result.fits)
    } else {
      const packed = packBalanced(
        items,
        measure(settings.fontPt),
        gapPx,
        geometry.columnHeightPx,
        settings.columns,
      )
      setLayout(packed)
      setResolvedFontPt(settings.fontPt)
      setFits(packed.pages.length <= targetPages)
    }
  }, [items, geometry, settings])

  // Webfonts land after first paint and change every measurement, so redo the
  // layout once they are ready rather than shipping a fit based on fallbacks.
  useEffect(() => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (!fonts) return
    let cancelled = false
    void fonts.ready.then(() => {
      if (!cancelled) setSettings((prev) => ({ ...prev }))
    })
    return () => {
      cancelled = true
    }
  }, [])

  /* -- preview zoom ---------------------------------------------------- */

  const stageRef = useRef<HTMLDivElement>(null)
  const [stageBox, setStageBox] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const node = stageRef.current
    if (!node) return

    // "Fit" means the whole page visible, so the height available below the
    // stage's top edge matters as much as its width.
    const read = () => {
      const rect = node.getBoundingClientRect()
      setStageBox({
        width: node.clientWidth,
        height: Math.max(240, window.innerHeight - rect.top - 72),
      })
    }

    const observer = new ResizeObserver(read)
    observer.observe(node)
    window.addEventListener('resize', read)
    read()

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', read)
    }
  }, [])

  const pageWidthPx = mmToPx(geometry.pageWidthMm)
  const pageHeightPx = mmToPx(geometry.pageHeightMm)

  const zoom = useMemo(() => {
    if (zoomMode !== 'fit') return zoomMode
    if (stageBox.width <= 0) return 1
    const byWidth = (stageBox.width - 2) / pageWidthPx
    const byHeight = stageBox.height / pageHeightPx
    return Math.min(1, Math.max(0.2, Math.min(byWidth, byHeight)))
  }, [zoomMode, stageBox, pageWidthPx, pageHeightPx])

  /* -- readouts -------------------------------------------------------- */

  // How tall the rendered sheet actually is on screen, used to keep the
  // settings drawer from outgrowing it.
  const stageContentHeight =
    layout.pages.length * pageHeightPx * zoom + Math.max(0, layout.pages.length - 1) * 22

  const counts = countByKind(items)
  const pageCount = layout.pages.length
  const fill = lastPageFill(layout, geometry.columnHeightPx, settings.columns)
  const size = pageSizeById(settings.pageSizeId)
  const overBudget = pageCount > settings.targetPages || !fits

  return (
    <div className="shell shell-wide view sheet-view">
      <header className="sheet-topbar no-print">
        <div className="sheet-topbar-identity">
          <h1 className="t-h2">Cheat sheet</h1>
          <p className="t-tiny t-dimmer">
            {counts.formulas} formula{counts.formulas === 1 ? '' : 's'} · {counts.facts} definition
            {counts.facts === 1 ? '' : 's'} · {size.label}{' '}
            {settings.orientation === 'landscape' ? 'landscape' : 'portrait'} ·{' '}
            {settings.columns} column{settings.columns === 1 ? '' : 's'}
          </p>
        </div>

        <span className="spacer" />

        <ZoomControl value={zoomMode} onChange={setZoomMode} />

        <button
          type="button"
          className={`btn btn-outline ${drawerOpen ? 'is-on' : ''}`}
          onClick={() => setDrawerOpen((open) => !open)}
          aria-expanded={drawerOpen}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          Adjust
        </button>

        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          <Printer size={15} aria-hidden="true" />
          Print
        </button>
      </header>

      <div className={`sheet-layout ${drawerOpen ? 'is-open' : ''}`}>
        <div className="sheet-stage" ref={stageRef}>
          {items.length === 0 ? (
            <div className="panel empty">
              <p className="t-h3">Nothing to put on the sheet</p>
              <p className="prose t-small">
                {settings.weakOnly
                  ? "Nothing you're shaky on has formulas or definitions attached. Turn that filter off from Adjust to see everything."
                  : 'This pack records no formulas or definitions. They come from the `formulas` and `keyFacts` fields on topics and subtopics.'}
              </p>
            </div>
          ) : (
            <>
              {overBudget && (
                <SheetStatus
                  pageCount={pageCount}
                  targetPages={settings.targetPages}
                  fits={fits}
                  fill={fill}
                  fontPt={resolvedFontPt}
                  autoFit={settings.autoFit}
                  sheetWidth={pageWidthPx * zoom}
                />
              )}
              <Pages
                pack={pack}
                items={items}
                layout={layout}
                settings={settings}
                fontPt={resolvedFontPt}
                geometry={geometry}
                zoom={zoom}
              />
              {!overBudget && (
                <SheetStatus
                  pageCount={pageCount}
                  targetPages={settings.targetPages}
                  fits={fits}
                  fill={fill}
                  fontPt={resolvedFontPt}
                  autoFit={settings.autoFit}
                  sheetWidth={pageWidthPx * zoom}
                />
              )}
            </>
          )}
        </div>

        {drawerOpen && (
          <Controls
            pack={pack}
            settings={settings}
            selectedTopicIds={selectedTopicIds}
            allTopicIds={allTopicIds}
            update={update}
            resolvedFontPt={resolvedFontPt}
            stageHeight={stageContentHeight}
            onClose={() => setDrawerOpen(false)}
          />
        )}
      </div>

      {/* Hidden measuring column: identical width and typography to a real
          column, so measured heights describe rendered heights exactly.

          The items are rendered directly into the measured element. An earlier
          version rendered them elsewhere and moved the nodes across, which
          broke React's reconciliation and silently left the column empty — so
          every measured height was 0, everything "fitted", and the whole pack
          was packed onto one page. */}
      <div className="sheet-measure" aria-hidden="true">
        <div ref={measureRef} className="sheet-measure-column">
          {items.map((item) => (
            <SheetItemView
              key={item.key}
              item={item}
              showCitations={settings.includeCitations}
              showNotes={settings.includeNotes}
            />
          ))}
        </div>
      </div>

      {/* Page geometry has to reach the print engine too. */}
      <style>{`@page { size: ${size.widthMm}mm ${size.heightMm}mm ${settings.orientation}; margin: 0; }`}</style>
    </div>
  )
}

/* ================================================================== *
 * Topbar pieces
 * ================================================================== */

/**
 * What the page budget is actually doing, said once, under the sheet it
 * describes. Only the exceptional cases get emphasis: over budget, or so much
 * empty space that you could be carrying more in with you.
 */
function SheetStatus({
  pageCount,
  targetPages,
  fits,
  fill,
  fontPt,
  autoFit,
  sheetWidth,
}: {
  pageCount: number
  targetPages: number
  fits: boolean
  fill: number
  fontPt: number
  autoFit: boolean
  /** On-screen width of the sheet, so the line stays aligned with it. */
  sheetWidth: number
}) {
  const over = pageCount > targetPages || !fits
  const roomy = !over && fill < 0.75

  return (
    <p
      className={`sheet-status no-print ${over ? 'is-over' : ''}`}
      style={{ maxWidth: `max(360px, ${Math.round(sheetWidth)}px)` }}
    >
      {over ? (
        <>
          <strong>
            Needs {pageCount} page{pageCount === 1 ? '' : 's'}, budget is {targetPages}.
          </strong>{' '}
          {fits
            ? 'Allow another page, or cut something.'
            : `${pageCount} is the fewest this content fits into at these settings, shown at the
               largest size that achieves it. Cut a section, add a column, narrow the margins, or
               allow ${pageCount} page${pageCount === 1 ? '' : 's'}.`}
        </>
      ) : (
        <>
          {pageCount} page{pageCount === 1 ? '' : 's'} at {fontPt}pt{autoFit ? ' (auto)' : ''} ·{' '}
          last page {Math.round(fill * 100)}% full
          {roomy && <span className="sheet-status-hint"> · room for more</span>}
        </>
      )}
    </p>
  )
}

function ZoomControl({ value, onChange }: { value: ZoomMode; onChange: (value: ZoomMode) => void }) {
  const options: { value: ZoomMode; label: string }[] = [
    { value: 'fit', label: 'Fit' },
    { value: 0.75, label: '75%' },
    { value: 1, label: '100%' },
  ]

  return (
    <div className="segmented segmented-sm" role="group" aria-label="Preview zoom">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={`segmented-option ${value === option.value ? 'is-on' : ''}`}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* ================================================================== *
 * Controls drawer
 * ================================================================== */

function Controls({
  pack,
  settings,
  selectedTopicIds,
  allTopicIds,
  update,
  resolvedFontPt,
  stageHeight,
  onClose,
}: {
  pack: Pack
  settings: SheetSettings
  selectedTopicIds: string[]
  allTopicIds: string[]
  update: (patch: Partial<SheetSettings>) => void
  resolvedFontPt: number
  /** Height of the rendered sheet, so the drawer never outgrows it. */
  stageHeight: number
  onClose: () => void
}) {
  const toggleTopic = (topicId: string) => {
    const next = selectedTopicIds.includes(topicId)
      ? selectedTopicIds.filter((id) => id !== topicId)
      : [...selectedTopicIds, topicId]
    update({ topicIds: next.length === 0 ? allTopicIds : next })
  }

  return (
    <aside
      className="sheet-drawer no-print"
      aria-label="Cheat sheet settings"
      // Never taller than the sheet beside it, so a short one-page sheet
      // doesn't leave the drawer hanging past the bottom of the page and
      // scrolling the document on its own account. Floored so it stays
      // usable when the sheet is very short, and capped to the viewport.
      style={{
        maxHeight: `min(calc(100vh - 88px), max(360px, ${Math.round(stageHeight)}px))`,
      }}
    >
      <header className="sheet-drawer-head">
        <h2 className="t-h3">Adjust</h2>
        <span className="spacer" />
        <button type="button" className="btn btn-quiet btn-icon" onClick={onClose} title="Close">
          <X size={16} aria-hidden="true" />
          <span className="visually-hidden">Close settings</span>
        </button>
      </header>

      <div className="sheet-drawer-body">
        <ControlGroup title="Fit">
          <label className="check">
            <input
              type="checkbox"
              checked={settings.autoFit}
              onChange={(e) => update({ autoFit: e.target.checked })}
            />
            <span>
              <span className="t-h3">Shrink to fit</span>
              <span className="t-tiny t-dimmer">
                Largest readable size that still fits your page budget
              </span>
            </span>
          </label>

          <Field label="Pages allowed">
            <Stepper
              value={settings.targetPages}
              min={1}
              max={12}
              onChange={(value) => update({ targetPages: value })}
            />
          </Field>

          <Field
            label={
              settings.autoFit ? `Type size · ${resolvedFontPt}pt (auto)` : `Type size · ${settings.fontPt}pt`
            }
          >
            <input
              className="slider"
              type="range"
              min={MIN_FONT_PT}
              max={MAX_FONT_PT}
              step={FONT_STEP}
              value={settings.autoFit ? resolvedFontPt : settings.fontPt}
              disabled={settings.autoFit}
              onChange={(e) => update({ fontPt: Number(e.target.value) })}
            />
          </Field>

          <Field label={`Line height · ${settings.lineHeight.toFixed(2)}`}>
            <input
              className="slider"
              type="range"
              min={1.05}
              max={1.7}
              step={0.05}
              value={settings.lineHeight}
              onChange={(e) => update({ lineHeight: Number(e.target.value) })}
            />
          </Field>
        </ControlGroup>

        <ControlGroup title="Paper">
          <Field label="Size">
            <select
              className="field field-sm"
              value={settings.pageSizeId}
              onChange={(e) => update({ pageSizeId: e.target.value })}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size.id} value={size.id}>
                  {size.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Orientation">
            <Segmented
              value={settings.orientation}
              options={[
                { value: 'portrait', label: 'Portrait' },
                { value: 'landscape', label: 'Landscape' },
              ]}
              onChange={(value) => update({ orientation: value as SheetSettings['orientation'] })}
            />
          </Field>

          <Field label={`Margin · ${settings.marginMm}mm`}>
            <input
              className="slider"
              type="range"
              min={0}
              max={25}
              step={1}
              value={settings.marginMm}
              onChange={(e) => update({ marginMm: Number(e.target.value) })}
            />
          </Field>
        </ControlGroup>

        <ControlGroup title="Columns">
          <Field label="Count">
            <Stepper
              value={settings.columns}
              min={1}
              max={6}
              onChange={(value) => update({ columns: value })}
            />
          </Field>

          <Field label={`Gutter · ${settings.columnGapMm}mm`}>
            <input
              className="slider"
              type="range"
              min={2}
              max={16}
              step={1}
              value={settings.columnGapMm}
              onChange={(e) => update({ columnGapMm: Number(e.target.value) })}
            />
          </Field>
        </ControlGroup>

        <ControlGroup title="Include">
          <Check
            label="Formulas"
            checked={settings.includeFormulas}
            onChange={(v) => update({ includeFormulas: v })}
          />
          <Check
            label="Definitions"
            checked={settings.includeDefinitions}
            onChange={(v) => update({ includeDefinitions: v })}
          />
          <Check
            label="Notes under formulas"
            checked={settings.includeNotes}
            onChange={(v) => update({ includeNotes: v })}
          />
          <Check
            label="Source citations"
            checked={settings.includeCitations}
            onChange={(v) => update({ includeCitations: v })}
          />
          <Check
            label="Section headings"
            checked={settings.showSectionHeadings}
            onChange={(v) => update({ showSectionHeadings: v })}
          />
          <Check
            label="Topic labels"
            checked={settings.showTopicLabels}
            onChange={(v) => update({ showTopicLabels: v })}
          />
          <Check
            label="Title block"
            checked={settings.showTitle}
            onChange={(v) => update({ showTitle: v })}
          />
          <Check
            label="Only what I'm shaky on"
            checked={settings.weakOnly}
            onChange={(v) => update({ weakOnly: v })}
          />
        </ControlGroup>

        <ControlGroup title="Order">
          <Segmented
            value={settings.order}
            options={[
              { value: 'pack', label: 'Pack' },
              { value: 'alpha', label: 'A–Z' },
              { value: 'weakest', label: 'Weakest' },
            ]}
            onChange={(value) => update({ order: value as SheetSettings['order'] })}
          />
        </ControlGroup>

        <ControlGroup title="Topics">
          <div className="sheet-topic-list">
            {pack.topics.map((topic) => (
              <label
                key={topic.id}
                className={`topic-toggle ${selectedTopicIds.includes(topic.id) ? 'is-on' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selectedTopicIds.includes(topic.id)}
                  onChange={() => toggleTopic(topic.id)}
                />
                <span>{topic.title}</span>
              </label>
            ))}
          </div>
        </ControlGroup>
      </div>
    </aside>
  )
}

/* -- small control primitives -- */

function ControlGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="control-group">
      <h3 className="t-label">{title}</h3>
      <div className="control-group-body">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="control-field">
      <span className="t-tiny t-dim">{label}</span>
      {children}
    </label>
  )
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="check check-inline">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="t-small">{label}</span>
    </label>
  )
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className="segmented" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`segmented-option ${value === option.value ? 'is-on' : ''}`}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div className="stepper">
      <button
        type="button"
        className="stepper-btn"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="Decrease"
      >
        <Minus size={13} aria-hidden="true" />
      </button>
      <span className="stepper-value t-mono">{value}</span>
      <button
        type="button"
        className="stepper-btn"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="Increase"
      >
        <Plus size={13} aria-hidden="true" />
      </button>
    </div>
  )
}

/* ================================================================== *
 * Rendered pages
 * ================================================================== */

function Pages({
  pack,
  items,
  layout,
  settings,
  fontPt,
  geometry,
  zoom,
}: {
  pack: Pack
  items: SheetItem[]
  layout: Layout
  settings: SheetSettings
  fontPt: number
  geometry: Geometry
  zoom: number
}) {
  const pageWidthPx = mmToPx(geometry.pageWidthMm)
  const pageHeightPx = mmToPx(geometry.pageHeightMm)

  return (
    <div className="sheet-pages">
      {layout.pages.map((columns, pageIndex) => (
        <div
          key={pageIndex}
          className="sheet-page-frame"
          style={{ width: pageWidthPx * zoom, height: pageHeightPx * zoom }}
        >
          <article
            className="sheet-page"
            style={{
              width: `${geometry.pageWidthMm}mm`,
              height: `${geometry.pageHeightMm}mm`,
              padding: `${settings.marginMm}mm`,
              fontSize: `${fontPt}pt`,
              lineHeight: settings.lineHeight,
              transform: `scale(${zoom})`,
            }}
          >
            <div
              className="sheet-page-body"
              style={{
                gap: `${settings.columnGapMm}mm`,
                gridTemplateColumns: `repeat(${settings.columns}, 1fr)`,
              }}
            >
              {columns.map((columnItems, columnIndex) => (
                <div key={columnIndex} className="sheet-column">
                  {pageIndex === 0 && columnIndex === 0 && settings.showTitle && (
                    <header className="sheet-title">
                      <span className="sheet-title-name">{pack.manifest.title}</span>
                      {pack.manifest.subtitle && (
                        <span className="sheet-title-sub">{pack.manifest.subtitle}</span>
                      )}
                    </header>
                  )}
                  {columnItems.map((itemIndex) => (
                    <SheetItemView
                      key={items[itemIndex].key}
                      item={items[itemIndex]}
                      showCitations={settings.includeCitations}
                      showNotes={settings.includeNotes}
                    />
                  ))}
                </div>
              ))}
            </div>
          </article>

          <span className="sheet-page-number no-print">
            {pageIndex + 1} / {layout.pages.length}
          </span>
        </div>
      ))}
    </div>
  )
}

function SheetItemView({
  item,
  showCitations,
  showNotes,
}: {
  item: SheetItem
  showCitations: boolean
  showNotes: boolean
}) {
  if (item.kind === 'section') {
    return <h3 className="sheet-section-heading">{item.title}</h3>
  }

  if (item.kind === 'topic') {
    return <h4 className="sheet-topic-heading">{item.title}</h4>
  }

  return (
    <div className={`sheet-entry sheet-entry-${item.kind}`}>
      <p className="sheet-entry-name">
        <span>{item.title}</span>
        {showCitations && item.source && <span className="sheet-entry-cite">{item.source}</span>}
      </p>
      {item.kind === 'formula' ? (
        <p className="sheet-entry-expr">{item.body}</p>
      ) : (
        <Markish className="sheet-entry-def">{item.body}</Markish>
      )}
      {showNotes && item.note && <Markish className="sheet-entry-note">{item.note}</Markish>}
    </div>
  )
}

/* ================================================================== *
 * Building the item list
 * ================================================================== */

interface Collected {
  item: SheetItem
  topicId: string
  topicTitle: string
  weakness: number
}

function buildItems(
  pack: Pack,
  progress: PackProgress,
  settings: SheetSettings,
  selectedTopicIds: string[],
): SheetItem[] {
  const selected = new Set(selectedTopicIds)
  const formulas: Collected[] = []
  const facts: Collected[] = []

  for (const topic of pack.topics) {
    if (!selected.has(topic.id)) continue

    const topicWeakness =
      1 - masteryOf(topic.subtopics.flatMap((s) => s.questions), progress).score

    // Topic-level entries survive the "shaky only" filter whenever the topic
    // as a whole is shaky, so a filtered sheet keeps its headline formulas.
    const topicShaky = topicWeakness > 0.28

    if (!settings.weakOnly || topicShaky) {
      ;(topic.formulas ?? []).forEach((formula, i) => {
        formulas.push({
          item: {
            key: `f:${topic.id}:t:${i}`,
            kind: 'formula',
            title: formula.name,
            body: formula.expression,
            note: formula.note,
            source: formula.source,
            topicTitle: topic.title,
          },
          topicId: topic.id,
          topicTitle: topic.title,
          weakness: topicWeakness,
        })
      })
      ;(topic.keyFacts ?? []).forEach((fact, i) => {
        facts.push({
          item: {
            key: `d:${topic.id}:t:${i}`,
            kind: 'fact',
            title: fact.term,
            body: fact.definition,
            source: fact.source,
            topicTitle: topic.title,
          },
          topicId: topic.id,
          topicTitle: topic.title,
          weakness: topicWeakness,
        })
      })
    }

    for (const subtopic of topic.subtopics) {
      const mastery = masteryOf(subtopic.questions, progress)
      if (settings.weakOnly && mastery.state === 'strong') continue
      const weakness = 1 - mastery.score

      ;(subtopic.formulas ?? []).forEach((formula, i) => {
        formulas.push({
          item: {
            key: `f:${topic.id}:${subtopic.id}:${i}`,
            kind: 'formula',
            title: formula.name,
            body: formula.expression,
            note: formula.note,
            source: formula.source,
            topicTitle: topic.title,
          },
          topicId: topic.id,
          topicTitle: topic.title,
          weakness,
        })
      })
      ;(subtopic.keyFacts ?? []).forEach((fact, i) => {
        facts.push({
          item: {
            key: `d:${topic.id}:${subtopic.id}:${i}`,
            kind: 'fact',
            title: fact.term,
            body: fact.definition,
            source: fact.source,
            topicTitle: topic.title,
          },
          topicId: topic.id,
          topicTitle: topic.title,
          weakness,
        })
      })
    }
  }

  const sortGroup = (group: Collected[]): Collected[] => {
    if (settings.order === 'alpha') {
      return [...group].sort((a, b) => a.item.title.localeCompare(b.item.title))
    }
    if (settings.order === 'weakest') {
      return [...group].sort((a, b) => b.weakness - a.weakness)
    }
    return group
  }

  const out: SheetItem[] = []

  const emit = (group: Collected[], heading: string) => {
    if (group.length === 0) return

    if (settings.showSectionHeadings) {
      out.push({ key: `h:${heading}`, kind: 'section', title: heading })
    }

    const sorted = sortGroup(group)

    if (settings.showTopicLabels && settings.order === 'pack') {
      let lastTopic: string | null = null
      for (const entry of sorted) {
        if (entry.topicId !== lastTopic) {
          out.push({ key: `t:${heading}:${entry.topicId}`, kind: 'topic', title: entry.topicTitle })
          lastTopic = entry.topicId
        }
        out.push(entry.item)
      }
      return
    }

    for (const entry of sorted) out.push(entry.item)
  }

  if (settings.includeFormulas) emit(formulas, 'Formulas')
  if (settings.includeDefinitions) emit(facts, 'Definitions')

  return out
}
