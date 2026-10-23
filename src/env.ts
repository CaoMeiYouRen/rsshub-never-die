import dotenv from 'dotenv'
const result = dotenv.config({
    path: [
        '.env.local',
        '.env',
    ],
})
const envObj = result.parsed

if (process.env.NODE_ENV === 'development') {
    console.log('envObj', envObj)
}

export const __PROD__ = process.env.NODE_ENV === 'production'
export const __DEV__ = process.env.NODE_ENV === 'development'

export const PORT = parseInt(process.env.PORT ?? '') || 3000

// 是否写入日志到文件
export const LOGFILES = process.env.LOGFILES === 'true'

export const LOG_LEVEL = process.env.LOG_LEVEL || (__DEV__ ? 'silly' : 'http')

export const TIMEOUT = parseInt(process.env.TIMEOUT ?? '') || 30000
