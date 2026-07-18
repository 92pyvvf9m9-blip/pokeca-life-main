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
  if (hour == null || hour === "") return "";
  return `${pad(Number(hour))}:${pad(Number(minute || "00"))}`;
}

function validDateParts(year, month, day) {
  const date = new Date(`${year}-${pad(month)}-${pad(day)}T12:00:00+09:00`);
  return !Number.isNaN(date.getTime())
    && date.getFullYear() === Number(year)
    && date.getMonth() + 1 === Number(month)
    && date.getDate() === Number(day);
}

export function parseJapaneseDateToken(token, base = new Date(), options = {}) {
  const value = String(token || "")
    .normalize("NFKC")
    .replace(/[（(][^)）]*[)）]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let match = value.match(/(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})日(?:\s*(\d{1,2})(?:時|:)(\d{1,2})?分?)?/);
  if (!match) {
    match = value.match(/(?:(\d{4})[\/.-])?(\d{1,2})[\/.-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  }
  if (!match) return null;

  const month = Number(match[2]);
  const day = Number(match[3]);
  let year = match[1]
    ? Number(match[1])
    : Number(options.preferredYear || 0) || inferYear(month, base);

  // A range such as 12/30〜1/2 crosses the year boundary.
  if (!match[1] && options.afterDate) {
    const after = options.afterDate;
    const afterYear = Number(String(after.date || "").slice(0, 4));
    const afterMonth = Number(String(after.date || "").slice(5, 7));
    const afterDay = Number(String(after.date || "").slice(8, 10));
    if (afterYear) {
      year = afterYear;
      if (month < afterMonth || (month === afterMonth && day < afterDay && afterMonth === 12)) year += 1;
    }
  }

  if (!validDateParts(year, month, day)) return null;
  return {
    date: `${year}-${pad(month)}-${pad(day)}`,
    time: normalizeTime(match[4], match[5]),
  };
}

export function parseDateRange(text, base = new Date()) {
  const value = String(text || "")
    .normalize("NFKC")
    .replace(/[（(][月火水木金土日祝曜\s]*[)）]/g, "")
    .replace(/午前/g, "")
    .replace(/午後\s*(\d{1,2})時/g, (_, h) => `${Number(h) + 12}時`)
    .replace(/[\u00a0\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const datePattern = "(?:(?:\\d{4})年\\s*)?\\d{1,2}月\\s*\\d{1,2}日(?:\\s*\\d{1,2}(?:時|:)\\d{0,2}分?)?|(?:(?:\\d{4})[\\/.-])?\\d{1,2}[\\/.-]\\d{1,2}(?:\\s+\\d{1,2}:\\d{2})?";
  const range = value.match(new RegExp(`(${datePattern})\\s*(?:～|〜|~|－|–|—|-|から)\\s*(${datePattern})`));

  if (range) {
    const start = parseJapaneseDateToken(range[1], base);
    const end = parseJapaneseDateToken(range[2], base, {
      preferredYear: start ? Number(start.date.slice(0, 4)) : 0,
      afterDate: start,
    });
    return { start, end };
  }

  const single = value.match(new RegExp(`(${datePattern})`));
  if (!single) return { start: null, end: null };

  const parsed = parseJapaneseDateToken(single[1], base);
  const isDeadline = /まで|締切|終了|期限|最終日|受付終了|販売終了|応募終了|購入期限|受取期限|引取期限/.test(value);
  return isDeadline
    ? { start: null, end: parsed }
    : { start: parsed, end: null };
}
