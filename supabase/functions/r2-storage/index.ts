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

async function isAdmin(authHeader: string): Promise<boolean> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
  } = await supabase.auth.getUser(token);
  if (!user) return false;
  const { data } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return !!data;
}

function getR2Client(): AwsClient {
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID")!;
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY")!;
  return new AwsClient({ accessKeyId, secretAccessKey, service: "s3" });
}

function getR2Endpoint(): string {
  const accountId = Deno.env.get("R2_ACCOUNT_ID")!;
  const bucket = Deno.env.get("R2_BUCKET") || "character-assets";
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "read" && req.method === "GET") {
      const key = url.searchParams.get("key");
      if (!key) {
        return errorResponse("Missing key parameter");
      }
      const r2 = getR2Client();
      const endpoint = getR2Endpoint();
      const getRes = await r2.fetch(`${endpoint}/${key}`, { method: "GET" });
      if (!getRes.ok) {
        return errorResponse(`R2 GET failed: ${getRes.status}`, 502);
      }
      const contentType = getRes.headers.get("Content-Type") || "application/octet-stream";
      const body = await getRes.arrayBuffer();
      return new Response(body, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) {
      return errorResponse("Missing authorization", 401);
    }

    const admin = await isAdmin(authHeader);
    if (!admin) {
      return errorResponse("Forbidden: admin access required", 403);
    }

    if (action === "upload" && req.method === "POST") {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const key = formData.get("key") as string | null;
      const contentType =
        (formData.get("contentType") as string) || "image/png";

      if (!file || !key) {
        return errorResponse("Missing file or key");
      }

      const r2 = getR2Client();
      const endpoint = getR2Endpoint();
      const arrayBuffer = await file.arrayBuffer();

      const putRes = await r2.fetch(`${endpoint}/${key}`, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
        body: arrayBuffer,
      });

      if (!putRes.ok) {
        const text = await putRes.text();
        return errorResponse(`R2 PUT failed: ${text}`, 502);
      }

      return jsonResponse({ success: true, key });
    }

    if (action === "delete" && req.method === "POST") {
      const body = await req.json();
      const keys: string[] = body.keys;

      if (!keys || !Array.isArray(keys) || keys.length === 0) {
        return errorResponse("Missing keys array");
      }

      const r2 = getR2Client();
      const endpoint = getR2Endpoint();
      const results: { key: string; ok: boolean }[] = [];

      for (const key of keys) {
        const delRes = await r2.fetch(`${endpoint}/${key}`, {
          method: "DELETE",
        });
        results.push({ key, ok: delRes.ok });
      }

      return jsonResponse({ success: true, results });
    }

    return errorResponse(
      "Invalid action. Use ?action=read, ?action=upload, or ?action=delete",
      400
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return errorResponse(message, 500);
  }
});
