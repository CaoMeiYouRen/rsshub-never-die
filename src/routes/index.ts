import { Hono } from 'hono'
import { env } from 'hono/adapter'
import { StatusCode } from 'hono/utils/http-status'
import { HTTPException } from 'hono/http-exception'
import { Bindings } from '../types'
import { fetchWithStatusCheck, md5, NodeConfig, parseNodeUrls, weightedRandomPick } from '@/utils/helper'
import logger from '@/middlewares/logger'

// 官方实例，默认以必选节点方式加入
const DEFAULT_NODE: NodeConfig = { url: 'https://rsshub.app', weight: 1, priority: true, backup: false }

const app = new Hono<{ Bindings: Bindings }>()

app.get('*', async (c) => {
    const { RSSHUB_NODE_URLS, AUTH_KEY, MODE = 'loadbalance' } = env(c)
    const MAX_NODE_NUM = Math.max(parseInt(env(c).MAX_NODE_NUM) || 6, 1) // 最大节点数
    const path = c.req.path
    const query = c.req.query()
    const { authKey, authCode, ...otherQuery } = query
    if (AUTH_KEY) {
        if (authKey && authKey !== AUTH_KEY) { // 支持通过 authKey 验证
            throw new HTTPException(403, { message: 'Auth key is invalid' })
        }
        const code = md5(path + AUTH_KEY)
        if (authCode && authCode !== code) { // 支持通过 authCode 验证
            throw new HTTPException(403, { message: 'Auth code is invalid' })
        }
    }

    const parsedNodes = parseNodeUrls(RSSHUB_NODE_URLS)
    // 若用户未显式配置默认节点，则自动将其作为必选节点添加到队列首位
    const hasDefaultNode = parsedNodes.some((n) => n.url === DEFAULT_NODE.url)
    const allNodes = hasDefaultNode ? parsedNodes : [DEFAULT_NODE, ...parsedNodes]

    // 按类型分组
    const priorityNodes = allNodes.filter((n) => n.priority && !n.backup) // 必选节点：优先使用
    const regularNodes = allNodes.filter((n) => !n.priority && !n.backup) // 普通节点：按权重随机选择
    const backupNodes = allNodes.filter((n) => n.backup) // 备用节点：仅在其他节点全部失败后使用

    // 将 NodeConfig 转换为带路径和查询参数的完整 URL
    const makeUrl = (node: NodeConfig) => {
        const _url = new URL(node.url)
        _url.pathname = path
        _url.search = new URLSearchParams(otherQuery).toString()
        return _url.toString()
    }

    // 构建主节点池：必选节点全部包含，剩余位置按权重随机填充普通节点（上限 MAX_NODE_NUM）
    const regularCount = Math.max(0, MAX_NODE_NUM - priorityNodes.length)
    const poolNodes = [
        ...weightedRandomPick(priorityNodes, priorityNodes.length),
        ...weightedRandomPick(regularNodes, regularCount),
    ]

    if (MODE === 'loadbalance') {
        // 负载均衡模式：从所有非备用节点中按权重随机选择一个节点
        const candidates = [...priorityNodes, ...regularNodes]
        const selectedNode = weightedRandomPick(candidates, 1)[0]
        if (!selectedNode) {
            throw new HTTPException(500, { message: 'No RSSHub nodes available' })
        }
        const nodeUrl = makeUrl(selectedNode)
        const res = await fetchWithStatusCheck(nodeUrl)
        const data = await res.text()
        const contentType = res.headers.get('Content-Type') || 'application/xml'
        c.header('Content-Type', contentType)
        c.status(res.status as StatusCode)
        return c.body(data)
    }
    if (MODE === 'failover') {
        // 自动容灾：依次尝试必选节点、普通节点，最后才尝试备用节点
        // 普通节点按权重随机排列，确保高权重节点更早被尝试
        const orderedNodes = [...poolNodes, ...backupNodes]
        for (const node of orderedNodes) {
            const nodeUrl = makeUrl(node)
            try {
                const res = await fetchWithStatusCheck(nodeUrl)
                const data = await res.text()
                const contentType = res.headers.get('Content-Type') || 'application/xml'
                // 判断 contentType 类型，除了首页之外，其他页面返回 HTML 的话判断为错误
                if (path !== '/' && contentType.includes('text/html')) {
                    throw new HTTPException(500, { message: 'RSSHub node is failed' })
                }
                c.header('Content-Type', contentType)
                c.status(res.status as StatusCode)
                return c.body(data)
            } catch (error) {
                logger.error(error)
                // 忽略错误，继续请求下一个节点
                continue
            }
        }
        // 所有节点都失败
        throw new HTTPException(500, { message: 'All RSSHub nodes are failed' })
    }

    if (MODE === 'quickresponse') {
        // 快速响应：并发请求主节点池中的所有节点，返回最快的成功响应（备用节点不参与）
        const nodeUrls = poolNodes.map(makeUrl)
        const res = await Promise.any(nodeUrls.map(async (url) => {
            const resp = await fetchWithStatusCheck(url)
            const contentType = resp.headers.get('Content-Type') || 'application/xml'
            // 判断 contentType 类型，除了首页之外，其他页面返回 HTML 的话判断为错误
            if (path !== '/' && contentType.includes('text/html')) {
                throw new HTTPException(500, { message: 'RSSHub node is failed' })
            }
            return resp
        }))
        const data = await res.text()
        const contentType = res.headers.get('Content-Type') || 'application/xml'
        c.header('Content-Type', contentType)
        c.status(res.status as StatusCode)

        return c.body(data)
    }
    // 未指定模式
    throw new HTTPException(500, { message: 'Invalid mode' })
})

export default app
