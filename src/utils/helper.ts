import crypto from 'crypto'

/**
 * 使用共享密钥为请求路径生成认证码
 *
 * @author CaoMeiYouRen
 * @date 2024-10-25
 * @export
 * @param path
 * @param authKey
 */
export function createAuthCode(path: string, authKey: string) {
    return crypto.createHmac('sha256', authKey).update(path).digest('hex')
}

/**
 * 常量时间比较，避免直接比较密钥类字符串
 *
 * @author CaoMeiYouRen
 * @date 2026-04-03
 * @export
 * @param a
 * @param b
 */
export function constantTimeEqual(a: string, b: string) {
    const left = Buffer.from(a)
    const right = Buffer.from(b)
    if (left.length !== right.length) {
        return false
    }
    return crypto.timingSafeEqual(left, right)
}

/**
 * RSSHub 实例节点配置
 */
export interface NodeConfig {
    /** 实例 URL */
    url: string
    /** 权重，默认为 1，数字越大被选中的概率越高 */
    weight: number
}

/**
 * 将 RSSHUB_NODE_URLS 解析为 NodeConfig 数组
 *
 * 支持以下格式（多个选项以竖线分隔）：
 *   https://example.com                  普通实例（权重=1）
 *   https://example.com|weight=3         设置权重为 3
 *
 * 兼容说明：
 *   旧版 `priority` / `backup` 标记会被忽略，仅保留权重行为。
 *
 * @author CaoMeiYouRen
 * @date 2024-10-24
 * @export
 * @param value
 */
export function parseNodeUrls(value: string): NodeConfig[] {
    const seen = new Set<string>()
    const result: NodeConfig[] = []
    for (const entry of value.split(',')) {
        const parts = entry.trim().split('|').map((p) => p.trim()).filter(Boolean)
        if (!parts.length) {
            continue
        }
        const url = parts[0]
        if (!url || seen.has(url)) {
            continue
        }
        seen.add(url)
        let weight = 1
        for (const part of parts.slice(1)) {
            const weightMatch = part.match(/^weight=(\d+)$/)
            if (weightMatch) {
                weight = Math.max(1, parseInt(weightMatch[1]))
            }
        }
        result.push({ url, weight })
    }
    return result
}

/**
 * 从给定的数组中随机挑选五个不重复的项
 * 采用洗牌算法，概率相同
 *
 * @author CaoMeiYouRen
 * @date 2024-10-24
 * @export
 * @template T
 * @param array
 * @param count
 */
export function randomPick<T>(array: T[], count: number): T[] {
    const shuffled = [...array]
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled.slice(0, count)
}

/**
 * 按权重随机挑选不重复的节点
 * 权重越高，被选中的概率越大
 *
 * @author CaoMeiYouRen
 * @date 2024-10-24
 * @export
 * @param items
 * @param count
 */
export function weightedRandomPick(items: NodeConfig[], count: number): NodeConfig[] {
    if (count <= 0 || items.length === 0) {
        return []
    }
    const result: NodeConfig[] = []
    const remaining = [...items]
    const actualCount = Math.min(count, remaining.length)
    for (let i = 0; i < actualCount; i++) {
        const totalWeight = remaining.reduce((sum, item) => sum + item.weight, 0)
        let rand = Math.random() * totalWeight
        let selectedIndex = remaining.length - 1
        for (let j = 0; j < remaining.length; j++) {
            rand -= remaining[j].weight
            if (rand <= 0) {
                selectedIndex = j
                break
            }
        }
        result.push(remaining[selectedIndex])
        remaining.splice(selectedIndex, 1)
    }
    return result
}

/**
 * 使用 fetch 函数并检查响应状态
 * 如果 响应状态码不是 2xx，则抛出错误
 *
 * @author CaoMeiYouRen
 * @date 2024-10-25
 * @export
 * @param url
 */
export async function fetchWithStatusCheck(url: string | URL | Request) {
    const response = await fetch(url)
    if (response.ok) {
        return response
    }
    throw new Error(`Request to ${url} failed with status ${response.status}`)
}
