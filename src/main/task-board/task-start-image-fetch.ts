import { lookup } from 'node:dns/promises'
import { request, type RequestOptions } from 'node:https'
import { BlockList, isIP } from 'node:net'
import {
  classifyNetworkSource,
  normalizeSourceAddress
} from '../runtime/rpc/transports/websocket/source-admission/network-source-class'

/** Per image; every provider path is held to it, not only this fetch. */
export const TASK_START_IMAGE_MAX_BYTES = 10 * 1024 * 1024
const MAX_REDIRECTS = 5
const TIMEOUT_MS = 30_000

export type ResolvedAddress = { address: string; family: number }

export type ImageResponse = {
  status: number
  contentType?: string
  contentLength?: number
  location?: string
  body: AsyncIterable<Buffer>
  abort(): void
}

export type ImageFetchDeps = {
  resolve(host: string): Promise<ResolvedAddress[]>
  /** One GET of `url`, connecting only to `address`. */
  get(url: URL, address: ResolvedAddress): Promise<ImageResponse>
}

// Not public though classified so: unspecified, multicast, reserved, and IPv6 forms embedding IPv4.
const NOT_PUBLIC = new BlockList()
NOT_PUBLIC.addSubnet('0.0.0.0', 8, 'ipv4')
NOT_PUBLIC.addSubnet('192.0.0.0', 24, 'ipv4')
NOT_PUBLIC.addSubnet('198.18.0.0', 15, 'ipv4')
NOT_PUBLIC.addSubnet('224.0.0.0', 3, 'ipv4')
NOT_PUBLIC.addAddress('::', 'ipv6')
NOT_PUBLIC.addSubnet('64:ff9b::', 96, 'ipv6')
NOT_PUBLIC.addSubnet('2002::', 16, 'ipv6')
NOT_PUBLIC.addSubnet('ff00::', 8, 'ipv6')

/** Only addresses on the public internet: never loopback, private, link-local or tailnet. */
export function isPublicImageAddress(raw: string): boolean {
  const address = normalizeSourceAddress(raw)
  if (!address) {
    return false
  }
  const type = isIP(address) === 6 ? 'ipv6' : 'ipv4'
  return classifyNetworkSource(address) === 'public' && !NOT_PUBLIC.check(address, type)
}

async function publicAddress(url: URL, deps: ImageFetchDeps): Promise<ResolvedAddress> {
  if (url.protocol !== 'https:') {
    throw new Error('Image URL is not https')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const literal = isIP(host)
  const addresses = literal ? [{ address: host, family: literal }] : await deps.resolve(host)
  // Every answer must be public: a resolver could hand a private one on the connect.
  if (addresses.length === 0 || !addresses.every((a) => isPublicImageAddress(a.address))) {
    throw new Error('Image host is not a public address')
  }
  return addresses[0]
}

async function readCapped(response: ImageResponse, maxBytes: number): Promise<Buffer> {
  if (response.contentLength !== undefined && response.contentLength > maxBytes) {
    response.abort()
    throw new Error('Image is too large')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > maxBytes) {
      response.abort()
      throw new Error('Image is too large')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** An image from the open internet: https to public addresses only (each redirect re-checked),
 *  an `image/*` answer, and at most `maxBytes`. */
export async function fetchTaskStartImage(
  rawUrl: string,
  deps: ImageFetchDeps = nodeImageFetchDeps,
  maxBytes = TASK_START_IMAGE_MAX_BYTES
): Promise<Buffer> {
  let url = new URL(rawUrl)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await deps.get(url, await publicAddress(url, deps))
    if (response.status >= 300 && response.status < 400 && response.location) {
      response.abort()
      url = new URL(response.location, url)
      continue
    }
    if (response.status < 200 || response.status >= 300) {
      response.abort()
      throw new Error(`Image download failed: ${response.status}`)
    }
    if (!response.contentType?.toLowerCase().startsWith('image/')) {
      response.abort()
      throw new Error('Not an image')
    }
    return readCapped(response, maxBytes)
  }
  throw new Error('Too many image redirects')
}

function pinnedLookup(pinned: ResolvedAddress): RequestOptions['lookup'] {
  // The connection goes to the checked address, not to a second (rebindable) resolution.
  return (_host, options, callback) => {
    if (options.all) {
      callback(null, [pinned])
    } else {
      callback(null, pinned.address, pinned.family)
    }
  }
}

export const nodeImageFetchDeps: ImageFetchDeps = {
  resolve: (host) => lookup(host, { all: true, verbatim: true }),
  get: (url, address) =>
    new Promise((resolve, reject) => {
      const req = request(url, { method: 'GET', lookup: pinnedLookup(address) }, (res) => {
        const length = Number(res.headers['content-length'])
        resolve({
          status: res.statusCode ?? 0,
          contentType: res.headers['content-type'],
          contentLength: Number.isFinite(length) ? length : undefined,
          location: res.headers.location,
          body: res,
          abort: () => res.destroy()
        })
      })
      req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('Image download timed out')))
      req.on('error', reject)
      req.end()
    })
}
