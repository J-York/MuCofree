# Share Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight fixed-label share reactions to the plaza feed and user profile shares without introducing realtime infrastructure, comment moderation, or heavy server load.

**Architecture:** Keep the existing `shares` model intact and add a small `share_reactions` table keyed by `(share_id, user_id)`. Extend the existing share read endpoints to include aggregated reaction counts and the current viewer's selected reaction, then render a reusable `ShareReactionBar` component in the two approved surfaces with optimistic UI updates backed by tested helper logic.

**Tech Stack:** Express, SQLite (`better-sqlite3`), Zod, React 18, Vite, TypeScript, Vitest, React Testing Library, Supertest

---

## File Map

**Modify**

- `package.json`
- `package-lock.json`
- `apps/api/package.json`
- `apps/api/src/db.ts`
- `apps/api/src/index.ts`
- `apps/web/package.json`
- `apps/web/src/api.ts`
- `apps/web/src/pages/PlazaPage.tsx`
- `apps/web/src/pages/UserPage.tsx`
- `apps/web/src/styles.css`

**Create**

- `apps/api/vitest.config.ts`
- `apps/api/src/db.smoke.test.ts`
- `apps/api/src/share-reactions.ts`
- `apps/api/src/share-reactions.test.ts`
- `apps/web/vitest.config.ts`
- `apps/web/src/test/setup.ts`
- `apps/web/src/utils.test.ts`
- `apps/web/src/share-reactions.ts`
- `apps/web/src/share-reactions.test.ts`
- `apps/web/src/components/ShareReactionBar.tsx`
- `apps/web/src/components/ShareReactionBar.test.tsx`

## Implementation Notes

- Keep scope aligned with the approved spec at `docs/superpowers/specs/2026-03-20-share-reactions-design.md`.
- Do not add share-detail pages, notifications, hot sorting, free-text replies, or realtime polling.
- Do not introduce a shared workspace package for reaction constants in this pass; duplicate the small fixed whitelist in API and web code to stay within YAGNI.
- Because the repo currently has no automated tests, the first task adds a minimal but real test harness before feature work begins.

### Task 1: Add Minimal Test Harness

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `apps/api/package.json`
- Modify: `apps/web/package.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/src/db.smoke.test.ts`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/test/setup.ts`
- Create: `apps/web/src/utils.test.ts`

- [ ] **Step 1: Add test scripts and dev dependencies**

Update the workspace scripts so later tasks can run app-local and root-level tests:

```json
// package.json
{
  "scripts": {
    "test": "npm -w @music-share/api run test && npm -w @music-share/web run test"
  }
}
```

```json
// apps/api/package.json
{
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.3",
    "vitest": "^2.1.0"
  }
}
```

```json
// apps/web/package.json
{
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "jsdom": "^25.0.1",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Add Vitest config files**

Create lightweight configs instead of overloading Vite config:

```ts
// apps/api/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
```

```ts
// apps/web/vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"]
  }
});
```

```ts
// apps/web/src/test/setup.ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Install dependencies and update the lockfile**

Run:

```bash
npm install
```

Expected: `package-lock.json` updates to include Vitest, Testing Library, JSDOM, and Supertest.

- [ ] **Step 4: Add smoke tests that prove the harness works**

```ts
// apps/api/src/db.smoke.test.ts
import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";
import { openDb } from "./db.js";

describe("openDb", () => {
  it("creates the core tables", () => {
    const file = path.join(os.tmpdir(), `music-share-smoke-${Date.now()}.sqlite`);
    const db = openDb(file);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining(["users", "shares", "playlist"]));
    db.close();
    rmSync(file, { force: true });
  });
});
```

```ts
// apps/web/src/utils.test.ts
import { describe, expect, it } from "vitest";
import { safeUrl } from "./utils";

describe("safeUrl", () => {
  it("accepts a valid absolute url", () => {
    expect(safeUrl("https://example.com/demo.png")).toBe("https://example.com/demo.png");
  });
});
```

- [ ] **Step 5: Run the smoke tests**

Run:

```bash
npm -w @music-share/api run test -- src/db.smoke.test.ts
npm -w @music-share/web run test -- src/utils.test.ts
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the harness**

Run:

```bash
git add package.json package-lock.json apps/api/package.json apps/api/vitest.config.ts apps/api/src/db.smoke.test.ts apps/web/package.json apps/web/vitest.config.ts apps/web/src/test/setup.ts apps/web/src/utils.test.ts
git commit -m "test: add api and web test harness"
```

