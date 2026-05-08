import { useSvgAsset } from "@/lib/svg"
import type { CSSProperties, PointerEventHandler } from "react"

interface Props {
  url: string
  colors?: Record<string, string> | null
  className?: string
  style?: CSSProperties
  draggable?: boolean
  onPointerDown?: PointerEventHandler<HTMLImageElement>
  alt?: string
}

export function ExpressionImage({ url, colors, className, style, draggable, onPointerDown, alt }: Props) {
  const { src } = useSvgAsset(url, colors ?? null)
  if (!src) return null
  return (
    <img
      src={src}
      alt={alt ?? ""}
      className={className}
      style={style}
      draggable={draggable}
      onPointerDown={onPointerDown}
    />
  )
}
