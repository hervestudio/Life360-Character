import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import JSZip from "jszip"
import { ChevronLeft, ChevronRight, Download, FolderArchive, Loader2, Lock, Pencil, Shuffle } from "lucide-react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import type { AgeGroup, Asset, BodyDefaultOutfit, CategoryDefault, Gender, HeadExpressionColor, HeadExpressionDefault, LayerOrder, SkinTone, Transform } from "@/lib/supabase"
import { DEFAULT_LAYER_ORDER, IDENTITY_TRANSFORM, SKIN_TONES, fetchAssets, fetchBodyDefaultOutfits, fetchCategoryDefaults, fetchHeadExpressionColors, fetchHeadExpressionDefaults, fetchLayerOrder, isCurrentUserAdmin, publicUrl, r2ProxyUrl, thumbnailUrl, resolveExpressionTransform, resolveTransform, supabase } from "@/lib/supabase"
import { applyColors, fetchSvgText, isSvgPath, setSvgDimensions, svgToDataUrl, useAssetSrc } from "@/lib/svg"

const CANVAS = 1000

const AGES: { key: AgeGroup; label: string }[] = [
  { key: "kid", label: "Kid" },
  { key: "teen", label: "Teen" },
  { key: "adult", label: "Adult" },
  { key: "senior", label: "Senior" },
]

const GENDERS: { key: Gender; label: string }[] = [
  { key: "female", label: "Female" },
  { key: "male", label: "Male" },
]

function randomPick<T>(arr: T[]): T | null {
  if (!arr.length) return null
  return arr[Math.floor(Math.random() * arr.length)]
}

interface Selection {
  age: AgeGroup
  gender: Gender
  skin_tone: SkinTone
  hair_id: string | null
  accessory_id: string | null
  expression_id: string | null
  outfit_id: string | null
}

interface LibConfig {
  ages: AgeGroup[]
  genders: Gender[]
  skins: SkinTone[]
  outfitsMode: "default" | "all"
  exprIds: (string | null)[] // null = "no expression"; string = expression asset id
  size: number
}

function Life360Logo({ className }: { className?: string }) {
  return <img src="/Purple.svg" alt="Life 360" className={className} />
}

