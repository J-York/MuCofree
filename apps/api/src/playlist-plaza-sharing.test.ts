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

describe("playlist plaza sharing api", () => {
  let db: Db;
  let app: express.Express;
  let ownerClient: ReturnType<typeof createCsrfAgent>;
  let viewerClient: ReturnType<typeof createCsrfAgent>;
  let ownerAgent: request.SuperAgentTest;
  let viewerAgent: request.SuperAgentTest;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "music-share-playlist-plaza-sharing-"));
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
    ownerAgent = ownerClient.agent;
    viewerAgent = viewerClient.agent;
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
      coverUrl: "https://example.com/cover.jpg",
      expectedRevision,
    });
    expect(response.status).toBe(201);
    return response.body as { revision: number };
  }

  async function createReadLink(agent: request.SuperAgentTest, playlistId: string) {
    const response = await agent.post(`/api/playlists/${playlistId}/share-links`).send({
      scope: "read",
      expiresInHours: 12,
    });
    expect(response.status).toBe(201);
    return response.body.token as string;
  }

  it("creates playlist shares for owners and exposes them in plaza stats and feeds", async () => {
    const owner = await register(ownerAgent, "plaza_owner", ownerClient.setCsrfToken);
    await register(viewerAgent, "plaza_viewer", viewerClient.setCsrfToken);

    const playlist = await createPlaylist(ownerAgent, "Office Mix");
    await addSong(ownerAgent, playlist.id, "office-song-1", playlist.revision);

    const createShareResponse = await ownerAgent.post(`/api/playlists/${playlist.id}/shares`).send({
      comment: "适合打工时循环的歌单",
    });
    expect(createShareResponse.status).toBe(201);
    expect(createShareResponse.body.share).toMatchObject({
      playlistId: playlist.id,
      playlistName: "Office Mix",
      itemCount: 1,
      comment: "适合打工时循环的歌单",
    });

    const feedResponse = await request(app).get("/api/playlist-shares/feed");
    expect(feedResponse.status).toBe(200);
    expect(feedResponse.body.items).toHaveLength(1);
    expect(feedResponse.body.items[0]).toMatchObject({
      playlistId: playlist.id,
      playlistName: "Office Mix",
      userId: owner.id,
      userName: "plaza_owner",
      itemCount: 1,
    });

    const userSharesResponse = await viewerAgent.get(`/api/users/${owner.id}/playlist-shares`);
    expect(userSharesResponse.status).toBe(200);
    expect(userSharesResponse.body.shares).toHaveLength(1);
    expect(userSharesResponse.body.total).toBe(1);

    const statsResponse = await request(app).get("/api/plaza/stats");
    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body).toMatchObject({
      totalUsers: 1,
      totalShares: 1,
      songShares: 0,
      playlistShares: 1,
    });

    const sharePath = createShareResponse.body.share.sharePath as string;
    const token = decodeURIComponent(sharePath.split("/").pop() ?? "");
    const resolveResponse = await viewerAgent.get(`/api/playlists/share/${token}`);
    expect(resolveResponse.status).toBe(200);
    expect(resolveResponse.body).toMatchObject({
      requiresJoin: true,
      canRead: false,
    });
  });

  it("rejects empty playlist shares and non-owner playlist shares", async () => {
    await register(ownerAgent, "policy_owner", ownerClient.setCsrfToken);
    await register(viewerAgent, "policy_viewer", viewerClient.setCsrfToken);

    const emptyPlaylist = await createPlaylist(ownerAgent, "Empty Playlist");
    const emptyShareResponse = await ownerAgent.post(`/api/playlists/${emptyPlaylist.id}/shares`).send({
      comment: "空歌单不能分享",
    });
    expect(emptyShareResponse.status).toBe(400);

    const playlist = await createPlaylist(ownerAgent, "Owner Only");
    await addSong(ownerAgent, playlist.id, "owner-only-song", playlist.revision);

    const token = await createReadLink(ownerAgent, playlist.id);
    const joinResponse = await viewerAgent.post(`/api/playlists/share/${token}/join`);
    expect(joinResponse.status).toBe(200);

    const viewerShareResponse = await viewerAgent.post(`/api/playlists/${playlist.id}/shares`).send({
      comment: "viewer share attempt",
    });
    expect(viewerShareResponse.status).toBe(403);
  });

  it("prevents duplicate playlist shares and revokes share access after deletion", async () => {
    const owner = await register(ownerAgent, "duplicate_owner", ownerClient.setCsrfToken);
    await register(viewerAgent, "duplicate_viewer", viewerClient.setCsrfToken);

    const playlist = await createPlaylist(ownerAgent, "Deep Work");
    await addSong(ownerAgent, playlist.id, "deep-work-song", playlist.revision);

    const firstShareResponse = await ownerAgent.post(`/api/playlists/${playlist.id}/shares`).send({
      comment: "专注工作歌单",
    });
    expect(firstShareResponse.status).toBe(201);

    const duplicateShareResponse = await ownerAgent.post(`/api/playlists/${playlist.id}/shares`).send({
      comment: "第二次尝试",
    });
    expect(duplicateShareResponse.status).toBe(409);

    const shareId = firstShareResponse.body.share.id as number;
    const sharePath = firstShareResponse.body.share.sharePath as string;
    const token = decodeURIComponent(sharePath.split("/").pop() ?? "");

    const resolveBeforeDelete = await viewerAgent.get(`/api/playlists/share/${token}`);
    expect(resolveBeforeDelete.status).toBe(200);

    const deleteResponse = await ownerAgent.delete(`/api/playlist-shares/${shareId}`);
    expect(deleteResponse.status).toBe(200);

    const feedAfterDelete = await request(app).get("/api/playlist-shares/feed");
    expect(feedAfterDelete.status).toBe(200);
    expect(feedAfterDelete.body.items).toHaveLength(0);

    const userSharesAfterDelete = await ownerAgent.get(`/api/users/${owner.id}/playlist-shares`);
    expect(userSharesAfterDelete.status).toBe(200);
    expect(userSharesAfterDelete.body.shares).toHaveLength(0);
    expect(userSharesAfterDelete.body.total).toBe(0);

    const resolveAfterDelete = await viewerAgent.get(`/api/playlists/share/${token}`);
    expect(resolveAfterDelete.status).toBe(410);
  });

  it("filters expired playlist shares out of feeds, stats, and user previews", async () => {
    const owner = await register(ownerAgent, "expired_share_owner", ownerClient.setCsrfToken);

    const playlist = await createPlaylist(ownerAgent, "Expired Mix");
    await addSong(ownerAgent, playlist.id, "expired-song-1", playlist.revision);

    const createShareResponse = await ownerAgent.post(`/api/playlists/${playlist.id}/shares`).send({
      comment: "快过期的歌单",
    });
    expect(createShareResponse.status).toBe(201);

    const shareLinkId = createShareResponse.body.share.shareLinkId as number;
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    db.prepare("UPDATE playlist_share_links SET expires_at = ? WHERE id = ?").run(expiredAt, shareLinkId);

    const feedResponse = await request(app).get("/api/playlist-shares/feed");
    expect(feedResponse.status).toBe(200);
    expect(feedResponse.body.items).toHaveLength(0);

    const userSharesResponse = await ownerAgent.get(`/api/users/${owner.id}/playlist-shares`);
    expect(userSharesResponse.status).toBe(200);
    expect(userSharesResponse.body.shares).toHaveLength(0);
    expect(userSharesResponse.body.total).toBe(0);

    const statsResponse = await request(app).get("/api/plaza/stats");
    expect(statsResponse.status).toBe(200);
    expect(statsResponse.body).toMatchObject({
      totalUsers: 0,
      totalShares: 0,
      songShares: 0,
      playlistShares: 0,
    });

    const usersResponse = await request(app).get("/api/users");
    expect(usersResponse.status).toBe(200);
    expect(usersResponse.body).toMatchObject({
      total: 0,
      totalShares: 0,
      songShares: 0,
      playlistShares: 0,
    });
    expect(usersResponse.body.users).toHaveLength(0);
  });

  it("returns the actual latest share type in user previews", async () => {
    await register(ownerAgent, "preview_owner", ownerClient.setCsrfToken);

    const songPlaylist = await createPlaylist(ownerAgent, "Song Source");
    await addSong(ownerAgent, songPlaylist.id, "preview-song-1", songPlaylist.revision);

    const songShareResponse = await ownerAgent.post("/api/shares").send({
      playlistId: songPlaylist.id,
      songMid: "preview-song-1",
      comment: "先分享一首歌",
    });
    expect(songShareResponse.status).toBe(201);
    const songShareId = songShareResponse.body.share.id as number;
    db.prepare("UPDATE shares SET created_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", songShareId);
    db.prepare("UPDATE shares SET cover_url = ? WHERE id = ?").run("https://example.com/song-cover.jpg", songShareId);

    const playlist = await createPlaylist(ownerAgent, "Latest Playlist");
    await addSong(ownerAgent, playlist.id, "preview-playlist-song", playlist.revision);

    const playlistShareResponse = await ownerAgent.post(`/api/playlists/${playlist.id}/shares`).send({
      comment: "后分享整张歌单",
    });
    expect(playlistShareResponse.status).toBe(201);

    const usersResponse = await request(app).get("/api/users");
    expect(usersResponse.status).toBe(200);
    expect(usersResponse.body.users).toHaveLength(1);
    expect(usersResponse.body.users[0]).toMatchObject({
      shareCount: 2,
      songShareCount: 1,
      playlistShareCount: 1,
      latestShareKind: "playlist",
      latestShareTitle: "Latest Playlist",
      latestShareSubtitle: null,
    });
    expect(usersResponse.body.users[0].recentCoverUrls).toEqual([
      "https://example.com/cover.jpg",
      "https://example.com/song-cover.jpg",
    ]);
  });
});
