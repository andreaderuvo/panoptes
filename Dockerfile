# Panoptes in a container, and here a container is exactly the right shape.
#
#   docker compose up -d
#
# Unlike Argus, a board has nothing to reach into: no tmux, no filesystem, no terminal, no
# processes to inspect. It holds one read-only key per machine and asks each one over HTTP.
# So it needs no host namespaces, no privileged mounts and no matching uid — a plain container
# with a port and its configuration is the whole deployment.
FROM python:3.13-slim

WORKDIR /opt/panoptes

# Only the runtime block: everything under `# Tests` belongs to people working on Panoptes.
COPY requirements.txt ./
RUN sed '/^# Tests/,$d' requirements.txt > /tmp/runtime.txt \
 && pip install --no-cache-dir -r /tmp/runtime.txt \
 && rm /tmp/runtime.txt

COPY app ./app
COPY static ./static

# Where the config lives, so a volume can hold it and the token survives a new image.
ENV PANOPTES_CONFIG=/config/config.yaml
VOLUME /config

EXPOSE 8770

ENTRYPOINT ["sh", "-c", "exec python -m app.main --config \"$PANOPTES_CONFIG\" --listen 0.0.0.0:8770 \"$@\"", "--"]
