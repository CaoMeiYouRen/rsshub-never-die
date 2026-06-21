import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { name } from '../package.json'
import app from './app'
import logger from './middlewares/logger'

export const runtime = 'nodejs'

export const config = {
    api: {
        bodyParser: false,
    },
}

logger.info(`${name} 云函数启动成功`)

function toHeaders(headers: IncomingHttpHeaders): Headers {
    const requestHeaders = new Headers()
    Object.entries(headers).forEach(([key, value]) => {
        if (typeof value === 'string') {
            requestHeaders.set(key, value)
            return
        }
        if (Array.isArray(value)) {
            value.forEach((item) => {
                requestHeaders.append(key, item)
            })
        }
    })
    return requestHeaders
}

function createRequest(req: IncomingMessage): Request {
    const method = req.method || 'GET'
    const host = req.headers.host || 'localhost'
    const url = new URL(req.url || '/', `https://${host}`)
    if (method === 'GET' || method === 'HEAD') {
        return new Request(url, {
            method,
            headers: toHeaders(req.headers),
        })
    }
    return new Request(url, {
        method,
        headers: toHeaders(req.headers),
        body: req as unknown as BodyInit,
        duplex: 'half',
    } as RequestInit & { duplex: 'half' })
}

async function writeResponse(response: Response, res: ServerResponse): Promise<void> {
    res.statusCode = response.status
    response.headers.forEach((value, key) => {
        res.setHeader(key, value)
    })
    if (!response.body) {
        res.end()
        return
    }
    const body = await response.arrayBuffer()
    res.end(Buffer.from(body))
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const request = createRequest(req)
    const response = await app.fetch(request)
    await writeResponse(response, res)
}