### Task 2: Add Backend Reaction Domain and Schema

**Files:**
- Modify: `apps/api/src/db.ts`
- Create: `apps/api/src/share-reactions.ts`
- Create: `apps/api/src/share-reactions.test.ts`

- [ ] **Step 1: Write failing unit tests for reaction helpers**

Create tests for the fixed whitelist and empty count generation first:

```ts
// apps/api/src/share-reactions.test.ts
import { describe, expect, it } from "vitest";
import { createEmptyReactionCounts, reactionKeys, reactionSchema } from "./share-reactions.js";

describe("share reaction domain", () => {
  it("exposes the approved fixed reaction whitelist", () => {
    expect(reactionKeys).toEqual(["slacking", "boost", "healing", "after_work", "loop"]);
    expect(reactionSchema.parse("boost")).toBe("boost");
  });

  it("builds a zeroed count object for every reaction key", () => {
    expect(createEmptyReactionCounts()).toEqual({
      slacking: 0,
      boost: 0,
      healing: 0,
      after_work: 0,
      loop: 0
    });
  });
});
```

- [ ] **Step 2: Run the new test to confirm it fails**

Run:

```bash
npm -w @music-share/api run test -- src/share-reactions.test.ts
```

Expected: FAIL because `share-reactions.ts` does not exist yet.

- [ ] **Step 3: Implement the reaction domain module and schema migration**

Create the fixed whitelist in `apps/api/src/share-reactions.ts`:

```ts
import { z } from "zod";

export const reactionKeys = ["slacking", "boost", "healing", "after_work", "loop"] as const;
export const reactionSchema = z.enum(reactionKeys);
export type ReactionKey = z.infer<typeof reactionSchema>;
export type ReactionCounts = Record<ReactionKey, number>;

export function createEmptyReactionCounts(): ReactionCounts {
  return {
    slacking: 0,
    boost: 0,
    healing: 0,
    after_work: 0,
    loop: 0
  };
}
```

Extend `apps/api/src/db.ts` with the new table and index:

```sql
CREATE TABLE IF NOT EXISTS share_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  share_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  reaction_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (share_id) REFERENCES shares(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (share_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_share_reactions_share_id_reaction_key
  ON share_reactions (share_id, reaction_key);
```

- [ ] **Step 4: Re-run the helper tests**

Run:

```bash
npm -w @music-share/api run test -- src/share-reactions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the backend reaction domain**

Run:

```bash
git add apps/api/src/db.ts apps/api/src/share-reactions.ts apps/api/src/share-reactions.test.ts
git commit -m "feat(api): add share reaction schema"
```

### Task 3: Add Backend Reaction Endpoints and Read Models

**Files:**
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/share-reactions.test.ts`

- [ ] **Step 1: Extend the API test file with failing integration cases**

Add Supertest integration coverage around the approved behavior:

```ts
import request from "supertest";
import os from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "./db.js";
import { createApp } from "./index.js";

describe("share reactions API", () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let file: string;

  beforeEach(() => {
    file = path.join(os.tmpdir(), `music-share-reactions-${Date.now()}.sqlite`);
    db = openDb(file);
    app = createApp(db, "http://127.0.0.1:3001", "http://127.0.0.1:5173", "test-secret", false, false);
  });

  afterEach(() => {
    db.close();
    rmSync(file, { force: true });
  });

  it("creates, switches, and removes a reaction while keeping feed counts in sync", async () => {
    const owner = request.agent(app);
    const viewer = request.agent(app);

    await owner.post("/api/auth/register").send({ username: "alice", password: "password123", name: "Alice" }).expect(201);
    const shareRes = await owner.post("/api/shares").send({ songMid: "001", songTitle: "Song A" }).expect(201);
    const shareId = shareRes.body.share.id;

    await viewer.post("/api/auth/register").send({ username: "bob", password: "password123", name: "Bob" }).expect(201);
    await viewer.put(`/api/shares/${shareId}/reaction`).send({ reactionKey: "boost" }).expect(200);
    await viewer.put(`/api/shares/${shareId}/reaction`).send({ reactionKey: "loop" }).expect(200);
    await viewer.delete(`/api/shares/${shareId}/reaction`).expect(200);

    const feed = await viewer.get("/api/shares/feed").expect(200);
    expect(feed.body.items[0].reactionCounts.loop).toBe(0);
    expect(feed.body.items[0].viewerReactionKey).toBeNull();
  });

  it("rejects invalid keys and owner self-reactions", async () => {
    // same setup, then expect 400 and 403
  });
});
```

