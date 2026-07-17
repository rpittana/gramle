const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

// Disable libvips's internal cache and cap it to one operation at a time —
// on a 1GB Pi we cannot afford either a resize cache or concurrent decodes.
sharp.cache(false);
sharp.concurrency(1);

const IMAGE_EXT_RE = /\.(jpe?g|png|webp)$/i;
const JSON_EXT_RE = /\.json$/i;

// Turns the raw per-post metadata files from indexProfile into index.json:
// [{ shortcode, isoDate }], newest first as Instaloader emits them. Videos
// are dropped here; for carousels, a carousel whose FIRST slide is a video
// is also dropped, because downloadPosts (--slide 1) would fetch that video
// and there'd be no image to play.
async function parseIndex(dir) {
  const rawDir = path.join(dir, "raw");
  const entries = await fs.readdir(rawDir).catch(() => []);
  const index = [];

  for (const filename of entries.filter((f) => JSON_EXT_RE.test(f))) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(rawDir, filename), "utf8"));
      const node = data.node ?? data;
      const shortcode = node.shortcode;
      const ts = node.taken_at_timestamp ?? node.date;
      if (!shortcode || !ts) continue;
      if (node.is_video) continue;
      const firstChild = node.edge_sidecar_to_children?.edges?.[0]?.node;
      if (firstChild?.is_video) continue;
      index.push({ shortcode, isoDate: new Date(ts * 1000).toISOString().slice(0, 10) });
    } catch {
      // Unparseable metadata for one post shouldn't sink the whole index.
    }
  }

  await fs.writeFile(path.join(dir, "index.json"), JSON.stringify(index));
  return index;
}

async function readIndex(dir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, "index.json"), "utf8"));
  } catch {
    return [];
  }
}

// The prep phase needs the profile's username to re-walk its timeline (see
// instaloader.downloadPosts), but only index.json (posts) survives between
// the index and prep phases in the session directory — so stash it alongside.
async function writeMeta(dir, meta) {
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta));
}

async function readMeta(dir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8"));
  } catch {
    return {};
  }
}

// Resizes the on-demand downloads for one game, strictly one file at a time
// (peak memory ≈ one image's working set). Files are named {shortcode}.jpg,
// or {shortcode}_1.jpg for carousels — try the exact name first so a
// shortcode that legitimately ends in "_1" isn't mangled by suffix-stripping.
// Returns [{ photoId, shortcode, isoDate }] for the photos that made it.
async function ingestDownloads(dir, indexByShortcode, { onProgress } = {}) {
  const rawDir = path.join(dir, "raw");
  const photosDir = path.join(dir, "photos");
  await fs.mkdir(photosDir, { recursive: true });

  const entries = await fs.readdir(rawDir).catch(() => []);
  const results = [];
  let resized = 0;

  for (const filename of entries.filter((f) => IMAGE_EXT_RE.test(f))) {
    const rawPath = path.join(rawDir, filename);
    const base = filename.replace(IMAGE_EXT_RE, "");
    const shortcode = indexByShortcode.has(base) ? base : base.replace(/_\d+$/, "");
    const entry = indexByShortcode.get(shortcode);

    if (!entry) {
      await fs.rm(rawPath, { force: true });
      continue;
    }

    const photoId = crypto.randomBytes(8).toString("hex");
    await sharp(rawPath)
      .rotate()
      .resize({ width: 500, height: 500, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toFile(path.join(photosDir, `${photoId}.jpg`));
    await fs.rm(rawPath, { force: true });

    results.push({ photoId, shortcode, isoDate: entry.isoDate });
    resized += 1;
    if (onProgress) onProgress({ resized });
  }

  return results;
}

async function clearRaw(dir) {
  const rawDir = path.join(dir, "raw");
  await fs.rm(rawDir, { recursive: true, force: true });
  await fs.mkdir(rawDir, { recursive: true });
}

module.exports = { parseIndex, readIndex, writeMeta, readMeta, ingestDownloads, clearRaw };
