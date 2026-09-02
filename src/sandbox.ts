import { getSandbox } from "@cloudflare/sandbox";

export { Sandbox } from "@cloudflare/sandbox";

const YTDLP_TIMEOUT_MS = 150_000;
export const MAX_FRAMES = 10;

export interface Media {
  /** base64 m4a (mono, 16 kHz) or null if the video has no audio track */
  audio: string | null;
  /** base64 JPEG stills sampled evenly across the video */
  frames: string[];
}

/**
 * Pull a video inside a Cloudflare Sandbox container, then split it into a small mono audio track
 * (for Whisper) and up to MAX_FRAMES stills (for on-screen ingredient text). One shared container
 * is reused across recipes; it sleeps after a few idle minutes.
 */
export async function downloadMediaInSandbox(env: Env, id: string, url: string): Promise<Media> {
  const sandbox = getSandbox(env.Sandbox, "ytdlp", { sleepAfter: "5m" });
  const dir = `/workspace/${id}`;
  const script = mediaScript(dir, url);
  const res = await sandbox.exec(`mkdir -p ${dir} && bash -c ${shellQuote(script)}`, { timeout: YTDLP_TIMEOUT_MS });
  if (!res.success) throw new Error(`media exit ${res.exitCode}: ${(res.stderr || res.stdout).trim().split("\n").slice(-3).join(" | ")}`);
  try {
    const listed = await sandbox.exec(`ls ${dir}`);
    const files = listed.stdout.split("\n").filter(Boolean);
    const audio = files.includes("audio.m4a") ? (await sandbox.readFile(`${dir}/audio.m4a`, { encoding: "base64" })).content : null;
    const frames: string[] = [];
    for (const f of files.filter((n) => n.startsWith("frame_")).sort()) {
      frames.push((await sandbox.readFile(`${dir}/${f}`, { encoding: "base64" })).content);
    }
    return { audio: audio || null, frames };
  } finally {
    await sandbox.exec(`rm -rf ${dir}`).catch(() => {});
  }
}

/** Same steps the local runner performs, as one bash script (shared with scripts/runner.ts via docs). */
export function mediaScript(dir: string, url: string): string {
  return [
    `set -e; cd ${dir}`,
    `yt-dlp -q --no-warnings --no-playlist --js-runtimes node -f "bv*[height<=480]+ba/b[height<=480]/b" --merge-output-format mp4 -o video.mp4 ${JSON.stringify(url)}`,
    `ffmpeg -v error -y -i video.mp4 -vn -ac 1 -ar 16000 -c:a aac -b:a 48k audio.m4a || true`,
    `dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 video.mp4 | cut -d. -f1); dur=\${dur:-30}; fps=$(python3 -c "print(max(0.05, min(1, ${MAX_FRAMES}/max(1,$dur))))")`,
    `ffmpeg -v error -y -i video.mp4 -vf "fps=$fps,scale=640:-2" -frames:v ${MAX_FRAMES} -q:v 4 frame_%02d.jpg`,
    `rm -f video.mp4`,
  ].join(" && ");
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
