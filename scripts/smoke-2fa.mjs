// Live smoke test of the two-factor flow against a RUNNING server (demo data):
//   node scripts/smoke-2fa.mjs http://localhost:3000
// Enrols the demo dispatcher, checks wrong, replayed and recovery codes, then turns two-factor
// off again, so the account ends as it started. Never run it against real accounts.
import { Secret, TOTP } from "otpauth";

const BASE = process.argv[2] ?? "http://localhost:3001";
let cookies = {};
const cookieHeader = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Origin: BASE, Cookie: cookieHeader() },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const [k, v] = pair.split("=");
    if (v === "" || /Max-Age=0|Expires=Thu, 01 Jan 1970/.test(c)) delete cookies[k];
    else cookies[k] = v;
  }
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}
const step = (label, r) => console.log(`${label.padEnd(44)} ${r.status} ${JSON.stringify(r.json?.data ?? r.json?.error ?? null).slice(0, 110)}`);
const codeAt = (secret, offsetSteps = 0) => new TOTP({ secret: Secret.fromBase32(secret.replace(/ /g, "")) }).generate({ timestamp: Date.now() + offsetSteps * 30_000 });

const creds = { email: "dispatcher@logitrack.in", password: "Dispatch@123" };
step("login (password only)", await call("POST", "/api/auth/login", creds));
const setup = await call("POST", "/api/profile/mfa", { password: creds.password });
step("start setup", { status: setup.status, json: { data: { hasQr: setup.json.data.qrSvg.startsWith("<svg"), uri: setup.json.data.otpauthUri.slice(0, 40) } } });
const secret = setup.json.data.manualKey;
step("enable with wrong code", await call("POST", "/api/profile/mfa/enable", { code: "000000" }));
const enabled = await call("POST", "/api/profile/mfa/enable", { code: codeAt(secret) });
step("enable with valid code", { status: enabled.status, json: { data: { recoveryCodes: enabled.json.data.recoveryCodes.length } } });
const recovery = enabled.json.data.recoveryCodes;
step("status (no secret in response)", await call("GET", "/api/profile/mfa"));
const me = await call("GET", "/api/users");
step("users list leaks secret?", { status: me.status, json: { data: JSON.stringify(me.json).includes("mfaSecret") } });
step("logout", await call("POST", "/api/auth/logout"));

const login2 = await call("POST", "/api/auth/login", creds);
step("login -> mfa required", login2);
step("no session yet: /api/auth/me", await call("GET", "/api/auth/me"));
step("verify with wrong code", await call("POST", "/api/auth/mfa", { code: "123456" }));
step("verify replayed enrolment code", await call("POST", "/api/auth/mfa", { code: codeAt(secret) }));
step("verify with next-step code", await call("POST", "/api/auth/mfa", { code: codeAt(secret, 1) }));
step("signed in: /api/auth/me", await call("GET", "/api/auth/me"));
step("logout", await call("POST", "/api/auth/logout"));

await call("POST", "/api/auth/login", creds);
step("recovery code sign-in", await call("POST", "/api/auth/mfa", { recoveryCode: recovery[0] }));
step("status after recovery use", await call("GET", "/api/profile/mfa"));
await call("POST", "/api/auth/logout");
await call("POST", "/api/auth/login", creds);
step("same recovery code again (must fail)", await call("POST", "/api/auth/mfa", { recoveryCode: recovery[0] }));
step("second recovery code", await call("POST", "/api/auth/mfa", { recoveryCode: recovery[1] }));
step("disable without code (must fail)", await call("POST", "/api/profile/mfa/disable", { password: creds.password }));
step("disable with recovery code", await call("POST", "/api/profile/mfa/disable", { password: creds.password, recoveryCode: recovery[2] }));
step("logout", await call("POST", "/api/auth/logout"));
step("login (password only again)", await call("POST", "/api/auth/login", creds));
await call("POST", "/api/auth/logout");
