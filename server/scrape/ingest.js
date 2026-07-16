const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

// Disable libvips's internal cache and cap it to one operation at a time —
// on a 1GB Pi we cannot afford either a resize cache or concurrent decodes.
sharp.cache(false);
sharp.concurrency(1);

// Instaloader's default filename pattern is "{date_utc}_UTC[...]", e.g.
// "2024-01-01_12-00-00_UTC.jpg". That's all the date info this game needs.
const FILENAME_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})_\d{2}-\d{2}-\d{2}_UTC/;
const IMAGE_EXT_RE = /\.(jpe?g|png|webp)$/i;

function parseDateFromFilename(filename) {
  const m = filename.match(FILENAME_DATE_RE);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo}-${d}`;
}

async function readManifest(dir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8"));
  } catch {
    return [];
  }
}

async function writeManifest(dir, manifest) {
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
}

// Processes every raw image strictly one at a time: resize -> write -> delete
// the source -> append to the manifest, before moving to the next file. This
// is what keeps peak memory to roughly one image's worth of working set,
// regardless of how many photos the account has.
async function ingestSession(dir, { onProgress } = {}) {
  const rawDir = path.join(dir, "raw");
  const photosDir = path.join(dir, "photos");
  await fs.mkdir(photosDir, { recursive: true });

  const manifest = await readManifest(dir);

  const entries = await fs.readdir(rawDir, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((e) => e.isFile() && IMAGE_EXT_RE.test(e.name)).map((e) => e.name);

  let resized = 0;
  for (const filename of files) {
    const isoDate = parseDateFromFilename(filename);
    const rawPath = path.join(rawDir, filename);

    if (!isoDate) {
      // Can't place this photo on the timeline — drop it rather than guess.
      await fs.rm(rawPath, { force: true });
      continue;
    }

    const photoId = crypto.randomBytes(8).toString("hex");
    const outPath = path.join(photosDir, `${photoId}.jpg`);

    await sharp(rawPath)
      .rotate()
      .resize({ width: 500, height: 500, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toFile(outPath);

    await fs.rm(rawPath, { force: true });

    manifest.push({ photoId, isoDate });
    resized += 1;
    if (onProgress) onProgress({ resized });
  }

  await writeManifest(dir, manifest);
  return manifest;
}

async function clearRaw(dir) {
  const rawDir = path.join(dir, "raw");
  await fs.rm(rawDir, { recursive: true, force: true });
  await fs.mkdir(rawDir, { recursive: true });
}

module.exports = { ingestSession, clearRaw, readManifest };
