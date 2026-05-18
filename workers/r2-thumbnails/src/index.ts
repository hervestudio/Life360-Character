import { createClient } from "@supabase/supabase-js";

interface Env {
  BUCKET: R2Bucket;
  IMAGES: {
    input(stream: ReadableStream): ImageTransformationBuilder;
  };
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

interface ImageTransformationBuilder {
  transform(options: { width?: number; height?: number; fit?: string }): ImageTransformationBuilder;
  output(options: { format: string; quality?: number }): Promise<{ response(): Response }>;
}

interface RequestBody {
  dry_run?: boolean;
  batch_size?: number;
  width?: number;
  quality?: number;
}

interface ResultItem {
  id: string;
  key: string;
  thumbnail_key: string;
  status: "generated" | "skipped" | "error";
  error?: string;
}

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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    try {
      const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

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

      const body: RequestBody = await req.json().catch(() => ({}));
      const dryRun = body.dry_run === true;
      const batchSize = Math.min(body.batch_size || 20, 50);
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

      const results: ResultItem[] = [];

      for (const asset of assets) {
        const key = asset.storage_path;
        const pathWithoutExt = key.replace(/\.[^.]+$/, "");
        const thumbnailKey = `thumbnails/${pathWithoutExt}.webp`;

        if (dryRun) {
          results.push({ id: asset.id, key, thumbnail_key: thumbnailKey, status: "skipped" });
          continue;
        }

        try {
          const obj = await env.BUCKET.get(key);
          if (!obj) {
            results.push({
              id: asset.id,
              key,
              thumbnail_key: thumbnailKey,
              status: "error",
              error: "Object not found in R2",
            });
            continue;
          }

          const transformed = await env.IMAGES.input(obj.body)
            .transform({ width, fit: "scale-down" })
            .output({ format: "image/webp", quality });

          const webpResponse = transformed.response();
          const webpBuffer = await webpResponse.arrayBuffer();

          await env.BUCKET.put(thumbnailKey, webpBuffer, {
            httpMetadata: {
              contentType: "image/webp",
              cacheControl: "public, max-age=31536000, immutable",
            },
          });

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

          results.push({ id: asset.id, key, thumbnail_key: thumbnailKey, status: "generated" });
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
  },
};
