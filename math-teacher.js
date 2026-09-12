// math-build/modules/teacher.js
var API_BASE = "https://bxws-math.pages.dev";
function buildBoardUrl(roomCode, week) {
  return `${API_BASE}/api/weekly-board?roomCode=${encodeURIComponent(String(roomCode).trim())}&week=${encodeURIComponent(String(week).trim())}`;
}
function buildClassShareText(roomCode) {
  return `\u540C\u5B78\u8ACB\u958B\u555F\u300A\u6B65\u5B78\u543E\u6578\u300B\uFF0C\u5728\u672C\u9031\u5B78\u9662\u76C3\u8F38\u5165\u73ED\u7D1A\u4EE3\u78BC\u300C${String(roomCode).trim()}\u300D\uFF0C\u5B8C\u6210\u5F8C\u9001\u51FA\u672C\u9031\u6210\u7E3E\u3002`;
}
var csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
function resultsToCsv(results = []) {
  const rows = [["\u59D3\u540D", "\u6B63\u78BA\u7387", "\u4F5C\u7B54\u6642\u9593\u79D2", "\u53EF\u7591\u6A19\u8A18", "\u539F\u56E0"]];
  results.forEach((row) => rows.push([
    row.name,
    row.pct,
    row.totalSec,
    row.flagged ? "\u662F" : "\u5426",
    (row.flagReasons ?? []).join("\u3001")
  ]));
  return rows.map((row) => row.map((v, j) => csvCell(j !== 0 || row[0] === "\u59D3\u540D" ? globalThis.mathBilingual.translate(v) && /[\u3400-\u9fff]/.test(String(v)) ? v + " / " + globalThis.mathBilingual.translate(v) : v : v)).join(",")).join("\n");
}
function currentWeek() {
  const date = /* @__PURE__ */ new Date();
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc - start) / 864e5 + 1) / 7);
  return `${utc.getUTCFullYear()}W${String(week).padStart(2, "0")}`;
}
function setupTeacherPage(doc = document) {
  const form = doc.getElementById("teacher-query");
  const room = doc.getElementById("teacher-room-code");
  const week = doc.getElementById("teacher-week");
  const status = doc.getElementById("teacher-status");
  const body = doc.querySelector("#teacher-results tbody");
  const copy = doc.getElementById("teacher-copy-room");
  const csv = doc.getElementById("teacher-export-csv");
  let currentResults = [];
  week.value ||= currentWeek();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "\u8B80\u53D6\u4E2D\u2026";
    body.replaceChildren();
    try {
      const response = await fetch(buildBoardUrl(room.value, week.value));
      if (!response.ok) throw new Error("\u67E5\u8A62\u5931\u6557");
      currentResults = (await response.json()).results ?? [];
      currentResults.forEach((entry) => {
        const tr = doc.createElement("tr");
        [entry.name, `${entry.pct}%`, `${entry.totalSec} \u79D2`, entry.flagged ? "\u26A0 \u5EFA\u8B70\u8907\u9A57" : "\u5426"].forEach((value) => {
          const td = doc.createElement("td");
          td.textContent = value;
          tr.appendChild(td);
        });
        if (entry.flagged) tr.title = (entry.flagReasons ?? []).join("\u3001");
        body.appendChild(tr);
      });
      status.textContent = currentResults.length ? `\u5171 ${currentResults.length} \u7B46\u7D50\u679C` : "\u76EE\u524D\u6C92\u6709\u6210\u7E3E";
      csv.disabled = currentResults.length === 0;
    } catch {
      currentResults = [];
      csv.disabled = true;
      status.textContent = "\u76EE\u524D\u7121\u6CD5\u8B80\u53D6\u73ED\u7D1A\u7D50\u679C\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002";
    }
  });
  copy.addEventListener("click", async () => {
    if (!room.value.trim()) {
      status.textContent = "\u8ACB\u5148\u8F38\u5165\u73ED\u7D1A\u4EE3\u78BC\u3002";
      return;
    }
    await navigator.clipboard.writeText(buildClassShareText(room.value));
    status.textContent = "\u73ED\u7D1A\u4EE3\u78BC\u5206\u4EAB\u6587\u5B57\u5DF2\u8907\u88FD\u3002";
  });
  csv.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob(["\uFEFF", resultsToCsv(currentResults)], { type: "text/csv;charset=utf-8" }));
    const link = doc.createElement("a");
    link.href = url;
    link.download = `${room.value.trim()}-${week.value}-\u73ED\u7D1A\u6210\u679C.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });
}
setupTeacherPage();
export {
  buildBoardUrl,
  buildClassShareText,
  resultsToCsv,
  setupTeacherPage
};
