/** Shared sign-in for the CLI scripts: returns headers carrying a Better Auth session cookie. */
export async function signIn(base: string): Promise<Record<string, string>> {
  const email = process.env.RECIPEBOX_EMAIL;
  const password = process.env.RECIPEBOX_PASSWORD;
  if (!email || !password) throw new Error("Set RECIPEBOX_EMAIL and RECIPEBOX_PASSWORD (the account you created in the app).");
  const r = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`sign-in failed: ${r.status} ${await r.text()}`);
  const cookies = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (!cookies) throw new Error("sign-in returned no session cookie");
  return { cookie: cookies, origin: base };
}
