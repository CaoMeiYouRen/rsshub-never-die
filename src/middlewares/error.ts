import { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ErrorHandler, HTTPResponseError, NotFoundHandler } from 'hono/types'
import { ContentfulStatusCode } from 'hono/utils/http-status'
import logger from '@/middlewares/logger'

export const errorhandler: ErrorHandler = (error: HTTPResponseError, c: Context) => {
    const message = process.env.NODE_ENV === 'production' ? `${error.name}: ${error.message}` : error.stack
    let status = 500
    if (error instanceof HTTPException) {
        const response = error.getResponse()
        status = response.status
    }
    const method = c.req.method
    const requestPath = c.req.path
    logger.error(`Error in ${method} ${requestPath}: \n${message}`)
    const responseStatus = [101, 204, 205, 304].includes(status) ? 500 : status as ContentfulStatusCode
    return c.json({
        status,
        message,
    }, responseStatus)
}

export const notFoundHandler: NotFoundHandler = (c: Context) => {
    const method = c.req.method
    const requestPath = c.req.path
    const message = `Cannot ${method} ${requestPath}`
    logger.warn(message)
    return c.json({
        status: 404,
        message,
    }, 404)
}
