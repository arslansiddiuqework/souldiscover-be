/**
 * Admin API authorization smoke (non-destructive).
 * Run: npx ts-node src/__tests__/admin-authz-smoke.test.ts
 *
 * Requires local backend on ADMIN_API_BASE (default http://localhost:4001/api/admin).
 */

const BASE =
  process.env.ADMIN_API_BASE || "http://localhost:4001/api/admin";

type Result = { name: string; ok: boolean; detail: string };

async function request(
  method: string,
  path: string,
  opts?: { body?: unknown; token?: string | null }
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts?.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts?.token === null) {
    /* explicitly no auth */
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.text();
  return { status: res.status, body: body.slice(0, 200) };
}

async function main() {
  const results: Result[] = [];

  const protectedGets = [
    "/users",
    "/sessions",
    "/analytics",
    "/logs",
    "/settings",
    "/wellness",
    "/consultations",
    "/assessments",
    "/emergency/status",
  ];

  for (const path of protectedGets) {
    const noAuth = await request("GET", path);
    results.push({
      name: `GET ${path} without token → 401`,
      ok: noAuth.status === 401,
      detail: `${noAuth.status} ${noAuth.body}`,
    });

    const bad = await request("GET", path, { token: "invalid" });
    results.push({
      name: `GET ${path} invalid token → 401`,
      ok: bad.status === 401,
      detail: `${bad.status} ${bad.body}`,
    });
  }

  const login = await request("POST", "/auth/login", {
    body: { email: "nobody@example.com", password: "wrong" },
  });
  results.push({
    name: "POST /auth/login bad credentials → 401",
    ok: login.status === 401,
    detail: `${login.status} ${login.body}`,
  });

  const forgot = await request("POST", "/auth/forgot-password", {
    body: { email: "nobody@example.com" },
  });
  results.push({
    name: "POST /auth/forgot-password unknown email → 200 (no enumeration)",
    ok: forgot.status === 200,
    detail: `${forgot.status} ${forgot.body}`,
  });

  const reset = await request("POST", "/auth/reset-password", {
    body: { token: "x", password: "Test1234!" },
  });
  results.push({
    name: "POST /auth/reset-password bad token → 400",
    ok: reset.status === 400,
    detail: `${reset.status} ${reset.body}`,
  });

  const del = await request("DELETE", "/users/000000000000000000000000");
  results.push({
    name: "DELETE /users/:id without token → 401",
    ok: del.status === 401,
    detail: `${del.status} ${del.body}`,
  });

  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    if (!r.ok) failed += 1;
    console.log(`${mark}  ${r.name}`);
    if (!r.ok) console.log(`      ${r.detail}`);
  }

  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("BLOCKED — could not reach admin API:", err.message || err);
  console.error(`Base URL: ${BASE}`);
  process.exit(2);
});
