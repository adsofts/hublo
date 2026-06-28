# Hublo App Store — Design Specification

> Status: **design draft** (not yet implemented). Locked decisions below; build follows the phased roadmap.

Hublo ships a small set of built-in apps today. This document specifies an **app store** so users choose which apps to add to their own Hublo, and the community can publish apps that are referenced in the store — **without weakening Hublo's security model** (gateway never root; everything runs as your Unix user over SSH; the kernel uid is the security boundary).

## Locked decisions

1. **Community apps are allowed**, but unreviewed ("community") apps are gated behind the **v1 sandbox**. **v0 ships verified apps only.**
2. The catalog lives in a **dedicated repo `hublo-apps`** (keeps the core lean). Submissions are **pull requests** — the PR review is the human security gate.
3. **Ship v0 (curated) first** to validate the store UX, then **v1 (sandbox + capabilities)** for true dynamic/community apps.

## The core security insight

An "app" is two very unequal halves:

- **Frontend** (a UI module) — runs in the user's browser; can be **contained**.
- **Backend** (server-side routes that exec `curl`/`git`/`psql`/SFTP as the user) — runs **inside the gateway process**, which holds *every* logged-in user's SSH session in memory.

Therefore: **the store never accepts community backend code.** Store apps are **frontend-only** and compose **pre-audited** gateway primitives. A genuinely new server-side primitive enters the **core** via a normal reviewed PR (the way the HTTP client did), never via the store. (Out-of-process backend extensions are a possible v2 — separate sandboxed worker/container with dropped privileges — explicitly deferred.)

## v1 isolation model: sandboxed iframe + capability bridge

Each community app runs in an `<iframe sandbox="allow-scripts">` with an **opaque origin** (no `allow-same-origin`). Consequences:

- it **cannot** read Hublo's session cookie, DOM, or `localStorage`, and **cannot** call the gateway API directly;
- its page is served with a **locked CSP** (`default-src 'none'; script-src 'self'`) → **no ambient network access at all**;
- its **only** channel out is a `postMessage` RPC **bridge** that Hublo's trusted parent code arbitrates.

```
Hublo parent (trusted origin, holds session cookie)
   ▲  postMessage RPC  ── validates grant, then performs the real API call
   │
 iframe sandbox (community app, opaque origin, CSP default-src 'none')
```

**Enforcement lives in the trusted parent.** Because the iframe can reach the gateway *only* through the parent, checking grants in the parent before forwarding is sufficient for the frontend-app threat model — no per-app gateway tokens are needed in v1. The gateway's existing session auth and audit log still apply (audit gains an `app-id` field).

