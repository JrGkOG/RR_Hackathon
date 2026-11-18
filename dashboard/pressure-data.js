(() => {
  "use strict";

  const number = (value) => {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const basename = (path) => path.slice(path.lastIndexOf("/") + 1);
  const cleanPath = (path) => String(path).replaceAll("\\", "/").replace(/^\.\//, "");
  const key = (role, scenario) => `${role}/${scenario}`;
  const roles = ["batter", "bowler"];
  const truth = (value) => /^(true|1)$/i.test(String(value));
  const compare = (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)
    || (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.name.localeCompare(b.name);

  function parseCSV(text, limit = Infinity) {
    const records = [];
    let fields = [];
    let field = "";
    let quoted = false;
    const input = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (quoted) {
        if (ch === '"') {
          if (input[i + 1] === '"') { field += '"'; i += 1; }
          else quoted = false;
        } else field += ch;
      } else if (ch === '"' && field === "") {
        quoted = true;
      } else if (ch === ",") {
        fields.push(field);
        field = "";
      } else if (ch === "\n" || ch === "\r") {
        fields.push(field);
        if (fields.some((value) => value !== "")) records.push(fields);
        fields = [];
        field = "";
        if (ch === "\r" && input[i + 1] === "\n") i += 1;
        if (records.length > limit) break;
      } else field += ch;
    }
    if (quoted) throw new Error("A CSV contains an unterminated quoted field.");
    if (records.length <= limit && (field !== "" || fields.length)) {
      records.push([...fields, field]);
    }
    const headers = (records.shift() ?? []).map((value) => value.trim());
    if (new Set(headers).size !== headers.length) throw new Error("A CSV has duplicate columns.");
    return records.map((values) => {
      if (values.length !== headers.length) throw new Error("A CSV row has a different number of columns.");
      return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
    });
  }

  function mapPlayer(row) {
    const id = row.player_id?.trim();
    if (!id || !row.player_name?.trim()) return null;
    const attempts = number(row.pressure_attempts ?? row.pressure_events);
    return {
      id, name: row.player_name, rank: number(row.rank), score: number(row.pressure_score100 ?? row.pressure_performance_score100),
      total: number(row.total_score5000), attempts, matches: number(row.pressure_matches),
      solo: number(row.solo_score100), combination: number(row.combination_adjustment),
      repeat: number(row.repeat_bonus), positiveMatches: number(row.repeat_positive_matches),
      observed: number(row.scenarios_observed), supported: number(row.scenarios_supported),
      eligible: "scenario_rank_eligible" in row ? truth(row.scenario_rank_eligible) : number(row.rank) !== null,
      evidence: "has_scenario_evidence" in row ? truth(row.has_scenario_evidence) : attempts === null ? null : attempts > 0,
      exposure: number(row.pressure_exposure_pct),
      above: number(row.above_reference_pct ?? row.above_context_pct),
      rate: number(row.mean_required_rate_change), runs: number(row.runs_observed), wickets: number(row.wickets_observed),
      raw: row,
    };
  }

  function uniquePlayers(rows) {
    const unique = new Map();
    for (const row of rows) {
      const player = mapPlayer(row);
      if (!player) continue;
      const previous = unique.get(player.id);
      if (!previous || (previous.score === null && player.score !== null)) unique.set(player.id, player);
    }
    return [...unique.values()].sort(compare);
  }

  function scenarioRecord(role, id, data = {}) {
    const n = number(data.scenario_number);
    return {
      role, id, n, label: data.scenario || id.replaceAll("_", " "), isCombination: false,
      code: data.score_column || (n !== null ? `${role === "batter" ? "BAT" : "BOWL"}${String(n).padStart(2, "0")}` : ""),
      family: data.pressure_family || data.family || data.forecast_family || "Other scenarios",
      trigger: data.pressure_rule || "",
      mechanism: data.pressure_mechanism || "",
      measure: data.cumulative_measure || data.target || "",
      runWeight: number(data.run_weight_pct), wicketWeight: number(data.wicket_weight_pct),
      disciplineWeight: number(data.discipline_weight_pct),
      eligible: number(data.eligible_players), paired: number(data.matched_players),
      attempts: number(data.cumulative_scored_rows ?? data.forecast_rows),
      ndcg: number(data.ndcg_at_10), rows: [], deliveries: null,
    };
  }

  async function buildRun(input, name) {
    const files = input.map((file) => ({ ...file, path: cleanPath(file.path) }));
    const indices = files.filter((file) => basename(file.path) === "scenario_index.csv");
    if (indices.length > 1) throw new Error("Select the files from one Kaggle run at a time.");
    const anchor = indices[0]?.path.slice(0, -"scenario_index.csv".length) ?? "";
    const fileAt = (name) => files.find((f) => f.path === anchor + name)
      ?? files.find((f) => f.path === name)
      ?? files.find((f) => f.path.endsWith("/" + name));
    const get = async (path) => {
      const file = fileAt(path) ?? fileAt(basename(path));
      return file ? parseCSV(await file.text()) : [];
    };
    const [definitions, index, combinedRankings, combinedTop, submission, combinationDefinitions, combinationRankings] = await Promise.all([
      get("scenario_definitions.csv"), get("scenario_index.csv"),
      get("overall/combined_rankings.csv"), get("overall/combined_top10.csv"),
      get("submission.csv"), get("combination_index.csv"), get("combination_rankings.csv"),
    ]);
    const catalog = new Map();
    for (const row of [...definitions, ...index]) {
      const role = row.role;
      const id = row.scenario_id;
      if (!roles.includes(role) || !id) continue;
      const k = key(role, id);
      catalog.set(k, { ...catalog.get(k), ...Object.fromEntries(Object.entries(row).filter(([, val]) => val !== "")) });
    }
    const scenarios = new Map([...catalog].map(([k, row]) => [
      k, scenarioRecord(row.role, row.scenario_id, row),
    ]));
    const rankParts = new Map();
    for (const file of files) {
      if (!/\.csv$/i.test(file.path)) continue;
      const exact = file.path.match(/(?:^|\/)scenarios\/(batter|bowler)\/(\d+)_([^/]+)\/(rankings|top10)\.csv$/);
      if (exact) {
        const [, role, n, id, type] = exact;
        const k = key(role, id);
        if (!scenarios.has(k)) scenarios.set(k, scenarioRecord(role, id, { scenario_number: n }));
        const previous = rankParts.get(k);
        if (!previous || type === "rankings") rankParts.set(k, { file, type });
      }
    }
    const reserved = new Set([
      "scenario_definitions.csv", "scenario_index.csv", "combined_rankings.csv", "combined_top10.csv",
      "submission.csv", "batter_rankings.csv", "bowler_rankings.csv", "batter_top10.csv", "bowler_top10.csv",
      "combination_index.csv", "combination_rankings.csv", "combination_top10.csv",
    ]);
    for (const file of files) {
      if (!/\.csv$/i.test(file.path) || reserved.has(basename(file.path))) continue;
      if (/(?:^|\/)scenarios\//.test(file.path)) continue;
      if (!/(rankings|top10|scenario_scores).*\.csv$/i.test(file.path)) continue;
      const rows = parseCSV(await file.text());
      const groups = new Map();
      for (const row of rows) {
        if (!roles.includes(row.role) || !row.scenario_id || !row.player_id || !row.player_name) continue;
        const k = key(row.role, row.scenario_id);
        if (!scenarios.has(k)) scenarios.set(k, scenarioRecord(row.role, row.scenario_id, row));
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(row);
      }
      for (const [k, values] of groups) {
        if (!rankParts.has(k)) rankParts.set(k, { rows: values, type: "individual" });
      }
    }
    const pending = [...rankParts];
    let cursor = 0;
    const loadRanking = async ([k, part]) => {
      const scenario = scenarios.get(k);
      scenario.rows = uniquePlayers(part.rows ?? parseCSV(await part.file.text()));
      scenario.rankingsSource = part.type;
      scenario.rankingFile = part.file;
      if (scenario.family === "Other scenarios") {
        scenario.family = scenario.rows[0]?.raw.pressure_family || scenario.family;
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (cursor < pending.length) await loadRanking(pending[cursor++]);
    }));
    for (const [k, scenario] of scenarios) {
      const meta = catalog.get(k);
      const fallback = scenario.n === null ? "" : `scenarios/${scenario.role}/${String(scenario.n).padStart(2, "0")}_${scenario.id}`;
      const relative = meta?.relative_path || fallback;
      if (relative) {
        scenario.deliveries = fileAt(`${relative}/delivery_predictions.csv.gz`)
          ?? fileAt(`${relative}/delivery_predictions.csv`) ?? null;
      }
    }
    const combinations = new Map();
    for (const row of combinationDefinitions) {
      if (!roles.includes(row.role) || !row.combination_id) continue;
      const id = `combo:${row.combination_id}`;
      const record = scenarioRecord(row.role, id, {
        scenario: row.combination, pressure_family: "Pressure combinations",
        cumulative_measure: row.measure, cumulative_scored_rows: row.scored_attempts,
        eligible_players: row.eligible_players, run_weight_pct: row.run_weight_pct,
        wicket_weight_pct: row.wicket_weight_pct, discipline_weight_pct: row.discipline_weight_pct,
      });
      const components = (row.scenario_ids || "").split(" + ").map((s) =>
        scenarios.get(key(row.role, s))?.label ?? s).filter(Boolean);
      record.trigger = components.length ? `Every condition must be active on the same delivery: ${components.join(" + ")}.` : "";
      record.isCombination = true;
      record.rankingFile = fileAt("combination_rankings.csv");
      combinations.set(key(row.role, row.combination_id), { record, rows: [] });
    }
    for (const row of combinationRankings) {
      combinations.get(key(row.role, row.combination_id))?.rows.push(row);
    }
    for (const [k, { record, rows }] of combinations) {
      record.rows = uniquePlayers(rows);
      scenarios.set("combination/" + k, record);
    }
    const validationFile = fileAt("overall/holdout_validation.json") ?? fileAt("holdout_validation.json");
    const holdouts = validationFile ? JSON.parse(await validationFile.text()) : [];
    const overall = {};
    const issues = {};
    for (const role of roles) {
      const allFile = fileAt(`overall/${role}_rankings.csv`) ?? fileAt(`${role}_rankings.csv`);
      const topFile = fileAt(`overall/${role}_top10.csv`) ?? fileAt(`${role}_top10.csv`);
      const roleRows = allFile ? parseCSV(await allFile.text()) : topFile ? parseCSV(await topFile.text()) : [];
      const combinedRows = [...combinedRankings, ...combinedTop, ...submission].filter((row) => row.role === role);
      overall[role] = uniquePlayers([...roleRows, ...combinedRows]);
      const probes = overall[role].filter((p) => p.total !== null && p.score !== null);
      const mismatches = probes.filter((p) => {
        const component = Object.keys(p.raw).filter((name) => /^(BAT|BOWL)\d{2}$/.test(name))
          .map((name) => number(p.raw[name])).filter((val) => val !== null);
        const solo = p.solo ?? p.score;
        const final = Math.min(100, Math.max(0, solo + (p.combination ?? 0) + (p.repeat ?? 0)));
        return p.total < 0 || p.total > 5000 || Math.abs(p.total / 50 - solo) > 0.011
          || Math.abs(final - p.score) > 0.011
          || (component.length === 50 && Math.abs(component.reduce((sum, v) => sum + v, 0) - p.total) > 0.011);
      });
      issues[role] = mismatches.length;
    }
    if (!Object.values(overall).some((rows) => rows.length)
       && ![...scenarios.values()].some((s) => s.rows.length || s.trigger)) {
      throw new Error("No recognized RR ranking files were found. Choose the Kaggle output folder, its ZIP, or the ranking CSVs.");
    }
    return {
      name, overall, scenarios: [...scenarios.values()].sort((a, b) =>
        a.role.localeCompare(b.role) || (a.n ?? Infinity) - (b.n ?? Infinity) || a.label.localeCompare(b.label)),
      holdouts: Array.isArray(holdouts) ? holdouts : [],
      issues,
    };
  }

  async function buildCollection(input, name) {
    const source = input.map((file) => ({ ...file, path: cleanPath(file.path) }));
    const manifest = source.find((file) => basename(file.path) === "dashboard_manifest.json");
    const entries = Object.create(null);
    let initial = "imported";
    if (manifest) {
      const config = JSON.parse(await manifest.text());
      if (config.models && typeof config.models === "object") {
        for (const [model, folder] of Object.entries(config.models)) {
          if (!/^[a-z0-9_-]+$/i.test(model) || typeof folder !== "string" || !folder || !/^[\w/-]+$/.test(folder)) continue;
          const match = source.find((file) => file.path.endsWith(`${folder}/scenario_index.csv`));
          if (!match) continue;
          const prefix = match.path.slice(0, -"scenario_index.csv".length);
          entries[model] = source.filter((file) => file.path.startsWith(prefix));
        }
      }
      if (Object.hasOwn(entries, config.submission_model)) initial = config.submission_model;
    }
    if (!Object.keys(entries).length) {
      for (const file of source.filter((f) => basename(f.path) === "scenario_index.csv")) {
        const prefix = file.path.slice(0, -"scenario_index.csv".length);
        if (!prefix) continue;
        let model = basename(prefix.slice(0, -1));
        if (model === "rr_pressure_100") model = "ensemble";
        if (!Object.hasOwn(entries, model)) {
          entries[model] = source.filter((f) => f.path.startsWith(prefix));
        }
      }
    }
    const keys = Object.keys(entries);
    if (!keys.length) return { entries: { imported: source }, initial: "imported", name };
    return { entries, initial: keys.includes(initial) ? initial : keys.includes("ensemble") ? "ensemble" : keys[0], name };
  }

  async function fileEntries(files) {
    const zips = files.filter((file) => /\.zip$/i.test(file.name));
    if (zips.length === 1 && files.length === 1) return unzipEntries(zips[0]);
    const plain = files.filter((file) => !/\.zip$/i.test(file.name)).map((file) => ({
      path: file.webkitRelativePath || file.name,
      text: () => file.text(),
      blob: () => file,
    }));
    const expanded = await Promise.all(zips.map(unzipEntries));
    return [...plain, ...expanded.flat()];
  }

  async function unzipEntries(file) {
    const empty = "This ZIP format could not be read. Extract it and use Open folder.";
    const tailOffset = Math.max(file.size - 65557, 0);
    const tail = new DataView(await file.slice(tailOffset).arrayBuffer());
    let end = tail.byteLength - 22;
    while (end >= 0 && (tail.getUint32(end, true) !== 0x06054b50
      || end + 22 + tail.getUint16(end + 20, true) !== tail.byteLength)) end -= 1;
    if (end < 0) throw new Error(empty);
    const count = tail.getUint16(end + 10, true);
    const cdSize = tail.getUint32(end + 12, true);
    const cdOffset = tail.getUint32(end + 16, true);
    if (count === 65535 || cdSize === 0xffffffff || cdOffset + cdSize > file.size || cdSize > 16e6) {
      throw new Error(empty);
    }
    const directory = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const decoder = new TextDecoder();
    const entries = [];
    let at = 0;
    for (let i = 0; i < count; i += 1) {
      if (at + 46 > directory.byteLength || directory.getUint32(at, true) !== 0x02014b50) throw new Error(empty);
      const method = directory.getUint16(at + 10, true);
      const flags = directory.getUint16(at + 8, true);
      const compressed = directory.getUint32(at + 20, true);
      const size = directory.getUint32(at + 24, true);
      const nameSize = directory.getUint16(at + 28, true);
      const extra = directory.getUint16(at + 30, true);
      const comment = directory.getUint16(at + 32, true);
      const offset = directory.getUint32(at + 42, true);
      if (at + 46 + nameSize + extra + comment > directory.byteLength) throw new Error(empty);
      const path = decoder.decode(new Uint8Array(directory.buffer, at + 46, nameSize));
      at += 46 + nameSize + extra + comment;
      if (!/(\.csv(\.gz)?|(?:holdout_validation|dashboard_manifest)\.json)$/i.test(path) || path.startsWith("__MACOSX/")) continue;
      async function blob() {
        if (flags & 1 || size > 150e6 || offset + compressed > file.size) throw new Error(empty);
        const local = new DataView(await file.slice(offset, offset + 30).arrayBuffer());
        if (local.byteLength !== 30 || local.getUint32(0, true) !== 0x04034b50) throw new Error(empty);
        const dataAt = offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
        if (dataAt + compressed > file.size) throw new Error(empty);
        const packed = file.slice(dataAt, dataAt + compressed);
        if (method === 0) return packed;
        if (method !== 8) throw new Error(empty);
        try {
          return await new Response(packed.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
        } catch {
          throw new Error(empty);
        }
      }
      entries.push({ path, blob, text: async () => (await blob()).text() });
    }
    return entries;
  }

  async function attemptRows(file, limit) {
    if (!file.path.toLowerCase().endsWith(".gz")) return parseCSV(await file.text(), limit);
    const blob = await file.blob();
    const text = await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text();
    return parseCSV(text, limit);
  }

  function exportCSV(columns, rows) {
    const encode = (value) => {
      let string = String(value ?? "");
      if (typeof value !== "number" && /^[\s]*[=+@-]|^[\t\r]/.test(string)) string = "'" + string;
      return '"' + string.replaceAll('"', '""') + '"';
    };
    return [columns, ...rows].map((row) => row.map(encode).join(",")).join("\r\n") + "\r\n";
  }

  globalThis.PressureData = { number, parseCSV, buildRun, buildCollection, fileEntries, attemptRows, exportCSV, compare };
  if (typeof module !== "undefined") module.exports = globalThis.PressureData;
})();
