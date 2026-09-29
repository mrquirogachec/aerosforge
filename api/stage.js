import { put } from "@vercel/blob";

const MAX_BYTES = 500 * 1024 * 1024;

function authorized(req) {
  const expected = process.env.AEROSFORGE_BRIDGE_TOKEN;
  const auth = req.headers.authorization || "";
  return Boolean(expected) && auth === `Bearer ${expected}`;
}

function safeId(value) {
  return /^[A-Za-z0-9_-]{8,100}$/.test(value || "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });

  const contentId = String(req.headers["x-aerosforge-content-id"] || "");
  if (!safeId(contentId)) return res.status(400).json({ error: "invalid_content_id" });

  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (type !== "video/mp4") return res.status(415).json({ error: "content_type_must_be_video_mp4" });

  const declared = Number(req.headers["content-length"] || 0);
  if (declared && declared > MAX_BYTES) return res.status(413).json({ error: "media_too_large" });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: "staging_not_configured" });
  }

  try {
    const blob = await put(`aerosforge-staging/${contentId}.mp4`, req, {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return res.status(201).json({
      content_id: contentId,
      state: "staged",
      url: blob.url,
      pathname: blob.pathname,
      content_type: "video/mp4"
    });
  } catch (error) {
    console.error("stage_failed", { contentId, message: error?.message });
    return res.status(500).json({ error: "stage_failed" });
  }
}