- [ ] **Step 2: Run the integration tests to verify the routes are still missing**

Run:

```bash
npm -w @music-share/api run test -- src/share-reactions.test.ts
```

Expected: FAIL with missing `createApp` export and missing reaction routes / response fields.

- [ ] **Step 3: Implement testable app creation and reaction endpoint logic**

Make `createApp` importable from `apps/api/src/index.ts` and keep the listener only in the CLI bootstrap path:

```ts
import { pathToFileURL } from "node:url";

export function createApp(/* existing args */) {
  // existing body
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = getEnv();
  const db = openDb(env.DATABASE_PATH);
  const app = createApp(db, env.QQMUSIC_BASE_URL, env.CORS_ORIGIN, env.SESSION_SECRET, env.SECURE_COOKIE, env.TRUST_PROXY);
  app.listen(env.PORT, () => {
    console.log(`[api] listening on http://127.0.0.1:${env.PORT}`);
  });
}
```

Add reaction helpers in `apps/api/src/index.ts`:

```ts
type ShareReactionRow = {
  share_id: number;
  reaction_key: ReactionKey;
  total: number;
};

function dbReactionCountsForShares(db: Db, shareIds: number[]) {
  if (!shareIds.length) return [];
  const placeholders = shareIds.map(() => "?").join(", ");
  return db.prepare(`
    SELECT share_id, reaction_key, COUNT(*) AS total
    FROM share_reactions
    WHERE share_id IN (${placeholders})
    GROUP BY share_id, reaction_key
  `).all(...shareIds) as ShareReactionRow[];
}
```

Add authenticated viewer lookup, upsert, and delete helpers:

```ts
db.prepare(`
  INSERT INTO share_reactions (share_id, user_id, reaction_key)
  VALUES (?, ?, ?)
  ON CONFLICT(share_id, user_id)
  DO UPDATE SET reaction_key = excluded.reaction_key, updated_at = datetime('now')
`).run(shareId, userId, reactionKey);
```

Add routes:

```ts
app.put("/api/shares/:shareId/reaction", requireAuth, (req, res, next) => { /* validate, forbid owner, upsert, return ok */ });
app.delete("/api/shares/:shareId/reaction", requireAuth, (req, res, next) => { /* delete current user's reaction */ });
```

Extend `dbSharesFeed` and `dbUserShares` responses by merging in:

- `reactionCounts`
- `viewerReactionKey`

Keep the read path batched per page, not per share.

- [ ] **Step 4: Re-run the API integration tests**

Run:

```bash
npm -w @music-share/api run test -- src/share-reactions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run backend typecheck**

Run:

```bash
npm -w @music-share/api run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the backend API work**

Run:

```bash
git add apps/api/src/index.ts apps/api/src/share-reactions.test.ts
git commit -m "feat(api): add share reaction endpoints"
```

### Task 4: Add Frontend Reaction Domain, Types, and Optimistic State Helpers

**Files:**
- Modify: `apps/web/src/api.ts`
- Create: `apps/web/src/share-reactions.ts`
- Create: `apps/web/src/share-reactions.test.ts`

- [ ] **Step 1: Write failing tests for optimistic reaction state transitions**

Create tests around a pure helper instead of page-level state first:

```ts
import { describe, expect, it } from "vitest";
import { applyOptimisticReaction, createEmptyReactionCounts } from "./share-reactions";

describe("applyOptimisticReaction", () => {
  it("adds a new reaction when the viewer had none", () => {
    const next = applyOptimisticReaction({
      reactionCounts: createEmptyReactionCounts(),
      viewerReactionKey: null
    }, "boost");

    expect(next.viewerReactionKey).toBe("boost");
    expect(next.reactionCounts.boost).toBe(1);
  });

  it("switches counts when the viewer changes reactions", () => {
    const next = applyOptimisticReaction({
      reactionCounts: { slacking: 0, boost: 1, healing: 0, after_work: 0, loop: 0 },
      viewerReactionKey: "boost"
    }, "loop");

    expect(next.reactionCounts.boost).toBe(0);
    expect(next.reactionCounts.loop).toBe(1);
    expect(next.viewerReactionKey).toBe("loop");
  });

  it("removes the reaction when the same key is clicked twice", () => {
    const next = applyOptimisticReaction({
      reactionCounts: { slacking: 0, boost: 1, healing: 0, after_work: 0, loop: 0 },
      viewerReactionKey: "boost"
    }, "boost");

    expect(next.viewerReactionKey).toBeNull();
    expect(next.reactionCounts.boost).toBe(0);
  });
});
```

- [ ] **Step 2: Run the web helper tests to confirm they fail**

Run:

```bash
npm -w @music-share/web run test -- src/share-reactions.test.ts
```

Expected: FAIL because the helper module does not exist yet.

- [ ] **Step 3: Implement frontend reaction types, API helpers, and optimistic helper logic**

Create `apps/web/src/share-reactions.ts`:

```ts
export const reactionOptions = [
  { key: "slacking", emoji: "😮‍💨", label: "摸鱼神曲" },
  { key: "boost", emoji: "⚡", label: "提神" },
  { key: "healing", emoji: "🌤", label: "治愈" },
  { key: "after_work", emoji: "🚇", label: "下班路上" },
  { key: "loop", emoji: "🔁", label: "单曲循环" }
] as const;

