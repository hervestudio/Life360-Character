import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Download, Lock, Pencil, Shuffle } from "lucide-react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import type { AgeGroup, Asset, BodyDefaultOutfit, CategoryDefault, Gender, HeadExpressionColor, HeadExpressionDefault, LayerOrder, SkinTone, Transform } from "@/lib/supabase"
import { DEFAULT_LAYER_ORDER, IDENTITY_TRANSFORM, SKIN_TONES, fetchAssets, fetchBodyDefaultOutfits, fetchCategoryDefaults, fetchHeadExpressionColors, fetchHeadExpressionDefaults, fetchLayerOrder, isCurrentUserAdmin, publicUrl, r2ProxyUrl, thumbnailUrl, resolveExpressionTransform, resolveTransform, supabase } from "@/lib/supabase"
import { applyColors, fetchSvgText, getSvgViewBox, isSvgPath, setSvgDimensions, svgToDataUrl, useAssetSrc } from "@/lib/svg"

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
        rows.forEach((r) => {
          const img = new Image()
          img.src = thumbnailUrl(r)
        })
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
            setSel({
              age: seed.age,
              gender: seed.gender,
              skin_tone: seed.skin_tone,
              hair_id: heads.length ? heads[Math.floor(Math.random() * heads.length)].id : null,
              accessory_id: accs.length ? accs[Math.floor(Math.random() * accs.length)].id : null,
              expression_id: null,
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
      expression_id: null,
      outfit_id: outfitPick,
    })
  }

  async function exportPng() {
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
            const vb = getSvgViewBox(text)
            if (vb) {
              const ratio = vb.w / vb.h
              const w = ratio >= 1 ? size : size * ratio
              const h = ratio >= 1 ? size / ratio : size
              text = setSvgDimensions(text, w, h)
            } else {
              text = setSvgDimensions(text, size, size)
            }
            layerSrc = svgToDataUrl(text)
          } catch {}
        }
        const img = l.asset.id === body?.id && bodyImg ? bodyImg : await loadWithFallback(l.asset).catch(() => load(layerSrc))
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
          const h = isSvg ? baseH * t.scale : baseH * t.scale * scaleFactor
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
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    }, "image/png")
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
      className="dark relative h-svh overflow-hidden bg-background text-foreground"
      style={{
        backgroundColor: "#161616",
        backgroundImage:
          "radial-gradient(color-mix(in oklch, var(--foreground) 5%, transparent) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="mx-auto flex h-svh w-full max-w-[1920px] flex-col px-4 py-4 sm:px-6 lg:px-10 lg:py-6 2xl:px-16">
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

        <main className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[240px_1fr_320px] xl:grid-cols-[260px_1fr_360px] 2xl:grid-cols-[300px_1fr_420px] 2xl:gap-8">
          <aside className="relative z-10 flex min-h-0 flex-col gap-4">
            <div className="min-h-0 flex-1 overflow-y-auto rounded-3xl bg-white/[0.03] p-6">
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
                className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.03] px-5 py-3.5 text-sm font-medium transition hover:bg-white/[0.06]"
              >
                <Download className="h-4 w-4" /> Export PNG
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
            </div>
          </aside>

          <section className="relative flex min-h-0 items-center justify-center">
            <div className="relative z-0 aspect-square h-full max-h-full -mx-[130px] self-center">
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

          <aside className="relative z-10 flex min-h-0 flex-col rounded-3xl bg-white/[0.03] p-5">
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

            <ScrollArea className="-mx-2 flex-1 pr-2">
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

            <div className="mt-4 flex items-center justify-center gap-1.5">
              {(availableOutfits.length > 0
                ? (["hair", "outfit", "accessory", "expression"] as const)
                : (["hair", "accessory", "expression"] as const)
              ).map((k) => (
                <span
                  key={k}
                  className={`h-1.5 w-1.5 rounded-full ${tab === k ? "bg-primary" : "bg-muted-foreground/30"}`}
                />
              ))}
            </div>
          </aside>
        </main>
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
  const hairFullSrc = publicUrl(hair.storage_path, hair.storage_provider)
  const [bodyLoaded, setBodyLoaded] = useState(false)
  const [hairLoaded, setHairLoaded] = useState(false)
  const [hairSize, setHairSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    setBodyLoaded(false)
    const img = new Image()
    img.decoding = "async"
    img.onload = () => setBodyLoaded(true)
    img.src = bodyThumb
    if (img.complete && img.naturalWidth > 0) setBodyLoaded(true)
  }, [bodyThumb])

  useEffect(() => {
    setHairLoaded(false)
    setHairSize(null)
    const img = new Image()
    img.decoding = "async"
    img.onload = () => {
      setHairSize({ w: img.naturalWidth, h: img.naturalHeight })
      setHairLoaded(true)
    }
    img.src = hairFullSrc
    if (img.complete && img.naturalWidth > 0) {
      setHairSize({ w: img.naturalWidth, h: img.naturalHeight })
      setHairLoaded(true)
    }
  }, [hairFullSrc])

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
          style={{ zIndex: bodyZ }}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
        />
        {hairSize && (
          <img
            src={hairThumb}
            alt=""
            loading="eager"
            decoding="async"
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
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const rawUrl = publicUrl(asset.storage_path, asset.storage_provider)
  const isSvg = isSvgPath(asset.storage_path)
  const resolvedSrc = useAssetSrc(isSvg ? rawUrl : null, colors ?? null)
  const displaySrc = isSvg ? (resolvedSrc ?? rawUrl) : thumbnailUrl(asset)
  useEffect(() => {
    if (isSvg) { setSize({ w: CANVAS, h: CANVAS }); return }
    const img = new Image()
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = rawUrl
  }, [rawUrl, isSvg])
  if (!size) return null
  const t: Transform = transformOverride ?? resolveTransform(asset, bodyId, defaults)
  const wPct = ((size.w * t.scale) / CANVAS) * 100
  const hPct = ((size.h * t.scale) / CANVAS) * 100
  const leftPct = (((CANVAS - size.w * t.scale) / 2 + t.offset_x) / CANVAS) * 100
  const topPct = (((CANVAS - size.h * t.scale) / 2 + t.offset_y) / CANVAS) * 100
  return (
    <img
      src={displaySrc}
      alt=""
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
