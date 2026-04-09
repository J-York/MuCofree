import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "./db.js";
import { createApp } from "./index.js";
import { createCsrfAgent } from "./test-helpers.js";

const tempDirs: string[] = [];

type PlaylistPayload = {
  id: string;
  revision: number;
};

describe("playlist sharing api", () => {
  let db: Db;
  let app: express.Express;
  let ownerClient: ReturnType<typeof createCsrfAgent>;
  let viewerClient: ReturnType<typeof createCsrfAgent>;
  let editorClient: ReturnType<typeof createCsrfAgent>;
  let ownerAgent: request.SuperAgentTest;
  let viewerAgent: request.SuperAgentTest;
  let editorAgent: request.SuperAgentTest;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "music-share-playlist-sharing-"));
    tempDirs.push(tempDir);

    db = openDb(path.join(tempDir, "test.sqlite"));
    app = createApp(
      db,
      "http://127.0.0.1:65535",
      "http://127.0.0.1:3000",
      "test-session-secret",
      false,
      false,
    );

    ownerClient = createCsrfAgent(app);
    viewerClient = createCsrfAgent(app);
    editorClient = createCsrfAgent(app);
    ownerAgent = ownerClient.agent;
    viewerAgent = viewerClient.agent;
    editorAgent = editorClient.agent;
  });

  afterEach(() => {
    db.close();
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function register(
    agent: request.SuperAgentTest,
    username: string,
    setToken: (token: string | null) => void,
  ) {
    const response = await agent.post("/api/auth/register").send({
      username,
      password: "password123",
      name: username,
    });

    expect(response.status).toBe(201);
    setToken(response.body.csrfToken as string | null);
    return response.body.user as { id: number; username: string };
  }

  async function createPlaylist(agent: request.SuperAgentTest, name: string) {
    const response = await agent.post("/api/playlists").send({ name });
    expect(response.status).toBe(201);
    return response.body.playlist as PlaylistPayload;
  }

  async function addSong(
    agent: request.SuperAgentTest,
    playlistId: string,
    songMid: string,
    expectedRevision: number,
  ) {
    const response = await agent.post(`/api/playlists/${playlistId}/items`).send({
      songMid,
      songTitle: songMid,
      singerName: "Singer",
      expectedRevision,
    });
    return response;
  }

  it("requires login for share access and supports read-only join + revoke", async () => {
    await register(ownerAgent, "share_owner", ownerClient.setCsrfToken);
    await register(viewerAgent, "share_viewer", viewerClient.setCsrfToken);

    const playlist = await createPlaylist(ownerAgent, "Shareable");
    const addSongResponse = await addSong(ownerAgent, playlist.id, "share-song-1", playlist.revision);
    expect(addSongResponse.status).toBe(201);

    const createLinkResponse = await ownerAgent.post(`/api/playlists/${playlist.id}/share-links`).send({
      scope: "read",
      expiresInHours: 12,
    });
    expect(createLinkResponse.status).toBe(201);

    const token = createLinkResponse.body.token as string;
    const linkId = createLinkResponse.body.link.id as number;

    const unauthenticatedResolve = await request(app).get(`/api/playlists/share/${token}`);
    expect(unauthenticatedResolve.status).toBe(401);

    const viewerResolveBeforeJoin = await viewerAgent.get(`/api/playlists/share/${token}`);
    expect(viewerResolveBeforeJoin.status).toBe(200);
    expect(viewerResolveBeforeJoin.body).toMatchObject({ requiresJoin: true, canRead: false });

    const joinResponse = await viewerAgent.post(`/api/playlists/share/${token}/join`);
    expect(joinResponse.status).toBe(200);
    expect(joinResponse.body.membership).toMatchObject({ role: "viewer", status: "active" });

    const viewerResolveAfterJoin = await viewerAgent.get(`/api/playlists/share/${token}`);
    expect(viewerResolveAfterJoin.status).toBe(200);
    expect(viewerResolveAfterJoin.body).toMatchObject({ requiresJoin: false, canRead: true, canEdit: false });

    const viewerItemsResponse = await viewerAgent.get(`/api/playlists/${playlist.id}/items`);
    expect(viewerItemsResponse.status).toBe(200);
    expect(viewerItemsResponse.body.items).toHaveLength(1);

    const revokeResponse = await ownerAgent.delete(`/api/playlists/share-links/${linkId}`);
    expect(revokeResponse.status).toBe(200);

    const viewerResolveAfterRevoke = await viewerAgent.get(`/api/playlists/share/${token}`);
    expect(viewerResolveAfterRevoke.status).toBe(410);
  });

  it("uses pending editor flow and surfaces revision conflicts", async () => {
    const owner = await register(ownerAgent, "collab_owner", ownerClient.setCsrfToken);
    const editor = await register(editorAgent, "collab_editor", editorClient.setCsrfToken);

    const playlist = await createPlaylist(ownerAgent, "Collab Playlist");

    const createEditLinkResponse = await ownerAgent.post(`/api/playlists/${playlist.id}/share-links`).send({
      scope: "edit",
      expiresInHours: 12,
    });
    expect(createEditLinkResponse.status).toBe(201);
    const token = createEditLinkResponse.body.token as string;

    const joinResponse = await editorAgent.post(`/api/playlists/share/${token}/join`);
    expect(joinResponse.status).toBe(200);
    expect(joinResponse.body.membership).toMatchObject({ role: "editor", status: "pending" });

    const pendingEditAttempt = await addSong(
      editorAgent,
      playlist.id,
      "pending-edit-song",
      joinResponse.body.playlist.revision as number,
    );
    expect(pendingEditAttempt.status).toBe(404);

    const approvalResponse = await ownerAgent.patch(`/api/playlists/${playlist.id}/members/${editor.id}`).send({
      role: "editor",
      status: "active",
      expectedRevision: joinResponse.body.playlist.revision,
    });
    expect(approvalResponse.status).toBe(200);

    const approvedRevision = approvalResponse.body.revision as number;

    const staleWriteResponse = await addSong(editorAgent, playlist.id, "stale-write-song", approvedRevision - 1);
    expect(staleWriteResponse.status).toBe(409);

    const successfulWriteResponse = await addSong(editorAgent, playlist.id, "approved-write-song", approvedRevision);
    expect(successfulWriteResponse.status).toBe(201);

    const ownerDetailResponse = await ownerAgent.get(`/api/playlists/${playlist.id}`);
    expect(ownerDetailResponse.status).toBe(200);
    const members = ownerDetailResponse.body.members as Array<{ userId: number; role: string; status: string }>;
    const approvedMember = members.find((member) => member.userId === editor.id);
    expect(approvedMember).toMatchObject({ role: "editor", status: "active" });

    expect(owner.id).toBeGreaterThan(0);
  });

  it("rejects expired share links", async () => {
    await register(ownerAgent, "expired_owner", ownerClient.setCsrfToken);
    await register(viewerAgent, "expired_viewer", viewerClient.setCsrfToken);

    const playlist = await createPlaylist(ownerAgent, "Expiring Playlist");

    const createLinkResponse = await ownerAgent.post(`/api/playlists/${playlist.id}/share-links`).send({
      scope: "read",
      expiresInHours: 1,
    });
    expect(createLinkResponse.status).toBe(201);

    const token = createLinkResponse.body.token as string;
    const linkId = createLinkResponse.body.link.id as number;

    db.prepare("UPDATE playlist_share_links SET expires_at = datetime('now', '-1 hour') WHERE id = ?").run(linkId);

    const resolveExpiredResponse = await viewerAgent.get(`/api/playlists/share/${token}`);
    expect(resolveExpiredResponse.status).toBe(410);
  });

  it("only allows sharing songs from an editable playlist", async () => {
    await register(ownerAgent, "share_policy_owner", ownerClient.setCsrfToken);
    await register(viewerAgent, "share_policy_viewer", viewerClient.setCsrfToken);

    const playlist = await createPlaylist(ownerAgent, "Share Policy Playlist");
    const addSongResponse = await addSong(ownerAgent, playlist.id, "share-policy-song", playlist.revision);
    expect(addSongResponse.status).toBe(201);

    const createReadLinkResponse = await ownerAgent.post(`/api/playlists/${playlist.id}/share-links`).send({
      scope: "read",
      expiresInHours: 12,
    });
    expect(createReadLinkResponse.status).toBe(201);

    const token = createReadLinkResponse.body.token as string;
    const joinResponse = await viewerAgent.post(`/api/playlists/share/${token}/join`);
    expect(joinResponse.status).toBe(200);

    const viewerShareAttempt = await viewerAgent.post("/api/shares").send({
      playlistId: playlist.id,
      songMid: "share-policy-song",
      comment: "viewer share attempt",
    });
    expect(viewerShareAttempt.status).toBe(403);

    const ownerWrongSongAttempt = await ownerAgent.post("/api/shares").send({
      playlistId: playlist.id,
      songMid: "missing-song",
      comment: "missing song",
    });
    expect(ownerWrongSongAttempt.status).toBe(400);

    const ownerShareAttempt = await ownerAgent.post("/api/shares").send({
      playlistId: playlist.id,
      songMid: "share-policy-song",
      comment: "owner share attempt",
    });
    expect(ownerShareAttempt.status).toBe(201);
    expect(ownerShareAttempt.body.share).toMatchObject({
      songMid: "share-policy-song",
      comment: "owner share attempt",
    });
  });
});
