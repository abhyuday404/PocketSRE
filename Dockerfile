# Development backend image, not a hardened production deployment.
FROM node:22-alpine
WORKDIR /workspace
RUN corepack enable
COPY . .
# Native mobile binaries are not needed in this backend-only image.
RUN pnpm install --frozen-lockfile --ignore-scripts \
    && pnpm --filter @pocketsre/contracts --filter @pocketsre/incident-engine --filter @pocketsre/demo-service --filter @pocketsre/gateway -r build \
    && mkdir -p /data && chown node:node /data
USER node
ENV AUDIT_PATH=/data/actions.json
ENV INCIDENT_PATH=/data/incidents.json
CMD ["node", "services/gateway/dist/server.js"]
