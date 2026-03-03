import { Hono } from 'hono'
import { env } from 'hono/adapter'
import { StatusCode } from 'hono/utils/http-status'
import { HTTPException } from 'hono/http-exception'
import { Bindings } from '../types'
import { fetchWithStatusCheck, md5, NodeConfig, parseNodeUrls, weightedRandomPick } from '@/utils/helper'
import logger from '@/middlewares/logger'

// 官方实例，默认加入节点池
const DEFAULT_NODE: NodeConfig = { url: 'https://rsshub.app', weight: 1 }

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
    // 若用户未显式配置默认节点，则自动添加到节点池
    const hasDefaultNode = parsedNodes.some((n) => n.url === DEFAULT_NODE.url)
    const allNodes = hasDefaultNode ? parsedNodes : [DEFAULT_NODE, ...parsedNodes]

    // 将 NodeConfig 转换为带路径和查询参数的完整 URL
    const makeUrl = (node: NodeConfig) => {
        try {
            const _url = new URL(node.url)
            _url.pathname = path
            _url.search = new URLSearchParams(otherQuery).toString()
            return _url.toString()
        } catch (error) {
            logger.error(`Invalid RSSHub node url: ${node.url}`)
            logger.error(error)
            return null
        }
    }

    // 节点池：按权重抽样，且总数不超过 MAX_NODE_NUM
    const poolNodes = weightedRandomPick(allNodes, Math.min(allNodes.length, MAX_NODE_NUM))

    if (MODE === 'loadbalance') {
        // 负载均衡模式：从所有节点中按权重随机选择一个节点
        const selectedNode = weightedRandomPick(allNodes, 1)[0]
        if (!selectedNode) {
            throw new HTTPException(500, { message: 'No RSSHub nodes available' })
        }
        const nodeUrl = makeUrl(selectedNode)
        if (!nodeUrl) {
            throw new HTTPException(500, { message: 'No valid RSSHub nodes available' })
        }
        const res = await fetchWithStatusCheck(nodeUrl)
        const data = await res.text()
        const contentType = res.headers.get('Content-Type') || 'application/xml'
        c.header('Content-Type', contentType)
        c.status(res.status as StatusCode)
        return c.body(data)
    }
    if (MODE === 'failover') {
        // 自动容灾：按权重随机顺序依次尝试节点（不放回）
        const orderedNodes = poolNodes
        for (const node of orderedNodes) {
            const nodeUrl = makeUrl(node)
            if (!nodeUrl) {
                continue
            }
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
        // 快速响应：并发请求节点池中的所有节点，返回最快的成功响应
        const nodeUrls = poolNodes
            .map(makeUrl)
            .filter((url): url is string => Boolean(url))
        if (nodeUrls.length === 0) {
            throw new HTTPException(500, { message: 'No RSSHub nodes available' })
        }
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
