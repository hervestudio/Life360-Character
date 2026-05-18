import * as React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronLeft, ChevronRight, Layers, LogOut, Move, Pencil, Plus, Power, RotateCcw, Trash2, Upload as UploadIcon, X } from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { toast, Toaster } from "sonner"
import type { Asset, AssetCategory, AgeGroup, BlendMode, BodyDefaultOutfit, CategoryDefault, Gender, HeadExpressionColor, HeadExpressionDefault, LayerOrder, SkinTone, Transform } from "@/lib/supabase"
import {
  BLEND_MODES,
  DEFAULT_LAYER_ORDER,
  SKIN_TONES,
  clearBodyDefaultOutfit,
  deleteHeadExpressionColors,
  deleteHeadExpressionDefault,
  fetchBodyDefaultOutfits,
  fetchHeadExpressionColors,
  fetchHeadExpressionDefaults,
  setBodyDefaultOutfit,
  upsertHeadExpressionColors,
  upsertHeadExpressionDefault,
  claimAdminIfFirst,
  deleteAsset,
  fetchAssets,
  fetchCategoryDefaults,
  fetchLayerOrder,
  isCurrentUserAdmin,
  publicUrl,
  resolveTransform,
  saveLayerOrder,
  setAssetActive,
  signIn,
  signOut,
  signUp,
  supabase,
  updateAssetTransform,
  updateAssetParams,
  uploadAsset,
  replaceAssetFile,
} from "@/lib/supabase"
import { fetchSvgText, isSvgPath, parseSvg, useAssetSrc } from "@/lib/svg"
import { Star } from "lucide-react"

class AdminErrorBoundary extends React.Component<
  { children: React.ReactNode; viewName: string },
  { error: Error | null }
> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[AdminErrorBoundary]", this.props.viewName, error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <main className="mx-auto max-w-[800px] px-8 py-10">
          <h2 className="font-serif text-2xl italic mb-4">Something broke in {this.props.viewName}</h2>
          <pre className="whitespace-pre-wrap break-words border border-destructive/50 bg-destructive/10 p-4 text-xs font-mono text-destructive">
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <p className="mt-4 text-xs text-muted-foreground">
            Reload the page after fixing. This error has also been logged to the browser console.
          </p>
        </main>
      )
    }
    return this.props.children
  }
}

const CANVAS = 1000

const CATEGORIES: { key: AssetCategory | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "body", label: "Body" },
  { key: "hair", label: "Head" },
  { key: "outfit", label: "Outfit" },
  { key: "accessory", label: "Accessory" },
  { key: "expression", label: "Expression" },
]

const AGES: AgeGroup[] = ["kid", "teen", "adult", "senior"]
const GENDERS: Gender[] = ["male", "female"]

function Checker({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative aspect-square w-full overflow-hidden rounded-sm border border-border"
      style={{
        backgroundImage:
          "linear-gradient(45deg, var(--muted) 25%, transparent 25%), linear-gradient(-45deg, var(--muted) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--muted) 75%), linear-gradient(-45deg, transparent 75%, var(--muted) 75%)",
        backgroundSize: "16px 16px",
        backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
      }}
    >
      {children}
    </div>
  )
}

