function authorized(req) {
  const expected = process.env.AEROSFORGE_BRIDGE_TOKEN;
  const auth = req.headers.authorization || "";
  return Boolean(expected) && auth === `Bearer ${expected}`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
  if (!process.env.UPLOAD_POST_API_KEY) return res.status(503).json({ error: "publisher_not_configured" });

  const requestId = String(req.query?.request_id || "");
  const jobId = String(req.query?.job_id || "");
  if (!requestId && !jobId) return res.status(400).json({ error: "request_id_or_job_id_required" });

  const qs = new URLSearchParams(requestId ? { request_id: requestId } : { job_id: jobId });

  try {
    const response = await fetch(`https://api.upload-post.com/api/uploadposts/status?${qs}`, {
      headers: { Authorization: `Apikey ${process.env.UPLOAD_POST_API_KEY}` }
    });
    const payload = await response.json().catch(() => ({}));
    return res.status(response.status).json(payload);
  } catch (error) {
    console.error("publisher_status_error", { message: error?.message });
    return res.status(500).json({ error: "publisher_status_error" });
  }
}
