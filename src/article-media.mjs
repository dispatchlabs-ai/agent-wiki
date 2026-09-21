import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { WikiError } from "./errors.mjs";

export const articleMediaPattern =
  /^\/article-media\/([a-f0-9]{64}\.(?:png|jpg|jpeg|gif|webp|pdf))$/;

const formats = {
  png: {
    type: "image/png",
    valid: (head) =>
      head.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  },
  jpg: {
    type: "image/jpeg",
    valid: (head) => head.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")),
  },
  jpeg: {
    type: "image/jpeg",
    valid: (head) => head.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")),
  },
  gif: {
    type: "image/gif",
    valid: (head) =>
      ["GIF87a", "GIF89a"].includes(head.subarray(0, 6).toString()),
  },
  webp: {
    type: "image/webp",
    valid: (head) =>
      head.subarray(0, 4).toString() === "RIFF" &&
      head.subarray(8, 12).toString() === "WEBP",
  },
  pdf: {
    type: "application/pdf",
    valid: (head) => head.subarray(0, 5).toString() === "%PDF-",
  },
};

const notFound = () => new WikiError("NOT_FOUND", "Not found", 404);
const sha256File = async (filename) => {
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(filename), hash);
  return hash.digest("hex");
};
const formatFor = (asset) => formats[path.extname(asset).slice(1)];
const safeText = (value, name, maximum = 1000) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw Error(`Invalid ${name}`);
  return value.trim();
};
const validUrl = (value) => {
  if (value === undefined) return undefined;
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error("Invalid source URL");
  return url.href;
};

export async function publishArticleMedia({
  root,
  sourceFile,
  source,
  sourceUrl,
  sourceDate,
  name = path.basename(sourceFile),
  now = new Date(),
}) {
  if (!root || !path.isAbsolute(root))
    throw Error("WIKI_ARTICLE_MEDIA must be a dedicated absolute directory");
  root = path.resolve(root);
  sourceFile = path.resolve(sourceFile || "");
  if (root === path.parse(root).root)
    throw Error("WIKI_ARTICLE_MEDIA must be a dedicated absolute directory");
  const extension = path.extname(sourceFile).slice(1).toLowerCase();
  const format = formats[extension];
  if (!format) throw Error("Publish a PNG, JPEG, GIF, WebP, or PDF file");
  const handle = await fs.promises.open(sourceFile, "r");
  let stat, head;
  try {
    stat = await handle.stat();
    if (!stat.isFile() || stat.size < 5)
      throw Error("Source must be a nonempty regular file");
    head = Buffer.alloc(Math.min(16, stat.size));
    await handle.read(head, 0, head.length, 0);
  } finally {
    await handle.close();
  }
  if (!format.valid(head)) throw Error(`File bytes do not match .${extension}`);
  const hash = await sha256File(sourceFile);
  const asset = `${hash}.${extension}`;
  const metadata = {
    version: 1,
    asset,
    sha256: hash,
    media_type: format.type,
    size: stat.size,
    name: safeText(name, "name", 240),
    provenance: {
      source: safeText(source, "source"),
      ...(sourceUrl === undefined ? {} : { url: validUrl(sourceUrl) }),
      ...(sourceDate === undefined
        ? {}
        : { date: new Date(sourceDate).toISOString() }),
    },
    published_at: new Date(now).toISOString(),
  };
  if (Number.isNaN(Date.parse(metadata.published_at)))
    throw Error("Invalid publication date");
  if (metadata.provenance.date === "Invalid Date")
    throw Error("Invalid source date");
  const assets = path.join(root, "assets");
  const manifests = path.join(root, "manifests");
  await fs.promises.mkdir(assets, { recursive: true, mode: 0o700 });
  await fs.promises.mkdir(manifests, { recursive: true, mode: 0o700 });
  const target = path.join(assets, asset);
  const manifest = path.join(manifests, asset + ".json");
  const temporary = path.join(root, `.publish-${randomUUID()}`);
  try {
    await fs.promises.copyFile(
      sourceFile,
      temporary,
      fs.constants.COPYFILE_EXCL,
    );
    await fs.promises.chmod(temporary, 0o400);
    if ((await sha256File(temporary)) !== hash)
      throw Error("Source changed during publication");
    try {
      await fs.promises.copyFile(temporary, target, fs.constants.COPYFILE_EXCL);
      await fs.promises.chmod(target, 0o400);
    } catch (error) {
      if (error.code !== "EEXIST" || (await sha256File(target)) !== hash)
        throw error;
    }
    const serialized = JSON.stringify(metadata, null, 2) + "\n";
    try {
      await fs.promises.writeFile(manifest, serialized, {
        flag: "wx",
        mode: 0o400,
      });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = JSON.parse(await fs.promises.readFile(manifest, "utf8"));
      const comparable = { ...existing, published_at: metadata.published_at };
      if (JSON.stringify(comparable) !== JSON.stringify(metadata))
        throw Error("Asset already has different publication provenance");
    }
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
  return { asset, url: `/article-media/${asset}`, manifest: metadata };
}

function rangeFor(header, size) {
  if (header === undefined) return { status: 200, start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) {
    const length = Number(match[2]);
    if (!Number.isSafeInteger(length) || length <= 0) return null;
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  }
  if (start >= size || end < start) return null;
  return { status: 206, start, end: Math.min(end, size - 1) };
}

export class ArticleMediaStore {
  constructor(root) {
    this.root = root ? path.resolve(root) : null;
  }
  static asset(pathname) {
    return articleMediaPattern.exec(pathname)?.[1] || null;
  }
  async open(asset, rangeHeader) {
    if (!this.root || !articleMediaPattern.test(`/article-media/${asset}`))
      throw notFound();
    const format = formatFor(asset);
    const hash = asset.slice(0, 64);
    try {
      const manifest = JSON.parse(
        await fs.promises.readFile(
          path.join(this.root, "manifests", asset + ".json"),
          "utf8",
        ),
      );
      if (
        manifest?.version !== 1 ||
        manifest.asset !== asset ||
        manifest.sha256 !== hash ||
        manifest.media_type !== format.type ||
        !Number.isSafeInteger(manifest.size) ||
        manifest.size < 5 ||
        typeof manifest.provenance?.source !== "string"
      )
        throw notFound();
      const filename = path.join(this.root, "assets", asset);
      const handle = await fs.promises.open(filename, "r");
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size !== manifest.size) throw notFound();
        const digest = createHash("sha256");
        await pipeline(
          handle.createReadStream({
            autoClose: false,
            start: 0,
            end: stat.size - 1,
          }),
          digest,
        );
        if (digest.digest("hex") !== hash) throw notFound();
        const range = rangeFor(rangeHeader, stat.size);
        if (!range)
          return {
            status: 416,
            headers: { "Content-Range": `bytes */${stat.size}` },
            close: () => handle.close(),
          };
        return {
          status: range.status,
          headers: {
            "Content-Type": format.type,
            "Content-Length": range.end - range.start + 1,
            "Accept-Ranges": "bytes",
            ...(range.status === 206
              ? {
                  "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
                }
              : {}),
          },
          stream: handle.createReadStream({
            autoClose: false,
            start: range.start,
            end: range.end,
          }),
          close: () => handle.close(),
        };
      } catch (error) {
        await handle.close();
        throw error;
      }
    } catch (error) {
      if (error instanceof WikiError) throw error;
      throw notFound();
    }
  }
}
