import { Octokit } from "@octokit/rest";

export interface CommitInfo {
  sha: string;
  message: string;
  date: string;
  author: string;
}

export interface DiffLine {
  type: "add" | "del" | "context";
  content: string;
}

export interface FileDiffOptions {
  owner: string;
  repo: string;
  base: string;
  head: string;
  path: string;
  token?: string;
}

function createClient(token?: string): Octokit {
  return new Octokit(token ? { auth: token } : {});
}

export async function getFileHistory(
  owner: string,
  repo: string,
  path: string,
  token?: string,
): Promise<CommitInfo[]> {
  const octokit = createClient(token);
  const response = await octokit.repos.listCommits({ owner, repo, path, per_page: 50 });

  return response.data.map((c) => ({
    sha: c.sha,
    message: c.commit.message.split("\n")[0] ?? "",
    date: c.commit.author?.date ?? "",
    author: c.commit.author?.name ?? "unknown",
  }));
}

export async function getFileDiff(
  options: FileDiffOptions,
): Promise<DiffLine[] | null> {
  try {
    const octokit = createClient(options.token);
    const response = await octokit.repos.compareCommits({
      owner: options.owner,
      repo: options.repo,
      base: options.base,
      head: options.head,
      mediaType: { format: "diff" },
    });

    const files = response.data.files ?? [];
    const file = files.find((f) => f.filename === options.path);
    if (!file?.patch) return [];

    return file.patch.split("\n").map((line) => {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        return { type: "add", content: line.slice(1) };
      }
      if (line.startsWith("-") && !line.startsWith("---")) {
        return { type: "del", content: line.slice(1) };
      }
      return { type: "context", content: line };
    });
  } catch {
    return null;
  }
}

export interface ReleaseTag {
  name: string;
  date: string;
}

export async function getReleaseTags(
  owner: string,
  repo: string,
  token?: string,
): Promise<ReleaseTag[]> {
  const octokit = createClient(token);
  const response = await octokit.repos.listTags({ owner, repo, per_page: 100 });

  const parseTag = (name: string): [number, number] => {
    const m = /pl-(\d+)-(\d+)/.exec(name);
    return m && m[1] && m[2] ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [0, 0];
  };

  return response.data
    .filter((t) => t.name.startsWith("pl-"))
    .map((t) => ({ name: t.name, date: "" }))
    .sort((a, b) => {
      const [ac, al] = parseTag(a.name);
      const [bc, bl] = parseTag(b.name);
      return ac !== bc ? ac - bc : al - bl;
    });
}

export async function getFileAtRef(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  token?: string,
): Promise<string | null> {
  try {
    const octokit = createClient(token);
    const response = await octokit.repos.getContent({ owner, repo, path, ref });
    const data = response.data;
    if (Array.isArray(data) || data.type !== "file" || !("content" in data)) {
      return null;
    }
    const decoded = atob(data.content);
    return sanitizeContent(decoded);
  } catch {
    return null;
  }
}

/**
 * Strip HTML tags and dangerous content to prevent XSS.
 * Handles: tags, encoded entities, script/style blocks, event handlers.
 * For untrusted content only — trusted Astro/Svelte output doesn't need this.
 */
export function sanitizeContent(raw: string): string {
  return raw
    // Remove script/style blocks entirely (including content)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // Remove HTML comments (can contain instructions/hidden content)
    .replace(/<!--[\s\S]*?-->/g, "")
    // Remove all HTML tags
    .replace(/<[^>]*>/g, "")
    // Decode common HTML entities
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'").replace(/&#x2F;/g, "/")
    // Re-strip any tags that were hiding inside encoded entities
    .replace(/<[^>]*>/g, "");
}

/** Sanitize Pagefind excerpt HTML — allow only <mark> highlight tags */
export function sanitizeExcerpt(html: string): string {
  // Pagefind wraps matches in <mark> tags — preserve those, strip everything else
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(?!\/?mark[ >])[^>]*>/gi, "");
}

/** Format a pl-* tag name into a human-readable label */
export function formatTagName(tag: string): string {
  // "pl-113-100" → "PL 113-100"
  return tag.replace(/^pl-/, "PL ").replace(/-/g, "-");
}

/** Extract year from a tag name (congress number) or fall back to ISO date string */
export function extractYear(date: string, tagName?: string): string {
  // Derive from congress number in tag name: pl-113-* → 2013-2014
  if (tagName) {
    const match = tagName.match(/pl-(\d+)-/);
    if (match && match[1]) {
      const congress = parseInt(match[1], 10);
      // Congress starts in odd year: 113th = 2013-2014, 114th = 2015-2016, etc.
      const startYear = 2013 + (congress - 113) * 2;
      return `${startYear}`;
    }
  }
  if (!date) return "";
  return new Date(date).getFullYear().toString();
}

export function isRateLimited(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }
  const status = (error as { status: number }).status;
  // GitHub returns 403 for unauthenticated rate limits and 429 for secondary rate limits
  return status === 403 || status === 429;
}
