import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "./db.js";
import { createApp } from "./index.js";
import { createEmptyReactionCounts, reactionKeys, reactionSchema } from "./share-reactions.js";

describe("share reactions domain", () => {
  it("exposes the fixed reaction whitelist", () => {
    expect(reactionKeys).toEqual(["slacking", "boost", "healing", "after_work", "loop"]);
  });

  it("parses a valid reaction key", () => {
    expect(reactionSchema.parse("boost")).toBe("boost");
  });

  it("rejects an invalid reaction key", () => {
    expect(() => reactionSchema.parse("invalid_key")).toThrow();
  });

  it("creates empty reaction counts with all keys set to zero", () => {
    expect(createEmptyReactionCounts()).toEqual({
      slacking: 0,
      boost: 0,
      healing: 0,
      after_work: 0,
      loop: 0,
    });
  });
});

const tempDirs: string[] = [];

type RegisteredUser = {
  id: number;
  username: string;
};

describe("share reactions api", () => {
  let db: Db;
  let ownerAgent: request.SuperAgentTest;
  let viewerAgent: request.SuperAgentTest;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "music-share-reactions-"));
    tempDirs.push(tempDir);

    db = openDb(path.join(tempDir, "test.sqlite"));
    const app = createApp(
      db,
      "http://127.0.0.1:65535",
      "http://127.0.0.1:3000",
      "test-session-secret",
      false,
      false,
    );

    ownerAgent = request.agent(app);
    viewerAgent = request.agent(app);
  });

  afterEach(() => {
    db.close();

    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function registerUser(
    agent: request.SuperAgentTest,
    username: string,
    name: string,
  ): Promise<RegisteredUser> {
    const response = await agent.post("/api/auth/register").send({
      username,
      password: "password123",
      name,
    });

    expect(response.status).toBe(201);

    return {
      id: response.body.user.id as number,
      username: response.body.user.username as string,
    };
  }

  async function createShare(agent: request.SuperAgentTest) {
    const response = await agent.post("/api/shares").send({
      songMid: "song_mid_owner",
      songTitle: "Owner Song",
      singerName: "Owner Singer",
      albumMid: "album_mid_owner",
      albumName: "Owner Album",
      coverUrl: "https://example.com/cover.jpg",
      comment: "hello",
    });

    expect(response.status).toBe(201);
    return response.body.share as { id: number; userId: number };
  }

  it("lets a viewer set, switch, and clear a reaction while exposing read-model fields", async () => {
    const owner = await registerUser(ownerAgent, "owner_user", "Owner User");
    const share = await createShare(ownerAgent);
    const viewer = await registerUser(viewerAgent, "viewer_user", "Viewer User");

    const initialFeedResponse = await viewerAgent.get("/api/shares/feed");
    expect(initialFeedResponse.status).toBe(200);
    expect(initialFeedResponse.body.items).toHaveLength(1);
    expect(initialFeedResponse.body.items[0]).toMatchObject({
      id: share.id,
      userId: owner.id,
      userName: "Owner User",
      reactionCounts: createEmptyReactionCounts(),
      viewerReactionKey: null,
    });

    const initialUserSharesResponse = await viewerAgent.get(`/api/users/${owner.id}/shares`);
    expect(initialUserSharesResponse.status).toBe(200);
    expect(initialUserSharesResponse.body.shares).toHaveLength(1);
    expect(initialUserSharesResponse.body.shares[0]).toMatchObject({
      id: share.id,
      reactionCounts: createEmptyReactionCounts(),
      viewerReactionKey: null,
    });

    const setReactionResponse = await viewerAgent.put(`/api/shares/${share.id}/reaction`).send({
      reactionKey: "boost",
    });
    expect(setReactionResponse.status).toBe(200);
    expect(setReactionResponse.body).toEqual({ ok: true });

    const switchedReactionResponse = await viewerAgent
      .put(`/api/shares/${share.id}/reaction`)
      .send({ reactionKey: "loop" });
    expect(switchedReactionResponse.status).toBe(200);
    expect(switchedReactionResponse.body).toEqual({ ok: true });

    const feedAfterSwitchResponse = await viewerAgent.get("/api/shares/feed");
    expect(feedAfterSwitchResponse.status).toBe(200);
    expect(feedAfterSwitchResponse.body.items[0]).toMatchObject({
      id: share.id,
      reactionCounts: {
        ...createEmptyReactionCounts(),
        loop: 1,
      },
      viewerReactionKey: "loop",
    });

    const userSharesAfterSwitchResponse = await viewerAgent.get(`/api/users/${owner.id}/shares`);
    expect(userSharesAfterSwitchResponse.status).toBe(200);
    expect(userSharesAfterSwitchResponse.body.shares[0]).toMatchObject({
      id: share.id,
      reactionCounts: {
        ...createEmptyReactionCounts(),
        loop: 1,
      },
      viewerReactionKey: "loop",
    });

    const clearReactionResponse = await viewerAgent.delete(`/api/shares/${share.id}/reaction`);
    expect(clearReactionResponse.status).toBe(200);
    expect(clearReactionResponse.body).toEqual({ ok: true });

    const feedAfterClearResponse = await viewerAgent.get("/api/shares/feed");
    expect(feedAfterClearResponse.status).toBe(200);
    expect(feedAfterClearResponse.body.items[0]).toMatchObject({
      id: share.id,
      reactionCounts: createEmptyReactionCounts(),
      viewerReactionKey: null,
    });

    const userSharesAfterClearResponse = await viewerAgent.get(`/api/users/${owner.id}/shares`);
    expect(userSharesAfterClearResponse.status).toBe(200);
    expect(userSharesAfterClearResponse.body.shares[0]).toMatchObject({
      id: share.id,
      reactionCounts: createEmptyReactionCounts(),
      viewerReactionKey: null,
    });

    expect(viewer.username).toBe("viewer_user");
  });

  it("rejects invalid reaction keys", async () => {
    await registerUser(ownerAgent, "owner_invalid", "Owner Invalid");
    const share = await createShare(ownerAgent);
    await registerUser(viewerAgent, "viewer_invalid", "Viewer Invalid");

    const response = await viewerAgent.put(`/api/shares/${share.id}/reaction`).send({
      reactionKey: "invalid_key",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Invalid request");
  });

  it("rejects owners reacting to their own shares", async () => {
    await registerUser(ownerAgent, "owner_self", "Owner Self");
    const share = await createShare(ownerAgent);

    const response = await ownerAgent.put(`/api/shares/${share.id}/reaction`).send({
      reactionKey: "boost",
    });

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe("Forbidden");
  });
});
