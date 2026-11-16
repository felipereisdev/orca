import type { PRComment } from '../../shared/github/comments/comment-types'
import type { MRComment } from '../../shared/gitlab/gitlab-types'
import type { JiraComment } from '../../shared/jira/jira-types'
import type { LinearComment } from '../../shared/linear/issue-types'
import { extractLinearInlineMedia } from '../../shared/linear/inline-media'
import type {
  TaskBoardCardRef,
  TaskBoardWireCard
} from '../../shared/task-board/task-board-wire-types'
import type {
  TaskStartContext,
  TaskStartImage
} from '../../shared/task-board/task-start-context-types'

export type TaskStartCard = Pick<
  TaskBoardWireCard,
  'ref' | 'provider' | 'displayId' | 'title' | 'url'
>

type ProviderRef<P extends TaskBoardCardRef['provider']> = Extract<
  TaskBoardCardRef,
  { provider: P }
>

/** Every reader throws when the item cannot be read. */
export type TaskStartContextDeps = {
  github(ref: ProviderRef<'github'>): Promise<{
    body: string
    bodyImageUrls?: Record<string, string>
    comments: Pick<PRComment, 'author' | 'createdAt' | 'body' | 'bodyImageUrls'>[]
  }>
  gitlab(
    ref: ProviderRef<'gitlab'>
  ): Promise<{ body: string; comments: Pick<MRComment, 'author' | 'createdAt' | 'body'>[] }>
  jira(ref: ProviderRef<'jira'>): Promise<{
    description: string
    /** Absolute URLs of the issue's image attachments. */
    attachmentUrls: string[]
    comments: (Pick<JiraComment, 'createdAt' | 'body'> & { user?: { displayName: string } })[]
  }>
  linear(ref: ProviderRef<'linear'>): Promise<{
    description: string
    descriptionImageUrls?: Record<string, string>
    comments: (Pick<LinearComment, 'createdAt' | 'body'> & { user?: { displayName: string } })[]
  }>
}

export type TaskStartFetchDeps = {
  /** Plain download of an absolute URL (signed GitHub/Linear URLs, Jira attachments). */
  fetchUrl(card: TaskStartCard, url: string): Promise<Buffer>
  /** Authenticated project upload download (`glab api`). */
  gitlabUpload(card: TaskStartCard, secret: string, fileName: string): Promise<Buffer>
}

type Normalized = {
  description: string
  descriptionUrls: string[]
  comments: { author: string; at: string; body: string; urls: string[] }[]
}

const GITLAB_UPLOAD = /\(\s*<?(\/uploads\/[0-9A-Za-z]+\/[^)\s>]+)/g
const GITLAB_UPLOAD_URL = /^(.*)\/uploads\/([0-9A-Za-z]+)\/([^/?#]+)$/

function gitlabProjectBase(card: TaskStartCard): string {
  return card.url.replace(/\/-\/(?:issues|work_items)\/.*$/, '')
}

const DATA_IMAGE = /!\[[^\]]*\]\(\s*<?data:[^)]*\)/gi
const GITLAB_IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|svg|bmp)$/i

/** Inline base64 images would bloat the prompt; they are never collected as prints. */
function stripDataImages(markdown: string): string {
  return markdown.replace(DATA_IMAGE, '[imagem]')
}

function markdownUrls(markdown: string): string[] {
  return extractLinearInlineMedia(markdown, 'description')
    .map((m) => m.url)
    .filter((url) => /^https?:/i.test(url))
}

function gitlabUrls(markdown: string, base: string): string[] {
  const uploads = [...markdown.matchAll(GITLAB_UPLOAD)]
    .filter((m) => GITLAB_IMAGE_EXTENSION.test(m[1]))
    .map((m) => `${base}${m[1]}`)
  return [...new Set([...markdownUrls(markdown), ...uploads])]
}

function mapped(urls: Record<string, string> | undefined, markdown: string): string[] {
  const found = [...markdownUrls(markdown), ...Object.keys(urls ?? {})]
  return [...new Set(found.map((url) => urls?.[url] || url))]
}

async function normalize(card: TaskStartCard, deps: TaskStartContextDeps): Promise<Normalized> {
  const { ref } = card
  if (ref.provider === 'github') {
    const item = await deps.github(ref)
    return {
      description: item.body,
      descriptionUrls: mapped(item.bodyImageUrls, item.body),
      comments: item.comments.map((c) => ({
        author: c.author,
        at: c.createdAt,
        body: c.body,
        urls: mapped(c.bodyImageUrls, c.body)
      }))
    }
  }
  if (ref.provider === 'gitlab') {
    const item = await deps.gitlab(ref)
    const base = gitlabProjectBase(card)
    return {
      description: item.body,
      descriptionUrls: gitlabUrls(item.body, base),
      comments: item.comments.map((c) => ({
        author: c.author,
        at: c.createdAt,
        body: c.body,
        urls: gitlabUrls(c.body, base)
      }))
    }
  }
  if (ref.provider === 'jira') {
    const item = await deps.jira(ref)
    // Attachments are the source of Jira images; markdown media is only text.
    return {
      description: stripDataImages(item.description),
      descriptionUrls: item.attachmentUrls,
      comments: item.comments.map((c) => ({
        author: c.user?.displayName ?? '',
        at: c.createdAt,
        body: stripDataImages(c.body),
        urls: []
      }))
    }
  }
  const item = await deps.linear(ref)
  return {
    description: item.description,
    descriptionUrls: mapped(item.descriptionImageUrls, item.description),
    comments: item.comments.map((c) => ({
      author: c.user?.displayName ?? '',
      at: c.createdAt,
      body: c.body,
      urls: markdownUrls(c.body)
    }))
  }
}

/** The card's description, comments (oldest first) and image references. Throws `context_fetch_failed`. */
export async function collectTaskStartContext(
  card: TaskStartCard,
  deps: TaskStartContextDeps
): Promise<TaskStartContext> {
  let item: Normalized
  try {
    item = await normalize(card, deps)
  } catch (error) {
    throw new Error('context_fetch_failed', { cause: error })
  }
  // An unparseable timestamp sorts first instead of poisoning the comparator with NaN.
  const comments = item.comments.toSorted(
    (a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0)
  )
  const images: TaskStartImage[] = item.descriptionUrls.map((url) => ({
    origin: { kind: 'description' },
    url
  }))
  for (const comment of comments) {
    for (const url of comment.urls) {
      images.push({ origin: { kind: 'comment', author: comment.author, at: comment.at }, url })
    }
  }
  return {
    displayId: card.displayId,
    title: card.title,
    url: card.url,
    provider: card.provider,
    description: item.description,
    comments: comments.map(({ author, at, body }) => ({ author, at, body })),
    images
  }
}

/** Byte reader for `writeTaskStartImages`; GitLab project uploads go through the authenticated CLI. */
export function createTaskStartFetchBytes(
  card: TaskStartCard,
  deps: TaskStartFetchDeps
): (image: TaskStartImage) => Promise<Buffer> {
  return async (image) => {
    const upload = card.provider === 'gitlab' ? GITLAB_UPLOAD_URL.exec(image.url) : null
    if (upload) {
      return deps.gitlabUpload(card, upload[2], decodeURIComponent(upload[3]))
    }
    return deps.fetchUrl(card, image.url)
  }
}
