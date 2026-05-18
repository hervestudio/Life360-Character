import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.3";
import { AwsClient } from "npm:aws4fetch@1.0.20";
import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
  MagickGeometry,
} from "npm:@imagemagick/magick-wasm@0.0.30";

const wasmBytes = await Deno.readFile(
  new URL(
    "magick.wasm",
    import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.30")
  )
);
await initializeImageMagick(wasmBytes);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) {
      return errorResponse("Missing authorization", 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
    } = await supabase.auth.getUser(token);
    if (!user) return errorResponse("Unauthorized", 401);
    const { data: adminRow } = await supabase
      .from("admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!adminRow) return errorResponse("Forbidden: admin only", 403);

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const batchSize = Math.min(body.batch_size || 50, 200);
    const width = body.width || 512;
    const quality = body.quality || 80;

    const { data: assets, error: fetchErr } = await supabase
      .from("assets")
      .select("id, storage_path, storage_provider")
      .is("thumbnail_path", null)
      .eq("storage_provider", "r2")
      .not("storage_path", "ilike", "%.svg")
      .limit(batchSize);

    if (fetchErr) return errorResponse(fetchErr.message, 500);
    if (!assets || assets.length === 0) {
      return jsonResponse({
        message: "No assets left to generate thumbnails for",
        total: 0,
        generated: 0,
        errors: 0,
        dry_run: dryRun,
        results: [],
      });
    }

    const accountId = Deno.env.get("R2_ACCOUNT_ID")!;
    const bucket = Deno.env.get("R2_BUCKET") || "character-assets";
    const r2Endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
    const r2 = new AwsClient({
      accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID")!,
      secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY")!,
      service: "s3",
    });

    const results: {
      id: string;
      key: string;
      thumbnail_key: string;
      status: "generated" | "skipped" | "error";
      error?: string;
    }[] = [];

    for (const asset of assets) {
      const key = asset.storage_path;
      const pathWithoutExt = key.replace(/\.[^.]+$/, "");
      const thumbnailKey = `thumbnails/${pathWithoutExt}.webp`;

      if (dryRun) {
        results.push({
          id: asset.id,
          key,
          thumbnail_key: thumbnailKey,
          status: "skipped",
        });
        continue;
      }

      try {
        const getRes = await r2.fetch(`${r2Endpoint}/${key}`, {
          method: "GET",
        });
        if (!getRes.ok) {
          results.push({
            id: asset.id,
            key,
            thumbnail_key: thumbnailKey,
            status: "error",
            error: `Failed to download original (${getRes.status})`,
          });
          continue;
        }

        const originalBuffer = new Uint8Array(await getRes.arrayBuffer());

        const webpBuffer = ImageMagick.read(
          originalBuffer,
          (img): Uint8Array => {
            const geo = new MagickGeometry(width, width);
            geo.ignoreAspectRatio = false;
            geo.greater = true;
            img.resize(geo);
            img.quality = quality;
            return img.write(MagickFormat.Webp, (data) =>
              new Uint8Array(data)
            );
          }
        );

        const putRes = await r2.fetch(`${r2Endpoint}/${thumbnailKey}`, {
          method: "PUT",
          headers: {
            "Content-Type": "image/webp",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
          body: webpBuffer,
        });

        if (!putRes.ok) {
          const errText = await putRes.text();
          results.push({
            id: asset.id,
            key,
            thumbnail_key: thumbnailKey,
            status: "error",
            error: errText,
          });
          continue;
        }

        const headRes = await r2.fetch(`${r2Endpoint}/${thumbnailKey}`, {
          method: "HEAD",
        });
        if (!headRes.ok) {
          results.push({
            id: asset.id,
            key,
            thumbnail_key: thumbnailKey,
            status: "error",
            error: "HEAD verification failed after upload",
          });
          continue;
        }

        const { error: updateErr } = await supabase
          .from("assets")
          .update({
            thumbnail_path: thumbnailKey,
            updated_at: new Date().toISOString(),
          })
          .eq("id", asset.id);

        if (updateErr) {
          results.push({
            id: asset.id,
            key,
            thumbnail_key: thumbnailKey,
            status: "error",
            error: updateErr.message,
          });
          continue;
        }

        results.push({
          id: asset.id,
          key,
          thumbnail_key: thumbnailKey,
          status: "generated",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        results.push({
          id: asset.id,
          key,
          thumbnail_key: thumbnailKey,
          status: "error",
          error: msg,
        });
      }
    }

    const generated = results.filter((r) => r.status === "generated").length;
    const errors = results.filter((r) => r.status === "error").length;

    return jsonResponse({
      message: `Batch complete: ${generated} generated, ${errors} errors`,
      total: assets.length,
      generated,
      errors,
      dry_run: dryRun,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return errorResponse(message, 500);
  }
});
