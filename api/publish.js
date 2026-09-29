import crypto from "node:crypto";

const ALLOWED_PLATFORMS = new Set(["youtube", "facebook", "instagram", "tiktok"]);

function authorized(req) {
  const expected = process.env.AEROSFORGE_BRIDGE_TOKEN;
  const auth = req.headers.authorization || "";
  return Boolean(expected) && auth === `Bearer ${expected}`;
}

function isStagedBlob(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

function stableKey(contentId, platforms) {
  const canonical = `${contentId}:${[...platforms].sort().join(",")}`;
  return "aerosforge-" + crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 40);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
  if (!process.env.UPLOAD_POST_API_KEY) return res.status(503).json({ error: "publisher_not_configured" });

  const body = req.body || {};
  const contentId = String(body.content_id || "");
  const videoUrl = String(body.video_url || "");
  const title = String(body.title || "").slice(0, 2200);
  const description = String(body.description || "").slice(0, 2200);
  const platforms = Array.isArray(body.platforms) ? [...new Set(body.platforms.map(String))] : [];

  if (!/^[A-Za-z0-9_-]{8,100}$/.test(contentId)) return res.status(400).json({ error: "invalid_content_id" });
  if (!isStagedBlob(videoUrl)) return res.status(400).json({ error: "video_url_not_approved_staging_host" });
  if (!platforms.length || platforms.some(p => !ALLOWED_PLATFORMS.has(p))) {
    return res.status(400).json({ error: "invalid_platforms" });
  }

  try {
    const head = await fetch(videoUrl, { method: "HEAD", redirect: "follow" });
    const ct = (head.headers.get("content-type") || "").toLowerCase();
    if (!head.ok || !ct.startsWith("video/mp4")) {
      return res.status(422).json({ error: "staged_media_validation_failed", http_status: head.status, content_type: ct });
    }

    const idempotencyKey = stableKey(contentId, platforms);
    const form = new FormData();
    form.append("user", "default");
    form.append("video", videoUrl);
    form.append("title", title);
    if (description) form.append("description", description);
    form.append("async_upload", "true");
    form.append("external_id", contentId);
    for (const platform of platforms) form.append("platform[]", platform);

    const response = await fetch("https://api.upload-post.com/api/upload", {
      method: "POST",
      headers: {
        Authorization: `Apikey ${process.env.UPLOAD_POST_API_KEY}`,
        "Idempotency-Key": idempotencyKey,
        "X-External-Id": contentId
      },
      body: form
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("publish_submit_failed", { contentId, status: response.status });
      return res.status(response.status).json({ error: "publisher_rejected", publisher: payload });
    }

    return res.status(202).json({
      content_id: contentId,
      state: "submitted",
      idempotency_key: idempotencyKey,
      request_id: payload.request_id || null,
      job_id: payload.job_id || null,
      publisher: payload
    });
  } catch (error) {
    console.error("publish_submit_error", { contentId, message: error?.message });
    return res.status(500).json({ error: "publish_submit_error" });
  }
}
