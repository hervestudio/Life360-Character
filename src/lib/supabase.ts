import { createClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
})

export type AgeGroup = "kid" | "teen" | "adult" | "senior"
export type Gender = "male" | "female"
export type SkinTone = "light" | "medium" | "dark"
export type AssetCategory = "body" | "skin" | "hair" | "facial_hair" | "accessory" | "expression" | "outfit"

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity"

export const BLEND_MODES: BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
]

export const SKIN_TONES: { key: SkinTone; label: string; swatch: string }[] = [
  { key: "light", label: "Light", swatch: "#f1c9a5" },
  { key: "medium", label: "Medium", swatch: "#c68863" },
  { key: "dark", label: "Dark", swatch: "#6b3f2a" },
]

export type StorageProvider = "supabase" | "r2"

export interface Asset {
  id: string
  category: AssetCategory
  label: string
  age: AgeGroup | null
  gender: Gender | null
  skin_tone: SkinTone | null
  storage_path: string
  storage_provider: StorageProvider
  thumbnail_path: string | null
  swatch_color: string | null
  display_order: number
  is_active: boolean
  offset_x: number | null
  offset_y: number | null
  scale: number | null
  parent_body_id: string | null
  created_at: string
  updated_at: string
}

export interface CategoryDefault {
  body_id: string
  category: Exclude<AssetCategory, "body">
  offset_x: number
  offset_y: number
  scale: number
}

export interface Transform {
  offset_x: number
  offset_y: number
  scale: number
}

export const IDENTITY_TRANSFORM: Transform = { offset_x: 0, offset_y: 0, scale: 1 }

export function resolveTransform(
  asset: Asset | null,
  bodyId: string | null,
  defaults: CategoryDefault[],
): Transform {
  if (!asset || asset.category === "body") return IDENTITY_TRANSFORM
  const def = defaults.find((d) => d.body_id === bodyId && d.category === asset.category)
  return {
    offset_x: asset.offset_x ?? def?.offset_x ?? 0,
    offset_y: asset.offset_y ?? def?.offset_y ?? 0,
    scale: asset.scale ?? def?.scale ?? 1,
  }
}

const BUCKET = "character-assets"

const USE_R2 = import.meta.env.VITE_USE_R2 === "true"
const R2_PUBLIC_BASE_URL = (import.meta.env.VITE_R2_PUBLIC_BASE_URL as string) || ""

export function publicUrl(path: string, provider?: StorageProvider): string {
  const resolvedProvider = provider ?? "supabase"
  if (resolvedProvider === "r2" && R2_PUBLIC_BASE_URL) {
    const base = R2_PUBLIC_BASE_URL.replace(/\/$/, "")
    return `${base}/${path}`
  }
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

export function thumbnailUrl(asset: Asset): string {
  if (asset.thumbnail_path && R2_PUBLIC_BASE_URL) {
    const base = R2_PUBLIC_BASE_URL.replace(/\/$/, "")
    return `${base}/${asset.thumbnail_path}`
  }
  return publicUrl(asset.storage_path, asset.storage_provider)
}

function r2FunctionUrl(action: string): string {
  return `${url}/functions/v1/r2-storage?action=${action}`
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? anonKey
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Apikey: anonKey,
  }
}

export async function fetchAssets(opts: { onlyActive?: boolean } = {}): Promise<Asset[]> {
  let q = supabase.from("assets").select("*").not("category", "in", "(facial_hair,skin)").order("display_order").order("created_at")
  if (opts.onlyActive) q = q.eq("is_active", true)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Asset[]
}

export interface UploadInput {
  file: File
  category: AssetCategory
  label: string
  age?: AgeGroup | null
  gender?: Gender | null
  skin_tone?: SkinTone | null
  parent_body_id?: string | null
}

