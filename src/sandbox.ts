import { getSandbox } from "@cloudflare/sandbox";

export { Sandbox } from "@cloudflare/sandbox";

const YTDLP_TIMEOUT_MS = 120_000;

/**
 * Pull the audio track of a video inside a Cloudflare Sandbox container (yt-dlp + ffmpeg) and
 * return it base64-encoded, ready for Workers AI Whisper. One shared container is reused
 * across recipes; it sleeps after a few idle minutes.
 */
export async function downloadAudioInSandbox(env: Env, id: string, url: string): Promise<string> {
  const sandbox = getSandbox(env.Sandbox, "ytdlp", { sleepAfter: "5m" });
  const out = `/workspace/${id}.m4a`;
  const cmd = [
    "yt-dlp -q --no-warnings --no-playlist",
    "--js-runtimes node",
    "-x --audio-format m4a --audio-quality 6",
    '--postprocessor-args "ffmpeg:-ac 1 -ar 16000"',
    `-o ${JSON.stringify(out)} ${JSON.stringify(url)}`,
  ].join(" ");
  const res = await sandbox.exec(cmd, { timeout: YTDLP_TIMEOUT_MS });
  if (!res.success) throw new Error(`yt-dlp exit ${res.exitCode}: ${(res.stderr || res.stdout).trim().split("\n").slice(-3).join(" | ")}`);
  try {
    const file = await sandbox.readFile(out, { encoding: "base64" });
    if (!file.content) throw new Error("yt-dlp produced an empty file");
    return file.content;
  } finally {
    await sandbox.deleteFile(out).catch(() => {});
  }
}
