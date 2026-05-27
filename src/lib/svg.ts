import { useEffect, useMemo, useState } from "react"

export interface SvgSlot {
  id: string
  defaultFill: string
  displayName: string
  synthetic: boolean
}

const PAINTABLE_SELECTOR = "path, rect, circle, ellipse, polygon, polyline, line, text, use"

const svgTextCache = new Map<string, Promise<string>>()

export function isSvgPath(path: string | null | undefined): boolean {
  if (!path) return false
  return path.toLowerCase().endsWith(".svg")
}

export async function fetchSvgText(url: string): Promise<string> {
  let p = svgTextCache.get(url)
  if (!p) {
    p = fetch(url).then((r) => r.text())
    svgTextCache.set(url, p)
  }
  return p
}

function readClassFillMap(doc: Document): Map<string, { fill?: string; stroke?: string }> {
  const map = new Map<string, { fill?: string; stroke?: string }>()
  const styles = doc.querySelectorAll("style")
  styles.forEach((s) => {
    const css = s.textContent || ""
    const re = /\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(css)) !== null) {
      const cls = m[1]
      const body = m[2]
      const fill = body.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1]?.trim()
      const stroke = body.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/i)?.[1]?.trim()
      if (fill || stroke) {
        const prev = map.get(cls) ?? {}
        map.set(cls, { fill: fill ?? prev.fill, stroke: stroke ?? prev.stroke })
      }
    }
  })
  return map
}

function effectiveColor(
  el: Element,
  classMap: Map<string, { fill?: string; stroke?: string }>,
): { color: string; source: "fill" | "stroke" } | null {
  const fillAttr = el.getAttribute("fill")
  const strokeAttr = el.getAttribute("stroke")
  const styleAttr = el.getAttribute("style") || ""
  const styleFill = styleAttr.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1]?.trim()
  const styleStroke = styleAttr.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/i)?.[1]?.trim()

  let classFill: string | undefined
  let classStroke: string | undefined
  const cls = el.getAttribute("class")
  if (cls) {
    for (const c of cls.split(/\s+/)) {
      const entry = classMap.get(c)
      if (entry) {
        if (!classFill && entry.fill) classFill = entry.fill
        if (!classStroke && entry.stroke) classStroke = entry.stroke
      }
    }
  }

  const fill = (styleFill && styleFill !== "none")
    ? styleFill
    : (fillAttr && fillAttr !== "none")
      ? fillAttr
      : (classFill && classFill !== "none") ? classFill : null

  if (fill) return { color: fill, source: "fill" }

  const stroke = (styleStroke && styleStroke !== "none")
    ? styleStroke
    : (strokeAttr && strokeAttr !== "none")
      ? strokeAttr
      : (classStroke && classStroke !== "none") ? classStroke : null

  if (stroke) return { color: stroke, source: "stroke" }
  return null
}

export interface SlotInfo extends SvgSlot {
  source: "fill" | "stroke"
}

export function slotFallbackLabel(slot: SvgSlot): string {
  return slot.displayName || slot.id
}

function syntheticSlotKey(source: "fill" | "stroke", normalizedColor: string): string {
  return `color:${source === "fill" ? "FILL" : "STROKE"}:${normalizedColor}`
}

function parseSyntheticKey(key: string): { source: "fill" | "stroke"; color: string } | null {
  if (!key.startsWith("color:")) return null
  const parts = key.split(":")
  if (parts.length !== 3) return null
  const source = parts[1] === "STROKE" ? "stroke" : "fill"
  return { source, color: parts[2] }
}

export function parseSvg(text: string): { doc: Document; slots: SvgSlot[]; slotInfo: SlotInfo[] } {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml")
  const classMap = readClassFillMap(doc)
  const slots: SvgSlot[] = []
  const slotInfo: SlotInfo[] = []
  const seenId = new Set<string>()
  const seenSynthetic = new Set<string>()

  const all = doc.querySelectorAll(PAINTABLE_SELECTOR)
  all.forEach((el) => {
    const eff = effectiveColor(el, classMap)
    if (!eff) return
    const normalized = normalizeColor(eff.color)
    const id = el.getAttribute("id") || ""

    if (id) {
      if (seenId.has(id)) return
      seenId.add(id)
      slots.push({ id, defaultFill: normalized, displayName: id, synthetic: false })
      slotInfo.push({ id, defaultFill: normalized, displayName: id, synthetic: false, source: eff.source })
      return
    }

    const key = syntheticSlotKey(eff.source, normalized)
    if (seenSynthetic.has(key)) return
    seenSynthetic.add(key)
    slots.push({ id: key, defaultFill: normalized, displayName: normalized, synthetic: true })
    slotInfo.push({ id: key, defaultFill: normalized, displayName: normalized, synthetic: true, source: eff.source })
  })

  return { doc, slots, slotInfo }
}