export type ReactionKey = typeof reactionOptions[number]["key"];
export type ReactionCounts = Record<ReactionKey, number>;

export function createEmptyReactionCounts(): ReactionCounts {
  return { slacking: 0, boost: 0, healing: 0, after_work: 0, loop: 0 };
}

export function applyOptimisticReaction(
  current: { reactionCounts: ReactionCounts; viewerReactionKey: ReactionKey | null },
  clickedKey: ReactionKey
) {
  // increment, decrement, or clear based on current selection
}
```

Extend `apps/web/src/api.ts`:

```ts
import type { ReactionCounts, ReactionKey } from "./share-reactions";

export type Share = {
  // existing fields...
  reactionCounts: ReactionCounts;
  viewerReactionKey: ReactionKey | null;
};

export async function apiSetShareReaction(shareId: number, reactionKey: ReactionKey): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/shares/${shareId}/reaction`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reactionKey }),
    credentials: "include"
  });
  return readJson<{ ok: boolean }>(res);
}

export async function apiDeleteShareReaction(shareId: number): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/shares/${shareId}/reaction`, {
    method: "DELETE",
    credentials: "include"
  });
  return readJson<{ ok: boolean }>(res);
}
```

- [ ] **Step 4: Re-run the helper tests**

Run:

```bash
npm -w @music-share/web run test -- src/share-reactions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the frontend reaction domain**

Run:

```bash
git add apps/web/src/api.ts apps/web/src/share-reactions.ts apps/web/src/share-reactions.test.ts
git commit -m "feat(web): add share reaction state helpers"
```

### Task 5: Build a Reusable ShareReactionBar Component

**Files:**
- Create: `apps/web/src/components/ShareReactionBar.tsx`
- Create: `apps/web/src/components/ShareReactionBar.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write a failing component test**

Create a focused render test:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ShareReactionBar from "./ShareReactionBar";

describe("ShareReactionBar", () => {
  it("renders counts, highlights the selected key, and disables while pending", () => {
    const onSelect = vi.fn();

    render(
      <ShareReactionBar
        reactionCounts={{ slacking: 0, boost: 3, healing: 1, after_work: 0, loop: 2 }}
        viewerReactionKey="boost"
        disabled={false}
        pending={false}
        onSelect={onSelect}
      />
    );

    expect(screen.getByRole("button", { name: /提神 3/i })).toHaveAttribute("data-active", "true");
    fireEvent.click(screen.getByRole("button", { name: /单曲循环 2/i }));
    expect(onSelect).toHaveBeenCalledWith("loop");
  });
});
```

- [ ] **Step 2: Run the component test and watch it fail**

Run:

```bash
npm -w @music-share/web run test -- src/components/ShareReactionBar.test.tsx
```

Expected: FAIL because the component does not exist yet.

- [ ] **Step 3: Implement the component and styles**

Build a small reusable component:

```tsx
type Props = {
  reactionCounts: ReactionCounts;
  viewerReactionKey: ReactionKey | null;
  disabled?: boolean;
  pending?: boolean;
  onSelect: (key: ReactionKey) => void;
};

export default function ShareReactionBar({ reactionCounts, viewerReactionKey, disabled, pending, onSelect }: Props) {
  return (
    <div className="share-reaction-bar" aria-label="分享回应">
      {reactionOptions.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`share-reaction-chip ${viewerReactionKey === option.key ? "is-active" : ""}`}
          data-active={viewerReactionKey === option.key ? "true" : "false"}
          disabled={disabled || pending}
          onClick={() => onSelect(option.key)}
        >
          <span>{option.emoji}</span>
          <span>{option.label}</span>
          <span>{reactionCounts[option.key]}</span>
        </button>
      ))}
    </div>
  );
}
```

