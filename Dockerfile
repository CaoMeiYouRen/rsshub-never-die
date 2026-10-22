# 使用官方 Node 镜像作为唯一基线：Node 静态链接 brotli/OpenSSL/c-ares，
# 避免 apk 版 Node 依赖 Alpine 仓库里未回填安全修复的系统库。
# 走 Docker Hub（工作流中已登录，避免 ECR Public 匿名拉取被限流）。
# 更新版本时同步修改 digest（docker buildx imagetools inspect node:<version>-alpine）。
ARG NODE_IMAGE=docker.io/library/node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
FROM ${NODE_IMAGE} AS nodejs

# 阶段一：构建阶段
FROM nodejs AS builder

RUN npm install -g pnpm@11

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml /app/

RUN pnpm i --frozen-lockfile

COPY . /app

RUN pnpm run build

# 阶段二：缩小阶段
FROM nodejs AS docker-minifier

RUN npm install -g pnpm@11

WORKDIR /app

RUN pnpm add @vercel/nft@0.24.4 fs-extra@11.2.0 --save-prod

COPY --from=builder /app /app

RUN export PROJECT_ROOT=/app/ && \
    node /app/scripts/minify-docker.cjs && \
    rm -rf /app/node_modules /app/scripts && \
    mv /app/app-minimal/node_modules /app/ && \
    rm -rf /app/app-minimal

# 阶段三：生产阶段
FROM nodejs AS runtime

# 运行阶段不需要包管理器，裁掉以减少镜像体积
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

ENV NODE_ENV=production

WORKDIR /app

COPY --from=docker-minifier /app /app

EXPOSE 3000

CMD ["node", "dist/index.mjs"]
