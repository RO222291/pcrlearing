// math-build/modules/store.js
var NS = "bxws:";
var BUNDLE_KIND = "bxws-travel-case";
var MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
var MAX_VALUE_BYTES = 256 * 1024;
var byteSize = (text) => new TextEncoder().encode(text).byteLength;
var KEY_TYPES = {
  accessibilitySettings: "object",
  activityStreak: "object",
  bestStreak: "number",
  progress: "progress",
  leitner: "object",
  activeSession: "nullable-object",
  badges: "array",
  bossFights: "object",
  collection: "object",
  encounterPity: "number",
  encounterPityByRarity: "object",
  encounterWins: "number",
  errorbook: "object",
  inkDays: "array",
  lastChallengeResult: "nullable-object",
  lastCreatedChallenge: "nullable-object",
  lastPlayed: "nullable-object",
  lastStrategy: "nullable-string",
  leaderboard: "array",
  manuscriptCare: "object",
  masterTrialBest: "nullable-object",
  masterTrialTiers: "object",
  player: "nullable-string",
  playerId: "string",
  deviceAuthToken: "string",
  pvpChallenges: "object",
  roomCode: "nullable-string",
  rareStampBook: "object",
  rareStamps: "array-or-object",
  sanctuaryLayout: "object",
  sanctuaryInscription: "string",
  arenaBest: "object",
  arenaRoom: "nullable-string",
  arenaStrand: "nullable-string",
  marketP2PDisabled: "boolean",
  npcBought: "object",
  schemaVersion: "number",
  seenTip: "boolean",
  sfxOn: "boolean",
  hapticsOn: "boolean",
  spiritBook: "object",
  equippedSpirits: "array",
  stardustSpent: "number",
  stardustBonus: "number",
  stardustMilestones: "object",
  fusionRewarded: "object"
};
var CURRENT_SCHEMA_VERSION = 2;
var storageBroken = false;
function expectedTypeFor(key) {
  const bare = key.slice(NS.length);
  return KEY_TYPES[bare] ?? (/^(daily|weekly|ghost):/.test(bare) ? "object" : null);
}
function validValue(type, value) {
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "string") return typeof value === "string";
  if (type === "nullable-string") return value === null || typeof value === "string";
  if (type === "array") return Array.isArray(value);
  if (type === "array-or-object") return value && typeof value === "object";
  if (type === "object") return value && typeof value === "object" && !Array.isArray(value);
  if (type === "nullable-object") return value === null || value && typeof value === "object" && !Array.isArray(value);
  if (type === "progress") return value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((entry) => entry && typeof entry === "object" && Array.isArray(entry.attempts));
  return false;
}
function read(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
    return true;
  } catch {
    storageBroken = true;
    return false;
  }
}
function isStorageBroken() {
  return storageBroken;
}
function migrateProgress(progress = {}, tree2 = null) {
  const thresholds = tree2?.masteryThresholds ?? {};
  const tierById = new Map(
    (tree2?.strands ?? []).flatMap((strand) => strand.nodes ?? []).map((node) => [node.id, node.tier])
  );
  let changed = false;
  const migrated = {};
  Object.entries(progress).forEach(([nodeId, source]) => {
    const entry = { ...source, attempts: [...source?.attempts ?? []] };
    const totalAttempts = Number.isFinite(entry.totalAttempts) ? entry.totalAttempts : entry.attempts.length;
    const correctAttempts = Number.isFinite(entry.correctAttempts) ? entry.correctAttempts : entry.attempts.filter((attempt) => attempt.correct).length;
    const questionStats = { ...entry.questionStats ?? {} };
    if (!entry.questionStats) {
      entry.attempts.forEach((attempt) => {
        const stats = questionStats[attempt.questionId] ?? { totalAttempts: 0, correctAttempts: 0 };
        stats.totalAttempts += 1;
        if (attempt.correct) stats.correctAttempts += 1;
        questionStats[attempt.questionId] = stats;
      });
    }
    Object.assign(entry, { totalAttempts, correctAttempts, questionStats });
    if (entry.attempts.length > 50) entry.attempts = entry.attempts.slice(-50);
    if (entry.masteryVersion !== 2) {
      const threshold = thresholds[tierById.get(nodeId)] ?? tree2?.masteryThreshold ?? 0.8;
      entry.mastered = (entry.masteryPct ?? 0) >= threshold;
      entry.masteryVersion = 2;
    }
    migrated[nodeId] = entry;
    if (JSON.stringify(entry) !== JSON.stringify(source)) changed = true;
  });
  return { progress: migrated, changed };
}
function migrationWrite(storage, key, value, strict) {
  try {
    storage.setItem(key, value);
    return true;
  } catch (error) {
    storageBroken = true;
    if (strict) throw error;
    return false;
  }
}
function migrationRemove(storage, key, strict) {
  try {
    storage.removeItem(key);
    return true;
  } catch (error) {
    storageBroken = true;
    if (strict) throw error;
    return false;
  }
}
function removeStaleKeys(storage, now = /* @__PURE__ */ new Date(), strict = false) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 30);
  const currentWeek = (() => {
    const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((date - yearStart) / 864e5 + 1) / 7);
    return `${date.getUTCFullYear()}W${String(week).padStart(2, "0")}`;
  })();
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) keys.push(storage.key(index));
  keys.filter(Boolean).forEach((key) => {
    const daily = /^bxws:daily:(\d{4}-\d{2}-\d{2})$/.exec(key);
    if (daily && /* @__PURE__ */ new Date(`${daily[1]}T00:00:00`) < cutoff) migrationRemove(storage, key, strict);
    const weekly = /^bxws:weekly:(\d{4}W\d{2})$/.exec(key);
    if (weekly && weekly[1] !== currentWeek) migrationRemove(storage, key, strict);
  });
}
function runMigrations(fromVersion = 0, tree2 = null, storage = localStorage, strict = false) {
  let version = Number(fromVersion) || 0;
  if (version < 2) {
    const rawProgress = storage.getItem(`${NS}progress`);
    const sourceProgress = rawProgress ? JSON.parse(rawProgress) : {};
    const { progress, changed } = migrateProgress(sourceProgress, tree2);
    if (changed) migrationWrite(storage, `${NS}progress`, JSON.stringify(progress), strict);
    const legacyRaw = storage.getItem(`${NS}rareStamps`);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      const bookRaw = storage.getItem(`${NS}rareStampBook`);
      const book = bookRaw ? JSON.parse(bookRaw) : {};
      const ids = Array.isArray(legacy) ? legacy : Object.keys(legacy ?? {});
      ids.forEach((id) => {
        if (!book[id]) book[id] = { at: legacy?.[id]?.at ?? null };
      });
      migrationWrite(storage, `${NS}rareStampBook`, JSON.stringify(book), strict);
      migrationRemove(storage, `${NS}rareStamps`, strict);
    }
    version = 2;
  }
  removeStaleKeys(storage, /* @__PURE__ */ new Date(), strict);
  migrationWrite(storage, `${NS}schemaVersion`, JSON.stringify(CURRENT_SCHEMA_VERSION), strict);
  return version;
}
var store = { read, write };
function activityDateKey(now) {
  const date = new Date(now);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function getActivityStreak() {
  return store.read("activityStreak", { count: 0, lastDate: null });
}
function recordActivityStreak(now = Date.now()) {
  const today = activityDateKey(now);
  const current = getActivityStreak();
  if (current.lastDate === today) return current;
  const next = { count: (current.count ?? 0) + 1, lastDate: today };
  store.write("activityStreak", next);
  return next;
}
function clearNamespace(storage = localStorage) {
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(NS)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem?.(key));
  return keys.length;
}
function exportNamespace(storage = localStorage) {
  const data = {};
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(NS)) data[key] = storage.getItem(key);
  }
  return { kind: BUNDLE_KIND, version: 1, exportedAt: (/* @__PURE__ */ new Date()).toISOString(), data };
}
function importNamespace(bundle, storage = localStorage, tree2 = null) {
  if (!bundle || bundle.kind !== BUNDLE_KIND || bundle.version !== 1 || !bundle.data || Array.isArray(bundle.data)) {
    throw new Error("\u9019\u4E0D\u662F\u300A\u6B65\u5B78\u543E\u6578\u300B\u7684\u795E\u4F7F\u884C\u56CA\u6A94");
  }
  const entries = Object.entries(bundle.data);
  if (entries.length > 5e3) throw new Error("\u5B58\u6A94\u9805\u76EE\u904E\u591A\uFF0C\u5DF2\u505C\u6B62\u532F\u5165");
  const totalBytes = entries.reduce((sum, [key, value]) => sum + byteSize(key) + (typeof value === "string" ? byteSize(value) : 0), 0);
  if (totalBytes > MAX_BUNDLE_BYTES) throw new Error("\u5B58\u6A94\u8D85\u904E 2MB\uFF0C\u5DF2\u505C\u6B62\u532F\u5165");
  for (const [key, value] of entries) {
    if (!key.startsWith(NS) || typeof value !== "string") throw new Error("\u5B58\u6A94\u542B\u6709\u4E0D\u76F8\u5BB9\u7684\u8CC7\u6599");
    if (byteSize(value) > MAX_VALUE_BYTES) throw new Error("\u55AE\u7B46\u5B58\u6A94\u8CC7\u6599\u904E\u5927\uFF0C\u5DF2\u505C\u6B62\u532F\u5165");
    const expected = expectedTypeFor(key);
    if (!expected || !validValue(expected, JSON.parse(value))) throw new Error("\u5B58\u6A94\u542B\u6709\u4E0D\u76F8\u5BB9\u7684\u8CC7\u6599");
  }
  const snapshot = /* @__PURE__ */ new Map();
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(NS)) snapshot.set(key, storage.getItem(key));
  }
  try {
    entries.forEach(([key, value]) => storage.setItem(key, value));
    const importedVersion = JSON.parse(storage.getItem(`${NS}schemaVersion`) ?? "0");
    runMigrations(importedVersion, tree2, storage, true);
  } catch (error) {
    const currentKeys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(NS)) currentKeys.push(key);
    }
    currentKeys.forEach((key) => storage.removeItem?.(key));
    snapshot.forEach((value, key) => storage.setItem(key, value));
    throw new Error(`\u795E\u4F7F\u884C\u56CA\u532F\u5165\u5931\u6557\uFF0C\u5DF2\u9084\u539F\u539F\u5B58\u6A94\uFF1A${error.message}`);
  }
  return entries.length;
}

// math-build/modules/schema.js
var treeCache = null;
var QUESTION_DIFFICULTIES = /* @__PURE__ */ new Set(["easy", "medium", "hard"]);
function validateQuestion(question) {
  if (!question || typeof question !== "object" || typeof question.id !== "string") {
    throw new Error("question.id \u5FC5\u9808\u662F\u5B57\u4E32");
  }
  if (question.difficulty !== void 0 && !QUESTION_DIFFICULTIES.has(question.difficulty)) {
    throw new Error(`question.difficulty \u4E0D\u5408\u6CD5\uFF1A${question.difficulty}`);
  }
  if (question.errorPath !== void 0 && question.errorPath !== null && typeof question.errorPath !== "string" && typeof question.errorPath !== "number") {
    throw new Error("question.errorPath \u5FC5\u9808\u662F\u5B57\u4E32\u6216\u820A\u7248\u6578\u5B57\u6A19\u7C64");
  }
  return question;
}
function validateQuestionBank(bank) {
  for (const key of ["basicMastery", "conceptId", "errorDiagnosis", "contextApplication"]) {
    for (const question of bank?.[key] ?? []) validateQuestion(question);
  }
  return bank;
}
async function loadSkillTree() {
  if (treeCache) return treeCache;
  const res = await fetch("data/skilltree.json");
  if (!res.ok) throw new Error(`\u6280\u80FD\u6A39\u8F09\u5165\u5931\u6557\uFF08${res.status}\uFF09`);
  treeCache = await res.json();
  return treeCache;
}
function allNodes(tree2) {
  return tree2.strands.flatMap((s) => s.nodes.map((n) => ({
    ...n,
    masteryThreshold: tree2.masteryThresholds?.[n.tier] ?? tree2.masteryThreshold ?? 0.8,
    strandId: s.id,
    strandName: s.name
  })));
}
function getProgress() {
  return store.read("progress", {});
}
function getNodeMastery(nodeId, progress = getProgress()) {
  return progress[nodeId]?.masteryPct ?? 0;
}
function isNodeMastered(nodeId, tree2, progress = getProgress()) {
  const entry = progress[nodeId];
  if (!entry) return false;
  return entry.masteryVersion === 2 && entry.mastered === true;
}
function isNodeUnlocked(node, tree2, progress = getProgress()) {
  if (node.contentPending) return false;
  if (progress[node.id]?.diagnosticUnlocked === true) return true;
  if (!node.prereq || node.prereq.length === 0) return true;
  const pendingIds = new Set((tree2?.strands ?? []).flatMap((s) => s.nodes ?? []).filter((n) => n.contentPending).map((n) => n.id));
  const blocking = node.prereq.filter((id) => !pendingIds.has(id));
  if (blocking.length === 0) return true;
  return blocking.every((id) => isNodeMastered(id, tree2, progress));
}
function nodeState(node, tree2, progress = getProgress()) {
  if (node.contentPending) return "content-pending";
  if (isNodeMastered(node.id, tree2, progress)) return "mastered";
  if (!isNodeUnlocked(node, tree2, progress)) return "locked";
  return "unlocked";
}
function isNodePlayable(node, tree2, progress = getProgress()) {
  const state = nodeState(node, tree2, progress);
  return state === "unlocked" || state === "mastered";
}
function recommendedNextNode(tree2, progress = getProgress()) {
  const nodes = allNodes(tree2);
  return nodes.find((node) => nodeState(node, tree2, progress) === "unlocked") ?? nodes.find((node) => isNodePlayable(node, tree2, progress)) ?? null;
}

// math-build/modules/prereq-diagnostic.js
var MIN_QUESTIONS = 3;
var DEFAULT_QUESTION_COUNT = 5;
var PASS_RATIO = 0.8;
function hasPrerequisiteDiagnostic(node) {
  return Array.isArray(node?.diagnosticPrereq) && node.diagnosticPrereq.length > 0;
}
async function buildPrerequisiteDiagnostic(node, loadBank, questionCount = DEFAULT_QUESTION_COUNT) {
  if (!hasPrerequisiteDiagnostic(node)) return [];
  const sourceIds = node.diagnosticPrereq.slice(0, 2);
  const results = await Promise.allSettled(sourceIds.map(async (nodeId) => ({
    nodeId,
    bank: await loadBank(nodeId)
  })));
  const pools = results.flatMap((result) => {
    if (result.status !== "fulfilled") return [];
    const questions = (result.value.bank.basicMastery ?? []).filter((question) => question?.type === "basic-mastery").map((question) => ({
      ...question,
      _diagnosticFor: node.id,
      _diagnosticPrereqNodeId: result.value.nodeId
    }));
    return questions.length > 0 ? [{ nodeId: result.value.nodeId, questions }] : [];
  });
  const target = Math.max(MIN_QUESTIONS, Math.min(DEFAULT_QUESTION_COUNT, Number(questionCount) || 0));
  const picked = [];
  let index = 0;
  while (picked.length < target && pools.some((pool) => index < pool.questions.length)) {
    pools.forEach((pool) => {
      if (picked.length < target && pool.questions[index]) picked.push(pool.questions[index]);
    });
    index += 1;
  }
  if (picked.length < MIN_QUESTIONS) {
    throw new Error(`\u5148\u5099\u8A3A\u65B7\u984C\u4E0D\u8DB3\uFF1A${node.id}`);
  }
  return picked;
}
function evaluatePrerequisiteDiagnostic(questions = [], answers = []) {
  const correctCount = questions.reduce((count, _question, index) => count + (answers[index] === true ? 1 : 0), 0);
  const passed = questions.length >= MIN_QUESTIONS && correctCount >= Math.ceil(questions.length * PASS_RATIO);
  const gapNodeIds = [];
  questions.forEach((question, index) => {
    const nodeId = question._diagnosticPrereqNodeId;
    if (answers[index] !== true && nodeId && !gapNodeIds.includes(nodeId)) gapNodeIds.push(nodeId);
  });
  return {
    passed,
    correctCount,
    total: questions.length,
    gapNodeIds: passed ? [] : gapNodeIds
  };
}
function applyDiagnosticResult(progress = {}, nodeId, result, completedAt = Date.now()) {
  const previous = progress[nodeId] ?? {};
  return {
    ...progress,
    [nodeId]: {
      ...previous,
      diagnosticUnlocked: result?.passed === true || previous.diagnosticUnlocked === true,
      diagnosticLastResult: {
        passed: result?.passed === true,
        correctCount: Number(result?.correctCount) || 0,
        total: Number(result?.total) || 0,
        gapNodeIds: Array.isArray(result?.gapNodeIds) ? [...result.gapNodeIds] : [],
        completedAt
      }
    }
  };
}

// math-build/modules/skilltree-ui.js
var HALO_R = 22;
var HIT_R = 26;
var CROWN_R = 32;
var LINE_TRIM = 26;
var SPACING_X = 190;
var SPACING_Y = 220;
var PAD = 60;
var PAD_TOP = 150;
var MIN_MAP_WIDTH = 940;
var MAX_NODES_PER_ROW = 5;
var LABEL_CHARS_PER_LINE = 8;
var LABEL_LINE_HEIGHT = 16;
var MAX_BG_STARS = 80;
var REALM_BACKGROUNDS = {
  "num-quantity": globalThis.mathAsset("assets/mythos/realms/labyrinth-bg.png"),
  algebra: globalThis.mathAsset("assets/mythos/realms/sphinx-temple-bg.png"),
  "space-shape": globalThis.mathAsset("assets/mythos/realms/cyclops-forge-bg.png"),
  "relation-pattern": globalThis.mathAsset("assets/mythos/realms/moirai-hall-bg.png"),
  "data-uncertainty": globalThis.mathAsset("assets/mythos/realms/delphi-oracle-bg.png")
};
var GUARDIAN_IMAGES = {
  "num-quantity": globalThis.mathAsset("assets/mythos/guardians/minotaur.webp"),
  algebra: globalThis.mathAsset("assets/mythos/guardians/sphinx.webp"),
  "space-shape": globalThis.mathAsset("assets/mythos/guardians/cyclops.webp"),
  "relation-pattern": globalThis.mathAsset("assets/mythos/guardians/moirai.webp"),
  "data-uncertainty": globalThis.mathAsset("assets/mythos/guardians/pythia.webp")
};
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== void 0) node.textContent = text;
  return node;
}
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}
function centerTransformBox(node) {
  node.style.transformBox = "fill-box";
  node.style.transformOrigin = "center";
  return node;
}
function starPath(outerR, innerR) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const rad = Math.PI / 4 * i - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push(`${(Math.cos(rad) * r).toFixed(2)},${(Math.sin(rad) * r).toFixed(2)}`);
  }
  return `M ${pts.join(" L ")} Z`;
}
function hashStr(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = h << 13 | h >>> 19;
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function computeDepths(nodes, allNodesById) {
  const depth = {};
  function getDepth(node) {
    if (depth[node.id] !== void 0) return depth[node.id];
    const prereqNodes = (node.prereq ?? []).map((pid) => allNodesById[pid]).filter(Boolean);
    if (prereqNodes.length === 0) {
      depth[node.id] = 0;
      return 0;
    }
    const d = Math.max(...prereqNodes.map(getDepth)) + 1;
    depth[node.id] = d;
    return d;
  }
  nodes.forEach(getDepth);
  return depth;
}
function splitLabelLines(text, maxChars = LABEL_CHARS_PER_LINE) {
  const chars = [...text.trim()];
  if (chars.length <= maxChars) return [chars.join("")];
  const lineCount = Math.ceil(chars.length / maxChars);
  const balancedLength = Math.ceil(chars.length / lineCount);
  return Array.from({ length: lineCount }, (_, index) => chars.slice(index * balancedLength, (index + 1) * balancedLength).join("")).filter(Boolean);
}
function layoutNodes(nodes, allNodesById, containerWidth = MIN_MAP_WIDTH) {
  const isNarrow = containerWidth < 600;
  const nodesPerRow = isNarrow ? MAX_NODES_PER_ROW - 2 : MAX_NODES_PER_ROW;
  const spacingX = isNarrow ? 120 : SPACING_X;
  const depth = computeDepths(nodes, allNodesById);
  const byDepth = {};
  nodes.forEach((n) => {
    const d = depth[n.id];
    (byDepth[d] = byDepth[d] ?? []).push(n);
  });
  const depthGroups = Object.entries(byDepth).sort(([a], [b]) => Number(a) - Number(b));
  const rows = depthGroups.flatMap(([, depthNodes]) => Array.from({ length: Math.ceil(depthNodes.length / nodesPerRow) }, (_, rowIndex) => depthNodes.slice(rowIndex * nodesPerRow, (rowIndex + 1) * nodesPerRow)));
  const maxCount = Math.max(...rows.map((row) => row.length));
  const width = isNarrow ? Math.max(1, containerWidth) : Math.max(MIN_MAP_WIDTH, maxCount * spacingX + PAD * 2);
  const height = rows.length * SPACING_Y + PAD_TOP + PAD;
  const positions = {};
  rows.forEach((arr, rowIndex) => {
    arr.forEach((node, idx) => {
      const offset = (idx - (arr.length - 1) / 2) * spacingX;
      positions[node.id] = { x: width / 2 + offset, y: rowIndex * SPACING_Y + PAD_TOP };
    });
  });
  return { positions, width, height };
}
function starCount(masteryPct, threshold) {
  if (masteryPct >= 0.98) return 3;
  if (masteryPct >= 0.9) return 2;
  if (masteryPct >= threshold) return 1;
  return 0;
}
function masteryThresholdForNode(node, tree2) {
  return tree2.masteryThresholds?.[node.tier] ?? tree2.masteryThreshold ?? 0.8;
}
function lockedNodeMessage(node, tree2, progress, nodesById) {
  if (node.contentPending) return `\u300C${node.name}\u300D\u984C\u5EAB\u5C1A\u672A\u5B8C\u6210\uFF0C\u73FE\u5728\u9084\u4E0D\u80FD\u9032\u5165`;
  if (!node.prereq || node.prereq.length === 0) return "";
  const names = node.prereq.filter((id) => !nodesById[id]?.contentPending && !isNodeMastered(id, tree2, progress)).map((id) => `\u300C${nodesById[id]?.name ?? id}\u300D`);
  return names.length > 0 ? `\u5148\u7CBE\u901A${names.join("\u3001")}\u624D\u80FD\u89E3\u9396` : "";
}
var sketchDefsInjected = false;
function makeSketchDefs() {
  const defs = svgEl("defs");
  if (sketchDefsInjected) return defs;
  sketchDefsInjected = true;
  const specs = [
    { id: "sketch-mid", freq: "0.03", scale: "3", seed: "13" },
    { id: "sketch-strong", freq: "0.045", scale: "4.5", seed: "7" }
  ];
  specs.forEach(({ id, freq, scale, seed }) => {
    const filter = svgEl("filter", { id, x: "-20%", y: "-20%", width: "140%", height: "140%" });
    filter.appendChild(svgEl("feTurbulence", {
      type: "fractalNoise",
      baseFrequency: freq,
      numOctaves: "2",
      seed,
      result: "noise"
    }));
    filter.appendChild(svgEl("feDisplacementMap", {
      in: "SourceGraphic",
      in2: "noise",
      scale,
      xChannelSelector: "R",
      yChannelSelector: "G"
    }));
    defs.appendChild(filter);
  });
  return defs;
}
function makeStarDefs(strandId) {
  const defs = svgEl("defs");
  [
    { id: `sigil-ember-${strandId}`, stops: [["0%", "#fff8e6"], ["40%", "#ffd98a"], ["100%", "#e8a13c"]] },
    { id: `sigil-lit-${strandId}`, stops: [["0%", "#ffffff"], ["35%", "#ffe9a8"], ["100%", "#f2c94c"]] }
  ].forEach(({ id, stops }) => {
    const grad = svgEl("radialGradient", { id });
    stops.forEach(([offset, color]) => {
      grad.appendChild(svgEl("stop", { offset, "stop-color": color }));
    });
    defs.appendChild(grad);
  });
  [
    { id: `star-glow-soft-${strandId}`, blur: "2.5" },
    { id: `star-glow-strong-${strandId}`, blur: "4.5" }
  ].forEach(({ id, blur }) => {
    const filter = svgEl("filter", { id, x: "-120%", y: "-120%", width: "340%", height: "340%" });
    filter.appendChild(svgEl("feGaussianBlur", { in: "SourceGraphic", stdDeviation: blur }));
    defs.appendChild(filter);
  });
  return defs;
}
function makeStarField(strand, width, height) {
  const field = svgEl("g", { class: "star-field" });
  const rand = mulberry32(hashStr(strand.id));
  const mobileCap = width < 600 ? 30 : MAX_BG_STARS;
  const count = Math.min(mobileCap, Math.round(width * height / 3500));
  for (let i = 0; i < count; i++) {
    const star = svgEl("circle", {
      class: "bg-star",
      cx: (rand() * width).toFixed(1),
      cy: (rand() * height).toFixed(1),
      r: (0.5 + rand() * 1.1).toFixed(2),
      opacity: (0.2 + rand() * 0.5).toFixed(2)
    });
    if (i % 4 === 0) {
      star.classList.add("twinkle");
      star.style.animationDelay = `${(rand() * 4).toFixed(2)}s`;
    }
    if (i % 6 === 5) star.classList.add("bg-star-arcane");
    if (i % 9 === 8) star.classList.add("bg-star-mana");
    field.appendChild(star);
  }
  return field;
}
function makeConstellationLines(from, to, isActive) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= LINE_TRIM * 2) return [];
  const ux = dx / dist;
  const uy = dy / dist;
  const x1 = from.x + ux * LINE_TRIM;
  const y1 = from.y + uy * LINE_TRIM;
  const x2 = to.x - ux * LINE_TRIM;
  const y2 = to.y - uy * LINE_TRIM;
  const lineLen = (dist - LINE_TRIM * 2).toFixed(1);
  const make = (cls) => {
    const line = svgEl("line", { x1, y1, x2, y2, class: cls, "stroke-linecap": "round" });
    line.style.setProperty("--line-length", lineLen);
    return line;
  };
  if (!isActive) {
    const dust = make("map-path constellation-dust");
    dust.setAttribute("stroke-dasharray", "1 7");
    return [dust];
  }
  return [
    make("map-path path-active constellation-glow"),
    make("map-path path-active constellation-core")
  ];
}
function makeCrown(stars) {
  const crown = svgEl("g", { class: "node-crown" });
  const step = 26 * Math.PI / 180;
  const start = -Math.PI / 2 - (stars - 1) / 2 * step;
  for (let i = 0; i < stars; i++) {
    const rad = start + i * step;
    const cx = (Math.cos(rad) * CROWN_R).toFixed(2);
    const cy = (Math.sin(rad) * CROWN_R).toFixed(2);
    crown.appendChild(svgEl("path", {
      class: "crown-star",
      d: starPath(4.5, 1.8),
      transform: `translate(${cx}, ${cy})`
    }));
  }
  return crown;
}
function makeNodeStar(state, strandId, twinkleIndex) {
  const star = centerTransformBox(svgEl("g", { class: `node-star node-star-${state}` }));
  if (state === "locked") {
    star.appendChild(svgEl("path", {
      class: "node-star-core",
      d: starPath(7, 2.8),
      fill: "#3d4663",
      stroke: "rgba(143,111,212,0.45)",
      "stroke-width": "1"
    }));
    star.appendChild(svgEl("circle", { class: "rune-stone-ring", r: 11 }));
    return star;
  }
  if (state === "unlocked") {
    const emberFill = `url(#sigil-ember-${strandId})`;
    star.appendChild(svgEl("path", {
      class: "node-star-glow",
      d: starPath(13, 5),
      fill: emberFill,
      filter: `url(#star-glow-soft-${strandId})`
    }));
    star.appendChild(svgEl("path", {
      class: "node-star-core",
      d: starPath(12, 4.6),
      fill: emberFill
    }));
    star.classList.add("twinkle");
    star.style.animationDelay = `${(twinkleIndex % 7 * 0.55).toFixed(2)}s`;
    return star;
  }
  const litFill = `url(#sigil-lit-${strandId})`;
  star.appendChild(svgEl("path", {
    class: "node-star-glow",
    d: starPath(16, 6),
    fill: litFill,
    filter: `url(#star-glow-strong-${strandId})`
  }));
  star.appendChild(centerTransformBox(svgEl("path", {
    class: "star-rays ray-breathe",
    d: starPath(26, 1.6)
  })));
  star.appendChild(svgEl("path", {
    class: "node-star-core",
    d: starPath(14, 5.5),
    fill: litFill
  }));
  star.appendChild(svgEl("circle", { class: "sigil-seal", r: 17 }));
  return star;
}
var lastMasteredIds = null;
function renderSkillTree(container, tree2, onSelectNode, onStartDiagnostic) {
  sketchDefsInjected = false;
  container.innerHTML = "";
  const progress = getProgress();
  const nodesById = Object.fromEntries(allNodes(tree2).map((n) => [n.id, n]));
  let frontierAssigned = false;
  let twinkleIndex = 0;
  const masteredNow = new Set(
    allNodes(tree2).filter((n) => nodeState(n, tree2, progress) === "mastered").map((n) => n.id)
  );
  const justMastered = new Set(
    lastMasteredIds ? [...masteredNow].filter((id) => !lastMasteredIds.has(id)) : []
  );
  lastMasteredIds = masteredNow;
  tree2.strands.forEach((strand) => {
    const strandBox = el("section", "strand");
    strandBox.dataset.strandId = strand.id;
    const visuals = tree2.strandVisuals?.[strand.id] ?? {};
    if (visuals.colorVar) strandBox.style.setProperty("--strand-color", `var(${visuals.colorVar})`);
    const header = el("div", "strand-header");
    header.appendChild(el("h3", "strand-name", strand.name));
    strandBox.appendChild(header);
    if (strand.status === "coming-soon" || strand.nodes.length === 0) {
      strandBox.appendChild(renderComingSoonStrand(strand));
      container.appendChild(strandBox);
      return;
    }
    const mapWrap = el("div", "skill-map");
    const containerWidth = Math.floor(mapWrap.getBoundingClientRect().width || container.clientWidth || MIN_MAP_WIDTH);
    const { positions, width, height } = layoutNodes(strand.nodes, nodesById, containerWidth);
    const realmBackground = document.createElement("img");
    realmBackground.className = "realm-background";
    realmBackground.src = REALM_BACKGROUNDS[strand.id];
    realmBackground.alt = "";
    realmBackground.loading = "lazy";
    realmBackground.decoding = "async";
    realmBackground.onerror = () => {
      realmBackground.hidden = true;
    };
    mapWrap.appendChild(realmBackground);
    const svg = svgEl("svg", {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      role: "group",
      "aria-label": `${strand.name}\u6280\u80FD\u661F\u5716`
    });
    svg.style.setProperty("--skill-map-width", `${width}px`);
    svg.appendChild(makeSketchDefs());
    svg.appendChild(makeStarDefs(strand.id));
    svg.appendChild(makeStarField(strand, width, height));
    strand.nodes.forEach((node) => {
      (node.prereq ?? []).forEach((prereqId) => {
        const from = positions[prereqId];
        const to = positions[node.id];
        if (!from || !to) return;
        const isActive = nodeState(nodesById[prereqId], tree2, progress) === "mastered";
        makeConstellationLines(from, to, isActive).forEach((line) => {
          if (justMastered.has(prereqId)) line.classList.add("constellation-draw");
          svg.appendChild(line);
        });
      });
    });
    let frontierNode = null;
    strand.nodes.forEach((node) => {
      const state = nodeState(node, tree2, progress);
      const visualState = state === "content-pending" ? "locked" : state;
      const pos = positions[node.id];
      const mastery = getNodeMastery(node.id, progress);
      const masteryThreshold = masteryThresholdForNode(node, tree2);
      const stars = starCount(mastery, masteryThreshold);
      if (!frontierAssigned && state === "unlocked") {
        frontierNode = node;
        frontierAssigned = true;
      }
      const lockReason = lockedNodeMessage(node, tree2, progress, nodesById);
      const diagnosticAction = state === "locked" && hasPrerequisiteDiagnostic(node) && typeof onStartDiagnostic === "function" ? () => onStartDiagnostic(node) : null;
      const progressPct = Math.round(Math.min(1, mastery / masteryThreshold) * 100);
      const stateLabel = state === "mastered" ? "\u5DF2\u7CBE\u719F" : state === "unlocked" ? "\u53EF\u6311\u6230" : "\u5C1A\u672A\u89E3\u9396";
      const g = svgEl("g", {
        class: `map-node state-${visualState}${frontierNode === node ? " is-frontier" : ""}`,
        "data-state": state,
        transform: `translate(${pos.x}, ${pos.y})`,
        role: "button",
        tabindex: "0",
        "aria-disabled": state === "locked" || state === "content-pending" ? "true" : "false",
        "aria-label": `${node.name}\uFF0C${stateLabel}\uFF0C\u9032\u5EA6 ${progressPct}%\uFF0C${stars} \u661F${lockReason ? `\uFF0C${lockReason}` : ""}`
      });
      const title = svgEl("title");
      title.textContent = lockReason ? `${node.name}\uFF1A${lockReason}` : node.name;
      g.appendChild(title);
      g.appendChild(svgEl("circle", { class: "node-ring-bg", r: HALO_R }));
      const circumference = 2 * Math.PI * HALO_R;
      const pct = state === "mastered" ? 1 : Math.min(1, mastery / masteryThreshold);
      g.appendChild(svgEl("circle", {
        class: "node-ring-progress",
        r: HALO_R,
        "stroke-linecap": "round",
        "stroke-dasharray": circumference,
        "stroke-dashoffset": circumference * (1 - pct)
      }));
      if (justMastered.has(node.id)) {
        const ripple = centerTransformBox(svgEl("circle", { class: "halo-ripple", r: HALO_R }));
        ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
        setTimeout(() => ripple.remove(), 1200);
        g.appendChild(ripple);
      }
      const star = makeNodeStar(visualState, strand.id, twinkleIndex++);
      if (justMastered.has(node.id)) star.classList.add("star-ignite");
      g.appendChild(star);
      if (visualState !== "locked" && stars > 0) g.appendChild(makeCrown(stars));
      const label = svgEl("text", { class: "node-label", y: HALO_R + 18, "paint-order": "stroke" });
      splitLabelLines(node.name).forEach((line2, lineIndex) => {
        const tspan = svgEl("tspan", { x: 0, dy: lineIndex === 0 ? 0 : LABEL_LINE_HEIGHT });
        tspan.textContent = line2;
        label.appendChild(tspan);
      });
      g.appendChild(label);
      const english = globalThis.mathBilingual.translate(node.name) || "";
      const words = english.split(" "), lines = [];
      let line = "";
      for (const word of words) {
        if ((line + " " + word).length > 18 && line) {
          lines.push(line);
          line = word;
        } else line += (line ? " " : "") + word;
      }
      if (line) lines.push(line);
      const enLabel = svgEl("text", { class: "node-label node-label-en", y: HALO_R + 24 + splitLabelLines(node.name).length * LABEL_LINE_HEIGHT, "data-math-en": "", lang: "en" });
      lines.forEach((line2, i) => {
        const span = svgEl("tspan", { x: 0, dy: i === 0 ? 0 : 15 });
        span.textContent = line2;
        enLabel.appendChild(span);
      });
      g.appendChild(enLabel);
      g.appendChild(svgEl("circle", { class: "node-hit", r: HIT_R, fill: "transparent" }));
      g.addEventListener("click", () => {
        if (state === "unlocked" || state === "mastered") onSelectNode(node);
        else if (lockReason) showLockTapTip(mapWrap, pos, lockReason, diagnosticAction);
      });
      g.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (state === "unlocked" || state === "mastered") onSelectNode(node);
        else if (lockReason) showLockTapTip(mapWrap, pos, lockReason, diagnosticAction);
      });
      svg.appendChild(g);
    });
    mapWrap.appendChild(svg);
    if (frontierNode && GUARDIAN_IMAGES[strand.id]) {
      const pos = positions[frontierNode.id];
      const mascot = el("div", "map-mascot");
      const img = document.createElement("img");
      img.src = GUARDIAN_IMAGES[strand.id];
      img.alt = `${strand.name}\u5B88\u8B77\u8005`;
      img.onerror = () => {
        mascot.style.display = "none";
      };
      mascot.appendChild(img);
      mascot.style.left = `${pos.x}px`;
      mascot.style.top = `${pos.y}px`;
      mapWrap.appendChild(mascot);
      const tip = el("div", "node-suggested-tip", "\u2726 \u5F9E\u9019\u679A\u661F\u7B26\u958B\u59CB");
      tip.style.left = `${pos.x}px`;
      tip.style.top = `${pos.y}px`;
      mapWrap.appendChild(tip);
    }
    strandBox.appendChild(mapWrap);
    container.appendChild(strandBox);
  });
}
var activeLockTapTip = null;
function showLockTapTip(mapWrap, pos, reason, onStartDiagnostic) {
  activeLockTapTip?.remove();
  const tip = el("div", "node-suggested-tip lock-tap-tip");
  tip.setAttribute("role", "status");
  tip.setAttribute("aria-live", "polite");
  tip.appendChild(el("div", "lock-tap-message", `\u{1F512} ${reason}`));
  tip.style.left = `${pos.x}px`;
  tip.style.top = `${pos.y}px`;
  if (pos.y < 150) tip.classList.add("lock-tap-tip-below");
  mapWrap.appendChild(tip);
  activeLockTapTip = tip;
  const dismiss = () => {
    if (activeLockTapTip === tip) activeLockTapTip = null;
    tip.remove();
    document.removeEventListener("click", dismiss);
  };
  if (onStartDiagnostic) {
    const button = el("button", "lock-diagnostic-btn", "\u53C3\u52A0\u5148\u5099\u8A3A\u65B7");
    button.type = "button";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      dismiss();
      onStartDiagnostic();
    });
    tip.appendChild(button);
  }
  setTimeout(dismiss, 6e3);
  setTimeout(() => document.addEventListener("click", dismiss), 0);
}
function renderComingSoonStrand(strand) {
  const banner = el("div", "strand-soon-banner");
  banner.appendChild(el("div", "soon-title", "\u9019\u5E7E\u5F35\u661F\u8C61\u5716\uFF0C\u5C0E\u5E2B\u9084\u6C92\u7E6A\u5B8C\u2026"));
  banner.appendChild(el("div", "", "\u656C\u8ACB\u671F\u5F85"));
  const tip = el("div", "soon-tip", "");
  banner.appendChild(tip);
  banner.addEventListener("click", () => {
    banner.style.animation = "none";
    void banner.offsetWidth;
    banner.style.animation = "shake-x 0.3s";
    tip.textContent = "\u661F\u5C51\u672A\u51DD\uFF0C\u5148\u53BB\u5225\u7684\u795E\u8AED\u5377\u8EF8\u7DF4\u529F\u5427\uFF01";
  });
  return banner;
}
function computeOverview(tree2) {
  const progress = getProgress();
  const nodes = allNodes(tree2).filter((node) => !node.contentPending);
  const masteredCount = nodes.filter((n) => nodeState(n, tree2, progress) === "mastered").length;
  return { totalNodes: nodes.length, masteredCount, nodes };
}

// math-build/modules/leitner.js
var MAX_BOX = 5;
var BOX_INTERVAL_DAYS = [0, 1, 3, 7, 14];
var boxStateCache;
function getBoxState() {
  return boxStateCache ??= store.read("leitner", {});
}
function getBox(questionId) {
  const state = getBoxState();
  return state[questionId]?.box ?? 1;
}
function isDue(questionId) {
  const state = getBoxState();
  const record = state[questionId];
  if (!record) return true;
  const intervalDays = BOX_INTERVAL_DAYS[record.box - 1] ?? 0;
  const dueAt = record.lastSeen + intervalDays * 24 * 60 * 60 * 1e3;
  return Date.now() >= dueAt;
}
function hasRecord(questionId) {
  return !!getBoxState()[questionId];
}
function updateBox(questionId, correct, nodeId = null) {
  const state = getBoxState();
  const current = state[questionId]?.box ?? 1;
  const nextBox = correct ? Math.min(MAX_BOX, current + 1) : Math.max(1, current - 1);
  state[questionId] = { ...state[questionId], box: nextBox, lastSeen: Date.now(), ...nodeId ? { nodeId } : {} };
  boxStateCache = state;
  store.write("leitner", state);
  return nextBox;
}

// math-build/modules/mastery-engine.js
function difficultyWeight(difficulty, accuracy) {
  if (accuracy < 0.5) return { easy: 5, medium: 2, hard: 1 }[difficulty] ?? 1;
  if (accuracy >= 0.85) return { easy: 1, medium: 2, hard: 5 }[difficulty] ?? 1;
  return { easy: 2, medium: 4, hard: 2 }[difficulty] ?? 1;
}
function pickWeightedQuestion(questions, accuracy, random) {
  if (questions.length === 0) return null;
  const weighted = questions.map((question) => ({
    question,
    weight: difficultyWeight(question.difficulty, accuracy)
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let target = random() * total;
  for (const item of weighted) {
    target -= item.weight;
    if (target < 0) return item.question;
  }
  return weighted.at(-1)?.question ?? null;
}
function pickDifficultySequence(questions, accuracy, limit, random) {
  const available = [...questions];
  const result = [];
  while (available.length > 0 && result.length < limit) {
    const question = pickWeightedQuestion(available, accuracy, random);
    if (!question) break;
    result.push(question);
    available.splice(available.indexOf(question), 1);
  }
  return result;
}
function challengeWeight(attempts, challenge) {
  const matching = attempts.filter((attempt) => attempt.challenge === challenge);
  const lastTwo = matching.slice(-2);
  if (lastTwo.length === 2 && lastTwo.every((attempt) => attempt.correct)) return 0.5;
  if (matching.some((attempt) => !attempt.correct)) return 2;
  return 1;
}
function pickWeightedChallenge(challenges, attempts, random) {
  const weighted = challenges.map((challenge) => ({
    challenge,
    weight: challengeWeight(attempts, challenge)
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let target = random() * total;
  for (const item of weighted) {
    target -= item.weight;
    if (target < 0) return item.challenge;
  }
  return weighted.at(-1)?.challenge ?? null;
}
function masteryStars(accuracy) {
  if (accuracy === 1) return 3;
  if (accuracy >= 0.9) return 2;
  if (accuracy >= 0.8) return 1;
  return 0;
}
var DEFAULT_TIER_THRESHOLDS = {
  "elem-low": 0.75,
  "elem-mid": 0.75,
  "elem-high": 0.8,
  "jhs-g7": 0.8
};
var MASTER_TRIAL_TIERS = [
  { id: "bronze", name: "\u9285\u7AE0\u8A66\u7149", questionCount: 10, passPct: 0.8, reward: { stardust: 10 }, requires: null },
  { id: "silver", name: "\u9280\u7AE0\u8A66\u7149", questionCount: 15, passPct: 0.9, reward: { stardust: 25 }, requires: "bronze" },
  { id: "gold", name: "\u91D1\u7AE0\u8A66\u7149", questionCount: 20, passPct: 1, reward: { stardust: 50 }, requires: "silver" }
];
function masterTrialTierState(records = {}) {
  return MASTER_TRIAL_TIERS.map((tier) => ({
    ...tier,
    unlocked: tier.requires === null || records[tier.requires]?.cleared === true,
    cleared: records[tier.id]?.cleared === true,
    bestPct: records[tier.id]?.bestPct ?? 0
  }));
}
function settleMasterTrialTier(tierId, pct, records = {}, at = Date.now()) {
  const tier = MASTER_TRIAL_TIERS.find((item) => item.id === tierId);
  if (!tier) return { passed: false, rewardStardust: 0, records };
  const state = masterTrialTierState(records).find((item) => item.id === tierId);
  if (!state?.unlocked) return { passed: false, rewardStardust: 0, records };
  const prior = records[tierId] ?? {};
  const passed = pct >= tier.passPct;
  const firstClear = passed && prior.cleared !== true;
  return {
    passed,
    firstClear,
    rewardStardust: firstClear ? tier.reward.stardust : 0,
    records: {
      ...records,
      [tierId]: {
        ...prior,
        cleared: prior.cleared === true || passed,
        bestPct: Math.max(prior.bestPct ?? 0, pct),
        ...firstClear ? { clearedAt: at } : {}
      }
    }
  };
}
function masteryThresholdFor(node = {}, threshold) {
  if (Number.isFinite(threshold)) return threshold;
  if (Number.isFinite(node.masteryThreshold)) return node.masteryThreshold;
  return DEFAULT_TIER_THRESHOLDS[node.tier] ?? 0.8;
}
function nextStepRecommendation(stats = {}, wasMastered = false) {
  if (!wasMastered && stats.mastered) {
    return { kind: "just-mastered", label: "\u26A1 \u540C\u7BC0\u9EDE\u518D\u7DF4\u4E00\u8F2A" };
  }
  const unmet = stats.unmetConditions ?? [];
  if (!stats.mastered && unmet.length >= 1 && unmet.length <= 2) {
    const remaining = Math.max(1, Math.ceil(Number(stats.remainingPracticeCount) || 1));
    return { kind: "close", remaining, label: "\u518D\u7DF4\u4E00\u8F2A\uFF0C\u5F88\u53EF\u80FD\u5C31\u5B8C\u5377\uFF01" };
  }
  return { kind: "retry", label: "\u26A1 \u540C\u7BC0\u9EDE\u518D\u7DF4\u4E00\u8F2A" };
}
function expectedChallenges(attempts, node) {
  if (Array.isArray(node.challengeIds) && node.challengeIds.length > 0) {
    return [...new Set(node.challengeIds)];
  }
  const observed = attempts.map((attempt) => attempt.challenge).filter(Boolean);
  const seeds = [...observed, ...node.gateChallenges ?? []];
  const parsed = seeds.map((challenge) => /^(.*-)(\d+)$/.exec(challenge)).filter(Boolean);
  if (parsed.length === 0) return [];
  const prefix = parsed[0][1];
  if (!parsed.every((match) => match[1] === prefix)) return [...new Set(seeds)];
  const count = Math.max(...parsed.map((match) => Number(match[2])));
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}
var isScoredAttempt = (attempt) => attempt.prereqQuickCheck !== true && attempt.coachingAttempt !== true && attempt.retryAttempt !== true;
function activeErrorLocks(attempts = []) {
  const relevant = attempts.filter(isScoredAttempt);
  if (!relevant.some((attempt) => attempt.challenge)) return [];
  const window2 = relevant.slice(-10);
  const pathHits = /* @__PURE__ */ new Map();
  for (const attempt of window2) {
    if (attempt.correct || attempt.errorPath === void 0 || attempt.errorPath === null) continue;
    if (!pathHits.has(attempt.errorPath)) pathHits.set(attempt.errorPath, []);
    pathHits.get(attempt.errorPath).push(attempt);
  }
  const locks = [];
  for (const [errorPath, hits] of pathHits) {
    if (hits.length < 2) continue;
    const secondHitIndex = relevant.indexOf(hits[1]);
    const remediation = relevant.slice(secondHitIndex + 1).filter(
      (attempt) => attempt.errorPath === errorPath && attempt.type === "error-diagnosis"
    );
    const cleared = remediation.length >= 2 && remediation.slice(-2).every((attempt) => attempt.correct);
    if (!cleared) locks.push(errorPath);
  }
  return locks;
}
function prereqQuickCheckPassed(attempts = [], errorPath, prereqNodeId) {
  const matching = attempts.filter(
    (attempt) => attempt.prereqQuickCheck === true && attempt.remediationPath === errorPath && attempt.prereqNodeId === prereqNodeId
  );
  const latestByQuestion = /* @__PURE__ */ new Map();
  for (const attempt of matching) latestByQuestion.set(attempt.questionId, attempt);
  const latest = [...latestByQuestion.values()].slice(-3);
  return latest.length === 3 && latest.every((attempt) => attempt.correct);
}
function evaluateMastery(attempts = [], node = {}, threshold, alreadyMastered = false) {
  const resolvedThreshold = masteryThresholdFor(node, threshold);
  const scoredAttempts = attempts.filter(isScoredAttempt);
  const window2 = scoredAttempts.slice(-10);
  const correctCount = window2.filter((attempt) => attempt.correct).length;
  const accuracy = window2.length === 0 ? 0 : correctCount / window2.length;
  const hasChallengeData = scoredAttempts.some((attempt) => attempt.challenge);
  const gates = node.gateChallenges ?? [];
  const challenges = expectedChallenges(scoredAttempts, node);
  const latestByChallenge = /* @__PURE__ */ new Map();
  for (const attempt of scoredAttempts) {
    if (attempt.challenge) latestByChallenge.set(attempt.challenge, attempt);
  }
  const missingChallenges = hasChallengeData ? challenges.filter((challenge) => !latestByChallenge.get(challenge)?.correct) : [];
  const challengeCorrect = challenges.filter((challenge) => latestByChallenge.get(challenge)?.correct).length;
  const windowTypes = new Set(window2.map((attempt) => attempt.type).filter(Boolean));
  const conceptAndDiagnosisCorrect = window2.filter(
    (attempt) => attempt.correct && (attempt.type === "concept-id" || attempt.type === "error-diagnosis")
  ).length;
  const lowShortcut = node.tier === "elem-low" && scoredAttempts.length >= 8 && scoredAttempts.slice(-8).every((attempt) => attempt.correct);
  const errorLocks = activeErrorLocks(scoredAttempts);
  const conditions = {
    A: lowShortcut || window2.length === 10 && accuracy >= resolvedThreshold,
    B: lowShortcut || scoredAttempts.length >= 12,
    C: !hasChallengeData || challengeCorrect >= Math.max(0, challenges.length - 1) && gates.every((gate) => latestByChallenge.get(gate)?.correct),
    D: ["basic-mastery", "concept-id", "error-diagnosis", "context-application"].every((type) => windowTypes.has(type)) && conceptAndDiagnosisCorrect >= 3,
    E: !hasChallengeData || errorLocks.length === 0
  };
  const clampPct = (value) => Math.max(0, Math.min(100, Math.round(value)));
  const requiredChallengeCount = Math.max(0, challenges.length - 1);
  const passedGateCount = gates.filter((gate) => latestByChallenge.get(gate)?.correct).length;
  const typeCoverage = windowTypes.size;
  const criteriaProgress = {
    A: {
      pct: lowShortcut ? 100 : clampPct(Math.min(window2.length / 10, accuracy / resolvedThreshold) * 100),
      current: Math.round(accuracy * 100),
      target: Math.round(resolvedThreshold * 100),
      label: `\u7B54\u5C0D\u7387 ${Math.round(accuracy * 100)}%/${Math.round(resolvedThreshold * 100)}%\uFF08\u8FD1 ${window2.length}/10 \u984C\uFF09`
    },
    B: {
      pct: lowShortcut ? 100 : clampPct(scoredAttempts.length / 12 * 100),
      current: Math.min(scoredAttempts.length, 12),
      target: 12,
      label: `\u7DF4\u7FD2\u91CF ${Math.min(scoredAttempts.length, 12)}/12 \u984C`
    },
    C: {
      pct: !hasChallengeData ? 100 : clampPct(Math.min(
        requiredChallengeCount === 0 ? 1 : challengeCorrect / requiredChallengeCount,
        gates.length === 0 ? 1 : passedGateCount / gates.length
      ) * 100),
      current: challengeCorrect,
      target: requiredChallengeCount,
      gateCurrent: passedGateCount,
      gateTarget: gates.length,
      label: !hasChallengeData ? "\u6311\u6230\u8986\u84CB\uFF1A\u820A\u984C\u5EAB\u7121\u6311\u6230\u7DE8\u865F\uFF0C\u76F4\u63A5\u901A\u904E" : `\u6311\u6230\u8986\u84CB ${challengeCorrect}/${requiredChallengeCount}\u30FB\u5B88\u9580 ${passedGateCount}/${gates.length}`
    },
    D: {
      pct: clampPct(Math.min(typeCoverage / 4, conceptAndDiagnosisCorrect / 3) * 100),
      current: conceptAndDiagnosisCorrect,
      target: 3,
      typeCurrent: Math.min(typeCoverage, 4),
      typeTarget: 4,
      label: `\u984C\u578B\u8986\u84CB ${Math.min(typeCoverage, 4)}/4\u30FB\u6982\u5FF5\u8207\u627E\u932F\u7B54\u5C0D ${Math.min(conceptAndDiagnosisCorrect, 3)}/3`
    },
    E: {
      pct: !hasChallengeData || errorLocks.length === 0 ? 100 : 0,
      current: errorLocks.length,
      target: 0,
      label: errorLocks.length === 0 ? "\u932F\u8AA4\u58A8\u8DEF\u5DF2\u6E05\u7A7A" : `\u5F85\u6DE8\u5316\u932F\u8AA4\u58A8\u8DEF ${errorLocks.length} \u689D`
    }
  };
  const mastered = alreadyMastered || Object.values(conditions).every(Boolean);
  const unmetConditions = Object.entries(conditions).filter(([, met]) => !met).map(([condition]) => condition);
  const remainingPracticeCount = Math.max(0, 12 - scoredAttempts.length, 10 - window2.length);
  const details = {
    A: `\u518D\u591A\u7DF4 ${Math.max(1, 10 - window2.length)} \u984C\uFF0C\u6700\u8FD1 10 \u984C\u7B54\u5C0D\u7387\u8981\u63A5\u8FD1 ${Math.round(resolvedThreshold * 100)}% \u624D\u6703\u4EAE`,
    B: `\u518D\u591A\u5BEB ${Math.max(0, 12 - scoredAttempts.length)} \u984C\u5C31\u96C6\u6EFF\u7DF4\u7FD2\u91CF\u56C9`,
    C: missingChallenges.length > 0 ? `\u518D\u9EDE\u4EAE\u9019\u4E9B\u6311\u6230\uFF1A${missingChallenges.join("\u3001")}` : "\u5B88\u9580\u6311\u6230\u518D\u7B54\u5C0D\u4E00\u6B21\uFF0C\u9019\u8655\u661F\u5149\u5C31\u6703\u4EAE\u8D77\u4F86",
    D: "\u56DB\u7A2E\u984C\u578B\u90FD\u518D\u78B0\u4E00\u78B0\uFF0C\u6982\u5FF5\u8FA8\u8B58\u548C\u627E\u932F\u984C\u5408\u8A08\u7B54\u5C0D 3 \u984C\u5C31\u597D",
    E: `\u7B2C ${errorLocks.join("\u3001")} \u689D\u58A8\u8DEF\u9084\u6C92\u4EAE\uFF0C\u5148\u505A\u6696\u8EAB\u984C\uFF0C\u518D\u5B8C\u6210\u5169\u984C\u627E\u932F\u7DF4\u7FD2`
  };
  const feedback = unmetConditions.length === 0 ? "\u4E94\u8655\u661F\u5149\u90FD\u5DF2\u9EDE\u4EAE\uFF0C\u9019\u5377\u795E\u8AED\u5377\u8EF8\u53EF\u4EE5\u5B8C\u5377\u3002" : `\u9084\u6C92\u5B8C\u5377\uFF1A${unmetConditions.map((condition) => details[condition]).join("\uFF1B")}\u3002`;
  return {
    mastered,
    masteryPct: Math.round(accuracy * 100) / 100,
    stars: masteryStars(accuracy),
    conditions,
    criteriaProgress,
    unmetConditions,
    remainingPracticeCount,
    missingChallenges,
    feedback,
    errorLocks
  };
}
function prioritizeBasicWarmup(sequence = [], candidates = sequence, limit = sequence.length) {
  const target = Math.min(2, Math.max(0, limit));
  if (target === 0) return [];
  const result = [...sequence];
  const selected = result.filter((question) => question.type === "basic-mastery").slice(0, target);
  const selectedIds = new Set(selected.map((question) => question.id));
  const basicCandidates = candidates.filter((question) => question.type === "basic-mastery" && !selectedIds.has(question.id));
  for (const candidate of basicCandidates) {
    if (selected.length >= target) break;
    const sameChallengeIndex = candidate.challenge ? result.findIndex((question) => question.challenge === candidate.challenge && !selectedIds.has(question.id)) : -1;
    if (sameChallengeIndex >= 0) result.splice(sameChallengeIndex, 1, candidate);
    else if (!result.some((question) => question.id === candidate.id)) result.push(candidate);
    selected.push(candidate);
    selectedIds.add(candidate.id);
  }
  return [
    ...selected,
    ...result.filter((question) => !selectedIds.has(question.id))
  ].slice(0, limit);
}
function buildAdaptiveSequence(questions, attempts = [], limit = 8, random = Math.random, node = {}) {
  const recent = attempts.filter(isScoredAttempt).slice(-10);
  const accuracy = recent.length === 0 ? 0 : recent.filter((attempt) => attempt.correct).length / recent.length;
  const eligibleQuestions = node.tier === "elem-low" && accuracy < 0.6 ? questions.filter((question) => question.type !== "error-diagnosis") : questions;
  const cooldownIds = new Set(attempts.slice(-6).map((attempt) => attempt.questionId));
  const warmupCandidates = eligibleQuestions.filter((question) => !cooldownIds.has(question.id));
  const challengeQuestions = eligibleQuestions.filter((question) => question.challenge);
  if (challengeQuestions.length === 0) {
    if (!eligibleQuestions.some((question) => question.difficulty)) {
      return prioritizeBasicWarmup(eligibleQuestions.slice(0, limit), warmupCandidates, limit);
    }
    return prioritizeBasicWarmup(
      pickDifficultySequence(eligibleQuestions, accuracy, limit, random),
      warmupCandidates,
      limit
    );
  }
  const attemptedChallenges = new Set(attempts.map((attempt) => attempt.challenge).filter(Boolean));
  const groups = /* @__PURE__ */ new Map();
  for (const question of challengeQuestions) {
    if (!groups.has(question.challenge)) groups.set(question.challenge, []);
    groups.get(question.challenge).push(question);
  }
  const errorLocks = activeErrorLocks(attempts);
  const remediation = errorLocks.length === 0 ? [] : eligibleQuestions.filter(
    (question) => question.type === "error-diagnosis" && question.errorPath === errorLocks[0] && !cooldownIds.has(question.id)
  ).slice(0, 2).map((question) => ({ ...question, _remediation: true }));
  const queue = remediation.slice(0, limit);
  const queuedIds = new Set(queue.map((question) => question.id));
  for (const [challenge, variants] of groups) {
    if (attemptedChallenges.has(challenge)) continue;
    const candidates = variants.filter(
      (question2) => !cooldownIds.has(question2.id) && !queuedIds.has(question2.id)
    );
    const question = pickWeightedQuestion(candidates, accuracy, random);
    if (question) {
      queue.push(question);
      queuedIds.add(question.id);
    }
    if (queue.length >= limit) break;
  }
  while (queue.length < limit) {
    const availableChallenges = [...groups].filter(
      ([, variants]) => variants.some((question2) => !cooldownIds.has(question2.id) && !queuedIds.has(question2.id))
    ).map(([challenge2]) => challenge2);
    if (availableChallenges.length === 0) break;
    const challenge = pickWeightedChallenge(availableChallenges, attempts, random);
    const candidates = groups.get(challenge).filter(
      (question2) => !cooldownIds.has(question2.id) && !queuedIds.has(question2.id)
    );
    const question = pickWeightedQuestion(candidates, accuracy, random);
    if (!question) break;
    queue.push(question);
    queuedIds.add(question.id);
  }
  return prioritizeBasicWarmup(queue, warmupCandidates, limit);
}

// math-build/modules/quiz-loader.js
var bankCache = {};
async function loadQuestionBank(nodeId) {
  if (bankCache[nodeId]) return bankCache[nodeId];
  const res = await fetch(`data/questions/${nodeId}.json`);
  if (!res.ok) throw new Error(`\u984C\u5EAB\u8F09\u5165\u5931\u6557\uFF1A${nodeId}\uFF08${res.status}\uFF09`);
  const bank = validateQuestionBank(await res.json());
  bankCache[nodeId] = bank;
  return bank;
}
function flattenBank(bank) {
  return [
    ...bank.basicMastery ?? [],
    ...bank.conceptId ?? [],
    ...bank.errorDiagnosis ?? [],
    ...bank.contextApplication ?? []
  ];
}
function mentorStrategyLine(nodeName, question, fallback) {
  const explanation = typeof question?.explanation === "string" ? question.explanation.trim() : "";
  return explanation ? `${nodeName}\uFF1A\u5148\u6293\u95DC\u9375\u6B65\u9A5F\u2014\u2014${explanation}` : fallback;
}
function insertMentorCoachingQuestion(queue, currentIndex, basicQuestions, mentorLine, random = Math.random, trigger = {}) {
  const allCandidates = (basicQuestions ?? []).filter((question) => question?.type === "basic-mastery");
  const sameSkill = trigger.nodeId ? allCandidates.filter((question) => question._nodeId === trigger.nodeId) : [];
  const candidates = sameSkill.length > 0 ? sameSkill : allCandidates;
  if (candidates.length === 0) return false;
  const picked = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  const specificLine = mentorStrategyLine(trigger.nodeName ?? trigger.nodeId ?? "\u9019\u4E00\u984C", picked, mentorLine);
  queue.splice(currentIndex + 1, 0, { ...picked, _mentorCoaching: true, _mentorLine: specificLine });
  return true;
}
function mentorCoachingTransition(state, isCorrect) {
  if (isCorrect) {
    return { consecutiveWrong: 0, retryUsed: false, insertRetry: false };
  }
  const consecutiveWrong = Math.max(0, Number(state?.consecutiveWrong) || 0) + 1;
  const retryUsed = state?.retryUsed === true;
  return {
    consecutiveWrong,
    retryUsed: !retryUsed,
    insertRetry: !retryUsed
  };
}
async function buildMasterSession(nodeIds, sessionSize = 10) {
  const results = await Promise.allSettled(nodeIds.map(loadQuestionBank));
  const all = results.flatMap((result, i) => result.status === "fulfilled" ? flattenBank(result.value).map((q) => ({ ...q, _nodeId: nodeIds[i] })) : []);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, Math.min(sessionSize, all.length));
}
async function buildSession(nodeId, sessionSize = 8, strategy = "slow", errorEntries = [], node = {}) {
  const bank = await loadQuestionBank(nodeId);
  const all = flattenBank(bank);
  const repairQuestions = strategy === "repair" ? errorEntries.slice(0, sessionSize).map((e) => ({ ...e.question, _fromErrorbook: true })) : [];
  const repairIds = new Set(repairQuestions.map((q) => q.id));
  const rest = all.filter((q) => !repairIds.has(q.id));
  const attempts = store.read("progress", {})[nodeId]?.attempts ?? [];
  const errorLock = activeErrorLocks(attempts)[0];
  const prereqNodeId = node.prereq?.[0];
  if (errorLock !== void 0 && prereqNodeId && !prereqQuickCheckPassed(attempts, errorLock, prereqNodeId)) {
    const prereqBank = await loadQuestionBank(prereqNodeId);
    return (prereqBank.basicMastery ?? []).slice(0, 3).map((question) => ({
      ...question,
      _prereqQuickCheck: true,
      _prereqNodeId: prereqNodeId,
      _remediationPath: errorLock
    }));
  }
  const challengeIds = [...new Set(rest.map((question) => question.challenge).filter(Boolean))];
  const isInitialChallengeScan = challengeIds.length > 0 && !attempts.some((attempt) => attempt.challenge);
  const targetSize = isInitialChallengeScan ? Math.max(sessionSize, challengeIds.length) : sessionSize;
  const adaptive = rest.some((question) => question.challenge || question.difficulty) ? buildAdaptiveSequence(
    rest,
    attempts,
    Math.max(0, targetSize - repairQuestions.length),
    Math.random,
    node
  ).map((question) => ({ ...question, _challengeIds: challengeIds })) : rest;
  const due = adaptive.filter((q) => isDue(q.id));
  const notDue = adaptive.filter((q) => !isDue(q.id));
  const dueIds = new Set(due.map((q) => q.id));
  const ordered = [...repairQuestions, ...due, ...notDue].sort((a, b) => {
    if (!!a._fromErrorbook !== !!b._fromErrorbook) return a._fromErrorbook ? -1 : 1;
    if (!!a._remediation !== !!b._remediation) return a._remediation ? -1 : 1;
    const aDue = dueIds.has(a.id);
    const bDue = dueIds.has(b.id);
    if (aDue !== bDue) return aDue ? -1 : 1;
    if (aDue) return getBox(b.id) - getBox(a.id);
    return getBox(a.id) - getBox(b.id);
  });
  const outputSize = Math.min(targetSize, ordered.length);
  return prioritizeBasicWarmup(ordered, [...repairQuestions, ...rest], outputSize);
}
async function buildReviewSession(nodeIds, sessionSize = 6) {
  const state = getBoxState();
  const dueRecords = Object.entries(state).filter(([id]) => isDue(id));
  const dueNodeIds = new Set(dueRecords.map(([, record]) => record.nodeId).filter(Boolean));
  const hasLegacyDue = dueRecords.some(([, record]) => !record.nodeId);
  const nodesToFetch = hasLegacyDue ? nodeIds : nodeIds.filter((id) => dueNodeIds.has(id));
  const results = await Promise.allSettled(nodesToFetch.map(loadQuestionBank));
  const all = results.flatMap((result, i) => result.status === "fulfilled" ? flattenBank(result.value).map((q) => {
    const nodeId = nodesToFetch[i];
    if (state[q.id] && !state[q.id].nodeId) state[q.id].nodeId = nodeId;
    return { ...q, _nodeId: nodeId };
  }) : []);
  if (dueRecords.some(([, record]) => !record.nodeId)) store.write("leitner", state);
  return all.filter((q) => hasRecord(q.id) && isDue(q.id)).sort((a, b) => getBox(b.id) - getBox(a.id)).slice(0, sessionSize);
}
async function countDueReviews(nodeIds) {
  const allowed = new Set(nodeIds);
  return Object.entries(getBoxState()).filter(([id, record]) => (!record.nodeId || allowed.has(record.nodeId)) && isDue(id)).length;
}

// math-build/modules/quiz-ui.js
function el2(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== void 0) node.textContent = text;
  return node;
}
var GUARDIAN_IMAGES2 = {
  "num-quantity": globalThis.mathAsset("assets/mythos/guardians/minotaur.webp"),
  algebra: globalThis.mathAsset("assets/mythos/guardians/sphinx.webp"),
  "space-shape": globalThis.mathAsset("assets/mythos/guardians/cyclops.webp"),
  "relation-pattern": globalThis.mathAsset("assets/mythos/guardians/moirai.webp"),
  "data-uncertainty": globalThis.mathAsset("assets/mythos/guardians/pythia.webp")
};
function guardianImageForStrand(strandId) {
  return GUARDIAN_IMAGES2[strandId] ?? null;
}
function streakMilestone(streak) {
  const value = Number(streak);
  return [3, 5, 8].includes(value) ? value : null;
}
function cardRevealClass(rarity) {
  return {
    "\u666E\u901A": "reveal-common",
    "\u7A00\u6709": "reveal-rare",
    "\u50B3\u8AAA": "reveal-legendary"
  }[rarity] ?? "reveal-common";
}
function masteryEncouragement(pct) {
  const value = Math.max(0, Math.min(100, Number(pct) || 0));
  if (value >= 100) return "\u9019\u500B\u6280\u80FD\u4F60\u5DF2\u7D93\u5F88\u719F\u4E86\uFF01";
  if (value >= 80) return "\u518D\u52A0\u628A\u52C1\u5C31\u6EFF\u5206\uFF01";
  if (value >= 50) return "\u5DF2\u7D93\u8D70\u904E\u4E00\u534A\uFF0C\u7E7C\u7E8C\u4FDD\u6301\uFF01";
  if (value > 0) return "\u6709\u958B\u59CB\u5C31\u5F88\u68D2\uFF0C\u518D\u7DF4\u5E7E\u984C\uFF01";
  return "\u5148\u5F9E\u7B2C\u4E00\u984C\u958B\u59CB\uFF0C\u6211\u5011\u6162\u6162\u4F86\uFF01";
}
function renderMedia(media, className) {
  if (!media?.src) return null;
  const figure = el2("figure", className);
  const img = document.createElement("img");
  img.src = media.src;
  img.alt = media.alt ?? "";
  img.loading = "lazy";
  img.decoding = "async";
  img.width = 1536;
  img.height = 1024;
  img.addEventListener("error", () => {
    figure.hidden = true;
  }, { once: true });
  figure.appendChild(img);
  return figure;
}
function enableNumberKeyAnswering(list) {
  const handler = (event) => {
    if (!list.isConnected) {
      document.removeEventListener("keydown", handler);
      return;
    }
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
    const idx = Number(event.key) - 1;
    if (!Number.isInteger(idx) || idx < 0) return;
    const btn = list.children[idx];
    if (!btn || btn.disabled) return;
    btn.click();
  };
  document.addEventListener("keydown", handler);
}
function renderChoiceList(container, options, onPick) {
  const list = el2("div", "q-options");
  options.forEach((opt, idx) => {
    const btn = el2("button", "q-option", opt);
    btn.setAttribute?.("aria-label", `\u9078\u9805${String.fromCharCode(65 + idx)}\uFF0C${opt}`);
    btn.addEventListener("click", () => onPick(idx, btn, list));
    list.appendChild(btn);
  });
  container.appendChild(list);
  enableNumberKeyAnswering(list);
}
function shuffleOptions(options, answerIdx) {
  const order = options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    options: order.map((i) => options[i]),
    answer: order.indexOf(answerIdx)
  };
}
function markResult(list, btn, isCorrect, correctBtn) {
  [...list.children].forEach((child) => child.disabled = true);
  btn.classList.add(isCorrect ? "q-correct" : "q-wrong");
  if (!isCorrect && correctBtn) correctBtn.classList.add("q-correct");
  const addMark = (button, mark, state) => {
    const index = [...list.children].indexOf(button);
    const text = button.textContent;
    const symbol = el2("span", "q-result-mark", mark);
    symbol.setAttribute?.("aria-hidden", "true");
    button.appendChild(symbol);
    button.setAttribute?.("aria-label", `\u9078\u9805${String.fromCharCode(65 + index)}\uFF0C${state}\uFF0C${text}`);
  };
  if (isCorrect) addMark(btn, "\u2713", "\u6B63\u89E3");
  else {
    addMark(btn, "\u2715", "\u4F5C\u7B54\u932F\u8AA4");
    if (correctBtn) addMark(correctBtn, "\u2713", "\u6B63\u89E3");
  }
}
function removeAfterAnimation(node, fallbackMs) {
  node.addEventListener("animationend", () => node.remove(), { once: true });
  setTimeout(() => node.remove(), fallbackMs);
}
var SHAVING_COLORS = ["var(--cp-red)", "var(--cp-green)", "var(--cp-blue)", "var(--cp-orange)", "var(--cp-yellow)"];
var CORRECT_BURST_PARTICLE_COUNT = 20;
function burstShavings(wrap, originEl, count = CORRECT_BURST_PARTICLE_COUNT) {
  const wrapRect = wrap.getBoundingClientRect();
  const rect = originEl?.getBoundingClientRect() ?? wrapRect;
  const ox = rect.left - wrapRect.left + rect.width / 2;
  const oy = rect.top - wrapRect.top + rect.height / 2;
  for (let i = 0; i < count; i++) {
    const p = el2("span", "pshaving", ["\u2726", "\u2727", "\u22C6", "\xB7"][i % 4]);
    const angle = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 70;
    p.style.left = `${ox}px`;
    p.style.top = `${oy}px`;
    p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    p.style.setProperty("--dy", `${Math.sin(angle) * dist - 30}px`);
    p.style.setProperty("--rot", `${(Math.random() - 0.5) * 540}deg`);
    p.style.setProperty("--sc", `${0.6 + Math.random() * 0.9}`);
    p.style.color = SHAVING_COLORS[i % SHAVING_COLORS.length];
    wrap.appendChild(p);
    removeAfterAnimation(p, 800);
  }
}
function flashCorrectScreenEdge() {
  if (!document.body?.appendChild) return;
  const flash = el2("span", "correct-edge-flash");
  flash.setAttribute?.("aria-hidden", "true");
  document.body.appendChild(flash);
  removeAfterAnimation(flash, 650);
}
function addMascotReaction(wrap, mascotVariant, isCorrect, guardianStrand) {
  const guardianImage = guardianImageForStrand(guardianStrand);
  if (!guardianImage && !mascotVariant) return;
  const box = el2("div", `q-mascot-react react-${isCorrect ? "happy" : "sad"}`);
  const img = document.createElement("img");
  img.src = guardianImage ?? globalThis.mathAsset(`assets/mascot/${mascotVariant}-${isCorrect ? "happy" : "sad"}.png`);
  img.alt = "\u795E\u6BBF\u5B88\u8B77\u8005\u53CD\u61C9";
  img.onerror = () => {
    box.style.display = "none";
  };
  box.appendChild(img);
  wrap.style.position = "relative";
  wrap.appendChild(box);
}
function renderQuestion(question, onAnswered, mascotVariant, opts = {}) {
  const wrap = el2("div", `q-card type-${question.type}`);
  if (opts.encounter) {
    wrap.classList.add("q-encounter");
    wrap.appendChild(el2("div", "encounter-banner", "\u2726 \u795E\u8AED\u555F\u793A\u964D\u81E8\uFF01\u7B54\u5C0D\u6709\u7279\u5225\u5370\u8A18 \u2726"));
  }
  const typeLabel = {
    "basic-mastery": "\u57FA\u672C\u7CBE\u901A\u984C",
    "concept-id": "\u6982\u5FF5\u8FA8\u8B58\u984C",
    "error-diagnosis": "\u932F\u8AA4\u8A3A\u65B7\u984C",
    "context-application": "\u60C5\u5883\u61C9\u7528\u984C"
  }[question.type];
  wrap.appendChild(el2("div", "q-type", typeLabel));
  const media = renderMedia(question.media, "q-media");
  if (media) wrap.appendChild(media);
  const explain = el2("div", "q-explain", question.explanation);
  explain.style.display = "none";
  if (typeof window !== "undefined" && "speechSynthesis" in window && question.explanation) {
    const speakBtn = el2("button", "q-speak-btn", "\u{1F50A} \u5538\u51FA\u4F86");
    speakBtn.type = "button";
    speakBtn.addEventListener("click", () => {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(question.explanation);
      utter.lang = "zh-TW";
      utter.rate = 0.95;
      window.speechSynthesis.speak(utter);
    });
    explain.appendChild(speakBtn);
    const enSpeak = el2("button", "q-speak-btn", "\u{1F50A} Read in English");
    enSpeak.type = "button";
    enSpeak.lang = "en";
    enSpeak.addEventListener("click", () => {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(globalThis.mathBilingual.translate(question.explanation) || "");
      utter.lang = "en-US";
      utter.rate = 0.95;
      window.speechSynthesis.speak(utter);
    });
    explain.appendChild(enSpeak);
  }
  const handleAnswered = (isCorrect, answerMeta) => {
    explain.style.display = "block";
    addMascotReaction(wrap, mascotVariant, isCorrect, opts.guardianStrand);
    if (isCorrect) {
      burstShavings(wrap, wrap.querySelector(".q-option.q-correct"));
      flashCorrectScreenEdge();
    }
    if (opts.encounter) {
      if (isCorrect) {
        wrap.appendChild(el2("div", "encounter-stamp", "\u2726 \u661F\u5149\u5370\u8A18"));
        for (let i = 0; i < 8; i++) {
          const spark = el2("span", "spark", "\u2726");
          spark.style.animationDelay = `${i * 0.08}s`;
          spark.style.right = `${20 + Math.random() * 120}px`;
          spark.style.bottom = `${20 + Math.random() * 60}px`;
          spark.style.setProperty("--spark-dx", `${(Math.random() - 0.5) * 60}px`);
          spark.style.fontSize = `${0.8 + Math.random() * 0.8}rem`;
          wrap.appendChild(spark);
          removeAfterAnimation(spark, 1400);
        }
      } else {
        wrap.querySelector(".encounter-banner")?.classList.add("banner-fade");
      }
    }
    onAnswered(isCorrect, { encounter: !!opts.encounter, ...answerMeta });
  };
  if (question.type === "basic-mastery") {
    wrap.appendChild(el2("div", "q-stem", question.stem));
    const view = shuffleOptions(question.options, question.answer);
    renderChoiceList(wrap, view.options, (idx, btn, list) => {
      const isCorrect = idx === view.answer;
      markResult(list, btn, isCorrect, list.children[view.answer]);
      handleAnswered(isCorrect, {
        correctLabel: String.fromCharCode(65 + view.answer),
        correctText: view.options[view.answer]
      });
    });
  }
  if (question.type === "concept-id") {
    wrap.appendChild(el2("div", "q-stem", question.statement));
    renderChoiceList(wrap, ["\u6B63\u78BA", "\u932F\u8AA4"], (idx, btn, list) => {
      const pickedTrue = idx === 0;
      const isCorrect = pickedTrue === question.correctAnswer;
      const correctIdx = question.correctAnswer ? 0 : 1;
      markResult(list, btn, isCorrect, list.children[correctIdx]);
      handleAnswered(isCorrect, {
        correctLabel: String.fromCharCode(65 + correctIdx),
        correctText: correctIdx === 0 ? "\u6B63\u78BA" : "\u932F\u8AA4"
      });
    });
  }
  if (question.type === "error-diagnosis") {
    wrap.appendChild(el2("div", "q-stem", question.problem));
    wrap.appendChild(el2("div", "q-wrong-solution", question.wrongSolution));
    const view = shuffleOptions(question.errorOptions, question.correctErrorIndex);
    renderChoiceList(wrap, view.options, (idx, btn, list) => {
      const isCorrect = idx === view.answer;
      markResult(list, btn, isCorrect, list.children[view.answer]);
      handleAnswered(isCorrect, {
        correctLabel: String.fromCharCode(65 + view.answer),
        correctText: view.options[view.answer]
      });
    });
  }
  if (question.type === "context-application") {
    wrap.appendChild(el2("div", "q-scenario", question.scenario));
    wrap.appendChild(el2("div", "q-stem", question.question));
    const view = shuffleOptions(question.options, question.answer);
    renderChoiceList(wrap, view.options, (idx, btn, list) => {
      const isCorrect = idx === view.answer;
      markResult(list, btn, isCorrect, list.children[view.answer]);
      handleAnswered(isCorrect, {
        correctLabel: String.fromCharCode(65 + view.answer),
        correctText: view.options[view.answer]
      });
    });
  }
  wrap.appendChild(explain);
  return wrap;
}

// math-build/modules/scoreEngine.js
function recordAnswer(nodeId, questionOrId, correct, msElapsed, node = {}) {
  const progress = store.read("progress", {});
  const entry = progress[nodeId] ?? { attempts: [], masteryPct: 0 };
  entry.totalAttempts = Number.isFinite(entry.totalAttempts) ? entry.totalAttempts : entry.attempts.length;
  entry.correctAttempts = Number.isFinite(entry.correctAttempts) ? entry.correctAttempts : entry.attempts.filter((savedAttempt) => savedAttempt.correct).length;
  entry.questionStats = entry.questionStats ?? {};
  const question = typeof questionOrId === "string" ? { id: questionOrId } : questionOrId;
  const attempt = {
    questionId: question.id,
    ...question.challenge ? { challenge: question.challenge } : {},
    ...question.type ? { type: question.type } : {},
    ...question.errorPath !== void 0 ? { errorPath: question.errorPath } : {},
    ...question._prereqQuickCheck ? { prereqQuickCheck: true } : {},
    // 導師安撫題（連錯後插入的簡單題）與慢筆重描題（看過正解＋解析後重答同題）都不是
    // 乾淨的能力證據，打標後排除於精熟窗口，避免灌水答對率、假性完卷（仍照常記錯題本／Leitner）。
    ...question._mentorCoaching ? { coachingAttempt: true } : {},
    ...question._retry ? { retryAttempt: true } : {},
    ...question._prereqNodeId ? { prereqNodeId: question._prereqNodeId } : {},
    ...question._remediationPath !== void 0 ? { remediationPath: question._remediationPath } : {},
    correct,
    msElapsed,
    at: Date.now()
  };
  entry.attempts.push(attempt);
  entry.totalAttempts += 1;
  if (correct) entry.correctAttempts += 1;
  const questionStats = entry.questionStats[question.id] ?? { totalAttempts: 0, correctAttempts: 0 };
  questionStats.totalAttempts += 1;
  if (correct) questionStats.correctAttempts += 1;
  entry.questionStats[question.id] = questionStats;
  entry.attempts = entry.attempts.slice(-50);
  const challengeIds = question._challengeIds ?? entry.challengeIds ?? node.challengeIds;
  if (Array.isArray(challengeIds) && challengeIds.length > 0) {
    entry.challengeIds = [...new Set(challengeIds)];
  }
  const evaluationNode = entry.challengeIds ? { ...node, challengeIds: entry.challengeIds } : node;
  const result = evaluateMastery(entry.attempts, evaluationNode, void 0, entry.mastered === true);
  Object.assign(entry, result, { masteryVersion: 2 });
  progress[nodeId] = entry;
  store.write("progress", progress);
  return entry.masteryPct;
}
function getNodeStats(nodeId) {
  const progress = store.read("progress", {});
  const entry = progress[nodeId] ?? { attempts: [], masteryPct: 0 };
  return {
    masteryPct: entry.masteryPct,
    mastered: entry.mastered === true,
    stars: entry.stars ?? 0,
    conditions: entry.conditions ?? null,
    criteriaProgress: entry.criteriaProgress ?? null,
    unmetConditions: entry.unmetConditions ?? [],
    remainingPracticeCount: entry.remainingPracticeCount ?? Math.max(0, 12 - (entry.totalAttempts ?? entry.attempts.length)),
    missingChallenges: entry.missingChallenges ?? [],
    feedback: entry.feedback ?? "",
    errorLocks: entry.errorLocks ?? [],
    totalAttempts: entry.totalAttempts ?? entry.attempts.length,
    correctAttempts: entry.correctAttempts ?? entry.attempts.filter((a) => a.correct).length
  };
}
function overallMasteryPct(nodeIds) {
  if (nodeIds.length === 0) return 0;
  const progress = store.read("progress", {});
  const sum = nodeIds.reduce((acc, id) => acc + (progress[id]?.masteryPct ?? 0), 0);
  return Math.round(sum / nodeIds.length * 100) / 100;
}

// math-build/modules/errorbook.js
function addWrongQuestion(nodeId, question) {
  const book = store.read("errorbook", {});
  book[question.id] = { nodeId, question, missedAt: Date.now() };
  store.write("errorbook", book);
}
function removeWrongQuestion(questionId) {
  const book = store.read("errorbook", {});
  delete book[questionId];
  store.write("errorbook", book);
}
function listWrongQuestions() {
  const book = store.read("errorbook", {});
  return Object.values(book).sort((a, b) => b.missedAt - a.missedAt);
}

// math-build/modules/achievements.js
var towerRestored = (ctx2, roomId) => ctx2.rooms?.some((room) => room.id === roomId && room.repairPct >= 100) ?? false;
var BADGES = [
  { id: "first-mastery", name: "\u521D\u8A66\u557C\u8072", desc: "\u7B2C\u4E00\u500B\u5B78\u7FD2\u9EDE\u9054\u5230\u7CBE\u901A", check: (ctx2) => ctx2.masteredCount >= 1 },
  { id: "three-mastery", name: "\u5C0F\u6709\u5FC3\u5F97", desc: "\u7CBE\u901A 3 \u500B\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= 3 },
  { id: "ten-mastery", name: "\u767B\u5802\u5165\u5BA4", desc: "\u7CBE\u901A 10 \u500B\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= 10 },
  { id: "fifteen-mastery", name: "\u661F\u8DEF\u884C\u8005", desc: "\u7CBE\u901A 15 \u500B\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= 15 },
  { id: "twenty-mastery", name: "\u795E\u6BBF\u65C5\u4EBA", desc: "\u7CBE\u901A 20 \u500B\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= 20 },
  { id: "twenty-five-mastery", name: "\u795E\u8AED\u5377\u8EF8\u5B78\u58EB", desc: "\u7CBE\u901A 25 \u500B\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= 25 },
  { id: "thirty-mastery", name: "\u534A\u7A0B\u5B78\u8005", desc: "\u7CBE\u901A 30 \u500B\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= 30 },
  { id: "thirty-five-mastery", name: "\u4E94\u6BBF\u8DE1\u8E64\u8005", desc: "\u7CBE\u901A 35 \u500B\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= 35 },
  { id: "forty-mastery", name: "\u661F\u5716\u5DE1\u79AE\u8005", desc: "\u7CBE\u901A 40 \u500B\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= 40 },
  { id: "forty-five-mastery", name: "\u661F\u5716\u63A2\u7D22\u8005", desc: "\u7CBE\u901A 45 \u500B\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= 45 },
  { id: "fifty-mastery", name: "\u4E94\u5341\u5377\u5B78\u8005", desc: "\u7CBE\u901A 50 \u500B\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= 50 },
  { id: "fifty-five-mastery", name: "\u795E\u6BBF\u904A\u5B78\u8005", desc: "\u7CBE\u901A 55 \u500B\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= 55 },
  { id: "sixty-mastery", name: "\u795E\u6BBF\u7814\u4FEE\u8005", desc: "\u7CBE\u901A 60 \u500B\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= 60 },
  { id: "sixty-five-mastery", name: "\u795E\u8AED\u5C0E\u8B80\u8005", desc: "\u7CBE\u901A 65 \u500B\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= 65 },
  { id: "seventy-mastery", name: "\u5967\u6797\u5E15\u65AF\u535A\u5B78\u8005", desc: "\u7CBE\u901A 70 \u500B\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= 70 },
  { id: "seventy-five-mastery", name: "\u795E\u8AED\u85CF\u66F8\u5BB6", desc: "\u7CBE\u901A 75 \u500B\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= 75 },
  { id: "eighty-mastery", name: "\u516B\u5341\u5377\u8CE2\u8005", desc: "\u7CBE\u901A 80 \u500B\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= 80 },
  { id: "all-mastery", name: "\u878D\u6703\u8CAB\u901A", desc: "\u7CBE\u901A\u5168\u90E8\u5DF2\u4E0A\u7DDA\u5B78\u7FD2\u9EDE", check: (ctx2) => ctx2.masteredCount >= ctx2.totalNodes },
  { id: "perfect-round", name: "\u5168\u5C0D\u6311\u6230", desc: "\u55AE\u6B21\u4F5C\u7B54 5 \u984C\u5168\u5C0D", check: (ctx2) => ctx2.lastRoundAllCorrect },
  { id: "streak-3", name: "\u9023\u8A60\u4E09\u984C", desc: "\u9023\u7E8C\u7B54\u5C0D 3 \u984C", check: (ctx2) => ctx2.currentStreak >= 3 },
  { id: "streak-10", name: "\u5341\u9023\u4E0D\u589C", desc: "\u9023\u7E8C\u7B54\u5C0D 10 \u984C", check: (ctx2) => ctx2.currentStreak >= 10 },
  { id: "master-trial", name: "\u8CE2\u8005\u771F\u50B3", desc: "\u8CE2\u8005\u8A66\u7149\u6B63\u78BA\u7387\u9054\u4E5D\u6210", check: (ctx2) => ctx2.masterTrialPassed },
  { id: "encounter-5", name: "\u555F\u793A\u884C\u8005", desc: "\u7B54\u5C0D 5 \u6B21\u795E\u8AED\u555F\u793A", check: (ctx2) => ctx2.encounterWins >= 5 },
  { id: "encounter-15", name: "\u795E\u8AED\u667A\u8005", desc: "\u7B54\u5C0D 15 \u6B21\u795E\u8AED\u555F\u793A", check: (ctx2) => ctx2.encounterWins >= 15 },
  { id: "num-tower-restored", name: "\u8FF7\u5BAE\u5730\u5E95\u57CE\u30FB\u7526\u9192", desc: "\u8B93\u7C73\u8AFE\u9676\u6D1B\u65AF\u5B88\u8B77\u7684\u8FF7\u5BAE\u5730\u5E95\u57CE\u7526\u9192", check: (ctx2) => towerRestored(ctx2, "num-quantity") },
  { id: "algebra-tower-restored", name: "\u65AF\u82AC\u514B\u65AF\u795E\u6BBF\u30FB\u7526\u9192", desc: "\u8B93\u65AF\u82AC\u514B\u65AF\u5B88\u8B77\u7684\u795E\u6BBF\u7526\u9192", check: (ctx2) => towerRestored(ctx2, "algebra") },
  { id: "space-tower-restored", name: "\u7368\u773C\u5DE8\u4EBA\u935B\u9020\u574A\u30FB\u7526\u9192", desc: "\u8B93\u7368\u773C\u5DE8\u4EBA\u5B88\u8B77\u7684\u935B\u9020\u574A\u7526\u9192", check: (ctx2) => towerRestored(ctx2, "space-shape") },
  { id: "relation-tower-restored", name: "\u547D\u904B\u4E09\u5973\u795E\u7D21\u7E54\u6BBF\u30FB\u7526\u9192", desc: "\u8B93\u547D\u904B\u4E09\u5973\u795E\u5B88\u8B77\u7684\u7D21\u7E54\u6BBF\u7526\u9192", check: (ctx2) => towerRestored(ctx2, "relation-pattern") },
  { id: "data-tower-restored", name: "\u5FB7\u723E\u83F2\u795E\u8AED\u6BBF\u30FB\u7526\u9192", desc: "\u8B93\u76AE\u5A9E\u4E9E\u8207\u5DE8\u87D2\u5B88\u8B77\u7684\u795E\u8AED\u6BBF\u7526\u9192", check: (ctx2) => towerRestored(ctx2, "data-uncertainty") },
  { id: "workshop-friend", name: "\u5967\u6797\u5E15\u65AF\u4E4B\u5149", desc: "\u8B93\u4E94\u5EA7\u795E\u6BBF\u5168\u6578\u7526\u9192", check: (ctx2) => ctx2.workshopRestored },
  { id: "sparring", name: "\u5207\u78CB\u7AE0", desc: "\u5B8C\u6210\u540C\u5B78\u7684\u6311\u6230\u5305\u6216\u6536\u5230\u56DE\u64CA\u795E\u8AED", check: (ctx2) => ctx2.sparring }
];
function getUnlockedBadges() {
  return store.read("badges", []);
}
function evaluateBadges(ctx2) {
  const unlocked = new Set(getUnlockedBadges());
  const newlyUnlocked = [];
  for (const badge of BADGES) {
    if (!unlocked.has(badge.id) && badge.check(ctx2)) {
      unlocked.add(badge.id);
      newlyUnlocked.push(badge);
    }
  }
  store.write("badges", [...unlocked]);
  return newlyUnlocked;
}
function unlockBadge(id) {
  if (!BADGES.some((badge) => badge.id === id)) return false;
  const unlocked = new Set(getUnlockedBadges());
  if (unlocked.has(id)) return false;
  unlocked.add(id);
  store.write("badges", [...unlocked]);
  return true;
}

// math-build/modules/leaderboard.js
function getPlayerName() {
  return store.read("player", null);
}
function setPlayerName(name) {
  store.write("player", name);
}
function getPlayerId() {
  let id = store.read("playerId", null);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    store.write("playerId", id);
  }
  return id;
}
function getDeviceToken() {
  return store.read("deviceAuthToken", "") || "";
}
function syncDeviceToken(resp) {
  if (resp && typeof resp.authToken === "string" && resp.authToken && resp.authToken !== getDeviceToken()) {
    store.write("deviceAuthToken", resp.authToken);
  }
  return resp;
}
function submitScore(name, overallMasteryPct2) {
  const board = store.read("leaderboard", []);
  const id = getPlayerId();
  const existing = board.find((row) => row.id === id);
  if (existing) {
    existing.name = name;
    existing.masteryPct = Math.max(existing.masteryPct, overallMasteryPct2);
    existing.updatedAt = Date.now();
  } else {
    board.push({ id, name, masteryPct: overallMasteryPct2, updatedAt: Date.now() });
  }
  board.sort((a, b) => b.masteryPct - a.masteryPct);
  store.write("leaderboard", board);
  return board;
}
function getLeaderboard() {
  return store.read("leaderboard", []);
}

// math-build/modules/daily.js
function todayKey() {
  const d = /* @__PURE__ */ new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function getDaily() {
  return store.read(`daily:${todayKey()}`, { review: 0, rounds: 0, repair: 0, inked: false });
}
function saveDaily(daily) {
  store.write(`daily:${todayKey()}`, daily);
}
function bumpDaily(field, amount = 1) {
  const daily = getDaily();
  daily[field] = (daily[field] ?? 0) + amount;
  saveDaily(daily);
  return daily;
}
function dailyTasks(daily, { dueCount = 0, errorCount = 0 } = {}) {
  return [
    {
      id: "review",
      label: "\u6CE8\u5149\uFF1A\u8907\u7FD2\u5230\u671F\u795E\u8AED\u5377\u8EF8",
      target: 6,
      done: daily.review,
      satisfied: daily.review >= 6 || dueCount === 0
      // 到期題清空也算完成
    },
    {
      id: "rounds",
      label: "\u63A8\u9032\uFF1A\u5B8C\u6210\u4E00\u8F2A\u7DF4\u7FD2",
      target: 1,
      done: daily.rounds,
      satisfied: daily.rounds >= 1
    },
    {
      id: "repair",
      label: "\u6DE8\u5316\uFF1A\u6536\u670D\u932F\u984C\u5C0F\u9B54\u7269",
      target: 2,
      done: daily.repair,
      satisfied: daily.repair >= 2 || errorCount === 0
    }
  ];
}
function maybeDropInk(tasks) {
  if (!tasks.every((t) => t.satisfied)) return false;
  const daily = getDaily();
  if (daily.inked) return false;
  daily.inked = true;
  saveDaily(daily);
  const days = store.read("inkDays", []);
  if (!days.includes(todayKey())) {
    days.push(todayKey());
    store.write("inkDays", days);
  }
  return true;
}
function getInkDays() {
  return store.read("inkDays", []);
}
function addStardust(amount = 1) {
  const gained = Math.max(0, Math.floor(Number(amount) || 0));
  if (gained === 0) return getStardustCount();
  const bonus = Math.max(0, Number(store.read("stardustBonus", 0)) || 0) + gained;
  store.write("stardustBonus", bonus);
  return getInkDays().length + bonus;
}
function getStardustCount() {
  return getInkDays().length + Math.max(0, Number(store.read("stardustBonus", 0)) || 0);
}
function returningWelcome(lastPlayed, dueCount, now = Date.now()) {
  const daysAway = lastPlayed?.at ? Math.max(0, Math.floor((now - Number(lastPlayed.at)) / 864e5)) : 0;
  const displayDueCount = daysAway >= 2 ? Math.min(Math.max(0, dueCount), 6) : Math.max(0, dueCount);
  return {
    daysAway,
    displayDueCount,
    headline: daysAway >= 2 ? `\u5C0E\u5E2B\u628A\u795E\u8AED\u5377\u8EF8\u90FD\u6536\u597D\u4E86\uFF0C\u4ECA\u5929\u5148\u9EDE\u4EAE ${displayDueCount} \u9801\u5C31\u597D` : dueCount > 0 ? `\u4ECA\u65E5\u559A\u9192\u55AE\u2014\u2014\u6709 ${dueCount} \u9801\u795E\u8AED\u5377\u8EF8\u7684\u661F\u5149\u7B49\u4F60\u9EDE\u4EAE` : "\u4ECA\u65E5\u559A\u9192\u55AE"
  };
}
function claimStardustMilestones(total = getStardustCount()) {
  const saved = store.read("stardustMilestones", {});
  const newlyUnlocked = [];
  [30, 100].forEach((milestone) => {
    if (total >= milestone && saved[milestone] !== true) {
      saved[milestone] = true;
      newlyUnlocked.push(milestone);
    }
  });
  if (newlyUnlocked.length > 0) store.write("stardustMilestones", saved);
  return {
    newlyUnlocked,
    unlocked: [30, 100].filter((milestone) => saved[milestone] === true)
  };
}

// math-build/modules/collection.js
var MANUSCRIPTS = [
  { id: "fraction-unlike-denom", sym: "\xBD\uFF0B\u2153", name: "\u901A\u5206\u4E4B\u6A4B\u795E\u8AED\u5377\u8EF8", hint: "\u5B8C\u6210\u300C\u7570\u5206\u6BCD\u5206\u6578\u300D\u4E00\u8F2A\u4F5C\u7B54\u5373\u5165\u5EAB", desc: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\uFF1A\u5206\u6BCD\u4E0D\u540C\u7684\u5169\u5EA7\u6A4B\uFF0C\u5F97\u5148\u67B6\u5230\u540C\u4E00\u500B\u9AD8\u5EA6\u3002" },
  { id: "fraction-mul", sym: "\xBE\xD7\u2154", name: "\u5207\u5272\u4E7E\u916A\u795E\u8AED\u5377\u8EF8", hint: "\u5B8C\u6210\u300C\u5206\u6578\u4E58\u9664\u300D\u4E00\u8F2A\u4F5C\u7B54\u5373\u5165\u5EAB", desc: "\u628A\u4E00\u584A\u4E7E\u916A\u7684\u56DB\u5206\u4E4B\u4E09\u518D\u5207\u4E09\u4EFD\u2014\u2014\u9019\u5C31\u662F\u5206\u6578\u76F8\u4E58\u3002" },
  { id: "decimal-mul", sym: "0.5", name: "\u5C0F\u6578\u9EDE\u7F85\u76E4\u795E\u8AED\u5377\u8EF8", hint: "\u5B8C\u6210\u300C\u5C0F\u6578\u4E58\u9664\u300D\u4E00\u8F2A\u4F5C\u7B54\u5373\u5165\u5EAB", desc: "\u5C0F\u6578\u9EDE\u662F\u7F85\u76E4\u91DD\uFF0C\u4E58\u9664\u6642\u5B83\u5F80\u54EA\u504F\uFF0C\u5168\u770B\u4F4D\u6578\u3002" },
  { id: "ratio-rate", sym: "a\u2236b", name: "\u9EC3\u91D1\u6BD4\u4F8B\u795E\u8AED\u5377\u8EF8", hint: "\u5B8C\u6210\u300C\u6BD4\u8207\u6BD4\u503C\u300D\u4E00\u8F2A\u4F5C\u7B54\u5373\u5165\u5EAB", desc: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\uFF1A\u5148\u91CF\u6BD4\u4F8B\u2014\u2014\u6BD4\u662F\u842C\u7269\u7684\u9AA8\u67B6\u3002" },
  { id: "negative-number", sym: "\u22123", name: "\u96F6\u5EA6\u4EE5\u4E0B\u795E\u8AED\u5377\u8EF8", hint: "\u5B8C\u6210\u300C\u8CA0\u6578\u300D\u4E00\u8F2A\u4F5C\u7B54\u5373\u5165\u5EAB", desc: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u6279\u8A3B\uFF1A\u6578\u7DDA\u5F80\u5DE6\u8D70\uFF0C\u4E16\u754C\u4E26\u6C92\u6709\u7D50\u675F\u3002" },
  { id: "proportion-eq", sym: "a\u2236b\uFF1Dc\u2236d", name: "\u7B49\u6BD4\u5929\u5E73\u795E\u8AED\u5377\u8EF8", hint: "\u5B8C\u6210\u300C\u6BD4\u4F8B\u5F0F\u300D\u4E00\u8F2A\u4F5C\u7B54\u5373\u5165\u5EAB", desc: "\u5167\u9805\u76F8\u4E58\u7B49\u65BC\u5916\u9805\u76F8\u4E58\u2014\u2014\u5929\u5E73\u5169\u7AEF\u5C31\u6B64\u5E73\u8861\u3002" },
  { id: "algebra-symbol", sym: "\u{1D465}", name: "\u672A\u77E5\u6578\u9762\u5177\u795E\u8AED\u5377\u8EF8", hint: "\u5B8C\u6210\u300C\u4EE3\u6578\u7B26\u865F\u300D\u4E00\u8F2A\u4F5C\u7B54\u5373\u5165\u5EAB", desc: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\uFF1A\u7D66\u672A\u77E5\u7684\u6771\u897F\u6234\u4E0A\u7B26\u865F\uFF0C\u5C31\u80FD\u958B\u59CB\u63A8\u7406\u3002" },
  { id: "linear-eq-1var", sym: "\u{1D465}\uFF1D?", name: "\u89E3\u65B9\u7A0B\u91D1\u9470\u795E\u8AED\u5377\u8EF8", hint: "\u5B8C\u6210\u300C\u4E00\u5143\u4E00\u6B21\u65B9\u7A0B\u5F0F\u300D\u4E00\u8F2A\u4F5C\u7B54\u5373\u5165\u5EAB", desc: "\u79FB\u9805\u662F\u9470\u5319\u8F49\u52D5\u7684\u8072\u97F3\uFF0C\u7B49\u865F\u5169\u908A\u540C\u6642\u958B\u9396\u3002" },
  { id: "master-trial", sym: "\u221E", name: "\u96C5\u5178\u5A1C\u806F\u540D\u795E\u8AED\u5377\u8EF8", hint: "\u8CE2\u8005\u8A66\u7149\u6B63\u78BA\u7387\u9054\u4E5D\u6210\uFF0C\u76F4\u63A5\u881F\u5C01", desc: "\u7531\u667A\u6167\u5F15\u8DEF\u4EBA\u57F7\u7B46\u3001\u9A57\u7B97\u2014\u2014\u5967\u6797\u5E15\u65AF\u6578\u8853\u795E\u6BBF\u6700\u73CD\u8CB4\u7684\u4E00\u5377\u3002" }
];
var STAMP_RARITIES = {
  "\u666E\u901A": { dropRate: 0.12, pity: 5 },
  "\u7A00\u6709": { dropRate: 0.05, pity: 15 },
  "\u50B3\u8AAA": { dropRate: 0.02, pity: 30 }
};
var RARITY_MYTHOS = {
  "\u666E\u901A": "\u534A\u4EBA\u99AC\uFF0F\u7F8A\u7537",
  "\u7A00\u6709": "\u7F8E\u675C\u838E\uFF0F\u5947\u7F8E\u62C9",
  "\u50B3\u8AAA": "\u6CF0\u5766\u5DE8\u4EBA"
};
var RARE_STAMPS = [
  { id: "stamp-fraction-unlike-denom", sym: "\xBD", name: "\u901A\u5206\u4E4B\u6A4B\u5370\u8A18", hint: "\u7570\u5206\u6BCD\u5206\u6578\u795E\u8AED\u555F\u793A", rarity: "\u666E\u901A", mentor: "\u51E1\u5947", workshop: true },
  { id: "stamp-fraction-mul", sym: "\xBE", name: "\u5207\u5272\u4E7E\u916A\u5370\u8A18", hint: "\u5206\u6578\u4E58\u9664\u795E\u8AED\u555F\u793A", rarity: "\u666E\u901A", mentor: "\u51E1\u5947", workshop: true },
  { id: "stamp-decimal-mul", sym: "\u2022", name: "\u5C0F\u6578\u7F85\u76E4\u5370\u8A18", hint: "\u5C0F\u6578\u4E58\u9664\u795E\u8AED\u555F\u793A", rarity: "\u666E\u901A", mentor: "\u51E1\u5947", workshop: true },
  { id: "stamp-ratio-rate", sym: "\u2236", name: "\u9EC3\u91D1\u6BD4\u4F8B\u5370\u8A18", hint: "\u6BD4\u8207\u6BD4\u503C\u795E\u8AED\u555F\u793A", rarity: "\u7A00\u6709", mentor: "\u51E1\u5947", workshop: true },
  { id: "davinci-manuscript", sym: "\u{1FAB6}", name: "\u8FF7\u5BAE\u725B\u89D2\u5370\u8A18", hint: "\u8FF7\u5BAE\u5730\u5E95\u57CE\u795E\u8AED\u555F\u793A", rarity: "\u7A00\u6709", mentor: "\u51E1\u5947" },
  { id: "num-tower-legend", sym: "\u2696", name: "\u6CF0\u5766\u5FC3\u8861\u5370\u8A18", hint: "\u8FF7\u5BAE\u5730\u5E95\u57CE\u50B3\u8AAA\u555F\u793A", rarity: "\u50B3\u8AAA", mentor: "\u51E1\u5947" },
  { id: "stamp-negative-number", sym: "\u2212", name: "\u96F6\u4E0B\u5BD2\u51B0\u5370\u8A18", hint: "\u8CA0\u6578\u795E\u8AED\u555F\u793A", rarity: "\u666E\u901A", mentor: "\u683C\u601D", workshop: true },
  { id: "stamp-algebra-symbol", sym: "\u{1D465}", name: "\u672A\u77E5\u6578\u9762\u5177\u5370\u8A18", hint: "\u4EE3\u6578\u7B26\u865F\u795E\u8AED\u555F\u793A", rarity: "\u666E\u901A", mentor: "\u683C\u601D", workshop: true },
  { id: "stamp-linear-eq-1var", sym: "\u{1F5DD}", name: "\u89E3\u65B9\u7A0B\u91D1\u9470\u5370\u8A18", hint: "\u4E00\u5143\u4E00\u6B21\u65B9\u7A0B\u5F0F\u795E\u8AED\u555F\u793A", rarity: "\u666E\u901A", mentor: "\u683C\u601D", workshop: true },
  { id: "stamp-proportion-eq", sym: "\u2696", name: "\u7B49\u6BD4\u5929\u5E73\u5370\u8A18", hint: "\u6BD4\u4F8B\u5F0F\u795E\u8AED\u555F\u793A", rarity: "\u7A00\u6709", mentor: "\u683C\u601D", workshop: true },
  { id: "gauss-signature", sym: "\u03A3", name: "\u65AF\u82AC\u514B\u65AF\u8B0E\u7D0B\u5370\u8A18", hint: "\u65AF\u82AC\u514B\u65AF\u795E\u6BBF\u795E\u8AED\u555F\u793A", rarity: "\u7A00\u6709", mentor: "\u683C\u601D" },
  { id: "algebra-tower-legend", sym: "\u2726", name: "\u6CF0\u5766\u771F\u540D\u5370\u8A18", hint: "\u65AF\u82AC\u514B\u65AF\u795E\u6BBF\u50B3\u8AAA\u555F\u793A", rarity: "\u50B3\u8AAA", mentor: "\u683C\u601D" },
  { id: "stamp-angle-degree", sym: "\u2220", name: "\u91CF\u89D2\u661F\u5149\u5370\u8A18", hint: "\u91CF\u89D2\u5668\u8207\u5EA6\u795E\u8AED\u555F\u793A", rarity: "\u666E\u901A", mentor: "\u5E7E\u5FB7" },
  { id: "stamp-circle-parts", sym: "\u25C9", name: "\u5713\u5FC3\u5149\u8F2A\u5370\u8A18", hint: "\u5713\u7684\u8A8D\u8B58\u795E\u8AED\u555F\u793A", rarity: "\u666E\u901A", mentor: "\u5E7E\u5FB7" },
  { id: "stamp-plane-area-formula", sym: "\u25B1", name: "\u9762\u7A4D\u62FC\u5716\u5370\u8A18", hint: "\u5E73\u9762\u9762\u7A4D\u516C\u5F0F\u795E\u8AED\u555F\u793A", rarity: "\u666E\u901A", mentor: "\u5E7E\u5FB7" },
  { id: "stamp-perp-parallel", sym: "\u22A5", name: "\u5782\u5E73\u96D9\u5149\u5370\u8A18", hint: "\u5782\u76F4\u8207\u5E73\u884C\u795E\u8AED\u555F\u793A", rarity: "\u7A00\u6709", mentor: "\u5E7E\u5FB7" },
  { id: "stamp-solids-nets", sym: "\u2B21", name: "\u5C55\u958B\u5716\u6C34\u6676\u5370\u8A18", hint: "\u7ACB\u9AD4\u5C55\u958B\u5716\u795E\u8AED\u555F\u793A", rarity: "\u7A00\u6709", mentor: "\u5E7E\u5FB7" },
  { id: "space-tower-legend", sym: "\u25C7", name: "\u6CF0\u5766\u935B\u9020\u516C\u7406\u5370\u8A18", hint: "\u7368\u773C\u5DE8\u4EBA\u935B\u9020\u574A\u50B3\u8AAA\u555F\u793A", rarity: "\u50B3\u8AAA", mentor: "\u5E7E\u5FB7" },
  { id: "stamp-repeat-pattern", sym: "\u21BB", name: "\u91CD\u8907\u85E4\u7BC0\u5370\u8A18", hint: "\u91CD\u8907\u898F\u5F8B\u795E\u8AED\u555F\u793A", rarity: "\u666E\u901A", mentor: "\u6590\u863F" },
  { id: "stamp-growing-pattern", sym: "\u2197", name: "\u905E\u589E\u661F\u85E4\u5370\u8A18", hint: "\u905E\u589E\u898F\u5F8B\u795E\u8AED\u555F\u793A", rarity: "\u666E\u901A", mentor: "\u6590\u863F" },
  { id: "stamp-input-output-table", sym: "\u21A6", name: "\u8F38\u5165\u8F38\u51FA\u8449\u5370\u8A18", hint: "\u8F38\u5165\u8F38\u51FA\u8868\u795E\u8AED\u555F\u793A", rarity: "\u666E\u901A", mentor: "\u6590\u863F" },
  { id: "stamp-pattern-rule", sym: "n", name: "\u7B2C n \u9805\u85E4\u7D0B\u5370\u8A18", hint: "\u898F\u5F8B\u901A\u5247\u795E\u8AED\u555F\u793A", rarity: "\u7A00\u6709", mentor: "\u6590\u863F" },
  { id: "stamp-function-relation", sym: "f", name: "\u51FD\u6578\u85E4\u5FC3\u5370\u8A18", hint: "\u51FD\u6578\u95DC\u4FC2\u795E\u8AED\u555F\u793A", rarity: "\u7A00\u6709", mentor: "\u6590\u863F" },
  { id: "relation-tower-legend", sym: "\u{1F33F}", name: "\u6CF0\u5766\u547D\u7DDA\u5370\u8A18", hint: "\u547D\u904B\u4E09\u5973\u795E\u7D21\u7E54\u6BBF\u50B3\u8AAA\u555F\u793A", rarity: "\u50B3\u8AAA", mentor: "\u6590\u863F" },
  { id: "stamp-bar-chart-reading", sym: "\u2586", name: "\u9577\u689D\u661F\u8C61\u5370\u8A18", hint: "\u9577\u689D\u5716\u795E\u8AED\u555F\u793A", rarity: "\u666E\u901A", mentor: "\u5E15\u5D50" },
  { id: "stamp-line-chart-reading", sym: "\u2301", name: "\u6298\u7DDA\u661F\u8DE1\u5370\u8A18", hint: "\u6298\u7DDA\u5716\u795E\u8AED\u555F\u793A", rarity: "\u666E\u901A", mentor: "\u5E15\u5D50" },
  { id: "stamp-mean-basic", sym: "x\u0304", name: "\u5E73\u5747\u661F\u79E4\u5370\u8A18", hint: "\u5E73\u5747\u6578\u795E\u8AED\u555F\u793A", rarity: "\u666E\u901A", mentor: "\u5E15\u5D50" },
  { id: "stamp-probability-basic", sym: "P", name: "\u6A5F\u7387\u661F\u9AB0\u5370\u8A18", hint: "\u57FA\u790E\u6A5F\u7387\u795E\u8AED\u555F\u793A", rarity: "\u7A00\u6709", mentor: "\u5E15\u5D50" },
  { id: "stamp-chance-sample-space", sym: "\u03A9", name: "\u6A23\u672C\u7A7A\u9593\u5370\u8A18", hint: "\u6A23\u672C\u7A7A\u9593\u795E\u8AED\u555F\u793A", rarity: "\u7A00\u6709", mentor: "\u5E15\u5D50" },
  { id: "data-tower-legend", sym: "\u2727", name: "\u6CF0\u5766\u795E\u8AED\u5168\u89BD\u5370\u8A18", hint: "\u5FB7\u723E\u83F2\u795E\u8AED\u6BBF\u50B3\u8AAA\u555F\u793A", rarity: "\u50B3\u8AAA", mentor: "\u5E15\u5D50" }
];
function stampForNode(nodeId, mascot) {
  const nodeStamp = RARE_STAMPS.find((s) => s.id === `stamp-${nodeId}`);
  if (nodeStamp) return nodeStamp;
  return RARE_STAMPS.find((s) => s.id === (mascot === "gauss" ? "gauss-signature" : "davinci-manuscript"));
}
function getRareStamps() {
  return store.read("rareStampBook", {});
}
function ownRareStamp(stampId) {
  const book = getRareStamps();
  if (!book[stampId]) {
    book[stampId] = { at: Date.now() };
    store.write("rareStampBook", book);
  }
}
function resolveEncounterReward(nodeId, mascot, random = Math.random) {
  store.write("encounterWins", store.read("encounterWins", 0) + 1);
  const owned = getRareStamps();
  if (RARE_STAMPS.every((stamp2) => owned[stamp2.id])) {
    addStardust(3);
    store.write("encounterPity", 0);
    store.write("encounterPityByRarity", { "\u666E\u901A": 0, "\u7A00\u6709": 0, "\u50B3\u8AAA": 0 });
    return {
      type: "stardust",
      amount: 3,
      message: "\u5370\u8A18\u5DF2\u5168\u6578\u96C6\u9F4A\uFF0C\u9019\u6B21\u7684\u9B54\u529B\u5316\u70BA 3 \u7C92\u661F\u5C51\u6CE8\u5165\u4F60\u7684\u74F6\u4E2D"
    };
  }
  const savedPity = store.read("encounterPityByRarity", {});
  const pity = Object.fromEntries(Object.keys(STAMP_RARITIES).map((rarity2) => [rarity2, (savedPity[rarity2] ?? 0) + 1]));
  const roll = random();
  const rarity = ["\u50B3\u8AAA", "\u7A00\u6709", "\u666E\u901A"].find((candidate) => {
    const config = STAMP_RARITIES[candidate];
    return RARE_STAMPS.some((stamp2) => stamp2.rarity === candidate && !owned[stamp2.id]) && (pity[candidate] >= config.pity || roll < config.dropRate);
  });
  if (!rarity) {
    store.write("encounterPityByRarity", pity);
    return null;
  }
  const preferred = stampForNode(nodeId, mascot);
  const stamp = preferred?.rarity === rarity && !owned[preferred.id] ? preferred : RARE_STAMPS.find((item) => item.rarity === rarity && !owned[item.id]) ?? null;
  if (!stamp) return null;
  pity[rarity] = 0;
  ownRareStamp(stamp.id);
  store.write("encounterPityByRarity", pity);
  store.write("encounterPity", 0);
  return { type: "stamp", stamp };
}
function getCollection() {
  return store.read("collection", {});
}
var DAY_MS = 24 * 60 * 60 * 1e3;
function collectionBonusFor(nodeIds, collection = {}, rareStamps = {}) {
  const manuscriptBonus = nodeIds.filter((id) => (collection[id]?.tier ?? 0) >= 2).length * 0.03;
  const stampBonus = nodeIds.filter((id) => rareStamps[`stamp-${id}`]).length * 0.02;
  return Math.min(0.15, manuscriptBonus + stampBonus);
}
function evaluateCollection(nodeId, stats, ctx2) {
  const col = getCollection();
  const drops = [];
  const upgrade = (id, tier) => {
    const current = col[id]?.tier ?? 0;
    if (tier > current) {
      col[id] = { tier, at: Date.now() };
      drops.push({ item: MANUSCRIPTS.find((m) => m.id === id), tier });
    }
  };
  if (ctx2.masterTrialPassed) upgrade("master-trial", 2);
  const manuscript = MANUSCRIPTS.find((m) => m.id === nodeId);
  if (manuscript && nodeId !== "master-trial") {
    if (stats.totalAttempts > 0) upgrade(nodeId, 1);
    if (stats.masteryPct >= 0.8) upgrade(nodeId, 2);
  }
  if (drops.length > 0) store.write("collection", col);
  const highestById = {};
  drops.forEach((d) => {
    highestById[d.item.id] = d;
  });
  return Object.values(highestById);
}

// math-build/modules/boss.js
var BOSS_MAX_HP = 100;
var PLAYER_MAX_HP = 100;
var BOSSES = {
  "num-quantity": { icon: "\u2696", name: "\u7C73\u8AFE\u9676\u6D1B\u65AF", attacks: ["\u8E44\u8072\u8A66\u63A2", "\u8FF7\u5BAE\u5C01\u9396", "\u72C2\u89D2\u89BA\u9192"] },
  algebra: { icon: "\u2726", name: "\u65AF\u82AC\u514B\u65AF", attacks: ["\u8B0E\u8A9E\u8A66\u63A2", "\u7345\u8EAB\u8B0E\u76FE", "\u771F\u8A00\u89BA\u9192"] },
  "space-shape": { icon: "\u{1F528}", name: "\u7368\u773C\u5DE8\u4EBA", attacks: ["\u77F3\u69CC\u8A66\u63A2", "\u7194\u7210\u9435\u58C1", "\u5DE8\u773C\u89BA\u9192"] },
  "relation-pattern": { icon: "\u{1F9F5}", name: "\u547D\u904B\u4E09\u5973\u795E", attacks: ["\u7D72\u7DDA\u8A66\u63A2", "\u547D\u904B\u7E54\u7DB2", "\u4E09\u76F8\u89BA\u9192"] },
  "data-uncertainty": { icon: "\u{1F3FA}", name: "\u76AE\u5A9E\u4E9E", attacks: ["\u7C64\u8A9E\u8A66\u63A2", "\u8FF7\u9727\u795E\u8AED", "\u5148\u77E5\u89BA\u9192"] }
};
function bossFor(strandId) {
  return BOSSES[strandId] ?? null;
}
function newBossState(strandId) {
  if (!bossFor(strandId)) return null;
  return { strandId, hp: BOSS_MAX_HP, maxHp: BOSS_MAX_HP, playerHp: PLAYER_MAX_HP, playerMaxHp: PLAYER_MAX_HP };
}
function bossPhase(bossState) {
  if (!bossState) return null;
  const ratio = bossState.maxHp > 0 ? bossState.hp / bossState.maxHp : 0;
  const index = ratio > 0.66 ? 0 : ratio > 0.33 ? 1 : 2;
  const phases = [
    { id: "probe", name: "\u8A66\u63A2\u653B\u52E2", correctBonus: 0 },
    { id: "shield", name: "\u8B0E\u76FE\u653B\u52E2", correctBonus: 0.1 },
    { id: "awakened", name: "\u89BA\u9192\u653B\u52E2", correctBonus: 0.2 }
  ];
  return { ...phases[index], attack: bossFor(bossState.strandId)?.attacks?.[index] ?? phases[index].name };
}
function bossGate(strand, progress = {}, masteryThreshold = 0.8) {
  const nodeIds = (strand?.nodes ?? []).map((n) => n.id);
  if (nodeIds.length === 0) return { eligible: false, masteryPct: 0 };
  const masteryPct = nodeIds.reduce(
    (sum, id) => sum + Math.max(0, Math.min(1, Number(progress[id]?.masteryPct) || 0)),
    0
  ) / nodeIds.length;
  return { eligible: masteryPct >= masteryThreshold, masteryPct };
}
function playerDamage(combo, playerHp, playerMaxHp, collectionBonus = 0) {
  const base = 12 + combo * 3;
  const desperate = playerMaxHp > 0 && playerHp / playerMaxHp < 0.3 ? base * 1.5 : base;
  return Math.round(desperate * (1 + collectionBonus));
}
function applyAnswer(bossState, isCorrect, combo, collectionBonus = 0) {
  if (!bossState) return bossState;
  const next = { ...bossState };
  const phase = bossPhase(next);
  if (isCorrect) {
    const totalBonus = Math.min(0.25, Math.max(0, collectionBonus) + phase.correctBonus);
    const dmg = playerDamage(combo, next.playerHp, next.playerMaxHp, totalBonus);
    next.hp = Math.max(0, next.hp - dmg);
    const eventType = phase.id === "shield" ? "break" : phase.id === "awakened" ? "counter" : "hit";
    next.lastEvent = {
      type: eventType,
      dmg,
      totalBonus,
      phase: phase.id,
      phaseName: phase.name,
      attack: phase.attack
    };
  } else {
    next.lastEvent = { type: "guard", dmg: 0, phase: phase.id, phaseName: phase.name, attack: phase.attack };
  }
  return next;
}
function reviveWithBlessing(bossState) {
  if (!bossState) return bossState;
  return { ...bossState, playerHp: Math.round(bossState.playerMaxHp * 0.5) };
}
function bossOutcome(bossState) {
  if (!bossState) return null;
  if (bossState.hp <= 0) return "victory";
  if (bossState.playerHp <= 0) return "defeat";
  return null;
}
function getBossFights() {
  return store.read("bossFights", {});
}
function recordBossOutcome(strandId, outcome, bestCombo = 0) {
  const all = getBossFights();
  const prev = all[strandId] ?? { defeated: false, bestCombo: 0, attempts: 0 };
  all[strandId] = {
    defeated: prev.defeated || outcome === "victory",
    bestCombo: Math.max(prev.bestCombo, bestCombo),
    attempts: prev.attempts + 1,
    lastFightAt: Date.now(),
    lastOutcome: outcome
  };
  store.write("bossFights", all);
  return all[strandId];
}

// math-build/modules/pvp.js
function mulberry322(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, rng) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function buildSeededQuestions(seed, allQuestions, size = 10) {
  const rng = mulberry322(seed);
  return seededShuffle(allQuestions, rng).slice(0, Math.min(size, allQuestions.length));
}
function newChallengeSeed(random = Math.random) {
  return Math.floor(random() * 1e9);
}
function getPvpChallenges() {
  return store.read("pvpChallenges", {});
}
function recordPvpRun(seed, strandId, result) {
  const all = getPvpChallenges();
  const key = String(seed);
  const prevBest = all[key]?.bestDmg ?? 0;
  const next = {
    strandId,
    seed,
    lastDmg: result.totalDmg,
    bestDmg: Math.max(prevBest, result.totalDmg),
    lastCombo: result.maxCombo,
    attempts: (all[key]?.attempts ?? 0) + 1,
    lastPlayedAt: Date.now()
  };
  all[key] = next;
  store.write("pvpChallenges", all);
  return next;
}
function pvpChallengeFor(seed) {
  return getPvpChallenges()[String(seed)] ?? null;
}

// math-build/modules/fusion.js
var SPIRIT_MIN = 2;
var SPIRIT_MAX = 100;
var EQUIP_MAX = 3;
var WRONG_GUESS_COST = 1;
var GUARDIAN_SPIRIT = {
  "num-quantity": 2,
  algebra: 3,
  "space-shape": 5,
  "relation-pattern": 7,
  "data-uncertainty": 11
};
var HERO_SPIRITS = {
  2: { name: "\u5076\u7D20\u4E4B\u9748", tagline: "\u552F\u4E00\u7684\u5076\u6578\u8CEA\u6578", art: "spirit-2" },
  3: { name: "\u4E09\u89D2\u4E4B\u9748", tagline: "\u7B2C\u4E00\u500B\u5947\u8CEA\u6578", art: "spirit-3" },
  5: { name: "\u4E94\u8292\u4E4B\u9748", tagline: "\u661F\u5F62\u7684\u8CEA\u6578", art: "spirit-5" },
  7: { name: "\u4E03\u5F26\u4E4B\u9748", tagline: "\u795E\u8AED\u4E4B\u6578", art: "spirit-7" },
  6: { name: "\u8D6B\u83F2\u65AF\u6258\u65AF\u30FB\u5B8C\u7F8E\u4E4B\u9748", tagline: "1+2+3\uFF1D6\uFF0C\u7B2C\u4E00\u500B\u5B8C\u5168\u6578", art: "spirit-6" },
  28: { name: "\u585E\u52D2\u6D85\u30FB\u5927\u5B8C\u7F8E\u4E4B\u9748", tagline: "1+2+4+7+14\uFF1D28\uFF0C\u7B2C\u4E8C\u500B\u5B8C\u5168\u6578", art: "spirit-28" },
  12: { name: "\u5F97\u58A8\u5FD2\u8033\u30FB\u8C50\u9952\u4E4B\u9748", tagline: "\u6709 6 \u500B\u56E0\u6578\u7684\u8C50\u9952\u4E4B\u6578", art: "spirit-12" }
};
function isPrime(n) {
  if (!Number.isInteger(n) || n < 2) return false;
  for (let i = 2; i * i <= n; i += 1) {
    if (n % i === 0) return false;
  }
  return true;
}
function divisors(n) {
  if (!Number.isInteger(n) || n < 1) return [];
  const out = [];
  for (let i = 1; i * i <= n; i += 1) {
    if (n % i === 0) {
      out.push(i);
      if (i !== n / i) out.push(n / i);
    }
  }
  return out.sort((a, b) => a - b);
}
function divisorCount(n) {
  return divisors(n).length;
}
function primeFactorization(n) {
  if (!Number.isInteger(n) || n < SPIRIT_MIN) return "";
  const factors = [];
  let remaining = n;
  for (let factor = 2; factor * factor <= remaining; factor += 1) {
    let exponent = 0;
    while (remaining % factor === 0) {
      remaining /= factor;
      exponent += 1;
    }
    if (exponent > 0) factors.push(exponent === 1 ? String(factor) : `${factor}${"\u2070\xB9\xB2\xB3\u2074\u2075\u2076\u2077\u2078\u2079"[exponent] ?? `^${exponent}`}`);
  }
  if (remaining > 1) factors.push(String(remaining));
  return factors.join(" \xD7 ");
}
function isPerfect(n) {
  if (!Number.isInteger(n) || n < 2) return false;
  return divisors(n).slice(0, -1).reduce((a, b) => a + b, 0) === n;
}
function isSquare(n) {
  if (!Number.isInteger(n) || n < 1) return false;
  const r = Math.round(Math.sqrt(n));
  return r * r === n;
}
function classify(n) {
  if (isPerfect(n)) return { kind: "perfect", rarity: "\u50B3\u8AAA" };
  if (isPrime(n)) return { kind: "prime", rarity: "\u7A00\u6709" };
  if (isSquare(n)) return { kind: "square", rarity: "\u7A00\u6709" };
  return { kind: "composite", rarity: "\u666E\u901A" };
}
function spiritName(n) {
  if (HERO_SPIRITS[n]) return HERO_SPIRITS[n].name;
  const kind = classify(n).kind;
  if (kind === "prime") return `${n} \u8CEA\u9748`;
  if (kind === "square") return `${n} \u65B9\u9748`;
  return `${n} \u4E4B\u9748`;
}
function spiritArt(n) {
  return HERO_SPIRITS[n]?.art ?? null;
}
function spiritCardData(n, book = getSpiritBook()) {
  if (!book?.[String(n)]) return null;
  const classification = classify(n);
  return {
    n,
    name: spiritName(n),
    factorization: primeFactorization(n),
    rarity: classification.rarity,
    kind: classification.kind,
    divisorCount: divisorCount(n),
    bonusPct: Math.min(6, divisorCount(n)),
    art: spiritArt(n)
  };
}
function canFuse(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < SPIRIT_MIN || b < SPIRIT_MIN) {
    return { ok: false, product: null, reason: "\u661F\u9748\u6578\u5B57\u4E0D\u5408\u6CD5" };
  }
  const product = a * b;
  if (product > SPIRIT_MAX) {
    return { ok: false, product, reason: `${a}\xD7${b}\uFF1D${product}\uFF0C\u8D85\u904E ${SPIRIT_MAX} \u7684\u661F\u754C\u4E0A\u9650` };
  }
  return { ok: true, product, reason: null };
}
function getStardustSpent() {
  return Math.max(0, Number(store.read("stardustSpent", 0)) || 0);
}
function stardustBalance() {
  return Math.max(0, getStardustCount() - getStardustSpent());
}
function spendStardust(amount) {
  const cost = Math.max(0, Math.floor(Number(amount) || 0));
  if (cost === 0) return true;
  if (stardustBalance() < cost) return false;
  store.write("stardustSpent", getStardustSpent() + cost);
  return true;
}
function forceSettleStardust() {
  store.write("stardustSpent", getStardustCount());
}
function getSpiritBook() {
  return store.read("spiritBook", {});
}
function ownsSpirit(n) {
  return Boolean(getSpiritBook()[String(n)]);
}
function captureSpirit(n) {
  if (!Number.isInteger(n) || n < SPIRIT_MIN || n > SPIRIT_MAX) return null;
  const book = getSpiritBook();
  const key = String(n);
  const prev = book[key];
  book[key] = { count: (prev?.count ?? 0) + 1, firstAt: prev?.firstAt ?? Date.now(), lastAt: Date.now() };
  store.write("spiritBook", book);
  return { n, isNew: !prev, ...classify(n) };
}
function resolveFusion(a, b, guess) {
  const check = canFuse(a, b);
  if (!check.ok) return { ok: false, reason: check.reason };
  const product = check.product;
  const correct = Number(guess) === product;
  if (!correct && WRONG_GUESS_COST > 0) spendStardust(WRONG_GUESS_COST);
  const captured = captureSpirit(product);
  return {
    ok: true,
    product,
    correct,
    cost: correct ? 0 : WRONG_GUESS_COST,
    captured,
    recipe: `${a} \xD7 ${b} = ${product}`
  };
}
function getEquippedSpirits() {
  const raw = store.read("equippedSpirits", []);
  return (Array.isArray(raw) ? raw : []).filter((n) => Number.isInteger(n)).slice(0, EQUIP_MAX);
}
function setEquippedSpirits(numbers) {
  const clean = [...new Set((numbers ?? []).map(Number).filter((n) => Number.isInteger(n) && ownsSpirit(n)))].slice(0, EQUIP_MAX);
  store.write("equippedSpirits", clean);
  return clean;
}
function spiritBonusFor(equipped = getEquippedSpirits()) {
  const total = equipped.reduce((sum, n) => sum + Math.min(6, divisorCount(n)) * 0.01, 0);
  return Math.min(0.1, total);
}

// math-build/modules/sanctuary.js
var PEDESTAL_COUNT = 8;
var STRAND_DECOR = {
  "num-quantity": { theme: "\u8FF7\u5BAE\u5730\u5E95\u57CE", glyph: "\u{1F3DB}", items: ["\u8FF7\u5BAE\u77F3\u67F1", "\u725B\u89D2\u5716\u9A30", "\u9752\u9285\u91CF\u5C3A", "\u7C73\u8AFE\u9676\u6D1B\u65AF\u96D5\u50CF"] },
  algebra: { theme: "\u65AF\u82AC\u514B\u65AF\u795E\u6BBF", glyph: "\u{1F981}", items: ["\u8B0E\u8A9E\u77F3\u7891", "\u7345\u8EAB\u7FFC\u50CF", "\u672A\u77E5\u6578\u9762\u5177", "\u65AF\u82AC\u514B\u65AF\u738B\u5EA7"] },
  "space-shape": { theme: "\u7368\u773C\u5DE8\u4EBA\u935B\u9020\u574A", glyph: "\u{1F528}", items: ["\u935B\u9020\u9435\u7827", "\u5E7E\u4F55\u6A21\u5177", "\u7368\u773C\u706B\u7210", "\u591A\u9762\u9AD4\u6C34\u6676"] },
  "relation-pattern": { theme: "\u547D\u904B\u4E09\u5973\u795E\u7D21\u7E54\u6BBF", glyph: "\u{1F9F5}", items: ["\u547D\u904B\u7D21\u9318", "\u898F\u5F8B\u85E4\u8513", "\u51FD\u6578\u7E54\u6A5F", "\u547D\u7DDA\u639B\u6BEF"] },
  "data-uncertainty": { theme: "\u5FB7\u723E\u83F2\u795E\u8AED\u6BBF", glyph: "\u{1F3FA}", items: ["\u795E\u8AED\u9285\u9F0E", "\u6708\u6842\u51A0", "\u6A5F\u7387\u9AB0\u76E4", "\u76AE\u5A9E\u4E9E\u8056\u5EA7"] }
};
var TIER_RATIOS = [0.25, 0.5, 0.75, 1];
var MILESTONE_DECOR = [
  { id: "center-athena-torch", name: "\u96C5\u5178\u5A1C\u667A\u6167\u706B\u70AC", glyph: "\u{1F525}", milestone: 1 },
  { id: "center-olympus-gate", name: "\u5967\u6797\u5E15\u65AF\u4E4B\u9580", glyph: "\u26E9", milestone: 25 },
  { id: "center-wisdom-tree", name: "\u667A\u6167\u795E\u6728", glyph: "\u{1F333}", milestone: 50 }
];
function buildDecorations() {
  const list = [];
  Object.entries(STRAND_DECOR).forEach(([strandId, def]) => {
    def.items.forEach((name, i) => {
      list.push({ id: `${strandId}-decor-${i}`, name, strand: strandId, theme: def.theme, glyph: def.glyph, tierRatio: TIER_RATIOS[i] });
    });
  });
  MILESTONE_DECOR.forEach((m) => list.push({ id: m.id, name: m.name, strand: "center", theme: "\u5967\u6797\u5E15\u65AF\u4E2D\u5EAD", glyph: m.glyph, milestone: m.milestone }));
  return list;
}
var DECORATIONS = buildDecorations();
function decorationById(id) {
  return DECORATIONS.find((d) => d.id === id) ?? null;
}
function masteredCountByStrand(tree2, progress) {
  const counts = {};
  (tree2?.strands ?? []).forEach((strand) => {
    const nodes = (strand.nodes ?? []).filter((n) => !n.contentPending);
    const mastered = nodes.filter((n) => isNodeMastered(n.id, tree2, progress)).length;
    counts[strand.id] = { mastered, total: nodes.length };
  });
  return counts;
}
function totalMasteredCount(tree2, progress) {
  return (tree2?.strands ?? []).reduce(
    (sum, strand) => sum + (strand.nodes ?? []).filter((n) => isNodeMastered(n.id, tree2, progress)).length,
    0
  );
}
function unlockedDecorationIds(tree2, progress = store.read("progress", {})) {
  const counts = masteredCountByStrand(tree2, progress);
  const total = totalMasteredCount(tree2, progress);
  const unlocked = /* @__PURE__ */ new Set();
  DECORATIONS.forEach((d) => {
    if (d.strand === "center") {
      if (total >= d.milestone) unlocked.add(d.id);
    } else {
      const c = counts[d.strand];
      if (c && c.total > 0 && c.mastered / c.total >= d.tierRatio) unlocked.add(d.id);
    }
  });
  return unlocked;
}
function getSanctuaryLayout() {
  const raw = store.read("sanctuaryLayout", {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}
function placeDecoration(pedestalIndex, decorationId, unlockedIds) {
  if (!Number.isInteger(pedestalIndex) || pedestalIndex < 0 || pedestalIndex >= PEDESTAL_COUNT) return getSanctuaryLayout();
  if (!decorationById(decorationId) || !unlockedIds.has(decorationId)) return getSanctuaryLayout();
  const layout = getSanctuaryLayout();
  layout[String(pedestalIndex)] = decorationId;
  store.write("sanctuaryLayout", layout);
  return layout;
}
function clearPedestal(pedestalIndex) {
  const layout = getSanctuaryLayout();
  delete layout[String(pedestalIndex)];
  store.write("sanctuaryLayout", layout);
  return layout;
}
var TITLES = [
  { id: "title-novice", text: "\u521D\u9192\u7684\u5B78\u5F92", need: 0 },
  { id: "title-seeker", text: "\u795E\u8AED\u7684\u8FFD\u5C0B\u8005", need: 5 },
  { id: "title-adept", text: "\u4E94\u6BBF\u7684\u901A\u884C\u8005", need: 15 },
  { id: "title-sage", text: "\u5967\u6797\u5E15\u65AF\u7684\u667A\u8005", need: 30 },
  { id: "title-oracle", text: "\u8207\u96C5\u5178\u5A1C\u540C\u5E2D\u8005", need: 50 }
];
function unlockedTitles(tree2, progress = store.read("progress", {})) {
  const total = totalMasteredCount(tree2, progress);
  return TITLES.filter((t) => total >= t.need);
}
function getInscription() {
  return store.read("sanctuaryInscription", "title-novice");
}
function setInscription(titleId, unlocked) {
  if (!unlocked.some((t) => t.id === titleId)) return getInscription();
  store.write("sanctuaryInscription", titleId);
  return titleId;
}
function inscriptionText(titleId = getInscription()) {
  return TITLES.find((t) => t.id === titleId)?.text ?? TITLES[0].text;
}

// math-build/modules/arena.js
var API_BASE = "https://bxws-math.pages.dev";
var ARENA_QUESTION_COUNT = 10;
function seasonKey(d = /* @__PURE__ */ new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function seasonLabel(key = seasonKey()) {
  const [y, m] = key.split("-");
  return `${y} \u5E74 ${Number(m)} \u6708\u8CFD\u5B63`;
}
function normalizeRoomCode(code) {
  return String(code ?? "").trim().toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 8);
}
function isValidRoomCode(code) {
  const c = normalizeRoomCode(code);
  return c.length >= 3 && c.length <= 8;
}
function roomSeed(roomCode, strandId, season = seasonKey()) {
  const str = `${normalizeRoomCode(roomCode)}|${season}|${strandId}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return Math.floor(mulberry322(h)() * 1e9);
}
function getLocalArenaBest() {
  return store.read("arenaBest", {});
}
function localKey(roomCode, strandId, season) {
  return `${normalizeRoomCode(roomCode)}|${season}|${strandId}`;
}
function recordLocalArenaBest(roomCode, strandId, result, season = seasonKey()) {
  const all = getLocalArenaBest();
  const key = localKey(roomCode, strandId, season);
  const prev = all[key];
  const better = !prev || result.pct > prev.pct || result.pct === prev.pct && result.totalSec < prev.totalSec;
  if (better) {
    all[key] = { pct: result.pct, totalSec: result.totalSec, totalDmg: result.totalDmg, maxCombo: result.maxCombo, at: Date.now() };
    store.write("arenaBest", all);
  }
  return all[key];
}
async function submitArenaResult(roomCode, strandId, result, season = seasonKey()) {
  if (!isValidRoomCode(roomCode)) return { skipped: true };
  try {
    const res = await fetch(`${API_BASE}/api/arena-submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomCode: normalizeRoomCode(roomCode),
        season,
        strandId,
        deviceId: getPlayerId(),
        authToken: getDeviceToken(),
        name: getPlayerName() || "\u533F\u540D",
        pct: result.pct,
        totalSec: result.totalSec,
        totalDmg: result.totalDmg,
        maxCombo: result.maxCombo,
        questionCount: result.questionCount ?? ARENA_QUESTION_COUNT
      })
    });
    if (!res.ok) return { ok: false };
    return syncDeviceToken(await res.json());
  } catch {
    return { ok: false, offline: true };
  }
}
async function fetchArenaBoard(roomCode, strandId, season = seasonKey()) {
  if (!isValidRoomCode(roomCode)) return null;
  try {
    const url = `${API_BASE}/api/arena-board?roomCode=${encodeURIComponent(normalizeRoomCode(roomCode))}&season=${encodeURIComponent(season)}&strandId=${encodeURIComponent(strandId)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.results ?? null;
  } catch {
    return null;
  }
}

// math-build/modules/market.js
var API_BASE2 = "https://bxws-math.pages.dev";
var MARKET_MIN_PRICE = 5;
var MARKET_MAX_PRICE = 100;
function isMarketBonus(now = /* @__PURE__ */ new Date()) {
  return now.getDay() === 5;
}
function nextMarketText(now = /* @__PURE__ */ new Date()) {
  return isMarketBonus(now) ? "\u8D6B\u7C73\u65AF\u52A0\u78BC\u65E5\u30FB\u4ECA\u65E5\u958B\u5E02" : "\u5E02\u96C6\u5929\u5929\u958B\u30FB\u9031\u4E94\u52A0\u78BC";
}
var NPC_SELLER = "\u8D6B\u7C73\u65AF\u5546\u968A";
function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry323(a) {
  return function() {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function npcListings(roomCode, now = /* @__PURE__ */ new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  const dayKey = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const rng = mulberry323(seedFrom(`${normalizeRoomCode(roomCode)}|${dayKey}`));
  const count = isMarketBonus(now) ? 4 : 3;
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  let guard = 0;
  while (out.length < count && guard < 40) {
    guard += 1;
    const n = 2 + Math.floor(rng() * 99);
    if (seen.has(n)) continue;
    seen.add(n);
    const price = MARKET_MIN_PRICE + Math.floor(rng() * (MARKET_MAX_PRICE - MARKET_MIN_PRICE + 1));
    out.push({ id: `npc-${dayKey}-${n}`, spiritN: n, price, sellerName: NPC_SELLER, npc: true });
  }
  return out;
}
async function listSpirit(roomCode, spiritN, price, season = seasonKey()) {
  if (!isValidRoomCode(roomCode)) return { error: "bad-room" };
  try {
    const res = await fetch(`${API_BASE2}/api/market-list`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomCode: normalizeRoomCode(roomCode), season, deviceId: getPlayerId(), authToken: getDeviceToken(), name: getPlayerName() || "\u533F\u540D", spiritN, price })
    });
    return syncDeviceToken(await res.json());
  } catch {
    return { error: "offline" };
  }
}
async function fetchMarketBoard(roomCode, season = seasonKey()) {
  if (!isValidRoomCode(roomCode)) return null;
  try {
    const url = `${API_BASE2}/api/market-board?roomCode=${encodeURIComponent(normalizeRoomCode(roomCode))}&season=${encodeURIComponent(season)}&deviceId=${encodeURIComponent(getPlayerId())}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()).listings ?? [];
  } catch {
    return null;
  }
}
async function buyListing(id) {
  try {
    const res = await fetch(`${API_BASE2}/api/market-buy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, deviceId: getPlayerId(), authToken: getDeviceToken(), name: getPlayerName() || "\u533F\u540D" })
    });
    return syncDeviceToken(await res.json());
  } catch {
    return { error: "offline" };
  }
}
async function fetchMyListings() {
  try {
    const res = await fetch(`${API_BASE2}/api/market-mine?deviceId=${encodeURIComponent(getPlayerId())}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
async function claimPayout() {
  try {
    const res = await fetch(`${API_BASE2}/api/market-claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: getPlayerId(), authToken: getDeviceToken() })
    });
    return syncDeviceToken(await res.json());
  } catch {
    return { error: "offline" };
  }
}

// math-build/modules/quotes.js
var QUOTES = {
  praise: [
    { text: "\u300C\u9811\u56FA\u7684\u56B4\u8B39\u3002\u300D\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u5C55\u958B\u53E4\u8CE2\u8005\u5377\u8EF8\u2014\u2014\u4F60\u4ECA\u5929\u4E00\u7B46\u4E00\u7B46\u559A\u9192\u795E\u8AED\uFF0C\u6B63\u5408\u9019\u53E5\u5EA7\u53F3\u9298\u3002", by: "\u53E4\u8CE2\u8005\u5377\u8EF8\uFF5C\u9054\u6587\u897F\u5EA7\u53F3\u9298 Ostinato rigore", kind: "\u53F2\u5BE6", mascot: "davinci" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u597D\u7684\u795E\u8AED\u5377\u8EF8\u4E0D\u662F\u7B2C\u4E00\u6B21\u5C31\u8B80\u61C2\uFF0C\u800C\u662F\u6BCF\u6B21\u90FD\u6BD4\u4E0A\u4E00\u56DE\u66F4\u6E96\u4E00\u9EDE\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "davinci" },
    { text: "\u300C\u5BE7\u53EF\u5C11\u4E9B\uFF0C\u4F46\u8981\u6210\u719F\u3002\u300D\u65AF\u82AC\u514B\u65AF\u795E\u6BBF\u7684\u77F3\u523B\u9019\u6A23\u5BEB\u8457\u2014\u2014\u4F60\u628A\u6BCF\u500B\u898F\u5F8B\u90FD\u770B\u6E05\u695A\u4E86\u3002", by: "\u53E4\u8CE2\u8005\u5377\u8EF8\uFF5C\u9AD8\u65AF\u5EA7\u53F3\u9298 Pauca sed matura", kind: "\u53F2\u5BE6", mascot: "gauss" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u4F60\u4E0D\u662F\u53EA\u7B97\u5F97\u5FEB\uFF0C\u800C\u662F\u4E00\u773C\u6293\u5230\u4E86\u85CF\u5728\u984C\u76EE\u88E1\u7684\u7D50\u69CB\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "gauss" },
    { text: "\u300C\u901A\u5F80\u5E7E\u4F55\u5B78\u6C92\u6709\u738B\u8005\u4E4B\u8DEF\u3002\u300D\u7368\u773C\u5DE8\u4EBA\u935B\u9020\u574A\u9580\u6963\u523B\u8457\u9019\u53E5\u53E4\u8CE2\u8005\u7B54\u8A9E\u2014\u2014\u9023\u570B\u738B\u90FD\u6C92\u6709\u6377\u5F91\uFF0C\u800C\u4F60\u4ECA\u5929\u8D70\u5B8C\u7684\u6BCF\u4E00\u6B65\u90FD\u7B97\u6578\u3002", by: "\u53E4\u8CE2\u8005\u5377\u8EF8\uFF5C\u666E\u7F85\u514B\u6D1B\u8A18\u8F09\u6B50\u5E7E\u91CC\u5F97\u7B54\u6258\u52D2\u5BC6\u738B", kind: "\u53F2\u5BE6", mascot: "euclid" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u5B9A\u7FA9\u7AD9\u7A69\u3001\u7DDA\u689D\u5C0D\u9F4A\uFF0C\u8B49\u660E\u81EA\u7136\u6703\u627E\u5230\u51FA\u53E3\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "euclid" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u4F60\u5DF2\u7D93\u770B\u898B\u6578\u5217\u4E0D\u662F\u4E00\u4E32\u6578\uFF0C\u800C\u662F\u4E00\u682A\u6703\u751F\u9577\u7684\u661F\u85E4\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "fibonacci" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u898F\u5F8B\u4E00\u65E6\u88AB\u4F60\u8AAA\u6E05\u695A\uFF0C\u4E0B\u4E00\u6B65\u5C31\u4E0D\u518D\u662F\u731C\u6E2C\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "fibonacci" },
    { text: "\u300C\u5FC3\u6709\u5176\u7406\uFF0C\u975E\u7406\u6027\u6240\u80FD\u76E1\u77E5\u3002\u300D\u5FB7\u723E\u83F2\u795E\u8AED\u6BBF\u7684\u5377\u8EF8\u9019\u6A23\u4F4E\u8A9E\u2014\u2014\u4F60\u65E2\u7B97\u6E05\u695A\uFF0C\u4E5F\u4FDD\u7559\u4E86\u5224\u65B7\u3002", by: "\u53E4\u8CE2\u8005\u5377\u8EF8\uFF5C\u5E15\u65AF\u5361\u300A\u601D\u60F3\u9304\u300B", kind: "\u53F2\u5BE6", mascot: "pascal" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u4F60\u628A\u4E0D\u78BA\u5B9A\u62C6\u6210\u53EF\u4EE5\u6BD4\u8F03\u7684\u53EF\u80FD\uFF0C\u9019\u5C31\u662F\u597D\u63A8\u7406\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "pascal" }
  ],
  cheer: [
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u5148\u5225\u6025\u8457\u64E6\u6389\u932F\u7DDA\uFF1B\u6CBF\u8457\u5B83\u56DE\u770B\uFF0C\u4E0B\u4E00\u7A3F\u5C31\u77E5\u9053\u8981\u6539\u54EA\u4E00\u7B46\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "davinci" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u628A\u9019\u984C\u63DB\u4E00\u7A2E\u756B\u6CD5\u518D\u8A66\u4E00\u6B21\uFF0C\u795E\u8AED\u5377\u8EF8\u6703\u66FF\u4F60\u7559\u4E0B\u7DDA\u7D22\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "davinci" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u5148\u627E\u7B54\u6848\u5728\u54EA\u4E00\u6B65\u7A81\u7136\u4E0D\u5408\u7406\uFF0C\u90A3\u88E1\u901A\u5E38\u5C31\u662F\u932F\u8AA4\u7684\u5165\u53E3\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "gauss" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u5225\u91CD\u7B97\u6574\u984C\uFF1B\u5148\u6BD4\u5C0D\u898F\u5F8B\u3001\u7B26\u865F\u548C\u95DC\u9375\u8F49\u6298\uFF0C\u932F\u8655\u6703\u81EA\u5DF1\u73FE\u5F62\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "gauss" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u56DE\u5230\u5B9A\u7FA9\uFF0C\u628A\u5DF2\u77E5\u689D\u4EF6\u9010\u689D\u756B\u4E0A\u53BB\uFF0C\u6DF7\u4E82\u5C31\u6703\u8B8A\u6210\u79E9\u5E8F\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "euclid" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u5716\u756B\u6B6A\u4E86\u4E0D\u8981\u7DCA\uFF0C\u5148\u78BA\u8A8D\u6BCF\u4E00\u689D\u7DDA\u7A76\u7ADF\u4EE3\u8868\u4EC0\u9EBC\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "euclid" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u5148\u5BEB\u51FA\u524D\u4E09\u6B65\u7684\u8B8A\u5316\uFF0C\u518D\u554F\u6BCF\u4E00\u6B65\u591A\u4E86\u4EC0\u9EBC\u3001\u5C11\u4E86\u4EC0\u9EBC\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "fibonacci" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u898F\u5F8B\u8EB2\u8D77\u4F86\u6642\uFF0C\u5C31\u628A\u76F8\u9130\u5169\u9805\u653E\u5728\u4E00\u8D77\u6BD4\u8F03\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "fibonacci" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u5148\u5217\u51FA\u6240\u6709\u53EF\u80FD\uFF0C\u518D\u6AA2\u67E5\u6709\u6C92\u6709\u91CD\u8907\u6216\u6F0F\u6389\uFF0C\u6A5F\u7387\u624D\u7AD9\u5F97\u7A69\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "pascal" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u8CC7\u6599\u4E0D\u6703\u66FF\u4F60\u4E0B\u7D50\u8AD6\uFF1B\u5148\u770B\u7E3D\u6578\u3001\u5206\u985E\u548C\u6BD4\u8F03\u57FA\u6E96\u662F\u5426\u4E00\u81F4\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "pascal" }
  ],
  comfort: [
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u4ECA\u5929\u7684\u661F\u5149\u6697\u4E00\u9EDE\u6C92\u95DC\u4FC2\uFF1B\u5148\u5708\u51FA\u4E00\u984C\uFF0C\u6162\u6162\u91CD\u756B\u7B2C\u4E00\u6B65\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "davinci" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u5361\u4F4F\u4E0D\u4EE3\u8868\u4F60\u505A\u4E0D\u5230\uFF1B\u63DB\u4E00\u5F35\u7D19\uFF0C\u628A\u5DF2\u77E5\u689D\u4EF6\u91CD\u65B0\u756B\u4E00\u6B21\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "davinci" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u96F6\u9846\u661F\u53EA\u662F\u898F\u5F8B\u9084\u6C92\u73FE\u8EAB\uFF1B\u6311\u4E00\u984C\u6AA2\u67E5\u7B2C\u4E00\u500B\u4E0D\u5408\u7406\u7684\u6B65\u9A5F\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "gauss" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u4ECA\u5929\u5148\u4E0D\u7528\u8FFD\u5FEB\uFF1B\u628A\u4E00\u984C\u7B54\u6848\u4EE3\u56DE\u53BB\uFF0C\u627E\u51FA\u662F\u54EA\u500B\u7B26\u865F\u51FA\u4E86\u932F\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "gauss" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u770B\u4E0D\u61C2\u5716\u4E0D\u7B49\u65BC\u4E0D\u6703\uFF1B\u5148\u7528\u7B46\u6A19\u51FA\u7AEF\u9EDE\u3001\u89D2\u548C\u5DF2\u77E5\u9577\u5EA6\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "euclid" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u9019\u6B21\u6C92\u8D70\u5230\u7D42\u9EDE\u4E5F\u6C92\u95DC\u4FC2\uFF1B\u56DE\u5230\u5B9A\u7FA9\uFF0C\u5148\u8AAA\u6E05\u695A\u4E00\u500B\u5716\u5F62\u7279\u5FB5\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "euclid" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u73FE\u5728\u770B\u4E0D\u51FA\u898F\u5F8B\u5F88\u6B63\u5E38\uFF1B\u628A\u524D\u56DB\u9805\u6392\u6574\u9F4A\uFF0C\u9010\u9805\u5BEB\u51FA\u5DEE\u591A\u5C11\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "fibonacci" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u731C\u932F\u4E5F\u662F\u4E00\u689D\u7DDA\u7D22\uFF1B\u5148\u6AA2\u67E5\u4F60\u7684\u898F\u5247\u80FD\u4E0D\u80FD\u540C\u6642\u89E3\u91CB\u524D\u4E09\u9805\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "fibonacci" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u4E0D\u78BA\u5B9A\u4E26\u4E0D\u53EF\u6015\uFF1B\u5148\u5217\u4E00\u5F35\u5C0F\u8868\uFF0C\u628A\u6240\u6709\u53EF\u80FD\u5404\u8A18\u4E00\u6B21\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "pascal" },
    { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u8CC7\u6599\u4E00\u591A\u8AB0\u90FD\u6703\u4E82\uFF1B\u5148\u5206\u6210\u5169\u985E\uFF0C\u518D\u6578\u6BCF\u4E00\u985E\u6709\u5E7E\u7B46\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C", mascot: "pascal" }
  ]
};
var EXTRA_QUOTES = [
  { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u6BCF\u4E00\u5377\u795E\u8AED\u90FD\u5F9E\u7B2C\u4E00\u9801\u7684\u8A66\u8B80\u958B\u59CB\uFF1B\u4F60\u5DF2\u7D93\u8010\u5FC3\u559A\u9192\u5230\u7B2C\u4E03\u9801\u4E86\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C" },
  { text: "\u300C\u6578\u5B78\u662F\u79D1\u5B78\u7684\u7687\u540E\uFF0C\u6578\u8AD6\u662F\u6578\u5B78\u7684\u7687\u540E\u3002\u300D\u53E4\u8CE2\u8005\u5377\u8EF8\u9019\u6A23\u5BEB\u8457\u2014\u2014\u4F60\u6B63\u5728\u7DF4\u7FD2\u770B\u898B\u6578\u5B57\u80CC\u5F8C\u7684\u79E9\u5E8F\u3002", by: "\u53E4\u8CE2\u8005\u5377\u8EF8\uFF5C\u9AD8\u65AF\u540D\u8A00", kind: "\u53F2\u5BE6" },
  { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u4ECA\u5929\u591A\u6CE8\u5165\u4E00\u7E37\u667A\u6167\u4E4B\u5149\uFF0C\u660E\u5929\u7684\u795E\u8AED\u5377\u8EF8\u5C31\u591A\u4E00\u7A2E\u53EF\u80FD\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C" },
  { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u7B97 1 \u52A0\u5230 100 \u7684\u95DC\u9375\u4E0D\u662F\u624B\u5FEB\uFF0C\u800C\u662F\u5148\u770B\u51FA\u9996\u5C3E\u914D\u5C0D\u7684\u898F\u5F8B\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C" },
  { text: "\u300C\u9811\u56FA\u7684\u56B4\u8B39\u3002\u300D\u4E00\u6574\u500B\u6708\u7684\u661F\u5C51\u74F6\uFF0C\u5C31\u662F\u9019\u53E5\u53E4\u8CE2\u8005\u5EA7\u53F3\u9298\u6700\u597D\u7684\u8B49\u660E\u3002", by: "\u53E4\u8CE2\u8005\u5377\u8EF8\uFF5C\u9054\u6587\u897F\u5EA7\u53F3\u9298 Ostinato rigore", kind: "\u53F2\u5BE6" },
  { text: "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u63D0\u9192\u4F60\uFF1A\u9858\u610F\u53CD\u8986\u8A66\u9A57\uFF0C\u4E5F\u5584\u65BC\u6293\u51FA\u898F\u5F8B\uFF0C\u5967\u6797\u5E15\u65AF\u6578\u8853\u795E\u6BBF\u6C38\u9060\u6B61\u8FCE\u6BCF\u5929\u56DE\u4F86\u7684\u4F60\u3002", by: "\u5275\u4F5C", kind: "\u5275\u4F5C" }
];
function unlockedExtraQuotes(inkDropCount) {
  return EXTRA_QUOTES.slice(0, Math.floor(inkDropCount / 7));
}
function pickQuote(stars, mascot) {
  if (stars > 1 && Math.random() >= 0.4) return null;
  const pool = stars >= 3 ? QUOTES.praise : stars >= 2 ? QUOTES.cheer : QUOTES.comfort;
  const preferred = pool.filter((q) => q.mascot === mascot);
  const candidates = preferred.length > 0 ? preferred : pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// math-build/modules/sfx.js
var ctx = null;
function isSfxOn() {
  return store.read("sfxOn", true);
}
function setSfxOn(on) {
  store.write("sfxOn", !!on);
  if (on) ensureCtx();
}
function areHapticsOn() {
  return store.read("hapticsOn", true);
}
function setHapticsOn(on) {
  store.write("hapticsOn", !!on);
}
function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}
function tone(freq, { dur = 0.12, type = "triangle", gain = 0.16, delay = 0 } = {}) {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(1e-3, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}
function noiseBurst({ dur = 0.09, gain = 0.22, delay = 0 } = {}) {
  const c = ensureCtx();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  src.connect(filter).connect(g).connect(c.destination);
  src.start(t0);
}
function buzz(pattern) {
  if (!areHapticsOn()) return;
  navigator.vibrate?.(pattern);
}
var sfx = {
  // 答對：上行雙音，連對越長音高越高（音高階梯）
  correct(streak = 0) {
    if (!isSfxOn()) return;
    const step = Math.min(streak, 8);
    const base = 523.25 * Math.pow(2, step / 12);
    tone(base, { dur: 0.09 });
    tone(base * 1.26, { dur: 0.14, delay: 0.07 });
    buzz(30);
  },
  wrong() {
    if (!isSfxOn()) return;
    tone(150, { dur: 0.22, type: "sine", gain: 0.14 });
    buzz(40);
  },
  stamp() {
    if (!isSfxOn()) return;
    noiseBurst({ dur: 0.08, gain: 0.28 });
    tone(90, { dur: 0.12, type: "sine", gain: 0.2 });
    buzz(80);
  },
  star(i = 0) {
    if (!isSfxOn()) return;
    tone(660 * Math.pow(1.2, i), { dur: 0.16, gain: 0.14 });
  },
  tick() {
    if (!isSfxOn()) return;
    tone(880, { dur: 0.04, type: "square", gain: 0.05 });
    buzz(15);
  },
  rare() {
    if (!isSfxOn()) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, { dur: 0.22, delay: i * 0.1, gain: 0.15 }));
    buzz([40, 30, 40, 30, 120]);
  }
};

// math-build/modules/accessibility.js
var DEFAULTS = { fontSize: "standard", sprintWarning: false, comboBreakEffect: true };
var FONT_SIZES = { standard: "16px", large: "18px", xlarge: "20px" };
function getAccessibilitySettings() {
  return { ...DEFAULTS, ...store.read("accessibilitySettings", {}) ?? {} };
}
function setAccessibilitySetting(key, value) {
  const next = { ...getAccessibilitySettings(), [key]: value };
  store.write("accessibilitySettings", next);
  return next;
}
function applyAccessibilitySettings(root = document.documentElement) {
  const settings = getAccessibilitySettings();
  root.style.setProperty("--base-font-size", FONT_SIZES[settings.fontSize] ?? FONT_SIZES.standard);
  root.dataset.sprintWarning = settings.sprintWarning ? "on" : "off";
  root.dataset.comboBreakEffect = settings.comboBreakEffect ? "on" : "off";
  return settings;
}

// math-build/modules/weekly.js
function isoWeekKey(d = /* @__PURE__ */ new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 864e5 + 1) / 7);
  return `${date.getUTCFullYear()}W${String(week).padStart(2, "0")}`;
}
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry324(a) {
  return function() {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
async function buildWeeklySession(nodeIds, sessionSize = 10) {
  const results = await Promise.allSettled(nodeIds.map(loadQuestionBank));
  const all = results.flatMap((result, i) => result.status === "fulfilled" ? flattenBank(result.value).map((q) => ({ ...q, _nodeId: nodeIds[i] })) : []).sort((a, b) => a.id < b.id ? -1 : 1);
  const rand = mulberry324(hashSeed(isoWeekKey()));
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, Math.min(sessionSize, all.length));
}
function deriveResultKey(week) {
  let mixed = hashSeed(week) ^ 2654435769;
  mixed = Math.imul(mixed ^ mixed >>> 13, 2246822507);
  mixed = Math.imul(mixed ^ mixed >>> 16, 3266489909);
  const rotatedWeek = [...week].reverse().map(
    (char, index) => String.fromCharCode(char.charCodeAt(0) ^ index * 17 + 43 & 31)
  ).join("");
  return `${(mixed >>> 0).toString(36)}:${hashSeed(rotatedWeek).toString(36)}`;
}
function resultChecksum(week, body) {
  const key = deriveResultKey(week);
  return (hashSeed(`${key}|${body}|${key.length}`) % 36 ** 3).toString(36).toUpperCase().padStart(3, "0");
}
function encodeResult(pct, totalSec, maxStreak) {
  const value = Math.round(pct) * 1e6 + Math.min(999, Math.round(totalSec)) * 1e3 + Math.min(99, maxStreak);
  const body = value.toString(36).toUpperCase();
  const week = isoWeekKey();
  const check = resultChecksum(week, body);
  return `${week}-V2${body}${check}`;
}
function decodeResult(code) {
  const normalized = String(code).trim().toUpperCase();
  if (/^\d{4}W\d{2}-[0-9A-Z]+$/.test(normalized) && !normalized.includes("-V2")) return { error: "too-old" };
  const m = /^(\d{4}W\d{2})-V2([0-9A-Z]+)([0-9A-Z]{3})$/.exec(normalized);
  if (!m) return null;
  const value = parseInt(m[2], 36);
  if (Number.isNaN(value) || resultChecksum(m[1], m[2]) !== m[3]) return null;
  const result = {
    week: m[1],
    pct: Math.floor(value / 1e6),
    totalSec: Math.floor(value / 1e3) % 1e3,
    maxStreak: value % 1e3
  };
  if (result.pct > 100 || result.maxStreak > 99) return null;
  return result;
}
function assessImplausibleResult(record = {}) {
  const reasons = [];
  const pct = Number(record.pct);
  const totalSec = Number(record.totalSec);
  const questionCount = Number(record.questionCount);
  if (Number.isFinite(questionCount) && questionCount > 0) {
    if (Number.isFinite(totalSec) && totalSec < questionCount * 1.2) reasons.push("\u5E73\u5747\u4F5C\u7B54\u6642\u9593\u904E\u77ED");
    if (pct === 100 && questionCount < 5) reasons.push("\u5168\u5C0D\u4F46\u984C\u6578\u904E\u5C11");
  }
  const answerLog = Array.isArray(record.answerLog) ? record.answerLog : null;
  if (answerLog) {
    const logCorrect = answerLog.filter((answer) => answer.c === 1 || answer.correct === true).length;
    const logPct = answerLog.length > 0 ? Math.round(logCorrect / answerLog.length * 100) : 0;
    const logSec = answerLog.reduce((sum, answer) => sum + Math.max(0, Number(answer.ms) || 0), 0) / 1e3;
    if (Number.isFinite(questionCount) && questionCount !== answerLog.length || Number.isFinite(pct) && pct !== logPct || Number.isFinite(totalSec) && Math.abs(totalSec - logSec) > Math.max(2, logSec * 0.2)) {
      reasons.push("\u5206\u6578\u6216\u6642\u9593\u8207\u4F5C\u7B54\u7D00\u9304\u4E0D\u4E00\u81F4");
    }
    if (Number.isFinite(record.completedAt) && answerLog.some((answer) => Number.isFinite(answer.at) && answer.at > record.completedAt)) {
      reasons.push("\u4F5C\u7B54\u6642\u9593\u6233\u665A\u65BC\u7D50\u7B97\u6642\u9593");
    }
  }
  return { flagged: reasons.length > 0, reasons, flagLabel: reasons.length > 0 ? "\u26A0\uFE0F \u5EFA\u8B70\u8907\u9A57" : "" };
}
function decodeClassResults(text) {
  const results = [];
  let invalidCount = 0;
  String(text).split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    let name = "";
    let code = line;
    const commaIndex = line.indexOf(",");
    if (commaIndex >= 0) {
      name = line.slice(0, commaIndex).trim();
      code = line.slice(commaIndex + 1).trim();
    } else {
      const parts = line.split(/\s+/);
      if (parts.length > 1) {
        code = parts.pop();
        name = parts.join(" ").trim();
      }
    }
    const decoded = decodeResult(code);
    if (!decoded || decoded.error) {
      invalidCount += 1;
      return;
    }
    const audit = assessImplausibleResult({ ...decoded, questionCount: 10 });
    results.push({ ...decoded, ...audit, code, name: name || null, lineNumber: index + 1 });
  });
  results.sort((a, b) => b.pct - a.pct || a.totalSec - b.totalSec || b.maxStreak - a.maxStreak);
  return { results, invalidCount };
}
function getWeeklyBest() {
  return store.read(`weekly:${isoWeekKey()}`, null);
}
function submitWeeklyResult(pct, totalSec, maxStreak, audit = {}) {
  const current = getWeeklyBest();
  const better = !current || pct > current.pct || pct === current.pct && totalSec < current.totalSec;
  if (!better) return current;
  const completedAt = Date.now();
  const questionCount = Number(audit.questionCount) || audit.answerLog?.length || 10;
  const plausibility = assessImplausibleResult({ pct, totalSec, questionCount, completedAt, answerLog: audit.answerLog });
  const record = {
    pct,
    totalSec,
    maxStreak,
    questionCount,
    completedAt,
    ...plausibility,
    code: encodeResult(pct, totalSec, maxStreak)
  };
  store.write(`weekly:${isoWeekKey()}`, record);
  return record;
}
var API_BASE3 = "https://bxws-math.pages.dev";
function getRoomCode() {
  return store.read("roomCode", null);
}
function setRoomCode(code) {
  const trimmed = String(code ?? "").trim().slice(0, 40);
  store.write("roomCode", trimmed || null);
  return trimmed || null;
}
async function syncWeeklyResultToServer(record) {
  const roomCode = getRoomCode();
  if (!roomCode || !record) return { skipped: true };
  try {
    const res = await fetch(`${API_BASE3}/api/weekly-submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomCode,
        week: isoWeekKey(),
        deviceId: getPlayerId(),
        authToken: getDeviceToken(),
        name: getPlayerName() || "\u533F\u540D",
        pct: record.pct,
        totalSec: record.totalSec,
        maxStreak: record.maxStreak,
        questionCount: record.questionCount
      })
    });
    if (!res.ok) return { ok: false };
    return syncDeviceToken(await res.json());
  } catch {
    return { ok: false, offline: true };
  }
}
async function fetchWeeklyBoard(roomCode, week = isoWeekKey()) {
  if (!roomCode) return null;
  try {
    const res = await fetch(`${API_BASE3}/api/weekly-board?roomCode=${encodeURIComponent(roomCode)}&week=${encodeURIComponent(week)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.results ?? null;
  } catch {
    return null;
  }
}

// math-build/modules/workshop.js
var ROOM_META = {
  "num-quantity": { icon: "\u2696", title: "\u8FF7\u5BAE\u5730\u5E95\u57CE", guardian: "\u7C73\u8AFE\u9676\u6D1B\u65AF Minotaur", voice: "\u7C73\u8AFE\u9676\u6D1B\u65AF\u5B88\u8B77\u8FF7\u5BAE\u7684\u5C3A\u5EA6\uFF1A\u5148\u6A19\u55AE\u4F4D\uFF0C\u9700\u8981\u6642\u7D71\u4E00\u55AE\u4F4D\uFF0C\u518D\u4F9D\u6578\u91CF\u95DC\u4FC2\u5217\u5F0F\uFF0C\u6700\u5F8C\u7528\u4F30\u7B97\u6AA2\u67E5\u7B54\u6848\u5927\u5C0F\u3002" },
  algebra: { icon: "\u2726", title: "\u65AF\u82AC\u514B\u65AF\u795E\u6BBF", guardian: "\u65AF\u82AC\u514B\u65AF Sphinx", voice: "\u65AF\u82AC\u514B\u65AF\u4EE5\u8B0E\u8A9E\u5B88\u8B77\u672A\u77E5\uFF1A\u5148\u8A2D\u672A\u77E5\u6578\uFF0C\u4F9D\u984C\u610F\u5217\u7B49\u5F0F\uFF0C\u7B49\u865F\u5169\u908A\u505A\u76F8\u540C\u904B\u7B97\uFF0C\u89E3\u51FA\u5F8C\u4EE3\u56DE\u539F\u984C\u9A57\u7B97\u3002" },
  "space-shape": { icon: "\u{1F528}", title: "\u7368\u773C\u5DE8\u4EBA\u935B\u9020\u574A", guardian: "\u7368\u773C\u5DE8\u4EBA Cyclops", voice: "\u7368\u773C\u5DE8\u4EBA\u935B\u9020\u7CBE\u6E96\u7684\u5F62\u9AD4\uFF1A\u5148\u6A19\u51FA\u908A\u89D2\u8207\u5DF2\u77E5\u9577\u5EA6\uFF0C\u5C0D\u7167\u5B9A\u7FA9\uFF0C\u9078\u5C0D\u516C\u5F0F\u5217\u5F0F\uFF0C\u6700\u5F8C\u6AA2\u67E5\u55AE\u4F4D\u3002" },
  "relation-pattern": { icon: "\u{1F9F5}", title: "\u547D\u904B\u4E09\u5973\u795E\u7D21\u7E54\u6BBF", guardian: "\u547D\u904B\u4E09\u5973\u795E Moirai", voice: "\u547D\u904B\u4E09\u5973\u795E\u7E54\u51FA\u898F\u5F8B\uFF1A\u6392\u524D\u5E7E\u9805\uFF0C\u6BD4\u8F03\u76F8\u9130\u9805\u7684\u8B8A\u5316\uFF0C\u5BEB\u51FA\u898F\u5247\uFF0C\u518D\u4EE3\u56DE\u5DF2\u77E5\u9805\u9A57\u8B49\u3002" },
  "data-uncertainty": { icon: "\u{1F3FA}", title: "\u5FB7\u723E\u83F2\u795E\u8AED\u6BBF", guardian: "\u76AE\u5A9E\u4E9E\u8207\u5DE8\u87D2 Pythia", voice: "\u76AE\u5A9E\u4E9E\u5F9E\u773E\u591A\u53EF\u80FD\u4E2D\u8FA8\u8A8D\u5FB5\u5146\uFF1A\u5148\u78BA\u8A8D\u7E3D\u6578\u8207\u8CC7\u6599\u5206\u985E\uFF1B\u6C42\u6A5F\u7387\u6642\uFF0C\u7528\u6709\u5229\u7D50\u679C\u6578\u9664\u4EE5\u6240\u6709\u53EF\u80FD\u7D50\u679C\u6578\u3002" }
};
var clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
var manuscriptNodeIds = new Set(MANUSCRIPTS.map((item) => item.id).filter((id) => id !== "master-trial"));
var stampNodeIds = new Set(RARE_STAMPS.map((stamp) => stamp.workshop && stamp.id.startsWith("stamp-") ? stamp.id.slice(6) : null).filter(Boolean));
function roomStage(repairPct) {
  if (repairPct >= 100) return "restored";
  if (repairPct >= 34) return "mending";
  return "dusty";
}
function workshopWeeklyGoal(overallPct) {
  const current = Math.max(0, Math.min(100, Math.round(Number(overallPct) || 0)));
  if (current >= 100) return "\u672C\u9031\u5C0F\u76EE\u6A19\uFF1A\u4E94\u5EA7\u795E\u6BBF\u5DF2\u5168\u6578\u7526\u9192\uFF01";
  const remaining = 100 - current;
  if (remaining <= 5) return `\u672C\u9031\u5C0F\u76EE\u6A19\uFF1A\u4E00\u8D77\u5B8C\u6210\u6700\u5F8C ${remaining}%\uFF01`;
  return `\u672C\u9031\u5C0F\u76EE\u6A19\uFF1A\u5148\u628A\u7526\u9192\u5EA6\u63A8\u5230 ${current + 5}%`;
}
function computeWorkshop(tree2, { progress = {}, collection = {}, rareStamps = {} } = {}) {
  const rooms = tree2.strands.map((strand) => {
    const meta = ROOM_META[strand.id] ?? { icon: "\u{1F6E0}", title: strand.name };
    const nodeIds = strand.nodes.map((node) => node.id);
    if (nodeIds.length === 0) {
      return { ...meta, id: strand.id, name: strand.name, available: false, repairPct: 0, stage: "blueprint" };
    }
    const mastery = nodeIds.reduce((sum, id) => sum + clamp01(progress[id]?.masteryPct), 0) / nodeIds.length;
    const manuscriptIds = nodeIds.filter((id) => manuscriptNodeIds.has(id));
    const rareStampIds = nodeIds.filter((id) => stampNodeIds.has(id));
    const manuscript = manuscriptIds.length ? manuscriptIds.reduce((sum, id) => sum + clamp01((collection[id]?.tier ?? 0) / 2), 0) / manuscriptIds.length : 0;
    const stamps = rareStampIds.length ? rareStampIds.filter((id) => rareStamps[`stamp-${id}`]).length / rareStampIds.length : 0;
    const hasCollectibleBonus = manuscriptIds.length > 0 || rareStampIds.length > 0;
    const repairPct = Math.round((hasCollectibleBonus ? mastery * 0.7 + manuscript * 0.15 + stamps * 0.15 : mastery) * 100);
    return { ...meta, id: strand.id, name: strand.name, available: true, repairPct, stage: roomStage(repairPct) };
  });
  const activeRooms = rooms.filter((room) => room.available);
  const overallPct = activeRooms.length ? Math.round(activeRooms.reduce((sum, room) => sum + room.repairPct, 0) / activeRooms.length) : 0;
  return {
    rooms,
    overallPct,
    allRestored: activeRooms.length > 0 && activeRooms.every((room) => room.repairPct === 100)
  };
}
var WORKSHOP_STAGES = {
  dusty: { label: "\u6C89\u7761", message: "\u795E\u8AED\u5377\u8EF8\u9084\u5728\u6C89\u7761\uFF0C\u6BCF\u6B21\u7DF4\u7FD2\u90FD\u6703\u559A\u9192\u4E00\u89D2\u667A\u6167\u4E4B\u5149\u3002" },
  mending: { label: "\u7526\u9192\u4E2D", message: "\u667A\u6167\u4E4B\u5149\u5DF2\u7D93\u900F\u9032\u4F86\u4E86\uFF0C\u518D\u88DC\u9F4A\u7CBE\u901A\u3001\u881F\u5C01\u8207\u5370\u8A18\u3002" },
  restored: { label: "\u795E\u6BBF\u7526\u9192", message: "\u9019\u5EA7\u795E\u6BBF\u7684\u667A\u6167\u706B\u70AC\u5DF2\u91CD\u65B0\u9EDE\u4EAE\u3002" },
  blueprint: { label: "\u5C01\u5370\u672A\u89E3", message: "\u5F8C\u7E8C\u5B78\u7FD2\u9818\u57DF\u4E0A\u7DDA\u5F8C\uFF0C\u9019\u5EA7\u795E\u6BBF\u7684\u5C01\u5370\u6703\u89E3\u958B\u3002" }
};

// math-build/modules/challenge.js
var PREFIX = "BX2";
var REPLY_PREFIX = "XR2";
var PICK_COUNT = 5;
var SITE_SALT = "bxws-challenge-2026";
function checksum(text) {
  let hash = 2166136261;
  for (const ch of text) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  for (const ch of SITE_SALT) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 36 ** 3;
}
function checksumText(text) {
  return checksum(text).toString(36).toUpperCase().padStart(3, "0");
}
async function buildChallengeCatalog(nodeIds) {
  const results = await Promise.allSettled(nodeIds.map(loadQuestionBank));
  return results.flatMap((result, index) => result.status === "fulfilled" ? flattenBank(result.value).map((q) => ({ ...q, _nodeId: nodeIds[index] })) : []).sort((a, b) => a.id.localeCompare(b.id));
}
function encodeChallenge(questions, catalog) {
  if (questions.length !== PICK_COUNT) throw new Error("\u6311\u6230\u5305\u5FC5\u9808\u525B\u597D\u4E94\u984C");
  const indexes = questions.map((question) => catalog.findIndex((item) => item.id === question.id));
  if (indexes.some((index) => index < 0 || index >= 36 ** 2)) throw new Error("\u6311\u6230\u5305\u542B\u6709\u7121\u6CD5\u8FA8\u8B58\u7684\u984C\u76EE");
  if (new Set(indexes).size !== PICK_COUNT) throw new Error("\u6311\u6230\u5305\u984C\u76EE\u4E0D\u53EF\u91CD\u8907");
  const body = indexes.map((index) => index.toString(36).padStart(2, "0")).join("").toUpperCase();
  const week = isoWeekKey();
  return `${PREFIX}-${week}-${body}${checksumText(`${week}|${body}`)}`;
}
function decodeChallenge(code, catalog) {
  const normalized = String(code).trim().toUpperCase();
  if (/^BX-[0-9A-Z]{11}$/.test(normalized)) return { error: "too-old" };
  const match = /^BX2-(\d{4}W\d{2})-([0-9A-Z]{10})([0-9A-Z]{3})$/.exec(normalized);
  if (!match || checksumText(`${match[1]}|${match[2]}`) !== match[3]) return null;
  const indexes = match[2].match(/.{2}/g).map((chunk) => parseInt(chunk, 36));
  if (new Set(indexes).size !== PICK_COUNT || indexes.some((index) => !catalog[index])) return null;
  return indexes.map((index) => catalog[index]);
}
function questionAccuracy(questionId, progress = {}) {
  const counters = Object.values(progress).flatMap((entry) => {
    const stats = entry?.questionStats?.[questionId];
    if (stats) return [stats];
    const legacy = (entry?.attempts ?? []).filter((attempt) => attempt.questionId === questionId);
    return legacy.length > 0 ? [{
      totalAttempts: legacy.length,
      correctAttempts: legacy.filter((attempt) => attempt.correct).length
    }] : [];
  });
  const totalAttempts = counters.reduce((sum, stats) => sum + stats.totalAttempts, 0);
  if (totalAttempts === 0) return null;
  return counters.reduce((sum, stats) => sum + stats.correctAttempts, 0) / totalAttempts;
}
function encodeReply(challengeCode, pct, totalSec) {
  const challenge = String(challengeCode).trim().toUpperCase();
  const digest = checksumText(challenge);
  const score = Math.max(0, Math.min(100, Math.round(pct))).toString(36).padStart(2, "0");
  const seconds = Math.max(0, Math.min(1295, Math.round(totalSec))).toString(36).padStart(2, "0");
  const body = `${digest}${score}${seconds}`.toUpperCase();
  return `${REPLY_PREFIX}-${body}${checksumText(body)}`;
}
function decodeReply(code, challengeCode) {
  const normalized = String(code).trim().toUpperCase();
  if (/^XR-[0-9A-Z]{6}$/.test(normalized)) return { error: "too-old" };
  const match = /^XR2-([0-9A-Z]{7})([0-9A-Z]{3})$/.exec(normalized);
  if (!match || checksumText(match[1]) !== match[2]) return null;
  const expectedDigest = checksumText(String(challengeCode).trim().toUpperCase());
  if (match[1].slice(0, 3) !== expectedDigest) return null;
  const pct = parseInt(match[1].slice(3, 5), 36);
  const totalSec = parseInt(match[1].slice(5, 7), 36);
  if (pct > 100) return null;
  return { pct, totalSec };
}
function questionLabel(question) {
  return question.stem ?? question.statement ?? question.problem ?? question.question ?? question.id;
}

// math-build/modules/placement-diagnostic.js
var PLACEMENT_CHECKPOINT_IDS = [
  "add-sub-within-100",
  "fraction-equivalent",
  "decimal-mul",
  "negative-number",
  "algebra-symbol"
];
var DEFAULT_QUESTION_COUNT2 = 15;
var MIN_NODE_QUESTIONS = 3;
function hasMeaningfulProgress(progress = {}) {
  return Object.values(progress).some((entry) => entry?.mastered === true || entry?.diagnosticUnlocked === true || Number(entry?.totalAttempts) > 0 || Array.isArray(entry?.attempts) && entry.attempts.length > 0);
}
function mixedQuestionPool(bank = {}) {
  const groups = [bank.basicMastery, bank.conceptId, bank.errorDiagnosis, bank.contextApplication].map((items) => Array.isArray(items) ? items : []);
  const picked = [];
  let index = 0;
  while (groups.some((items) => items[index])) {
    groups.forEach((items) => {
      if (items[index]) picked.push(items[index]);
    });
    index += 1;
  }
  return picked;
}
async function buildPlacementDiagnostic(tree2, loadBank, questionCount = DEFAULT_QUESTION_COUNT2) {
  const nodes = tree2.strands.flatMap((strand) => strand.nodes);
  const availableIds = new Set(nodes.filter((node) => !node.contentPending).map((node) => node.id));
  const checkpointIds = PLACEMENT_CHECKPOINT_IDS.filter((id) => availableIds.has(id));
  const results = await Promise.allSettled(checkpointIds.map(async (nodeId) => ({
    nodeId,
    questions: mixedQuestionPool(await loadBank(nodeId))
  })));
  const pools = results.flatMap((result) => result.status === "fulfilled" && result.value.questions.length > 0 ? [{ ...result.value, index: 0 }] : []);
  const target = Math.max(MIN_NODE_QUESTIONS, Math.min(DEFAULT_QUESTION_COUNT2, Number(questionCount) || 0));
  const picked = [];
  while (picked.length < target && pools.some((pool) => pool.questions[pool.index])) {
    pools.forEach((pool) => {
      const question = pool.questions[pool.index];
      if (question && picked.length < target) {
        picked.push({ ...question, _placementNodeId: pool.nodeId });
      }
      pool.index += 1;
    });
  }
  if (picked.length < MIN_NODE_QUESTIONS) throw new Error("\u5FEB\u901F\u5B9A\u4F4D\u984C\u76EE\u66AB\u6642\u4E0D\u8DB3");
  return picked;
}
function roundRatio(correct, total) {
  return total === 0 ? 0 : Math.round(correct / total * 100) / 100;
}
function applyPlacementDiagnostic(progress = {}, questions = [], answers = [], nodesById = {}, completedAt = Date.now()) {
  const next = { ...progress };
  const grouped = /* @__PURE__ */ new Map();
  questions.forEach((question, index) => {
    const nodeId = question._placementNodeId;
    if (!nodeId || !nodesById[nodeId]) return;
    if (!grouped.has(nodeId)) grouped.set(nodeId, []);
    grouped.get(nodeId).push({ question, correct: answers[index] === true });
  });
  grouped.forEach((records, nodeId) => {
    const previous = next[nodeId] ?? {};
    const priorAttempts = Array.isArray(previous.attempts) ? previous.attempts : [];
    const attempts = records.map(({ question, correct }) => ({
      questionId: question.id,
      ...question.challenge ? { challenge: question.challenge } : {},
      ...question.type ? { type: question.type } : {},
      ...question.errorPath !== void 0 ? { errorPath: question.errorPath } : {},
      correct,
      msElapsed: 0,
      at: completedAt,
      placementDiagnostic: true
    }));
    const correctCount = attempts.filter((attempt) => attempt.correct).length;
    const masteryPct = roundRatio(correctCount, attempts.length);
    const threshold = masteryThresholdFor(nodesById[nodeId]);
    const passed = attempts.length >= MIN_NODE_QUESTIONS && correctCount >= Math.ceil(attempts.length * threshold);
    const priorTotal = Number.isFinite(previous.totalAttempts) ? previous.totalAttempts : priorAttempts.length;
    const priorCorrect = Number.isFinite(previous.correctAttempts) ? previous.correctAttempts : priorAttempts.filter((attempt) => attempt.correct).length;
    next[nodeId] = {
      ...previous,
      attempts: [...priorAttempts, ...attempts].slice(-50),
      totalAttempts: priorTotal + attempts.length,
      correctAttempts: priorCorrect + correctCount,
      masteryPct: previous.mastered === true ? Math.max(previous.masteryPct ?? 0, masteryPct) : masteryPct,
      mastered: previous.mastered === true || passed,
      masteryVersion: 2,
      placementDiagnostic: {
        passed,
        correctCount,
        total: attempts.length,
        completedAt
      },
      ...passed ? { masterySource: "placement-diagnostic" } : {}
    };
  });
  return next;
}

// math-build/modules/app.js
var views = {
  home: document.getElementById("view-home"),
  quiz: document.getElementById("view-quiz"),
  dashboard: document.getElementById("view-dashboard"),
  workshop: document.getElementById("view-workshop"),
  fusion: document.getElementById("view-fusion"),
  sanctuary: document.getElementById("view-sanctuary"),
  arena: document.getElementById("view-arena")
};
var tree = null;
var session = { queue: [], index: 0, node: null, mascot: null, streak: 0, streakShielded: false, maxStreak: 0, roundCorrect: 0, roundTotal: 0 };
var nextBtnEl = null;
var fusionState = { tab: "fuse", pick: [], lastResult: null };
var sanctuarySelectedPedestal = null;
var sanctuaryJustPlaced = null;
var arenaState = { strandId: null };
var TEMPLE_IMG = {
  "num-quantity": "labyrinth",
  algebra: "sphinx",
  "space-shape": "cyclops",
  "relation-pattern": "moirai",
  "data-uncertainty": "delphi"
};
var pendingTimers = /* @__PURE__ */ new Set();
var preloadedMascots = /* @__PURE__ */ new Set();
var migrationsRun = false;
var storageNoticeShown = false;
function announce(message) {
  const live = document.getElementById("quiz-live");
  if (live) live.textContent = message;
}
function showToast(message, tone2 = "success") {
  document.querySelector(".action-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = `action-toast toast-${tone2}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  const live = document.getElementById("toast-live");
  if (live) live.textContent = message;
  setTimeout(() => toast.remove(), 2200);
}
function showComboPop(streak) {
  const quizArea = document.getElementById("quiz-area");
  const card = quizArea?.querySelector(".q-card");
  if (!card) return;
  const pop = document.createElement("div");
  pop.className = "combo-pop";
  pop.setAttribute("aria-hidden", "true");
  pop.textContent = streak >= 2 ? `\u9023\u8A60 \xD7${streak}\uFF01` : "\u7B54\u5C0D \uFF0B1";
  if (streak >= 5) pop.classList.add("combo-pop-hot");
  card.appendChild(pop);
  scheduleTimer(() => pop.remove(), 850);
}
function showStreakMilestone(streak) {
  const milestone = streakMilestone(streak);
  if (!milestone) return;
  const quizArea = document.getElementById("quiz-area");
  const card = quizArea?.querySelector(".q-card");
  const celebration = document.createElement("div");
  celebration.className = `streak-celebration streak-celebration-${milestone}`;
  celebration.setAttribute("aria-live", "polite");
  celebration.textContent = milestone === 8 ? "\u2726 \u795E\u8A71\u9023\u8A60 \xD78\uFF01\u667A\u6167\u706B\u70AC\u5168\u4EAE \u2726" : `\u{1F525} \u9023\u8A60\u91CC\u7A0B\u7891 \xD7${milestone}\uFF01`;
  quizArea?.appendChild(celebration);
  card?.classList.add("streak-milestone-hit");
  scheduleTimer(() => {
    celebration.remove();
    card?.classList.remove("streak-milestone-hit");
  }, 900);
}
function showCardReveal(item, rarity = "\u666E\u901A") {
  if (!item) return;
  document.querySelector(".card-reveal-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "card-reveal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", `\u89E3\u9396${item.name}`);
  const card = document.createElement("div");
  card.className = `card-reveal ${cardRevealClass(rarity)}`;
  const rarityLabel = document.createElement("span");
  rarityLabel.className = "card-reveal-rarity";
  rarityLabel.textContent = rarity;
  const symbol = document.createElement("strong");
  symbol.textContent = item.sym;
  const title = document.createElement("h3");
  title.textContent = item.name;
  const hint = document.createElement("p");
  hint.textContent = "\u5DF2\u6536\u5165\u4F60\u7684\u6536\u85CF\uFF0C\u9EDE\u4E00\u4E0B\u7E7C\u7E8C";
  card.append(rarityLabel, symbol, title, hint);
  overlay.appendChild(card);
  const close = () => overlay.remove();
  overlay.addEventListener("click", close, { once: true });
  document.body.appendChild(overlay);
  setTimeout(close, 2200);
}
function showPerfectFusionCelebration(n) {
  document.querySelector(".perfect-fusion-overlay")?.remove();
  if (isSfxOn()) sfx.rare();
  const overlay = document.createElement("div");
  overlay.className = "perfect-fusion-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", `\u878D\u5408\u51FA\u5B8C\u5168\u6578 ${n}`);
  const card = document.createElement("div");
  card.className = "perfect-fusion-card";
  const rays = document.createElement("div");
  rays.className = "perfect-fusion-rays";
  card.appendChild(rays);
  card.appendChild(Object.assign(document.createElement("span"), { className: "perfect-fusion-badge", textContent: "\u50B3\u8AAA\u30FB\u5B8C\u5168\u6578" }));
  card.appendChild(spiritBadgeEl(n));
  card.appendChild(Object.assign(document.createElement("h3"), { textContent: `${spiritName(n)}\uFF08${n}\uFF09` }));
  const proper = divisors(n).filter((d) => d !== n);
  card.appendChild(Object.assign(document.createElement("p"), {
    className: "perfect-fusion-why",
    textContent: `${n} \u7684\u771F\u56E0\u6578 ${proper.join(" \uFF0B ")} \uFF1D ${n}\u2014\u2014\u81EA\u5DF1\u7B49\u65BC\u81EA\u5DF1\u6240\u6709\u771F\u56E0\u6578\u7684\u548C\uFF0C\u9019\u7A2E\u6578\u53EB\u300C\u5B8C\u5168\u6578\u300D\uFF0C\u8D85\u7D1A\u7A00\u6709\uFF01`
  }));
  card.appendChild(Object.assign(document.createElement("p"), { className: "perfect-fusion-tap", textContent: "\u9EDE\u4E00\u4E0B\u7E7C\u7E8C" }));
  overlay.appendChild(card);
  const close = () => overlay.remove();
  overlay.addEventListener("click", close, { once: true });
  document.body.appendChild(overlay);
  const t = window.setTimeout(() => {
    close();
    pendingTimers.delete(t);
  }, 4200);
  pendingTimers.add(t);
}
function specialFusionKind(n) {
  if (isPerfect(n)) return null;
  if (Number.isInteger(Math.sqrt(n)) && n > 1) return "square";
  const properSum = divisors(n).filter((d) => d !== n).reduce((s, d) => s + d, 0);
  if (properSum > n) return "abundant";
  return null;
}
function showSpecialFusionCelebration(n, kind) {
  document.querySelector(".special-fusion-toast")?.remove();
  if (isSfxOn()) sfx.rare();
  const root = Math.sqrt(n);
  const why = kind === "square" ? `${n} \uFF1D ${root}\xD7${root}\uFF0C\u662F\u4E00\u500B\u300C\u5E73\u65B9\u6578\u300D\uFF0C\u525B\u597D\u6392\u6210\u6B63\u65B9\u5F62\uFF01` : `${n} \u7684\u771F\u56E0\u6578\u5168\u90E8\u52A0\u8D77\u4F86\u6BD4 ${n} \u9084\u5927\uFF0C\u56E0\u6578\u8D85\u7D1A\u591A\uFF0C\u662F\u300C\u8C50\u9952\u6578\u300D\uFF01`;
  const badge = kind === "square" ? "\u7A00\u6709\u30FB\u5E73\u65B9\u6578" : "\u7A00\u6709\u30FB\u8C50\u9952\u6578";
  const el3 = document.createElement("div");
  el3.className = `special-fusion-toast special-${kind}`;
  el3.setAttribute("role", "status");
  el3.innerHTML = `<span class="special-fusion-badge">${badge}</span><strong>${spiritName(n)}\uFF08${n}\uFF09</strong><span class="special-fusion-why">${why}</span>`;
  document.body.appendChild(el3);
  scheduleTimer(() => el3.remove(), 3200);
}
function showStorageNoticeIfNeeded() {
  if (!isStorageBroken() || storageNoticeShown) return;
  storageNoticeShown = true;
  const notice = document.createElement("div");
  notice.className = "storage-notice";
  notice.role = "status";
  notice.textContent = "\u9019\u53F0\u88DD\u7F6E\u7121\u6CD5\u5132\u5B58\u9032\u5EA6\uFF08\u53EF\u80FD\u662F\u79C1\u5BC6\u700F\u89BD\u6A21\u5F0F\uFF09\uFF0C\u672C\u6B21\u7DF4\u7FD2\u4E0D\u6703\u4FDD\u7559";
  document.body.prepend(notice);
}
function scheduleTimer(callback, delay) {
  const id = setTimeout(() => {
    pendingTimers.delete(id);
    callback();
  }, delay);
  pendingTimers.add(id);
  return id;
}
function clearPendingTimers() {
  pendingTimers.forEach(clearTimeout);
  pendingTimers.clear();
}
var MASTER_TRIAL_ID = "master-trial";
var REVIEW_ID = "daily-review";
var WEEKLY_ID = "weekly-cup";
var STRATEGIES = [
  { id: "slow", name: "\u6C89\u601D\u63CF\u89E3", plain: "\u6162\u6162\u60F3", color: "--cp-blue", desc: "\u7B54\u932F\u7684\u984C\u76EE\uFF0C\u9019\u4E00\u8F2A\u6392\u5230\u968A\u5C3E\u518D\u60F3\u4E00\u6B21\u3002\u9069\u5408\u60F3\u7A69\u7A69\u5B78\u6703\u3002" },
  { id: "repair", name: "\u667A\u6167\u56DE\u6EAF", plain: "\u5148\u7DF4\u932F\u984C", color: "--cp-red", desc: "\u512A\u5148\u7DF4\u7FD2\u4E4B\u524D\u932F\u904E\u7684\u984C\u76EE\uFF0C\u7B54\u5C0D\u5C31\u628A\u5B83\u5F9E\u932F\u984C\u672C\u6E05\u6389\u3002" },
  { id: "sprint", name: "\u98DB\u7FFC\u75BE\u884C", plain: "\u9650\u6642\u6311\u6230", color: "--cp-orange", desc: "\u6BCF\u984C 20 \u79D2\u5167\u7B54\u5C0D\u8A18\u4E00\u6B21\u75BE\u884C\u3002\u8D85\u6642\u4E0D\u7B97\u932F\uFF0C\u53EA\u662F\u4E0D\u8A18\u75BE\u884C\u3002" }
];
var SPRINT_LIMIT_MS = 2e4;
var SPRINT_AUTONEXT_MS = 1200;
function showView(name) {
  const changed = !views[name]?.classList.contains("active");
  if (changed) clearPendingTimers();
  if (name !== "quiz") clearSprintTimer();
  Object.entries(views).forEach(([key, el3]) => el3.classList.toggle("active", key === name));
  const navByView = { home: "nav-home", workshop: "nav-workshop", fusion: "nav-fusion", sanctuary: "nav-sanctuary", arena: "nav-arena", dashboard: "nav-dashboard" };
  Object.values(navByView).forEach((id) => document.getElementById(id)?.removeAttribute("aria-current"));
  if (navByView[name]) document.getElementById(navByView[name])?.setAttribute("aria-current", "page");
  window.scrollTo(0, 0);
  const labels = { home: "\u795E\u8A71\u661F\u5716", quiz: "\u7DF4\u7FD2\u984C", dashboard: "\u6211\u7684\u5100\u8868\u677F", workshop: "\u5967\u6797\u5E15\u65AF\u4E94\u5EA7\u795E\u6BBF", fusion: "\u661F\u9748\u878D\u5408\u6BBF", sanctuary: "\u7E46\u601D\u8056\u6240", arena: "\u795E\u6BBF\u7AF6\u6280\u5834" };
  const heading = views[name]?.querySelector("h2");
  if (heading) {
    heading.focus({ preventScroll: true });
    announce(`\u5DF2\u9032\u5165\uFF1A${labels[name]}`);
  }
  updateNavGating();
}
function updateNavGating() {
  const brandNew = !hasMeaningfulProgress(store.read("progress", {}));
  const gated = {
    "nav-workshop": "\u5148\u5728\u795E\u8A71\u661F\u5716\u7DF4\u7FD2\uFF0C\u7CBE\u719F\u5F8C\u89E3\u9396 Boss \u6230",
    "nav-fusion": "\u5148\u7DF4\u51FA\u7CBE\u719F\u7BC0\u9EDE\uFF0C\u6703\u6389\u661F\u9748\u7D20\u6750\u958B\u59CB\u878D\u5408",
    "nav-sanctuary": "\u5148\u7CBE\u719F\u7B2C\u4E00\u500B\u7BC0\u9EDE\uFF0C\u5C31\u80FD\u958B\u59CB\u4F48\u7F6E\u8056\u6240",
    "nav-arena": "\u5148\u89E3\u9396\u7BC0\u9EDE\uFF0C\u518D\u548C\u540C\u5B78\u6BD4\u901F\u5EA6\u8207\u6B63\u78BA\u7387"
  };
  Object.entries(gated).forEach(([id, hint]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle("nav-locked", brandNew);
    if (brandNew) {
      btn.setAttribute("data-lock-hint", hint);
      btn.title = hint;
    } else {
      btn.removeAttribute("data-lock-hint");
      btn.removeAttribute("title");
    }
  });
}
function preloadMascot(variant) {
  if (!variant || preloadedMascots.has(variant)) return;
  preloadedMascots.add(variant);
  ["happy", "sad"].forEach((state) => {
    const image = new Image();
    image.src = globalThis.mathAsset(`assets/mascot/${variant}-${state}.png`);
  });
}
function makePasteButton(input) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "daily-btn paste-btn";
  button.textContent = "\u{1F4CB} \u8CBC\u4E0A";
  button.addEventListener("click", async () => {
    try {
      input.value = await navigator.clipboard.readText();
    } catch {
    }
  });
  return button;
}
function secureCodeInput(input) {
  input.autocapitalize = "characters";
  input.autocomplete = "off";
  input.spellcheck = false;
  return input;
}
function mascotVariantFor(nodeId) {
  const full = allNodes(tree).find((n) => n.id === nodeId);
  if (!full) return null;
  return tree.strandVisuals?.[full.strandId]?.mascot ?? null;
}
function strandIdForNode(nodeId) {
  return allNodes(tree).find((node) => node.id === nodeId)?.strandId ?? null;
}
function newSession(fields) {
  return {
    queue: [],
    index: 0,
    node: null,
    mascot: "davinci",
    kind: "node",
    // node | diagnostic | placement | master | review | weekly
    strategy: null,
    retryDone: 0,
    fastCount: 0,
    repairTotal: 0,
    repairedCount: 0,
    encounterIdx: -1,
    qStartAt: 0,
    elapsedTotal: 0,
    perQuestion: [],
    rareDrops: [],
    stardustEarned: 0,
    challengeCode: null,
    streak: 0,
    streakShielded: false,
    concluded: false,
    maxStreak: 0,
    roundCorrect: 0,
    roundTotal: 0,
    wasMasteredAtStart: false,
    consecutiveWrong: 0,
    mentorRetryUsed: false,
    mentorPool: [],
    ...fields
  };
}
var RESUMABLE_KINDS = /* @__PURE__ */ new Set(["node", "review"]);
function saveActiveSession(indexOffset = 0) {
  const idx = session.index + indexOffset;
  if (!session.node || !RESUMABLE_KINDS.has(session.kind) || idx >= session.queue.length) {
    if (indexOffset > 0 && RESUMABLE_KINDS.has(session.kind)) clearActiveSession();
    return;
  }
  const { qStartAt, consecutiveWrong, mentorRetryUsed, mentorPool, ...rest } = session;
  store.write("activeSession", { ...rest, index: idx, savedAt: Date.now() });
}
function clearActiveSession() {
  store.write("activeSession", null);
}
function resumeActiveSession() {
  const saved = store.read("activeSession", null);
  if (!saved || !saved.queue || saved.index >= saved.queue.length) return;
  session = { ...newSession({}), ...saved, qStartAt: 0 };
  clearActiveSession();
  showView("quiz");
  renderCurrentQuestion();
}
async function goHome() {
  const container = document.getElementById("skilltree-container");
  try {
    tree = tree ?? await loadSkillTree();
    if (!migrationsRun) {
      const fromVersion = store.read("schemaVersion", 0);
      runMigrations(fromVersion, tree);
      migrationsRun = true;
    }
    renderSkillTree(container, tree, startQuiz, startPrerequisiteDiagnostic);
    maybeShowEndgame(container);
    makePlacementEntry(container);
    const dock = document.createElement("details");
    dock.className = "home-brief-dock";
    dock.open = true;
    const summary = document.createElement("summary");
    summary.textContent = "\u4ECA\u65E5\u770B\u677F\u2014\u2014\u795E\u6BBF\u76C3\u30FB\u7E8C\u8B80\u30FB\u559A\u9192\u55AE\u30FB\u4E94\u5EA7\u795E\u6BBF";
    dock.appendChild(summary);
    const dockBody = document.createElement("div");
    dockBody.className = "home-brief-dock-body";
    dock.appendChild(dockBody);
    container.prepend(dock);
    makeWeeklyCard(dockBody);
    makeResumeCard(dockBody);
    const dailySnapshot = await makeDailyBoard(dockBody);
    makeWorkshopTeaser(dockBody);
    if (!dockBody.hasChildNodes()) dock.remove();
    makeTodayFirstStep(container, dailySnapshot.dueCount);
    showView("home");
    maybeShowOnboardingTip(dailySnapshot.dueCount);
  } catch {
    container.innerHTML = "";
    const errorCard = document.createElement("div");
    errorCard.className = "load-error-card";
    errorCard.textContent = "\u984C\u5EAB\u8F09\u5165\u5931\u6557\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406";
    container.appendChild(errorCard);
    showView("home");
  } finally {
    showStorageNoticeIfNeeded();
  }
}
function makePlacementEntry(container) {
  if (hasMeaningfulProgress(store.read("progress", {}))) return;
  const card = document.createElement("section");
  card.className = "placement-entry";
  const copy = document.createElement("div");
  copy.innerHTML = "<strong>\u7B2C\u4E00\u6B21\u4F86\uFF0C\u4E0D\u5FC5\u5F9E\u982D\u6162\u6162\u5237</strong><span>\u7528\u8DE8\u5E74\u7D1A\u984C\u76EE\u627E\u5230\u6700\u63A5\u8FD1\u4F60\u7684\u8D77\u9EDE\uFF0C\u7B54\u5C0D\u7684\u6280\u80FD\u6703\u4F9D\u5B9A\u4F4D\u7D50\u679C\u63D0\u65E9\u9EDE\u4EAE\u3002</span>";
  const button = document.createElement("button");
  button.className = "q-next placement-start";
  button.textContent = "\u4E0D\u77E5\u9053\u5F9E\u54EA\u958B\u59CB\uFF1F\u5148\u505A 5 \u5206\u9418\u5B9A\u4F4D\u6E2C\u9A57";
  button.addEventListener("click", startPlacementDiagnostic);
  card.append(copy, button);
  container.prepend(card);
}
async function makeDailyBoard(container) {
  const nodeIds = allNodes(tree).filter((n) => isNodePlayable(n, tree)).map((n) => n.id);
  const dueCount = nodeIds.length > 0 ? await countDueReviews(nodeIds) : 0;
  const errorCount = listWrongQuestions().length;
  const daily = getDaily();
  const tasks = dailyTasks(daily, { dueCount, errorCount });
  const justInked = maybeDropInk(tasks);
  const allDone = tasks.every((t) => t.satisfied);
  const lastPlayed = store.read("lastPlayed", null);
  const welcome = returningWelcome(lastPlayed, dueCount);
  const activityStreak = store.read("activityStreak", { count: 0, lastDate: null });
  const board = document.createElement("div");
  board.className = "daily-board" + (allDone ? " daily-done" : "");
  const title = document.createElement("div");
  title.className = "daily-title";
  title.textContent = allDone ? "\u4ECA\u65E5\u559A\u9192\u55AE\uFF1A\u5B8C\u6210\uFF01\u4ECA\u665A\u7684\u661F\u5149\u5168\u4EAE\u4E86" : welcome.headline;
  board.appendChild(title);
  board.appendChild(Object.assign(document.createElement("div"), {
    className: "activity-streak-home",
    textContent: `\u{1F525} \u7D2F\u8A08\u7DF4\u7FD2 ${activityStreak.count} \u5929`
  }));
  const list = document.createElement("div");
  list.className = "daily-tasks";
  tasks.forEach((t) => {
    const row = document.createElement("div");
    row.className = "daily-task" + (t.satisfied ? " task-done" : "");
    const mark = t.satisfied ? "\u2611" : "\u2610";
    const progress = t.satisfied ? "" : `\uFF08${Math.min(t.done, t.target)}/${t.target}\uFF09`;
    row.textContent = `${mark} ${t.label}${progress}`;
    list.appendChild(row);
  });
  board.appendChild(list);
  const actions = document.createElement("div");
  actions.className = "daily-actions";
  if (dueCount > 0) {
    const btn = document.createElement("button");
    btn.className = "daily-btn";
    btn.textContent = `\u2728 \u4E00\u9375\u6CE8\u5149\uFF08${Math.min(dueCount, 6)} \u984C\uFF09`;
    btn.addEventListener("click", startReviewSession);
    actions.appendChild(btn);
  }
  const ink = document.createElement("span");
  ink.className = "ink-bottle";
  ink.textContent = `\u{1FAD9} \u661F\u5C51\uFF1A\u53EF\u7528 ${stardustBalance()} \u7C92\uFF08\u7D2F\u8A08 ${getStardustCount()} \u7C92\uFF09`;
  actions.appendChild(ink);
  board.appendChild(actions);
  const milestones = claimStardustMilestones(getStardustCount());
  if (milestones.newlyUnlocked.length > 0) {
    sfx.rare();
    board.appendChild(Object.assign(document.createElement("div"), {
      className: "stardust-milestone-celebration",
      textContent: `\u2726 \u661F\u5C51\u91CC\u7A0B\u7891\uFF1A\u74F6\u4E2D\u5DF2\u805A\u96C6 ${milestones.newlyUnlocked.at(-1)} \u7C92\u661F\u5149\uFF01`
    }));
  }
  if (allDone) {
    const stamp = document.createElement("div");
    stamp.className = "daily-stamp" + (justInked ? " stamp-fresh" : "");
    stamp.textContent = "\u559A\u9192\u7AE0";
    board.appendChild(stamp);
  }
  if (lastPlayed) {
    const days = Math.floor((Date.now() - lastPlayed.at) / 864e5);
    const when = days === 0 ? "\u4ECA\u5929" : `${days} \u5929\u524D`;
    const line = document.createElement("div");
    line.className = "daily-lastplayed";
    line.textContent = `\u4E0A\u6B21\u7DF4\u7FD2\uFF1A${when} \xB7 ${lastPlayed.nodeName}`;
    board.appendChild(line);
  }
  container.prepend(board);
  return { dueCount, welcome };
}
function makeTodayFirstStep(container, dueCount) {
  const saved = store.read("activeSession", null);
  let label;
  let sub;
  if (saved?.queue && saved.index < saved.queue.length) {
    label = "\u25B6 \u7E7C\u7E8C\u4E0A\u6B21\u7684\u7DF4\u7FD2";
    sub = `\u9084\u5269 ${saved.queue.length - saved.index} \u984C`;
  } else if (dueCount > 0) {
    label = "\u{1F4D6} \u8907\u7FD2\u4ECA\u5929\u5230\u671F\u7684\u984C\u76EE";
    sub = `\u6709 ${dueCount} \u984C\u8A72\u8907\u7FD2\u4E86`;
  } else {
    const rec = recommendedNextNode(tree);
    label = "\u2726 \u958B\u59CB\u4ECA\u5929\u7684\u7DF4\u7FD2";
    sub = rec ? `\u63A8\u85A6\uFF1A${rec.name}` : "\u6311\u4E00\u9846\u661F\u5716\u7BC0\u9EDE\u958B\u59CB";
  }
  const button = document.createElement("button");
  button.className = "home-hero-action";
  button.appendChild(Object.assign(document.createElement("span"), { className: "hero-action-label", textContent: label }));
  button.appendChild(Object.assign(document.createElement("span"), { className: "hero-action-sub", textContent: sub }));
  button.addEventListener("click", () => takeTodayFirstStep(dueCount));
  container.prepend(button);
}
async function takeTodayFirstStep(dueCount) {
  const saved = store.read("activeSession", null);
  if (saved?.queue && saved.index < saved.queue.length) {
    resumeActiveSession();
    return;
  }
  if (dueCount > 0) {
    await startReviewSession();
    return;
  }
  const recommended = recommendedNextNode(tree);
  if (!recommended) return;
  const lastStrategy = store.read("lastStrategy", null);
  if (lastStrategy === null) {
    startQuiz(recommended);
    return;
  }
  await startQuizWithStrategy(recommended, lastStrategy);
}
function workshopSnapshot() {
  return computeWorkshop(tree, {
    progress: store.read("progress", {}),
    collection: getCollection(),
    rareStamps: getRareStamps()
  });
}
function makeWorkshopTeaser(container) {
  const workshop = workshopSnapshot();
  const card = document.createElement("button");
  card.className = "workshop-teaser";
  card.innerHTML = `<span>\u{1F3DB}</span><strong>\u4E94\u5EA7\u795E\u6BBF\u7526\u9192\u8A08\u756B</strong><span>${workshop.overallPct}% \u7526\u9192</span>`;
  card.addEventListener("click", showWorkshop);
  container.prepend(card);
}
async function navigateToStrand(strandId) {
  await goHome();
  const strand = document.querySelector(`.strand[data-strand-id="${strandId}"]`);
  if (!strand) return;
  strand.classList.remove("strand-highlight");
  requestAnimationFrame(() => strand.classList.add("strand-highlight"));
  strand.scrollIntoView({ block: "start", behavior: "smooth" });
  scheduleTimer(() => strand.classList.remove("strand-highlight"), 1800);
  strand.querySelector(".strand-name")?.setAttribute("tabindex", "-1");
  strand.querySelector(".strand-name")?.focus({ preventScroll: true });
  announce(`\u5DF2\u5B9A\u4F4D\u5230${strand.querySelector(".strand-name")?.textContent ?? "\u5C0D\u61C9\u9818\u5730"}`);
}
async function showWorkshop() {
  tree = tree ?? await loadSkillTree();
  const workshop = workshopSnapshot();
  if (workshop.allRestored) unlockBadge("workshop-friend");
  const root = document.getElementById("workshop-content");
  root.innerHTML = "";
  const hero = document.createElement("section");
  hero.className = `workshop-hero${workshop.allRestored ? " workshop-complete" : ""}`;
  const kicker = document.createElement("div");
  kicker.className = "workshop-kicker";
  kicker.textContent = "\u6BCF\u4E00\u5377\u4F60\u8B80\u61C2\u7684\u795E\u8AED\uFF0C\u90FD\u5728\u559A\u9192\u4E00\u5EA7\u6C89\u7761\u7684\u795E\u6BBF\u3002";
  const heading = document.createElement("h2");
  heading.textContent = workshop.allRestored ? "\u5967\u6797\u5E15\u65AF\u4E94\u5EA7\u795E\u6BBF\u30FB\u5168\u6578\u7526\u9192" : "\u4E94\u5EA7\u795E\u6BBF\u7526\u9192\u8A08\u756B";
  const meter = document.createElement("div");
  meter.className = "workshop-meter";
  const meterFill = document.createElement("span");
  meterFill.style.width = `${Number(workshop.overallPct) || 0}%`;
  meter.appendChild(meterFill);
  const weeklyGoal = document.createElement("div");
  weeklyGoal.className = "workshop-weekly-goal";
  weeklyGoal.textContent = workshopWeeklyGoal(workshop.overallPct);
  const intro = document.createElement("p");
  intro.textContent = `\u76EE\u524D\u4E94\u5EA7\u795E\u6BBF\u7E3D\u7526\u9192\u5EA6\u70BA ${Number(workshop.overallPct) || 0}%\u3002\u7CBE\u901A\u795E\u8AED\u5377\u8EF8\u3001\u53D6\u5F97\u5370\u8A18\uFF0C\u5967\u6797\u5E15\u65AF\u7684\u667A\u6167\u4E4B\u5149\u5C31\u6703\u4E00\u5C64\u5C64\u56DE\u4F86\u3002`;
  hero.append(kicker, heading, meter, weeklyGoal, intro);
  if (workshop.allRestored) {
    const finale = document.createElement("div");
    finale.className = "workshop-finale";
    finale.textContent = "\u2726 \u4E94\u5EA7\u795E\u6BBF\u4F9D\u5E8F\u7526\u9192\uFF0C\u96C5\u5178\u5A1C\u5C07\u4F60\u7684\u540D\u5B57\u523B\u5165\u300C\u5967\u6797\u5E15\u65AF\u667A\u8005\u9304\u300D\u3002\u9019\u7247\u795E\u8A71\u9818\u5730\uFF0C\u4E5F\u6709\u4E86\u4F60\u5B88\u8B77\u7684\u4E00\u5E2D\u4E4B\u5730\u3002";
    hero.appendChild(finale);
  }
  root.appendChild(hero);
  const grid = document.createElement("div");
  grid.className = "workshop-grid";
  workshop.rooms.forEach((room) => {
    const stage = WORKSHOP_STAGES[room.stage];
    const card = document.createElement("article");
    card.className = `workshop-room room-${room.stage}`;
    card.dataset.strandId = room.id;
    card.tabIndex = 0;
    card.role = "link";
    card.setAttribute("aria-label", `\u524D\u5F80\u795E\u8A71\u661F\u5716\u7684${room.title}`);
    card.addEventListener("click", () => navigateToStrand(room.id));
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      navigateToStrand(room.id);
    });
    const scene = document.createElement("div");
    scene.className = "room-scene";
    scene.appendChild(Object.assign(document.createElement("span"), { textContent: room.icon }));
    const copy = document.createElement("div");
    copy.className = "room-copy";
    const roomStage2 = document.createElement("div");
    roomStage2.className = "room-stage";
    roomStage2.textContent = stage.label;
    const roomTitle = document.createElement("h3");
    roomTitle.textContent = room.title;
    const roomGuardian = document.createElement("div");
    roomGuardian.className = "room-guardian";
    roomGuardian.textContent = `\u5B88\u8B77\u8005\uFF1A${room.guardian}`;
    const roomMessage = document.createElement("p");
    roomMessage.textContent = stage.message;
    const roomMeter = document.createElement("div");
    roomMeter.className = "room-meter";
    const roomFill = document.createElement("span");
    roomFill.style.width = `${Number(room.repairPct) || 0}%`;
    roomMeter.appendChild(roomFill);
    const roomScore = document.createElement("strong");
    roomScore.textContent = room.available ? `${Number(room.repairPct) || 0}%` : "\u5F85\u958B\u653E";
    copy.append(roomStage2, roomTitle, roomGuardian, roomMessage, roomMeter, roomScore);
    if (room.available && bossFor(room.id)) {
      const strand = tree.strands.find((s) => s.id === room.id);
      const gate = bossGate(strand, store.read("progress", {}), tree.masteryThreshold ?? 0.8);
      const bossBtn = document.createElement("button");
      bossBtn.type = "button";
      bossBtn.className = "boss-challenge-btn" + (gate.eligible ? "" : " boss-challenge-btn-locked");
      bossBtn.disabled = !gate.eligible;
      bossBtn.textContent = gate.eligible ? `\u2694 \u6311\u6230${bossFor(room.id).name}` : `\u{1F512} \u7CBE\u719F\u5EA6\u9054 ${Math.round((tree.masteryThreshold ?? 0.8) * 100)}% \u89E3\u9396\u795E\u6BBF\u8A66\u7149`;
      bossBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        startBossFight(room.id);
      });
      bossBtn.addEventListener("keydown", (event) => event.stopPropagation());
      copy.appendChild(bossBtn);
    }
    if (room.available) {
      const pvpStrand = tree.strands.find((s) => s.id === room.id);
      const pvpHasPlayable = (pvpStrand?.nodes ?? []).some((n) => isNodePlayable(n, tree));
      const pvpWrap = document.createElement("div");
      pvpWrap.className = "pvp-challenge-wrap";
      const seedInput = document.createElement("input");
      seedInput.type = "text";
      seedInput.inputMode = "numeric";
      seedInput.placeholder = "\u6311\u6230\u78BC\uFF08\u7559\u7A7A\u81EA\u52D5\u7522\u751F\uFF09";
      seedInput.className = "pvp-seed-input";
      seedInput.addEventListener("click", (event) => event.stopPropagation());
      seedInput.addEventListener("keydown", (event) => event.stopPropagation());
      const pvpBtn = document.createElement("button");
      pvpBtn.type = "button";
      pvpBtn.className = "pvp-challenge-btn";
      pvpBtn.disabled = !pvpHasPlayable;
      pvpBtn.textContent = pvpHasPlayable ? "\u{1F3B2} \u6311\u6230\u66F8\uFF0810 \u984C\u672C\u6A5F\u6BD4\u5206\uFF09" : "\u{1F512} \u5148\u89E3\u9396\u6B64\u795E\u6BBF\u81F3\u5C11\u4E00\u7BC0\u9EDE";
      pvpBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        startPvpChallenge(room.id, seedInput.value.trim());
      });
      pvpWrap.append(seedInput, pvpBtn);
      pvpWrap.appendChild(Object.assign(document.createElement("p"), {
        className: "score-disclosure",
        textContent: "\u6311\u6230\u66F8\u662F\u672C\u6A5F\u7D00\u9304\u3001\u548C\u540C\u5B78\u53E3\u982D\u6BD4\u5206\uFF0C\u672A\u7D93\u4F3A\u670D\u5668\u9A57\u8B49\uFF0C\u540C\u4E00\u7D44\u6311\u6230\u78BC\u624D\u662F\u540C\u4E00\u4EFD\u984C\u76EE\u3002"
      }));
      copy.appendChild(pvpWrap);
    }
    card.append(scene, copy);
    grid.appendChild(card);
  });
  root.appendChild(grid);
  showView("workshop");
}
async function startReviewSession() {
  const nodeIds = allNodes(tree).filter((n) => isNodePlayable(n, tree)).map((n) => n.id);
  const queue = await buildReviewSession(nodeIds, 6);
  if (queue.length === 0) return;
  session = newSession({
    queue,
    node: { id: REVIEW_ID, name: "\u4ECA\u65E5\u6CE8\u5149" },
    mascot: "davinci",
    kind: "review",
    encounterIdx: Math.random() < 0.35 ? Math.floor(Math.random() * queue.length) : -1
  });
  showView("quiz");
  renderCurrentQuestion();
}
function makeResumeCard(container) {
  const saved = store.read("activeSession", null);
  if (!saved || !saved.queue || saved.index >= saved.queue.length) return;
  const card = document.createElement("div");
  card.className = "resume-card";
  const text = document.createElement("div");
  text.textContent = `\u4E0A\u6B21\u7684\u795E\u8AED\u5377\u8EF8\u9084\u6524\u5728\u684C\u4E0A\u2014\u2014${saved.node.name} \xB7 \u7B2C ${saved.index + 1}/${saved.queue.length} \u984C`;
  card.appendChild(text);
  const go = document.createElement("button");
  go.className = "daily-btn";
  go.textContent = "\u63A5\u8457\u559A\u9192";
  go.addEventListener("click", resumeActiveSession);
  const drop = document.createElement("button");
  drop.className = "daily-btn resume-drop";
  drop.textContent = "\u91CD\u65B0\u958B\u59CB";
  drop.addEventListener("click", () => {
    clearActiveSession();
    card.remove();
  });
  card.appendChild(go);
  card.appendChild(drop);
  container.prepend(card);
}
function makeWeeklyCard(container) {
  const card = document.createElement("div");
  card.className = "weekly-card";
  const best = getWeeklyBest();
  const title = document.createElement("div");
  title.className = "weekly-title";
  title.textContent = `\u{1F3C6} \u672C\u9031\u795E\u6BBF\u76C3 ${isoWeekKey()}\u2014\u2014\u5168\u73ED\u540C\u4E00\u5957\u984C\uFF0C\u6562\u4F86\u55CE\uFF1F`;
  card.appendChild(title);
  card.appendChild(Object.assign(document.createElement("p"), {
    className: "score-disclosure",
    textContent: "\u9019\u88E1\u662F\u5B78\u751F\u81EA\u884C\u56DE\u5831\u6210\u7E3E\uFF0C\u672A\u7D93\u4F3A\u670D\u5668\u9A57\u8B49\uFF1B\u6A19\u8A18\u50C5\u4F9B\u6559\u5E2B\u8207\u5BB6\u9577\u6C7A\u5B9A\u662F\u5426\u8907\u9A57\u3002"
  }));
  if (best) {
    const mine = document.createElement("div");
    mine.className = "weekly-best";
    mine.textContent = `\u6211\u7684\u6700\u4F73\uFF1A${best.pct}%\u30FB${best.totalSec} \u79D2\u30FB\u9023\u8A60 ${best.maxStreak}${best.flagged ? `\u30FB${best.flagLabel}` : ""}`;
    card.appendChild(mine);
    const codeRow = document.createElement("div");
    codeRow.className = "weekly-code-row";
    const code = document.createElement("code");
    code.textContent = best.code;
    codeRow.appendChild(code);
    const copy = document.createElement("button");
    copy.className = "daily-btn";
    copy.textContent = "\u8907\u88FD\u6230\u7E3E\u795E\u8AED";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(best.code);
        copy.textContent = "\u5DF2\u8907\u88FD\uFF01";
        scheduleTimer(() => copy.textContent = "\u8907\u88FD\u6230\u7E3E\u795E\u8AED", 1500);
      } catch {
      }
    });
    codeRow.appendChild(copy);
    card.appendChild(codeRow);
  }
  const actions = document.createElement("div");
  actions.className = "daily-actions";
  const go = document.createElement("button");
  go.className = "daily-btn weekly-go";
  go.textContent = best ? "\u2694 \u518D\u6230\u4E00\u5834\uFF08\u5237\u65B0\u7D00\u9304\uFF09" : "\u2694 \u958B\u6253\uFF0810 \u984C\u8A08\u6642\uFF09";
  go.addEventListener("click", startWeeklySession);
  actions.appendChild(go);
  card.appendChild(actions);
  const cmp = document.createElement("div");
  cmp.className = "weekly-compare";
  const compareLabel = document.createElement("label");
  compareLabel.htmlFor = "weekly-compare-code";
  compareLabel.textContent = "\u540C\u5B78\u7684\u6230\u7E3E\u795E\u8AED";
  const input = document.createElement("input");
  input.id = "weekly-compare-code";
  input.type = "text";
  input.placeholder = "\u4F8B\u5982\uFF1A2026W29-V2\u2026";
  secureCodeInput(input);
  const result = document.createElement("div");
  result.className = "weekly-compare-result";
  const btn = document.createElement("button");
  btn.className = "daily-btn";
  btn.textContent = "\u6BD4\u4E00\u6BD4";
  btn.addEventListener("click", () => {
    const other = decodeResult(input.value);
    if (!other) {
      result.textContent = "\u9019\u7D44\u6230\u7E3E\u795E\u8AED\u770B\u4E0D\u61C2\uFF0C\u518D\u6838\u5C0D\u4E00\u6B21\uFF1F";
      return;
    }
    if (other.error === "too-old") {
      result.textContent = "\u9019\u7D44\u6230\u7E3E\u795E\u8AED\u683C\u5F0F\u592A\u820A\uFF0C\u8ACB\u540C\u5B78\u91CD\u65B0\u6253\u4E00\u5834\u7522\u751F\u65B0\u7248\u795E\u8AED\u3002";
      return;
    }
    if (other.week !== isoWeekKey()) {
      result.textContent = `\u9019\u662F ${other.week} \u7684\u820A\u6230\u7E3E\u795E\u8AED\uFF0C\u672C\u9031\u662F ${isoWeekKey()}\u3002`;
      return;
    }
    const mineBest = getWeeklyBest();
    if (!mineBest) {
      result.textContent = `\u5C0D\u65B9 ${other.pct}%\u30FB${other.totalSec} \u79D2\u3002\u4F60\u9084\u6C92\u51FA\u8CFD\u2014\u2014\u5148\u6253\u4E00\u5834\uFF01`;
      return;
    }
    const win = mineBest.pct > other.pct || mineBest.pct === other.pct && mineBest.totalSec < other.totalSec;
    const tie = mineBest.pct === other.pct && mineBest.totalSec === other.totalSec;
    result.textContent = tie ? `\u5E73\u624B\uFF01\u96D9\u65B9\u90FD\u662F ${other.pct}%\u30FB${other.totalSec} \u79D2\u3002` : win ? `\u4F60\u8D0F\u4E86\uFF01${mineBest.pct}%\u30FB${mineBest.totalSec}s vs \u5C0D\u65B9 ${other.pct}%\u30FB${other.totalSec}s` : `\u5C0D\u65B9\u9818\u5148\uFF1A${other.pct}%\u30FB${other.totalSec}s vs \u4F60 ${mineBest.pct}%\u30FB${mineBest.totalSec}s\u2014\u2014\u518D\u6230\u4E00\u5834\u8A0E\u56DE\u4F86\uFF01`;
  });
  cmp.appendChild(compareLabel);
  cmp.appendChild(input);
  cmp.appendChild(makePasteButton(input));
  cmp.appendChild(btn);
  cmp.appendChild(result);
  card.appendChild(cmp);
  const roomBox = document.createElement("div");
  roomBox.className = "room-sync-box";
  const roomLabel = document.createElement("label");
  roomLabel.htmlFor = "room-code-input";
  roomLabel.textContent = "\u73ED\u7D1A\u4EE3\u78BC\uFF08\u540C\u4EE3\u78BC\u7684\u4EBA\u6703\u51FA\u73FE\u5728\u540C\u4E00\u5F35\u771F\u6392\u884C\u699C\uFF09";
  const roomInput = document.createElement("input");
  roomInput.id = "room-code-input";
  roomInput.type = "text";
  roomInput.maxLength = 40;
  roomInput.placeholder = "\u4F8B\u5982\uFF1A301\u73ED";
  roomInput.value = getRoomCode() || "";
  const roomSyncBtn = document.createElement("button");
  roomSyncBtn.className = "daily-btn";
  roomSyncBtn.textContent = "\u540C\u6B65\u771F\u6392\u884C\u699C";
  const roomOutput = document.createElement("div");
  roomOutput.className = "room-sync-output";
  roomSyncBtn.addEventListener("click", async () => {
    const code = setRoomCode(roomInput.value);
    if (!code) {
      roomOutput.textContent = "\u8ACB\u5148\u8F38\u5165\u73ED\u7D1A\u4EE3\u78BC";
      return;
    }
    roomOutput.textContent = "\u540C\u6B65\u4E2D\u2026";
    const results = await fetchWeeklyBoard(code, isoWeekKey());
    if (!results) {
      roomOutput.textContent = "\u66AB\u6642\u9023\u4E0D\u4E0A\u4F3A\u670D\u5668\uFF0C\u6539\u7528\u4E0B\u65B9\u624B\u52D5\u8CBC\u4E0A\u6A21\u5F0F\u5427";
      return;
    }
    roomOutput.innerHTML = "";
    const note = document.createElement("p");
    note.className = "score-disclosure";
    note.textContent = "\u2705 \u5DF2\u4F3A\u670D\u5668\u540C\u6B65\uFF08\u540C\u73ED\u540C\u4EE3\u78BC\u5373\u6642\u53EF\u898B\uFF09";
    roomOutput.appendChild(note);
    if (results.length === 0) {
      roomOutput.appendChild(Object.assign(document.createElement("p"), { textContent: "\u9019\u500B\u4EE3\u78BC\u672C\u9031\u9084\u6C92\u6709\u4EBA\u4EA4\u51FA\u6210\u7E3E" }));
    } else {
      const list = document.createElement("ol");
      results.forEach((entry) => {
        const row = document.createElement("li");
        row.textContent = `${entry.name}\u30FB${entry.pct}%\u30FB${entry.totalSec} \u79D2\u30FB\u9023\u8A60 ${entry.maxStreak}${entry.flagged ? "\u30FB\u26A0\uFE0F \u5EFA\u8B70\u8907\u9A57" : ""}`;
        if (entry.flagged) row.title = entry.flagReasons.join("\u3001");
        list.appendChild(row);
      });
      roomOutput.appendChild(list);
    }
  });
  roomBox.append(roomLabel, roomInput, roomSyncBtn, roomOutput);
  card.appendChild(roomBox);
  const wall = document.createElement("div");
  wall.className = "class-leaderboard-wall";
  const wallLabel = document.createElement("label");
  wallLabel.htmlFor = "class-result-codes";
  wallLabel.textContent = "\u73ED\u7D1A\u6230\u7E3E\u7246\uFF08\u624B\u52D5\u8CBC\u4E0A\u6A21\u5F0F\u30FB\u96E2\u7DDA\u5099\u63F4\uFF09";
  const textarea = document.createElement("textarea");
  textarea.id = "class-result-codes";
  textarea.rows = 5;
  textarea.placeholder = "\u6BCF\u884C\u8F38\u5165\uFF1A\u59D3\u540D,\u6230\u7E3E\u795E\u8AED\uFF08\u4E5F\u53EF\u7528\u7A7A\u767D\u5206\u9694\uFF1B\u820A\u7684\u7D14\u795E\u8AED\u4ECD\u53EF\u7528\uFF09";
  secureCodeInput(textarea);
  const renderWall = document.createElement("button");
  renderWall.className = "daily-btn";
  renderWall.textContent = "\u6392\u51FA\u73ED\u7D1A\u6230\u7E3E";
  const wallOutput = document.createElement("div");
  wallOutput.className = "class-leaderboard-output";
  renderWall.addEventListener("click", () => {
    const parsed = decodeClassResults(textarea.value);
    wallOutput.innerHTML = "";
    const list = document.createElement("ol");
    parsed.results.forEach((entry) => {
      const row = document.createElement("li");
      const studentLabel = entry.name || `\u7B2C ${entry.lineNumber} \u884C`;
      row.textContent = `${studentLabel}\u30FB${entry.pct}%\u30FB${entry.totalSec} \u79D2\u30FB\u9023\u8A60 ${entry.maxStreak}${entry.flagged ? `\u30FB${entry.flagLabel}` : ""}`;
      if (entry.flagged) row.title = entry.reasons.join("\u3001");
      list.appendChild(row);
    });
    if (parsed.results.length > 0) wallOutput.appendChild(list);
    else wallOutput.appendChild(Object.assign(document.createElement("p"), { textContent: "\u9084\u6C92\u6709\u53EF\u8FA8\u8B58\u7684\u6230\u7E3E" }));
    if (parsed.invalidCount > 0) {
      wallOutput.appendChild(Object.assign(document.createElement("p"), {
        className: "class-leaderboard-invalid",
        textContent: `\u6709 ${parsed.invalidCount} \u884C\u7121\u6CD5\u8FA8\u8B58`
      }));
    }
  });
  wall.append(wallLabel, textarea, renderWall, wallOutput);
  card.appendChild(wall);
  container.prepend(card);
}
async function startWeeklySession() {
  const nodeIds = allNodes(tree).filter((n) => !n.contentPending).map((n) => n.id);
  session = newSession({
    queue: await buildWeeklySession(nodeIds, 10),
    node: { id: WEEKLY_ID, name: `\u672C\u9031\u795E\u6BBF\u76C3 ${isoWeekKey()}` },
    mascot: "gauss",
    kind: "weekly"
  });
  showView("quiz");
  renderCurrentQuestion();
}
function maybeShowEndgame(container) {
  const overview = computeOverview(tree);
  if (overview.masteredCount < overview.totalNodes) return;
  const records = store.read("masterTrialTiers", {});
  const tiers = masterTrialTierState(records);
  const banner = document.createElement("div");
  banner.className = "endgame-banner" + (tiers.some((tier) => tier.cleared) ? " endgame-cleared" : "");
  banner.innerHTML = `<div class="endgame-title">\u6574\u7247\u795E\u8A71\u661F\u5716\u90FD\u9EDE\u4EAE\u4E86\uFF01\u8CE2\u8005\u8A66\u7149\u73FE\u5728\u6709\u9285\u3001\u9280\u3001\u91D1\u4E09\u968E\u53EF\u6301\u7E8C\u6311\u6230\u3002</div>`;
  tiers.forEach((tier) => {
    const btn = document.createElement("button");
    btn.className = "q-next";
    btn.disabled = !tier.unlocked;
    btn.textContent = tier.unlocked ? `${tier.cleared ? "\u2713" : "\u2694"} ${tier.name}\u30FB${tier.questionCount} \u984C\u30FB${Math.round(tier.passPct * 100)}% \u904E\u95DC\u30FB\u9996\u901A ${tier.reward.stardust} \u661F\u5C51` : `\u{1F512} ${tier.name}\uFF08\u5148\u901A\u904E${MASTER_TRIAL_TIERS.find((item) => item.id === tier.requires)?.name}\uFF09`;
    if (tier.unlocked) btn.addEventListener("click", () => startMasterTrial(tier.id));
    banner.appendChild(btn);
  });
  container.prepend(banner);
}
async function startMasterTrial(tierId = "bronze") {
  const tier = masterTrialTierState(store.read("masterTrialTiers", {})).find((item) => item.id === tierId);
  if (!tier?.unlocked) return;
  const nodeIds = allNodes(tree).filter((n) => !n.contentPending).map((n) => n.id);
  session = newSession({
    queue: await buildMasterSession(nodeIds, tier.questionCount),
    node: { id: MASTER_TRIAL_ID, name: tier.name },
    mascot: "davinci",
    kind: "master",
    trialTier: tier.id
  });
  showView("quiz");
  renderCurrentQuestion();
}
var sprintInterval = null;
function clearSprintTimer() {
  if (sprintInterval) {
    clearInterval(sprintInterval);
    sprintInterval = null;
  }
  document.getElementById("quiz-timer")?.remove();
}
function startSprintTimer() {
  clearSprintTimer();
  const el3 = document.createElement("div");
  el3.id = "quiz-timer";
  el3.className = "quiz-timer";
  document.getElementById("quiz-progressbar").after(el3);
  const deadline = Date.now() + SPRINT_LIMIT_MS;
  let lastShown = null;
  const tick = () => {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1e3));
    if (left > 0) {
      const settings = getAccessibilitySettings();
      el3.textContent = settings.sprintWarning ? `\u23F1 \u75BE\u7B46\u5012\u6578 ${left} \u79D2` : `\u23F1 \u6311\u6230\u81EA\u5DF1\u30FB\u7D04 ${left} \u79D2`;
      el3.classList.toggle("timer-hot", settings.sprintWarning && left <= 5);
      if (settings.sprintWarning && left <= 5 && left !== lastShown) sfx.tick();
      lastShown = left;
    } else {
      el3.textContent = "\u8D85\u6642\u4E86\uFF1F\u6C92\u95DC\u4FC2\uFF0C\u9019\u984C\u6162\u6162\u60F3\uFF0C\u53EA\u662F\u4E0D\u8A18\u75BE\u7B46";
      el3.classList.remove("timer-hot");
      clearInterval(sprintInterval);
      sprintInterval = null;
    }
  };
  tick();
  sprintInterval = setInterval(tick, 250);
}
function maybeShowOnboardingTip(dueCount = 0) {
  if (store.read("seenTip", false)) return;
  const activeSession = store.read("activeSession", null);
  const lastStrategy = store.read("lastStrategy", null);
  const noStrategy = store.read("lastStrategy", null) === null;
  const isBrandNew = !activeSession && dueCount === 0 && lastStrategy === null;
  if (isBrandNew && noStrategy) {
    const steps = [
      { title: "1 / 3\u30FB\u4ECA\u65E5\u770B\u677F", text: "\u4ECA\u65E5\u770B\u677F\u6703\u986F\u793A\u5230\u671F\u8907\u7FD2\u3001\u672C\u65E5\u4EFB\u52D9\u3001\u795E\u6BBF\u76C3\u8207\u4E94\u5EA7\u795E\u6BBF\u9032\u5EA6\uFF1B\u5B83\u5DF2\u9810\u8A2D\u5C55\u958B\u3002" },
      { title: "2 / 3\u30FB\u4ECA\u65E5\u7B2C\u4E00\u6B65", text: "\u9996\u9801\u6700\u4E0A\u65B9\u90A3\u9846\u91D1\u8272\u5927\u6309\u9215\u5C31\u662F\u300C\u4ECA\u65E5\u7B2C\u4E00\u6B65\u300D\uFF0C\u4E0D\u77E5\u9053\u5148\u7DF4\u4EC0\u9EBC\u6642\u6309\u5B83\uFF0C\u6703\u5E36\u4F60\u5230\u6700\u9069\u5408\u7684\u5730\u65B9\u3002" },
      { title: "3 / 3\u30FB\u96C5\u5178\u5A1C\u5E36\u8DEF", text: "\u6309\u4E0B\u5F8C\uFF0C\u6703\u4F9D\u5E8F\u63A5\u56DE\u672A\u5B8C\u6E2C\u9A57\u3001\u5230\u671F\u8907\u7FD2\uFF0C\u6216\u63A8\u85A6\u661F\u5716\u4E0A\u7684\u4E0B\u4E00\u500B\u5B78\u7FD2\u9EDE\u3002" }
    ];
    const dialog = document.createElement("dialog");
    dialog.className = "onboarding-walkthrough";
    dialog.setAttribute("aria-labelledby", "onboarding-title");
    dialog.addEventListener("cancel", (event) => event.preventDefault());
    let index = 0;
    const renderStep = () => {
      const step = steps[index];
      dialog.innerHTML = `<h3 id="onboarding-title"></h3><p></p><button type="button"></button>`;
      const heading = dialog.querySelector("h3");
      heading.textContent = step.title;
      dialog.querySelector("p").textContent = step.text;
      const button = dialog.querySelector("button");
      button.textContent = index === steps.length - 1 ? "\u5B8C\u6210\u5C0E\u89BD\uFF0C\u958B\u59CB\u63A2\u7D22" : "\u4E0B\u4E00\u6B65";
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      announce(`${step.title}\u3002${step.text}`);
      button.addEventListener("click", () => {
        if (index < steps.length - 1) {
          index += 1;
          renderStep();
          return;
        }
        store.write("seenTip", true);
        dialog.close();
        dialog.remove();
        document.querySelector(".home-hero-action")?.focus();
      });
    };
    renderStep();
    document.body.appendChild(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return;
  }
  let root = document.getElementById("tip-bubble-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "tip-bubble-root";
  }
  document.querySelector(".home-brief-dock")?.after(root);
  const message = "\u60F3\u63A5\u8457\u7DF4\uFF1F\u9EDE\u9996\u9801\u4E0A\u65B9\u90A3\u9846\u91D1\u8272\u5927\u6309\u9215\uFF08\u4ECA\u65E5\u7B2C\u4E00\u6B65\uFF09\uFF0C\u667A\u6167\u5F15\u8DEF\u4EBA\u6703\u5E36\u4F60\u8D70\u5230\u6700\u9069\u5408\u7684\u5730\u65B9\u3002";
  const box = document.createElement("div");
  box.className = "tip-bubble";
  box.innerHTML = `${message}<br /><button>\u77E5\u9053\u4E86</button>`;
  box.querySelector("button").addEventListener("click", () => {
    box.remove();
    store.write("seenTip", true);
  });
  root.appendChild(box);
}
function startQuiz(node) {
  if (!isNodePlayable(node, tree)) return;
  showView("quiz");
  clearSprintTimer();
  document.getElementById("quiz-node-name").textContent = node.name;
  document.getElementById("quiz-progressbar").innerHTML = "";
  document.getElementById("quiz-streak").innerHTML = "";
  const quizArea = document.getElementById("quiz-area");
  quizArea.innerHTML = "";
  const picker = document.createElement("div");
  picker.className = "strategy-picker";
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "strategy-back-btn";
  backBtn.innerHTML = "\u2190 \u8FD4\u56DE\u661F\u5716";
  backBtn.addEventListener("click", () => showView("home"));
  picker.appendChild(backBtn);
  picker.appendChild(Object.assign(document.createElement("div"), {
    className: "strategy-picker-title",
    textContent: "\u9019\u4E00\u8F2A\u8981\u600E\u9EBC\u7DF4\uFF1F\uFF08\u4E0D\u78BA\u5B9A\u5C31\u76F4\u63A5\u958B\u59CB\uFF09"
  }));
  if (node.lessonMedia?.src) {
    const figure = document.createElement("figure");
    figure.className = "lesson-media";
    const img = document.createElement("img");
    img.src = node.lessonMedia.src;
    img.alt = node.lessonMedia.alt ?? "";
    img.loading = "lazy";
    img.decoding = "async";
    img.width = 1536;
    img.height = 1024;
    img.addEventListener("error", () => {
      figure.hidden = true;
    }, { once: true });
    figure.appendChild(img);
    picker.appendChild(figure);
  }
  const lastUsedRaw = store.read("lastStrategy", null);
  const isFirstTime = lastUsedRaw === null;
  const lastUsed = lastUsedRaw ?? "slow";
  const nodeErrorCount = listWrongQuestions().filter((e) => e.nodeId === node.id).length;
  const recommendedId = lastUsed === "repair" && nodeErrorCount === 0 ? "slow" : lastUsed;
  const recommended = STRATEGIES.find((s) => s.id === recommendedId) ?? STRATEGIES[0];
  const quickStart = document.createElement("button");
  quickStart.type = "button";
  quickStart.className = "strategy-quickstart";
  quickStart.innerHTML = `\u26A1 \u76F4\u63A5\u958B\u59CB<small>\u7528\u63A8\u85A6\uFF1A${recommended.plain}</small>`;
  quickStart.addEventListener("click", () => startQuizWithStrategy(node, recommended.id));
  picker.appendChild(quickStart);
  picker.appendChild(Object.assign(document.createElement("div"), {
    className: "strategy-picker-or",
    textContent: "\u6216\u81EA\u5DF1\u9078\u4E00\u7A2E\u7DF4\u6CD5"
  }));
  STRATEGIES.forEach((s) => {
    const card = document.createElement("button");
    const unavailable = s.id === "repair" && nodeErrorCount === 0;
    const isRecommended = !unavailable && s.id === recommendedId;
    card.className = "strategy-card" + (isRecommended ? " last-used" : "");
    card.style.setProperty("--strategy-color", `var(${s.color})`);
    card.disabled = unavailable;
    const title = document.createElement("strong");
    title.innerHTML = `${s.name}<i class="strategy-plain">\uFF08${s.plain}\uFF09</i>`;
    const desc = document.createElement("span");
    desc.textContent = unavailable ? "\u76EE\u524D\u6C92\u6709\u932F\u984C\u53EF\u4EE5\u7DF4" : s.desc;
    card.appendChild(title);
    card.appendChild(desc);
    if (isRecommended) {
      const tag = document.createElement("em");
      tag.className = "strategy-recommend-tag";
      tag.textContent = isFirstTime ? "\u65B0\u624B\u63A8\u85A6" : "\u4E0A\u6B21\u7528\u7684";
      card.appendChild(tag);
    }
    if (!unavailable) card.addEventListener("click", () => startQuizWithStrategy(node, s.id));
    picker.appendChild(card);
  });
  quizArea.appendChild(picker);
}
async function startQuizWithStrategy(node, strategyId) {
  showView("quiz");
  store.write("lastStrategy", strategyId);
  const errorEntries = strategyId === "repair" ? listWrongQuestions().filter((e) => e.nodeId === node.id) : [];
  const bank = await loadQuestionBank(node.id);
  const queue = await buildSession(node.id, 8, strategyId, errorEntries, node);
  session = newSession({
    queue,
    node,
    mascot: mascotVariantFor(node.id),
    kind: "node",
    strategy: strategyId,
    wasMasteredAtStart: getNodeStats(node.id).mastered,
    mentorPool: (bank.basicMastery ?? []).map((question) => ({ ...question, _nodeId: node.id })),
    repairTotal: queue.filter((q) => q._fromErrorbook).length,
    encounterIdx: Math.random() < 0.35 ? Math.floor(Math.random() * queue.length) : -1
  });
  preloadMascot(session.mascot);
  renderCurrentQuestion();
}
function shuffleSample(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}
async function startBossFight(strandId) {
  const strand = tree.strands.find((s) => s.id === strandId);
  const boss = bossFor(strandId);
  if (!strand || !boss) return;
  const gate = bossGate(strand, store.read("progress", {}), tree.masteryThreshold ?? 0.8);
  if (!gate.eligible) return;
  showView("quiz");
  clearSprintTimer();
  document.getElementById("quiz-node-name").textContent = `\u795E\u6BBF\u8A66\u7149\u30FB${boss.name}`;
  document.getElementById("quiz-progressbar").innerHTML = "";
  document.getElementById("quiz-streak").innerHTML = "";
  const quizArea = document.getElementById("quiz-area");
  quizArea.innerHTML = "";
  const playableIds = strand.nodes.filter((n) => isNodePlayable(n, tree)).map((n) => n.id);
  const pool = playableIds.length > 20 ? shuffleSample(playableIds, 20) : playableIds;
  const queue = await buildMasterSession(pool, 30);
  const collection = getCollection();
  const freeRetryAvailable = strand.nodes.some((n) => (collection[n.id]?.tier ?? 0) >= 2);
  session = newSession({
    queue,
    node: { id: `boss-${strandId}`, name: `\u795E\u6BBF\u8A66\u7149\u30FB${boss.name}` },
    mascot: tree.strandVisuals?.[strandId]?.mascot ?? "davinci",
    kind: "boss",
    boss: { ...newBossState(strandId), freeRetryAvailable }
  });
  preloadMascot(session.mascot);
  renderCurrentQuestion();
}
async function startPvpChallenge(strandId, seedInput) {
  const strand = tree.strands.find((s) => s.id === strandId);
  if (!strand) return;
  const seed = seedInput && Number.isFinite(Number(seedInput)) && seedInput !== "" ? Number(seedInput) : newChallengeSeed();
  showView("quiz");
  clearSprintTimer();
  document.getElementById("quiz-node-name").textContent = `\u6311\u6230\u66F8\u30FB${strand.name}`;
  document.getElementById("quiz-progressbar").innerHTML = "";
  document.getElementById("quiz-streak").innerHTML = "";
  const quizArea = document.getElementById("quiz-area");
  quizArea.innerHTML = "";
  const playableIds = strand.nodes.filter((n) => isNodePlayable(n, tree)).map((n) => n.id);
  const pool = playableIds.length > 20 ? shuffleSample(playableIds, 20) : playableIds;
  const banks = await Promise.all(pool.map((id) => loadQuestionBank(id).then((bank) => flattenBank(bank).map((q) => ({ ...q, _nodeId: id }))).catch(() => [])));
  const allQuestions = banks.flat();
  if (allQuestions.length === 0) {
    quizArea.appendChild(Object.assign(document.createElement("p"), {
      className: "pvp-empty-msg",
      textContent: "\u9019\u5EA7\u795E\u6BBF\u9084\u6C92\u6709\u53EF\u6311\u6230\u7684\u984C\u76EE\uFF0C\u5148\u53BB\u89E3\u9396\u5E7E\u500B\u7BC0\u9EDE\u5427\u3002"
    }));
    return;
  }
  const queue = buildSeededQuestions(seed, allQuestions, 10);
  session = newSession({
    queue,
    node: { id: `pvp-${strandId}`, name: `\u6311\u6230\u66F8\u30FB${strand.name}` },
    mascot: tree.strandVisuals?.[strandId]?.mascot ?? "davinci",
    kind: "pvp",
    pvp: { seed, strandId, totalDmg: 0, maxCombo: 0, startingBest: pvpChallengeFor(seed)?.bestDmg ?? 0 }
  });
  preloadMascot(session.mascot);
  renderCurrentQuestion();
}
function spiritFactorDots(n) {
  const wrap = document.createElement("span");
  wrap.className = "spirit-factors";
  wrap.setAttribute("aria-hidden", "true");
  const count = Math.min(8, divisorCount(n));
  for (let i = 0; i < count; i += 1) wrap.appendChild(Object.assign(document.createElement("i"), { className: "spirit-dot" }));
  return wrap;
}
function spiritBadgeEl(n) {
  const el3 = document.createElement("div");
  const cls = classify(n);
  el3.className = `spirit-badge spirit-${cls.kind}`;
  el3.title = `${spiritName(n)}\u30FB${cls.rarity}\u30FB${divisorCount(n)} \u500B\u56E0\u6578`;
  el3.style.setProperty("--spirit-hue", String(Math.round(n * 137.508 % 360)));
  const art = spiritArt(n);
  if (art) {
    const img = document.createElement("img");
    img.src = globalThis.mathAsset(`assets/spirits/${art}.png`);
    img.alt = spiritName(n);
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => {
      img.remove();
      el3.classList.add("spirit-fallback");
      el3.prepend(spiritFactorDots(n));
      el3.prepend(Object.assign(document.createElement("span"), { className: "spirit-num", textContent: String(n) }));
    });
    el3.appendChild(img);
  } else {
    el3.classList.add("spirit-fallback");
    el3.appendChild(Object.assign(document.createElement("span"), { className: "spirit-num", textContent: String(n) }));
    el3.appendChild(spiritFactorDots(n));
  }
  return el3;
}
var SHOP_STOCK = [
  { n: 13, price: 8 },
  { n: 17, price: 8 },
  { n: 19, price: 8 },
  { n: 23, price: 10 },
  { n: 29, price: 10 },
  { n: 31, price: 12 },
  { n: 37, price: 12 },
  { n: 6, price: 6 },
  { n: 12, price: 6 },
  { n: 28, price: 20 }
];
var SHOP_DAILY_LIMIT = 3;
function shopPurchasesToday() {
  return Number(getDaily().spiritShop ?? 0);
}
function showFusion() {
  showView("fusion");
  if (Object.keys(getSpiritBook()).length === 0) {
    captureSpirit(2);
    captureSpirit(3);
    showToast("\u2726 \u96C5\u5178\u5A1C\u5148\u9001\u4F60\u5169\u9846\u8CEA\u9748\uFF1A2 \u8207 3\uFF0C\u8A66\u8457\u878D\u5408\u51FA 6 \u5427", "success");
  }
  renderFusion();
}
function renderFusion() {
  const root = document.getElementById("fusion-content");
  root.innerHTML = "";
  const header = document.createElement("div");
  header.className = "fusion-header";
  header.appendChild(Object.assign(document.createElement("h3"), { textContent: "\u661F\u9748\u878D\u5408\u6BBF" }));
  header.appendChild(Object.assign(document.createElement("span"), {
    className: "fusion-wallet",
    textContent: `\u{1FAD9} \u661F\u5C51\u9918\u984D\uFF1A${stardustBalance()}`
  }));
  root.appendChild(header);
  const tabs = document.createElement("div");
  tabs.className = "fusion-tabs";
  [["fuse", "\u878D\u5408"], ["codex", "\u661F\u9748\u5716\u9451"], ["equip", "\u51FA\u6230"], ["shop", "\u8D6B\u7C73\u65AF\u5546\u5E97"], ["market", "\u73ED\u7D1A\u5E02\u96C6"]].forEach(([key, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const isActive = fusionState.tab === key;
    btn.className = "fusion-tab" + (isActive ? " active" : "");
    btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      fusionState.tab = key;
      renderFusion();
    });
    tabs.appendChild(btn);
  });
  root.appendChild(tabs);
  const body = document.createElement("div");
  body.className = "fusion-body";
  root.appendChild(body);
  if (fusionState.tab === "fuse") renderFuseTab(body);
  else if (fusionState.tab === "codex") renderCodexTab(body);
  else if (fusionState.tab === "equip") renderEquipTab(body);
  else if (fusionState.tab === "market") renderMarketTab(body);
  else renderShopTab(body);
}
function ownedSpiritNumbers() {
  return Object.keys(getSpiritBook()).map(Number).sort((a, b) => a - b);
}
function renderFuseTab(body) {
  const owned = ownedSpiritNumbers();
  if (owned.length === 0) {
    body.appendChild(Object.assign(document.createElement("p"), {
      className: "fusion-empty",
      textContent: "\u9084\u6C92\u6709\u4EFB\u4F55\u661F\u9748\u3002\u53BB\u4E94\u5EA7\u795E\u6BBF\u6253\u8D0F\u5B88\u8B77\u8005\u3001\u6216\u7B54\u5C0D\u795E\u8AED\u555F\u793A\uFF0C\u5C31\u80FD\u6536\u670D\u8CEA\u6578\u661F\u9748\u3002"
    }));
    return;
  }
  body.appendChild(Object.assign(document.createElement("p"), {
    className: "fusion-hint",
    textContent: "\u9078\u5169\u9846\u661F\u9748\u76F8\u4E58\u878D\u5408\u51FA\u65B0\u661F\u9748\u3002\u8CEA\u6578\u661F\u9748\u6C38\u9060\u53EA\u80FD\u6536\u670D\u3001\u7121\u6CD5\u878D\u5408\u8A95\u751F\u2014\u2014\u9019\u6B63\u662F\u8CEA\u6578\u7684\u7955\u5BC6\u3002\u7236\u65B9\u4E0D\u6703\u6D88\u5931\u3002"
  }));
  const slots = document.createElement("div");
  slots.className = "fusion-slots";
  [0, 1].forEach((i) => {
    const slot = document.createElement("div");
    slot.className = "fusion-slot";
    const pick = fusionState.pick[i];
    if (pick != null) {
      slot.appendChild(spiritBadgeEl(pick));
      slot.appendChild(Object.assign(document.createElement("span"), { className: "fusion-slot-name", textContent: spiritName(pick) }));
    } else {
      slot.appendChild(Object.assign(document.createElement("span"), { className: "fusion-slot-empty", textContent: i === 0 ? "\u9078\u7B2C\u4E00\u9846" : "\u9078\u7B2C\u4E8C\u9846" }));
    }
    slots.appendChild(slot);
    if (i === 0) slots.appendChild(Object.assign(document.createElement("span"), { className: "fusion-times", textContent: "\xD7" }));
  });
  body.appendChild(slots);
  const a = fusionState.pick[0];
  const b = fusionState.pick[1];
  const check = a != null && b != null ? canFuse(a, b) : null;
  const guessWrap = document.createElement("div");
  guessWrap.className = "fusion-guess";
  if (check?.ok) {
    guessWrap.appendChild(Object.assign(document.createElement("label"), { textContent: `${a} \xD7 ${b} = \uFF1F`, htmlFor: "fusion-guess-input" }));
    const input = document.createElement("input");
    input.id = "fusion-guess-input";
    input.type = "number";
    input.inputMode = "numeric";
    input.className = "fusion-guess-input";
    input.placeholder = "\u7B97\u7B97\u770B\u4E58\u7A4D";
    guessWrap.appendChild(input);
    const fuseBtn = document.createElement("button");
    fuseBtn.type = "button";
    fuseBtn.className = "fusion-do-btn";
    fuseBtn.textContent = "\u2726 \u878D\u5408";
    fuseBtn.addEventListener("click", () => {
      const result = resolveFusion(a, b, input.value.trim() === "" ? null : Number(input.value));
      if (result?.ok && result.correct && input.value.trim() !== "") {
        const rewarded = store.read("fusionRewarded", {});
        if (!rewarded[result.product]) {
          rewarded[result.product] = true;
          store.write("fusionRewarded", rewarded);
          addStardust(2);
          result.bonus = 2;
        }
      }
      fusionState.lastResult = result;
      fusionState.pick = [];
      if (result?.ok && isPerfect(result.product)) {
        showPerfectFusionCelebration(result.product);
      } else if (result?.ok) {
        const kind = specialFusionKind(result.product);
        if (kind) showSpecialFusionCelebration(result.product, kind);
      }
      renderFusion();
    });
    guessWrap.appendChild(fuseBtn);
  } else if (a != null && b != null) {
    guessWrap.appendChild(Object.assign(document.createElement("p"), { className: "fusion-cant", textContent: check?.reason ?? "\u9019\u5169\u9846\u7121\u6CD5\u878D\u5408" }));
  }
  body.appendChild(guessWrap);
  if (fusionState.lastResult?.ok) {
    const r = fusionState.lastResult;
    const reveal = document.createElement("div");
    reveal.className = `fusion-reveal ${r.correct ? "fusion-correct" : "fusion-gentle"}`;
    reveal.appendChild(spiritBadgeEl(r.product));
    reveal.appendChild(Object.assign(document.createElement("strong"), { textContent: `${r.recipe}` }));
    reveal.appendChild(Object.assign(document.createElement("p"), {
      textContent: r.correct ? `\u7B97\u5C0D\u4E86\uFF01\u878D\u5408\u51FA\u300C${spiritName(r.product)}\u300D${r.captured?.isNew ? "\uFF08\u65B0\u661F\u9748\uFF01\uFF09" : ""}${r.bonus ? `\uFF0C\u5FC3\u7B97\u6B63\u78BA +${r.bonus} \u661F\u5C51 \u{1FAD9}` : ""}` : `\u878D\u5408\u6210\u529F\uFF0C\u5F97\u5230\u300C${spiritName(r.product)}\u300D\uFF1B\u4E58\u7A4D\u7B97\u932F\u4E86\uFF0C\u6EAB\u548C\u6536 ${r.cost} \u661F\u5C51\uFF0C\u4E0B\u6B21\u7B97\u6E96\u5C31\u6709 +2 \u661F\u5C51\u734E\u52F5\u3002`
    }));
    body.appendChild(reveal);
  }
  const grid = document.createElement("div");
  grid.className = "fusion-picker";
  owned.forEach((n) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "fusion-pick-cell" + (fusionState.pick.includes(n) ? " picked" : "");
    cell.appendChild(spiritBadgeEl(n));
    cell.appendChild(Object.assign(document.createElement("span"), { className: "fusion-pick-num", textContent: String(n) }));
    cell.addEventListener("click", () => {
      const idx = fusionState.pick.indexOf(n);
      if (idx >= 0) fusionState.pick.splice(idx, 1);
      else if (fusionState.pick.length < 2) fusionState.pick.push(n);
      else fusionState.pick = [fusionState.pick[1], n];
      fusionState.lastResult = null;
      renderFusion();
    });
    grid.appendChild(cell);
  });
  body.appendChild(grid);
}
function renderCodexTab(body) {
  const owned = new Set(ownedSpiritNumbers());
  body.appendChild(Object.assign(document.createElement("p"), {
    className: "fusion-hint",
    textContent: `\u5DF2\u6536\u670D ${owned.size} / ${SPIRIT_MAX - 1} \u9846\u661F\u9748\u3002\u91D1\u6846\uFF1D\u5B8C\u5168\u6578\u50B3\u8AAA\u9748\uFF0C\u85CD\u6846\uFF1D\u8CEA\u6578\uFF0F\u5E73\u65B9\u6578\uFF0C\u4E00\u822C\uFF1D\u5408\u6210\u6578\u3002`
  }));
  const grid = document.createElement("div");
  grid.className = "codex-grid";
  for (let n = 2; n <= SPIRIT_MAX; n += 1) {
    const cls = classify(n);
    const cell = document.createElement("div");
    cell.className = `codex-cell spirit-${cls.kind}` + (owned.has(n) ? " owned" : " locked");
    if (isPrime(n)) cell.title = `${n} \u662F\u8CEA\u6578\uFF1A\u53EA\u6709 1 \u548C ${n} \u5169\u500B\u56E0\u6578\uFF0C\u6C92\u6709\u4EFB\u4F55\u5169\u500B\u5927\u65BC 1 \u7684\u6578\u76F8\u4E58\u505A\u5F97\u51FA\u5B83\u2014\u2014\u9019\u5C31\u662F\u70BA\u4EC0\u9EBC\u8CEA\u6578\u53EA\u80FD\u6536\u670D\u3001\u4E0D\u80FD\u878D\u5408\u8A95\u751F\u3002`;
    if (owned.has(n)) {
      cell.appendChild(spiritBadgeEl(n));
      const download = document.createElement("button");
      download.type = "button";
      download.className = "spirit-card-download";
      download.textContent = "\u540D\u7247";
      download.setAttribute("aria-label", `\u4E0B\u8F09${spiritName(n)}\u661F\u9748\u540D\u7247`);
      download.addEventListener("click", () => downloadSpiritCard(n));
      cell.appendChild(download);
    } else {
      cell.appendChild(Object.assign(document.createElement("span"), { className: "codex-locked-num", textContent: String(n) }));
    }
    grid.appendChild(cell);
  }
  body.appendChild(grid);
}
function downloadSpiritCard(n, onComplete = (success) => showToast(
  success ? "\u661F\u9748\u540D\u7247\u5DF2\u4E0B\u8F09" : "\u7121\u6CD5\u7522\u751F\u661F\u9748\u540D\u7247\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66",
  success ? "success" : "error"
)) {
  const data = spiritCardData(n);
  if (!data) {
    onComplete(false);
    return;
  }
  const W = 800, H = 460;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx2 = canvas.getContext("2d");
  if (!ctx2) {
    onComplete(false);
    return;
  }
  ctx2.fillStyle = "#f4ead2";
  ctx2.fillRect(0, 0, W, H);
  ctx2.strokeStyle = "rgba(140,110,70,0.18)";
  for (let y = 60; y < H; y += 34) {
    ctx2.beginPath();
    ctx2.moveTo(30, y + Math.sin(y) * 1.5);
    ctx2.lineTo(W - 30, y + Math.cos(y) * 1.5);
    ctx2.stroke();
  }
  ctx2.strokeStyle = "#6b5335";
  ctx2.lineWidth = 3;
  ctx2.strokeRect(14, 14, W - 28, H - 28);
  ctx2.lineWidth = 1;
  ctx2.strokeRect(22, 22, W - 44, H - 44);
  ctx2.fillStyle = "#4a3620";
  ctx2.font = "bold 28px 'Noto Sans TC', sans-serif";
  ctx2.fillText("\u6B65\u5B78\u543E\u6578\u30FB\u661F\u9748\u540D\u7247", 44, 68);
  ctx2.font = "bold 34px 'Noto Sans TC', sans-serif";
  ctx2.fillText(data.name, 44, 128);
  ctx2.fillStyle = data.rarity === "\u50B3\u8AAA" ? "#9a6200" : data.rarity === "\u7A00\u6709" ? "#256b7a" : "#4a3620";
  ctx2.font = "bold 76px 'Noto Sans TC', sans-serif";
  ctx2.fillText(String(data.n), 66, 254);
  ctx2.fillStyle = "#4a3620";
  ctx2.font = "22px 'Noto Sans TC', sans-serif";
  const details = [
    `\u8CEA\u56E0\u6578\u5206\u89E3\u3000${data.factorization}`,
    `\u7A00\u6709\u5EA6\u3000\u3000\u3000${data.rarity}`,
    `\u56E0\u6578\u6578\u91CF\u3000\u3000${data.divisorCount} \u500B`,
    `\u56E0\u6578\u5171\u632F\u3000\u3000+${data.bonusPct}%`
  ];
  details.forEach((line, index) => ctx2.fillText(line, 230, 190 + index * 46));
  ctx2.fillStyle = "#8a7455";
  ctx2.font = "16px 'Noto Sans TC', sans-serif";
  ctx2.fillText("\u52A0\u6210\u4F9D\u771F\u5BE6\u56E0\u6578\u500B\u6578\u8A08\u7B97\u30FB\u55AE\u96BB\u4E0A\u9650 6%", 44, H - 70);
  const date = /* @__PURE__ */ new Date();
  ctx2.fillText(`${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} \xB7 bxws-math`, W - 230, H - 40);
  const finish = () => {
    try {
      const a = document.createElement("a");
      a.download = `\u6B65\u5B78\u543E\u6578\u661F\u9748\u540D\u7247-${data.n}-${data.name}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
      onComplete(true);
    } catch {
      onComplete(false);
    }
  };
  if (!data.art) {
    finish();
    return;
  }
  const img = new Image();
  img.onload = () => {
    ctx2.drawImage(img, W - 190, 42, 140, 140);
    finish();
  };
  img.onerror = finish;
  img.src = globalThis.mathAsset(`assets/spirits/${data.art}.png`);
}
function renderEquipTab(body) {
  const owned = ownedSpiritNumbers();
  const equipped = getEquippedSpirits();
  body.appendChild(Object.assign(document.createElement("p"), {
    className: "fusion-hint",
    textContent: `\u51FA\u6230\u6700\u591A ${EQUIP_MAX} \u9846\u661F\u9748\uFF0C\u6BCF\u9846\u7684\u300C\u56E0\u6578\u5171\u632F\u300D\u7D66 boss \u6230\u4E00\u9EDE\u50B7\u5BB3\u52A0\u6210\u3002\u76EE\u524D\u7E3D\u52A0\u6210 ${Math.round(spiritBonusFor() * 100)}%\uFF08\u8207\u6536\u96C6\u54C1\u5408\u8A08\u4E0A\u9650 25%\uFF09\u3002\u9019\u53EA\u662F\u904A\u6232\u6548\u679C\u2014\u2014\u6578\u5B78\u4E0A 13 \u548C 12 \u6C92\u6709\u8AB0\u6BD4\u8F03\u5F37\uFF0C\u53EA\u662F\u56E0\u6578\u591A\u5BE1\u4E0D\u540C\u3002`
  }));
  if (owned.length === 0) {
    body.appendChild(Object.assign(document.createElement("p"), { className: "fusion-empty", textContent: "\u9084\u6C92\u6709\u661F\u9748\u53EF\u4EE5\u51FA\u6230\u3002" }));
    return;
  }
  const grid = document.createElement("div");
  grid.className = "equip-grid";
  owned.forEach((n) => {
    const on = equipped.includes(n);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "equip-cell" + (on ? " equipped" : "");
    cell.appendChild(spiritBadgeEl(n));
    cell.appendChild(Object.assign(document.createElement("span"), { className: "equip-info", textContent: `${n}\u30FB\u56E0\u6578\u5171\u632F +${Math.min(6, divisorCount(n))}%` }));
    cell.title = `${n} \u6709 ${divisorCount(n)} \u500B\u56E0\u6578\u3002\u56E0\u6578\u5171\u632F\u53EA\u662F\u904A\u6232\u52A0\u6210\uFF0C\u6578\u5B78\u4E0A\u56E0\u6578\u591A\u7684\u6578\u4E26\u4E0D\u300C\u6BD4\u8F03\u5F37\u300D\u3002`;
    cell.addEventListener("click", () => {
      const next = on ? equipped.filter((x) => x !== n) : [...equipped, n];
      setEquippedSpirits(next);
      renderFusion();
    });
    grid.appendChild(cell);
  });
  body.appendChild(grid);
}
function renderShopTab(body) {
  const remaining = Math.max(0, SHOP_DAILY_LIMIT - shopPurchasesToday());
  const balance = stardustBalance();
  body.appendChild(Object.assign(document.createElement("p"), {
    className: "fusion-hint",
    textContent: `\u8D6B\u7C73\u65AF\u7528\u661F\u5C51\u8DDF\u4F60\u63DB\u7A00\u6709\u661F\u9748\u3002\u660E\u78BC\u6A19\u50F9\u3001\u7121\u96A8\u6A5F\u958B\u7BB1\uFF0C\u6BCF\u5929\u6700\u591A\u8CB7 ${SHOP_DAILY_LIMIT} \u9846\uFF08\u4ECA\u5929\u9084\u80FD\u8CB7 ${remaining} \u9846\uFF09\u3002`
  }));
  const grid = document.createElement("div");
  grid.className = "shop-grid";
  SHOP_STOCK.forEach(({ n, price }) => {
    const cell = document.createElement("div");
    cell.className = `shop-cell spirit-${classify(n).kind}`;
    cell.appendChild(spiritBadgeEl(n));
    cell.appendChild(Object.assign(document.createElement("span"), { className: "shop-name", textContent: spiritName(n) }));
    cell.appendChild(Object.assign(document.createElement("span"), { className: "shop-price", textContent: `\u{1FAD9} ${price}` }));
    const buyBtn = document.createElement("button");
    buyBtn.type = "button";
    buyBtn.className = "shop-buy-btn";
    const affordable = balance >= price && remaining > 0;
    buyBtn.disabled = !affordable;
    buyBtn.textContent = remaining <= 0 ? "\u4ECA\u65E5\u552E\u7F44" : balance < price ? "\u661F\u5C51\u4E0D\u8DB3" : "\u8CFC\u8CB7";
    buyBtn.addEventListener("click", () => {
      if (!spendStardust(price)) {
        showToast("\u661F\u5C51\u4E0D\u8DB3", "warn");
        return;
      }
      bumpDaily("spiritShop", 1);
      const got = captureSpirit(n);
      showToast(got?.isNew ? `\u2726 \u8CB7\u4E0B\u300C${spiritName(n)}\u300D` : `\u2726 \u518D\u8CB7\u4E00\u9846\u300C${spiritName(n)}\u300D`, "success");
      renderFusion();
    });
    cell.appendChild(buyBtn);
    grid.appendChild(cell);
  });
  body.appendChild(grid);
}
async function showSanctuary() {
  tree = tree ?? await loadSkillTree();
  showView("sanctuary");
  sanctuarySelectedPedestal = null;
  renderSanctuary();
}
function renderSanctuary() {
  const root = document.getElementById("sanctuary-content");
  root.innerHTML = "";
  const progress = store.read("progress", {});
  const unlockedIds = unlockedDecorationIds(tree, progress);
  const titles = unlockedTitles(tree, progress);
  const layout = getSanctuaryLayout();
  const mastered = totalMasteredCount(tree, progress);
  const header = document.createElement("div");
  header.className = "sanctuary-header";
  header.appendChild(Object.assign(document.createElement("h3"), { textContent: "\u7E46\u601D\u8056\u6240" }));
  header.appendChild(Object.assign(document.createElement("p"), {
    className: "sanctuary-inscription",
    textContent: `\u300C${inscriptionText()}\u300D`
  }));
  const placedCount = Object.keys(layout).filter((k) => decorationById(layout[k]) && unlockedIds.has(layout[k])).length;
  header.appendChild(Object.assign(document.createElement("span"), {
    className: "sanctuary-stat",
    textContent: `\u5DF2\u9EDE\u4EAE\u9673\u8A2D ${unlockedIds.size} / ${DECORATIONS.length}\u3000\xB7\u3000\u5DF2\u64FA\u653E ${placedCount} / ${PEDESTAL_COUNT} \u5EA7\u3000\xB7\u3000\u5DF2\u7CBE\u719F ${mastered} \u7BC0\u9EDE`
  }));
  root.appendChild(header);
  if (unlockedIds.size === 0) {
    const empty = document.createElement("div");
    empty.className = "sanctuary-empty";
    empty.appendChild(Object.assign(document.createElement("p"), {
      className: "sanctuary-empty-title",
      textContent: "\u{1F3DB} \u4F60\u7684\u795E\u6BBF\u9084\u5728\u6C89\u7761"
    }));
    empty.appendChild(Object.assign(document.createElement("p"), {
      className: "sanctuary-empty-body",
      textContent: "\u6BCF\u7CBE\u719F\u4E00\u500B\u6578\u5B78\u7BC0\u9EDE\uFF0C\u5C31\u6703\u9EDE\u4EAE\u4E00\u4EF6\u795E\u6BBF\u9673\u8A2D\uFF0C\u53EF\u4EE5\u64FA\u4E0A\u57FA\u5EA7\u4F48\u7F6E\u3002\u5148\u53BB\u795E\u8A71\u661F\u5716\u7DF4\u7FD2\uFF0C\u56DE\u4F86\u5C31\u6709\u6771\u897F\u53EF\u4EE5\u64FA\u4E86\uFF01"
    }));
    const go = document.createElement("button");
    go.type = "button";
    go.className = "sanctuary-empty-cta";
    go.textContent = "\u2192 \u53BB\u795E\u8A71\u661F\u5716\u7DF4\u7FD2";
    go.addEventListener("click", () => showView("home"));
    empty.appendChild(go);
    root.appendChild(empty);
  }
  const popIndex = sanctuaryJustPlaced;
  sanctuaryJustPlaced = null;
  const titleWrap = document.createElement("div");
  titleWrap.className = "sanctuary-titles";
  titleWrap.appendChild(Object.assign(document.createElement("span"), { className: "sanctuary-subtitle", textContent: "\u9580\u6963\u9298\u6587\uFF08\u7CBE\u719F\u6108\u591A\u89E3\u9396\u6108\u9AD8\u7A31\u865F\uFF09" }));
  const titleRow = document.createElement("div");
  titleRow.className = "sanctuary-title-row";
  const current = getInscription();
  TITLES.forEach((t) => {
    const unlocked = titles.some((x) => x.id === t.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sanctuary-title-btn" + (t.id === current ? " active" : "") + (unlocked ? "" : " locked");
    btn.setAttribute("aria-pressed", t.id === current ? "true" : "false");
    btn.textContent = unlocked ? t.text : `\u{1F512} ${t.text}\uFF08\u9700\u7CBE\u719F ${t.need}\uFF09`;
    btn.disabled = !unlocked;
    btn.addEventListener("click", () => {
      setInscription(t.id, titles);
      renderSanctuary();
    });
    titleRow.appendChild(btn);
  });
  titleWrap.appendChild(titleRow);
  root.appendChild(titleWrap);
  const hint = document.createElement("p");
  hint.className = "sanctuary-hint";
  hint.textContent = sanctuarySelectedPedestal == null ? "\u9EDE\u4E00\u5EA7\u57FA\u5EA7\u9078\u4E2D\u5B83\uFF0C\u518D\u5F9E\u4E0B\u65B9\u9673\u8A2D\u5EAB\u6311\u4E00\u4EF6\u64FA\u4E0A\u53BB\u3002" : `\u5DF2\u9078\u7B2C ${sanctuarySelectedPedestal + 1} \u5EA7\u57FA\u5EA7\uFF0C\u9EDE\u4E0B\u65B9\u9673\u8A2D\u64FA\u653E\uFF0C\u6216\u518D\u9EDE\u4E00\u6B21\u57FA\u5EA7\u53D6\u6D88\u3002`;
  root.appendChild(hint);
  const pedestals = document.createElement("div");
  pedestals.className = "sanctuary-pedestals";
  for (let i = 0; i < PEDESTAL_COUNT; i += 1) {
    const decoId = layout[String(i)];
    const deco = decoId ? decorationById(decoId) : null;
    const stillUnlocked = deco && unlockedIds.has(deco.id);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "sanctuary-pedestal" + (sanctuarySelectedPedestal === i ? " selected" : "") + (deco ? " filled" : "") + (popIndex === i ? " pedestal-pop" : "");
    if (deco && stillUnlocked) {
      cell.appendChild(Object.assign(document.createElement("span"), { className: "pedestal-glyph", textContent: deco.glyph }));
      cell.appendChild(Object.assign(document.createElement("span"), { className: "pedestal-name", textContent: deco.name }));
    } else {
      cell.appendChild(Object.assign(document.createElement("span"), { className: "pedestal-empty", textContent: `\u57FA\u5EA7 ${i + 1}` }));
    }
    cell.addEventListener("click", () => {
      sanctuarySelectedPedestal = sanctuarySelectedPedestal === i ? null : i;
      renderSanctuary();
    });
    pedestals.appendChild(cell);
  }
  root.appendChild(pedestals);
  if (sanctuarySelectedPedestal != null && layout[String(sanctuarySelectedPedestal)]) {
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "sanctuary-clear-btn";
    clearBtn.textContent = "\u6E05\u7A7A\u9019\u5EA7\u57FA\u5EA7";
    clearBtn.addEventListener("click", () => {
      clearPedestal(sanctuarySelectedPedestal);
      renderSanctuary();
    });
    root.appendChild(clearBtn);
  }
  const gallery = document.createElement("div");
  gallery.className = "sanctuary-gallery";
  const byStrand = /* @__PURE__ */ new Map();
  DECORATIONS.forEach((d) => {
    if (!byStrand.has(d.theme)) byStrand.set(d.theme, []);
    byStrand.get(d.theme).push(d);
  });
  byStrand.forEach((items, theme) => {
    const group = document.createElement("div");
    group.className = "sanctuary-group";
    const templeKey = TEMPLE_IMG[items[0]?.strand];
    if (templeKey) {
      const banner = document.createElement("div");
      banner.className = "sanctuary-banner";
      const img = document.createElement("img");
      img.className = "sanctuary-banner-img";
      img.loading = "lazy";
      img.alt = `${theme}\u30FB\u795E\u6BBF\u7526\u9192`;
      img.src = globalThis.mathAsset(`assets/mythos/temples/${templeKey}-awaken.webp`);
      img.addEventListener("error", () => banner.remove());
      banner.appendChild(img);
      banner.appendChild(Object.assign(document.createElement("span"), { className: "sanctuary-banner-title", textContent: theme }));
      group.appendChild(banner);
    }
    group.appendChild(Object.assign(document.createElement("h4"), { textContent: theme }));
    const grid = document.createElement("div");
    grid.className = "sanctuary-deco-grid";
    items.forEach((d) => {
      const unlocked = unlockedIds.has(d.id);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "sanctuary-deco" + (unlocked ? "" : " locked");
      cell.disabled = !unlocked;
      cell.appendChild(Object.assign(document.createElement("span"), { className: "deco-glyph", textContent: unlocked ? d.glyph : "\u{1F512}" }));
      cell.appendChild(Object.assign(document.createElement("span"), { className: "deco-name", textContent: d.name }));
      cell.appendChild(Object.assign(document.createElement("span"), {
        className: "deco-req",
        textContent: unlocked ? "\u5DF2\u89E3\u9396" : d.strand === "center" ? `\u7CBE\u719F ${d.milestone} \u7BC0\u9EDE` : `\u8A72\u9818\u57DF\u7CBE\u719F ${Math.round(d.tierRatio * 100)}%`
      }));
      if (unlocked) {
        cell.addEventListener("click", () => {
          if (sanctuarySelectedPedestal == null) {
            showToast("\u5148\u9EDE\u4E0A\u65B9\u4E00\u5EA7\u57FA\u5EA7\uFF0C\u518D\u9078\u9019\u4EF6\u64FA\u4E0A\u53BB", "warn");
            const pedRow = document.querySelector(".sanctuary-pedestals");
            if (pedRow) {
              pedRow.classList.remove("pedestals-nudge");
              void pedRow.offsetWidth;
              pedRow.classList.add("pedestals-nudge");
              pedRow.scrollIntoView({ block: "center", behavior: "smooth" });
            }
            return;
          }
          placeDecoration(sanctuarySelectedPedestal, d.id, unlockedIds);
          if (isSfxOn()) sfx.correct();
          sanctuaryJustPlaced = sanctuarySelectedPedestal;
          showToast(`\u2726 \u300C${d.name}\u300D\u5DF2\u64FA\u4E0A\u57FA\u5EA7 ${sanctuarySelectedPedestal + 1}`, "success");
          renderSanctuary();
        });
      }
      grid.appendChild(cell);
    });
    group.appendChild(grid);
    gallery.appendChild(group);
  });
  root.appendChild(gallery);
}
var BUY_CONFIRM_MS = 6e3;
function armConfirmBuy(btn, onConfirm) {
  if (btn.dataset.armed === "1") {
    if (btn._buyTimer) {
      clearInterval(btn._buyTimer);
      pendingTimers.delete(btn._buyTimer);
      btn._buyTimer = null;
    }
    onConfirm();
    return;
  }
  btn.dataset.armed = "1";
  const original = btn.dataset.origLabel || btn.textContent;
  btn.dataset.origLabel = original;
  btn.classList.add("buy-armed");
  let left = Math.round(BUY_CONFIRM_MS / 1e3);
  btn.textContent = `\u518D\u9EDE\u4E00\u6B21\u78BA\u5B9A\u8CFC\u8CB7\uFF08${left}\uFF09`;
  const iv = window.setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(iv);
      pendingTimers.delete(iv);
      btn._buyTimer = null;
      btn.dataset.armed = "";
      btn.textContent = original;
      btn.classList.remove("buy-armed");
      showToast("\u5DF2\u53D6\u6D88\u8CFC\u8CB7", "warn");
      return;
    }
    btn.textContent = `\u518D\u9EDE\u4E00\u6B21\u78BA\u5B9A\u8CFC\u8CB7\uFF08${left}\uFF09`;
  }, 1e3);
  btn._buyTimer = iv;
  pendingTimers.add(iv);
}
async function renderMarketTab(body) {
  const bonus = isMarketBonus();
  const p2pDisabled = store.read("marketP2PDisabled", false) === true;
  body.appendChild(Object.assign(document.createElement("p"), {
    className: "fusion-hint",
    textContent: nextMarketText()
  }));
  body.appendChild(Object.assign(document.createElement("p"), {
    className: "fusion-hint market-note-soft",
    textContent: "\u{1F4A1} \u661F\u5C51\u662F\u904A\u6232\u5E63\u3001\u4E0D\u662F\u771F\u9322\uFF0C\u8CB7\u8CE3\u661F\u9748\u53EA\u662F\u597D\u73A9\uFF0C\u5225\u52C9\u5F37\u540C\u5B78\u4EA4\u6613\u3002"
  }));
  const teacherWrap = document.createElement("label");
  teacherWrap.className = "market-teacher-toggle";
  const teacherChk = document.createElement("input");
  teacherChk.type = "checkbox";
  teacherChk.checked = p2pDisabled;
  teacherChk.addEventListener("change", () => {
    store.write("marketP2PDisabled", teacherChk.checked);
    renderFusion();
  });
  teacherWrap.append(teacherChk, Object.assign(document.createElement("span"), { textContent: "\u672C\u6A5F\u986F\u793A\u8A2D\u5B9A\uFF1A\u96B1\u85CF\u540C\u5B78\u4E92\u76F8\u4EA4\u6613\uFF0C\u53EA\u7559\u7CFB\u7D71\u5546\u968A\uFF08\u53EA\u5F71\u97FF\u9019\u53F0\u88DD\u7F6E\u7684\u756B\u9762\uFF09" }));
  body.appendChild(teacherWrap);
  const rawRoom = normalizeRoomCode(store.read("arenaRoom", "") ?? "");
  const hasRoom = isValidRoomCode(rawRoom);
  const caravanRoom = hasRoom ? rawRoom : dailySoloRoomCode();
  const npcWrap = document.createElement("div");
  npcWrap.className = "market-npc";
  npcWrap.appendChild(Object.assign(document.createElement("h4"), { textContent: bonus ? "\u{1F42B} \u8D6B\u7C73\u65AF\u5546\u968A\uFF08\u52A0\u78BC\u65E5\u88DC\u8CA8\uFF09" : "\u{1F42B} \u8D6B\u7C73\u65AF\u5546\u968A\uFF08\u4ECA\u65E5\u88DC\u8CA8\uFF09" }));
  const boughtToday = store.read("npcBought", {});
  const todayKey2 = caravanRoom && npcListings(caravanRoom)[0]?.id.split("-")[1];
  const npcGrid = document.createElement("div");
  npcGrid.className = "market-grid";
  const availableNpc = npcListings(caravanRoom).filter((l) => !ownsSpirit(l.spiritN) && boughtToday[l.id] !== todayKey2);
  if (availableNpc.length === 0) {
    npcWrap.appendChild(Object.assign(document.createElement("p"), { className: "fusion-hint", textContent: "\u4ECA\u5929\u5546\u968A\u7684\u8CA8\u4F60\u90FD\u6536\u9F4A\u4E86\uFF0C\u660E\u5929\u518D\u4F86\u88DC\u65B0\u8CA8\uFF01" }));
  } else {
    availableNpc.forEach((l) => {
      const cell = document.createElement("div");
      cell.className = `market-cell spirit-${classify(l.spiritN).kind}`;
      cell.appendChild(spiritBadgeEl(l.spiritN));
      cell.appendChild(Object.assign(document.createElement("span"), { className: "market-cell-name", textContent: `${l.spiritN}\u30FB${spiritName(l.spiritN)}` }));
      cell.appendChild(Object.assign(document.createElement("span"), { className: "market-cell-seller", textContent: l.sellerName }));
      cell.appendChild(Object.assign(document.createElement("span"), { className: "market-cell-price", textContent: `\u{1FAD9} ${l.price}` }));
      const affordable = stardustBalance() >= l.price;
      const buyBtn = Object.assign(document.createElement("button"), { type: "button", className: "market-buy-btn" });
      buyBtn.disabled = !affordable;
      buyBtn.textContent = affordable ? "\u8CFC\u8CB7" : "\u661F\u5C51\u4E0D\u8DB3";
      buyBtn.addEventListener("click", () => armConfirmBuy(buyBtn, () => {
        if (!spendStardust(l.price)) {
          showToast("\u661F\u5C51\u4E0D\u8DB3", "warn");
          return;
        }
        const got = captureSpirit(l.spiritN);
        const bought = store.read("npcBought", {});
        bought[l.id] = todayKey2;
        store.write("npcBought", bought);
        showToast(got?.isNew ? `\u2726 \u5F9E\u5546\u968A\u8CB7\u4E0B\u300C${spiritName(l.spiritN)}\u300D` : `\u2726 \u518D\u6536\u4E00\u9846\u300C${spiritName(l.spiritN)}\u300D`, "success");
        renderFusion();
      }));
      cell.appendChild(buyBtn);
      npcGrid.appendChild(cell);
    });
    npcWrap.appendChild(npcGrid);
  }
  body.appendChild(npcWrap);
  if (p2pDisabled) {
    body.appendChild(Object.assign(document.createElement("p"), { className: "fusion-hint", textContent: "\u8001\u5E2B\u6A21\u5F0F\u958B\u555F\u4E2D\uFF1A\u540C\u5B78\u4E92\u76F8\u4EA4\u6613\u5DF2\u95DC\u9589\uFF0C\u53EA\u4FDD\u7559\u4E0A\u65B9\u7CFB\u7D71\u5546\u968A\u3002" }));
    return;
  }
  if (!hasRoom) {
    body.appendChild(Object.assign(document.createElement("p"), {
      className: "fusion-empty",
      textContent: "\u60F3\u548C\u540C\u73ED\u540C\u5B78\u4E92\u76F8\u639B\u55AE\u4EA4\u6613\uFF1F\u5148\u8A2D\u5B9A\u73ED\u7D1A\u623F\u865F\u3002\uFF08\u4E0A\u65B9\u7CFB\u7D71\u5546\u968A\u4E00\u500B\u4EBA\u4E5F\u80FD\u8CB7\uFF09"
    }));
    const goRoomBtn = Object.assign(document.createElement("button"), {
      type: "button",
      className: "market-goroom-btn",
      textContent: "\u2694\uFE0F \u53BB\u795E\u6BBF\u7AF6\u6280\u5834\u8A2D\u5B9A\u623F\u865F"
    });
    goRoomBtn.addEventListener("click", () => showArena());
    body.appendChild(goRoomBtn);
    return;
  }
  body.appendChild(Object.assign(document.createElement("p"), { className: "market-room-tag", textContent: `\u73ED\u7D1A\u623F\u865F\uFF1A${rawRoom}` }));
  const room = rawRoom;
  const mine = await fetchMyListings();
  if (mine?.ok && mine.unclaimedTotal > 0) {
    const banner = document.createElement("div");
    banner.className = "market-payout";
    banner.appendChild(Object.assign(document.createElement("span"), { textContent: `\u{1F4B0} \u6709\u4EBA\u8CB7\u4E86\u4F60\u7684\u639B\u55AE\uFF0C\u53EF\u9818 ${mine.unclaimedTotal} \u661F\u5C51\uFF08${mine.sold.length} \u7B46\uFF09` }));
    const claimBtn = Object.assign(document.createElement("button"), { type: "button", className: "market-claim-btn", textContent: "\u9818\u53D6" });
    claimBtn.addEventListener("click", async () => {
      const r = await claimPayout();
      if (r?.ok && r.claimed > 0) {
        addStardust(r.claimed);
        showToast(`\u2726 \u5165\u5E33 ${r.claimed} \u661F\u5C51`, "success");
      }
      renderFusion();
    });
    banner.appendChild(claimBtn);
    body.appendChild(banner);
  }
  const owned = ownedSpiritNumbers();
  const listWrap = document.createElement("div");
  listWrap.className = "market-list-form";
  listWrap.appendChild(Object.assign(document.createElement("h4"), { textContent: "\u6211\u8981\u639B\u55AE" }));
  if (owned.length === 0) {
    listWrap.appendChild(Object.assign(document.createElement("p"), { className: "fusion-hint", textContent: "\u4F60\u9084\u6C92\u6709\u661F\u9748\u53EF\u4EE5\u8CE3\u3002" }));
  } else {
    const row = document.createElement("div");
    row.className = "market-form-row";
    const sel = document.createElement("select");
    sel.className = "market-spirit-select";
    owned.forEach((n) => sel.appendChild(Object.assign(document.createElement("option"), { value: String(n), textContent: `${n}\u30FB${spiritName(n)}` })));
    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.className = "market-price-input";
    priceInput.min = String(MARKET_MIN_PRICE);
    priceInput.max = String(MARKET_MAX_PRICE);
    priceInput.value = "10";
    priceInput.placeholder = `${MARKET_MIN_PRICE}\u2013${MARKET_MAX_PRICE} \u661F\u5C51`;
    const listBtn = Object.assign(document.createElement("button"), { type: "button", className: "market-do-btn", textContent: "\u639B\u55AE" });
    listBtn.addEventListener("click", async () => {
      const price = Math.round(Number(priceInput.value));
      if (!(price >= MARKET_MIN_PRICE && price <= MARKET_MAX_PRICE)) {
        showToast(`\u50F9\u683C\u9700\u5728 ${MARKET_MIN_PRICE}\u2013${MARKET_MAX_PRICE}`, "warn");
        return;
      }
      const r = await listSpirit(room, Number(sel.value), price);
      if (r?.ok) showToast(`\u2726 \u5DF2\u639B\u55AE\u300C${spiritName(Number(sel.value))}\u300D${price} \u661F\u5C51`, "success");
      else showToast(r?.message ?? "\u639B\u55AE\u5931\u6557\uFF08\u53EF\u80FD\u5DF2\u9054\u4E0A\u9650\uFF09", "warn");
      renderFusion();
    });
    row.append(sel, priceInput, listBtn);
    listWrap.appendChild(row);
  }
  body.appendChild(listWrap);
  if (mine?.ok && mine.open?.length) {
    const mineWrap = document.createElement("div");
    mineWrap.className = "market-mine";
    mineWrap.appendChild(Object.assign(document.createElement("h4"), { textContent: "\u6211\u7684\u639B\u55AE\uFF08\u958B\u653E\u4E2D\uFF09" }));
    mine.open.forEach((l) => {
      mineWrap.appendChild(Object.assign(document.createElement("p"), { className: "market-mine-row", textContent: `${l.spiritN}\u30FB${spiritName(l.spiritN)}\u3000\u{1FAD9} ${l.price}` }));
    });
    body.appendChild(mineWrap);
  }
  const boardWrap = document.createElement("div");
  boardWrap.className = "market-board";
  boardWrap.appendChild(Object.assign(document.createElement("h4"), { textContent: "\u540C\u5B78\u7684\u639B\u55AE" }));
  const boardBody = document.createElement("div");
  boardBody.className = "market-board-body";
  boardBody.appendChild(Object.assign(document.createElement("p"), { className: "fusion-hint", textContent: "\u8B80\u53D6\u4E2D\u2026" }));
  boardWrap.appendChild(boardBody);
  body.appendChild(boardWrap);
  const listings = await fetchMarketBoard(room);
  boardBody.innerHTML = "";
  if (listings === null) {
    boardBody.appendChild(Object.assign(document.createElement("p"), { className: "fusion-empty", textContent: "\u9023\u4E0D\u5230\u5E02\u96C6\u4F3A\u670D\u5668\uFF08\u53EF\u80FD\u96E2\u7DDA\uFF09\u3002" }));
    return;
  }
  if (listings.length === 0) {
    boardBody.appendChild(Object.assign(document.createElement("p"), { className: "fusion-empty", textContent: "\u76EE\u524D\u6C92\u6709\u540C\u5B78\u639B\u55AE\u3002\u53EF\u4EE5\u5148\u901B\u4E0A\u65B9\u7684\u7CFB\u7D71\u5546\u968A\uFF01" }));
    return;
  }
  const grid = document.createElement("div");
  grid.className = "market-grid";
  listings.forEach((l) => {
    const cell = document.createElement("div");
    cell.className = `market-cell spirit-${classify(l.spiritN).kind}`;
    cell.appendChild(spiritBadgeEl(l.spiritN));
    cell.appendChild(Object.assign(document.createElement("span"), { className: "market-cell-name", textContent: `${l.spiritN}\u30FB${spiritName(l.spiritN)}` }));
    cell.appendChild(Object.assign(document.createElement("span"), { className: "market-cell-seller", textContent: `\u8CE3\u5BB6\uFF1A${l.sellerName}` }));
    cell.appendChild(Object.assign(document.createElement("span"), { className: "market-cell-price", textContent: `\u{1FAD9} ${l.price}` }));
    const alreadyOwn = ownsSpirit(l.spiritN);
    const buyBtn = Object.assign(document.createElement("button"), { type: "button", className: "market-buy-btn" });
    const affordable = stardustBalance() >= l.price;
    buyBtn.disabled = alreadyOwn || !affordable;
    buyBtn.textContent = alreadyOwn ? "\u5DF2\u64C1\u6709" : !affordable ? "\u661F\u5C51\u4E0D\u8DB3" : "\u8CFC\u8CB7";
    buyBtn.addEventListener("click", () => armConfirmBuy(buyBtn, async () => {
      const r = await buyListing(l.id);
      if (r?.ok) {
        if (spendStardust(r.price)) {
          showToast(`\u2726 \u8CB7\u4E0B\u300C${spiritName(r.spiritN)}\u300D`, "success");
        } else {
          forceSettleStardust();
          showToast(`\u2726 \u8CB7\u4E0B\u300C${spiritName(r.spiritN)}\u300D\uFF08\u661F\u5C51\u5DF2\u7D50\u6E05\uFF09`, "warn");
        }
        captureSpirit(r.spiritN);
      } else {
        showToast(r?.message ?? "\u8CFC\u8CB7\u5931\u6557", "warn");
      }
      renderFusion();
    }));
    cell.appendChild(buyBtn);
    grid.appendChild(cell);
  });
  boardBody.appendChild(grid);
}
async function showArena() {
  tree = tree ?? await loadSkillTree();
  showView("arena");
  if (!arenaState.strandId) arenaState.strandId = store.read("arenaStrand", null) ?? tree.strands[0]?.id ?? null;
  renderArena();
}
function arenaRoomValue() {
  return store.read("arenaRoom", "") ?? "";
}
function dailySoloRoomCode() {
  const d = /* @__PURE__ */ new Date();
  const p = (n) => String(n).padStart(2, "0");
  return normalizeRoomCode(`S${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}`);
}
async function renderArena() {
  const root = document.getElementById("arena-content");
  root.innerHTML = "";
  const header = document.createElement("div");
  header.className = "arena-header";
  header.appendChild(Object.assign(document.createElement("h3"), { textContent: "\u795E\u6BBF\u7AF6\u6280\u5834" }));
  header.appendChild(Object.assign(document.createElement("p"), { className: "arena-season", textContent: `\u{1F3C6} ${seasonLabel()}\uFF08\u6BCF\u6708\u521D\u91CD\u7F6E\u6392\u884C\uFF09` }));
  header.appendChild(Object.assign(document.createElement("p"), {
    className: "arena-hint",
    textContent: "\u8F38\u5165\u73ED\u7D1A\u623F\u865F\uFF0C\u9078\u4E00\u5EA7\u795E\u6BBF\u958B\u6230\u2014\u2014\u540C\u623F\u540C\u6708\u7684\u4EBA\u62FF\u5230\u5B8C\u5168\u76F8\u540C\u7684 10 \u984C\uFF0C\u6BD4\u8AB0\u7B54\u5F97\u53C8\u5C0D\u53C8\u5FEB\u3002\u6230\u7E3E\u4E0A\u50B3\u96F2\u7AEF\u6230\u6CC1\u7246\uFF08\u53EA\u9732\u524D\u4E94\uFF09\u3002"
  }));
  root.appendChild(header);
  const roomWrap = document.createElement("div");
  roomWrap.className = "arena-room";
  roomWrap.appendChild(Object.assign(document.createElement("label"), { textContent: "\u73ED\u7D1A\u623F\u865F\uFF083\u20138 \u78BC\u82F1\u6578\uFF09", htmlFor: "arena-room-input" }));
  const roomInput = document.createElement("input");
  roomInput.id = "arena-room-input";
  roomInput.className = "arena-room-input";
  roomInput.value = arenaRoomValue();
  roomInput.placeholder = "\u4F8B\u5982 5A2026";
  roomInput.maxLength = 8;
  roomInput.addEventListener("input", () => {
    roomInput.value = normalizeRoomCode(roomInput.value);
    store.write("arenaRoom", roomInput.value || null);
  });
  roomWrap.appendChild(roomInput);
  root.appendChild(roomWrap);
  const soloBtn = document.createElement("button");
  soloBtn.type = "button";
  soloBtn.className = "arena-solo-btn";
  soloBtn.textContent = "\u{1F3AF} \u4ECA\u65E5\u55AE\u4EBA\u623F\uFF08\u81EA\u52D5\u586B\u623F\u865F\uFF0C\u4E00\u500B\u4EBA\u4E5F\u80FD\u6311\u6230\uFF09";
  soloBtn.addEventListener("click", () => {
    const code = dailySoloRoomCode();
    roomInput.value = code;
    store.write("arenaRoom", code);
    renderArena();
  });
  root.appendChild(soloBtn);
  const strandWrap = document.createElement("div");
  strandWrap.className = "arena-strands";
  tree.strands.forEach((s) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "arena-strand-btn" + (arenaState.strandId === s.id ? " active" : "");
    btn.setAttribute("aria-pressed", arenaState.strandId === s.id ? "true" : "false");
    btn.textContent = s.name;
    btn.addEventListener("click", () => {
      arenaState.strandId = s.id;
      store.write("arenaStrand", s.id);
      renderArena();
    });
    strandWrap.appendChild(btn);
  });
  root.appendChild(strandWrap);
  const strand = tree.strands.find((s) => s.id === arenaState.strandId);
  const hasPlayable = (strand?.nodes ?? []).some((n) => isNodePlayable(n, tree));
  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.className = "arena-start-btn";
  startBtn.disabled = !hasPlayable;
  startBtn.textContent = hasPlayable ? "\u2694\uFE0F \u958B\u6230\uFF0810 \u984C\u8A08\u5206\uFF09" : "\u{1F512} \u5148\u89E3\u9396\u6B64\u795E\u6BBF\u81F3\u5C11\u4E00\u7BC0\u9EDE";
  startBtn.addEventListener("click", () => {
    const room2 = normalizeRoomCode(roomInput.value);
    if (!isValidRoomCode(room2)) {
      showToast("\u8ACB\u5148\u8F38\u5165 3\u20138 \u78BC\u623F\u865F", "warn");
      return;
    }
    store.write("arenaRoom", room2);
    startArenaChallenge(arenaState.strandId, room2);
  });
  root.appendChild(startBtn);
  const boardWrap = document.createElement("div");
  boardWrap.className = "arena-board";
  boardWrap.appendChild(Object.assign(document.createElement("h4"), { textContent: "\u672C\u6708\u6230\u6CC1\u7246\uFF08\u524D\u4E94\uFF09" }));
  boardWrap.appendChild(Object.assign(document.createElement("p"), {
    className: "score-disclosure",
    textContent: "\u6210\u7E3E\u7531\u5B78\u751F\u81EA\u884C\u56DE\u5831\u3001\u672A\u7D93\u4F3A\u670D\u5668\u9A57\u8B49\uFF1B\u540D\u5B57\u5F8C\u7684 \u26A0\uFE0F \u662F\u7CFB\u7D71\u6A19\u8A18\uFF0C\u50C5\u4F9B\u6559\u5E2B\u8207\u5BB6\u9577\u6C7A\u5B9A\u662F\u5426\u8907\u9A57\u3002"
  }));
  const boardBody = document.createElement("div");
  boardBody.className = "arena-board-body";
  boardBody.appendChild(Object.assign(document.createElement("p"), { className: "arena-loading", textContent: "\u8B80\u53D6\u4E2D\u2026" }));
  boardWrap.appendChild(boardBody);
  root.appendChild(boardWrap);
  const room = normalizeRoomCode(roomInput.value);
  if (isValidRoomCode(room) && strand) {
    const rows = await fetchArenaBoard(room, strand.id);
    renderArenaBoard(boardBody, rows, room, strand);
  } else {
    boardBody.innerHTML = "";
    boardBody.appendChild(Object.assign(document.createElement("p"), { className: "arena-empty", textContent: "\u8F38\u5165\u623F\u865F\u5F8C\u5373\u53EF\u770B\u5230\u9019\u5EA7\u795E\u6BBF\u7684\u672C\u6708\u6392\u884C\u3002" }));
  }
}
function renderArenaBoard(boardBody, rows, room, strand) {
  boardBody.innerHTML = "";
  if (rows === null) {
    const localBest = getLocalArenaBest()[`${normalizeRoomCode(room)}|${seasonKey()}|${strand.id}`];
    boardBody.appendChild(Object.assign(document.createElement("p"), {
      className: "arena-offline",
      textContent: localBest ? `\u76EE\u524D\u9023\u4E0D\u5230\u96F2\u7AEF\u6230\u6CC1\u7246\uFF0C\u6539\u986F\u793A\u4F60\u7684\u672C\u6A5F\u6700\u4F73\uFF1A\u7B54\u5C0D\u7387 ${localBest.pct}%\u3001\u7528\u6642 ${localBest.totalSec} \u79D2\u3002` : "\u76EE\u524D\u9023\u4E0D\u5230\u96F2\u7AEF\u6230\u6CC1\u7246\uFF08\u53EF\u80FD\u96E2\u7DDA\u6216\u6B64\u5E73\u53F0\u672A\u63A5\u8CC7\u6599\u5EAB\uFF09\u3002\u6253\u4E00\u5834\u5F8C\u6703\u5B58\u672C\u6A5F\u6700\u4F73\uFF0C\u4E4B\u5F8C\u53EF\u81EA\u6211\u6BD4\u5206\u3002"
    }));
    return;
  }
  if (rows.length === 0) {
    boardBody.appendChild(Object.assign(document.createElement("p"), { className: "arena-empty", textContent: "\u9019\u5EA7\u795E\u6BBF\u672C\u6708\u9084\u6C92\u6709\u4EBA\u4E0A\u699C\uFF0C\u4F60\u53EF\u4EE5\u7576\u7B2C\u4E00\u500B\uFF01" }));
    return;
  }
  const list = document.createElement("ol");
  list.className = "arena-rank";
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "arena-rank-row" + (i === 0 ? " top" : "");
    li.appendChild(Object.assign(document.createElement("span"), { className: "arena-rank-medal", textContent: ["\u{1F947}", "\u{1F948}", "\u{1F949}", "4", "5"][i] ?? String(i + 1) }));
    li.appendChild(Object.assign(document.createElement("span"), { className: "arena-rank-name", textContent: r.name + (r.flagged ? " \u26A0\uFE0F" : "") }));
    li.appendChild(Object.assign(document.createElement("span"), { className: "arena-rank-score", textContent: `${r.pct}%\u30FB${r.totalSec}s` }));
    list.appendChild(li);
  });
  boardBody.appendChild(list);
}
async function startArenaChallenge(strandId, roomCode) {
  const strand = tree.strands.find((s) => s.id === strandId);
  if (!strand) return;
  const season = seasonKey();
  const seed = roomSeed(roomCode, strandId, season);
  showView("quiz");
  clearSprintTimer();
  document.getElementById("quiz-node-name").textContent = `\u7AF6\u6280\u5834\u30FB${strand.name}`;
  document.getElementById("quiz-progressbar").innerHTML = "";
  document.getElementById("quiz-streak").innerHTML = "";
  const quizArea = document.getElementById("quiz-area");
  quizArea.innerHTML = "";
  const playableIds = strand.nodes.filter((n) => isNodePlayable(n, tree)).map((n) => n.id);
  const pool = playableIds.length > 20 ? shuffleSample(playableIds, 20) : playableIds;
  const banks = await Promise.all(pool.map((id) => loadQuestionBank(id).then((bank) => flattenBank(bank).map((q) => ({ ...q, _nodeId: id }))).catch(() => [])));
  const allQuestions = banks.flat();
  if (allQuestions.length === 0) {
    quizArea.appendChild(Object.assign(document.createElement("p"), { className: "pvp-empty-msg", textContent: "\u9019\u5EA7\u795E\u6BBF\u9084\u6C92\u6709\u53EF\u6311\u6230\u7684\u984C\u76EE\uFF0C\u5148\u53BB\u89E3\u9396\u5E7E\u500B\u7BC0\u9EDE\u5427\u3002" }));
    return;
  }
  const queue = buildSeededQuestions(seed, allQuestions, ARENA_QUESTION_COUNT);
  session = newSession({
    queue,
    node: { id: `arena-${strandId}`, name: `\u7AF6\u6280\u5834\u30FB${strand.name}` },
    mascot: tree.strandVisuals?.[strandId]?.mascot ?? "davinci",
    kind: "arena",
    arena: { roomCode: normalizeRoomCode(roomCode), strandId, season, seed, correct: 0, totalDmg: 0, maxCombo: 0, startAt: Date.now(), count: queue.length }
  });
  const best = getLocalArenaBest()[`${normalizeRoomCode(roomCode)}|${season}|${strandId}`];
  session.arena.ghostSecPerQ = best?.totalSec ? Math.max(2, best.totalSec / (best.questionCount || ARENA_QUESTION_COUNT)) : 12;
  session.arena.ghostLabel = best?.totalSec ? "\u4F60\u7684\u6700\u4F73\u5E7D\u9748" : "\u7CFB\u7D71\u5E7D\u9748\uFF0812\u79D2/\u984C\uFF09";
  preloadMascot(session.mascot);
  renderCurrentQuestion();
  mountArenaGhost();
}
async function finishArenaSession(quizArea) {
  session.concluded = true;
  removeArenaGhost();
  const a = session.arena;
  const totalSec = Math.max(1, Math.round((Date.now() - a.startAt) / 1e3));
  const pct = Math.round(a.correct / a.count * 100);
  const result = { pct, totalSec, totalDmg: a.totalDmg, maxCombo: a.maxCombo, questionCount: a.count };
  recordLocalArenaBest(a.roomCode, a.strandId, result, a.season);
  const card = document.createElement("div");
  card.className = "arena-outcome";
  card.appendChild(Object.assign(document.createElement("h3"), { textContent: "\u7AF6\u6280\u5834\u7D50\u7B97" }));
  card.appendChild(Object.assign(document.createElement("p"), { className: "arena-outcome-score", textContent: `\u7B54\u5C0D ${a.correct} / ${a.count}\uFF08${pct}%\uFF09\u30FB\u7528\u6642 ${totalSec} \u79D2\u30FB\u6700\u9AD8\u9023\u64CA ${a.maxCombo}` }));
  const statusEl = Object.assign(document.createElement("p"), { className: "arena-outcome-status", textContent: "\u4E0A\u50B3\u6230\u7E3E\u4E2D\u2026" });
  card.appendChild(statusEl);
  const backBtn = Object.assign(document.createElement("button"), { type: "button", className: "arena-back-btn", textContent: "\u56DE\u7AF6\u6280\u5834\u770B\u6230\u6CC1\u7246" });
  backBtn.addEventListener("click", showArena);
  card.appendChild(backBtn);
  quizArea.innerHTML = "";
  quizArea.appendChild(card);
  const strand = tree.strands.find((s) => s.id === a.strandId);
  const resp = await submitArenaResult(a.roomCode, a.strandId, result, a.season);
  if (resp?.ok && resp.updated) statusEl.textContent = resp.flagged ? "\u5DF2\u4E0A\u50B3\uFF08\u7CFB\u7D71\u6A19\u8A18\u5EFA\u8B70\u8907\u9A57\uFF09\u2705" : "\u5DF2\u5237\u65B0\u4F60\u5728\u6230\u6CC1\u7246\u7684\u6700\u4F73\u6210\u7E3E \u2705";
  else if (resp?.ok) statusEl.textContent = "\u5DF2\u4E0A\u50B3\uFF0C\u4F46\u6C92\u6709\u8D85\u904E\u4F60\u5148\u524D\u7684\u6700\u4F73\u6210\u7E3E\u3002";
  else statusEl.textContent = "\u96F2\u7AEF\u9023\u4E0D\u5230\uFF0C\u5DF2\u5B58\u672C\u6A5F\u6700\u4F73\uFF08\u4E4B\u5F8C\u53EF\u81EA\u6211\u6BD4\u5206\uFF09\u3002";
  const rows = strand ? await fetchArenaBoard(a.roomCode, a.strandId, a.season) : null;
  const boardBody = document.createElement("div");
  boardBody.className = "arena-board-body";
  card.appendChild(Object.assign(document.createElement("h4"), { textContent: "\u672C\u6708\u6230\u6CC1\u7246\uFF08\u524D\u4E94\uFF09" }));
  card.appendChild(boardBody);
  if (strand) renderArenaBoard(boardBody, rows, a.roomCode, strand);
}
function mountArenaGhost() {
  removeArenaGhost();
  const quizArea = document.getElementById("quiz-area");
  const host = quizArea?.parentElement;
  if (!host) return;
  const box = document.createElement("div");
  box.id = "arena-ghost";
  box.className = "arena-ghost";
  box.innerHTML = `<div class="arena-ghost-label"></div><div class="arena-ghost-track"><span class="arena-ghost-you"></span></div><div class="arena-ghost-track ghost"><span class="arena-ghost-foe"></span></div><div class="arena-ghost-gap"></div>`;
  host.insertBefore(box, quizArea);
  updateArenaGhost(0);
  if (session?.arena) {
    session.arena.ghostIv = window.setInterval(() => {
      if (!document.getElementById("arena-ghost") || !session?.arena) return;
      updateArenaGhost(session.arena._answered ?? 0);
    }, 1e3);
    pendingTimers.add(session.arena.ghostIv);
  }
}
function updateArenaGhost(answeredCount) {
  const box = document.getElementById("arena-ghost");
  const a = session?.arena;
  if (!box || !a) return;
  a._answered = answeredCount;
  const count = a.count || ARENA_QUESTION_COUNT;
  const perQ = a.ghostSecPerQ || 12;
  const elapsedSec = Math.max(0, (Date.now() - a.startAt) / 1e3);
  const ghostDone = Math.min(count, elapsedSec / perQ);
  box.querySelector(".arena-ghost-label").textContent = `\u{1F3C1} \u4F60 vs ${a.ghostLabel}`;
  box.querySelector(".arena-ghost-you").style.width = `${Math.round(answeredCount / count * 100)}%`;
  box.querySelector(".arena-ghost-foe").style.width = `${Math.round(ghostDone / count * 100)}%`;
  const lead = answeredCount - ghostDone;
  const gap = box.querySelector(".arena-ghost-gap");
  if (answeredCount === 0) gap.textContent = "\u958B\u8DD1\uFF01\u548C\u5E7D\u9748\u6BD4\u8AB0\u5148\u7B54\u5B8C\u53C8\u7B54\u5F97\u5C0D\u3002";
  else if (lead >= 0.15) {
    gap.textContent = `\u9818\u5148\u5E7D\u9748 ${(lead * perQ).toFixed(0)} \u79D2 \u{1F525}`;
    gap.className = "arena-ghost-gap ahead";
  } else if (lead <= -0.15) {
    gap.textContent = `\u843D\u5F8C\u5E7D\u9748 ${(-lead * perQ).toFixed(0)} \u79D2\uFF0C\u52A0\u6CB9\u8FFD\uFF01`;
    gap.className = "arena-ghost-gap behind";
  } else {
    gap.textContent = "\u548C\u5E7D\u9748\u4E26\u99D5\u9F4A\u9A45";
    gap.className = "arena-ghost-gap";
  }
}
function removeArenaGhost() {
  if (session?.arena?.ghostIv) {
    clearInterval(session.arena.ghostIv);
    pendingTimers.delete(session.arena.ghostIv);
    session.arena.ghostIv = null;
  }
  document.getElementById("arena-ghost")?.remove();
}
function renderPvpOutcome(result, quizArea) {
  session.concluded = true;
  const beatOwnBest = session.pvp.totalDmg > session.pvp.startingBest;
  const card = document.createElement("div");
  card.className = "pvp-outcome";
  card.appendChild(Object.assign(document.createElement("h3"), {
    textContent: beatOwnBest ? "\u{1F389} \u6253\u7834\u81EA\u5DF1\u9019\u4EFD\u8003\u5377\u7684\u7D00\u9304\u4E86\uFF01" : "\u9019\u6B21\u7684\u5206\u6578"
  }));
  card.appendChild(Object.assign(document.createElement("p"), {
    textContent: `\u9019\u6B21\u7E3D\u50B7\u5BB3\uFF1A${session.pvp.totalDmg}\uFF08\u6700\u9AD8\u9023\u64CA ${session.pvp.maxCombo}\uFF09`
  }));
  card.appendChild(Object.assign(document.createElement("p"), {
    textContent: `\u76EE\u524D\u6700\u4F73\uFF1A${result.bestDmg}\u30FB\u5DF2\u6311\u6230 ${result.attempts} \u6B21`
  }));
  card.appendChild(Object.assign(document.createElement("p"), {
    className: "pvp-seed-code",
    textContent: `\u6311\u6230\u78BC\uFF1A${session.pvp.seed}\u2014\u2014\u628A\u9019\u4E32\u6578\u5B57\u544A\u8A34\u540C\u5B78\uFF0C\u4ED6\u8F38\u5165\u540C\u4E00\u7D44\u78BC\u958B\u540C\u4E00\u9846\u795E\u6BBF\u7684\u300C\u6311\u6230\u66F8\u300D\uFF0C\u5C31\u6703\u62FF\u5230\u540C\u4E00\u4EFD\u984C\u76EE\uFF0C\u53EF\u4EE5\u4E92\u76F8\u6BD4\u5206\uFF01`
  }));
  const backBtn = document.createElement("button");
  backBtn.className = "q-next";
  backBtn.textContent = "\u56DE\u4E94\u5EA7\u795E\u6BBF";
  backBtn.addEventListener("click", showWorkshop);
  card.appendChild(backBtn);
  quizArea.appendChild(card);
  announce(beatOwnBest ? "\u6253\u7834\u81EA\u5DF1\u7684\u6311\u6230\u66F8\u7D00\u9304" : "\u6311\u6230\u66F8\u7D50\u7B97\u5B8C\u6210");
}
async function startPrerequisiteDiagnostic(node) {
  showView("quiz");
  clearSprintTimer();
  document.getElementById("quiz-node-name").textContent = `${node.name}\u30FB\u5148\u5099\u8A3A\u65B7`;
  document.getElementById("quiz-progressbar").innerHTML = "";
  document.getElementById("quiz-streak").innerHTML = "";
  const quizArea = document.getElementById("quiz-area");
  quizArea.innerHTML = "";
  try {
    const queue = await buildPrerequisiteDiagnostic(node, loadQuestionBank, 5);
    session = newSession({
      queue,
      node,
      mascot: mascotVariantFor(node.id),
      kind: "diagnostic"
    });
    renderCurrentQuestion();
  } catch {
    quizArea.appendChild(Object.assign(document.createElement("p"), {
      className: "strategy-note",
      textContent: "\u5148\u5099\u8A3A\u65B7\u984C\u66AB\u6642\u4E0D\u8DB3\uFF0C\u8ACB\u5148\u8D70\u4E00\u822C\u7CBE\u719F\u8DEF\u5F91\u3002"
    }));
    const backBtn = document.createElement("button");
    backBtn.className = "q-next";
    backBtn.textContent = "\u56DE\u795E\u8A71\u661F\u5716";
    backBtn.addEventListener("click", goHome);
    quizArea.appendChild(backBtn);
    announce("\u5148\u5099\u8A3A\u65B7\u984C\u66AB\u6642\u4E0D\u8DB3\uFF0C\u8ACB\u5148\u8D70\u4E00\u822C\u7CBE\u719F\u8DEF\u5F91");
  }
}
async function startPlacementDiagnostic() {
  showView("quiz");
  clearSprintTimer();
  const quizArea = document.getElementById("quiz-area");
  quizArea.innerHTML = "";
  try {
    const queue = await buildPlacementDiagnostic(tree, loadQuestionBank, 15);
    session = newSession({
      queue,
      node: { id: "placement-diagnostic", name: "5 \u5206\u9418\u5FEB\u901F\u5B9A\u4F4D" },
      mascot: "gauss",
      kind: "placement"
    });
    renderCurrentQuestion();
  } catch {
    quizArea.appendChild(Object.assign(document.createElement("p"), {
      className: "strategy-note",
      textContent: "\u5B9A\u4F4D\u984C\u76EE\u66AB\u6642\u4E0D\u8DB3\uFF0C\u8ACB\u5148\u5F9E\u795E\u8A71\u661F\u5716\u9078\u64C7\u53EF\u6311\u6230\u7684\u6280\u80FD\u3002"
    }));
    const backBtn = document.createElement("button");
    backBtn.className = "q-next";
    backBtn.textContent = "\u56DE\u795E\u8A71\u661F\u5716";
    backBtn.addEventListener("click", goHome);
    quizArea.appendChild(backBtn);
  }
}
function renderProgressBar() {
  const bar = document.getElementById("quiz-progressbar");
  bar.innerHTML = "";
  if (!Number.isFinite(session.plannedTotal) || session.plannedTotal < 1) {
    session.plannedTotal = Math.max(1, session.queue.length);
  }
  const total = session.plannedTotal;
  const answered = Math.min(total, session.index);
  const current = Math.min(total, session.index + 1);
  bar.setAttribute("aria-valuemin", "1");
  bar.setAttribute("aria-valuemax", String(total));
  bar.setAttribute("aria-valuenow", String(current));
  bar.setAttribute("aria-label", `\u7B2C ${current} \u984C\uFF0C\u5171 ${total} \u984C`);
  for (let idx = 0; idx < total; idx += 1) {
    const seg = document.createElement("div");
    seg.className = "seg" + (idx < answered ? " filled" : "");
    bar.appendChild(seg);
  }
}
function renderStreakBadge() {
  const el3 = document.getElementById("quiz-streak");
  el3.innerHTML = "";
  if (session.streak >= 3) {
    const badge = document.createElement("span");
    badge.className = "streak-badge" + (session.streak >= 5 ? " streak-badge-hot" : "");
    badge.textContent = `\u{1F525} \u9023\u8A60 \xD7${session.streak}`;
    el3.appendChild(badge);
  }
}
function renderMasteryProgress(nodeId = session.node?.id) {
  document.getElementById("mastery-progress-live")?.remove();
  if (session.kind !== "node" || !nodeId) return;
  const criteriaProgress = getNodeStats(nodeId).criteriaProgress;
  if (!criteriaProgress) return;
  const panel = document.createElement("section");
  panel.id = "mastery-progress-live";
  panel.className = "mastery-progress-live";
  panel.setAttribute("aria-label", "\u7CBE\u719F\u9032\u5EA6");
  panel.appendChild(Object.assign(document.createElement("strong"), { textContent: "\u7CBE\u719F\u9032\u5EA6 A\u2013E" }));
  Object.entries(criteriaProgress).forEach(([key, criterion]) => {
    const row = document.createElement("div");
    row.className = "mastery-progress-row";
    row.innerHTML = `<span>${key}</span><meter min="0" max="100" value="${criterion.pct}"></meter><small></small>`;
    row.querySelector("small").textContent = criterion.label;
    const encouragement = document.createElement("span");
    encouragement.className = "mastery-encouragement";
    encouragement.textContent = masteryEncouragement(criterion.pct);
    row.appendChild(encouragement);
    panel.appendChild(row);
  });
  document.getElementById("quiz-progressbar").after(panel);
}
function renderGhostLine() {
  document.getElementById("quiz-ghost")?.remove();
  if (session.kind !== "node") return;
  const ghost = store.read(`ghost:${session.node.id}`, null);
  if (!ghost || !ghost.perQuestion || session.index === 0) return;
  const idx = Math.min(session.index, ghost.perQuestion.length) - 1;
  if (idx < 0) return;
  const ghostMs = ghost.perQuestion.slice(0, idx + 1).reduce((acc, q) => acc + q.ms, 0);
  const diffSec = Math.round((ghostMs - session.elapsedTotal) / 1e3);
  const el3 = document.createElement("div");
  el3.id = "quiz-ghost";
  el3.className = "quiz-ghost";
  el3.textContent = diffSec >= 0 ? `\u{1F47B} \u9818\u5148\u4E0A\u6B21\u7684\u4F60 ${diffSec} \u79D2` : `\u{1F47B} \u843D\u5F8C\u4E0A\u6B21\u7684\u4F60 ${-diffSec} \u79D2\u2014\u2014\u8FFD\uFF01`;
  document.getElementById("quiz-progressbar").after(el3);
}
function renderBossPanel(quizArea) {
  const boss = session.boss;
  const meta = bossFor(boss.strandId);
  const phase = bossPhase(boss);
  const panel = document.createElement("section");
  panel.className = "boss-panel";
  panel.setAttribute("aria-label", "\u795E\u6BBF\u8A66\u7149\u8840\u91CF");
  const foe = document.createElement("div");
  foe.className = "boss-side boss-foe";
  foe.innerHTML = `<span class="boss-icon">${meta.icon}</span><strong>${meta.name}</strong>`;
  const foeBar = document.createElement("div");
  foeBar.className = "boss-hp";
  foeBar.innerHTML = `<span class="boss-hp-fill" style="width:${Math.round(boss.hp / boss.maxHp * 100)}%"></span>`;
  foe.appendChild(foeBar);
  const phaseLabel = document.createElement("p");
  phaseLabel.className = `boss-phase boss-phase-${phase.id}`;
  phaseLabel.textContent = `${phase.name}\u30FB${phase.attack}`;
  const me = document.createElement("div");
  me.className = "boss-side boss-player";
  me.innerHTML = "<strong>\u4F60</strong>";
  const meBar = document.createElement("div");
  meBar.className = "boss-hp boss-hp-player";
  meBar.innerHTML = `<span class="boss-hp-fill" style="width:${Math.round(boss.playerHp / boss.playerMaxHp * 100)}%"></span>`;
  me.appendChild(meBar);
  panel.append(foe, phaseLabel, me);
  quizArea.appendChild(panel);
}
function updateBossFeedback(boss, isCorrect) {
  const foe = document.querySelector(".boss-foe");
  const player = document.querySelector(".boss-player");
  if (!foe || !player) return;
  const foeFill = foe.querySelector(".boss-hp-fill");
  const playerFill = player.querySelector(".boss-hp-fill");
  if (foeFill) foeFill.style.width = `${Math.round(boss.hp / boss.maxHp * 100)}%`;
  if (playerFill) playerFill.style.width = `${Math.round(boss.playerHp / boss.playerMaxHp * 100)}%`;
  const event = boss.lastEvent ?? { type: isCorrect ? "hit" : "guard", dmg: 0 };
  const target = event.type === "guard" ? player : foe;
  const float = document.createElement("span");
  float.className = `damage-float damage-${event.type}`;
  float.textContent = event.type === "guard" ? "\u{1F6E1} \u5B88\u4F4F\u4E86" : event.type === "break" ? `\u2726 \u7834\u76FE -${event.dmg}` : event.type === "counter" ? `\u21A9 \u53CD\u64CA -${event.dmg}` : `-${event.dmg}`;
  target.appendChild(float);
  if (event.type !== "guard") target.classList.add("boss-flinch");
  announce(event.type === "guard" ? `${event.attack}\u4F86\u8972\uFF0C\u4F60\u5B88\u4F4F\u4E86\uFF1B\u770B\u770B\u63D0\u793A\u518D\u8A66\u4E00\u6B21` : `${event.phaseName}\uFF0C\u9020\u6210 ${event.dmg} \u9EDE\u50B7\u5BB3`);
  const cleanup = window.setTimeout(() => {
    float.remove();
    if (event.type !== "guard") target.classList.remove("boss-flinch");
    pendingTimers.delete(cleanup);
  }, 700);
  pendingTimers.add(cleanup);
}
function renderBossOutcome(outcome, quizArea) {
  const boss = session.boss;
  session.concluded = true;
  const meta = bossFor(boss.strandId);
  recordBossOutcome(boss.strandId, outcome, session.maxStreak);
  const card = document.createElement("div");
  card.className = `boss-outcome boss-outcome-${outcome}`;
  const title = outcome === "victory" ? `\u{1F3C6} \u64CA\u6557${meta.name}\uFF01\u795E\u6BBF\u7526\u9192\u4E86\u4E00\u89D2` : `\u{1F6E1} \u9019\u6B21\u5148\u64A4\u9000\u2014\u2014${meta.name}\u9084\u5728\u5B88\u8457\u795E\u6BBF`;
  card.appendChild(Object.assign(document.createElement("h3"), { textContent: title }));
  if (outcome === "victory") {
    if (isSfxOn()) sfx.rare();
    card.classList.add("boss-victory-burst");
    const burst = document.createElement("div");
    burst.className = "boss-victory-sparks";
    burst.setAttribute("aria-hidden", "true");
    burst.innerHTML = "\u2726\u2727\u2605\u2726\u2727".split("").map((s) => `<span>${s}</span>`).join("");
    card.appendChild(burst);
    const seed = GUARDIAN_SPIRIT[boss.strandId];
    if (seed) {
      const got = captureSpirit(seed);
      card.appendChild(Object.assign(document.createElement("p"), {
        className: "boss-spirit-drop",
        textContent: got?.isNew ? `\u2726 ${meta.name}\u7559\u4E0B\u4E86\u8CEA\u6578\u7A2E\u5B50\u300C${spiritName(seed)}\u300D\uFF0C\u53BB\u661F\u9748\u878D\u5408\u6BBF\u8A66\u8457\u878D\u5408\u5427\uFF01` : `\u2726 \u53C8\u6536\u670D\u4E00\u9846\u300C${spiritName(seed)}\u300D\uFF0C\u878D\u5408\u6BBF\u898B\u3002`
      }));
    }
  }
  card.appendChild(Object.assign(document.createElement("p"), {
    textContent: outcome === "victory" ? "\u4F60\u7684\u6B63\u78BA\u7387\u628A\u5B88\u8B77\u795E\u7684\u8840\u91CF\u6253\u7A7A\u4E86\u3002\u56DE\u5DE5\u574A\u770B\u770B\u795E\u6BBF\u7526\u9192\u5EA6\u5427\u3002" : "\u9019\u4E00\u8DEF\u7684\u4F5C\u7B54\u90FD\u5DF2\u7D93\u7B97\u9032\u7CBE\u719F\u5EA6\uFF0C\u6C92\u6709\u5931\u53BB\u4EFB\u4F55\u6210\u679C\uFF1B\u770B\u61C2\u63D0\u793A\u5F8C\uFF0C\u518D\u7DF4\u4E00\u8F2A\u5C31\u80FD\u518D\u6311\u6230\u3002"
  }));
  if (outcome !== "victory") {
    const retryBtn = document.createElement("button");
    retryBtn.className = "q-next";
    retryBtn.textContent = "\u518D\u6311\u6230\u4E00\u6B21";
    retryBtn.addEventListener("click", () => startBossFight(boss.strandId));
    card.appendChild(retryBtn);
  }
  const backBtn = document.createElement("button");
  backBtn.className = "q-next";
  backBtn.textContent = "\u56DE\u4E94\u5EA7\u795E\u6BBF";
  backBtn.addEventListener("click", showWorkshop);
  card.appendChild(backBtn);
  quizArea.appendChild(card);
  announce(outcome === "victory" ? `\u64CA\u6557${meta.name}` : "\u795E\u6BBF\u8A66\u7149\u672A\u904E\u95DC\uFF0C\u53EF\u4EE5\u518D\u6311\u6230");
}
var MINI_FOES = ["\u{1F47E}", "\u{1F991}", "\u{1F419}", "\u{1F996}", "\u{1F982}", "\u{1F577}\uFE0F", "\u{1F987}", "\u{1F432}"];
var MINI_FOE_HITS = 3;
function miniFoeState() {
  if (!session.miniFoe) session.miniFoe = { hits: 0, defeated: 0, idx: 0 };
  return session.miniFoe;
}
function renderMiniFoe(container) {
  const s = miniFoeState();
  const strip = document.createElement("div");
  strip.className = "mini-foe";
  strip.id = "mini-foe";
  strip.appendChild(Object.assign(document.createElement("span"), { className: "mini-foe-sprite", textContent: MINI_FOES[s.idx % MINI_FOES.length] }));
  const pips = document.createElement("span");
  pips.className = "mini-foe-pips";
  for (let i = 0; i < MINI_FOE_HITS; i += 1) {
    pips.appendChild(Object.assign(document.createElement("i"), { className: "mini-foe-pip" + (i < s.hits ? " hit" : "") }));
  }
  strip.appendChild(pips);
  strip.appendChild(Object.assign(document.createElement("span"), { className: "mini-foe-tally", textContent: s.defeated > 0 ? `\u5DF2\u64CA\u9000 ${s.defeated} \u96BB` : "\u7B54\u5C0D\u5C31\u6253\u9000\u5C0F\u602A\uFF01" }));
  container.appendChild(strip);
}
function updateMiniFoe(isCorrect) {
  const s = miniFoeState();
  const strip = document.getElementById("mini-foe");
  if (!isCorrect) {
    strip?.classList.add("mini-foe-miss");
    return;
  }
  s.hits += 1;
  const sprite = strip?.querySelector(".mini-foe-sprite");
  const pips = strip?.querySelectorAll(".mini-foe-pip");
  if (pips && pips[s.hits - 1]) pips[s.hits - 1].classList.add("hit");
  if (sprite) {
    sprite.classList.remove("mini-foe-shake");
    void sprite.offsetWidth;
    sprite.classList.add("mini-foe-shake");
  }
  if (s.hits >= MINI_FOE_HITS) {
    s.hits = 0;
    s.defeated += 1;
    s.idx += 1;
    if (sprite) {
      sprite.classList.add("mini-foe-defeated");
      const burst = document.createElement("span");
      burst.className = "mini-foe-burst";
      burst.textContent = "\u{1F4A5}";
      strip?.appendChild(burst);
    }
    if (isSfxOn()) sfx.correct(2);
  }
}
var advancedThisQuestion = false;
function advanceQuestion() {
  if (advancedThisQuestion) return;
  advancedThisQuestion = true;
  session.index += 1;
  saveActiveSession();
  renderCurrentQuestion(true);
}
function renderCurrentQuestion(focusStem = false) {
  const quizArea = document.getElementById("quiz-area");
  preloadMascot(session.mascot);
  quizArea.innerHTML = "";
  if (session.kind !== "arena") removeArenaGhost();
  document.getElementById("quiz-node-name").textContent = session.node.name;
  if (session.kind === "boss") {
    const outcome = bossOutcome(session.boss);
    if (outcome === "defeat" && session.boss.freeRetryAvailable) {
      session.boss = { ...reviveWithBlessing(session.boss), freeRetryAvailable: false };
      announce("\u795E\u8AED\u5377\u8EF8\u7684\u795D\u798F\u767C\u52D5\uFF0C\u8840\u91CF\u56DE\u5FA9\u4E00\u534A\uFF0C\u518D\u6490\u4E00\u4E0B\uFF01");
    } else if (outcome) {
      renderBossOutcome(outcome, quizArea);
      return;
    }
    renderBossPanel(quizArea);
  } else {
    renderProgressBar();
  }
  renderMasteryProgress();
  renderStreakBadge();
  renderGhostLine();
  if (session.index >= session.queue.length) {
    if (session.kind === "boss") {
      renderBossOutcome("retreat", quizArea);
      return;
    }
    if (session.kind === "pvp") {
      const result = recordPvpRun(session.pvp.seed, session.pvp.strandId, {
        totalDmg: session.pvp.totalDmg,
        maxCombo: session.pvp.maxCombo
      });
      renderPvpOutcome(result, quizArea);
      return;
    }
    if (session.kind === "arena") {
      finishArenaSession(quizArea);
      return;
    }
    finishSession();
    return;
  }
  const question = session.queue[session.index];
  session.qStartAt = Date.now();
  if (session.strategy === "sprint" && !question._mentorCoaching) startSprintTimer();
  else clearSprintTimer();
  const guardianStrand = strandIdForNode(question._nodeId ?? question._placementNodeId ?? session.node?.id);
  const opts = { encounter: session.index === session.encounterIdx, guardianStrand };
  if (session.kind === "node") renderMiniFoe(quizArea);
  if (question._mentorCoaching) {
    quizArea.appendChild(Object.assign(document.createElement("div"), {
      className: "mentor-coaching-line",
      textContent: question._mentorLine
    }));
  }
  const card = renderQuestion(question, (isCorrect, meta) => handleAnswer(question, isCorrect, meta), session.mascot, opts);
  if (question._mentorCoaching) card.classList.add("mentor-coaching-question");
  if (session.streak >= 3) card.classList.add("streak-active");
  if (session.streak >= 5) card.classList.add("streak-hot");
  quizArea.appendChild(card);
  card.scrollIntoView({ block: "start", behavior: "auto" });
  if (focusStem) {
    const stem = card.querySelector(".q-stem");
    if (stem) {
      stem.tabIndex = -1;
      stem.focus({ preventScroll: true });
    }
  }
  const nextBtn = document.createElement("button");
  nextBtn.className = "q-next q-next-hidden";
  nextBtn.textContent = session.index === session.queue.length - 1 ? "\u770B\u6210\u679C" : "\u4E0B\u4E00\u984C";
  advancedThisQuestion = false;
  nextBtn.addEventListener("click", advanceQuestion);
  quizArea.appendChild(nextBtn);
  nextBtnEl = nextBtn;
  const leaveBtn = document.createElement("button");
  leaveBtn.type = "button";
  leaveBtn.className = "quiz-leave-btn";
  const keepsProgress = session.kind === "node";
  leaveBtn.textContent = keepsProgress ? "\u5148\u96E2\u958B\uFF08\u9032\u5EA6\u6703\u4FDD\u7559\uFF09" : "\u5148\u96E2\u958B";
  leaveBtn.addEventListener("click", () => {
    if (keepsProgress) saveActiveSession();
    showView("home");
  });
  quizArea.appendChild(leaveBtn);
}
function handleAnswer(question, isCorrect, meta = {}) {
  recordActivityStreak();
  const nodeId = question._nodeId ?? question._placementNodeId ?? session.node.id;
  const elapsed = Math.max(0, Date.now() - session.qStartAt);
  const isAssessment = session.kind === "diagnostic" || session.kind === "placement";
  const wasReviewDue = !isAssessment && hasRecord(question.id) && isDue(question.id);
  const node = allNodes(tree).find((item) => item.id === nodeId) ?? {};
  if (!isAssessment) {
    recordAnswer(nodeId, question, isCorrect, elapsed, node);
    updateBox(question.id, isCorrect, nodeId);
  }
  session.roundTotal += 1;
  session.elapsedTotal += elapsed;
  session.perQuestion.push({ c: isCorrect ? 1 : 0, ms: elapsed, at: Date.now() });
  if (wasReviewDue) bumpDaily("review");
  if (isCorrect) {
    if (question._mentorCoaching) {
      const transition = mentorCoachingTransition({
        consecutiveWrong: session.consecutiveWrong,
        retryUsed: session.mentorRetryUsed
      }, true);
      session.consecutiveWrong = transition.consecutiveWrong;
      session.mentorRetryUsed = transition.retryUsed;
    } else {
      session.consecutiveWrong = 0;
      session.mentorRetryUsed = false;
    }
    session.roundCorrect += 1;
    session.streak += 1;
    if (session.streak === 5) session.streakShielded = false;
    session.maxStreak = Math.max(session.maxStreak, session.streak);
    const best = Number(store.read("bestStreak", 0)) || 0;
    if (session.streak > best) store.write("bestStreak", session.streak);
    sfx.correct(session.streak);
    if (session.kind !== "boss") showComboPop(session.streak);
    showStreakMilestone(session.streak);
    if (question._retry) session.retryDone += 1;
    if (session.strategy === "sprint" && elapsed <= SPRINT_LIMIT_MS) {
      session.fastCount += 1;
    }
    if (!isAssessment && question._fromErrorbook) {
      removeWrongQuestion(question.id);
      session.repairedCount += 1;
      bumpDaily("repair");
    }
    if (meta.encounter) meta.encounterReward = handleEncounterWin();
  } else {
    const streakBeforeWrong = session.streak;
    const mentorTransition = question._mentorCoaching ? mentorCoachingTransition({
      consecutiveWrong: session.consecutiveWrong,
      retryUsed: session.mentorRetryUsed
    }, false) : null;
    session.consecutiveWrong = mentorTransition?.consecutiveWrong ?? session.consecutiveWrong + 1;
    if (mentorTransition) session.mentorRetryUsed = mentorTransition.retryUsed;
    if (session.streak >= 5 && !session.streakShielded) {
      session.streakShielded = true;
      session.streak = Math.max(0, session.streak - 2);
      showToast("\u{1F6E1} \u9023\u8A60\u8B77\u76FE\u767C\u52D5\uFF01\u9019\u6B21\u53EA\u6389 2 \u9023\u8A60", "success");
    } else {
      session.streak = 0;
      session.streakShielded = false;
    }
    sfx.wrong();
    const settings = getAccessibilitySettings();
    if (streakBeforeWrong > 0 && settings.comboBreakEffect) {
      const quizArea = document.getElementById("quiz-area");
      quizArea?.classList.remove("combo-break");
      requestAnimationFrame(() => quizArea?.classList.add("combo-break"));
      scheduleTimer(() => quizArea?.classList.remove("combo-break"), 500);
    }
    if (!isAssessment) addWrongQuestion(nodeId, question);
    if (!isAssessment && session.strategy === "slow" && !question._retry) {
      session.queue.push({ ...question, _retry: true });
    }
    if (mentorTransition?.insertRetry) {
      insertMentorCoachingQuestion(
        session.queue,
        session.index,
        [question],
        question._mentorLine,
        Math.random,
        { nodeId, nodeName: node.name ?? nodeId }
      );
    } else if (session.kind === "node" && !question._mentorCoaching && session.consecutiveWrong >= 3) {
      const comfort = QUOTES.comfort.filter((quote2) => quote2.mascot === session.mascot);
      const candidates = comfort.length > 0 ? comfort : QUOTES.comfort;
      const quote = candidates[Math.floor(Math.random() * candidates.length)];
      const inserted = insertMentorCoachingQuestion(
        session.queue,
        session.index,
        [...session.mentorPool, ...session.queue],
        quote?.text ?? "\u5225\u6025\uFF0C\u6211\u5011\u5148\u5598\u53E3\u6C23\uFF0C\u7DF4\u4E00\u984C\u7C21\u55AE\u7684",
        Math.random,
        { nodeId, nodeName: node.name ?? nodeId }
      );
      if (inserted) session.mentorRetryUsed = false;
    }
  }
  if (session.kind === "boss" && session.boss) {
    const strandNodeIds = (tree.strands.find((s) => s.id === session.boss.strandId)?.nodes ?? []).map((n) => n.id);
    const gearBonus = collectionBonusFor(strandNodeIds, getCollection(), getRareStamps()) + spiritBonusFor();
    const bonus = session.streak >= 3 ? gearBonus : 0;
    session.boss = applyAnswer(session.boss, isCorrect, session.streak, bonus);
    updateBossFeedback(session.boss, isCorrect);
  }
  if (session.kind === "pvp" && session.pvp && isCorrect) {
    session.pvp.totalDmg += playerDamage(session.streak, 100, 100, 0);
    session.pvp.maxCombo = Math.max(session.pvp.maxCombo, session.streak);
  }
  if (session.kind === "arena" && session.arena) {
    if (isCorrect) {
      session.arena.correct += 1;
      session.arena.totalDmg += playerDamage(session.streak, 100, 100, 0);
      session.arena.maxCombo = Math.max(session.arena.maxCombo, session.streak);
    }
    updateArenaGhost(session.index + 1);
  }
  renderStreakBadge();
  renderMasteryProgress(nodeId);
  saveActiveSession(1);
  if (nextBtnEl) nextBtnEl.textContent = session.index === session.queue.length - 1 ? "\u770B\u6210\u679C" : "\u4E0B\u4E00\u984C";
  nextBtnEl?.classList.remove("q-next-hidden");
  nextBtnEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (session.strategy === "sprint" && isCorrect && session.kind === "node" && !question._mentorCoaching && session.index < session.queue.length - 1) {
    const scheduledIndex = session.index;
    scheduleTimer(() => {
      if (session.index === scheduledIndex) advanceQuestion();
    }, SPRINT_AUTONEXT_MS);
  }
  if (session.kind === "node") updateMiniFoe(isCorrect);
  const messages = [isCorrect ? "\u7B54\u5C0D\u4E86\uFF01" : `\u7B54\u932F\u4E86\uFF0C\u6B63\u89E3\u662F\uFF1A\u9078\u9805${meta.correctLabel ?? ""}\u300C${meta.correctText ?? ""}\u300D`];
  if (session.streak >= 3) messages.push(`\u9023\u8A60 ${session.streak}`);
  if (meta.encounterReward?.type === "stamp") messages.push(`\u767C\u73FE\u7A00\u6709\u5370\u8A18\uFF1A${meta.encounterReward.stamp.name}`);
  if (meta.encounterReward?.type === "stardust") messages.push(meta.encounterReward.message);
  messages.push("\u4E0B\u4E00\u984C\u6309\u9215\u5DF2\u51FA\u73FE");
  announce(messages.join("\u3002"));
  showStorageNoticeIfNeeded();
}
function handleEncounterWin() {
  const nodeId = session.queue[session.index]?._nodeId ?? session.node.id;
  const reward = resolveEncounterReward(nodeId, session.mascot);
  if (!reward) return null;
  sfx.correct();
  const card = document.querySelector("#quiz-area .q-card");
  if (reward.type === "stamp") {
    session.rareDrops.push(reward.stamp);
    if (card) {
      const rare = document.createElement("div");
      rare.className = "rare-stamp";
      rare.textContent = `${reward.stamp.sym} ${reward.stamp.name}\u30FB${reward.stamp.rarity}`;
      card.appendChild(rare);
    }
  } else {
    session.stardustEarned += reward.amount;
    if (card) {
      const stardust = document.createElement("div");
      stardust.className = "stardust-drop";
      stardust.textContent = reward.message;
      card.appendChild(stardust);
    }
  }
  const primePool = [13, 17, 19, 23, 29, 31, 37, 41, 43, 47];
  const prime = primePool[Math.floor(Math.random() * primePool.length)];
  const gotSpirit = captureSpirit(prime);
  if (card) {
    const spiritLine = document.createElement("div");
    spiritLine.className = "stardust-drop spirit-drop";
    spiritLine.textContent = gotSpirit?.isNew ? `\u2726 \u795E\u8AED\u6307\u5F15\u4E00\u9846\u8CEA\u9748\u300C${spiritName(prime)}\u300D\u5165\u4F60\u7684\u661F\u9748\u5716\u9451` : `\u2726 \u518D\u6536\u4E00\u9846\u300C${spiritName(prime)}\u300D`;
    card.appendChild(spiritLine);
  }
  return reward;
}
function finishSession() {
  session.concluded = true;
  clearSprintTimer();
  if (RESUMABLE_KINDS.has(session.kind)) clearActiveSession();
  if (session.kind === "diagnostic") {
    finishPrerequisiteDiagnostic();
    return;
  }
  if (session.kind === "placement") {
    finishPlacementDiagnostic();
    return;
  }
  if (session.roundTotal > 0 && session.roundCorrect / session.roundTotal >= 0.5) {
    bumpDaily("rounds");
  }
  store.write("lastPlayed", { at: Date.now(), nodeName: session.node.name });
  const overview = computeOverview(tree);
  const workshop = workshopSnapshot();
  const isMasterTrial = session.kind === "master";
  const roundPct = session.roundTotal > 0 ? session.roundCorrect / session.roundTotal : 0;
  const ctx2 = {
    masteredCount: overview.masteredCount,
    totalNodes: overview.totalNodes,
    lastRoundAllCorrect: session.roundTotal >= 5 && session.roundCorrect === session.roundTotal,
    currentStreak: session.maxStreak,
    masterTrialPassed: isMasterTrial && session.roundTotal > 0 && roundPct >= 0.9,
    encounterWins: store.read("encounterWins", 0),
    rooms: workshop.rooms,
    workshopRestored: workshop.allRestored,
    sparring: session.kind === "challenge"
  };
  const newBadges = evaluateBadges(ctx2);
  if (session.kind === "node" && session.perQuestion.length > 0) {
    store.write(`ghost:${session.node.id}`, {
      perQuestion: session.perQuestion,
      totalMs: session.elapsedTotal,
      at: Date.now()
    });
  }
  if (isMasterTrial && session.roundTotal > 0) {
    const best = store.read("masterTrialBest", null);
    if (!best || roundPct > best.pct) {
      store.write("masterTrialBest", { pct: roundPct, at: Date.now() });
    }
  }
  let trialSettlement = null;
  if (isMasterTrial && session.roundTotal > 0) {
    trialSettlement = settleMasterTrialTier(
      session.trialTier ?? "bronze",
      roundPct,
      store.read("masterTrialTiers", {})
    );
    store.write("masterTrialTiers", trialSettlement.records);
    if (trialSettlement.rewardStardust > 0) {
      addStardust(trialSettlement.rewardStardust);
      session.stardustEarned += trialSettlement.rewardStardust;
    }
  }
  let weeklyRecord = null;
  if (session.kind === "weekly" && session.roundTotal > 0) {
    weeklyRecord = submitWeeklyResult(
      Math.round(roundPct * 100),
      Math.round(session.elapsedTotal / 1e3),
      session.maxStreak,
      { questionCount: session.roundTotal, answerLog: session.perQuestion }
    );
    syncWeeklyResultToServer(weeklyRecord);
  }
  let challengeReply = null;
  if (session.kind === "challenge" && session.challengeCode) {
    challengeReply = {
      code: encodeReply(session.challengeCode, Math.round(roundPct * 100), Math.round(session.elapsedTotal / 1e3)),
      pct: Math.round(roundPct * 100),
      totalSec: Math.round(session.elapsedTotal / 1e3)
    };
    store.write("lastChallengeResult", { ...challengeReply, challengeCode: session.challengeCode, at: Date.now() });
    unlockBadge("sparring");
  }
  document.getElementById("quiz-streak").innerHTML = "";
  document.getElementById("quiz-ghost")?.remove();
  const quizArea = document.getElementById("quiz-area");
  quizArea.innerHTML = "";
  const stats = session.kind === "node" ? getNodeStats(session.node.id) : { masteryPct: roundPct, totalAttempts: session.roundTotal };
  const nextStep = session.kind === "node" ? nextStepRecommendation(stats, session.wasMasteredAtStart) : null;
  const replayAction = isMasterTrial ? { label: `\u26A1 \u518D\u6311\u6230\u4E00\u6B21\u8CE2\u8005\u8A66\u7149\u30FB${session.node.name}`, start: () => startMasterTrial(session.trialTier ?? "bronze") } : session.kind === "weekly" ? { label: "\u26A1 \u518D\u6311\u6230\u4E00\u6B21\u672C\u9031\u795E\u6BBF\u76C3", start: startWeeklySession } : null;
  if (nextStep?.kind === "just-mastered") sfx.rare();
  const newDrops = session.kind === "node" || isMasterTrial ? evaluateCollection(session.node.id, stats, ctx2) : [];
  const summaryEl = makeSummary(stats, newBadges, newDrops, weeklyRecord, challengeReply, nextStep);
  quizArea.appendChild(summaryEl);
  announce(`\u672C\u8F2A\u5B8C\u6210\uFF0C\u7B54\u5C0D ${session.roundCorrect}/${session.roundTotal} \u984C`);
  const summaryHeading = summaryEl.querySelector("h3") ?? summaryEl;
  summaryHeading.tabIndex = -1;
  summaryHeading.focus({ preventScroll: true });
  newDrops.forEach((drop) => showCardReveal(
    drop.item,
    drop.item.id === MASTER_TRIAL_ID ? "\u50B3\u8AAA" : drop.tier >= 2 ? "\u7A00\u6709" : "\u666E\u901A"
  ));
  if (newDrops.some((drop) => drop.tier >= 2)) {
    const starterPool = [4, 6, 8, 9, 10, 12];
    const composite = starterPool[Math.floor(Math.random() * starterPool.length)];
    const gotSpirit = captureSpirit(composite);
    if (gotSpirit?.isNew) showToast(`\u2726 \u7CBE\u719F\u734E\u52F5\uFF1A\u6536\u670D\u661F\u9748\u300C${spiritName(composite)}\u300D\uFF0C\u878D\u5408\u6BBF\u898B`, "success");
  }
  const player = getPlayerName();
  if (player) {
    const nodeIds = allNodes(tree).filter((n) => !n.contentPending).map((n) => n.id);
    submitScore(player, overallMasteryPct(nodeIds));
  }
  if (nextStep) {
    const retryBtn = document.createElement("button");
    retryBtn.className = "q-next";
    retryBtn.textContent = nextStep.label;
    retryBtn.addEventListener("click", () => startQuizWithStrategy(session.node, session.strategy ?? "slow"));
    quizArea.appendChild(retryBtn);
  } else if (replayAction) {
    const replayBtn = document.createElement("button");
    replayBtn.className = "q-next";
    replayBtn.textContent = replayAction.label;
    replayBtn.addEventListener("click", replayAction.start);
    quizArea.appendChild(replayBtn);
  }
  const backBtn = document.createElement("button");
  backBtn.className = `q-next${nextStep || replayAction ? " q-next-secondary" : ""}`;
  backBtn.textContent = "\u56DE\u795E\u8A71\u661F\u5716";
  backBtn.addEventListener("click", goHome);
  quizArea.appendChild(backBtn);
}
function finishPlacementDiagnostic() {
  const completedAt = Date.now();
  const nodesById = Object.fromEntries(allNodes(tree).map((node) => [node.id, node]));
  const progress = applyPlacementDiagnostic(
    store.read("progress", {}),
    session.queue,
    session.perQuestion.map((answer) => answer.c === 1),
    nodesById,
    completedAt
  );
  store.write("progress", progress);
  const testedIds = [...new Set(session.queue.map((question) => question._placementNodeId).filter(Boolean))];
  const passed = testedIds.filter((id) => progress[id]?.placementDiagnostic?.completedAt === completedAt && progress[id].placementDiagnostic.passed);
  const quizArea = document.getElementById("quiz-area");
  quizArea.innerHTML = "";
  const summary = document.createElement("section");
  summary.className = "q-summary placement-summary";
  summary.appendChild(Object.assign(document.createElement("h3"), { textContent: "\u5FEB\u901F\u5B9A\u4F4D\u5B8C\u6210" }));
  summary.appendChild(Object.assign(document.createElement("p"), {
    textContent: passed.length > 0 ? `\u4F9D\u4F60\u7684\u5BE6\u969B\u4F5C\u7B54\uFF0C\u5DF2\u9EDE\u4EAE\uFF1A${passed.map((id) => nodesById[id]?.name ?? id).join("\u3001")}\u3002\u795E\u8A71\u661F\u5716\u5DF2\u958B\u51FA\u66F4\u63A5\u8FD1\u4F60\u7684\u8D77\u9EDE\u3002` : "\u9019\u6B21\u5148\u4FDD\u7559\u539F\u672C\u8D77\u9EDE\uFF1B\u795E\u8A71\u661F\u5716\u6703\u5F9E\u57FA\u790E\u958B\u59CB\uFF0C\u4E4B\u5F8C\u4E5F\u80FD\u4F7F\u7528\u5404\u7BC0\u9EDE\u7684\u5148\u5099\u8A3A\u65B7\u6377\u5F91\u3002"
  }));
  quizArea.appendChild(summary);
  const backBtn = document.createElement("button");
  backBtn.className = "q-next";
  backBtn.textContent = "\u67E5\u770B\u6211\u7684\u65B0\u8D77\u9EDE";
  backBtn.addEventListener("click", goHome);
  quizArea.appendChild(backBtn);
  announce(`\u5FEB\u901F\u5B9A\u4F4D\u5B8C\u6210\uFF0C\u9EDE\u4EAE ${passed.length} \u500B\u6280\u80FD\u8D77\u9EDE`);
}
function finishPrerequisiteDiagnostic() {
  const answers = session.perQuestion.map((answer) => answer.c === 1);
  const diagnosticResult = evaluatePrerequisiteDiagnostic(session.queue, answers);
  const progress = applyDiagnosticResult(
    store.read("progress", {}),
    session.node.id,
    diagnosticResult
  );
  store.write("progress", progress);
  document.getElementById("quiz-streak").innerHTML = "";
  document.getElementById("mastery-progress-live")?.remove();
  const quizArea = document.getElementById("quiz-area");
  quizArea.innerHTML = "";
  const summary = document.createElement("section");
  summary.className = "q-summary diagnostic-summary";
  const heading = document.createElement("h3");
  heading.textContent = diagnosticResult.passed ? "\u5148\u5099\u8A3A\u65B7\u901A\u904E\uFF01" : "\u5148\u88DC\u4E00\u5C0F\u584A\uFF0C\u5C31\u80FD\u518D\u6311\u6230";
  summary.appendChild(heading);
  const detail = document.createElement("p");
  if (diagnosticResult.passed) {
    detail.textContent = `\u7B54\u5C0D ${diagnosticResult.correctCount}/${diagnosticResult.total} \u984C\uFF0C\u5DF2\u76F4\u63A5\u89E3\u9396\u300C${session.node.name}\u300D\u3002`;
  } else {
    const nodeIndex = Object.fromEntries(allNodes(tree).map((node) => [node.id, node]));
    const gapNames = diagnosticResult.gapNodeIds.map((id) => nodeIndex[id]?.name ?? id);
    detail.textContent = `\u7B54\u5C0D ${diagnosticResult.correctCount}/${diagnosticResult.total} \u984C\uFF1B\u9084\u8981\u88DC\u5F37\uFF1A${gapNames.join("\u3001")}\u3002`;
  }
  summary.appendChild(detail);
  quizArea.appendChild(summary);
  const action = document.createElement("button");
  action.className = "q-next";
  action.textContent = diagnosticResult.passed ? `\u9032\u5165\u300C${session.node.name}\u300D` : "\u518D\u505A\u4E00\u6B21\u5148\u5099\u8A3A\u65B7";
  action.addEventListener("click", () => diagnosticResult.passed ? startQuiz(session.node) : startPrerequisiteDiagnostic(session.node));
  quizArea.appendChild(action);
  const backBtn = document.createElement("button");
  backBtn.className = "q-next q-next-secondary";
  backBtn.textContent = "\u56DE\u795E\u8A71\u661F\u5716";
  backBtn.addEventListener("click", goHome);
  quizArea.appendChild(backBtn);
  announce(diagnosticResult.passed ? `\u5148\u5099\u8A3A\u65B7\u901A\u904E\uFF0C\u5DF2\u89E3\u9396${session.node.name}` : detail.textContent);
}
function roundStars(roundTotal, roundCorrect) {
  if (roundTotal === 0) return 0;
  const pct = roundCorrect / roundTotal;
  if (pct >= 0.95) return 3;
  if (pct >= 0.8) return 2;
  if (pct >= 0.6) return 1;
  return 0;
}
function strategySummaryBits() {
  if (!session.strategy) return { tile: "", note: "" };
  if (session.strategy === "slow") {
    return {
      tile: `<div class="report-tile"><strong>${session.retryDone}</strong><div>\u88DC\u63CF\u6210\u529F</div></div>`,
      note: session.retryDone > 0 ? "\u601D\u8DEF\u8D70\u7A69\u4E86\u2014\u2014\u91CD\u65B0\u7B54\u5C0D\u7684\u984C\u76EE\uFF0C\u5C31\u662F\u4F60\u7684\u4E86\u3002" : "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\uFF1A\u7A69\u5B9A\u7684\u63A8\u7406\uFF0C\u662F\u4E00\u6B65\u4E00\u6B65\u8D70\u51FA\u4F86\u7684\u3002"
    };
  }
  if (session.strategy === "repair") {
    return {
      tile: `<div class="report-tile"><strong>${session.repairedCount}/${session.repairTotal}</strong><div>\u6536\u670D\u5C0F\u9B54\u7269</div></div>`,
      note: session.repairedCount > 0 ? "\u5377\u8EF8\u4E0A\u7684\u8FF7\u9727\u8B8A\u6DE1\u4E86\uFF01" : "\u9084\u6709\u5E7E\u8655\u8FF7\u9727\uFF0C\u7B49\u4F60\u56DE\u4F86\u89E3\u958B\u3002"
    };
  }
  return {
    tile: `<div class="report-tile"><strong>${session.fastCount}/${session.roundTotal}</strong><div>\u75BE\u7B46</div></div>`,
    note: session.fastCount >= 6 ? "\u96C5\u5178\u5A1C\u7684\u667A\u6167\u5F15\u8DEF\u4EBA\u5411\u4F60\u9EDE\u982D\u3002" : "\u601D\u8003\u8207\u901F\u5EA6\u90FD\u6703\u8D8A\u7DF4\u8D8A\u7A69\u3002"
  };
}
function makeSummary(stats, newBadges, newDrops = [], weeklyRecord = null, challengeReply = null, nextStep = null) {
  const box = document.createElement("div");
  box.className = "q-summary";
  if (nextStep?.kind === "just-mastered") {
    box.appendChild(Object.assign(document.createElement("div"), {
      className: "mastery-complete-banner",
      textContent: "\u2726 \u795E\u8AED\u5377\u8EF8\u5B8C\u5377\uFF01"
    }));
  }
  const milestones = claimStardustMilestones(getStardustCount());
  if (milestones.newlyUnlocked.length > 0) {
    sfx.rare();
    box.appendChild(Object.assign(document.createElement("div"), {
      className: "stardust-milestone-celebration",
      textContent: `\u2726 \u661F\u5C51\u91CC\u7A0B\u7891\uFF1A\u74F6\u4E2D\u5DF2\u805A\u96C6 ${milestones.newlyUnlocked.at(-1)} \u7C92\u661F\u5149\uFF01`
    }));
  }
  const stars = roundStars(session.roundTotal, session.roundCorrect);
  const mascotState = stars >= 2 ? "celebrate" : stars >= 1 ? "happy" : "idle";
  const guardianImage = guardianImageForStrand(strandIdForNode(session.node?.id));
  if (guardianImage || session.mascot) {
    const mascotBox = document.createElement("div");
    mascotBox.className = "summary-mascot";
    const img = document.createElement("img");
    img.src = guardianImage ?? globalThis.mathAsset(`assets/mascot/${session.mascot}-${mascotState}.png`);
    img.alt = guardianImage ? "\u795E\u6BBF\u5B88\u8B77\u8005" : "\u667A\u6167\u5F15\u8DEF\u4EBA";
    img.onerror = () => {
      mascotBox.style.display = "none";
    };
    mascotBox.appendChild(img);
    box.appendChild(mascotBox);
  }
  const starsBox = document.createElement("div");
  starsBox.className = "summary-stars";
  for (let i = 0; i < 3; i++) {
    const s = document.createElement("span");
    s.className = "star" + (i < stars ? " lit" : "");
    s.textContent = "\u2605";
    s.style.animationDelay = `${i * 0.15}s`;
    starsBox.appendChild(s);
    if (i < stars) scheduleTimer(() => sfx.star(i), 150 * i + 200);
  }
  box.appendChild(starsBox);
  const quote = pickQuote(stars, session.mascot);
  if (quote) {
    const note = document.createElement("div");
    note.className = "quote-note";
    note.innerHTML = `<div class="quote-text"></div><div class="quote-by"></div>`;
    note.querySelector(".quote-text").textContent = quote.text;
    note.querySelector(".quote-by").textContent = quote.by ? `\u2014\u2014${quote.by}` : "";
    box.appendChild(note);
  }
  box.appendChild(Object.assign(document.createElement("h3"), {
    textContent: `\u672C\u7BC0\u9EDE\u6230\u529B\u503C\uFF1A${Math.round(stats.masteryPct * 100)}%`
  }));
  if (stats.feedback && !stats.mastered) {
    box.appendChild(Object.assign(document.createElement("div"), {
      className: "strategy-note",
      textContent: stats.feedback
    }));
  }
  if (weeklyRecord) {
    const w = document.createElement("div");
    w.className = "weekly-result";
    const isNewBest = weeklyRecord.pct === Math.round(session.roundCorrect / session.roundTotal * 100);
    w.innerHTML = `<div class="weekly-result-title">\u{1F3C6} ${isNewBest ? "\u672C\u9031\u6230\u7E3E\u795E\u8AED" : "\u672C\u9031\u6700\u4F73\u6230\u7E3E\u795E\u8AED\uFF08\u9019\u5834\u6C92\u5237\u65B0\uFF09"}</div>`;
    const code = document.createElement("code");
    code.textContent = weeklyRecord.code;
    w.appendChild(code);
    const copy = document.createElement("button");
    copy.className = "daily-btn";
    copy.textContent = "\u8907\u88FD\u7D66\u540C\u5B78";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(weeklyRecord.code);
        copy.textContent = "\u5DF2\u8907\u88FD\uFF01";
      } catch {
      }
    });
    w.appendChild(copy);
    box.appendChild(w);
  }
  if (challengeReply) {
    const result = document.createElement("div");
    result.className = "challenge-result";
    result.innerHTML = `<div class="weekly-result-title">\u2694 \u56DE\u64CA\u795E\u8AED\u30FB${challengeReply.pct}% \u30FB ${challengeReply.totalSec} \u79D2</div>
      <code>${challengeReply.code}</code><p>\u8907\u88FD\u7D66\u51FA\u984C\u540C\u5B78\uFF0C\u4ED6\u8F38\u5165\u5F8C\u4E5F\u6703\u7372\u5F97\u300C\u5207\u78CB\u7AE0\u300D\u3002</p>`;
    const copy = document.createElement("button");
    copy.className = "daily-btn";
    copy.textContent = "\u8907\u88FD\u56DE\u64CA\u795E\u8AED";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(challengeReply.code);
        copy.textContent = "\u5DF2\u8907\u88FD\uFF01";
      } catch {
      }
    });
    result.appendChild(copy);
    box.appendChild(result);
  }
  session.rareDrops.forEach((stamp) => {
    const drop = document.createElement("div");
    drop.className = "ms-drop rare-drop";
    const sym = document.createElement("div");
    sym.className = "ms-sym";
    sym.textContent = stamp.sym;
    const text = document.createElement("div");
    text.className = "ms-drop-text";
    text.textContent = `\u2726 \u7A00\u6709\u5370\u8A18\u51FA\u571F\uFF1A${stamp.name}\uFF01\u6536\u9032\u795E\u8A71\u5370\u8A18\u5716\u9451\u4E86`;
    drop.appendChild(sym);
    drop.appendChild(text);
    box.appendChild(drop);
  });
  if (session.stardustEarned > 0) {
    const drop = document.createElement("div");
    drop.className = "ms-drop stardust-drop";
    drop.textContent = `\u2726 \u672C\u8F2A\u6709 ${session.stardustEarned} \u7C92\u661F\u5C51\u6CE8\u5165\u74F6\u4E2D`;
    box.appendChild(drop);
  }
  newDrops.forEach((d) => {
    const drop = document.createElement("div");
    drop.className = "ms-drop" + (d.tier === 2 ? " ms-drop-sealed" : "");
    const sym = document.createElement("div");
    sym.className = "ms-sym";
    sym.textContent = d.item.sym;
    const text = document.createElement("div");
    text.className = "ms-drop-text";
    text.textContent = d.tier === 2 ? `\u{1F58B} \u96C5\u5178\u5A1C\u881F\u5C01\uFF1A${d.item.name}\u2014\u2014\u9019\u4E00\u5377\uFF0C\u6B63\u5F0F\u662F\u4F60\u7684\u4E86` : `\u{1F4DC} \u65B0\u795E\u8AED\u5377\u8EF8\u5165\u5EAB\uFF1A${d.item.name}\u2014\u2014\u6536\u9032\u4F60\u7684\u795E\u8AED\u5377\u8EF8\u96C6\u4E86`;
    drop.appendChild(sym);
    drop.appendChild(text);
    if (d.tier === 2) drop.appendChild(Object.assign(document.createElement("div"), { className: "ms-seal", textContent: "\u881F\u5C01" }));
    box.appendChild(drop);
  });
  const strategyBits = strategySummaryBits();
  const totalSec = Math.round(session.elapsedTotal / 1e3);
  const reports = document.createElement("div");
  reports.className = "summary-reports";
  reports.innerHTML = `
    <div class="report-tile"><strong>${Math.round(session.roundCorrect / session.roundTotal * 100) || 0}%</strong><div>\u672C\u8F2A\u6B63\u78BA\u7387</div></div>
    <div class="report-tile"><strong>${totalSec}s</strong><div>\u672C\u8F2A\u7528\u6642</div></div>
    <div class="report-tile"><strong>${session.maxStreak}</strong><div>\u6700\u9577\u9023\u8A60</div></div>
    ${strategyBits.tile || `<div class="report-tile"><strong>${stats.totalAttempts}</strong><div>\u7D2F\u8A08\u4F5C\u7B54</div></div>`}
  `;
  box.appendChild(reports);
  if (strategyBits.note) {
    box.appendChild(Object.assign(document.createElement("div"), {
      className: "strategy-note",
      textContent: strategyBits.note
    }));
  }
  const shareText = `\u6211\u5728\u6B65\u5B78\u543E\u6578\u7B54\u5C0D\u4E86 ${session.roundCorrect}/${session.roundTotal} \u984C\uFF0C\u9023\u8A60 \xD7${session.maxStreak}\uFF01`;
  const shareBtn = document.createElement("button");
  shareBtn.className = "daily-btn summary-share-btn";
  shareBtn.textContent = "\u5206\u4EAB\u9019\u6B21\u6210\u679C";
  shareBtn.addEventListener("click", async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "\u6B65\u5B78\u543E\u6578", text: shareText });
        shareBtn.textContent = "\u5DF2\u958B\u555F\u5206\u4EAB\uFF01";
        showToast("\u5DF2\u958B\u555F\u5206\u4EAB\uFF0C\u53EF\u50B3\u7D66\u540C\u5B78\u6216\u5BB6\u4EBA");
      } catch {
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(shareText);
      shareBtn.textContent = "\u5DF2\u8907\u88FD\u6210\u679C\uFF01";
      showToast("\u5DF2\u8907\u88FD\u6210\u679C\u6587\u5B57");
    } catch {
      showToast("\u7121\u6CD5\u8907\u88FD\u6210\u679C\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66", "error");
    }
  });
  box.appendChild(shareBtn);
  if (newBadges.length > 0) {
    const badgeList = document.createElement("div");
    badgeList.className = "badge-unlock";
    badgeList.textContent = "\u3010\u84CB\u7AE0\u8A8D\u8B49\u3011" + newBadges.map((b) => b.name).join("\u3001");
    box.appendChild(badgeList);
  }
  return box;
}
var challengeCatalogPromise = null;
function getChallengeCatalog() {
  if (!challengeCatalogPromise) {
    challengeCatalogPromise = buildChallengeCatalog(
      allNodes(tree).filter((node) => !node.contentPending).map((node) => node.id)
    );
  }
  return challengeCatalogPromise;
}
function startChallengeSession(code, queue) {
  session = newSession({
    queue,
    node: { id: "peer-challenge", name: "\u540C\u5B78\u51FA\u984C\u6311\u6230\u5305" },
    mascot: "gauss",
    kind: "challenge",
    challengeCode: code
  });
  showView("quiz");
  renderCurrentQuestion();
}
async function makeChallengeHub() {
  const catalog = await getChallengeCatalog();
  const collection = getCollection();
  const sealedIds = new Set(Object.entries(collection).filter(([id, record]) => id !== MASTER_TRIAL_ID && record.tier >= 2).map(([id]) => id));
  const eligible = catalog.filter((question) => sealedIds.has(question._nodeId));
  const nodeNames = Object.fromEntries(allNodes(tree).map((node) => [node.id, node.name]));
  const section = document.createElement("section");
  section.className = "challenge-hub";
  section.innerHTML = `<h3>\u{1F3AF} \u898B\u7FD2\u51FA\u984C\u6240\u30FB\u4E94\u984C\u6311\u6230\u5305</h3>
    <p>\u795E\u8AED\u5377\u8EF8\u7372\u5F97\u96C5\u5178\u5A1C\u881F\u5C01\u5F8C\uFF0C\u4F60\u5C31\u6709\u8CC7\u683C\u5F9E\u8A72\u5377\u6311\u4E94\u984C\u8003\u540C\u5B78\u3002\u5F9E\u81EA\u5DF1\u6700\u5BB9\u6613\u4E0A\u7576\u7684\u984C\u6311\u8D77\uFF0C\u624D\u662F\u771F\u6B63\u7684\u51FA\u984C\u4EBA\u3002</p>`;
  const creator = document.createElement("div");
  creator.className = "challenge-creator";
  if (eligible.length === 0) {
    creator.innerHTML = `<div class="challenge-locked">\u{1F512} \u5148\u8B93\u4EFB\u4E00\u5377\u795E\u8AED\u5377\u8EF8\u7372\u5F97\u300C\u96C5\u5178\u5A1C\u881F\u5C01\u300D\uFF0C\u5C31\u80FD\u89E3\u9396\u898B\u7FD2\u51FA\u984C\u6B0A\u3002</div>`;
  } else {
    const selected = /* @__PURE__ */ new Map();
    const filterLabel = document.createElement("label");
    filterLabel.htmlFor = "challenge-bank-select";
    filterLabel.textContent = "\u6311\u9078\u984C\u5EAB";
    const filter = document.createElement("select");
    filter.id = "challenge-bank-select";
    [...new Set(eligible.map((q) => q._nodeId))].forEach((id) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = nodeNames[id] ?? id;
      filter.appendChild(option);
    });
    const count = document.createElement("strong");
    count.textContent = "\u5DF2\u6311 0 / 5 \u984C";
    const fullMessage = document.createElement("span");
    fullMessage.className = "challenge-full-message";
    fullMessage.setAttribute("role", "status");
    const list = document.createElement("div");
    list.className = "challenge-question-list";
    const output = document.createElement("div");
    output.className = "challenge-code-output";
    const make = document.createElement("button");
    make.className = "daily-btn";
    make.textContent = "\u7DE8\u6210\u6311\u6230\u795E\u8AED";
    make.disabled = true;
    const renderList = () => {
      list.innerHTML = "";
      eligible.filter((q) => q._nodeId === filter.value).forEach((question) => {
        const label = document.createElement("label");
        label.className = "challenge-question";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selected.has(question.id);
        checkbox.disabled = !checkbox.checked && selected.size >= 5;
        const accuracy = questionAccuracy(question.id, store.read("progress", {}));
        const accuracyText = accuracy === null ? "\u5C1A\u672A\u4F5C\u7B54" : `\u6B77\u53F2\u6B63\u78BA\u7387 ${Math.round(accuracy * 100)}%`;
        const copy = document.createElement("span");
        const questionText = document.createElement("strong");
        questionText.textContent = questionLabel(question);
        const accuracyLine = document.createElement("small");
        accuracyLine.textContent = accuracyText;
        copy.append(questionText, accuracyLine);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.set(question.id, question);
          else selected.delete(question.id);
          count.textContent = `\u5DF2\u6311 ${selected.size} / 5 \u984C`;
          fullMessage.textContent = selected.size === 5 ? "\u5DF2\u6EFF 5 \u984C\uFF0C\u53D6\u6D88\u4E00\u984C\u624D\u80FD\u6539\u9078" : "";
          make.disabled = selected.size !== 5;
          renderList();
        });
        label.appendChild(checkbox);
        label.appendChild(copy);
        list.appendChild(label);
      });
    };
    filter.addEventListener("change", renderList);
    make.addEventListener("click", async () => {
      const code = encodeChallenge([...selected.values()], catalog);
      store.write("lastCreatedChallenge", { code, questionIds: [...selected.keys()], at: Date.now() });
      output.innerHTML = `<strong>\u4F60\u7684\u6311\u6230\u795E\u8AED\uFF1A</strong><code>${code}</code>`;
      try {
        await navigator.clipboard.writeText(code);
        output.append("\uFF08\u5DF2\u8907\u88FD\uFF09");
      } catch {
      }
    });
    creator.append(filterLabel, filter, count, fullMessage, list, make, output);
    renderList();
  }
  section.appendChild(creator);
  const receiver = document.createElement("div");
  receiver.className = "challenge-receiver";
  receiver.innerHTML = "<h4>\u6536\u4E0B\u540C\u5B78\u7684\u6311\u6230</h4>";
  const inputLabel = document.createElement("label");
  inputLabel.htmlFor = "challenge-code";
  inputLabel.textContent = "\u540C\u5B78\u7684\u6311\u6230\u795E\u8AED";
  const input = document.createElement("input");
  input.id = "challenge-code";
  input.placeholder = "\u4F8B\u5982\uFF1ABX2-\u2026";
  secureCodeInput(input);
  const result = document.createElement("div");
  result.className = "challenge-message";
  const play = document.createElement("button");
  play.className = "daily-btn";
  play.textContent = "\u958B\u59CB\u63A5\u62DB";
  play.addEventListener("click", () => {
    const queue = decodeChallenge(input.value, catalog);
    if (queue?.error === "too-old") {
      result.textContent = "\u9019\u7D44\u6311\u6230\u795E\u8AED\u683C\u5F0F\u592A\u820A\uFF0C\u8ACB\u51FA\u984C\u540C\u5B78\u91CD\u65B0\u7522\u751F\u3002";
      return;
    }
    if (!Array.isArray(queue)) {
      result.textContent = "\u9019\u7D44\u6311\u6230\u795E\u8AED\u770B\u4E0D\u61C2\uFF0C\u8ACB\u518D\u6838\u5C0D\u4E00\u6B21\u3002";
      return;
    }
    startChallengeSession(input.value.trim().toUpperCase(), queue);
  });
  receiver.append(inputLabel, input, makePasteButton(input), play, result);
  section.appendChild(receiver);
  const reply = document.createElement("div");
  reply.className = "challenge-receiver";
  reply.innerHTML = "<h4>\u67E5\u770B\u540C\u5B78\u7684\u56DE\u64CA</h4>";
  const replyLabel = document.createElement("label");
  replyLabel.htmlFor = "counter-code";
  replyLabel.textContent = "\u540C\u5B78\u7684\u56DE\u64CA\u795E\u8AED";
  const replyInput = document.createElement("input");
  replyInput.id = "counter-code";
  replyInput.placeholder = "\u4F8B\u5982\uFF1AXR2-\u2026";
  secureCodeInput(replyInput);
  const replyResult = document.createElement("div");
  replyResult.className = "challenge-message";
  const inspect = document.createElement("button");
  inspect.className = "daily-btn";
  inspect.textContent = "\u62C6\u958B\u56DE\u64CA";
  inspect.addEventListener("click", () => {
    const mine = store.read("lastCreatedChallenge", null);
    const decoded = mine ? decodeReply(replyInput.value, mine.code) : null;
    if (decoded?.error === "too-old") {
      replyResult.textContent = "\u9019\u7D44\u56DE\u64CA\u795E\u8AED\u683C\u5F0F\u592A\u820A\uFF0C\u8ACB\u540C\u5B78\u91CD\u65B0\u6311\u6230\u3002";
      return;
    }
    if (!decoded) {
      replyResult.textContent = mine ? "\u9019\u4E0D\u662F\u9019\u4E00\u5305\u7684\u56DE\u64CA\u795E\u8AED\u3002" : "\u9019\u53F0\u88DD\u7F6E\u9084\u6C92\u6709\u4F60\u51FA\u904E\u7684\u6311\u6230\u5305\u3002";
      return;
    }
    unlockBadge("sparring");
    replyResult.textContent = `\u540C\u5B78\u7B54\u5C0D ${decoded.pct}%\uFF0C\u7528\u4E86 ${decoded.totalSec} \u79D2\u3002\u4F60\u4E5F\u7372\u5F97\u300C\u5207\u78CB\u7AE0\u300D\uFF01`;
  });
  reply.append(replyLabel, replyInput, makePasteButton(replyInput), inspect, replyResult);
  section.appendChild(reply);
  return section;
}
function makeTravelCase() {
  const section = document.createElement("section");
  section.className = "travel-case";
  section.innerHTML = `<h3>\u{1F9F3} \u795E\u4F7F\u884C\u56CA</h3><p>\u628A\u9019\u53F0\u88DD\u7F6E\u4E0A\u7684\u795E\u8AED\u5377\u8EF8\u3001\u7CBE\u901A\u9032\u5EA6\u3001\u5370\u8A18\u8207\u932F\u984C\u8FF7\u9727\u7C3F\u5168\u90E8\u6253\u5305\uFF0C\u5230\u53E6\u4E00\u53F0\u96FB\u8166\u7E7C\u7E8C\u559A\u9192\u3002</p>`;
  const actions = document.createElement("div");
  actions.className = "travel-actions";
  const pack = document.createElement("button");
  pack.className = "daily-btn";
  pack.textContent = "\u{1F4E6} \u6253\u5305\u6211\u7684\u795E\u8AED\u5377\u8EF8\u96C6";
  pack.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(exportNamespace(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `\u6B65\u5B78\u543E\u6578-\u795E\u8AED\u5377\u8EF8\u96C6-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
    link.click();
    scheduleTimer(() => URL.revokeObjectURL(url), 0);
  });
  const label = document.createElement("label");
  label.className = "daily-btn travel-import";
  label.htmlFor = "travel-case-file";
  label.textContent = "\u{1F9F3} \u6253\u958B\u795E\u4F7F\u884C\u56CA";
  const file = document.createElement("input");
  file.id = "travel-case-file";
  file.type = "file";
  file.accept = "application/json,.json";
  file.className = "visually-hidden";
  file.addEventListener("change", async () => {
    const picked = file.files?.[0];
    if (!picked) return;
    try {
      const bundle = JSON.parse(await picked.text());
      if (!confirm("\u532F\u5165\u6703\u8986\u84CB\u9019\u53F0\u88DD\u7F6E\u7684\u540C\u540D\u9032\u5EA6\uFF0C\u8981\u7E7C\u7E8C\u55CE\uFF1F")) return;
      const count = importNamespace(bundle, localStorage, tree);
      alert(`\u5DF2\u6253\u958B\u795E\u4F7F\u884C\u56CA\uFF0C\u5E36\u56DE ${count} \u9805\u7D00\u9304\u3002`);
      location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "\u9019\u500B\u6A94\u6848\u7121\u6CD5\u532F\u5165\u3002");
    } finally {
      file.value = "";
    }
  });
  label.appendChild(file);
  actions.append(pack, label);
  section.appendChild(actions);
  return section;
}
async function showDashboard() {
  tree = tree ?? await loadSkillTree();
  const overview = computeOverview(tree);
  const unlocked = new Set(getUnlockedBadges());
  const el3 = document.getElementById("dashboard-content");
  el3.innerHTML = "";
  const bestStreak = Number(store.read("bestStreak", 0)) || 0;
  const trialBest = store.read("masterTrialBest", null);
  const summary = document.createElement("div");
  summary.className = "dash-summary";
  summary.innerHTML = `<h3>\u6574\u9AD4\u6230\u529B\u503C</h3><p>${overview.masteredCount} / ${overview.totalNodes} \u500B\u5B78\u7FD2\u9EDE\u5DF2\u958B\u901A</p>
    <p class="dash-records">\u6B77\u53F2\u6700\u9577\u9023\u8A60\uFF1A${bestStreak}${trialBest ? ` \u30FB \u8CE2\u8005\u8A66\u7149\u6700\u4F73\uFF1A${Math.round(trialBest.pct * 100)}%` : ""}</p>`;
  el3.appendChild(summary);
  const dashProgress = store.read("progress", {});
  const diagSkipped = allNodes(tree).filter((n) => dashProgress[n.id]?.diagnosticUnlocked === true && !isNodeMastered(n.id, tree, dashProgress));
  if (diagSkipped.length > 0) {
    const diagSection = document.createElement("div");
    diagSection.className = "dash-diag-skipped";
    diagSection.appendChild(Object.assign(document.createElement("h3"), { textContent: `\u8A3A\u65B7\u8DF3\u95DC\u7684\u7BC0\u9EDE\uFF08${diagSkipped.length}\uFF09` }));
    diagSection.appendChild(Object.assign(document.createElement("p"), { className: "dash-diag-note", textContent: "\u9019\u4E9B\u662F\u4F60\u9760\u5148\u5099\u8A3A\u65B7\u76F4\u63A5\u958B\u901A\u3001\u9084\u6C92\u771F\u6B63\u7CBE\u719F\u7684\u7BC0\u9EDE\u3002\u6A19\u793A\u300C\u57FA\u790E\u672A\u7CBE\u719F\u300D\u53EA\u662F\u63D0\u9192\u2014\u2014\u60F3\u66F4\u7A69\uFF0C\u56DE\u982D\u628A\u5B83\u5011\u7DF4\u5230\u7CBE\u719F\u3002" }));
    diagSkipped.slice(0, 12).forEach((n) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "dash-diag-row";
      row.innerHTML = `<span class="dash-diag-name"></span><span class="dash-diag-tag">\u57FA\u790E\u672A\u7CBE\u719F</span>`;
      row.querySelector(".dash-diag-name").textContent = n.name;
      row.addEventListener("click", () => startQuiz(n));
      diagSection.appendChild(row);
    });
    el3.appendChild(diagSection);
  }
  const col = getCollection();
  const ownedCount = Object.keys(col).length;
  const sealedCount = Object.values(col).filter((c) => c.tier >= 2).length;
  const tierSum = Object.values(col).reduce((acc, c) => acc + c.tier, 0);
  const colPct = Math.round(tierSum / (MANUSCRIPTS.length * 2) * 100);
  const colSection = document.createElement("div");
  colSection.className = "dash-collection";
  colSection.appendChild(Object.assign(document.createElement("h3"), {
    textContent: `\u795E\u8AED\u5377\u8EF8\u96C6\uFF08${ownedCount} / ${MANUSCRIPTS.length} \u5165\u5EAB \xB7 ${sealedCount} \u881F\u5C01 \xB7 \u5B8C\u6210\u5EA6 ${colPct}%\uFF09`
  }));
  const grid = document.createElement("div");
  grid.className = "collection-grid";
  MANUSCRIPTS.forEach((m) => {
    const record = col[m.id];
    const tier = record?.tier ?? 0;
    const card = document.createElement("div");
    card.className = "ms-card" + (tier === 0 ? " locked" : "");
    const sym = document.createElement("div");
    sym.className = "ms-sym";
    sym.textContent = tier === 0 ? "\uFF1F" : m.sym;
    card.appendChild(sym);
    const name = document.createElement("div");
    name.className = "ms-name";
    name.textContent = tier === 0 ? m.hint : m.name;
    card.appendChild(name);
    if (tier > 0) {
      card.appendChild(Object.assign(document.createElement("div"), { className: "ms-desc", textContent: m.desc }));
      if (record?.at) {
        const d = new Date(record.at);
        card.appendChild(Object.assign(document.createElement("div"), {
          className: "ms-date",
          textContent: `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} \u5165\u5EAB`
        }));
      }
    }
    if (tier >= 2) {
      card.appendChild(Object.assign(document.createElement("div"), { className: "ms-seal", textContent: "\u881F\u5C01" }));
    }
    grid.appendChild(card);
  });
  colSection.appendChild(grid);
  el3.appendChild(colSection);
  const stampBook = getRareStamps();
  const stampCount = Object.keys(stampBook).length;
  const stampSection = document.createElement("div");
  stampSection.className = "dash-stampbook";
  stampSection.appendChild(Object.assign(document.createElement("h3"), {
    textContent: `\u795E\u8A71\u5370\u8A18\u5716\u9451\uFF08${stampCount} / ${RARE_STAMPS.length}\uFF09\u2014\u2014\u795E\u8AED\u555F\u793A\u88E1\u7B54\u5C0D\u6709\u6A5F\u6703\u51FA\u571F`
  }));
  const pityState = store.read("encounterPityByRarity", {});
  const pityHints = ["\u50B3\u8AAA", "\u7A00\u6709", "\u666E\u901A"].filter((rarity) => RARE_STAMPS.some((s) => s.rarity === rarity && !stampBook[s.id])).map((rarity) => {
    const remain = Math.max(0, (STAMP_RARITIES[rarity]?.pity ?? 0) - (pityState[rarity] ?? 0));
    return `${rarity}\u4FDD\u5E95\u5269 ${remain} \u6B21`;
  });
  if (pityHints.length) {
    stampSection.appendChild(Object.assign(document.createElement("p"), {
      className: "stamp-pity-hint",
      textContent: `\u{1F3AF} ${pityHints.join("\u3000\xB7\u3000")}\uFF08\u4FDD\u5E95\uFF1D\u9019\u9EBC\u591A\u6B21\u300C\u795E\u8AED\u555F\u793A\u300D\u5167\u5FC5\u5F97\u4E00\u679A\uFF09`
    }));
  }
  const stampGrid = document.createElement("div");
  stampGrid.className = "stamp-grid";
  RARE_STAMPS.forEach((s) => {
    const owned = stampBook[s.id];
    const cell = document.createElement("div");
    cell.className = "stamp-cell" + (owned ? " stamp-owned" : " stamp-locked") + ` ${cardRevealClass(s.rarity)}`;
    const sym = document.createElement("div");
    sym.className = "stamp-sym";
    sym.textContent = owned ? s.sym : "\uFF1F";
    cell.appendChild(sym);
    const name = document.createElement("div");
    name.className = "stamp-name";
    name.textContent = owned ? s.name : s.hint;
    cell.appendChild(name);
    cell.appendChild(Object.assign(document.createElement("div"), {
      className: `stamp-rarity rarity-${s.rarity}`,
      textContent: `${s.rarity}\u30FB${RARITY_MYTHOS[s.rarity]}`
    }));
    if (owned?.at) {
      const d = new Date(owned.at);
      cell.appendChild(Object.assign(document.createElement("div"), {
        className: "ms-date",
        textContent: `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
      }));
    }
    stampGrid.appendChild(cell);
  });
  stampSection.appendChild(stampGrid);
  el3.appendChild(stampSection);
  const inkTotal = getStardustCount();
  const milestones = claimStardustMilestones(inkTotal);
  const extras = unlockedExtraQuotes(inkTotal);
  const inkSection = document.createElement("div");
  inkSection.className = "dash-ink";
  milestones.unlocked.forEach((milestone) => inkSection.classList.add(`stardust-${milestone}`));
  const extraLabel = extras.length >= EXTRA_QUOTES.length ? `\u53E4\u8CE2\u8005\u5377\u8EF8\u756A\u5916 ${EXTRA_QUOTES.length}/${EXTRA_QUOTES.length}\u30FB\u5DF2\u5168\u6578\u6536\u9F4A` : `\u53E4\u8CE2\u8005\u5377\u8EF8\u756A\u5916 ${extras.length}/${EXTRA_QUOTES.length}\uFF08\u6BCF 7 \u7C92\u89E3\u9396\u4E00\u5247\uFF09`;
  inkSection.innerHTML = `<h3>\u661F\u5C51\u74F6\uFF08\u7D2F\u8A08 ${inkTotal} \u7C92 \xB7 ${extraLabel}\uFF09</h3>`;
  milestones.unlocked.forEach((milestone) => {
    inkSection.appendChild(Object.assign(document.createElement("div"), {
      className: "stardust-milestone-marker",
      textContent: `\u2726 ${milestone} \u7C92\u661F\u5C51\u91CC\u7A0B\u7891`
    }));
  });
  if (extras.length === 0) {
    inkSection.appendChild(Object.assign(document.createElement("p"), {
      className: "ink-hint",
      textContent: "\u5B8C\u6210\u6BCF\u65E5\u559A\u9192\u55AE\u5C31\u843D\u4E0B\u4E00\u7C92\u661F\u5C51\u3002\u65B7\u4E86\u4E5F\u4E0D\u6703\u5012\u6389\u2014\u2014\u74F6\u5B50\u53EA\u9032\u4E0D\u51FA\u3002"
    }));
  }
  extras.forEach((q) => {
    const note = document.createElement("div");
    note.className = "quote-note";
    note.innerHTML = `<div class="quote-text"></div><div class="quote-by"></div>`;
    note.querySelector(".quote-text").textContent = q.text;
    note.querySelector(".quote-by").textContent = q.by ? `\u2014\u2014${q.by}` : "";
    inkSection.appendChild(note);
  });
  el3.appendChild(inkSection);
  const badgeSection = document.createElement("div");
  badgeSection.className = "dash-badges";
  badgeSection.innerHTML = "<h3>\u6210\u5C31\u5FBD\u7AE0</h3>";
  BADGES.forEach((b) => {
    const row = document.createElement("div");
    row.className = "badge-row" + (unlocked.has(b.id) ? " got" : "");
    row.textContent = `${unlocked.has(b.id) ? "\u{1F3C5}" : "\u2B1C"} ${b.name} \u2014 ${b.desc}`;
    badgeSection.appendChild(row);
  });
  el3.appendChild(badgeSection);
  const errorSection = document.createElement("div");
  errorSection.className = "dash-errorbook";
  const wrongList = listWrongQuestions();
  errorSection.innerHTML = `<h3>\u932F\u984C\u8FF7\u9727\u7C3F\uFF08${wrongList.length} \u8655\u8FF7\u9727\u7B49\u4F60\u89E3\u958B\uFF09</h3>`;
  wrongList.slice(0, 10).forEach((entry) => {
    const q = entry.question;
    const stem = q.stem || q.statement || q.problem || q.question;
    const row = document.createElement("div");
    row.className = "errorbook-row";
    row.textContent = stem;
    errorSection.appendChild(row);
  });
  el3.appendChild(errorSection);
  const boardSection = document.createElement("div");
  boardSection.className = "dash-leaderboard";
  boardSection.innerHTML = '<h3>\u73ED\u7D1A\u6392\u884C\u699C</h3><p class="score-disclosure">\u5B78\u751F\u81EA\u884C\u56DE\u5831\u6210\u7E3E\uFF0C\u672A\u7D93\u4F3A\u670D\u5668\u9A57\u8B49\u3002</p>';
  getLeaderboard().forEach((row, idx) => {
    const line = document.createElement("div");
    line.className = "leaderboard-row";
    line.textContent = `${idx + 1}. ${row.name} \u2014 ${Math.round(row.masteryPct * 100)}%${row.flagged ? `\u30FB${row.flagLabel ?? "\u26A0\uFE0F \u5EFA\u8B70\u8907\u9A57"}` : ""}`;
    boardSection.appendChild(line);
  });
  el3.appendChild(boardSection);
  el3.appendChild(await makeChallengeHub());
  el3.appendChild(makeTravelCase());
  el3.appendChild(makeShareCard());
  el3.appendChild(makeNameEditor());
  showView("dashboard");
}
function makeShareCard() {
  const box = document.createElement("div");
  box.className = "dash-share";
  const btn = document.createElement("button");
  btn.className = "daily-btn";
  btn.textContent = "\u{1F5BC} \u7522\u751F\u6211\u7684\u795E\u8AED\u5377\u8EF8\u96C6\u5361\u7247\uFF08\u4E0B\u8F09\u70AB\u8000\uFF09";
  btn.addEventListener("click", () => {
    btn.disabled = true;
    btn.textContent = "\u6B63\u5728\u7522\u751F\u5361\u7247\u2026";
    renderShareCard((success) => {
      btn.disabled = false;
      btn.textContent = success ? "\u2713 \u5DF2\u7522\u751F\u4E26\u4E0B\u8F09\uFF01" : "\u{1F5BC} \u518D\u8A66\u4E00\u6B21\u7522\u751F\u5361\u7247";
      showToast(success ? "\u5DF2\u7522\u751F\u4E26\u4E0B\u8F09\u70AB\u8000\u5361\u7247" : "\u7121\u6CD5\u7522\u751F\u4E0B\u8F09\u5361\u7247\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66", success ? "success" : "error");
    });
  });
  box.appendChild(btn);
  return box;
}
function renderShareCard(onComplete = () => {
}) {
  const col = getCollection();
  const ownedCount = Object.keys(col).length;
  const sealedCount = Object.values(col).filter((c) => c.tier >= 2).length;
  const stampBook = getRareStamps();
  const ownedStamps = RARE_STAMPS.filter((s) => stampBook[s.id]);
  const bestStreak = Number(store.read("bestStreak", 0)) || 0;
  const name = getPlayerName() ?? "\u540C\u5B78";
  const W = 800, H = 460;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx2 = canvas.getContext("2d");
  if (!ctx2) {
    onComplete(false);
    return;
  }
  ctx2.fillStyle = "#f4ead2";
  ctx2.fillRect(0, 0, W, H);
  ctx2.strokeStyle = "rgba(140,110,70,0.18)";
  for (let y = 60; y < H; y += 34) {
    ctx2.beginPath();
    ctx2.moveTo(30, y + Math.sin(y) * 1.5);
    ctx2.lineTo(W - 30, y + Math.cos(y) * 1.5);
    ctx2.stroke();
  }
  ctx2.strokeStyle = "#6b5335";
  ctx2.lineWidth = 3;
  ctx2.strokeRect(14, 14, W - 28, H - 28);
  ctx2.lineWidth = 1;
  ctx2.strokeRect(22, 22, W - 44, H - 44);
  ctx2.fillStyle = "#4a3620";
  ctx2.font = "bold 34px 'Noto Sans TC', sans-serif";
  ctx2.fillText("\u6B65\u5B78\u543E\u6578\u30FB\u5967\u6797\u5E15\u65AF\u795E\u8AED\u5377\u8EF8\u96C6", 44, 74);
  ctx2.font = "24px 'Noto Sans TC', sans-serif";
  ctx2.fillText(`\u898B\u7FD2\u795E\u8AED\u8005\uFF1A${name}`, 44, 130);
  ctx2.font = "22px 'Noto Sans TC', sans-serif";
  const lines = [
    `\u{1F4DC} \u795E\u8AED\u5377\u8EF8\u5165\u5EAB ${ownedCount} / ${MANUSCRIPTS.length}\u3000\u{1F58B} \u96C5\u5178\u5A1C\u881F\u5C01 ${sealedCount}`,
    `\u2726 \u7A00\u6709\u5370\u8A18 ${ownedStamps.length} / ${RARE_STAMPS.length}\u3000\u{1F525} \u6B77\u53F2\u6700\u9577\u9023\u8A60 ${bestStreak}`
  ];
  lines.forEach((t, i) => ctx2.fillText(t, 44, 184 + i * 44));
  ctx2.font = "20px 'Noto Sans TC', sans-serif";
  ctx2.fillText("\u795E\u8A71\u5370\u8A18\u5716\u9451\uFF1A", 44, 296);
  ownedStamps.slice(0, 8).forEach((s, i) => {
    const x = 70 + i % 4 * 175;
    const y = 330 + Math.floor(i / 4) * 56;
    ctx2.strokeStyle = "#a33b2e";
    ctx2.lineWidth = 2;
    ctx2.beginPath();
    ctx2.arc(x, y, 22, 0, Math.PI * 2);
    ctx2.stroke();
    ctx2.fillStyle = "#a33b2e";
    ctx2.font = "18px 'Noto Sans TC', sans-serif";
    ctx2.fillText(s.sym, x - 9, y + 7);
    ctx2.fillStyle = "#4a3620";
    ctx2.fillText(s.name, x + 30, y + 7);
  });
  if (ownedStamps.length === 0) {
    ctx2.fillStyle = "#8a7455";
    ctx2.fillText("\uFF08\u9084\u6C92\u6709\u5370\u8A18\u2014\u2014\u53BB\u795E\u8AED\u555F\u793A\u88E1\u6316\uFF01\uFF09", 130, 334);
  }
  const d = /* @__PURE__ */ new Date();
  ctx2.fillStyle = "#8a7455";
  ctx2.font = "16px 'Noto Sans TC', sans-serif";
  ctx2.fillText(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} \xB7 bxws-math`, W - 230, H - 40);
  const finish = () => {
    try {
      const a = document.createElement("a");
      a.download = `\u6B65\u5B78\u543E\u6578\u795E\u8AED\u5377\u8EF8\u96C6-${name}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
      onComplete(true);
    } catch {
      onComplete(false);
    }
  };
  const img = new Image();
  img.onload = () => {
    ctx2.drawImage(img, W - 190, H - 210, 150, 150);
    finish();
  };
  img.onerror = finish;
  img.src = globalThis.mathAsset("assets/mascot/davinci-celebrate.png");
}
function makeNameEditor() {
  const box = document.createElement("div");
  box.className = "dash-name";
  const label = document.createElement("label");
  label.htmlFor = "player-name";
  label.textContent = "\u6392\u884C\u699C\u66B1\u7A31\uFF1A";
  const input = document.createElement("input");
  input.id = "player-name";
  input.type = "text";
  input.maxLength = 12;
  input.value = getPlayerName() ?? "";
  input.placeholder = "\u4F8B\u5982\uFF1A\u5C0F\u6578\u9054\u4EBA";
  input.addEventListener("change", () => {
    const safeName = input.value.trim().slice(0, 12).replace(/[\/:*?"<>|\n\r]/g, "");
    input.value = safeName;
    if (safeName) setPlayerName(safeName);
  });
  box.appendChild(label);
  box.appendChild(input);
  return box;
}
function setupSfxToggle() {
  const btn = document.getElementById("nav-sfx");
  const sync = () => {
    const on = isSfxOn();
    btn.textContent = on ? "\u{1F50A}" : "\u{1F507}";
    btn.title = on ? "\u97F3\u6548\u958B\uFF08\u9EDE\u64CA\u95DC\u9589\uFF09" : "\u97F3\u6548\u95DC\uFF08\u9EDE\u64CA\u958B\u555F\uFF09";
    btn.setAttribute("aria-pressed", String(on));
  };
  btn.addEventListener("click", () => {
    setSfxOn(!isSfxOn());
    sync();
    if (isSfxOn()) sfx.correct(0);
  });
  sync();
}
function setupAccessibilitySettings() {
  const sync = () => {
    const settings = applyAccessibilitySettings();
    document.querySelectorAll('input[name="font-size"]').forEach((input) => {
      input.checked = input.value === settings.fontSize;
    });
    document.getElementById("setting-sprint-warning").checked = settings.sprintWarning;
    document.getElementById("setting-combo-break").checked = settings.comboBreakEffect;
    const haptics = document.getElementById("setting-haptics");
    if (haptics) haptics.checked = areHapticsOn();
  };
  document.querySelectorAll('input[name="font-size"]').forEach((input) => input.addEventListener("change", () => {
    if (input.checked) setAccessibilitySetting("fontSize", input.value);
    sync();
  }));
  document.getElementById("setting-sprint-warning").addEventListener("change", (event) => {
    setAccessibilitySetting("sprintWarning", event.currentTarget.checked);
    sync();
  });
  document.getElementById("setting-combo-break").addEventListener("change", (event) => {
    setAccessibilitySetting("comboBreakEffect", event.currentTarget.checked);
    sync();
  });
  document.getElementById("setting-haptics")?.addEventListener("change", (event) => {
    setHapticsOn(event.currentTarget.checked);
    if (event.currentTarget.checked) sfx.buzz(30);
    sync();
  });
  const clearBtn = document.getElementById("clear-local-data");
  const clearNote = document.getElementById("clear-local-data-note");
  clearBtn?.addEventListener("click", () => {
    if (!window.confirm("\u9019\u6703\u6E05\u9664\u9019\u53F0\u88DD\u7F6E\u4E0A\u6240\u6709\u300A\u6B65\u5B78\u543E\u6578\u300B\u7684\u5B78\u7FD2\u9032\u5EA6\u3001\u6536\u96C6\u8207\u8A2D\u5B9A\uFF0C\u4E14\u7121\u6CD5\u5FA9\u539F\u3002\u78BA\u5B9A\u8981\u6E05\u9664\u55CE\uFF1F")) return;
    const removed = clearNamespace();
    if (clearNote) clearNote.textContent = `\u5DF2\u6E05\u9664 ${removed} \u7B46\u672C\u6A5F\u8CC7\u6599\uFF0C\u91CD\u65B0\u6574\u7406\u5F8C\u5C31\u662F\u5168\u65B0\u7684\u958B\u59CB\u3002`;
    announce("\u5DF2\u6E05\u9664\u9019\u53F0\u88DD\u7F6E\u4E0A\u7684\u6240\u6709\u5B78\u7FD2\u8CC7\u6599");
  });
  sync();
}
function setupOptionalMythosArt() {
  const image = document.getElementById("mythos-style-guide");
  const mythosFigure = image?.closest("figure");
  if (!image || !mythosFigure) return;
  const hideMissingArt = () => {
    mythosFigure.hidden = true;
  };
  image.addEventListener("error", hideMissingArt, { once: true });
  if (image.complete && image.naturalWidth === 0) hideMissingArt();
}
var BATTLE_KINDS = /* @__PURE__ */ new Set(["boss", "pvp", "arena", "weekly", "master"]);
function inActiveBattle() {
  return views.quiz?.classList.contains("active") && BATTLE_KINDS.has(session?.kind) && !session?.concluded && (session?.index ?? 0) < (session?.queue?.length ?? 0);
}
function guardNav(handler) {
  return (event) => {
    if (inActiveBattle() && !window.confirm("\u9019\u4E00\u5C40\u9084\u6C92\u6253\u5B8C\uFF0C\u96E2\u958B\u5C31\u6703\u653E\u68C4\u9019\u5C40\uFF0C\u78BA\u5B9A\u8981\u96E2\u958B\u55CE\uFF1F")) return;
    handler(event);
  };
}
document.getElementById("nav-home").addEventListener("click", guardNav(goHome));
document.getElementById("nav-workshop").addEventListener("click", guardNav(showWorkshop));
document.getElementById("nav-fusion").addEventListener("click", guardNav(showFusion));
document.getElementById("nav-sanctuary").addEventListener("click", guardNav(showSanctuary));
document.getElementById("nav-arena").addEventListener("click", guardNav(showArena));
document.getElementById("nav-dashboard").addEventListener("click", guardNav(showDashboard));
setupSfxToggle();
setupAccessibilitySettings();
setupOptionalMythosArt();
document.addEventListener("click", () => queueMicrotask(showStorageNoticeIfNeeded), true);
document.addEventListener("change", () => queueMicrotask(showStorageNoticeIfNeeded), true);
document.querySelector(".quill-deco")?.addEventListener("error", (event) => {
  event.currentTarget.hidden = true;
}, { once: true });
var allowedHosts = /* @__PURE__ */ new Set(["bxws-math.vercel.app", "bxws-math.pages.dev", "bxws-math.netlify.app", "localhost", "127.0.0.1"]);
if (!allowedHosts.has(location.hostname)) {
  const warning = document.createElement("div");
  warning.className = "clone-warning";
  warning.textContent = "\u26A0\uFE0F \u9019\u4E0D\u662F\u300A\u6B65\u5B78\u543E\u6578\u300B\u5B98\u65B9\u7DB2\u7AD9\uFF0C\u8ACB\u52FF\u8F38\u5165\u6216\u532F\u5165\u500B\u4EBA\u5B78\u7FD2\u8CC7\u6599\u3002";
  document.body.prepend(warning);
}
if (!getPlayerName()) setPlayerName("\u540C\u5B78");
goHome();
