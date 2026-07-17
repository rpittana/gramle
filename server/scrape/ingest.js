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
// [{ shortcode, slide, isoDate }] — ONE ENTRY PER PHOTO, not per post. A
// carousel post contributes one entry per non-video slide (all sharing the
// post's single timestamp), so every photo in a multi-photo post is its own
// sampleable unit instead of only ever surfacing the first slide. slide is
// 1-based and matches Instaloader's own sidecar ordering (and therefore its
// filename suffix — see resolveDownloadedFile). A plain single-image post
// is just { slide: 1 }. Video slides are skipped individually rather than
// dropping the whole carousel.
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
      const isoDate = new Date(ts * 1000).toISOString().slice(0, 10);

      const slides = node.edge_sidecar_to_children?.edges;
      if (slides && slides.length > 0) {
        slides.forEach((edge, i) => {
          if (edge?.node?.is_video) return;
          index.push({ shortcode, slide: i + 1, isoDate });
        });
      } else if (!node.is_video) {
        index.push({ shortcode, slide: 1, isoDate });
      }
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

// Instaloader names a single-image post "{shortcode}.ext" (no suffix) and
// carousel slide N as "{shortcode}_N.ext". Try the bare name as slide 1
// FIRST, against the wanted set, before stripping any "_<digits>" suffix —
// otherwise a shortcode that legitimately ends in "_<digits>" of its own
// (rare, but shortcodes can contain underscores) would be misread as a
// slide suffix on a single-image post that never had one.
function resolveDownloadedFile(filename, wanted) {
  const base = filename.replace(IMAGE_EXT_RE, "");

  const bareKey = `${base}:1`;
  if (wanted.has(bareKey)) return { key: bareKey, shortcode: base, slide: 1 };

  const m = base.match(/^(.*)_(\d+)$/);
  if (m) {
    const key = `${m[1]}:${Number(m[2])}`;
    if (wanted.has(key)) return { key, shortcode: m[1], slide: Number(m[2]) };
  }

  return null;
}

// Resizes the on-demand downloads for one game, strictly one file at a time
// (peak memory ≈ one image's working set). downloadPosts fetches ALL slides
// of any matched (filtered-in) post, since Instaloader can't select specific
// slide numbers per post in one run — so most raw files here are slides
// nobody sampled; those are deleted immediately WITHOUT ever going through
// sharp, keeping the wasted work to a disk copy rather than a resize.
// wanted: Map<"shortcode:slide", { isoDate }>. Returns
// [{ photoId, shortcode, slide, isoDate }] for the photos that made it.
async function ingestDownloads(dir, wanted, { onProgress } = {}) {
  const rawDir = path.join(dir, "raw");
  const photosDir = path.join(dir, "photos");
  await fs.mkdir(photosDir, { recursive: true });

  const entries = await fs.readdir(rawDir).catch(() => []);
  const results = [];
  let resized = 0;

  for (const filename of entries.filter((f) => IMAGE_EXT_RE.test(f))) {
    const rawPath = path.join(rawDir, filename);
    const resolved = resolveDownloadedFile(filename, wanted);

    if (!resolved) {
      await fs.rm(rawPath, { force: true });
      continue;
    }

    const entry = wanted.get(resolved.key);
    const photoId = crypto.randomBytes(8).toString("hex");
    await sharp(rawPath)
      .rotate()
      .resize({ width: 500, height: 500, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toFile(path.join(photosDir, `${photoId}.jpg`));
    await fs.rm(rawPath, { force: true });

    results.push({
      photoId,
      shortcode: resolved.shortcode,
      slide: resolved.slide,
      isoDate: entry.isoDate,
    });
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