function RadioRow({
  label,
  active,
  onClick,
  dotColor,
}: {
  label: string
  active: boolean
  onClick: () => void
  dotColor?: string
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3 py-1.5 text-left"
    >
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
          active ? "border-transparent" : "border-muted-foreground/40 group-hover:border-foreground/60"
        }`}
        style={active ? { background: dotColor ?? "var(--primary)" } : undefined}
      >
        {!active && <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />}
      </span>
      <span
        className={`text-sm transition ${
          active ? "font-medium text-foreground" : "text-muted-foreground group-hover:text-foreground"
        }`}
      >
        {label}
      </span>
    </button>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-base font-semibold tracking-tight">{children}</h2>
  )
}

export default function ClientPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const builderInit = (location.state ?? null) as null | {
    builder?: {
      age: AgeGroup
      gender: Gender
      skin: SkinTone
      category: "hair" | "outfit" | "accessory" | "expression"
      assetId: string | null
      headId: string | null
    }
  }
  const [isAdmin, setIsAdmin] = useState(false)
  const [assets, setAssets] = useState<Asset[]>([])
  const [defaults, setDefaults] = useState<CategoryDefault[]>([])
  const [layerOrder, setLayerOrder] = useState<LayerOrder[]>(DEFAULT_LAYER_ORDER)
  const [headExprDefaults, setHeadExprDefaults] = useState<HeadExpressionDefault[]>([])
  const [headExprColors, setHeadExprColors] = useState<HeadExpressionColor[]>([])
  const [, setDefaultOutfits] = useState<BodyDefaultOutfit[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [libProgress, setLibProgress] = useState<{ done: number; total: number; phase: "render" | "zip" } | null>(null)
  const [showLibConfig, setShowLibConfig] = useState(false)
  const libCancel = useRef(false)
  const [tab, setTab] = useState<"hair" | "outfit" | "accessory" | "expression">("hair")
  const [sel, setSel] = useState<Selection>({
    age: "adult",
    gender: "female",
    skin_tone: "light",
    hair_id: null,
    accessory_id: null,
    expression_id: null,
    outfit_id: null,
  })

  useEffect(() => {
    let alive = true
    const check = async () => {
      const { data } = await supabase.auth.getUser()
      if (!alive) return
      if (!data.user) { setIsAdmin(false); return }
      try {
        const admin = await isCurrentUserAdmin()
        if (alive) setIsAdmin(admin)
      } catch { if (alive) setIsAdmin(false) }
    }
    check()
    const { data: sub } = supabase.auth.onAuthStateChange(() => { check() })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    Promise.all([fetchAssets({ onlyActive: true }), fetchCategoryDefaults(), fetchLayerOrder(), fetchHeadExpressionDefaults(), fetchBodyDefaultOutfits(), fetchHeadExpressionColors()])
      .then(([rows, defs, order, hexpr, defOutfits, hcolors]) => {
        setAssets(rows)
        setDefaults(defs)
        setLayerOrder(order)
        setHeadExprDefaults(hexpr)
        setHeadExprColors(hcolors)
        setDefaultOutfits(defOutfits)
        // Thumbnails load lazily per visible tile (see grid <img loading="lazy">).
        // A blanket preload of all ~130 thumbnails here used to fetch several MB
        // upfront and starve the visible body/hair images of bandwidth.
        const b = builderInit?.builder
        if (b) {
          setTab(b.category)
          const outfits = rows.filter((a) => a.category === "outfit")
          setSel({
            age: b.age,
            gender: b.gender,
            skin_tone: b.skin,
            hair_id: b.headId ?? (b.category === "hair" ? b.assetId : null),
            accessory_id: b.category === "accessory" ? b.assetId : null,
            expression_id: b.category === "expression" ? b.assetId : null,
            outfit_id: b.category === "outfit" ? (outfits.find((o) => o.id === b.assetId)?.id ?? null) : null,
          })
        } else {
          const bodies = rows.filter((a) => a.category === "body")
          const seed = bodies[Math.floor(Math.random() * bodies.length)]
          if (seed && seed.age && seed.gender && seed.skin_tone) {
            const heads = rows.filter((a) => a.category === "hair" && a.skin_tone === seed.skin_tone && a.age === seed.age && a.gender === seed.gender)
            const accs = rows.filter((a) => a.category === "accessory")
            const def = defOutfits.find((d) => d.body_id === seed.id)
            const outfits = rows.filter((a) => a.category === "outfit" && a.parent_body_id === seed.id)
            const initialOutfit = def && outfits.find((o) => o.id === def.outfit_id) ? def.outfit_id : null
            // Default to the first expression ("Expression 01") so the character starts expressive.
            const firstExpression = rows.filter((a) => a.category === "expression")[0]?.id ?? null
            setSel({
              age: seed.age,
              gender: seed.gender,
              skin_tone: seed.skin_tone,
              hair_id: heads.length ? heads[Math.floor(Math.random() * heads.length)].id : null,
              accessory_id: accs.length ? accs[Math.floor(Math.random() * accs.length)].id : null,
              expression_id: firstExpression,
              outfit_id: initialOutfit,
            })
          }
        }
      })
      .catch((err) => {
        console.error("ClientPage data fetch failed:", err)
        toast.error("Failed to load assets")
      })
      .finally(() => setLoading(false))
  }, [])

  const grouped = useMemo(() => {
    return {
      body: assets.filter((a) => a.category === "body"),
      hair: assets.filter((a) => a.category === "hair"),
      accessory: assets.filter((a) => a.category === "accessory"),
      expression: assets.filter((a) => a.category === "expression"),
      outfit: assets.filter((a) => a.category === "outfit"),
    }
  }, [assets])

  const body = useMemo(
    () =>
      grouped.body.find(
        (a) => a.age === sel.age && a.gender === sel.gender && a.skin_tone === sel.skin_tone,
      ) ?? null,
    [grouped.body, sel.age, sel.gender, sel.skin_tone],
  )
  const availableHeads = useMemo(
    () =>
      grouped.hair.filter(
        (a) =>
          a.skin_tone === sel.skin_tone &&
          a.age === sel.age &&
          a.gender === sel.gender,
      ),
    [grouped.hair, sel.skin_tone, sel.age, sel.gender],
  )
  const availableOutfits = useMemo(
    () => grouped.outfit.filter((o) => body && o.parent_body_id === body.id),
    [grouped.outfit, body],
  )
  const hair = availableHeads.find((a) => a.id === sel.hair_id) ?? null
  const accessory = grouped.accessory.find((a) => a.id === sel.accessory_id) ?? null
  const expression = grouped.expression.find((a) => a.id === sel.expression_id) ?? null
  const outfit = availableOutfits.find((a) => a.id === sel.outfit_id) ?? null
  const expressionBlend = (layerOrder.find((l) => l.category === "expression")?.blend_mode ?? "normal")

  useEffect(() => {
    const currentValid = sel.hair_id && availableHeads.find((h) => h.id === sel.hair_id)
    if (!currentValid && availableHeads.length) {
      setSel((s) => ({ ...s, hair_id: availableHeads[0].id }))
    } else if (!availableHeads.length && sel.hair_id) {
      setSel((s) => ({ ...s, hair_id: null }))
    }
  }, [availableHeads, sel.hair_id])

  useEffect(() => {
    if (tab === "outfit" && availableOutfits.length === 0) {
      setTab("hair")
    }
  }, [tab, availableOutfits.length])

  useEffect(() => {
    if (!body) return
    if (sel.outfit_id === null) return
    const currentValid = availableOutfits.find((o) => o.id === sel.outfit_id)
    if (!currentValid) {
      setSel((s) => ({ ...s, outfit_id: null }))
    }
  }, [body, availableOutfits, sel.outfit_id])

  function randomize() {
    const availableBody = randomPick(grouped.body)
    if (!availableBody || !availableBody.age || !availableBody.gender || !availableBody.skin_tone) {
      toast.error("No body assets available.")
      return
    }
    const tone = availableBody.skin_tone
    const heads = grouped.hair.filter((h) => h.skin_tone === tone && h.age === availableBody.age && h.gender === availableBody.gender)
    const outfits = grouped.outfit.filter((o) => o.parent_body_id === availableBody.id)
    const outfitChoices: (string | null)[] = [null, ...outfits.map((o) => o.id)]
    const outfitPick = randomPick(outfitChoices) ?? null
    setSel({
      age: availableBody.age,
      gender: availableBody.gender,
      skin_tone: tone,
      hair_id: heads.length ? randomPick(heads)!.id : null,
      accessory_id: grouped.accessory.length ? randomPick(grouped.accessory)!.id : null,
      expression_id: grouped.expression[0]?.id ?? null, // keep Expression 01 active
      outfit_id: outfitPick,
    })
  }

  async function exportPng() {
    if (exporting) return
    setExporting(true)
    try {
    const load = async (src: string, attempts = 3): Promise<HTMLImageElement> => {
      let lastErr: unknown
      for (let i = 0; i < attempts; i++) {
        try {
          const resp = await fetch(src, { cache: 'reload' })
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
          const blob = await resp.blob()
          const url = URL.createObjectURL(blob)
          return await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image()
            img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load failed")) }
            img.src = url
          })
        } catch (e) {
          lastErr = e
          if (i < attempts - 1) {
            await new Promise(r => setTimeout(r, 400 * (i + 1)))
          }
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error("load failed")
    }
    const loadWithFallback = async (asset: Asset): Promise<HTMLImageElement> => {
      const primary = publicUrl(asset.storage_path, asset.storage_provider)
      try {
        return await load(primary)
      } catch {
        return await load(r2ProxyUrl(asset.storage_path))
      }
    }
    const fetchSvgWithFallback = async (asset: Asset): Promise<string> => {
      const primary = publicUrl(asset.storage_path, asset.storage_provider)
      try {
        return await fetchSvgText(primary)
      } catch {
        return await fetchSvgText(r2ProxyUrl(asset.storage_path))
      }
    }
    const bodyImg = body ? await loadWithFallback(body).catch(() => null) : null
    const nativeSize = bodyImg ? Math.max(bodyImg.naturalWidth, bodyImg.naturalHeight) : CANVAS
    const size = Math.max(CANVAS, nativeSize)
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = size
    const ctx = canvas.getContext("2d")!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    const scaleFactor = size / CANVAS
    const zOf = (cat: LayerOrder["category"]) => layerOrder.find((l) => l.category === cat)?.z_index ?? 0
    const blendOf = (cat: LayerOrder["category"]) => layerOrder.find((l) => l.category === cat)?.blend_mode ?? "normal"
    const allLayers = [
      { asset: outfit ?? body, z: zOf("body"), blend: blendOf("body") },
      { asset: hair, z: zOf("hair"), blend: blendOf("hair") },
      { asset: accessory, z: zOf("accessory"), blend: blendOf("accessory") },
      { asset: expression, z: zOf("expression"), blend: blendOf("expression") },
    ].sort((a, b) => a.z - b.z)
    for (const l of allLayers) {
      if (!l.asset) continue
      try {
        let layerSrc = publicUrl(l.asset.storage_path, l.asset.storage_provider)
        if (isSvgPath(l.asset.storage_path)) {
          try {
            let text = await fetchSvgWithFallback(l.asset)
            if (l.asset.category === "expression") {
              const override = hair ? headExprColors.find((c) => c.head_id === hair.id && c.expression_id === l.asset!.id)?.colors : null
              if (override && Object.keys(override).length > 0) {
                text = applyColors(text, override)
              }
            }
            const vbMatch = text.match(/viewBox="([^"]+)"/)
            let svgRatio = 1
            if (vbMatch) {
              const parts = vbMatch[1].split(/[\s,]+/).map(parseFloat)
              if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
                svgRatio = parts[2] / parts[3]
              }
            }
            const svgW = svgRatio >= 1 ? size : Math.round(size * svgRatio)
            const svgH = svgRatio >= 1 ? Math.round(size / svgRatio) : size
            text = setSvgDimensions(text, svgW, svgH)
            layerSrc = svgToDataUrl(text)
          } catch {}
        }
        const isSvgAsset = isSvgPath(l.asset.storage_path)
        const img = l.asset.id === body?.id && bodyImg
          ? bodyImg
          : isSvgAsset
            ? await load(layerSrc)
            : await loadWithFallback(l.asset).catch(() => load(layerSrc))
        ctx.globalCompositeOperation = (l.blend && l.blend !== "normal" ? l.blend : "source-over") as GlobalCompositeOperation
        if (l.asset.category === "body" || l.asset.category === "outfit") {
          const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight)
          const w = img.naturalWidth * scale
          const h = img.naturalHeight * scale
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
        } else {
          const t = l.asset.category === "expression"
            ? resolveExpressionTransform(l.asset, hair?.id ?? null, body?.id ?? null, defaults, headExprDefaults)
            : resolveTransform(l.asset, body?.id ?? null, defaults)
          const isSvg = isSvgPath(l.asset.storage_path)
          const baseW = isSvg ? size : img.naturalWidth
          const baseH = isSvg ? size : img.naturalHeight
          const w = isSvg ? baseW * t.scale : baseW * t.scale * scaleFactor
          const svgRatio = isSvg && img.naturalWidth > 0 && img.naturalHeight > 0
            ? img.naturalWidth / img.naturalHeight
            : 1
          const h = isSvg ? (w / svgRatio) : baseH * t.scale * scaleFactor
          const x = (size - w) / 2 + t.offset_x * scaleFactor
          const y = (size - h) / 2 + t.offset_y * scaleFactor
          ctx.drawImage(img, x, y, w, h)
        }
      } catch (e) {
        console.warn("Export PNG: layer skipped", l.asset?.category, l.asset?.id, e)
      }
    }
    const slug = (v: string | null | undefined) =>
      (v ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    const parts = [
      sel.age,
      sel.gender,
      sel.skin_tone,
      hair?.label ?? "no-hair",
      outfit?.label ?? "default-outfit",
      accessory?.label ?? "no-accessory",
      expression?.label ?? "no-expression",
    ]
      .map(slug)
      .filter(Boolean)
    const filename = parts.length ? `character-${parts.join("_")}.png` : "character.png"
    await new Promise<void>((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob)
          const a = document.createElement("a")
          a.href = url
          a.download = filename
          a.click()
          URL.revokeObjectURL(url)
        }
        resolve()
      }, "image/png")
    })
    } finally {
      setExporting(false)
    }
  }

  // Export EVERY combination (body × hair × outfit-option × expression-option) as a ZIP.
  // Composited at 2048px from the display thumbnails, matching what's on screen.
  async function exportLibrary(cfg: LibConfig) {
    if (libProgress) return
    const SIZE = cfg.size
    const slug = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    const baseName = (a: Asset | null) => (a ? (a.storage_path.split("/").pop() || "").replace(/\.[^.]+$/, "") : "")
    const inCfg = (b: Asset) => cfg.ages.includes(b.age as AgeGroup) && cfg.genders.includes(b.gender as Gender) && cfg.skins.includes(b.skin_tone as SkinTone)
    const exprAssets: (Asset | null)[] = cfg.exprIds
      .map((id) => (id === null ? null : grouped.expression.find((e) => e.id === id) ?? undefined))
      .filter((x) => x !== undefined) as (Asset | null)[]
    const outfitOptsFor = (b: Asset): (Asset | null)[] =>
      cfg.outfitsMode === "default" ? [null] : [null, ...grouped.outfit.filter((o) => o.parent_body_id === b.id)]

    type Combo = { body: Asset; hair: Asset | null; outfit: Asset | null; expression: Asset | null }
    const combos: Combo[] = []
    for (const b of grouped.body) {
      if (!inCfg(b)) continue
      const bodyHairs = grouped.hair.filter((h) => h.age === b.age && h.gender === b.gender && h.skin_tone === b.skin_tone)
      const hairOpts: (Asset | null)[] = bodyHairs.length ? bodyHairs : [null]
      for (const hair of hairOpts)
        for (const outfit of outfitOptsFor(b))
          for (const expression of exprAssets)
            combos.push({ body: b, hair, outfit, expression })
    }
    if (!combos.length) { toast.error("Nothing selected to export."); return }

    setShowLibConfig(false)
    libCancel.current = false
    setLibProgress({ done: 0, total: combos.length, phase: "render" })

    const blobToImg = (blob: Blob) => new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(blob)
      const img = new Image()
      img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")) }
      img.src = url
    })
    const loadDataUrl = (u: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("svg decode")); img.src = u
    })
    const fetchBlob = async (url: string) => { const r = await fetch(url, { cache: "force-cache" }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob() }
    // Cache compressed blobs (small); decode to bitmaps on demand and release after each body/hair.
    const blobCache = new Map<string, Blob>()
    const getBlob = async (asset: Asset) => {
      let b = blobCache.get(asset.id)
      if (b) return b
      try { b = await fetchBlob(thumbnailUrl(asset)) } catch { b = await fetchBlob(r2ProxyUrl(asset.thumbnail_path ?? asset.storage_path)) }
      blobCache.set(asset.id, b); return b
    }
    const decode = async (asset: Asset | null) => { if (!asset) return null; try { return await blobToImg(await getBlob(asset)) } catch { return null } }
    const svgTextCache = new Map<string, string>()
    const getSvg = async (asset: Asset) => {
      let t = svgTextCache.get(asset.id)
      if (t) return t
      try { t = await fetchSvgText(publicUrl(asset.storage_path, asset.storage_provider)) } catch { t = await fetchSvgText(r2ProxyUrl(asset.storage_path)) }
      svgTextCache.set(asset.id, t); return t
    }

    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = SIZE
    const ctx = canvas.getContext("2d")!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    const scaleFactor = SIZE / CANVAS
    const zOf = (cat: LayerOrder["category"]) => layerOrder.find((l) => l.category === cat)?.z_index ?? 0
    const blendOf = (cat: LayerOrder["category"]) => layerOrder.find((l) => l.category === cat)?.blend_mode ?? "normal"
    const zip = new JSZip()
    let done = 0

    try {
      for (const b of grouped.body) {
        if (!inCfg(b)) continue
        if (libCancel.current) { setLibProgress(null); return }
        const bodyImg = await decode(b)
        const bodyOutfits = cfg.outfitsMode === "all" ? grouped.outfit.filter((o) => o.parent_body_id === b.id) : []
        const outfitImgs = new Map<string, HTMLImageElement | null>()
        for (const o of bodyOutfits) outfitImgs.set(o.id, await decode(o))
        const bodyHairs = grouped.hair.filter((h) => h.age === b.age && h.gender === b.gender && h.skin_tone === b.skin_tone)
        const hairOpts: (Asset | null)[] = bodyHairs.length ? bodyHairs : [null]

        for (const hair of hairOpts) {
          if (libCancel.current) { setLibProgress(null); return }
          const hairImg = await decode(hair)
          for (const outfit of outfitOptsFor(b)) {
            for (const expression of exprAssets) {
              ctx.clearRect(0, 0, SIZE, SIZE)
              const base = outfit ?? b
              const baseImg = outfit ? outfitImgs.get(outfit.id) ?? null : bodyImg
              const layers = [
                { asset: base, img: baseImg, z: zOf("body"), blend: blendOf("body"), kind: "base" as const },
                { asset: hair, img: hairImg, z: zOf("hair"), blend: blendOf("hair"), kind: "raster" as const },
                { asset: expression, img: null, z: zOf("expression"), blend: blendOf("expression"), kind: "svg" as const },
              ].sort((a, b) => a.z - b.z)
              for (const l of layers) {
                if (!l.asset) continue
                try {
                  ctx.globalCompositeOperation = (l.blend && l.blend !== "normal" ? l.blend : "source-over") as GlobalCompositeOperation
                  if (l.kind === "base") {
                    if (!l.img) continue
                    const s = Math.min(SIZE / l.img.naturalWidth, SIZE / l.img.naturalHeight)
                    const w = l.img.naturalWidth * s, h = l.img.naturalHeight * s
                    ctx.drawImage(l.img, (SIZE - w) / 2, (SIZE - h) / 2, w, h)
                  } else if (l.kind === "svg") {
                    let text = await getSvg(l.asset)
                    const override = hair ? headExprColors.find((k) => k.head_id === hair.id && k.expression_id === l.asset!.id)?.colors : null
                    if (override && Object.keys(override).length > 0) text = applyColors(text, override)
                    const vb = text.match(/viewBox="([^"]+)"/)
                    let ratio = 1
                    if (vb) { const p = vb[1].split(/[\s,]+/).map(parseFloat); if (p.length === 4 && p[2] > 0 && p[3] > 0) ratio = p[2] / p[3] }
                    const svgW = ratio >= 1 ? SIZE : Math.round(SIZE * ratio)
                    const svgH = ratio >= 1 ? Math.round(SIZE / ratio) : SIZE
                    const svgImg = await loadDataUrl(svgToDataUrl(setSvgDimensions(text, svgW, svgH)))
                    const t = resolveExpressionTransform(l.asset, hair?.id ?? null, b.id, defaults, headExprDefaults)
                    const w = SIZE * t.scale
                    const h = w / (svgImg.naturalWidth / svgImg.naturalHeight || 1)
                    ctx.drawImage(svgImg, (SIZE - w) / 2 + t.offset_x * scaleFactor, (SIZE - h) / 2 + t.offset_y * scaleFactor, w, h)
                  } else {
                    if (!l.img) continue
                    const t = resolveTransform(l.asset, b.id, defaults)
                    const w = l.img.naturalWidth * t.scale * scaleFactor
                    const h = l.img.naturalHeight * t.scale * scaleFactor
                    ctx.drawImage(l.img, (SIZE - w) / 2 + t.offset_x * scaleFactor, (SIZE - h) / 2 + t.offset_y * scaleFactor, w, h)
                  }
                } catch (e) { console.warn("lib layer skipped", l.asset?.category, e) }
              }
              const folder = [b.age, b.gender, b.skin_tone].map(slug).join("-")
              const fname = [hair ? baseName(hair) : "no-hair", outfit ? baseName(outfit) : "default-outfit", expression ? baseName(expression) : "no-expression"].map(slug).join("__")
              const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"))
              if (blob) zip.file(`${folder}/${fname}.png`, blob)
              done++
              setLibProgress({ done, total: combos.length, phase: "render" })
              if (done % 4 === 0) await new Promise((r) => setTimeout(r, 0))
            }
          }
        }
      }
      if (libCancel.current) { setLibProgress(null); return }
      setLibProgress({ done: combos.length, total: combos.length, phase: "zip" })
      const content = await zip.generateAsync({ type: "blob", compression: "STORE" })
      const url = URL.createObjectURL(content)
      const a = document.createElement("a")
      a.href = url
      a.download = "life360-character-library.zip"
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      toast.success(`Exported ${combos.length} characters`)
    } catch (e) {
      console.error("Library export failed", e)
      toast.error("Library export failed")
    } finally {
      setLibProgress(null)
    }
  }

  const DEFAULT_OUTFIT_ID = "__default_outfit__"
  const outfitTiles: Asset[] = body
    ? [{ ...body, id: DEFAULT_OUTFIT_ID, category: "outfit" } as Asset, ...availableOutfits]
    : availableOutfits
  const tiles =
    tab === "hair" ? availableHeads
    : tab === "outfit" ? outfitTiles
    : tab === "accessory" ? grouped.accessory
    : grouped.expression
  const activeTileId =
    tab === "hair" ? sel.hair_id
    : tab === "outfit" ? (sel.outfit_id ?? DEFAULT_OUTFIT_ID)
    : tab === "accessory" ? sel.accessory_id
    : sel.expression_id
  const setTileActive = (id: string | null) => {
    if (tab === "hair") setSel({ ...sel, hair_id: id })
    else if (tab === "outfit") setSel({ ...sel, outfit_id: id === DEFAULT_OUTFIT_ID ? null : id })
    else if (tab === "accessory") setSel({ ...sel, accessory_id: id })
    else setSel({ ...sel, expression_id: id })
  }

  return (
    <div
      className="dark relative min-h-svh overflow-y-auto lg:h-svh lg:overflow-hidden bg-background text-foreground"
      style={{
        backgroundColor: "#161616",
        backgroundImage:
          "radial-gradient(color-mix(in oklch, var(--foreground) 5%, transparent) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="mx-auto flex min-h-svh w-full max-w-[1920px] flex-col px-4 py-4 sm:px-6 lg:h-svh lg:px-10 lg:py-6 2xl:px-16">
        <header className="flex shrink-0 items-center justify-between pb-4">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full text-primary">
              <Life360Logo className="h-8 w-8" />
            </span>
            <span className="text-xl font-semibold tracking-tight">Life 360</span>
            <span className="h-6 w-px bg-border" />
            <span className="text-lg text-muted-foreground">Character Builder</span>
          </Link>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link to="/admin"><Lock className="mr-1.5 h-3.5 w-3.5" /> Admin</Link>
          </Button>
        </header>

        <main className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[240px_1fr_320px] xl:grid-cols-[260px_1fr_360px] 2xl:grid-cols-[300px_1fr_420px] 2xl:gap-8">
          <aside className="relative z-10 flex flex-col gap-4 lg:min-h-0">
            <div className="rounded-3xl bg-white/[0.03] p-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <SectionTitle>Gender</SectionTitle>
              <div className="space-y-1">
                {GENDERS.map((g) => (
                  <RadioRow
                    key={g.key}
                    label={g.label}
                    active={sel.gender === g.key}
                    onClick={() => setSel({ ...sel, gender: g.key })}
                    dotColor="var(--foreground)"
                  />
                ))}
              </div>

              <div className="my-6 h-px bg-border/60" />

              <SectionTitle>Age</SectionTitle>
              <div className="space-y-1">
                {AGES.map((a) => (
                  <RadioRow
                    key={a.key}
                    label={a.label}
                    active={sel.age === a.key}
                    onClick={() => setSel({ ...sel, age: a.key })}
                  />
                ))}
              </div>

              <div className="my-6 h-px bg-border/60" />

              <SectionTitle>Skin</SectionTitle>
              <div className="space-y-1">
                {SKIN_TONES.map((t) => (
                  <RadioRow
                    key={t.key}
                    label={t.label}
                    active={sel.skin_tone === t.key}
                    onClick={() => setSel({ ...sel, skin_tone: t.key })}
                    dotColor={t.swatch}
                  />
                ))}
              </div>
            </div>

            <div className="shrink-0 space-y-2">
              <button
                onClick={randomize}
                className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.03] px-5 py-3.5 text-sm font-medium transition hover:bg-white/[0.06]"
              >
                <Shuffle className="h-4 w-4" /> Randomize
              </button>
              <button
                onClick={exportPng}
                disabled={exporting}
                className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.03] px-5 py-3.5 text-sm font-medium transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-white/[0.03]"
              >
                {exporting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Exporting…</>
                ) : (
                  <><Download className="h-4 w-4" /> Export PNG</>
                )}
              </button>
              {isAdmin && (
                <button
                  onClick={() => {
                    const currentAssetId =
                      tab === "hair" ? sel.hair_id
                      : tab === "outfit" ? sel.outfit_id
                      : tab === "accessory" ? sel.accessory_id
                      : sel.expression_id
                    navigate("/admin", {
                      state: {
                        view: "positioning",
                        positioning: {
                          age: sel.age,
                          gender: sel.gender,
                          skin: sel.skin_tone,
                          category: tab,
                          assetId: currentAssetId ?? undefined,
                          headId: sel.hair_id ?? undefined,
                        },
                      },
                    })
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.03] px-5 py-3.5 text-sm font-medium transition hover:bg-white/[0.06]"
                >
                  <Pencil className="h-4 w-4" /> Edit current
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={() => setShowLibConfig(true)}
                  disabled={!!libProgress}
                  className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.03] px-5 py-3.5 text-sm font-medium transition hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-white/[0.03]"
                >
                  {libProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderArchive className="h-4 w-4" />} Download Library
                </button>
              )}
            </div>
          </aside>

          <section className="relative flex items-center justify-center lg:min-h-0">
            <div className="relative z-0 aspect-square w-[78%] max-w-[360px] self-center lg:h-full lg:max-h-full lg:w-auto lg:max-w-none lg:-mx-[130px]">
              {loading ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading</div>
              ) : !body ? (
                <div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
                  No body asset for {sel.age} {sel.gender} ({sel.skin_tone}). Add one from the admin panel.
                </div>
              ) : (
                <>
                  {outfit ? (
                    <BodyLayer src={thumbnailUrl(outfit)} z={layerOrder.find((l) => l.category === "body")?.z_index ?? 1} />
                  ) : (
                    <BodyLayer src={thumbnailUrl(body)} z={layerOrder.find((l) => l.category === "body")?.z_index ?? 1} />
                  )}
                  {hair && <OverlayLayer asset={hair} bodyId={body.id} defaults={defaults} z={layerOrder.find((l) => l.category === "hair")?.z_index ?? 2} />}
                  {accessory && <OverlayLayer asset={accessory} bodyId={body.id} defaults={defaults} z={layerOrder.find((l) => l.category === "accessory")?.z_index ?? 3} />}
                  {expression && (
                    <OverlayLayer
                      asset={expression}
                      bodyId={body.id}
                      defaults={defaults}
                      z={layerOrder.find((l) => l.category === "expression")?.z_index ?? 4}
                      blend={expressionBlend !== "normal" ? (expressionBlend as any) : undefined}
                      transformOverride={resolveExpressionTransform(expression, hair?.id ?? null, body.id, defaults, headExprDefaults)}
                      colors={hair ? headExprColors.find((c) => c.head_id === hair.id && c.expression_id === expression.id)?.colors ?? null : null}
                    />
                  )}
                </>
              )}
            </div>
          </section>

          <aside className="relative z-10 flex flex-col rounded-3xl bg-white/[0.03] p-5 lg:min-h-0">
            <CategoryTabBar
              tabs={[
                { key: "hair" as const, label: "Hair Style" },
                ...(availableOutfits.length > 0 ? [{ key: "outfit" as const, label: "Outfit" }] : []),
                { key: "accessory" as const, label: "Accessories" },
                { key: "expression" as const, label: "Expression" },
              ]}
              activeKey={tab}
              onSelect={(k) => setTab(k)}
            />

            <ScrollArea className="-mx-2 pr-2 lg:flex-1">
              <div className="grid grid-cols-2 gap-3 px-2 pb-2">
                {tiles.length === 0 ? (
                  <p className="col-span-2 py-6 text-center text-sm text-muted-foreground">
                    {tab === "hair" ? "No hair styles for this skin tone." : tab === "outfit" ? "No outfits for this body." : tab === "accessory" ? "No accessories available." : "No expressions available."}
                  </p>
                ) : (
                  tiles.map((a, idx) => {
                    const active = activeTileId === a.id
                    const isDefaultOutfit = tab === "outfit" && a.id === DEFAULT_OUTFIT_ID
                    const label =
                      tab === "hair"
                        ? `Hair Style ${String(idx + 1).padStart(2, "0")}`
                        : tab === "outfit"
                        ? (isDefaultOutfit ? "Default Outfit" : `Outfit ${String(idx).padStart(2, "0")}`)
                        : tab === "accessory"
                        ? `Accessory ${String(idx + 1).padStart(2, "0")}`
                        : `Expression ${String(idx + 1).padStart(2, "0")}`
                    return (
                      <button
                        key={a.id}
                        onClick={() => setTileActive(active && !isDefaultOutfit ? null : a.id)}
                        className={`group relative flex aspect-square flex-col overflow-hidden rounded-2xl border-2 transition ${
                          active
                            ? "border-primary bg-primary/15"
                            : "border-transparent bg-secondary hover:border-border"
                        }`}
                      >
                        {tab === "hair" && body ? (
                          <HairThumb
                            hair={a}
                            body={body}
                            defaults={defaults}
                            layerOrder={layerOrder}
                            active={active}
                          />
                        ) : (
                          <div className="relative flex flex-1 w-full items-center justify-center p-3">
                            <img
                              src={thumbnailUrl(a)}
                              alt={label}
                              loading="lazy"
                              decoding="async"
                              fetchPriority="low"
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                        )}
                        <span
                          className={`absolute bottom-2.5 left-3 text-xs font-medium ${
                            active ? "text-primary" : "text-foreground/90"
                          }`}
                        >
                          {label}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </ScrollArea>
          </aside>
        </main>
      </div>

      {showLibConfig && !libProgress && (
        <LibraryConfigDialog
          bodies={grouped.body}
          hairs={grouped.hair}
          outfits={grouped.outfit}
          expressions={grouped.expression}
          onClose={() => setShowLibConfig(false)}
          onStart={exportLibrary}
        />
      )}

      {libProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-secondary p-6 text-center shadow-xl">
            <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-primary" />
            <h3 className="text-base font-semibold">
              {libProgress.phase === "zip" ? "Packaging ZIP…" : "Generating library…"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {libProgress.phase === "zip"
                ? "Compressing images — the download will start shortly."
                : `${libProgress.done} / ${libProgress.total} images`}
            </p>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150"
                style={{ width: `${Math.round((libProgress.done / Math.max(libProgress.total, 1)) * 100)}%` }}
              />
            </div>
            {libProgress.phase !== "zip" && (
              <button
                onClick={() => { libCancel.current = true }}
                className="mt-4 rounded-full px-4 py-1.5 text-sm text-muted-foreground transition hover:text-foreground"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function LibraryConfigDialog({
  bodies,
  hairs,
  outfits,
  expressions,
  onClose,
  onStart,
}: {
  bodies: Asset[]
  hairs: Asset[]
  outfits: Asset[]
  expressions: Asset[]
  onClose: () => void
  onStart: (cfg: LibConfig) => void
}) {
  const [ages, setAges] = useState<AgeGroup[]>(AGES.map((a) => a.key))
  const [genders, setGenders] = useState<Gender[]>(GENDERS.map((g) => g.key))
  const [skins, setSkins] = useState<SkinTone[]>(SKIN_TONES.map((s) => s.key))
  const [outfitsMode, setOutfitsMode] = useState<"default" | "all">("all")
  const [exprIds, setExprIds] = useState<(string | null)[]>([null, ...expressions.map((e) => e.id)])
  const [size, setSize] = useState(2048)
  const hasOutfits = outfits.length > 0

  function toggle<T>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
  }

  const count = useMemo(() => {
    const bs = bodies.filter((b) => ages.includes(b.age as AgeGroup) && genders.includes(b.gender as Gender) && skins.includes(b.skin_tone as SkinTone))
    let n = 0
    for (const b of bs) {
      const hc = Math.max(hairs.filter((h) => h.age === b.age && h.gender === b.gender && h.skin_tone === b.skin_tone).length, 1)
      const oc = outfitsMode === "default" ? 1 : 1 + outfits.filter((o) => o.parent_body_id === b.id).length
      n += hc * oc * exprIds.length
    }
    return n
  }, [ages, genders, skins, outfitsMode, exprIds, bodies, hairs, outfits])

  const perImgMB = size === 2048 ? 1.0 : size === 1024 ? 0.25 : 0.06
  const estMB = Math.max(1, Math.round(count * perImgMB))
  const canStart = count > 0 && exprIds.length > 0

  const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${active ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[85svh] w-full max-w-md overflow-y-auto rounded-3xl bg-secondary p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold tracking-tight">Download Library</h3>
        <p className="mt-1 text-sm text-muted-foreground">Every hairstyle is always included for the selected characters — pick the rest below.</p>

        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Characters</p>
          <div className="flex flex-wrap gap-1.5">
            {GENDERS.map((g) => <Chip key={g.key} active={genders.includes(g.key)} onClick={() => setGenders(toggle(genders, g.key))}>{g.label}</Chip>)}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {AGES.map((a) => <Chip key={a.key} active={ages.includes(a.key)} onClick={() => setAges(toggle(ages, a.key))}>{a.label}</Chip>)}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SKIN_TONES.map((s) => <Chip key={s.key} active={skins.includes(s.key)} onClick={() => setSkins(toggle(skins, s.key))}>{s.label}</Chip>)}
          </div>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expressions</p>
          <div className="flex flex-wrap gap-1.5">
            <Chip active={exprIds.includes(null)} onClick={() => setExprIds(toggle(exprIds, null))}>No expression</Chip>
            {expressions.map((e, i) => (
              <Chip key={e.id} active={exprIds.includes(e.id)} onClick={() => setExprIds(toggle(exprIds, e.id))}>{`Expression ${String(i + 1).padStart(2, "0")}`}</Chip>
            ))}
          </div>
        </div>

        {hasOutfits && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outfits</p>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={outfitsMode === "default"} onClick={() => setOutfitsMode("default")}>Default only</Chip>
              <Chip active={outfitsMode === "all"} onClick={() => setOutfitsMode("all")}>All variations</Chip>
            </div>
          </div>
        )}

        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resolution</p>
          <div className="flex flex-wrap gap-1.5">
            {[512, 1024, 2048].map((s) => <Chip key={s} active={size === s} onClick={() => setSize(s)}>{s}px</Chip>)}
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-white/[0.03] p-3 text-center text-sm">
          {canStart ? (
            <span><span className="font-semibold text-foreground">{count.toLocaleString()}</span> images · ~{estMB} MB ZIP</span>
          ) : (
            <span className="text-muted-foreground">Nothing selected</span>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-2xl bg-white/[0.03] py-2.5 text-sm font-medium transition hover:bg-white/[0.06]">Cancel</button>
          <button
            disabled={!canStart}
            onClick={() => onStart({ ages, genders, skins, outfitsMode, exprIds, size })}
            className="flex-1 rounded-2xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download
          </button>
        </div>
      </div>
    </div>
  )
}

function HairThumb({
  hair,
  body,
  defaults,
  layerOrder,
  active,
}: {
  hair: Asset
  body: Asset
  defaults: CategoryDefault[]
  layerOrder: LayerOrder[]
  active: boolean
}) {
  const bodyThumb = thumbnailUrl(body)
  const hairThumb = thumbnailUrl(hair)
  const storedHairW = hair.width ?? null
  const storedHairH = hair.height ?? null
  const [bodyLoaded, setBodyLoaded] = useState(false)
  const [hairLoaded, setHairLoaded] = useState(false)
  const [measuredHair, setMeasuredHair] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    setBodyLoaded(false)
    const img = new Image()
    img.decoding = "async"
    img.fetchPriority = "low" // picker tiles yield to the on-canvas character
    img.onload = () => setBodyLoaded(true)
    img.src = bodyThumb
    if (img.complete && img.naturalWidth > 0) setBodyLoaded(true)
  }, [bodyThumb])

  useEffect(() => {
    setHairLoaded(false)
    setMeasuredHair(null)
    const img = new Image()
    img.decoding = "async"
    img.fetchPriority = "low"
    const done = () => {
      // Size from the stored intrinsic dimensions; only measure (the thumbnail
      // we're already displaying) when dims are absent — so we never download the
      // full-resolution image just to read its size.
      if (!(storedHairW && storedHairH)) setMeasuredHair({ w: img.naturalWidth, h: img.naturalHeight })
      setHairLoaded(true)
    }
    img.onload = done
    img.src = hairThumb
    if (img.complete && img.naturalWidth > 0) done()
  }, [hairThumb, storedHairW, storedHairH])

  const hairSize = storedHairW && storedHairH ? { w: storedHairW, h: storedHairH } : measuredHair
  const ready = bodyLoaded && hairLoaded && hairSize
  const t = resolveTransform(hair, body.id, defaults) ?? IDENTITY_TRANSFORM
  const ncx = 0.5 + t.offset_x / CANVAS
  const ncy = 0.5 + t.offset_y / CANVAS
  const S = 4.2
  const tx = (0.5 - ncx) * 100
  const ty = (0.5 - ncy) * 100

  const bodyZ = layerOrder.find((l) => l.category === "body")?.z_index ?? 1
  const hairZ = layerOrder.find((l) => l.category === "hair")?.z_index ?? 2

  const wPct = hairSize ? ((hairSize.w * t.scale) / CANVAS) * 100 : 0
  const hPct = hairSize ? ((hairSize.h * t.scale) / CANVAS) * 100 : 0
  const leftPct = hairSize ? (((CANVAS - hairSize.w * t.scale) / 2 + t.offset_x) / CANVAS) * 100 : 0
  const topPct = hairSize ? (((CANVAS - hairSize.h * t.scale) / 2 + t.offset_y) / CANVAS) * 100 : 0

  return (
    <div className="absolute inset-0 overflow-hidden">
      {!ready && <Skeleton className="absolute inset-0 rounded-none" />}
      <div
        className="absolute inset-0 transition-opacity duration-200"
        style={{
          transform: `scale(${S}) translate(${tx}%, ${ty}%)`,
          transformOrigin: "center",
          willChange: "transform",
          opacity: ready ? 1 : 0,
        }}
      >
        <img
          src={bodyThumb}
          alt=""
          loading="eager"
          decoding="async"
          fetchPriority="low"
          style={{ zIndex: bodyZ }}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
        />
        {hairSize && (
          <img
            src={hairThumb}
            alt=""
            loading="eager"
            decoding="async"
            fetchPriority="low"
            style={{
              zIndex: hairZ,
              position: "absolute",
              left: `${leftPct}%`,
              top: `${topPct}%`,
              width: `${wPct}%`,
              height: `${hPct}%`,
            }}
            className="pointer-events-none"
          />
        )}
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 transition-opacity duration-200"
        style={{
          opacity: ready ? 1 : 0,
          background: active
            ? "linear-gradient(to top, color-mix(in oklch, var(--primary) 55%, transparent) 0%, color-mix(in oklch, var(--primary) 20%, transparent) 40%, transparent 100%)"
            : "linear-gradient(to top, color-mix(in oklch, var(--secondary) 95%, transparent) 0%, color-mix(in oklch, var(--secondary) 55%, transparent) 45%, transparent 100%)",
        }}
      />
    </div>
  )
}

function BodyLayer({ src, z }: { src: string; z: number }) {
  return (
    <img
      src={src}
      alt=""
      loading="eager"
      fetchPriority="high"
      style={{ zIndex: z }}
      className="pointer-events-none absolute inset-0 h-full w-full object-contain"
    />
  )
}

function OverlayLayer({
  asset,
  bodyId,
  defaults,
  z,
  blend,
  transformOverride,
  colors,
}: {
  asset: Asset
  bodyId: string | null
  defaults: CategoryDefault[]
  z: number
  blend?: string
  transformOverride?: Transform
  colors?: Record<string, string> | null
}) {
  const rawUrl = publicUrl(asset.storage_path, asset.storage_provider)
  const isSvg = isSvgPath(asset.storage_path)
  const resolvedSrc = useAssetSrc(isSvg ? rawUrl : null, colors ?? null)
  const targetSrc = isSvg ? (resolvedSrc ?? rawUrl) : thumbnailUrl(asset)
  // Commit the new image and its dimensions TOGETHER, only once the new image has
  // decoded. This keeps the previous layer painted at its own (correct) size until
  // the replacement is ready — instead of briefly stretching the still-loading new
  // src to the next layer's dimensions, which looked like a momentarily deformed head.
  const [shown, setShown] = useState<{ src: string; size: { w: number; h: number } } | null>(null)
  useEffect(() => {
    if (isSvg) { setShown({ src: targetSrc, size: { w: CANVAS, h: CANVAS } }); return }
    let cancelled = false
    const commit = (w: number, h: number) => { if (!cancelled) setShown({ src: targetSrc, size: { w, h } }) }
    const img = new Image()
    img.decoding = "async"
    img.onload = () => commit(asset.width || img.naturalWidth, asset.height || img.naturalHeight)
    img.src = targetSrc
    if (img.complete && img.naturalWidth > 0) commit(asset.width || img.naturalWidth, asset.height || img.naturalHeight)
    return () => { cancelled = true }
  }, [targetSrc, isSvg, asset.width, asset.height])
  if (!shown) return null
  const size = shown.size
  const t: Transform = transformOverride ?? resolveTransform(asset, bodyId, defaults)
  const wPct = ((size.w * t.scale) / CANVAS) * 100
  const hPct = ((size.h * t.scale) / CANVAS) * 100
  const leftPct = (((CANVAS - size.w * t.scale) / 2 + t.offset_x) / CANVAS) * 100
  const topPct = (((CANVAS - size.h * t.scale) / 2 + t.offset_y) / CANVAS) * 100
  return (
    <img
      src={shown.src}
      alt=""
      loading="eager"
      fetchPriority="high"
      style={{
        zIndex: z,
        mixBlendMode: blend as any,
        position: "absolute",
        left: `${leftPct}%`,
        top: `${topPct}%`,
        width: `${wPct}%`,
        height: `${hPct}%`,
      }}
      className="pointer-events-none"
    />
  )
}

function CategoryTabBar<K extends string>({
  tabs,
  activeKey,
  onSelect,
}: {
  tabs: { key: K; label: string }[]
  activeKey: K
  onSelect: (key: K) => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [edges, setEdges] = useState({ left: false, right: false })

  const updateEdges = () => {
    const el = scrollRef.current
    if (!el) return
    const left = el.scrollLeft > 2
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setEdges({ left, right })
  }

  useLayoutEffect(() => {
    updateEdges()
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(updateEdges)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tabs.length])

  useLayoutEffect(() => {
    const btn = itemRefs.current[activeKey]
    if (btn) btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" })
  }, [activeKey])

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.6), behavior: "smooth" })
  }

  return (
    <div className="relative mb-5">
      <div
        ref={scrollRef}
        onScroll={updateEdges}
        className="flex items-center gap-2 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          maskImage: `linear-gradient(to right, ${edges.left ? "transparent" : "black"} 0, black 24px, black calc(100% - 24px), ${edges.right ? "transparent" : "black"} 100%)`,
          WebkitMaskImage: `linear-gradient(to right, ${edges.left ? "transparent" : "black"} 0, black 24px, black calc(100% - 24px), ${edges.right ? "transparent" : "black"} 100%)`,
        }}
      >
        {tabs.map((t) => {
          const active = activeKey === t.key
          return (
            <button
              key={t.key}
              ref={(el) => {
                itemRefs.current[t.key] = el
              }}
              onClick={() => onSelect(t.key)}
              className={`shrink-0 snap-start rounded-full border px-4 py-1.5 text-sm whitespace-nowrap transition ${
                active
                  ? "border-border bg-secondary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {edges.left && (
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          aria-label="Scroll left"
          className="absolute left-0 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground/80 backdrop-blur-sm shadow-sm ring-1 ring-border transition hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}
      {edges.right && (
        <button
          type="button"
          onClick={() => scrollBy(1)}
          aria-label="Scroll right"
          className="absolute right-0 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground/80 backdrop-blur-sm shadow-sm ring-1 ring-border transition hover:text-foreground"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
