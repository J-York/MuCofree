import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "./db.js";
import { createApp } from "./index.js";

const tempDirs: string[] = [];

type PlaylistPayload = {
  id: string;
  revision: number;
  isDefault: boolean;
};

describe("playlist api", () => {
  let db: Db;
  let ownerAgent: request.SuperAgentTest;
  let otherAgent: request.SuperAgentTest;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "music-share-playlist-api-"));
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
    otherAgent = request.agent(app);
  });

  afterEach(() => {
    db.close();
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  async function register(agent: request.SuperAgentTest, username: string) {
    const response = await agent.post("/api/auth/register").send({
      username,
      password: "password123",
      name: username,
    });

    expect(response.status).toBe(201);
    return response.body.user as { id: number; username: string };
  }

  async function createPlaylist(agent: request.SuperAgentTest, name: string) {
    const response = await agent.post("/api/playlists").send({ name });
    expect(response.status).toBe(201);
    return response.body.playlist as PlaylistPayload;
  }

  it("supports playlist CRUD and item revision workflow", async () => {
    await register(ownerAgent, "playlist_owner");

    const listBeforeCreate = await ownerAgent.get("/api/playlists");
    expect(listBeforeCreate.status).toBe(200);
    expect(listBeforeCreate.body.items).toHaveLength(1);
    expect(listBeforeCreate.body.items[0]).toMatchObject({ isDefault: true, role: "owner" });

    const created = await createPlaylist(ownerAgent, "Focus");
    let revision = created.revision;

    const patchResponse = await ownerAgent.patch(`/api/playlists/${created.id}`).send({
      name: "Focus Mix",
      description: "for coding",
      visibility: "link_readonly",
      expectedRevision: revision,
    });
    expect(patchResponse.status).toBe(200);
    revision = patchResponse.body.playlist.revision as number;

    const addFirstSongResponse = await ownerAgent.post(`/api/playlists/${created.id}/items`).send({
      songMid: "song-mid-1",
      songTitle: "Song One",
      singerName: "Singer A",
      expectedRevision: revision,
    });
    expect(addFirstSongResponse.status).toBe(201);
    revision = addFirstSongResponse.body.revision as number;

    const duplicateSongResponse = await ownerAgent.post(`/api/playlists/${created.id}/items`).send({
      songMid: "song-mid-1",
      songTitle: "Song One",
      singerName: "Singer A",
      expectedRevision: revision,
    });
    expect(duplicateSongResponse.status).toBe(409);

    const addSecondSongResponse = await ownerAgent.post(`/api/playlists/${created.id}/items`).send({
      songMid: "song-mid-2",
      songTitle: "Song Two",
      singerName: "Singer B",
      expectedRevision: revision,
    });
    expect(addSecondSongResponse.status).toBe(201);
    revision = addSecondSongResponse.body.revision as number;

    const staleRevisionAddResponse = await ownerAgent.post(`/api/playlists/${created.id}/items`).send({
      songMid: "song-mid-3",
      songTitle: "Song Three",
      singerName: "Singer C",
      expectedRevision: revision - 1,
    });
    expect(staleRevisionAddResponse.status).toBe(409);

    const reorderResponse = await ownerAgent.patch(`/api/playlists/${created.id}/items/reorder`).send({
      songMids: ["song-mid-2", "song-mid-1"],
      expectedRevision: revision,
    });
    expect(reorderResponse.status).toBe(200);
    revision = reorderResponse.body.revision as number;

    const removeResponse = await ownerAgent
      .delete(`/api/playlists/${created.id}/items/song-mid-2`)
      .query({ expectedRevision: revision });
    expect(removeResponse.status).toBe(200);
    revision = removeResponse.body.revision as number;

    const itemsResponse = await ownerAgent.get(`/api/playlists/${created.id}/items`);
    expect(itemsResponse.status).toBe(200);
    expect(itemsResponse.body.items).toHaveLength(1);
    expect(itemsResponse.body.items[0].songMid).toBe("song-mid-1");
    expect(itemsResponse.body.revision).toBe(revision);

    const archiveResponse = await ownerAgent
      .delete(`/api/playlists/${created.id}`)
      .query({ expectedRevision: revision });
    expect(archiveResponse.status).toBe(200);
    expect(archiveResponse.body).toEqual({ ok: true });

    const detailAfterArchive = await ownerAgent.get(`/api/playlists/${created.id}`);
    expect(detailAfterArchive.status).toBe(404);
  });

  it("enforces ACL and protects default playlist", async () => {
    await register(ownerAgent, "playlist_acl_owner");
    await register(otherAgent, "playlist_acl_other");

    const ownerList = await ownerAgent.get("/api/playlists");
    expect(ownerList.status).toBe(200);
    const defaultPlaylist = ownerList.body.items.find((item: any) => item.isDefault) as PlaylistPayload | undefined;
    expect(defaultPlaylist).toBeTruthy();

    const deleteDefaultResponse = await ownerAgent
      .delete(`/api/playlists/${defaultPlaylist!.id}`)
      .query({ expectedRevision: defaultPlaylist!.revision });
    expect(deleteDefaultResponse.status).toBe(400);

    const ownerPrivatePlaylist = await createPlaylist(ownerAgent, "Private List");

    const unauthorizedGet = await otherAgent.get(`/api/playlists/${ownerPrivatePlaylist.id}`);
    expect(unauthorizedGet.status).toBe(404);

    const unauthorizedAdd = await otherAgent.post(`/api/playlists/${ownerPrivatePlaylist.id}/items`).send({
      songMid: "unauthorized-song",
      expectedRevision: ownerPrivatePlaylist.revision,
    });
    expect(unauthorizedAdd.status).toBe(404);
  });
});