export async function uploadAsset(input: UploadInput): Promise<Asset> {
  const ext = input.file.name.split(".").pop() || "png"
  const slug = input.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "asset"
  const ts = Date.now()
  const folder = input.category
  const storagePath = `${folder}/${slug}-${ts}.${ext}`

  if (USE_R2) {
    const headers = await getAuthHeaders()
    const formData = new FormData()
    formData.append("file", input.file)
    formData.append("key", storagePath)
    formData.append("contentType", input.file.type || "image/png")
    const uploadRes = await fetch(r2FunctionUrl("upload"), {
      method: "POST",
      headers: { Authorization: headers.Authorization, Apikey: headers.Apikey },
      body: formData,
    })
    if (!uploadRes.ok) {
      const err = await uploadRes.text()
      throw new Error(`R2 upload failed: ${err}`)
    }
  } else {
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, input.file, {
      contentType: input.file.type || "image/png",
      upsert: false,
    })
    if (upErr) throw upErr
  }

  const needsSkin = input.category === "body" || input.category === "hair"
  const row = {
    category: input.category,
    label: input.label,
    age: (input.category === "body" || input.category === "hair") ? input.age ?? null : null,
    gender: (input.category === "body" || input.category === "hair") ? input.gender ?? null : null,
    skin_tone: needsSkin ? input.skin_tone ?? null : null,
    parent_body_id: input.category === "outfit" ? input.parent_body_id ?? null : null,
    storage_path: storagePath,
    storage_provider: USE_R2 ? "r2" as const : "supabase" as const,
  }
  const { data, error } = await supabase.from("assets").insert(row).select("*").maybeSingle()
  if (error || !data) {
    if (USE_R2) {
      const headers = await getAuthHeaders()
      await fetch(r2FunctionUrl("delete"), {
        method: "POST",
        headers,
        body: JSON.stringify({ keys: [storagePath] }),
      })
    } else {
      await supabase.storage.from(BUCKET).remove([storagePath])
    }
    throw error ?? new Error("Insert failed")
  }
  return data as Asset
}

export async function deleteAsset(asset: Asset): Promise<void> {
  const { error } = await supabase.from("assets").delete().eq("id", asset.id)
  if (error) throw error
  if (asset.storage_provider === "r2") {
    const headers = await getAuthHeaders()
    await fetch(r2FunctionUrl("delete"), {
      method: "POST",
      headers,
      body: JSON.stringify({ keys: [asset.storage_path] }),
    })
  } else {
    await supabase.storage.from(BUCKET).remove([asset.storage_path])
  }
}

export interface AssetParamsPatch {
  label?: string
  age?: AgeGroup | null
  gender?: Gender | null
  skin_tone?: SkinTone | null
  parent_body_id?: string | null
}

export async function updateAssetParams(id: string, patch: AssetParamsPatch): Promise<void> {
  const { error } = await supabase
    .from("assets")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}

export async function replaceAssetFile(asset: Asset, file: File): Promise<void> {
  const ext = file.name.split(".").pop() || "png"
  const slug = asset.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "asset"
  const ts = Date.now()
  const folder = asset.category
  const storagePath = `${folder}/${slug}-${ts}.${ext}`
  const newProvider: StorageProvider = USE_R2 ? "r2" : "supabase"

  if (USE_R2) {
    const headers = await getAuthHeaders()
    const formData = new FormData()
    formData.append("file", file)
    formData.append("key", storagePath)
    formData.append("contentType", file.type || "image/png")
    const uploadRes = await fetch(r2FunctionUrl("upload"), {
      method: "POST",
      headers: { Authorization: headers.Authorization, Apikey: headers.Apikey },
      body: formData,
    })
    if (!uploadRes.ok) {
      const err = await uploadRes.text()
      throw new Error(`R2 upload failed: ${err}`)
    }
  } else {
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: file.type || "image/png",
      upsert: false,
    })
    if (upErr) throw upErr
  }

  const { error } = await supabase
    .from("assets")
    .update({ storage_path: storagePath, storage_provider: newProvider, updated_at: new Date().toISOString() })
    .eq("id", asset.id)
  if (error) {
    if (USE_R2) {
      const headers = await getAuthHeaders()
      await fetch(r2FunctionUrl("delete"), {
        method: "POST",
        headers,
        body: JSON.stringify({ keys: [storagePath] }),
      })
    } else {
      await supabase.storage.from(BUCKET).remove([storagePath])
    }
    throw error
  }

  if (asset.storage_provider === "r2") {
    const headers = await getAuthHeaders()
    await fetch(r2FunctionUrl("delete"), {
      method: "POST",
      headers,
      body: JSON.stringify({ keys: [asset.storage_path] }),
    })
  } else {
    await supabase.storage.from(BUCKET).remove([asset.storage_path])
  }
}

export async function setAssetActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from("assets").update({ is_active: active, updated_at: new Date().toISOString() }).eq("id", id)
  if (error) throw error
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  if (!data.session) {
    const { error: siErr } = await supabase.auth.signInWithPassword({ email, password })
    if (siErr) throw siErr
  }
  return data
}

