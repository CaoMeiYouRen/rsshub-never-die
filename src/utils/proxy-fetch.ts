/** 视为重定向的状态码 */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

/** 默认响应体大小上限（10MB） */
export const DEFAULT_MAX_RESPONSE_SIZE = 10 * 1024 * 1024

/** 默认最多跟随的重定向次数 */
export const DEFAULT_MAX_REDIRECTS = 3

export interface ProxyFetchOptions {
    /**
     * 中止信号，建议传入 `AbortSignal.timeout(TIMEOUT)`
     */
    signal?: AbortSignal
    /**
     * 响应体大小上限（字节）
     *
     * @default DEFAULT_MAX_RESPONSE_SIZE
     */
    maxBytes?: number
    /**
     * 最多跟随的重定向次数
     *
     * @default DEFAULT_MAX_REDIRECTS
     */
    maxRedirects?: number
    /**
     * 允许跨 host 跳转的目标，形如 `example.com` 或 `example.com:8443`
     *
     * 默认只允许跳转到与起始地址同源的地址
     */
    allowedRedirectHosts?: string[]
    /**
     * 是否允许跨 host 重定向到回环/内网地址
     *
     * 同一 host 内的重定向不受该选项限制。
     *
     * @default false
     */
    allowPrivateRedirects?: boolean
}

export interface ProxyFetchResult {
    /** 上游响应状态码（仅 2xx 会返回） */
    status: number
    /** 上游响应的 Content-Type，缺省为 application/xml */
    contentType: string
    /** 已解码的响应体 */
    body: string
    /** 跟随重定向后的最终 URL */
    finalUrl: string
}

function normalizeHostname(hostname: string) {
    const host = hostname.toLowerCase()
    if (host.startsWith('[') && host.endsWith(']')) {
        return host.slice(1, -1)
    }
    return host
}

/**
 * 判断 IPv4 字面量是否属于回环、内网、链路本地或保留地址
 */
function isPrivateIpv4(ip: string) {
    const parts = ip.split('.')
    if (parts.length !== 4) {
        return false
    }
    const nums = parts.map((part) => Number(part))
    if (nums.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
        return false
    }
    const [first, second, third] = nums
    return first === 0 // 0.0.0.0/8
        || first === 10 // 10.0.0.0/8
        || first === 127 // 127.0.0.0/8
        || (first === 100 && second >= 64 && second <= 127) // 100.64.0.0/10
        || (first === 169 && second === 254) // 169.254.0.0/16
        || (first === 172 && second >= 16 && second <= 31) // 172.16.0.0/12
        || (first === 192 && second === 0) // 192.0.0.0/24
        || (first === 192 && second === 168) // 192.168.0.0/16
        || (first === 198 && (second === 18 || second === 19)) // 198.18.0.0/15
        || (first === 203 && second === 0 && third === 113) // 203.0.113.0/24
        || first >= 224 // 组播与保留地址
}

/**
 * 判断 IPv6 字面量是否属于回环、内网、链路本地或组播地址
 */
function isPrivateIpv6(ip: string) {
    const address = ip.toLowerCase()
    if (address === '::' || address === '::1') {
        return true
    }
    const mapped = address.match(/^::ffff:(.+)$/) // IPv4 映射地址
    if (mapped) {
        const tail = mapped[1]
        if (tail.includes('.')) {
            return isPrivateIpv4(tail)
        }
        const [high, low] = tail.split(':')
        const highValue = Number.parseInt(high ?? '', 16)
        const lowValue = Number.parseInt(low ?? '', 16)
        if (Number.isInteger(highValue) && Number.isInteger(lowValue)) {
            const ipv4 = `${highValue >> 8}.${highValue & 0xff}.${lowValue >> 8}.${lowValue & 0xff}`
            return isPrivateIpv4(ipv4)
        }
        return true
    }
    return address.startsWith('fc') // fc00::/7 唯一本地地址
        || address.startsWith('fd')
        || address.startsWith('fe80') // 链路本地地址
        || address.startsWith('ff') // 组播地址
}

/**
 * 判断主机名是否指向回环或内网地址
 *
 * 仅判断 IP 字面量与 localhost，不做 DNS 解析，因此无法防御 DNS rebinding。
 *
 * @author CaoMeiYouRen
 * @date 2026-10-22
 * @export
 * @param hostname
 */
