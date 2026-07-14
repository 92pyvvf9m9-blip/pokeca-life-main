function pad(value) {
  return String(value).padStart(2, "0");
}

function inferYear(month, base = new Date()) {
  const year = base.getFullYear();
  const currentMonth = base.getMonth() + 1;
  if (currentMonth >= 10 && month <= 3) return year + 1;
  if (currentMonth <= 3 && month >= 10) return year - 1;
  return year;
}

function normalizeTime(hour, minute = "00") {
  if (hour == null) return "";
  return `${pad(Number(hour))}:${pad(Number(minute))}`;
}

export function parseJapaneseDateToken(token, base = new Date()) {
  const value = String(token || "").replace(/[（(][^)）]*[)）]/g, " ").trim();

  let match = value.match(/(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})日(?:\s*(\d{1,2})(?:時|:)(\d{1,2})?分?)?/);
  if (!match) {
    match = value.match(/(?:(\d{4})[\/.-])?(\d{1,2})[\/.-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  }
  if (!match) return null;

  const month = Number(match[2]);
  const year = match[1] ? Number(match[1]) : inferYear(month, base);
  return {
    date: `${year}-${pad(month)}-${pad(Number(match[3]))}`,
    time: normalizeTime(match[4], match[5]),
  };
}

export function parseDateRange(text, base = new Date()) {
  const value = String(text || "")
    .replace(/[（(][月火水木金土日祝曜\s]*[)）]/g, "")
    .replace(/午前/g, "")
    .replace(/午後\s*(\d{1,2})時/g, (_, h) => `${Number(h) + 12}時`);

  const datePattern = "(?:(?:\\d{4})年\\s*)?\\d{1,2}月\\s*\\d{1,2}日(?:\\s*\\d{1,2}(?:時|:)\\d{0,2}分?)?|(?:(?:\\d{4})[\\/.-])?\\d{1,2}[\\/.-]\\d{1,2}(?:\\s+\\d{1,2}:\\d{2})?";
  const match = value.match(new RegExp(`(${datePattern})\\s*(?:～|〜|~|－|-|から)\\s*(${datePattern})`));

  if (match) {
    return {
      start: parseJapaneseDateToken(match[1], base),
      end: parseJapaneseDateToken(match[2], base),
    };
  }

  const single = value.match(new RegExp(`(${datePattern})`));
  if (!single) return { start: null, end: null };

  const parsed = parseJapaneseDateToken(single[1], base);
  if (/まで|締切|終了/.test(value)) return { start: null, end: parsed };
  return { start: parsed, end: null };
}
