export type Bindings = {
    NODE_ENV: string
    PORT: string
    LOGFILES: string
    LOG_LEVEL: string
    TIMEOUT: string
    MAX_BODY_SIZE: string
    RSSHUB_NODE_URLS: string
    CACHE_MAX_AGE: string
    AUTH_KEY: string
    // 响应体大小上限（字节），默认 10MB
    MAX_RESPONSE_SIZE: string
    // 允许跨 host 重定向的目标，英文逗号分隔
    ALLOW_REDIRECT_HOSTS: string
    // 是否允许跨 host 重定向到回环/内网地址，true/false
    ALLOW_PRIVATE_REDIRECTS: string
    // 运行模式：负载均衡/自动容灾/快速响应
    MODE: 'loadbalance' | 'failover' | 'quickresponse'
    MAX_NODE_NUM: string
}