export function isPrivateHostname(hostname: string) {
    const host = normalizeHostname(hostname)
    if (host === 'localhost' || host.endsWith('.localhost')) {
        return true
    }
    if (host.includes(':')) {
        return isPrivateIpv6(host)
    }
    return isPrivateIpv4(host)
}

function effectivePort(url: URL) {
    if (url.port) {
        return url.port
    }
    return url.protocol === 'https:' ? '443' : '80'
}

/**
 * 判断是否与起始地址同源
 *
 * 同源允许：协议与 host、端口一致；或同 host 的 http -> https 默认端口升级。
 * 同 host 不同端口视为跨源，避免节点借本机其他端口的服务跳转。
 */
function isSameOrigin(origin: URL, target: URL) {
    if (normalizeHostname(origin.hostname) !== normalizeHostname(target.hostname)) {
        return false
    }
    if (origin.protocol === target.protocol) {
        return effectivePort(origin) === effectivePort(target)
    }
    return origin.protocol === 'http:'
        && target.protocol === 'https:'
        && effectivePort(origin) === '80'
        && effectivePort(target) === '443'
}

function assertRedirectAllowed(target: URL, origin: URL, allowedHosts: Set<string>, allowPrivateRedirects: boolean) {
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new Error('Redirect to unsupported protocol')
    }
    if (isSameOrigin(origin, target)) {
        // 跳回节点自身不属于放大攻击面，允许私网自建节点正常跳转
        return
    }
    const targetHostname = normalizeHostname(target.hostname)
    if (!allowedHosts.has(target.host.toLowerCase()) && !allowedHosts.has(targetHostname)) {
        throw new Error('Redirect to untrusted host')
    }
    if (!allowPrivateRedirects && isPrivateHostname(target.hostname)) {
        throw new Error('Redirect to private network is not allowed')
    }
}

async function readBodyWithLimit(response: Response, maxBytes: number) {
    if (!response.body) {
        return ''
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) {
                break
            }
            if (!value) {
                continue
            }
            total += value.byteLength
            if (total > maxBytes) {
                throw new Error(`Upstream response exceeds the limit of ${maxBytes} bytes`)
            }
            chunks.push(value)
        }
    } catch (error) {
        await reader.cancel().catch(() => undefined)
        throw error
    }
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.byteLength
    }
    return new TextDecoder().decode(merged)
}

/**
 * 安全的出站请求
 *
 * 与直接使用 `fetch` 相比：
 * - 手工跟随重定向，逐跳校验协议、host 与内网地址；
 * - 限制响应体大小，避免被上游无限流打爆内存；
 * - 支持中止信号，配合请求超时释放上游连接；
 * - 错误信息不包含上游 URL。
 *
 * @author CaoMeiYouRen
 * @date 2026-10-22
 * @export
 * @param input
 * @param options
 */
export async function proxyFetch(input: string | URL, options: ProxyFetchOptions = {}): Promise<ProxyFetchResult> {
    const {
        signal,
        maxBytes = DEFAULT_MAX_RESPONSE_SIZE,
        maxRedirects = DEFAULT_MAX_REDIRECTS,
        allowedRedirectHosts = [],
        allowPrivateRedirects = false,
    } = options
    const allowedHosts = new Set(allowedRedirectHosts.map((host) => host.trim().toLowerCase()).filter(Boolean))
    let current = new URL(input)
    const origin = new URL(input)

    for (let redirectCount = 0; ; redirectCount++) {
        const response = await fetch(current, {
            redirect: 'manual',
            signal,
        })
        const location = response.headers.get('location')
        if (REDIRECT_STATUS.has(response.status) && location) {
            if (response.body) {
                await response.body.cancel().catch(() => undefined)
            }
            if (redirectCount >= maxRedirects) {
                throw new Error(`Too many redirects (limit: ${maxRedirects})`)
            }
            const next = new URL(location, current)
            assertRedirectAllowed(next, origin, allowedHosts, allowPrivateRedirects)
            current = next
            continue
        }
        if (!response.ok) {
            if (response.body) {
                await response.body.cancel().catch(() => undefined)
            }
            throw new Error(`Upstream request failed with status ${response.status}`)
        }
        return {
            status: response.status,
            contentType: response.headers.get('content-type') || 'application/xml',
            body: await readBodyWithLimit(response, maxBytes),
            finalUrl: current.toString(),
        }
    }
}