Add supporting CSS in `apps/web/src/styles.css`:

```css
.share-reaction-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.share-reaction-chip {
  border: 1px solid var(--warm-300);
  background: var(--cream);
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
}

.share-reaction-chip.is-active {
  border-color: var(--gold);
  background: var(--gold-soft);
}
```

- [ ] **Step 4: Re-run the component test**

Run:

```bash
npm -w @music-share/web run test -- src/components/ShareReactionBar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the reaction bar**

Run:

```bash
git add apps/web/src/components/ShareReactionBar.tsx apps/web/src/components/ShareReactionBar.test.tsx apps/web/src/styles.css
git commit -m "feat(web): add share reaction bar component"
```

### Task 6: Wire Reactions into Plaza and User Pages

**Files:**
- Modify: `apps/web/src/pages/PlazaPage.tsx`
- Modify: `apps/web/src/pages/UserPage.tsx`

- [ ] **Step 1: Add a failing helper assertion for the owner/no-auth edge cases**

Extend `apps/web/src/share-reactions.test.ts` to lock in the final interaction contract:

```ts
it("leaves state unchanged when the caller should not be allowed to react", () => {
  const current = {
    reactionCounts: createEmptyReactionCounts(),
    viewerReactionKey: null
  };

  expect(applyOptimisticReaction(current, "boost", { canReact: false })).toEqual(current);
});
```

- [ ] **Step 2: Run the helper test to confirm the new edge case fails**

Run:

```bash
npm -w @music-share/web run test -- src/share-reactions.test.ts
```

Expected: FAIL because `applyOptimisticReaction` does not yet honor a `canReact` guard.

- [ ] **Step 3: Update the helper, then wire the plaza page**

In `apps/web/src/share-reactions.ts`, extend the helper:

```ts
export function applyOptimisticReaction(current, clickedKey, options?: { canReact?: boolean }) {
  if (options?.canReact === false) return current;
  // existing toggle logic
}
```

In `apps/web/src/pages/PlazaPage.tsx`:

- add `reactionPendingIds` state
- import `ShareReactionBar`, `applyOptimisticReaction`, `apiSetShareReaction`, and `apiDeleteShareReaction`
- gate reactions for anonymous users and owners
- update the clicked share optimistically, then call `PUT` or `DELETE`
- roll back on error and reuse the page toast

The core wiring should look like:

```tsx
<ShareReactionBar
  reactionCounts={sh.reactionCounts}
  viewerReactionKey={sh.viewerReactionKey}
  disabled={!me || me.id === sh.userId}
  pending={reactionPendingIds.has(sh.id)}
  onSelect={(key) => void handleReactionClick(sh, key)}
/>;
```

- [ ] **Step 4: Wire the user page using the same component**

Render the same component below the share comment/timestamp block in `apps/web/src/pages/UserPage.tsx`, reusing the same optimistic helper and API calls so both pages behave identically. Use the same disabled rules:

- not logged in: disabled
- owner viewing own share: disabled
- other logged-in viewers: enabled

- [ ] **Step 5: Run the full web test suite and typecheck**

Run:

```bash
npm -w @music-share/web run test
npm -w @music-share/web run typecheck
```

Expected: PASS.

- [ ] **Step 6: Perform manual regression in the browser**

Run:

```bash
npm run dev
```

Verify:

- owner sees reaction counts but cannot click their own share
- another logged-in user can add, switch, and clear reactions on plaza cards
- the same counts show on the user profile share list
- failed requests roll back and show the existing toast UI
- existing play / add-to-playlist / delete-share actions still work

- [ ] **Step 7: Run final repo-wide verification**

Run:

```bash
npm run test
npm run typecheck
npm run build
```

Expected: all commands PASS.

- [ ] **Step 8: Commit the page integration**

Run:

```bash
git add apps/web/src/share-reactions.ts apps/web/src/share-reactions.test.ts apps/web/src/pages/PlazaPage.tsx apps/web/src/pages/UserPage.tsx
git commit -m "feat(web): wire share reactions into plaza and profile pages"
```

## Ready-to-Use Commands

Use these commands during execution:

```bash
npm install
npm -w @music-share/api run test -- src/share-reactions.test.ts
npm -w @music-share/api run typecheck
npm -w @music-share/web run test -- src/share-reactions.test.ts
npm -w @music-share/web run test -- src/components/ShareReactionBar.test.tsx
npm -w @music-share/web run typecheck
npm run test
npm run typecheck
npm run build
```