export async function claimAdminIfFirst(): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_admin")
  if (error) throw error
  return data === true
}

export async function signOut() {
  await supabase.auth.signOut()
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return false
  const { data } = await supabase.from("admins").select("user_id").eq("user_id", auth.user.id).maybeSingle()
  return !!data
}

export interface CharacterConfig {
  age: AgeGroup
  gender: Gender
  skin_tone: SkinTone
  body_id: string | null
  hair_id: string | null
  accessory_id: string | null
}

export async function fetchCategoryDefaults(): Promise<CategoryDefault[]> {
  const { data, error } = await supabase.from("category_defaults").select("*")
  if (error) throw error
  return (data ?? []) as CategoryDefault[]
}

export async function upsertCategoryDefault(row: CategoryDefault): Promise<void> {
  const { error } = await supabase
    .from("category_defaults")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "body_id,category" })
  if (error) throw error
}

export interface HeadExpressionDefault {
  head_id: string
  offset_x: number
  offset_y: number
  scale: number
}

export async function fetchHeadExpressionDefaults(): Promise<HeadExpressionDefault[]> {
  const { data, error } = await supabase.from("head_expression_defaults").select("head_id, offset_x, offset_y, scale")
  if (error) throw error
  return (data ?? []) as HeadExpressionDefault[]
}

export async function upsertHeadExpressionDefault(row: HeadExpressionDefault): Promise<void> {
  const { error } = await supabase
    .from("head_expression_defaults")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "head_id" })
  if (error) throw error
}

export async function deleteHeadExpressionDefault(head_id: string): Promise<void> {
  const { error } = await supabase.from("head_expression_defaults").delete().eq("head_id", head_id)
  if (error) throw error
}

export function resolveExpressionTransform(
  expression: Asset | null,
  headId: string | null,
  bodyId: string | null,
  categoryDefaults: CategoryDefault[],
  headExprDefaults: HeadExpressionDefault[],
): Transform {
  if (!expression) return IDENTITY_TRANSFORM
  const base = resolveTransform(expression, bodyId, categoryDefaults)
  const headOv = headExprDefaults.find((h) => h.head_id === headId)
  if (!headOv) return base
  return {
    offset_x: base.offset_x + headOv.offset_x,
    offset_y: base.offset_y + headOv.offset_y,
    scale: base.scale * headOv.scale,
  }
}

export async function updateAssetTransform(
  id: string,
  patch: { offset_x?: number | null; offset_y?: number | null; scale?: number | null },
): Promise<void> {
  const { error } = await supabase
    .from("assets")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) throw error
}

export type LayerCategory = Exclude<AssetCategory, "facial_hair" | "skin" | "outfit">

export interface LayerOrder {
  category: LayerCategory
  z_index: number
  blend_mode?: BlendMode | null
}

export const DEFAULT_LAYER_ORDER: LayerOrder[] = [
  { category: "body", z_index: 1, blend_mode: "normal" },
  { category: "hair", z_index: 2, blend_mode: "normal" },
  { category: "accessory", z_index: 3, blend_mode: "normal" },
  { category: "expression", z_index: 4, blend_mode: "normal" },
]

export interface BodyDefaultOutfit {
  body_id: string
  outfit_id: string
}

export async function fetchBodyDefaultOutfits(): Promise<BodyDefaultOutfit[]> {
  const { data, error } = await supabase.from("body_default_outfits").select("body_id, outfit_id")
  if (error) throw error
  return (data ?? []) as BodyDefaultOutfit[]
}

export async function setBodyDefaultOutfit(body_id: string, outfit_id: string): Promise<void> {
  const { error } = await supabase
    .from("body_default_outfits")
    .upsert({ body_id, outfit_id, updated_at: new Date().toISOString() }, { onConflict: "body_id" })
  if (error) throw error
}

export async function clearBodyDefaultOutfit(body_id: string): Promise<void> {
  const { error } = await supabase.from("body_default_outfits").delete().eq("body_id", body_id)
  if (error) throw error
}

export async function fetchLayerOrder(): Promise<LayerOrder[]> {
  const { data, error } = await supabase.from("layer_order").select("category, z_index, blend_mode").not("category", "in", "(facial_hair,skin)")
  if (error) throw error
  const rows = (data ?? []) as LayerOrder[]
  const map = new Map(rows.map((r) => [r.category, r]))
  return DEFAULT_LAYER_ORDER.map((d) => map.get(d.category) ?? d)
}