export function applyColors(text: string, colors: Record<string, string>): string {
  if (!colors || Object.keys(colors).length === 0) return text
  const doc = new DOMParser().parseFromString(text, "image/svg+xml")
  const classMap = readClassFillMap(doc)
  const overrideRules: string[] = []
  let applied = 0

  const entries = Object.entries(colors).filter(([, c]) => !!c)

  const explicit = entries.filter(([k]) => !k.startsWith("color:"))
  const synthetic = entries
    .map(([k, color]) => {
      const parsed = parseSyntheticKey(k)
      return parsed ? { key: k, ...parsed, target: color } : null
    })
    .filter((v): v is { key: string; source: "fill" | "stroke"; color: string; target: string } => v != null)

  for (const [id, color] of explicit) {
    const el = doc.getElementById(id)
    if (!el) continue
    const eff = effectiveColor(el, classMap)
    const source: "fill" | "stroke" = eff?.source ?? "fill"

    el.setAttribute(source, color)
    stripStyleProp(el, source)
    overrideRules.push(`#${cssEscape(id)}{${source}:${color} !important;}`)
    applied++
  }

  if (synthetic.length > 0) {
    const all = doc.querySelectorAll(PAINTABLE_SELECTOR)
    let groupIdx = 0
    const groupClassByKey = new Map<string, string>()

    all.forEach((el) => {
      const eff = effectiveColor(el, classMap)
      if (!eff) return
      const normalized = normalizeColor(eff.color)
      for (const s of synthetic) {
        if (s.source === eff.source && normalized === s.color) {
          el.setAttribute(s.source, s.target)
          stripStyleProp(el, s.source)
          let cls = groupClassByKey.get(s.key)
          if (!cls) {
            cls = `sgs-slot-${groupIdx++}`
            groupClassByKey.set(s.key, cls)
            overrideRules.push(`.${cls}{${s.source}:${s.target} !important;}`)
          }
          const existing = el.getAttribute("class")
          const next = existing ? `${existing} ${cls}` : cls
          el.setAttribute("class", next)
          applied++
          break
        }
      }
    })
  }

  if (applied === 0) return text

  if (overrideRules.length > 0) {
    const svg = doc.documentElement
    const styleEl = doc.createElementNS("http://www.w3.org/2000/svg", "style")
    styleEl.textContent = overrideRules.join("")
    svg.appendChild(styleEl)
  }

  return new XMLSerializer().serializeToString(doc)
}

function stripStyleProp(el: Element, prop: "fill" | "stroke") {
  const style = el.getAttribute("style")
  if (!style) return
  const next = style
    .replace(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*[^;]+;?`, "gi"), "")
    .replace(/^\s*;\s*/, "")
    .trim()
  if (next) el.setAttribute("style", next)
  else el.removeAttribute("style")
}

function cssEscape(id: string): string {
  if (typeof (globalThis as any).CSS !== "undefined" && typeof (globalThis as any).CSS.escape === "function") {
    return (globalThis as any).CSS.escape(id)
  }
  return id.replace(/([^\w-])/g, "\\$1")
}

export function svgToDataUrl(text: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(text)}`
}

export function setSvgDimensions(text: string, width: number, height: number): string {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml")
  const svg = doc.documentElement
  if (!svg || svg.nodeName.toLowerCase() !== "svg") return text
  if (!svg.getAttribute("viewBox")) {
    const origW = svg.getAttribute("width") || String(width)
    const origH = svg.getAttribute("height") || String(height)
    svg.setAttribute("viewBox", `0 0 ${parseFloat(origW)} ${parseFloat(origH)}`)
  }
  svg.setAttribute("width", String(width))
  svg.setAttribute("height", String(height))
  return new XMLSerializer().serializeToString(doc)
}

function normalizeColor(c: string): string {
  const v = c.trim()
  if (v.startsWith("#")) return v.toUpperCase()
  return v
}

export function useAssetSrc(url: string | null, colors: Record<string, string> | null | undefined): string | null {
  const isSvg = isSvgPath(url)
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!url || !isSvg) { setText(null); return }
    fetchSvgText(url).then((t) => { if (!cancelled) setText(t) }).catch(() => { if (!cancelled) setText(null) })
    return () => { cancelled = true }
  }, [url, isSvg])

  // Stabilize colors by value rather than reference so the parent
  // can pass `someArray.find(...)?.colors` without thrashing the memo.
  const colorsKey = useMemo(() => {
    if (!colors) return ""
    const keys = Object.keys(colors).sort()
    return keys.map((k) => `${k}:${colors[k]}`).join("|")
  }, [colors])

  return useMemo(() => {
    if (!url) return null
    if (!isSvg) return url
    if (!text) return null
    const patched = applyColors(text, colors ?? {})
    return svgToDataUrl(patched)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, isSvg, text, colorsKey])
}

export function useSvgAsset(url: string | null, colors: Record<string, string> | null) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!url) { setText(null); return }
    fetchSvgText(url).then((t) => { if (!cancelled) setText(t) }).catch(() => { if (!cancelled) setText(null) })
    return () => { cancelled = true }
  }, [url])

  const slots = useMemo<SvgSlot[]>(() => {
    if (!text) return []
    return parseSvg(text).slots
  }, [text])

  const src = useMemo(() => {
    if (!text) return null
    const patched = applyColors(text, colors ?? {})
    return svgToDataUrl(patched)
  }, [text, colors])

  return { text, slots, src }
}
