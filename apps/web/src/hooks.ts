import { useCallback, useEffect, useState } from "react";
import {
  apiGetDefaultPlaylist,
  apiGetPlaylistItems,
  type PlaylistSummary,
} from "./api";
import { useAuth } from "./context/AuthContext";

/**
 * Fetches and caches the current user's default playlist + its song mids.
 * Shared across HomePage, PlazaPage, UserPage for the "已收藏" badge.
 */
const DEFAULT_PLAYLIST_CACHE_TTL_MS = 30_000;

type DefaultPlaylistSnapshot = {
  playlistMids: Set<string>;
  defaultPlaylist: PlaylistSummary | null;
};

type DefaultPlaylistCacheEntry = {
  snapshot: DefaultPlaylistSnapshot;
  fetchedAt: number;
  promise: Promise<DefaultPlaylistSnapshot> | null;
};

const EMPTY_SNAPSHOT: DefaultPlaylistSnapshot = {
  playlistMids: new Set<string>(),
  defaultPlaylist: null,
};

const defaultPlaylistCache = new Map<number, DefaultPlaylistCacheEntry>();

function cloneSnapshot(snapshot: DefaultPlaylistSnapshot): DefaultPlaylistSnapshot {
  return {
    playlistMids: new Set(snapshot.playlistMids),
    defaultPlaylist: snapshot.defaultPlaylist,
  };
}

function getCacheEntry(userId: number) {
  return defaultPlaylistCache.get(userId);
}

function isCacheFresh(entry: DefaultPlaylistCacheEntry | undefined) {
  return !!entry && Date.now() - entry.fetchedAt < DEFAULT_PLAYLIST_CACHE_TTL_MS;
}

function getCachedSnapshot(userId: number) {
  return cloneSnapshot(getCacheEntry(userId)?.snapshot ?? EMPTY_SNAPSHOT);
}

function writeSnapshot(userId: number, snapshot: DefaultPlaylistSnapshot) {
  defaultPlaylistCache.set(userId, {
    snapshot: cloneSnapshot(snapshot),
    fetchedAt: Date.now(),
    promise: null,
  });
}

async function fetchDefaultPlaylistSnapshot(): Promise<DefaultPlaylistSnapshot> {
  const defaultPlaylist = await apiGetDefaultPlaylist();

  if (!defaultPlaylist) {
    return cloneSnapshot(EMPTY_SNAPSHOT);
  }

  const items = await apiGetPlaylistItems(defaultPlaylist.id, 0, 500);
  return {
    playlistMids: new Set(items.items.map((item) => item.songMid)),
    defaultPlaylist,
  };
}

async function loadDefaultPlaylistSnapshot(userId: number, force = false): Promise<DefaultPlaylistSnapshot> {
  const entry = getCacheEntry(userId);

  if (!force && isCacheFresh(entry)) {
    return cloneSnapshot(entry!.snapshot);
  }

  if (!force && entry?.promise) {
    return entry.promise.then(cloneSnapshot);
  }

  const pending = fetchDefaultPlaylistSnapshot()
    .then((snapshot) => {
      writeSnapshot(userId, snapshot);
      return cloneSnapshot(snapshot);
    })
    .catch(() => {
      if (entry) {
        defaultPlaylistCache.set(userId, { ...entry, promise: null });
        return cloneSnapshot(entry.snapshot);
      }

      defaultPlaylistCache.delete(userId);
      return cloneSnapshot(EMPTY_SNAPSHOT);
    });

  defaultPlaylistCache.set(userId, {
    snapshot: cloneSnapshot(entry?.snapshot ?? EMPTY_SNAPSHOT),
    fetchedAt: entry?.fetchedAt ?? 0,
    promise: pending,
  });

  return pending;
}

export function useDefaultPlaylistMids() {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<DefaultPlaylistSnapshot>(() =>
    user ? getCachedSnapshot(user.id) : cloneSnapshot(EMPTY_SNAPSHOT),
  );
  const [loading, setLoading] = useState(() => {
    if (!user) return false;
    return !isCacheFresh(getCacheEntry(user.id));
  });

  useEffect(() => {
    if (!user) {
      setSnapshot(cloneSnapshot(EMPTY_SNAPSHOT));
      setLoading(false);
      return;
    }

    const cached = getCacheEntry(user.id);
    if (cached?.snapshot) {
      setSnapshot(cloneSnapshot(cached.snapshot));
    } else {
      setSnapshot(cloneSnapshot(EMPTY_SNAPSHOT));
    }

    if (isCacheFresh(cached)) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void loadDefaultPlaylistSnapshot(user.id)
      .then((nextSnapshot) => {
        if (cancelled) return;
        setSnapshot(nextSnapshot);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const addMid = useCallback(
    (mid: string) => {
      if (!user) return;

      setSnapshot((prev) => {
        const nextSnapshot = {
          defaultPlaylist: prev.defaultPlaylist,
          playlistMids: new Set([...prev.playlistMids, mid]),
        };
        writeSnapshot(user.id, nextSnapshot);
        return nextSnapshot;
      });
    },
    [user?.id],
  );

  const refreshMids = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    try {
      const nextSnapshot = await loadDefaultPlaylistSnapshot(user.id, true);
      setSnapshot(nextSnapshot);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  return {
    playlistMids: snapshot.playlistMids,
    defaultPlaylist: snapshot.defaultPlaylist,
    loading,
    addMid,
    refreshMids,
  };
}

export function resetDefaultPlaylistMidsCache() {
  defaultPlaylistCache.clear();
}