export async function saveLayerOrder(rows: LayerOrder[]): Promise<void> {
  const payload = rows.map((r) => ({
    category: r.category,
    z_index: r.z_index,
    blend_mode: r.blend_mode ?? "normal",
    updated_at: new Date().toISOString(),
  }))
  const { error } = await supabase.from("layer_order").upsert(payload, { onConflict: "category" })
  if (error) throw error
}

export interface HeadExpressionColor {
  head_id: string
  expression_id: string
  colors: Record<string, string>
  labels?: Record<string, string>
}

export async function fetchHeadExpressionColors(): Promise<HeadExpressionColor[]> {
  const { data, error } = await supabase.from("head_expression_colors").select("head_id, expression_id, colors, labels")
  if (error) throw error
  return (data ?? []).map((r: any) => ({
    head_id: r.head_id,
    expression_id: r.expression_id,
    colors: r.colors ?? {},
    labels: r.labels ?? {},
  })) as HeadExpressionColor[]
}

export async function upsertHeadExpressionColors(row: HeadExpressionColor): Promise<void> {
  const { error } = await supabase
    .from("head_expression_colors")
    .upsert(
      {
        head_id: row.head_id,
        expression_id: row.expression_id,
        colors: row.colors ?? {},
        labels: row.labels ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "head_id,expression_id" },
    )
  if (error) throw error
}

export async function deleteHeadExpressionColors(head_id: string, expression_id: string): Promise<void> {
  const { error } = await supabase
    .from("head_expression_colors")
    .delete()
    .eq("head_id", head_id)
    .eq("expression_id", expression_id)
  if (error) throw error
}

export async function saveCharacter(name: string, config: CharacterConfig) {
  const { data: auth } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from("characters")
    .insert({ name, config, owner_id: auth.user?.id ?? null })
    .select("*")
    .maybeSingle()
  if (error) throw error
  return data
}

export interface MigrateResult {
  message: string
  total: number
  migrated: number
  errors: number
  dry_run: boolean
  results: { id: string; key: string; status: "migrated" | "skipped" | "error"; error?: string }[]
}

export async function migrateToR2(opts: { dry_run?: boolean; batch_size?: number } = {}): Promise<MigrateResult> {
  const headers = await getAuthHeaders()
  const res = await fetch(`${url}/functions/v1/r2-migrate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ dry_run: opts.dry_run ?? false, batch_size: opts.batch_size ?? 50 }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Migration request failed (${res.status})`)
  }
  return res.json()
}

export async function countSupabaseAssets(): Promise<number> {
  const { count, error } = await supabase
    .from("assets")
    .select("*", { count: "exact", head: true })
    .eq("storage_provider", "supabase")
  if (error) throw error
  return count ?? 0
}

export interface ThumbnailResult {
  message: string
  total: number
  generated: number
  errors: number
  dry_run: boolean
  results: { id: string; key: string; thumbnail_key: string; status: "generated" | "skipped" | "error"; error?: string }[]
}

const thumbnailWorkerUrl = import.meta.env.VITE_THUMBNAIL_WORKER_URL as string | undefined

export async function generateThumbnails(opts: {
  dry_run?: boolean
  batch_size?: number
  width?: number
  quality?: number
} = {}): Promise<ThumbnailResult> {
  const headers = await getAuthHeaders()
  const payload = JSON.stringify({
    dry_run: opts.dry_run ?? false,
    batch_size: opts.batch_size ?? 20,
    width: opts.width ?? 512,
    quality: opts.quality ?? 80,
  })

  if (thumbnailWorkerUrl) {
    try {
      const res = await fetch(thumbnailWorkerUrl, {
        method: "POST",
        headers,
        body: payload,
      })
      if (res.ok) return res.json()
      const text = await res.text()
      throw new Error(text || `Worker failed (${res.status})`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ""
      if (!msg.includes("Failed to fetch") && !msg.includes("NetworkError")) {
        throw err
      }
    }
  }

  const res = await fetch(`${url}/functions/v1/r2-thumbnails`, {
    method: "POST",
    headers,
    body: payload,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Thumbnail generation failed (${res.status})`)
  }
  return res.json()
}

export async function countMissingThumbnails(): Promise<number> {
  const { count, error } = await supabase
    .from("assets")
    .select("*", { count: "exact", head: true })
    .is("thumbnail_path", null)
    .eq("storage_provider", "r2")
    .not("storage_path", "ilike", "%.svg")
  if (error) throw error
  return count ?? 0
}
