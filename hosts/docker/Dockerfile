# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}

ARG STAGECRAFT_UID=1000
ARG STAGECRAFT_GID=1000

ENV NODE_ENV=production
ENV STAGECRAFT_HOME=/stagecraft
ENV PATH="/stagecraft/bin:${PATH}"

WORKDIR /stagecraft

RUN set -eu; \
  if ! getent group "${STAGECRAFT_GID}" >/dev/null; then \
    groupadd --gid "${STAGECRAFT_GID}" stagecraft; \
  fi; \
  if ! getent passwd "${STAGECRAFT_UID}" >/dev/null; then \
    useradd --uid "${STAGECRAFT_UID}" \
      --gid "${STAGECRAFT_GID}" \
      --create-home \
      --shell /bin/sh \
      stagecraft; \
  fi; \
  mkdir -p /workspace; \
  chown "${STAGECRAFT_UID}:${STAGECRAFT_GID}" /workspace

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .
RUN chmod +x /stagecraft/hosts/docker/entrypoint.sh \
  && chown -R "${STAGECRAFT_UID}:${STAGECRAFT_GID}" /stagecraft /workspace

USER ${STAGECRAFT_UID}:${STAGECRAFT_GID}
WORKDIR /workspace

ENTRYPOINT ["/stagecraft/hosts/docker/entrypoint.sh"]
CMD []
