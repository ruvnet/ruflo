FROM ghcr.io/huggingface/chat-ui-db:latest

# Switch to root for patching and file operations
USER root

# Bake .env.local with MODELS config (too large for Cloud Run env vars)
COPY dotenv-local.txt /app/.env.local

# Copy branded welcome GIF into the SvelteKit static asset directory.
COPY static/chatui/omni-welcome.gif /app/build/client/chatui/omni-welcome.gif
COPY static/chatui/omni-welcome.gif /app/static/chatui/omni-welcome.gif

# Copy PWA icon (fixes 404 for /chat/chatui/icon-144x144.png)
COPY static/chatui/icon-144x144.png /app/build/client/chatui/icon-144x144.png
COPY static/chatui/icon-144x144.png /app/static/chatui/icon-144x144.png

# Switch back to non-root user
USER 1000
