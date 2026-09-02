# Cloudflare Sandbox image with yt-dlp + ffmpeg for pulling recipe-video audio in the cloud.
# Tag must match the @cloudflare/sandbox npm version.
FROM docker.io/cloudflare/sandbox:0.12.9-python

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg nodejs ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version

WORKDIR /workspace
