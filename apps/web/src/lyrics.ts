export type LyricFormat = "lrc" | "qrc" | "plain";

export type ParsedLyricLine = {
  key: string;
  timeMs: number | null;
  text: string;
  transText?: string;
};

export type ParsedLyrics = {
  format: LyricFormat;
  timed: boolean;
  lines: ParsedLyricLine[];
};

type RawLyricPayload = {
  lyric?: string | null;
  trans?: string | null;
  format?: LyricFormat | null;
};

const lrcTimestampPattern = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?]/g;
const qrcLinePattern = /^\[(\d+),(\d+)](.*)$/;

function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function normalizeLyricText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeLineBreaks(value).trim();
  return normalized ? normalized : null;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, num: string) =>
      String.fromCodePoint(Number.parseInt(num, 10)),
    );
}

function inferLyricFormat(value: string | null, hinted?: LyricFormat | null): LyricFormat {
  if (hinted === "lrc" || hinted === "qrc") return hinted;
  if (!value) return "plain";
  if (/<(?:QrcInfos|Lyric_1)\b/.test(value) || /^\[\d+,\d+]/m.test(value)) {
    return "qrc";
  }
  if (/^\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?]/m.test(value)) {
    return "lrc";
  }
  return "plain";
}

function toMilliseconds(minutes: string, seconds: string, fraction?: string): number {
  const min = Number.parseInt(minutes, 10);
  const sec = Number.parseInt(seconds, 10);
  const rawFraction = fraction ?? "";
  const ms = rawFraction
    ? rawFraction.length === 3
      ? Number.parseInt(rawFraction, 10)
      : Number.parseInt(rawFraction.padEnd(2, "0"), 10) * 10
    : 0;
  return ((min * 60) + sec) * 1000 + ms;
}

function sortTimedLines(lines: ParsedLyricLine[]): ParsedLyricLine[] {
  return [...lines].sort((a, b) => {
    if (a.timeMs == null && b.timeMs == null) return a.key.localeCompare(b.key);
    if (a.timeMs == null) return 1;
    if (b.timeMs == null) return -1;
    if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
    return a.key.localeCompare(b.key);
  });
}

function parseLrc(text: string): ParsedLyricLine[] {
  const lines: ParsedLyricLine[] = [];

  normalizeLineBreaks(text).split("\n").forEach((rawLine, lineIndex) => {
    const matches = Array.from(rawLine.matchAll(lrcTimestampPattern));
    if (!matches.length) return;

    const content = rawLine.replace(lrcTimestampPattern, "").trim();
    if (!content) return;

    matches.forEach((match, timestampIndex) => {
      const timeMs = toMilliseconds(match[1] ?? "0", match[2] ?? "0", match[3]);
      lines.push({
        key: `lrc-${lineIndex}-${timestampIndex}-${timeMs}`,
        timeMs,
        text: content,
      });
    });
  });

  return sortTimedLines(lines);
}

function extractQrcContent(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("<")) return trimmed;

  const attrMatch = trimmed.match(/LyricContent=(['"])([\s\S]*?)\1/);
  if (attrMatch?.[2]) {
    return decodeXmlEntities(attrMatch[2]);
  }

  const cdataMatch = trimmed.match(/<Lyric_1\b[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/Lyric_1>/);
  if (cdataMatch?.[1]) {
    return decodeXmlEntities(cdataMatch[1]);
  }

  const textMatch = trimmed.match(/<Lyric_1\b[^>]*>([\s\S]*?)<\/Lyric_1>/);
  if (textMatch?.[1]) {
    return decodeXmlEntities(textMatch[1]);
  }

  return trimmed;
}

function cleanQrcText(text: string): string {
  return decodeXmlEntities(text)
    .replace(/\(\d+,\d+\)/g, "")
    .replace(/\\n/g, "\n")
    .trim();
}

function parseQrc(text: string): ParsedLyricLine[] {
  const content = normalizeLineBreaks(extractQrcContent(text));
  const lines: ParsedLyricLine[] = [];

  content.split("\n").forEach((rawLine, index) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    const match = trimmed.match(qrcLinePattern);
    if (!match) return;

    const startMs = Number.parseInt(match[1] ?? "0", 10);
    const textContent = cleanQrcText(match[3] ?? "");
    if (!textContent) return;

    lines.push({
      key: `qrc-${index}-${startMs}`,
      timeMs: startMs,
      text: textContent,
    });
  });

  return sortTimedLines(lines);
}

function parsePlain(text: string): ParsedLyricLine[] {
  return normalizeLineBreaks(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      key: `plain-${index}`,
      timeMs: null,
      text: line,
    }));
}

function parseLyricLines(text: string | null, hintedFormat?: LyricFormat | null): ParsedLyricLine[] {
  if (!text) return [];

  const format = inferLyricFormat(text, hintedFormat);
  if (format === "lrc") {
    const parsed = parseLrc(text);
    return parsed.length ? parsed : parsePlain(text);
  }
  if (format === "qrc") {
    const parsed = parseQrc(text);
    return parsed.length ? parsed : parsePlain(extractQrcContent(text));
  }
  return parsePlain(text);
}

function mergeTranslation(mainLines: ParsedLyricLine[], transLines: ParsedLyricLine[]): ParsedLyricLine[] {
  if (!transLines.length) return mainLines;
  if (!mainLines.length) return transLines;

  const mainTimed = mainLines.every((line) => line.timeMs != null);
  const transTimed = transLines.every((line) => line.timeMs != null);

  if (mainTimed && transTimed) {
    const transByTime = new Map<number, string>();
    transLines.forEach((line) => {
      if (line.timeMs != null && !transByTime.has(line.timeMs)) {
        transByTime.set(line.timeMs, line.text);
      }
    });

    return mainLines.map((line) => ({
      ...line,
      transText: line.timeMs != null ? transByTime.get(line.timeMs) : undefined,
    }));
  }

  if (mainLines.length === transLines.length) {
    return mainLines.map((line, index) => ({
      ...line,
      transText: transLines[index]?.text,
    }));
  }

  return mainLines;
}

export function parseLyrics(payload: RawLyricPayload): ParsedLyrics {
  const lyric = normalizeLyricText(payload.lyric);
  const trans = normalizeLyricText(payload.trans);
  const format = inferLyricFormat(lyric, payload.format);
  const mainLines = parseLyricLines(lyric, format);
  const transLines = parseLyricLines(trans, null);
  const lines = mergeTranslation(mainLines, transLines);

  return {
    format,
    timed: lines.some((line) => line.timeMs != null),
    lines,
  };
}

export function getActiveLyricLineIndex(lines: ParsedLyricLine[], currentTimeMs: number): number {
  let activeIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const timeMs = lines[index]?.timeMs;
    if (timeMs == null) continue;
    if (timeMs <= currentTimeMs) {
      activeIndex = index;
      continue;
    }
    break;
  }

  return activeIndex;
}
