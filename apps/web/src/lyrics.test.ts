import { describe, expect, it } from "vitest";
import { getActiveLyricLineIndex, parseLyrics } from "./lyrics";

describe("lyrics utilities", () => {
  it("parses timed LRC lyrics and merges translated lines", () => {
    const parsed = parseLyrics({
      lyric: "[00:01.00]第一句\n[00:03.50]第二句",
      trans: "[00:01.00]First line\n[00:03.50]Second line",
      format: "lrc",
    });

    expect(parsed.format).toBe("lrc");
    expect(parsed.timed).toBe(true);
    expect(parsed.lines).toEqual([
      {
        key: "lrc-0-0-1000",
        timeMs: 1000,
        text: "第一句",
        transText: "First line",
      },
      {
        key: "lrc-1-0-3500",
        timeMs: 3500,
        text: "第二句",
        transText: "Second line",
      },
    ]);
  });

  it("parses QRC xml lyrics and strips per-word timing markers", () => {
    const parsed = parseLyrics({
      lyric: '<?xml version="1.0"?><QrcInfos><LyricInfo><Lyric_1 LyricContent="[0,1800]第一(0,400)句&#10;[2000,1200]第二(0,400)句"/></LyricInfo></QrcInfos>',
      trans: null,
      format: "qrc",
    });

    expect(parsed.format).toBe("qrc");
    expect(parsed.timed).toBe(true);
    expect(parsed.lines.map((line) => ({ timeMs: line.timeMs, text: line.text }))).toEqual([
      { timeMs: 0, text: "第一句" },
      { timeMs: 2000, text: "第二句" },
    ]);
  });

  it("finds the active timed lyric line", () => {
    const parsed = parseLyrics({
      lyric: "[00:00.00]前奏\n[00:05.00]主歌\n[00:10.00]副歌",
      format: "lrc",
    });

    expect(getActiveLyricLineIndex(parsed.lines, 0)).toBe(0);
    expect(getActiveLyricLineIndex(parsed.lines, 6200)).toBe(1);
    expect(getActiveLyricLineIndex(parsed.lines, 12000)).toBe(2);
  });
});
