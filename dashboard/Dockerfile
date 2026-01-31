# Stage 1: Build
FROM node:20-alpine AS builder

# Build args для NEXT_PUBLIC переменных
ARG NEXT_PUBLIC_API_URL=https://puppetgram.ru
ARG NEXT_PUBLIC_WS_URL=wss://puppetgram.ru/ws

# Устанавливаем как env для Next.js build
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Nginx
FROM nginx:alpine
COPY --from=builder /app/out /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
