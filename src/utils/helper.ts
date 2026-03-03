import crypto from 'crypto'

/**
 * 生成 MD5 哈希值
 *
 * @author CaoMeiYouRen
 * @date 2024-10-25
 * @export
 * @param str
 */
export function md5(str: string) {
    return crypto.createHash('md5').update(str).digest('hex')
}

/**
 * RSSHub 实例节点配置
 */
export interface NodeConfig {
    /** 实例 URL */
    url: string
    /** 权重，默认为 1，数字越大被选中的概率越高 */
    weight: number
    /** 必选实例：优先使用，始终包含在请求池中 */
    priority: boolean
    /** 备用实例：当所有其他实例均失败时才使用（仅在 failover 模式下有效） */
    backup: boolean
}

/**
 * 将 RSSHUB_NODE_URLS 解析为 NodeConfig 数组
 *
 * 支持以下格式（多个选项以竖线分隔）：
 *   https://example.com                  普通实例（权重=1）
 *   https://example.com|priority         必选实例，优先使用
 *   https://example.com|backup           备用实例，所有其他实例失败后才使用
 *   https://example.com|weight=3         设置权重为 3
 *   https://example.com|priority|weight=2  必选且权重为 2
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
        let priority = false
        let backup = false
        for (const part of parts.slice(1)) {
            const weightMatch = part.match(/^weight=(\d+)$/)
            if (weightMatch) {
                weight = Math.max(1, parseInt(weightMatch[1]))
            } else if (part === 'priority') {
                priority = true
            } else if (part === 'backup') {
                backup = true
            }
        }
        result.push({ url, weight, priority, backup })
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
