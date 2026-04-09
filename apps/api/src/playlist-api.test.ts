import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "./db.js";
import { createApp } from "./index.js";
import { createCsrfAgent } from "./test-helpers.js";

const tempDirs: string[] = [];

type PlaylistPayload = {
  id: string;
  revision: number;
  isDefault: boolean;
};

type MockQqPlaylistSong = {
  mid: string;
  title: string;
  subtitle?: string;
  singerName?: string;
  albumMid?: string;
  albumName?: string;
};

function buildQqPlaylistBody(input: {
  id: number;
  title: string;
  songs: MockQqPlaylistSong[];
}) {
  return {
    code: 0,
    data: {
      code: 0,
      dirinfo: {
        id: input.id,
        title: input.title,
      },
      songlist: input.songs.map((song) => ({
        mid: song.mid,
        title: song.title,
        subtitle: song.subtitle ?? "",
        singer: song.singerName
          ? [{ name: song.singerName, title: song.singerName }]
          : [],
        album: {
          mid: song.albumMid ?? "",
          name: song.albumName ?? "",
          title: song.albumName ?? "",
        },
      })),
    },
  };
}

describe("playlist api", () => {
  let db: Db;
  let ownerClient: ReturnType<typeof createCsrfAgent>;
  let otherClient: ReturnType<typeof createCsrfAgent>;
  let ownerAgent: request.SuperAgentTest;
  let otherAgent: request.SuperAgentTest;
  let qqServer: http.Server;
  let qqBaseUrl: string;
  let qqPlaylistResponder: (playlistId: string | null) => { status: number; body: unknown };

  beforeEach(async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "music-share-playlist-api-"));
    tempDirs.push(tempDir);

    qqPlaylistResponder = () => ({
      status: 404,
      body: { code: 1, message: "not found" },
    });

    qqServer = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/api/playlist") {
        const response = qqPlaylistResponder(url.searchParams.get("id"));
        res.statusCode = response.status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(response.body));
        return;
      }

      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ code: 1, message: "not found" }));
    });

    await new Promise<void>((resolve) => {
      qqServer.listen(0, "127.0.0.1", () => resolve());
    });

    const address = qqServer.address() as AddressInfo;
    qqBaseUrl = `http://127.0.0.1:${address.port}`;

    db = openDb(path.join(tempDir, "test.sqlite"));
    const app = createApp(
      db,
      qqBaseUrl,
      "http://127.0.0.1:3000",
      "test-session-secret",
      false,
      false,
    );

    ownerClient = createCsrfAgent(app);
    otherClient = createCsrfAgent(app);
    ownerAgent = ownerClient.agent;
    otherAgent = otherClient.agent;
  });

  afterEach(async () => {
    db.close();
    await new Promise<void>((resolve, reject) => {
      qqServer.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
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

  it("supports playlist CRUD and item revision workflow", async () => {
    await register(ownerAgent, "playlist_owner", ownerClient.setCsrfToken);

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
    await register(ownerAgent, "playlist_acl_owner", ownerClient.setCsrfToken);
    await register(otherAgent, "playlist_acl_other", otherClient.setCsrfToken);

    const ownerList = await ownerAgent.get("/api/playlists");
    expect(ownerList.status).toBe(200);
    const defaultPlaylist = (ownerList.body.items as PlaylistPayload[]).find((item) => item.isDefault);
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

  it("imports a QQ playlist from URL and skips duplicate songs on re-import", async () => {
    await register(ownerAgent, "playlist_import_owner", ownerClient.setCsrfToken);
    const created = await createPlaylist(ownerAgent, "Imported Mix");

    qqPlaylistResponder = (playlistId) => ({
      status: 200,
      body: buildQqPlaylistBody({
        id: Number(playlistId ?? "8052190267"),
        title: "QQ 导入歌单",
        songs: [
          {
            mid: "qq-song-1",
            title: "QQ Song 1",
            singerName: "Singer One",
            albumMid: "album-mid-1",
            albumName: "Album One",
          },
          {
            mid: "qq-song-2",
            title: "QQ Song 2",
            singerName: "Singer Two",
            albumMid: "album-mid-2",
            albumName: "Album Two",
          },
        ],
      }),
    });

    const importResponse = await ownerAgent.post(`/api/playlists/${created.id}/import/qq`).send({
      source: "https://y.qq.com/n/ryqq/playlist/8052190267",
      expectedRevision: created.revision,
    });
    expect(importResponse.status).toBe(200);
    expect(importResponse.body).toMatchObject({
      importedCount: 2,
      skippedCount: 0,
      truncatedSourceSongCount: 0,
      wasTruncated: false,
      sourcePlaylist: {
        id: 8052190267,
        title: "QQ 导入歌单",
      },
      sourceSongCount: 2,
    });

    const itemsAfterFirstImport = await ownerAgent.get(`/api/playlists/${created.id}/items`);
    expect(itemsAfterFirstImport.status).toBe(200);
    const importedItems = itemsAfterFirstImport.body.items as Array<{ songMid: string; coverUrl: string | null }>;
    expect(importedItems).toHaveLength(2);
    expect(importedItems.map((item) => item.songMid)).toEqual([
      "qq-song-1",
      "qq-song-2",
    ]);
    expect(importedItems[0]?.coverUrl).toBe(
      "/api/qq/cover-proxy?album_mid=album-mid-1",
    );

    const secondImportResponse = await ownerAgent.post(`/api/playlists/${created.id}/import/qq`).send({
      source: "8052190267",
      expectedRevision: importResponse.body.revision,
    });
    expect(secondImportResponse.status).toBe(200);
    expect(secondImportResponse.body).toMatchObject({
      importedCount: 0,
      skippedCount: 2,
      revision: importResponse.body.revision,
    });
  });

  it("caps QQ imports at 500 new songs and reports truncation", async () => {
    await register(ownerAgent, "playlist_cap_owner", ownerClient.setCsrfToken);
    const created = await createPlaylist(ownerAgent, "Import Target");

    const addExistingSongResponse = await ownerAgent.post(`/api/playlists/${created.id}/items`).send({
      songMid: "existing-song",
      songTitle: "Existing Song",
      singerName: "Existing Singer",
      expectedRevision: created.revision,
    });
    expect(addExistingSongResponse.status).toBe(201);

    qqPlaylistResponder = () => ({
      status: 200,
      body: buildQqPlaylistBody({
        id: 8052190267,
        title: "超长 QQ 歌单",
        songs: [
          {
            mid: "existing-song",
            title: "Existing Song",
            singerName: "Existing Singer",
            albumMid: "existing-album",
            albumName: "Existing Album",
          },
          ...Array.from({ length: 501 }, (_, index) => ({
            mid: `qq-cap-song-${index + 1}`,
            title: `QQ Cap Song ${index + 1}`,
            singerName: `Singer ${index + 1}`,
            albumMid: `qq-cap-album-${index + 1}`,
            albumName: `Album ${index + 1}`,
          })),
        ],
      }),
    });

    const importResponse = await ownerAgent.post(`/api/playlists/${created.id}/import/qq`).send({
      source: "8052190267",
      expectedRevision: addExistingSongResponse.body.revision,
    });

    expect(importResponse.status).toBe(200);
    expect(importResponse.body).toMatchObject({
      importedCount: 500,
      skippedCount: 1,
      truncatedSourceSongCount: 1,
      wasTruncated: true,
      sourceSongCount: 502,
    });

    const itemsResponse = await ownerAgent
      .get(`/api/playlists/${created.id}/items`)
      .query({ limit: 500 });
    expect(itemsResponse.status).toBe(200);
    expect(itemsResponse.body.total).toBe(501);
  });

  it("rejects invalid QQ playlist sources", async () => {
    await register(ownerAgent, "playlist_invalid_source_owner", ownerClient.setCsrfToken);
    const created = await createPlaylist(ownerAgent, "Import Target");

    const response = await ownerAgent.post(`/api/playlists/${created.id}/import/qq`).send({
      source: "not-a-qq-playlist",
      expectedRevision: created.revision,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("无法识别 QQ 歌单链接或 ID");
  });

  it("maps missing QQ playlists to 404", async () => {
    await register(ownerAgent, "missing_upstream_owner", ownerClient.setCsrfToken);
    const created = await createPlaylist(ownerAgent, "Import Target");

    qqPlaylistResponder = () => ({
      status: 404,
      body: { code: 1, message: "not found" },
    });

    const response = await ownerAgent.post(`/api/playlists/${created.id}/import/qq`).send({
      source: "8052190267",
      expectedRevision: created.revision,
    });

    expect(response.status).toBe(404);
    expect(response.body.error.message).toBe("QQ 歌单不存在或不可访问");
  });

  it("returns 502 when QQ playlist upstream fails", async () => {
    await register(ownerAgent, "upstream_fail_owner", ownerClient.setCsrfToken);
    const created = await createPlaylist(ownerAgent, "Import Target");

    qqPlaylistResponder = () => ({
      status: 500,
      body: { code: 1, message: "upstream failure" },
    });

    const response = await ownerAgent.post(`/api/playlists/${created.id}/import/qq`).send({
      source: "8052190267",
      expectedRevision: created.revision,
    });

    expect(response.status).toBe(502);
    expect(response.body.error.message).toBe("QQ 歌单加载失败");
  });

  it("rejects stale revisions before contacting QQ upstream", async () => {
    await register(ownerAgent, "playlist_stale_revision_owner", ownerClient.setCsrfToken);
    const created = await createPlaylist(ownerAgent, "Import Target");

    const addSongResponse = await ownerAgent.post(`/api/playlists/${created.id}/items`).send({
      songMid: "existing-song",
      songTitle: "Existing Song",
      singerName: "Existing Singer",
      expectedRevision: created.revision,
    });
    expect(addSongResponse.status).toBe(201);

    let qqPlaylistRequestCount = 0;
    qqPlaylistResponder = () => ({
      status: (() => {
        qqPlaylistRequestCount += 1;
        return 200;
      })(),
      body: buildQqPlaylistBody({
        id: 8052190267,
        title: "QQ 导入歌单",
        songs: [
          {
            mid: "qq-song-stale",
            title: "QQ Song Stale",
            singerName: "Singer Stale",
            albumMid: "album-mid-stale",
            albumName: "Album Stale",
          },
        ],
      }),
    });

    const staleImportResponse = await ownerAgent.post(`/api/playlists/${created.id}/import/qq`).send({
      source: "8052190267",
      expectedRevision: created.revision,
    });
    expect(staleImportResponse.status).toBe(409);
    expect(staleImportResponse.body.error.message).toBe("Playlist revision conflict");
    expect(qqPlaylistRequestCount).toBe(0);

    const itemsAfterFailedImport = await ownerAgent.get(`/api/playlists/${created.id}/items`);
    expect(itemsAfterFailedImport.status).toBe(200);
    expect(itemsAfterFailedImport.body.items).toHaveLength(1);
    expect(itemsAfterFailedImport.body.items[0].songMid).toBe("existing-song");
  });
});
