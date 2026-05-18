import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.3";
import { AwsClient } from "npm:aws4fetch@1.0.20";

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

    const { data: assets, error: fetchErr } = await supabase
      .from("assets")
      .select("id, storage_path")
      .eq("storage_provider", "supabase")
      .limit(batchSize);

    if (fetchErr) return errorResponse(fetchErr.message, 500);
    if (!assets || assets.length === 0) {
      return jsonResponse({
        message: "No assets left to migrate",
        migrated: 0,
        dry_run: dryRun,
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
      status: "migrated" | "skipped" | "error";
      error?: string;
    }[] = [];

    for (const asset of assets) {
      const key = asset.storage_path;

      if (dryRun) {
        results.push({ id: asset.id, key, status: "skipped" });
        continue;
      }

      try {
        const { data: fileData, error: dlErr } = await supabase.storage
          .from("character-assets")
          .download(key);

        if (dlErr || !fileData) {
          results.push({
            id: asset.id,
            key,
            status: "error",
            error: dlErr?.message || "Download failed",
          });
          continue;
        }

        const ext = key.split(".").pop() || "png";
        const contentType = ext === "svg" ? "image/svg+xml" : `image/${ext}`;

        const putRes = await r2.fetch(`${r2Endpoint}/${key}`, {
          method: "PUT",
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
          },
          body: await fileData.arrayBuffer(),
        });

        if (!putRes.ok) {
          const errText = await putRes.text();
          results.push({ id: asset.id, key, status: "error", error: errText });
          continue;
        }

        const headRes = await r2.fetch(`${r2Endpoint}/${key}`, {
          method: "HEAD",
        });
        if (!headRes.ok) {
          results.push({
            id: asset.id,
            key,
            status: "error",
            error: "HEAD verification failed after upload",
          });
          continue;
        }

        const { error: updateErr } = await supabase
          .from("assets")
          .update({
            storage_provider: "r2",
            updated_at: new Date().toISOString(),
          })
          .eq("id", asset.id);

        if (updateErr) {
          results.push({
            id: asset.id,
            key,
            status: "error",
            error: updateErr.message,
          });
          continue;
        }

        results.push({ id: asset.id, key, status: "migrated" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        results.push({ id: asset.id, key, status: "error", error: msg });
      }
    }

    const migrated = results.filter((r) => r.status === "migrated").length;
    const errors = results.filter((r) => r.status === "error").length;

    return jsonResponse({
      message: `Batch complete: ${migrated} migrated, ${errors} errors`,
      total: assets.length,
      migrated,
      errors,
      dry_run: dryRun,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return errorResponse(message, 500);
  }
});