function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === "signup") {
        await signUp(email, password)
        const claimed = await claimAdminIfFirst()
        const admin = claimed || (await isCurrentUserAdmin())
        if (!admin) {
          await signOut()
          setError("Account created. An existing admin must grant you access before you can sign in.")
          setMode("signin")
          return
        }
        onSignedIn()
        return
      }
      await signIn(email, password)
      const admin = await isCurrentUserAdmin()
      if (!admin) {
        await signOut()
        setError("This account is not authorised for the admin panel.")
        return
      }
      onSignedIn()
    } catch (err: any) {
      setError(err.message ?? "Something went wrong.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-8 border border-border bg-card p-10"
      >
        <div className="space-y-2 text-center">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Character Builder</p>
          <h1 className="font-serif text-3xl font-light italic">
            {mode === "signin" ? "Admin sign in" : "Create account"}
          </h1>
        </div>

        <div className="grid grid-cols-2 border border-border">
          <button
            type="button"
            onClick={() => { setMode("signin"); setError(null); setInfo(null) }}
            className={`py-2 text-[10px] uppercase tracking-[0.2em] transition ${mode === "signin" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => { setMode("signup"); setError(null); setInfo(null) }}
            className={`py-2 text-[10px] uppercase tracking-[0.2em] transition ${mode === "signup" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
          >
            Create account
          </button>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Password</Label>
            <Input id="password" type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {info && <p className="text-xs text-muted-foreground">{info}</p>}

        <Button type="submit" className="w-full rounded-none tracking-[0.2em] uppercase text-xs" disabled={loading}>
          {loading ? (mode === "signin" ? "Signing in..." : "Creating...") : mode === "signin" ? "Enter" : "Create account"}
        </Button>

        {mode === "signup" && (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            The very first account becomes the admin automatically. Later accounts must be granted admin rights by an existing admin.
          </p>
        )}
      </form>
    </div>
  )
}

function UploadDialog({
  open,
  onOpenChange,
  onUploaded,
  bodies,
  defaultBodyId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onUploaded: () => void
  bodies: Asset[]
  defaultBodyId?: string | null
}) {
  const [category, setCategory] = useState<AssetCategory>("body")
  const [label, setLabel] = useState("")
  const [age, setAge] = useState<AgeGroup>("adult")
  const [gender, setGender] = useState<Gender>("male")
  const [skinTone, setSkinTone] = useState<SkinTone>("light")
  const [parentBodyId, setParentBodyId] = useState<string>("")
  const [files, setFiles] = useState<File[]>([])
  const [progress, setProgress] = useState(0)
  const [busy, setBusy] = useState(false)
  const [previews, setPreviews] = useState<string[]>([])

  useEffect(() => {
    if (category === "outfit" && !parentBodyId) {
      const pick = defaultBodyId && bodies.find((b) => b.id === defaultBodyId) ? defaultBodyId : bodies[0]?.id ?? ""
      setParentBodyId(pick)
    }
  }, [category, bodies, defaultBodyId, parentBodyId])

  useEffect(() => {
    if (!files.length) { setPreviews([]); return }
    const urls = files.map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)) }
  }, [files])

  function reset() {
    setLabel("")
    setFiles([])
    setProgress(0)
    setBusy(false)
  }

  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const parentBody = bodies.find((b) => b.id === parentBodyId) ?? null
  const autoBaseLabel = useMemo(() => {
    const catName = category === "hair" ? "Head" : cap(category)
    if (category === "body" || category === "hair") {
      return `${catName} ${cap(age)} ${cap(gender)} ${cap(skinTone)}`
    }
    if (category === "outfit") {
      return parentBody ? `Outfit for ${parentBody.label}` : "Outfit"
    }
    return catName
  }, [category, age, gender, skinTone, parentBody])
  const baseLabel = label.trim() || autoBaseLabel

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!files.length) {
      toast.error("Add at least one PNG.")
      return
    }
    if (category === "outfit" && !parentBodyId) {
      toast.error("Pick the body this outfit belongs to.")
      return
    }
    setBusy(true)
    setProgress(0)
    try {
      for (let i = 0; i < files.length; i++) {
        const suffix = files.length > 1 ? ` ${String(i + 1).padStart(2, "0")}` : ""
        await uploadAsset({
          file: files[i],
          category,
          label: `${baseLabel}${suffix}`,
          age: category === "body" || category === "hair" ? age : null,
          gender: category === "body" || category === "hair" ? gender : null,
          skin_tone: category === "body" || category === "hair" ? skinTone : null,
          parent_body_id: category === "outfit" ? parentBodyId : null,
        })
        setProgress(Math.round(((i + 1) / files.length) * 100))
      }
      toast.success(`Uploaded ${files.length} asset${files.length > 1 ? "s" : ""}.`)
      onUploaded()
      onOpenChange(false)
      reset()
    } catch (err: any) {
      toast.error(err.message ?? "Upload failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v) }}>
      <DialogContent className="max-w-lg rounded-none">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl font-light italic">New asset</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as AssetCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="body">Body</SelectItem>
                <SelectItem value="hair">Head</SelectItem>
                <SelectItem value="outfit">Outfit</SelectItem>
                <SelectItem value="accessory">Accessory</SelectItem>
                <SelectItem value="expression">Expression</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {category === "outfit" && (
            <div className="space-y-2">
              <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Body</Label>
              <Select value={parentBodyId} onValueChange={setParentBodyId}>
                <SelectTrigger><SelectValue placeholder="Choose a body" /></SelectTrigger>
                <SelectContent>
                  {bodies.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                This outfit will only appear when the selected body is active.
              </p>
            </div>
          )}

          {(category === "body" || category === "hair") && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Age</Label>
                <Select value={age} onValueChange={(v) => setAge(v as AgeGroup)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AGES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Gender</Label>
                <Select value={gender} onValueChange={(v) => setGender(v as Gender)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GENDERS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {(category === "body" || category === "hair") && (
            <div className="space-y-2">
              <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Skin tone</Label>
              <Select value={skinTone} onValueChange={(v) => setSkinTone(v as SkinTone)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SKIN_TONES.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={autoBaseLabel} />
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Leave blank to auto-label from category / age / gender / skin tone.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {category === "expression" ? "SVG files" : "PNG files"}
            </Label>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 border border-dashed border-border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground transition hover:border-foreground hover:text-foreground">
              <UploadIcon className="h-5 w-5" />
              <span>{files.length ? `${files.length} file${files.length > 1 ? "s" : ""} selected` : category === "expression" ? "Drop SVGs or click to browse" : "Drop PNGs or click to browse"}</span>
              <input
                type="file"
                accept={category === "expression" ? "image/svg+xml" : "image/png"}
                multiple
                className="hidden"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
            </label>
            {category === "expression" && (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Expressions use SVG so their fill colors can be tinted per head. Give each shape a unique id in the SVG (e.g. mouth, light) to expose it as a color slot.
              </p>
            )}
            {files.length > 1 && (
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Labels: {baseLabel} 01 … {baseLabel} {String(files.length).padStart(2, "0")}
              </p>
            )}
          </div>

          {previews.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Preview</Label>
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Uploading as {category === "hair" ? "head" : category}
                </p>
              </div>
              <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto">
                {previews.map((src, i) => (
                  <div key={i} className="relative">
                    <Checker>
                      <img src={src} alt="" className="absolute inset-0 h-full w-full object-contain" />
                    </Checker>
                    <p className="mt-1 truncate text-[10px] text-muted-foreground">{files[i]?.name}</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Double-check the image matches the selected category before uploading.
              </p>
            </div>
          )}

          {busy && <Progress value={progress} />}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy} className="rounded-none uppercase text-xs tracking-[0.2em]">Cancel</Button>
            <Button type="submit" disabled={busy} className="rounded-none uppercase text-xs tracking-[0.2em]">
              {busy ? "Uploading..." : "Upload"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditAssetDialog({
  asset,
  onOpenChange,
  onSaved,
  bodies,
}: {
  asset: Asset | null
  onOpenChange: (v: boolean) => void
  onSaved: () => void
  bodies: Asset[]
}) {
  const [label, setLabel] = useState("")
  const [age, setAge] = useState<AgeGroup>("adult")
  const [gender, setGender] = useState<Gender>("male")
  const [skinTone, setSkinTone] = useState<SkinTone>("light")
  const [parentBodyId, setParentBodyId] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const [replaceFile, setReplaceFile] = useState<File | null>(null)
  const [replaceBusy, setReplaceBusy] = useState(false)

  useEffect(() => {
    if (!asset) return
    setLabel(asset.label)
    if (asset.age) setAge(asset.age)
    if (asset.gender) setGender(asset.gender)
    if (asset.skin_tone) setSkinTone(asset.skin_tone)
    setParentBodyId(asset.parent_body_id ?? "")
    setReplaceFile(null)
  }, [asset])

  if (!asset) return null
  const isBody = asset.category === "body"
  const isHead = asset.category === "hair"
  const isOutfit = asset.category === "outfit"
  const needsAgeGender = isBody || isHead
  const needsSkin = isBody || isHead

  async function onReplace() {
    if (!asset || !replaceFile) return
    setReplaceBusy(true)
    try {
      await replaceAssetFile(asset, replaceFile)
      toast.success("Asset file replaced.")
      setReplaceFile(null)
      onSaved()
    } catch (err: any) {
      toast.error(err.message ?? "Replace failed.")
    } finally {
      setReplaceBusy(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!asset) return
    if (!label.trim()) { toast.error("Label required."); return }
    setBusy(true)
    try {
      await updateAssetParams(asset.id, {
        label: label.trim(),
        age: needsAgeGender ? age : null,
        gender: needsAgeGender ? gender : null,
        skin_tone: needsSkin ? skinTone : null,
        parent_body_id: isOutfit ? (parentBodyId || null) : null,
      })
      toast.success("Asset updated.")
      onSaved()
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message ?? "Update failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!asset} onOpenChange={(v) => { if (!busy) onOpenChange(v) }}>
      <DialogContent className="max-w-lg rounded-none">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl font-light italic">Edit asset</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Category</Label>
            <p className="text-sm">{asset.category === "hair" ? "Head" : asset.category}</p>
          </div>

          {needsAgeGender && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Age</Label>
                <Select value={age} onValueChange={(v) => setAge(v as AgeGroup)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AGES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Gender</Label>
                <Select value={gender} onValueChange={(v) => setGender(v as Gender)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GENDERS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {needsSkin && (
            <div className="space-y-2">
              <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Skin tone</Label>
              <Select value={skinTone} onValueChange={(v) => setSkinTone(v as SkinTone)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SKIN_TONES.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {isOutfit && (
            <div className="space-y-2">
              <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Body</Label>
              <Select value={parentBodyId} onValueChange={setParentBodyId}>
                <SelectTrigger><SelectValue placeholder="Choose a body" /></SelectTrigger>
                <SelectContent>
                  {bodies.map((b) => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} required />
          </div>

          <div className="space-y-3 border border-border p-4">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Replace file</Label>
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">PNG recommended</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative h-16 w-16 flex-shrink-0 border border-border bg-[#fbf7f1]">
                <img src={publicUrl(asset.storage_path, asset.storage_provider)} alt="" className="absolute inset-0 h-full w-full object-contain" />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <Input
                  type="file"
                  accept="image/png,image/webp,image/jpeg,image/svg+xml"
                  onChange={(e) => setReplaceFile(e.target.files?.[0] ?? null)}
                  className="h-9 rounded-none text-xs"
                  disabled={replaceBusy}
                />
                {replaceFile && (
                  <p className="truncate text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    {replaceFile.name}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              {replaceFile && (
                <Button type="button" variant="ghost" onClick={() => setReplaceFile(null)} disabled={replaceBusy} className="rounded-none uppercase text-xs tracking-[0.2em]">
                  <X className="mr-1 h-3 w-3" /> Clear
                </Button>
              )}
              <Button type="button" onClick={onReplace} disabled={!replaceFile || replaceBusy} className="rounded-none uppercase text-xs tracking-[0.2em]">
                <UploadIcon className="mr-1 h-3 w-3" />
                {replaceBusy ? "Replacing..." : "Replace"}
              </Button>
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Uploads the new file and points this asset to it. The old file is deleted. Transform overrides and layer settings are kept.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy} className="rounded-none uppercase text-xs tracking-[0.2em]">Cancel</Button>
            <Button type="submit" disabled={busy} className="rounded-none uppercase text-xs tracking-[0.2em]">
              {busy ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function AdminPage() {
  const location = useLocation()
  const navState = (location.state ?? null) as null | {
    view?: "library" | "positioning" | "layers"
    positioning?: {
      age?: AgeGroup
      gender?: Gender
      skin?: SkinTone
      category?: Exclude<AssetCategory, "body" | "skin" | "facial_hair">
      assetId?: string
      headId?: string
    }
  }
  const [authed, setAuthed] = useState<null | boolean>(null)
  const [email, setEmail] = useState<string>("")
  const [assets, setAssets] = useState<Asset[]>([])
  const [defaults, setDefaults] = useState<CategoryDefault[]>([])
  const [filter, setFilter] = useState<AssetCategory | "all">("all")
  const [genderFilter, setGenderFilter] = useState<Gender | "all">("all")
  const [skinFilter, setSkinFilter] = useState<SkinTone | "all">("all")
  const [ageFilter, setAgeFilter] = useState<AgeGroup | "all">("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editAsset, setEditAsset] = useState<Asset | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<"library" | "positioning" | "layers">(navState?.view ?? "library")
  const [positioningInit] = useState(navState?.positioning)
  const [positioningSel, setPositioningSel] = useState<PositioningSelection | null>(null)
  const [layerOrder, setLayerOrder] = useState<LayerOrder[]>(DEFAULT_LAYER_ORDER)
  const [defaultOutfits, setDefaultOutfits] = useState<BodyDefaultOutfit[]>([])

  async function bootstrap() {
    const { data } = await supabase.auth.getUser()
    if (!data.user) { setAuthed(false); return }
    const admin = await isCurrentUserAdmin()
    if (!admin) { await signOut(); setAuthed(false); return }
    setEmail(data.user.email ?? "")
    setAuthed(true)
  }

  async function load() {
    setLoading(true)
    try {
      const [rows, defs, order, defOutfits] = await Promise.all([fetchAssets(), fetchCategoryDefaults(), fetchLayerOrder(), fetchBodyDefaultOutfits()])
      setAssets(rows)
      setDefaults(defs)
      setLayerOrder(order)
      setDefaultOutfits(defOutfits)
    } catch (err: any) {
      toast.error(err.message ?? "Failed to load assets.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { bootstrap() }, [])
  useEffect(() => { if (authed) load() }, [authed])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: assets.length }
    for (const a of assets) c[a.category] = (c[a.category] ?? 0) + 1
    return c
  }, [assets])

  const filtered = assets.filter((a) => {
    if (filter !== "all" && a.category !== filter) return false
    if (genderFilter !== "all") {
      if (a.category !== "body" && a.category !== "hair") return false
      if (a.gender !== genderFilter) return false
    }
    if (skinFilter !== "all") {
      if (a.category !== "body" && a.category !== "hair") return false
      if (a.skin_tone !== skinFilter) return false
    }
    if (ageFilter !== "all") {
      if (a.category !== "body" && a.category !== "hair") return false
      if (a.age !== ageFilter) return false
    }
    return true
  })

  const filteredIds = filtered.map((a) => a.id)
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id))
  const someFilteredSelected = filteredIds.some((id) => selectedIds.has(id))

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const id of filteredIds) next.delete(id)
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const id of filteredIds) next.add(id)
        return next
      })
    }
  }
  function clearSelection() {
    setSelectedIds(new Set())
  }
  async function bulkDelete() {
    if (selectedIds.size === 0) return
    if (!confirm(`Delete ${selectedIds.size} asset${selectedIds.size > 1 ? "s" : ""}? This cannot be undone.`)) return
    setBulkDeleting(true)
    try {
      const targets = assets.filter((a) => selectedIds.has(a.id))
      await Promise.all(targets.map((a) => deleteAsset(a)))
      toast.success(`Deleted ${targets.length} asset${targets.length > 1 ? "s" : ""}.`)
      setSelectedIds(new Set())
      await load()
    } catch (err: any) {
      toast.error(err.message ?? "Bulk delete failed.")
    } finally {
      setBulkDeleting(false)
    }
  }

  if (authed === null) {
    return <div className="flex min-h-svh items-center justify-center bg-background text-xs uppercase tracking-[0.3em] text-muted-foreground">Loading</div>
  }
  if (!authed) {
    return (<>
      <Toaster />
      <LoginScreen onSignedIn={() => bootstrap()} />
    </>)
  }

  async function onToggle(a: Asset) {
    await setAssetActive(a.id, !a.is_active)
    await load()
  }
  async function onDelete(a: Asset) {
    if (!confirm(`Delete ${a.label}?`)) return
    await deleteAsset(a)
    await load()
  }
  async function onToggleDefaultOutfit(a: Asset) {
    if (a.category !== "outfit" || !a.parent_body_id) return
    const current = defaultOutfits.find((d) => d.body_id === a.parent_body_id)
    try {
      if (current?.outfit_id === a.id) {
        await clearBodyDefaultOutfit(a.parent_body_id)
        toast.success("Default outfit cleared.")
      } else {
        await setBodyDefaultOutfit(a.parent_body_id, a.id)
        toast.success("Set as default outfit.")
      }
      await load()
    } catch (err: any) {
      toast.error(err.message ?? "Could not update default.")
    }
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <Toaster />
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-8 py-6">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Atelier Studio</p>
            <h1 className="font-serif text-2xl font-light italic">Character Builder, admin</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">{email}</span>
            <Button asChild variant="ghost" className="rounded-none uppercase text-xs tracking-[0.2em]">
              <Link
                to="/"
                state={
                  view === "positioning" && positioningSel
                    ? { builder: positioningSel }
                    : undefined
                }
              >
                <ArrowLeft className="mr-1 h-3 w-3" /> Back to builder
              </Link>
            </Button>
            <Button onClick={() => setUploadOpen(true)} className="rounded-none uppercase text-xs tracking-[0.2em]">
              <Plus className="mr-1 h-3 w-3" /> Upload
            </Button>
            <Button variant="ghost" onClick={async () => { await signOut(); setAuthed(false) }} className="rounded-none uppercase text-xs tracking-[0.2em]">
              <LogOut className="mr-1 h-3 w-3" /> Sign out
            </Button>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 overflow-x-auto px-8 pb-4">
          <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            {view === "library" && CATEGORIES.map((c) => {
              const active = filter === c.key
              return (
                <button
                  key={c.key}
                  onClick={() => setFilter(c.key)}
                  className={`flex items-center gap-2 border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] transition ${active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"}`}
                >
                  {c.label}
                  <span className="text-[10px] opacity-70">{counts[c.key] ?? 0}</span>
                </button>
              )
            })}
          </div>
            {view === "library" && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Age</span>
                <div className="flex items-center gap-1">
                  {(["all", ...AGES] as const).map((a) => {
                    const active = ageFilter === a
                    return (
                      <button
                        key={a}
                        onClick={() => setAgeFilter(a)}
                        className={`border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] transition ${active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"}`}
                      >
                        {a}
                      </button>
                    )
                  })}
                </div>
                <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Gender</span>
                <div className="flex items-center gap-1">
                  {(["all", ...GENDERS] as const).map((g) => {
                    const active = genderFilter === g
                    return (
                      <button
                        key={g}
                        onClick={() => setGenderFilter(g)}
                        className={`border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] transition ${active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"}`}
                      >
                        {g}
                      </button>
                    )
                  })}
                </div>
                <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Skin</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setSkinFilter("all")}
                    className={`border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] transition ${skinFilter === "all" ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"}`}
                  >
                    all
                  </button>
                  {SKIN_TONES.map((t) => {
                    const active = skinFilter === t.key
                    return (
                      <button
                        key={t.key}
                        onClick={() => setSkinFilter(t.key)}
                        title={t.label}
                        className={`flex h-6 w-6 items-center justify-center border transition ${active ? "border-foreground ring-1 ring-foreground" : "border-border hover:border-foreground"}`}
                        style={{ background: t.swatch }}
                      >
                        <span className="sr-only">{t.label}</span>
                      </button>
                    )
                  })}
                </div>
                {(genderFilter !== "all" || skinFilter !== "all" || ageFilter !== "all") && (
                  <button
                    onClick={() => { setGenderFilter("all"); setSkinFilter("all"); setAgeFilter("all") }}
                    className="border border-border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setView("library")}
              className={`border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] transition ${view === "library" ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"}`}
            >
              Library
            </button>
            <button
              onClick={() => setView("positioning")}
              className={`inline-flex items-center gap-1 border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] transition ${view === "positioning" ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"}`}
            >
              <Move className="h-3 w-3" /> Positioning
            </button>
            <button
              onClick={() => setView("layers")}
              className={`inline-flex items-center gap-1 border px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] transition ${view === "layers" ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"}`}
            >
              <Layers className="h-3 w-3" /> Layers
            </button>
          </div>
        </div>
      </header>

      {view === "layers" ? (
        <AdminErrorBoundary viewName="Layers">
          <LayersView layerOrder={layerOrder} assets={assets} defaults={defaults} onChanged={load} />
        </AdminErrorBoundary>
      ) : view === "positioning" ? (
        <AdminErrorBoundary viewName="Positioning">
          <PositioningView
            assets={assets}
            defaults={defaults}
            layerOrder={layerOrder}
            onChanged={load}
            initial={positioningInit}
            onSelectionChange={setPositioningSel}
          />
        </AdminErrorBoundary>
      ) : (
      <main className="mx-auto max-w-[1400px] px-8 py-10">
        {!loading && filtered.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-border bg-muted/30 px-4 py-2">
            <div className="flex items-center gap-3">
              <button
                onClick={toggleSelectAll}
                className={`flex h-5 w-5 items-center justify-center border transition ${allFilteredSelected ? "border-foreground bg-foreground text-background" : someFilteredSelected ? "border-foreground bg-foreground/20 text-foreground" : "border-border text-transparent hover:border-foreground"}`}
                title={allFilteredSelected ? "Deselect all" : "Select all"}
                aria-label={allFilteredSelected ? "Deselect all" : "Select all"}
              >
                <Check className="h-3 w-3" />
              </button>
              <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : `${filtered.length} shown`}
              </span>
            </div>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={clearSelection}
                  className="border border-border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:border-foreground hover:text-foreground"
                >
                  Clear
                </button>
                <button
                  onClick={bulkDelete}
                  disabled={bulkDeleting}
                  className="inline-flex items-center gap-1 border border-destructive bg-destructive px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-background disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" /> {bulkDeleting ? "Deleting..." : `Delete ${selectedIds.size}`}
                </button>
              </div>
            )}
          </div>
        )}
        {loading ? (
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Loading assets</p>
        ) : filtered.length === 0 ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 border border-dashed border-border">
            <p className="font-serif text-xl italic text-muted-foreground">Nothing here yet</p>
            <Button onClick={() => setUploadOpen(true)} variant="outline" className="rounded-none uppercase text-xs tracking-[0.2em]">
              Upload your first asset
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((a) => {
              const isOutfit = a.category === "outfit"
              const parentBody = isOutfit && a.parent_body_id ? assets.find((x) => x.id === a.parent_body_id) : null
              const isDefaultOutfit = isOutfit && a.parent_body_id ? defaultOutfits.some((d) => d.body_id === a.parent_body_id && d.outfit_id === a.id) : false
              const isSelected = selectedIds.has(a.id)
              return (
              <div key={a.id} className={`group space-y-2 ${a.is_active ? "" : "opacity-50"}`}>
                <div className="relative">
                  <Checker>
                    <img src={publicUrl(a.storage_path, a.storage_provider)} alt={a.label} className="absolute inset-0 h-full w-full object-contain" />
                  </Checker>
                  <button
                    onClick={() => toggleSelect(a.id)}
                    title={isSelected ? "Deselect" : "Select"}
                    aria-label={isSelected ? "Deselect" : "Select"}
                    className={`absolute left-2 bottom-2 z-10 flex h-6 w-6 items-center justify-center border transition ${isSelected ? "border-foreground bg-foreground text-background opacity-100" : "border-border bg-background text-transparent opacity-0 group-hover:opacity-100 hover:border-foreground"}`}
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <div className="absolute right-2 top-2 flex flex-col gap-1 opacity-0 transition group-hover:opacity-100">
                    {isOutfit && a.parent_body_id && (
                      <button onClick={() => onToggleDefaultOutfit(a)} title={isDefaultOutfit ? "Unset default" : "Set as default"} className={`flex h-8 w-8 items-center justify-center border bg-background ${isDefaultOutfit ? "border-foreground text-foreground" : "border-border text-foreground hover:bg-foreground hover:text-background"}`}>
                        <Star className={`h-3.5 w-3.5 ${isDefaultOutfit ? "fill-current" : ""}`} />
                      </button>
                    )}
                    <button onClick={() => setEditAsset(a)} title="Edit" className="flex h-8 w-8 items-center justify-center border border-border bg-background text-foreground hover:bg-foreground hover:text-background">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => onToggle(a)} title={a.is_active ? "Disable" : "Enable"} className="flex h-8 w-8 items-center justify-center border border-border bg-background text-foreground hover:bg-foreground hover:text-background">
                      <Power className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => onDelete(a)} title="Delete" className="flex h-8 w-8 items-center justify-center border border-border bg-background text-foreground hover:bg-destructive hover:text-background">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {a.skin_tone && (
                    <div
                      className="absolute left-2 top-2 h-5 w-5 rounded-full border border-border"
                      style={{ background: SKIN_TONES.find((t) => t.key === a.skin_tone)?.swatch ?? "#ccc" }}
                      title={a.skin_tone}
                    />
                  )}
                  {isDefaultOutfit && (
                    <span className="absolute left-2 top-2 inline-flex items-center gap-1 border border-foreground bg-background px-1.5 py-0.5 text-[9px] uppercase tracking-[0.2em]">
                      <Star className="h-2.5 w-2.5 fill-current" /> Default
                    </span>
                  )}
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{a.label}</p>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {a.category === "hair" ? "head" : a.category.replace("_", " ")}
                      {a.age && ` · ${a.age}`}
                      {a.gender && ` · ${a.gender}`}
                      {a.skin_tone && ` · ${a.skin_tone}`}
                      {parentBody && ` · ${parentBody.label}`}
                    </p>
                  </div>
                  {!a.is_active && <X className="mt-1 h-3 w-3 text-muted-foreground" />}
                </div>
              </div>
              )
            })}
          </div>
        )}
      </main>
      )}

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} onUploaded={load} bodies={assets.filter((a) => a.category === "body")} />
      <EditAssetDialog asset={editAsset} onOpenChange={(v) => { if (!v) setEditAsset(null) }} onSaved={load} bodies={assets.filter((a) => a.category === "body")} />
    </div>
  )
}

const LAYER_LABELS: Record<LayerOrder["category"], string> = {
  body: "Body",
  hair: "Head",
  accessory: "Accessory",
  expression: "Expression",
}

function LayersView({
  layerOrder,
  assets,
  defaults,
  onChanged,
}: {
  layerOrder: LayerOrder[]
  assets: Asset[]
  defaults: CategoryDefault[]
  onChanged: () => Promise<void> | void
}) {
  const [draft, setDraft] = useState<LayerOrder[]>(layerOrder)
  const [saving, setSaving] = useState(false)
  const [selection, setSelection] = useState<Record<LayerOrder["category"], string | null>>({
    body: null, hair: null, accessory: null, expression: null,
  })

  useEffect(() => {
    setDraft([...layerOrder].sort((a, b) => a.z_index - b.z_index))
  }, [layerOrder])

  const assetsByCategory = useMemo(() => {
    const map: Record<LayerOrder["category"], Asset[]> = {
      body: [], hair: [], accessory: [], expression: [],
    }
    for (const a of assets) {
      if (!a.is_active) continue
      if (!(a.category in map)) continue
      map[a.category as LayerOrder["category"]].push(a)
    }
    return map
  }, [assets])

  useEffect(() => {
    setSelection((prev) => {
      const next = { ...prev }
      ;(Object.keys(assetsByCategory) as LayerOrder["category"][]).forEach((cat) => {
        const list = assetsByCategory[cat]
        if (!list.length) { next[cat] = null; return }
        if (!next[cat] || !list.find((a) => a.id === next[cat])) next[cat] = list[0].id
      })
      return next
    })
  }, [assetsByCategory])

  function move(index: number, direction: -1 | 1) {
    const next = [...draft]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setDraft(next.map((row, i) => ({ ...row, z_index: i + 1 })))
  }

  async function save() {
    setSaving(true)
    try {
      await saveLayerOrder(draft)
      await onChanged()
      toast.success("Layer order saved.")
    } catch (err: any) {
      toast.error(err.message ?? "Save failed.")
    } finally {
      setSaving(false)
    }
  }

  const reversed = [...draft].reverse()
  const bodySelected = assetsByCategory.body.find((a) => a.id === selection.body) ?? null

  return (
    <main className="mx-auto max-w-[1200px] px-8 py-10">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_520px]">
        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="font-serif text-2xl italic">Layer order</h2>
            <p className="text-xs text-muted-foreground">
              The top entry renders above everything else. Use the selectors on the right to pick the assets shown in the live preview.
            </p>
          </div>

          <div className="border border-border">
            {reversed.map((row, idx) => {
              const realIndex = draft.length - 1 - idx
              const list = assetsByCategory[row.category] ?? []
              if (!LAYER_LABELS[row.category]) {
                console.warn("[LayersView] unknown category in layer_order:", row.category)
                return null
              }
              const selectedId = selection[row.category]
              return (
                <div
                  key={row.category}
                  className="flex flex-col gap-3 border-b border-border px-4 py-3 last:border-b-0 sm:flex-row sm:items-center"
                >
                  <span className="w-8 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 text-sm">{LAYER_LABELS[row.category]}</span>
                  <select
                    value={selectedId ?? ""}
                    onChange={(e) => setSelection((s) => ({ ...s, [row.category]: e.target.value || null }))}
                    className="h-7 max-w-[180px] border border-border bg-transparent px-2 text-[11px] uppercase tracking-[0.2em]"
                  >
                    {row.category !== "body" && <option value="">None</option>}
                    {list.map((a) => (
                      <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                    {!list.length && <option value="" disabled>No assets</option>}
                  </select>
                  <select
                    value={row.blend_mode ?? "normal"}
                    onChange={(e) => {
                      const mode = e.target.value as BlendMode
                      setDraft((d) => d.map((r) => r.category === row.category ? { ...r, blend_mode: mode } : r))
                    }}
                    className="h-7 max-w-[130px] border border-border bg-transparent px-2 text-[11px] uppercase tracking-[0.2em]"
                    title="Blend mode"
                  >
                    {BLEND_MODES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Z {row.z_index}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => move(realIndex, 1)}
                      disabled={realIndex === draft.length - 1}
                      className="h-7 w-7 rounded-none p-0"
                      title="Move up"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => move(realIndex, -1)}
                      disabled={realIndex === 0}
                      className="h-7 w-7 rounded-none p-0"
                      title="Move down"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={save} disabled={saving} className="rounded-none uppercase text-xs tracking-[0.2em]">
              {saving ? "Saving..." : "Save order"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setDraft(DEFAULT_LAYER_ORDER)}
              className="rounded-none uppercase text-xs tracking-[0.2em]"
            >
              <RotateCcw className="mr-1 h-3 w-3" /> Reset
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline gap-3 border-b border-border pb-2">
            <span className="font-serif text-sm italic text-muted-foreground">Preview</span>
            <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Live</span>
          </div>
          <div className="relative aspect-square w-full overflow-hidden border border-border bg-muted/30">
            {draft.map((row) => {
              const id = selection[row.category]
              if (!id) return null
              const list = assetsByCategory[row.category] ?? []
              const asset = list.find((a) => a.id === id)
              if (!asset) return null
              const blend = (row.blend_mode && row.blend_mode !== "normal" ? row.blend_mode : undefined) as GlobalCompositeOperation | undefined
              if (row.category === "body") {
                return (
                  <img
                    key={row.category}
                    src={publicUrl(asset.storage_path, asset.storage_provider)}
                    alt=""
                    style={{ zIndex: row.z_index, mixBlendMode: blend as any }}
                    className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                  />
                )
              }
              return (
                <LayerPreviewOverlay
                  key={row.category}
                  asset={asset}
                  bodyId={bodySelected?.id ?? null}
                  defaults={defaults}
                  z={row.z_index}
                  blend={blend}
                />
              )
            })}
          </div>
        </div>
      </div>
    </main>
  )
}

function LayerPreviewOverlay({
  asset,
  bodyId,
  defaults,
  z,
  blend,
}: {
  asset: Asset
  bodyId: string | null
  defaults: CategoryDefault[]
  z: number
  blend?: GlobalCompositeOperation
}) {
  const size = useNaturalSize(publicUrl(asset.storage_path, asset.storage_provider))
  if (!size) return null
  const t: Transform = resolveTransform(asset, bodyId, defaults)
  const wPct = (size.w * t.scale) / CANVAS * 100
  const hPct = (size.h * t.scale) / CANVAS * 100
  const leftPct = ((CANVAS - size.w * t.scale) / 2 + t.offset_x) / CANVAS * 100
  const topPct = ((CANVAS - size.h * t.scale) / 2 + t.offset_y) / CANVAS * 100
  return (
    <img
      src={publicUrl(asset.storage_path, asset.storage_provider)}
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

function useNaturalSize(src: string) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    setSize(null)
    if (!src) return
    if (isSvgPath(src)) { setSize({ w: CANVAS, h: CANVAS }); return }
    const img = new Image()
    img.onload = () => setSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = src
  }, [src])
  return size
}

const POS_CATEGORIES: { key: Exclude<AssetCategory, "body" | "skin" | "facial_hair">; label: string }[] = [
  { key: "hair", label: "Head" },
  { key: "accessory", label: "Accessory" },
  { key: "expression", label: "Expression" },
]

export type PositioningSelection = {
  age: AgeGroup
  gender: Gender
  skin: SkinTone
  category: Exclude<AssetCategory, "body" | "skin" | "facial_hair">
  assetId: string | null
  headId: string | null
}

function PositioningView({
  assets,
  defaults,
  layerOrder,
  onChanged,
  initial,
  onSelectionChange,
}: {
  assets: Asset[]
  defaults: CategoryDefault[]
  layerOrder: LayerOrder[]
  onChanged: () => Promise<void> | void
  initial?: {
    age?: AgeGroup
    gender?: Gender
    skin?: SkinTone
    category?: Exclude<AssetCategory, "body" | "skin" | "facial_hair">
    assetId?: string
    headId?: string
  }
  onSelectionChange?: (sel: PositioningSelection) => void
}) {
  const zOf = (cat: LayerOrder["category"]) => layerOrder.find((l) => l.category === cat)?.z_index ?? 0
  const bodyZ = zOf("body")
  const activeZ = zOf
  const bodies = useMemo(() => assets.filter((a) => a.category === "body"), [assets])
  const heads = useMemo(() => assets.filter((a) => a.category === "hair"), [assets])
  const [filterAge, setFilterAge] = useState<AgeGroup>(initial?.age ?? "adult")
  const [filterGender, setFilterGender] = useState<Gender>(initial?.gender ?? "female")
  const [filterSkin, setFilterSkin] = useState<SkinTone>(initial?.skin ?? "light")
  const bodyId = useMemo(() => {
    const match = bodies.find(
      (b) => b.age === filterAge && b.gender === filterGender && b.skin_tone === filterSkin,
    )
    return match?.id ?? bodies[0]?.id ?? null
  }, [bodies, filterAge, filterGender, filterSkin])
  const [headId, setHeadId] = useState<string | null>(initial?.headId ?? null)
  const [category, setCategory] = useState<Exclude<AssetCategory, "body" | "skin" | "facial_hair">>(initial?.category ?? "hair")
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(initial?.assetId ?? null)
  const [headExprDefaults, setHeadExprDefaults] = useState<HeadExpressionDefault[]>([])
  const [headExprColors, setHeadExprColors] = useState<HeadExpressionColor[]>([])
  const [editingColorAssetId, setEditingColorAssetId] = useState<string | null>(null)

  async function loadHeadExpr() {
    try { setHeadExprDefaults(await fetchHeadExpressionDefaults()) } catch {}
    try { setHeadExprColors(await fetchHeadExpressionColors()) } catch {}
  }
  useEffect(() => { loadHeadExpr() }, [])

  useEffect(() => {
    onSelectionChange?.({
      age: filterAge,
      gender: filterGender,
      skin: filterSkin,
      category,
      assetId: previewAssetId,
      headId,
    })
  }, [filterAge, filterGender, filterSkin, category, previewAssetId, headId, onSelectionChange])

  const body = bodies.find((b) => b.id === bodyId) ?? null

  const compatibleHeads = useMemo(
    () => body ? heads.filter((h) => h.age === body.age && h.gender === body.gender && h.skin_tone === body.skin_tone) : heads,
    [heads, body],
  )
  useEffect(() => {
    if (category !== "expression") return
    if (!assets.length) return
    if (!compatibleHeads.length) {
      if (headId !== null) setHeadId(null)
      return
    }
    if (!headId || !compatibleHeads.find((h) => h.id === headId)) {
      setHeadId(compatibleHeads[0].id)
    }
  }, [assets.length, category, compatibleHeads, headId])
  const head = compatibleHeads.find((h) => h.id === headId) ?? null
  const headSize = useNaturalSize(head ? publicUrl(head.storage_path, head.storage_provider) : "")
  const headExprOverride = headExprDefaults.find((h) => h.head_id === headId) ?? null

  const categoryAssets = useMemo(
    () => assets.filter((a) => {
      if (a.category !== category) return false
      if (category === "hair" && body) {
        return a.age === body.age && a.gender === body.gender && a.skin_tone === body.skin_tone
      }
      return true
    }),
    [assets, category, body],
  )

  useEffect(() => {
    if (!assets.length) return
    if (!categoryAssets.length) {
      if (previewAssetId !== null) setPreviewAssetId(null)
      return
    }
    if (!categoryAssets.find((a) => a.id === previewAssetId)) {
      setPreviewAssetId(categoryAssets[0].id)
    }
  }, [assets.length, categoryAssets, previewAssetId])

  const existingDefault = defaults.find((d) => d.body_id === bodyId && d.category === category)
  const [draft, setDraft] = useState<Transform>({ offset_x: 0, offset_y: 0, scale: 1 })

  useEffect(() => {
    setDraft({
      offset_x: existingDefault?.offset_x ?? 0,
      offset_y: existingDefault?.offset_y ?? 0,
      scale: existingDefault?.scale ?? 1,
    })
  }, [bodyId, category, existingDefault?.offset_x, existingDefault?.offset_y, existingDefault?.scale])

  const previewAsset = categoryAssets.find((a) => a.id === previewAssetId) ?? null
  const previewFakeDefaults: CategoryDefault[] = bodyId
    ? [{ body_id: bodyId, category, ...draft }]
    : []
  const previewTransform: Transform = previewAsset
    ? resolveTransform(previewAsset, bodyId, previewFakeDefaults)
    : { offset_x: 0, offset_y: 0, scale: 1 }

  const canvasRef = useRef<HTMLDivElement | null>(null)
  const previewSize = useNaturalSize(previewAsset ? publicUrl(previewAsset.storage_path, previewAsset.storage_provider) : "")

  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [dirtyOverride, setDirtyOverride] = useState<Record<string, Transform>>({})
  const [headExprDraft, setHeadExprDraft] = useState<Transform | null>(null)
  const [headExprSaving, setHeadExprSaving] = useState(false)
  const [colorDraft, setColorDraft] = useState<Record<string, Record<string, string>>>({})
  const [labelDraft, setLabelDraft] = useState<Record<string, Record<string, string>>>({})

  const colorKey = (hId: string, eId: string) => `${hId}::${eId}`
  const getExpressionColors = (hId: string | null, eId: string | null): Record<string, string> | null => {
    if (!hId || !eId) return null
    const draft = colorDraft[colorKey(hId, eId)]
    if (draft) return draft
    const saved = headExprColors.find((c) => c.head_id === hId && c.expression_id === eId)
    return saved?.colors ?? null
  }

  useEffect(() => {
    if (category !== "expression" || !headId) { setHeadExprDraft(null); return }
    setHeadExprDraft({
      offset_x: headExprOverride?.offset_x ?? 0,
      offset_y: headExprOverride?.offset_y ?? 0,
      scale: headExprOverride?.scale ?? 1,
    })
  }, [category, headId, headExprOverride?.offset_x, headExprOverride?.offset_y, headExprOverride?.scale])

  function pxPerUnit(): number {
    const el = canvasRef.current
    if (!el) return 1
    return (el.getBoundingClientRect().width) / CANVAS
  }

  function applyPreviewTransform(next: Transform) {
    if (!previewAsset) return
    setDirtyOverride((d) => ({ ...d, [previewAsset.id]: next }))
  }

  async function commitPreviewTransform() {
    if (!previewAsset) return
    const t = dirtyOverride[previewAsset.id]
    if (!t) return
    try {
      await updateAssetTransform(previewAsset.id, { offset_x: Math.round(t.offset_x), offset_y: Math.round(t.offset_y), scale: t.scale })
      setDirtyOverride((d) => { const n = { ...d }; delete n[previewAsset.id]; return n })
      await onChanged()
    } catch (err: any) {
      toast.error(err.message ?? "Save failed.")
    }
  }

  async function applyOverrideToAll() {
    if (!previewAsset || category === "expression") return
    const t = baseForPreview
    const payload = { offset_x: Math.round(t.offset_x), offset_y: Math.round(t.offset_y), scale: t.scale }
    try {
      await Promise.all(categoryAssets.map((a) => updateAssetTransform(a.id, payload)))
      setDirtyOverride({})
      await onChanged()
      toast.success(`Applied to ${categoryAssets.length} ${category === "hair" ? "head" : category}${categoryAssets.length > 1 ? "s" : ""}.`)
    } catch (err: any) {
      toast.error(err.message ?? "Apply to all failed.")
    }
  }

  const baseForPreview: Transform = previewAsset
    ? (dirtyOverride[previewAsset.id] ?? {
        offset_x: previewAsset.offset_x ?? draft.offset_x,
        offset_y: previewAsset.offset_y ?? draft.offset_y,
        scale: previewAsset.scale ?? draft.scale,
      })
    : previewTransform

  const effectiveForPreview: Transform =
    category === "expression" && headExprDraft
      ? {
          offset_x: baseForPreview.offset_x + headExprDraft.offset_x,
          offset_y: baseForPreview.offset_y + headExprDraft.offset_y,
          scale: baseForPreview.scale * headExprDraft.scale,
        }
      : baseForPreview

  function startDrag(e: React.PointerEvent) {
    if (!previewAsset) return
    e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const ppu = pxPerUnit()
    const startX = e.clientX
    const startY = e.clientY
    if (category === "expression" && headExprDraft) {
      const start = { ...headExprDraft }
      function onMove(ev: PointerEvent) {
        const dx = (ev.clientX - startX) / ppu
        const dy = (ev.clientY - startY) / ppu
        setHeadExprDraft({ ...start, offset_x: start.offset_x + dx, offset_y: start.offset_y + dy })
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
      }
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      return
    }
    const start = { ...effectiveForPreview }
    function onMove(ev: PointerEvent) {
      const dx = (ev.clientX - startX) / ppu
      const dy = (ev.clientY - startY) / ppu
      applyPreviewTransform({ ...start, offset_x: start.offset_x + dx, offset_y: start.offset_y + dy })
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      commitPreviewTransform()
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  function startResize(e: React.PointerEvent) {
    if (!previewAsset || !previewSize) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const ppu = pxPerUnit()
    const startX = e.clientX
    const startY = e.clientY
    if (category === "expression" && headExprDraft) {
      const start = { ...headExprDraft }
      const effScale = baseForPreview.scale * start.scale
      const halfW = (previewSize.w * effScale) / 2
      const halfH = (previewSize.h * effScale) / 2
      const baseDist = Math.hypot(halfW, halfH)
      function onMove(ev: PointerEvent) {
        const dx = (ev.clientX - startX) / ppu
        const dy = (ev.clientY - startY) / ppu
        const newDist = Math.hypot(halfW + dx, halfH + dy)
        const factor = Math.max(0.05, newDist / baseDist)
        const nextScale = Math.max(0.1, Math.min(5, start.scale * factor))
        setHeadExprDraft({ ...start, scale: nextScale })
        void factor
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
      }
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      return
    }
    const start = { ...effectiveForPreview }
    const halfW = (previewSize.w * start.scale) / 2
    const halfH = (previewSize.h * start.scale) / 2
    const baseDist = Math.hypot(halfW, halfH)
    function onMove(ev: PointerEvent) {
      const dx = (ev.clientX - startX) / ppu
      const dy = (ev.clientY - startY) / ppu
      const newDist = Math.hypot(halfW + dx, halfH + dy)
      const factor = Math.max(0.05, newDist / baseDist)
      const nextScale = Math.max(0.1, Math.min(5, start.scale * factor))
      applyPreviewTransform({ ...start, scale: nextScale })
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      commitPreviewTransform()
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  async function saveHeadExpr() {
    if (!headId || !headExprDraft) return
    setHeadExprSaving(true)
    try {
      await upsertHeadExpressionDefault({
        head_id: headId,
        offset_x: Math.round(headExprDraft.offset_x),
        offset_y: Math.round(headExprDraft.offset_y),
        scale: headExprDraft.scale,
      })
      await loadHeadExpr()
      toast.success("Expression position saved for this head.")
    } catch (err: any) {
      toast.error(err.message ?? "Save failed.")
    } finally {
      setHeadExprSaving(false)
    }
  }

  async function clearHeadExpr() {
    if (!headId) return
    try {
      await deleteHeadExpressionDefault(headId)
      await loadHeadExpr()
      toast.success("Head override cleared.")
    } catch (err: any) {
      toast.error(err.message ?? "Clear failed.")
    }
  }

  async function applyHeadExprToAll() {
    if (!headExprDraft || !compatibleHeads.length) return
    const payload = {
      offset_x: Math.round(headExprDraft.offset_x),
      offset_y: Math.round(headExprDraft.offset_y),
      scale: headExprDraft.scale,
    }
    setHeadExprSaving(true)
    try {
      await Promise.all(
        compatibleHeads.map((h) => upsertHeadExpressionDefault({ head_id: h.id, ...payload })),
      )
      await loadHeadExpr()
      toast.success(`Applied to ${compatibleHeads.length} head${compatibleHeads.length > 1 ? "s" : ""}.`)
    } catch (err: any) {
      toast.error(err.message ?? "Apply to all failed.")
    } finally {
      setHeadExprSaving(false)
    }
  }

  return (
    <main className="relative mx-auto w-full px-0">
      <div className="relative h-[calc(100svh-140px)] w-full">
        <div className="absolute inset-0 flex items-center justify-center p-2">
          {(() => {
            const zooming = category === "expression" && head && headSize
            const headDef = defaults.find((d) => d.body_id === bodyId && d.category === "hair")
            const hx = zooming ? (head!.offset_x ?? headDef?.offset_x ?? 0) : 0
            const hy = zooming ? (head!.offset_y ?? headDef?.offset_y ?? 0) : 0
            const hs = zooming ? (head!.scale ?? headDef?.scale ?? 1) : 1
            const headCenterX = zooming ? (CANVAS / 2 + hx) : CANVAS / 2
            const headCenterY = zooming ? (CANVAS / 2 + hy - (headSize!.h * hs) * 0.1) : CANVAS / 2
            const zoom = zooming ? 2.4 : 1
            const originX = (headCenterX / CANVAS) * 100
            const originY = (headCenterY / CANVAS) * 100
            return (
          <div className="relative aspect-square max-h-full max-w-full overflow-hidden" style={{ width: "min(100%, calc(100svh - 160px))" }}>
            {category === "expression" && head && (
              <span className="pointer-events-none absolute left-3 top-3 z-40 whitespace-nowrap border border-border bg-background/95 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-muted-foreground backdrop-blur">
                Editing for head: {head.label}
              </span>
            )}
          <div
            ref={canvasRef}
            className="relative aspect-square h-full w-full"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: `${originX}% ${originY}%`,
              transition: "transform 240ms ease",
            }}
          >
            {body ? (
              <img
                src={publicUrl(body.storage_path, body.storage_provider)}
                alt=""
                className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                style={{ zIndex: bodyZ }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Select a body
              </div>
            )}
            {category === "expression" && head && headSize && (
              (() => {
                const t: Transform = { offset_x: 0, offset_y: 0, scale: 1 }
                const headDef = defaults.find((d) => d.body_id === bodyId && d.category === "hair")
                const hx = head.offset_x ?? headDef?.offset_x ?? 0
                const hy = head.offset_y ?? headDef?.offset_y ?? 0
                const hs = head.scale ?? headDef?.scale ?? 1
                const wPct = (headSize.w * hs) / CANVAS * 100
                const hPct = (headSize.h * hs) / CANVAS * 100
                const leftPct = ((CANVAS - headSize.w * hs) / 2 + hx) / CANVAS * 100
                const topPct = ((CANVAS - headSize.h * hs) / 2 + hy) / CANVAS * 100
                void t
                return (
                  <img
                    src={publicUrl(head.storage_path, head.storage_provider)}
                    alt=""
                    className="pointer-events-none absolute"
                    style={{
                      zIndex: activeZ("hair"),
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      width: `${wPct}%`,
                      height: `${hPct}%`,
                    }}
                  />
                )
              })()
            )}
            {previewAsset && bodyId && previewSize && (
              <InteractiveLayer
                asset={previewAsset}
                transform={effectiveForPreview}
                naturalSize={previewSize}
                blend={undefined}
                onDragStart={startDrag}
                onResizeStart={startResize}
                badge={category === "expression" ? undefined : "Editing override"}
                zIndex={activeZ(category as LayerOrder["category"])}
                colors={category === "expression" ? getExpressionColors(headId, previewAsset.id) : null}
                hideHandles={category === "expression" && editingColorAssetId != null}
              />
            )}
          </div>
          </div>
            )
          })()}
        </div>

        <button
          onClick={() => setLeftOpen((v) => !v)}
          className="absolute left-0 top-6 z-30 flex h-10 w-6 items-center justify-center border border-l-0 border-border bg-card text-muted-foreground hover:text-foreground"
          title={leftOpen ? "Hide controls" : "Show controls"}
        >
          {leftOpen ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <button
          onClick={() => setRightOpen((v) => !v)}
          className="absolute right-0 top-6 z-30 flex h-10 w-6 items-center justify-center border border-r-0 border-border bg-card text-muted-foreground hover:text-foreground"
          title={rightOpen ? "Hide assets" : "Show assets"}
        >
          {rightOpen ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
        </button>

        {leftOpen && (
          <aside className="absolute left-0 top-0 z-20 h-full w-[340px] overflow-y-auto border-r border-border bg-background/95 p-6 backdrop-blur">
            <div className="space-y-6">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Body</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Select value={filterAge} onValueChange={(v) => setFilterAge(v as AgeGroup)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AGES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filterGender} onValueChange={(v) => setFilterGender(v as Gender)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {GENDERS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filterSkin} onValueChange={(v) => setFilterSkin(v as SkinTone)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SKIN_TONES.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {body ? `${body.label}` : "No body matches these filters."}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Category</Label>
                <div className="grid grid-cols-2 gap-2">
                  {POS_CATEGORIES.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => setCategory(c.key)}
                      className={`border px-3 py-2 text-[10px] uppercase tracking-[0.2em] transition ${category === c.key ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"}`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {category === "expression" && (
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Head (relative position)</Label>
                  <Select value={headId ?? ""} onValueChange={(v) => setHeadId(v)}>
                    <SelectTrigger><SelectValue placeholder="Select a head" /></SelectTrigger>
                    <SelectContent>
                      {compatibleHeads.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No heads for this body</div>}
                      {compatibleHeads.map((h) => (
                        <SelectItem key={h.id} value={h.id}>
                          {h.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Expression positions are saved per head, so the mouth lands correctly on each illustration.
                  </p>
                </div>
              )}

              {category === "expression" && headExprDraft && (
                <div className="space-y-4 border border-border p-4">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    Offset for {head?.label ?? "—"}
                  </p>
                  <TransformEditor value={headExprDraft} onChange={(t) => setHeadExprDraft(t)} />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={saveHeadExpr} disabled={headExprSaving || !headId} className="rounded-none uppercase text-xs tracking-[0.2em]">
                      {headExprSaving ? "Saving..." : "Save head offset"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={clearHeadExpr} disabled={!headExprOverride} className="rounded-none uppercase text-xs tracking-[0.2em]">
                      <RotateCcw className="mr-1 h-3 w-3" /> Clear
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={applyHeadExprToAll}
                      disabled={headExprSaving || !headExprDraft || compatibleHeads.length < 2}
                      className="rounded-none uppercase text-xs tracking-[0.2em]"
                      title="Copy these values to every compatible head"
                    >
                      Apply to all heads ({compatibleHeads.length})
                    </Button>
                  </div>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Drag the expression on the canvas to position it on this specific head.
                  </p>
                </div>
              )}

              {category !== "expression" && (
              <div className="space-y-4 border border-border p-4">
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                  Override for {previewAsset?.label ?? "—"}
                </p>
                <TransformEditor value={effectiveForPreview} onChange={applyPreviewTransform} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={commitPreviewTransform} disabled={!previewAsset || !dirtyOverride[previewAsset.id]} className="rounded-none uppercase text-xs tracking-[0.2em]">
                    Save override
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      if (previewAsset) {
                        updateAssetTransform(previewAsset.id, { offset_x: null, offset_y: null, scale: null }).then(() => {
                          setDirtyOverride((d) => { const n = { ...d }; delete n[previewAsset.id]; return n })
                          onChanged()
                          toast.success("Override cleared.")
                        })
                      }
                    }}
                    disabled={!previewAsset}
                    className="rounded-none uppercase text-xs tracking-[0.2em]"
                  >
                    <RotateCcw className="mr-1 h-3 w-3" /> Clear override
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={applyOverrideToAll}
                    disabled={!previewAsset || categoryAssets.length < 2}
                    className="rounded-none uppercase text-xs tracking-[0.2em]"
                    title={`Copy these values to all ${categoryAssets.length} ${category} assets for this body`}
                  >
                    Apply to all {category === "hair" ? "heads" : category === "accessory" ? "accessories" : "assets"} ({categoryAssets.length})
                  </Button>
                </div>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  Drag the image to move. Drag the corner handle to scale. Offsets are in pixels of the 1000x1000 canvas.
                </p>
              </div>
              )}
            </div>
          </aside>
        )}

        {rightOpen && (
          <aside className="absolute right-0 top-0 z-20 h-full w-[340px] overflow-y-auto border-l border-border bg-background/95 p-6 backdrop-blur">
            <div className="space-y-4">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Assets in {category.replace("_", " ")}</p>
              {categoryAssets.length === 0 ? (
                <p className="text-xs text-muted-foreground">No assets yet.</p>
              ) : (
                <div className="space-y-3">
                  {categoryAssets.map((a) => {
                    const hasOverride = a.offset_x != null || a.offset_y != null || a.scale != null
                    const isPreview = previewAssetId === a.id
                    if (category === "expression") {
                      const key = headId ? colorKey(headId, a.id) : null
                      const draftColors = key ? colorDraft[key] : undefined
                      const draftLabels = key ? labelDraft[key] : undefined
                      const savedRow = headId ? headExprColors.find((c) => c.head_id === headId && c.expression_id === a.id) : undefined
                      const savedColors = savedRow?.colors
                      const savedLabels = savedRow?.labels
                      return (
                        <ExpressionColorCard
                          key={a.id}
                          asset={a}
                          headId={headId}
                          isPreview={isPreview}
                          draftColors={draftColors}
                          savedColors={savedColors}
                          draftLabels={draftLabels}
                          savedLabels={savedLabels}
                          groupSize={compatibleHeads.length}
                          onSelect={() => setPreviewAssetId(a.id)}
                          onExpandChange={(open) => {
                            setEditingColorAssetId((prev) => {
                              if (open) return a.id
                              return prev === a.id ? null : prev
                            })
                          }}
                          onDraftChange={(c) => {
                            if (!headId) return
                            setColorDraft((d) => ({ ...d, [colorKey(headId, a.id)]: c }))
                          }}
                          onLabelsChange={(l) => {
                            if (!headId) return
                            setLabelDraft((d) => ({ ...d, [colorKey(headId, a.id)]: l }))
                          }}
                          onSave={async (c, l) => {
                            if (!headId) return
                            try {
                              await upsertHeadExpressionColors({ head_id: headId, expression_id: a.id, colors: c, labels: l })
                              setColorDraft((d) => { const n = { ...d }; if (headId) delete n[colorKey(headId, a.id)]; return n })
                              setLabelDraft((d) => { const n = { ...d }; if (headId) delete n[colorKey(headId, a.id)]; return n })
                              await loadHeadExpr()
                              toast.success("Colors saved for this head.")
                            } catch (err: any) {
                              toast.error(err.message ?? "Save failed.")
                            }
                          }}
                          onApplyToGroup={async (c, l) => {
                            if (compatibleHeads.length === 0) return
                            try {
                              await Promise.all(
                                compatibleHeads.map((h) =>
                                  upsertHeadExpressionColors({ head_id: h.id, expression_id: a.id, colors: c, labels: l }),
                                ),
                              )
                              if (headId) {
                                setColorDraft((d) => { const n = { ...d }; delete n[colorKey(headId, a.id)]; return n })
                                setLabelDraft((d) => { const n = { ...d }; delete n[colorKey(headId, a.id)]; return n })
                              }
                              await loadHeadExpr()
                              toast.success(`Applied to ${compatibleHeads.length} head${compatibleHeads.length > 1 ? "s" : ""}.`)
                            } catch (err: any) {
                              toast.error(err.message ?? "Apply to group failed.")
                            }
                          }}
                          onClear={async () => {
                            if (!headId) return
                            try {
                              await deleteHeadExpressionColors(headId, a.id)
                              setColorDraft((d) => { const n = { ...d }; if (headId) delete n[colorKey(headId, a.id)]; return n })
                              setLabelDraft((d) => { const n = { ...d }; if (headId) delete n[colorKey(headId, a.id)]; return n })
                              await loadHeadExpr()
                              toast.success("Colors cleared.")
                            } catch (err: any) {
                              toast.error(err.message ?? "Clear failed.")
                            }
                          }}
                        />
                      )
                    }
                    return (
                      <AssetOverrideCard
                        key={a.id}
                        asset={a}
                        bodyId={bodyId}
                        defaultTransform={draft}
                        isPreview={isPreview}
                        hasOverride={hasOverride}
                        onSelect={() => setPreviewAssetId(a.id)}
                        onChanged={onChanged}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </main>
  )
}

function InteractiveLayer({
  asset,
  transform,
  naturalSize,
  blend,
  onDragStart,
  onResizeStart,
  badge,
  zIndex = 2,
  colors,
  hideHandles,
}: {
  asset: Asset
  transform: Transform
  naturalSize: { w: number; h: number }
  blend?: string
  onDragStart: (e: React.PointerEvent) => void
  onResizeStart: (e: React.PointerEvent) => void
  badge?: string
  zIndex?: number
  colors?: Record<string, string> | null
  hideHandles?: boolean
}) {
  const rawUrl = publicUrl(asset.storage_path, asset.storage_provider)
  const resolvedSrc = useAssetSrc(rawUrl, colors)
  const src = resolvedSrc ?? rawUrl
  const wPct = (naturalSize.w * transform.scale) / CANVAS * 100
  const hPct = (naturalSize.h * transform.scale) / CANVAS * 100
  const leftPct = ((CANVAS - naturalSize.w * transform.scale) / 2 + transform.offset_x) / CANVAS * 100
  const topPct = ((CANVAS - naturalSize.h * transform.scale) / 2 + transform.offset_y) / CANVAS * 100
  return (
    <div
      style={{
        zIndex,
        position: "absolute",
        left: `${leftPct}%`,
        top: `${topPct}%`,
        width: `${wPct}%`,
        height: `${hPct}%`,
      }}
      className="group"
    >
      <img
        src={src}
        alt=""
        draggable={false}
        onPointerDown={hideHandles ? undefined : onDragStart}
        style={{
          mixBlendMode: blend as any,
          cursor: hideHandles ? "default" : "move",
          pointerEvents: hideHandles ? "none" : undefined,
        }}
        className={`absolute inset-0 h-full w-full select-none ${hideHandles ? "" : "outline outline-1 outline-foreground/40 hover:outline-foreground"}`}
      />
      {!hideHandles && (
        <button
          onPointerDown={onResizeStart}
          title="Drag to scale"
          className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-nwse-resize border border-foreground bg-background"
        />
      )}
      {badge && !hideHandles && (
        <span className="absolute -top-6 left-0 whitespace-nowrap border border-border bg-background px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
          {badge}
        </span>
      )}
    </div>
  )
}

function TransformEditor({ value, onChange }: { value: Transform; onChange: (t: Transform) => void }) {
  const [preciseScale, setPreciseScale] = useState(false)
  return (
    <div className="space-y-4">
      <NumberRow
        label="Offset X"
        value={value.offset_x}
        min={-500}
        max={500}
        step={1}
        onChange={(v) => onChange({ ...value, offset_x: v })}
      />
      <NumberRow
        label="Offset Y"
        value={value.offset_y}
        min={-500}
        max={500}
        step={1}
        onChange={(v) => onChange({ ...value, offset_y: v })}
      />
      <NumberRow
        label="Scale"
        value={value.scale}
        min={0.1}
        max={3}
        step={preciseScale ? 0.001 : 0.01}
        decimals={preciseScale ? 3 : 2}
        onChange={(v) => onChange({ ...value, scale: v })}
      />
      <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        <Checkbox
          checked={preciseScale}
          onCheckedChange={(v) => setPreciseScale(v === true)}
        />
        Precise scaling (3 decimals)
      </label>
    </div>
  )
}

function NumberRow({
  label,
  value,
  min,
  max,
  step,
  decimals = 0,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  decimals?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</Label>
        <Input
          type="number"
          value={decimals ? value.toFixed(decimals) : value}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            if (!Number.isNaN(v)) onChange(v)
          }}
          className="h-7 w-24 rounded-none text-right text-xs"
          step={step}
        />
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(vs) => onChange(vs[0])}
      />
    </div>
  )
}

function AssetOverrideCard({
  asset,
  bodyId,
  defaultTransform,
  isPreview,
  hasOverride,
  onSelect,
  onChanged,
}: {
  asset: Asset
  bodyId: string | null
  defaultTransform: Transform
  isPreview: boolean
  hasOverride: boolean
  onSelect: () => void
  onChanged: () => Promise<void> | void
}) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)

  async function update(patch: { offset_x?: number | null; offset_y?: number | null; scale?: number | null }) {
    setBusy(true)
    try {
      await updateAssetTransform(asset.id, patch)
      await onChanged()
    } catch (err: any) {
      toast.error(err.message ?? "Save failed.")
    } finally {
      setBusy(false)
    }
  }

  async function clearAll() {
    await update({ offset_x: null, offset_y: null, scale: null })
    toast.success("Override cleared.")
  }

  const effX = asset.offset_x ?? defaultTransform.offset_x
  const effY = asset.offset_y ?? defaultTransform.offset_y
  const effS = asset.scale ?? defaultTransform.scale

  return (
    <div className={`border p-3 ${isPreview ? "border-foreground" : "border-border"}`}>
      <div className="flex items-center gap-3">
        <button
          onClick={onSelect}
          className="relative h-14 w-14 flex-shrink-0 border border-border bg-[#fbf7f1]"
          title="Preview this asset"
        >
          <img
            src={publicUrl(asset.storage_path, asset.storage_provider)}
            alt=""
            className="absolute inset-0 h-full w-full object-contain"
          />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{asset.label}</p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {hasOverride ? "Override" : "Inherits default"}
          </p>
        </div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Close" : "Edit"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <OverrideField
            label="Offset X"
            effective={effX}
            override={asset.offset_x}
            onSet={(v) => update({ offset_x: v })}
            disabled={busy || !bodyId}
          />
          <OverrideField
            label="Offset Y"
            effective={effY}
            override={asset.offset_y}
            onSet={(v) => update({ offset_y: v })}
            disabled={busy || !bodyId}
          />
          <OverrideField
            label="Scale"
            effective={effS}
            override={asset.scale}
            decimals={2}
            step={0.01}
            onSet={(v) => update({ scale: v })}
            disabled={busy || !bodyId}
          />
          {hasOverride && (
            <Button
              type="button"
              variant="ghost"
              onClick={clearAll}
              disabled={busy}
              className="rounded-none uppercase text-xs tracking-[0.2em]"
            >
              Clear overrides
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function ExpressionColorCard({
  asset,
  headId,
  isPreview,
  draftColors,
  savedColors,
  draftLabels,
  savedLabels,
  groupSize,
  onSelect,
  onExpandChange,
  onDraftChange,
  onLabelsChange,
  onSave,
  onApplyToGroup,
  onClear,
}: {
  asset: Asset
  headId: string | null
  isPreview: boolean
  draftColors?: Record<string, string>
  savedColors?: Record<string, string>
  draftLabels?: Record<string, string>
  savedLabels?: Record<string, string>
  groupSize: number
  onSelect: () => void
  onExpandChange?: (expanded: boolean) => void
  onDraftChange: (c: Record<string, string>) => void
  onLabelsChange: (l: Record<string, string>) => void
  onSave: (c: Record<string, string>, l: Record<string, string>) => Promise<void> | void
  onApplyToGroup: (c: Record<string, string>, l: Record<string, string>) => Promise<void> | void
  onClear: () => Promise<void> | void
}) {
  const [expanded, setExpanded] = useState(false)
  const [applyingAll, setApplyingAll] = useState(false)
  const expandRef = useRef(onExpandChange)
  expandRef.current = onExpandChange
  useEffect(() => {
    expandRef.current?.(expanded)
    return () => { expandRef.current?.(false) }
  }, [expanded])
  const [slots, setSlots] = useState<{ id: string; defaultFill: string; displayName: string; synthetic: boolean }[]>([])
  const [saving, setSaving] = useState(false)
  const url = publicUrl(asset.storage_path, asset.storage_provider)

  useEffect(() => {
    let cancelled = false
    fetchSvgText(url)
      .then((t) => { if (!cancelled) setSlots(parseSvg(t).slots) })
      .catch(() => { if (!cancelled) setSlots([]) })
    return () => { cancelled = true }
  }, [url])

  const effectiveColors = useMemo<Record<string, string>>(() => {
    return { ...(savedColors ?? {}), ...(draftColors ?? {}) }
  }, [savedColors, draftColors])
  const effectiveLabels = useMemo<Record<string, string>>(() => {
    return { ...(savedLabels ?? {}), ...(draftLabels ?? {}) }
  }, [savedLabels, draftLabels])

  const thumbSrc = useAssetSrc(url, effectiveColors)
  const isDirty = draftColors != null || draftLabels != null
  const hasSaved = (!!savedColors && Object.keys(savedColors).length > 0) ||
    (!!savedLabels && Object.keys(savedLabels).length > 0)

  function setSlotColor(id: string, value: string) {
    const base = draftColors ?? savedColors ?? {}
    onDraftChange({ ...base, [id]: value })
  }

  function resetSlot(id: string) {
    const base = { ...(draftColors ?? savedColors ?? {}) }
    delete base[id]
    onDraftChange(base)
  }

  function setSlotLabel(id: string, value: string) {
    const base = { ...(draftLabels ?? savedLabels ?? {}) }
    const trimmed = value.trim()
    if (!trimmed) delete base[id]
    else base[id] = trimmed
    onLabelsChange(base)
  }

  async function handleSave() {
    if (!isDirty) return
    setSaving(true)
    try {
      await onSave(effectiveColors, effectiveLabels)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`border p-3 ${isPreview ? "border-foreground" : "border-border"}`}>
      <div className="flex items-center gap-3">
        <button
          onClick={onSelect}
          className="relative h-14 w-14 flex-shrink-0 border border-border bg-[#fbf7f1]"
          title="Preview this expression"
        >
          {thumbSrc && (
            <img src={thumbSrc} alt="" className="absolute inset-0 h-full w-full object-contain" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{asset.label}</p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {hasSaved ? "Custom colors" : "Inherits default"}
          </p>
        </div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
          disabled={!headId}
          title={!headId ? "Select a head first" : undefined}
        >
          {expanded ? "Close" : "Edit"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {!headId ? (
            <p className="text-[10px] text-muted-foreground">Select a head on the left to edit colors.</p>
          ) : slots.length === 0 ? (
            <p className="text-[10px] text-muted-foreground">
              No tintable shapes detected in this SVG.
            </p>
          ) : (
            <>
              {slots.some((s) => s.synthetic) && (
                <p className="text-[10px] text-muted-foreground">
                  Slots are grouped by color. Add <code>id</code> attributes to shapes in the SVG for per-shape control.
                </p>
              )}
              {slots.map((s) => {
                const current = effectiveColors[s.id] ?? s.defaultFill
                const customLabel = effectiveLabels[s.id] ?? ""
                const isOverridden = effectiveColors[s.id] != null
                return (
                  <ColorSlotRow
                    key={s.id}
                    slotId={s.displayName}
                    customLabel={customLabel}
                    value={current}
                    isOverridden={isOverridden}
                    onColorChange={(v) => setSlotColor(s.id, v)}
                    onLabelChange={(v) => setSlotLabel(s.id, v)}
                    onReset={() => resetSlot(s.id)}
                  />
                )
              })}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  onClick={handleSave}
                  disabled={!isDirty || saving}
                  className="rounded-none uppercase text-xs tracking-[0.2em]"
                >
                  {saving ? "Saving..." : "Save colors"}
                </Button>
                {groupSize > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={applyingAll || (Object.keys(effectiveColors).length === 0 && Object.keys(effectiveLabels).length === 0)}
                    onClick={async () => {
                      setApplyingAll(true)
                      try {
                        await onApplyToGroup(effectiveColors, effectiveLabels)
                      } finally {
                        setApplyingAll(false)
                      }
                    }}
                    className="rounded-none uppercase text-xs tracking-[0.2em]"
                    title="Apply these colors to every head with the same body parameters"
                  >
                    {applyingAll ? "Applying..." : `Apply to all heads (${groupSize})`}
                  </Button>
                )}
                {hasSaved && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={onClear}
                    className="rounded-none uppercase text-xs tracking-[0.2em]"
                  >
                    <RotateCcw className="mr-1 h-3 w-3" /> Clear
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ColorSlotRow({
  slotId,
  customLabel,
  value,
  isOverridden,
  onColorChange,
  onLabelChange,
  onReset,
}: {
  slotId: string
  customLabel: string
  value: string
  isOverridden: boolean
  onColorChange: (v: string) => void
  onLabelChange: (v: string) => void
  onReset: () => void
}) {
  const [hex, setHex] = useState(value)
  const [labelText, setLabelText] = useState(customLabel)
  const [editingLabel, setEditingLabel] = useState(false)
  const pickerRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { setHex(value) }, [value])
  useEffect(() => { setLabelText(customLabel) }, [customLabel])

  function commitHex(v: string) {
    const trimmed = v.trim()
    if (!trimmed) { setHex(value); return }
    const normalized = trimmed.startsWith("#") ? trimmed : `#${trimmed}`
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) onColorChange(normalized.toUpperCase())
    else setHex(value)
  }

  function commitLabel() {
    setEditingLabel(false)
    if (labelText === customLabel) return
    onLabelChange(labelText)
  }

  const pickerValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : "#000000"
  const displayLabel = customLabel || slotId

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {editingLabel ? (
          <Input
            autoFocus
            value={labelText}
            onChange={(e) => setLabelText(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur()
              if (e.key === "Escape") { setLabelText(customLabel); setEditingLabel(false) }
            }}
            placeholder={slotId}
            className="h-6 w-full rounded-none text-[10px] uppercase tracking-[0.2em]"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingLabel(true)}
            className="group flex min-w-0 items-center gap-1 text-left text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
            title={customLabel ? `Renamed from "${slotId}"` : "Rename this slot"}
          >
            <span className="truncate">{displayLabel}</span>
            <Pencil className="h-2.5 w-2.5 opacity-0 transition group-hover:opacity-70" />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {isOverridden && (
          <button
            type="button"
            onClick={onReset}
            className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
            title="Reset to SVG default"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
        <Input
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          onBlur={() => commitHex(hex)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
          className="h-7 w-24 rounded-none text-right font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => pickerRef.current?.click()}
          className="h-7 w-7 flex-shrink-0 border border-border"
          style={{ background: value }}
          title="Pick color"
          aria-label={`Pick color for ${displayLabel}`}
        />
        <input
          ref={pickerRef}
          type="color"
          value={pickerValue}
          onInput={(e) => onColorChange((e.target as HTMLInputElement).value.toUpperCase())}
          onChange={(e) => onColorChange(e.target.value.toUpperCase())}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}

function OverrideField({
  label,
  effective,
  override,
  decimals = 0,
  step = 1,
  onSet,
  disabled,
}: {
  label: string
  effective: number
  override: number | null
  decimals?: number
  step?: number
  onSet: (v: number | null) => void
  disabled?: boolean
}) {
  const [text, setText] = useState<string>(override != null ? (decimals ? override.toFixed(decimals) : String(override)) : "")
  useEffect(() => {
    setText(override != null ? (decimals ? override.toFixed(decimals) : String(override)) : "")
  }, [override, decimals])

  function commit() {
    if (text.trim() === "") {
      if (override != null) onSet(null)
      return
    }
    const v = parseFloat(text)
    if (!Number.isNaN(v) && v !== override) onSet(v)
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">eff {decimals ? effective.toFixed(decimals) : effective}</span>
        <Input
          type="number"
          value={text}
          step={step}
          placeholder="inherit"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
          disabled={disabled}
          className="h-7 w-24 rounded-none text-right text-xs"
        />
      </div>
    </div>
  )
}
