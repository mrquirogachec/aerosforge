# AEROSFORGE Publishing Bridge

This feature branch adds a server-side bridge for:

Renderer → authenticated MP4 staging → Vercel Blob HTTPS media → Upload-Post → status polling.

## Security

Required environment variables are server-side only:

- `AEROSFORGE_BRIDGE_TOKEN`
- `BLOB_READ_WRITE_TOKEN`
- `UPLOAD_POST_API_KEY`

Never place these values in browser JavaScript, source control, Google Drive notes, or logs.

## Stage

`POST /api/stage`

Headers:

- `Authorization: Bearer <AEROSFORGE_BRIDGE_TOKEN>`
- `Content-Type: video/mp4`
- `X-AEROSFORGE-Content-ID: <stable-content-id>`

Body: raw MP4 bytes.

The endpoint rejects non-MP4 content types, unsafe content IDs, oversized declared payloads, unauthenticated callers, and missing staging configuration.

## Publish

`POST /api/publish`

JSON body:

```json
{
  "content_id": "afcq-2026-09-29-001",
  "video_url": "https://...public.blob.vercel-storage.com/...mp4",
  "title": "Platform title",
  "description": "Caption",
  "platforms": ["youtube", "facebook", "instagram"]
}
```

The publisher validates the staged URL with an HTTP HEAD request and requires `video/mp4`. It submits asynchronously with a deterministic Upload-Post idempotency key, so retrying the same content/platform set does not create a second upload job.

## Status

`GET /api/publish-status?request_id=<id>`

or

`GET /api/publish-status?job_id=<id>`

Treat only terminal Upload-Post results as publication success. Queued, processing, submitted, or staged are not published.

## Deployment gate

Do not deploy this branch until the Vercel connection is authorized to the intended AEROSFORGE team/project. Configure secrets in Vercel environment settings; never commit them.

## Backlog rule

Before submitting any historical content, compare its content ID/title/platform URLs against Upload-Post history. Retry only missing or terminal-failed destinations.