**Residual risk (stated honestly):** an app granted `fs.read` **+** `http` can still exfiltrate data the user let it read. The sandbox prevents privilege escalation and app↔app attacks; capability grants remain real trust. Mitigations: scoped capabilities, user-mediated file picking, verified tier, audit logging, and the SSH-as-user model (no app can root the host — worst realistic case is theft/destruction of the user's own data).

## App package format — `hublo.app.json`

```json
{
  "id": "com.author.markdown-preview",
  "name": "Markdown Preview",
  "version": "1.2.0",
  "sdk": "1",
  "author": { "name": "Jane Doe", "github": "janedoe" },
  "description": "Render and preview Markdown files.",
  "icon": "📝",
  "window": { "w": 700, "h": 500, "multi": false },
  "entry": "app.js",
  "capabilities": [
    { "id": "fs.read", "scope": "pick", "reason": "open the file you choose" },
    { "id": "http", "reason": "fetch remote images referenced in the doc" }
  ],
  "requires": [],
  "integrity": { "sha256": "<hash of the package>" },
  "signature": "<optional maintainer/author signature>"
}
```

- `id` — reverse-DNS, globally unique.
- `sdk` — host SDK **major** version the app targets (see "No dependency manager").
- `entry` — the JS module loaded inside the sandbox frame.
- `capabilities` — least-privilege list shown at install time (see below).
- `integrity.sha256` — hash of the package; verified on install.

## Capabilities (v1)

Each capability maps to an existing, audited gateway primitive, mediated by the bridge. The install dialog renders each in plain language; the user approves or cancels.

| Capability | What it grants | Default scope | Backed by |
|---|---|---|---|
| `storage` | app-private key/value | always (private, no prompt) | `~/.hublo/apps/<id>/kv.json` |
| `notify` | toast notifications | always | host UI |
| `clipboard` | read/write Hublo clipboard | prompt | clipboard store |
| `fs.read` / `fs.write` | files & dirs | **app's private dir** by default; `scope:"pick"` = only what the user picks; `scope:"home"` = explicit broad grant | `/api/fs/*` |
| `host.pick` | open a file/dir picker, return the chosen path | user-mediated each call | host UI |
| `http` | outbound HTTP requests | prompt | `/api/http/request` |
| `db` | Postgres queries (user selects which connections) | prompt | `/api/db/*` |
| `terminal` | open a PTY (**sensitive — equals shell access**) | explicit, flagged | `/ws/terminal` |

`exec` (arbitrary commands) is **omitted in v1** — too broad; power users use `terminal`. Sensitive capabilities (`terminal`, `fs:home`, `db`) are visually flagged. **If an app update adds capabilities, re-consent is required.**

`host.pick` is the elegant default for widening file access safely: instead of a blanket `fs.read`, the app asks the host to let the user pick, and only receives what was chosen (like the browser File System Access API).

## The bridge & SDK

Apps target a tiny **host SDK** (`hublo`), not raw `postMessage`:

```js
import { fs, http, db, ui, storage, host } from 'hublo'
const path = await host.pick({ type: 'file' })     // user-mediated
const text = await fs.read(path)                    // needs fs.read grant
ui.toast('Loaded ' + path)
await storage.set('lastFile', path)                 // private, no grant
```

Wire protocol (parent ⇄ iframe):

- **app → host**: `{ id, type: 'call', capability, method, args }`
- **host → app**: `{ id, type: 'result', ok, data | error }`
- **host → app events**: `{ type: 'event', name, payload }` (theme change, window resize, focus…)

The host: validates `capability` is granted to this app and `method` is allowed for it, applies path scoping, performs the real call with the user's session, returns the result. Every mediated call is appended to the audit log with the `app-id`.

## Registry — the `hublo-apps` repo

```
hublo-apps/
  registry.json                 # the catalog (pinned, hashed entries)
  apps/
    com.author.foo/
      1.2.0/
        hublo.app.json
        app.js                  # self-contained built bundle
        icon.svg                # optional
  scripts/validate.mjs          # CI: JSON-schema, hash match, size cap, capability sanity
  README.md                     # submission guide
```

`registry.json` entry:

```json
{
  "id": "com.author.foo",
  "latest": "1.2.0",
  "verified": true,
  "manifest": "apps/com.author.foo/1.2.0/hublo.app.json",
  "sha256": "<package hash>"
}
```

**Submission flow:** fork → add `apps/<id>/<version>/` + a `registry.json` entry → open PR → **CI validates** (schema, hash matches the bundle, bundle-size cap, static scan for obviously-dangerous patterns) → **maintainer reviews** → merge. Reviewed apps get `verified: true`; others stay `verified: false` (community tier, v1-sandbox only). The Hublo gateway reads `registry.json` from the official repo to populate the store.

## Per-user install state — `~/.hublo/apps.json`

```json
{
  "installed": [
    { "id": "com.author.foo", "version": "1.2.0",
      "grants": ["fs.read:pick", "http"], "installedAt": "2026-06-28T..." }
  ]
}
```

## Gateway changes

- `GET  /api/store/catalog` — fetch + cache `registry.json`, return the list (with `verified` flags).
- `POST /api/store/install` `{id, version, grants}` — download the package, **verify `sha256`**, store in `~/.hublo/apps/<id>/<version>/`, record in `apps.json`.
- `POST /api/store/uninstall` `{id}` — remove from `apps.json` (and optionally purge data).
- Serve `/apps/<id>/<version>/*` from the user's `~/.hublo/apps/` with a **strict per-app CSP** header. Same-origin serving keeps the core CSP (`script-src 'self'`) intact — no third-party script origins.

## Frontend changes

- **Store app** (new built-in 🛍️): browse catalog, verified/community tabs, per-app capability list, Install/Remove, update notifications.
- **Sandbox host component**: renders an installed app inside the sandboxed iframe, owns the bridge, enforces grants, brokers SDK calls.
- **Dock/launcher**: renders built-ins + the user's installed apps.

## No dependency manager — by design

A transitive resolver (npm-style) is the classic supply-chain attack surface; we avoid it.

- **Self-contained bundles**: each app bundles its own libs at build time. The store serves the final bundle. No runtime resolution.
- **Versioned host SDK**: heavy shared libs already shipped by the core (Vue runtime, Monaco, xterm) are exposed as **platform APIs** via the bridge. Apps **target "Hublo SDK v1"** rather than declaring dependencies.
- **App→app needs** = a `requires: ["id"]` presence check in the manifest, not version resolution.

## Phased roadmap

| Phase | Scope | New security surface |
|---|---|---|
| **v0 — curated store** | `hublo-apps` repo + catalog; core apps stay compiled in; "install" = enable/disable per user in `apps.json`; Store UI + dock integration. Validates UX, registry format, per-user state. | **None** (security = PR review, already in place). |
| **v1 — sandbox runtime** | Sandbox iframe host + bridge + SDK; capability grants + consent UI; dynamic package fetch/verify/serve + per-app CSP; community (unverified) tier. | The bulk of the store's security work. |
| **v2 — backend extensions** *(only if needed)* | Out-of-process community server primitives (worker/container, dropped privileges) — **never in the gateway**. | Heavy; deferred. |

Built-in apps remain "verified, pre-installed"; nothing breaks, migration is gradual.

## Store-specific security checklist

- iframe `sandbox` without `allow-same-origin`; per-app CSP `default-src 'none'`.
- packages pinned by `sha256`, verified on install; size caps; CI validation.
- bridge enforces grants + path scoping in the trusted parent; sensitive caps flagged; capability-expanding updates require re-consent.
- unverified apps are opt-in and clearly marked; verified tier reviewed by maintainers.
- audit log gains `app-id` on every mediated action.
- **no community backend code**; registry sourced from the official PR-reviewed repo.

## Open questions (decide before/while building v1)

- **Signing**: who holds the signing key for verified apps? (v1 can start hash-only + repo-trust; add signatures later.)
- **Maintainer/reviewer set** and a rough review SLA for PRs.
- **Auto-update** policy for installed apps (notify; re-consent on new capabilities).
- **Uninstall** — purge app data by default, or keep it?
