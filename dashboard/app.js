(() => {
  "use strict";

  const { number, parseCSV, buildRun, buildCollection, attemptRows, exportCSV, compare } = globalThis.PressureData;
  const auction = globalThis.PressureAuction;
  const archive = globalThis.PressureSubmission;
  const playerReference = new Map();
  const categories = new Map();
  const playerIndex = new WeakMap();
  const comparisonPageSize = 8;
  const archiveFiles = archive.files.filter((file) =>
    !/^rr_model_comparison\/[^/]+$/.test(file.path));
  const modelTitle = (model) => categories.get(model)?.category ?? model;
  const $ = (id) => document.getElementById(id);
  const counts = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
  const decimals = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const roleName = { batter: "Batting", bowler: "Bowling" };
  const colors = ["#6b9cff", "#e87936", "#12a888", "#b38af3"];
  const state = {
    role: "batter", scenario: "", query: "", minMatches: 0, minAttempts: 0,
    limit: "10", unranked: false, players: [], focus: null, step: 0,
    sort: { key: "rank", order: 1 }, run: null, visible: null, delivery: null,
    model: "", collection: null, playerPool: "",
    comparisons: { batter: null, bowler: null }, comparisonPage: 0,
    scenarioQuery: "", findScenario: false, findPlayer: false, playerLookup: false,
  };
  let loadToken = 0;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  const fmt = (value, decimal = false) => value === null || value === undefined
    ? "—" : (decimal ? decimals : counts).format(value);
  const pct = (value) => value === null || value === undefined ? "—" : `${fmt(value, true)}%`;
  const formatted = (value) => value === 0 ? "0" : fmt(value);
  const scenarios = () => state.run?.scenarios.filter((s) => s.role === state.role) ?? [];
  const soloScenarios = () => scenarios().filter((s) => !s.isCombination);
  const overall = () => state.run?.overall[state.role] ?? [];
  const current = () => scenarios().find((s) => s.id === state.scenario);
  const sourceRows = () => current()?.rows ?? overall();
  const pressureFamilies = () => [...new Set(soloScenarios().map((s) => s.family))];
  const currentHoldout = () => state.collection?.validation.find((row) => row.model === state.model && row.role === state.role);
  const roleHasCumulative = () => overall().some((p) => p.total !== null);
  const lookup = (id) => playerIndex.get(state.run)?.[state.role].get(id);
  const auctionFor = (player) => playerReference.get(player.id);
  const auctionAllowed = (player) => {
    if (!state.playerPool) return true;
    const record = auctionFor(player);
    const released = record?.status === "released";
    const indian = record?.verified_indian === "true";
    if (state.playerPool === "released-indian") return released && indian;
    return state.playerPool === "released" ? released : indian;
  };
  function topPair() {
    const played = current()?.rows.filter((p) => auctionAllowed(p) && (p.eligible || p.evidence)) ?? [];
    played.sort((a, b) => {
      if (a.eligible || b.eligible) return compare(a, b);
      return (b.attempts ?? 0) - (a.attempts ?? 0) || compare(a, b);
    });
    return [...new Set([...played, ...overall().filter(auctionAllowed)].map((p) => p.id))].slice(0, 2);
  }
  const comparisonPair = () => {
    const choices = state.comparisons[state.role] ?? topPair();
    return [0, 1].map((index) => {
      const player = lookup(choices[index]);
      return player && auctionAllowed(player) ? player : null;
    });
  };
  const scenarioResult = (scenario, id) => scenario?.rows.find((p) => p.id === id && (p.evidence || p.eligible));

  function iplDetails(player) {
    const record = auctionFor(player);
    return [
      ["Current team", record?.team || "—"],
      ["Status", auction.shown[record?.status] ?? "No matching IPL record"],
      ...(record?.formerTeam ? [["Released by", record.formerTeam]] : []),
      ...(record?.verified_indian === "true" ? [["Player classification", "Indian"]] : []),
    ];
  }

  function button(text, callback, className = "btn-table") {
    const node = element("button", text, className);
    node.type = "button";
    node.addEventListener("click", callback);
    return node;
  }

  function table(target, headers, rows, empty, renderRow) {
    const head = element("thead");
    const title = element("tr");
    for (const header of headers) {
      const cell = element("th");
      cell.scope = "col";
      if (header.className) cell.className = header.className;
      if (header.sort) {
        const active = state.sort.key === header.sort;
        const control = button(header.label + (active ? state.sort.order === 1 ? " ↑" : " ↓" : ""), () => {
          state.sort = active
            ? { key: header.sort, order: -state.sort.order }
            : { key: header.sort, order: header.sort === "rank" || header.sort === "name" ? 1 : -1 };
          renderRanking();
        }, "btn-table sort-button");
        if (active) cell.setAttribute("aria-sort", state.sort.order === 1 ? "ascending" : "descending");
        title.append(cell);
        cell.append(control);
      } else {
        cell.textContent = header.label;
        title.append(cell);
      }
    }
    head.append(title);
    const body = element("tbody");
    if (!rows.length) {
      const tr = element("tr");
      const td = element("td", empty, "table-empty");
      td.colSpan = headers.length;
      tr.append(td);
      body.append(tr);
    } else {
      for (const row of rows) body.append(renderRow(row));
    }
    target.replaceChildren(head, body);
  }

  function optionList(select, choices, value) {
    const options = choices.map(([key, caption]) => {
      const option = element("option", caption);
      option.value = key;
      return option;
    });
    select.replaceChildren(...options);
    select.value = value;
  }

  function scenarioLabel(s) {
    if (s.isCombination) return `Combo · ${s.label}`;
    return s.n === null ? s.label : `${String(s.n).padStart(2, "0")} · ${s.label}`;
  }

  function searchWords(text) {
    return String(text ?? "").normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }

  function searchMatch(text, query) {
    const haystack = searchWords(text);
    return searchWords(query).split(" ").filter(Boolean).every((word) => haystack.includes(word));
  }

  function selectionOption(title, context, pick) {
    const node = button("", pick, "selection-option");
    node.append(element("span", title), element("small", context));
    return node;
  }

  function renderScenarioSearch() {
    const popover = $("scenario-results");
    const field = $("scenario-search");
    popover.hidden = !state.findScenario;
    field.setAttribute("aria-expanded", String(state.findScenario));
    if (!state.findScenario) {
      field.value = current() ? scenarioLabel(current()) : "";
      return;
    }
    const query = state.scenarioQuery.trim();
    const pool = query ? state.run?.scenarios ?? [] : scenarios();
    const found = pool.filter((s) => {
      if (!query) return true;
      if (/^\d+$/.test(query)) return s.n === Number(query);
      return searchMatch([roleName[s.role], s.label, s.code, s.id, s.family, s.trigger, s.mechanism, s.measure].join(" "), query);
    }).sort((a, b) => Number(b.role === state.role) - Number(a.role === state.role));
    popover.replaceChildren(
      element("div", `${found.length} of ${pool.length} results · ${query ? "Both roles" : roleName[state.role]}`, "results-summary"),
      ...found.map((s) => selectionOption(scenarioLabel(s), `${roleName[s.role]} · ${s.family}`, () => {
        state.findScenario = false;
        state.scenarioQuery = "";
        if (s.role !== state.role) setRole(s.role, false);
        changeScenario(s.id);
      })),
    );
    if (!found.length) popover.append(element("div", "Try a scenario number, name, or keyword.", "results-summary"));
  }

  const playerQuery = (value) => value.trim()
    .replace(/^(?:player\s+)?id\s*[:#]?\s*(?=\d)/i, "").replace(/^#\s*(?=\d)/, "");

  function playerMatches(value = state.query, selectedRole = null) {
    const query = playerQuery(value);
    if (!query) return [];
    const roster = Object.entries(playerIndex.get(state.run) ?? {}).flatMap(([role, players]) =>
      !selectedRole || role === selectedRole ? [...players.values()] : []);
    const numeric = /^\d+$/.test(query);
    const exactId = numeric && roster.some((p) => p.id === query);
    const alias = auction.key(query);
    return roster.filter((p) => auctionAllowed(p) && (numeric
      ? exactId ? p.id === query : p.id.startsWith(query) : searchMatch(`${p.name} ${p.id}`, query)
        || (alias && auction.key(p.name).includes(alias))))
      .sort((a, b) => Number(searchWords(b.name) === searchWords(query) || b.id === query)
        - Number(searchWords(a.name) === searchWords(query) || a.id === query)
        || Number(b.role === state.role) - Number(a.role === state.role) || compare(a, b));
  }

  function renderPlayerSearch() {
    const popover = $("player-results");
    const open = state.findPlayer && Boolean(state.query.trim());
    popover.hidden = !open;
    $("player-search").setAttribute("aria-expanded", String(open));
    if (!open) return;
    const matches = playerMatches();
    popover.replaceChildren(element("div", `${matches.length} player matches`, "results-summary"),
      ...matches.slice(0, 30).map((p) => selectionOption(p.name,
        `${roleName[p.role]} · ${p.rank === null ? "Unranked" : `Rank ${p.rank}`} · ${fmt(p.score, true)} / 100`, () => {
          if (p.role !== state.role) setRole(p.role, false);
          state.query = p.name;
          $("player-search").value = p.name;
          state.findPlayer = false;
          state.playerLookup = true;
          render();
          selectPlayer(p.id);
          renderPlayerSearch();
        })));
    if (!matches.length) popover.append(element("div", "Try a shorter name or a player ID.", "results-summary"));
  }

  function renderControls() {
    for (const tab of $("role-tabs").querySelectorAll("button")) {
      const active = tab.dataset.role === state.role;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-pressed", String(active));
    }
    const models = [...categories.keys()].filter((m) => Object.hasOwn(state.collection?.entries ?? {}, m));
    optionList($("model"), models.length ? models.map((m) => [m, modelTitle(m)]) : [["", "Loading categories"]], state.model);
    $("model").disabled = models.length < 2;
    $("category-description").textContent = categories.get(state.model)?.description ?? "";
    const poolCaption = $("pool-description");
    poolCaption.hidden = !state.playerPool;
    const releaseNote = "The official IPL 2027 release list defines this pool. The final auction list determines participation.";
    const indiaNote = "Indian classification comes from verified India T20I or IPL records.";
    poolCaption.textContent = state.playerPool === "released-indian" ? `${releaseNote} ${indiaNote}`
      : state.playerPool === "released" ? releaseNote : indiaNote;
    $("scenario-search").disabled = !scenarios().length;
    $("overall-view").disabled = !state.scenario;
    renderScenarioSearch();
    const rows = sourceRows();
    const matchMax = Math.max(6, ...rows.map((p) => p.matches ?? 0));
    const attemptMax = Math.max(18, ...rows.map((p) => p.attempts ?? 0));
    state.minMatches = Math.min(state.minMatches, matchMax);
    state.minAttempts = Math.min(state.minAttempts, attemptMax);
    $("min-matches").max = matchMax;
    $("min-attempts").max = attemptMax;
    $("min-matches").value = state.minMatches;
    $("min-attempts").value = state.minAttempts;
    $("min-matches").disabled = !rows.some((p) => p.matches !== null);
    $("min-attempts").disabled = !rows.some((p) => p.attempts !== null);
    $("match-value").textContent = fmt(state.minMatches);
    $("attempt-value").textContent = fmt(state.minAttempts);
    $("player-search").value = state.query;
    renderPlayerSearch();
    $("include-wrap").hidden = !current()?.rows.some((p) => p.eligible);
    $("include-unranked").checked = state.unranked;
    $("row-limit").value = state.limit;
  }

  function renderSource() {
    $("source-label").replaceChildren(element("span", null, "swatch"), element("strong", state.run?.name ?? "No run loaded"));
    const batt = state.run?.scenarios.filter((item) => item.role === "batter" && item.rankingsSource === "rankings").length ?? 0;
    const bowl = state.run?.scenarios.filter((item) => item.role === "bowler" && item.rankingsSource === "rankings").length ?? 0;
    $("source-coverage").textContent = state.run
      ? `${batt}/50 batting and ${bowl}/50 bowling full scenario files loaded.`
      : "";
  }

  function rankingSource() {
    if (current()) return current().rankingFile ?? null;
    const path = categories.get(state.model)?.overall_csv;
    return state.collection?.entries[state.model]?.find((file) => file.path === path);
  }

  function details(title, ...items) {
    const box = element("div");
    const list = element("ul", null, "detail-list");
    for (const [label, value] of items) {
      const line = element("li");
      line.append(element("b", label), document.createTextNode(` ${value}`));
      list.append(line);
    }
    box.append(element("h3", title, "detail-title"), list);
    return box;
  }

  function renderIntro() {
    const s = current();
    const panel = $("info-prose");
    const meta = $("info-details");
    if (s) {
      $("info-title").textContent = s.label;
      $("info-pill").textContent = s.family;
      panel.replaceChildren();
      if (s.mechanism) {
        const p = element("p");
        p.append(element("strong", s.mechanism));
        panel.append(p);
      }
      panel.append(element("p", s.trigger || "Load the scenario definitions to see the pre-ball trigger."));
      const weights = [
        ["Runs", s.runWeight], ["Wickets", s.wicketWeight], ["Discipline", s.disciplineWeight],
      ].filter(([, value]) => value !== null && value > 0).map(([label, value]) => [label, `${value}%`]);
      meta.replaceChildren(
        details(s.measure || "Scoring recipe", ...(weights.length ? weights : [["Weights", "Unavailable in these files"]])),
        details("Evidence", ["Eligible players", fmt(s.eligible ?? s.rows.filter((p) => p.eligible).length)],
          ["Scored attempts", fmt(s.attempts)]),
        details("Validation", ["Paired players", fmt(s.paired)],
          ["NDCG@10", s.ndcg === null ? "Insufficient data or unavailable" : fmt(s.ndcg, true)]),
      );
      return;
    }
    const cumulative = roleHasCumulative();
    const holdout = currentHoldout();
    const issueCount = state.run?.issues[state.role] ?? 0;
    const notice = cumulative
      ? "Each player earns up to 100 points in each of the 50 scenarios."
      : "Open a run with cumulative ranking files to see the complete 50-scenario score.";
    const first = element("p");
    first.append(element("strong", notice));
    const adjusted = overall().some((p) => p.solo !== null);
    panel.replaceChildren(first, element("p", cumulative
      ? adjusted
        ? "The 50 solo scores add to a total out of 5,000. The final score adds a combination adjustment and a bonus for repeated positive pressure performances to the normalized solo score."
        : "Add all 50 scores for the total out of 5,000, then divide by 50. Batting and bowling use their own pressure families and scoring recipes. An unobserved scenario contributes a neutral 50."
      : "The dashboard shows the scores and ranks as exported by the loaded run. Older outputs may only contain ranks or an earlier pressure score."));
    $("info-title").textContent = "How the score works";
    $("info-pill").textContent = cumulative ? "Cumulative · 50 × 100" : "Ranking overview";
    meta.replaceChildren(
      details("Scoring", ["Raw total", cumulative ? "0–5,000" : "Unavailable"],
        ["Pressure score", adjusted ? "Solo + combination + repeat" : cumulative ? "Total ÷ 50" : "As exported"]),
      details("Evidence", ["Overall eligibility", cumulative ? "60 attempts · 6 matches" : "As exported"],
        ["Scenario support", cumulative ? "18 attempts · 3 matches" : "As exported"]),
      details("Validation", ["Paired players", fmt(number(holdout?.matched_players))],
        ["NDCG@10", fmt(number(holdout?.ndcg_at_10), true)],
        ...(issueCount ? [["Score check", `${fmt(issueCount)} mismatched totals`]] : [])),
    );
  }

  function visiblePlayers() {
    const query = state.query.trim();
    const scenario = current();
    const matchingPool = sourceRows().filter(auctionAllowed);
    const matches = matchingPool.filter((p) =>
      (!scenario || p.eligible || p.evidence) &&
      (!query || searchMatch(`${p.name} ${p.id}`, query)) &&
      (!state.minMatches || (p.matches ?? 0) >= state.minMatches) &&
      (!state.minAttempts || (p.attempts ?? 0) >= state.minAttempts));
    const evidenceOnly = Boolean(scenario && matches.length && !matches.some((p) => p.eligible));
    const rows = matches.filter((p) => !scenario || evidenceOnly || state.unranked || p.eligible)
      .map((p) => ({
        ...p,
        auction: auctionFor(p),
      }));
    const { key, order } = evidenceOnly && state.sort.key === "rank" ? { key: "attempts", order: -1 } : state.sort;
    rows.sort((a, b) => {
      const col = key;
      const x = a[col];
      const y = b[col];
      if (x === null || x === undefined) return y === null || y === undefined ? compare(a, b) : 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * order || compare(a, b);
    });
    return { rows, evidenceOnly };
  }

  function selectPlayer(id) {
    state.focus = id;
    state.playerLookup = true;
    state.step = Math.max(0, pressureFamilies().indexOf(current()?.family));
    renderRanking();
    renderCompare();
    renderProfile();
    renderBreakdown();
    renderAttempts();
    renderPlayerEvidence();
  }

  function renderRanking() {
    const s = current();
    const { rows: list, evidenceOnly } = visiblePlayers();
    const show = state.limit === "all" ? list : list.slice(0, Number(state.limit));
    const columns = [
      ...(!evidenceOnly ? [{ label: "Rank", sort: "rank", get: (p) => p.rank }] : []),
      { label: "Player", sort: "name", className: "name-cell", get: (p) => p.name },
      { label: "IPL 2027 team", get: (p) => p.auction?.team
        || (p.auction?.formerTeam ? `Formerly ${p.auction.formerTeam}` : "—") },
      { label: "IPL status", get: (p) => auction.shown[p.auction?.status] ?? "No match" },
      { label: "Score / 100", sort: "score", get: (p) => p.score, decimal: true, best: !evidenceOnly },
      ...(s
        ? [{ label: "Above reference", sort: "above", get: (p) => p.above, percent: true }]
        : [{ label: "Total / 5,000", sort: "total", get: (p) => p.total, decimal: true }]),
      ...(!s && sourceRows().some((p) => p.solo !== null) ? [
        { label: "Combo ±", sort: "combination", get: (p) => p.combination, decimal: true },
        { label: "Repeat +", sort: "repeat", get: (p) => p.repeat, decimal: true },
      ] : []),
      { label: "Pressure matches", sort: "matches", get: (p) => p.matches },
      { label: "Pressure attempts", sort: "attempts", get: (p) => p.attempts },
      ...(s
        ? [{ label: "Evidence", get: (p) => p.eligible ? "Supported" : p.evidence ? "Limited" : p.evidence === false ? "Unobserved" : "—" }]
        : [{ label: "Supported / 50", sort: "supported", get: (p) => p.supported }]),
    ];
    $("ranking-title").textContent = s ? evidenceOnly ? "Recorded performances · limited evidence"
      : s.isCombination ? "Combination results" : "Scenario results"
      : `${roleName[state.role]} pressure rankings`;
    $("source-csv").disabled = !rankingSource();
    const evidenceLink = $("scenario-deliveries");
    evidenceLink.hidden = !s?.deliveries || !s.attempts;
    const best = Math.max(-Infinity, ...show.map((p) => p.score ?? -Infinity));
    table($("ranking-table"), columns, show,
      state.playerPool && !list.length ? "No players in this view match the selected player pool."
        : s?.attempts === 0 ? "This situation has no scored attempts in the dataset."
        : s && !s.rows.some((p) => p.evidence || p.eligible) ? "No player scorecards are available for this situation."
        : !list.length && sourceRows().length ? "No players match the current filters."
        : "No ranking results are available in this view.", (p) => {
        const tr = element("tr", null, p.id === state.focus ? "is-current" : "");
        for (const column of columns) {
          const value = column.get(p);
          const td = element("td", null, column.className ?? (typeof value === "number" ? "num" : ""));
          if (column.sort === "name") {
            const selected = state.players.indexOf(p.id);
            const swatch = element("span", null, "swatch");
            if (selected >= 0) {
              swatch.style.background = colors[selected];
              td.append(swatch);
            }
            td.append(button(p.name, () => selectPlayer(p.id)));
          } else {
            td.textContent = typeof value === "string" ? value : column.percent ? pct(value) : fmt(value, column.decimal);
          }
          td.classList.toggle("is-best", Boolean(column.best && value === best));
          tr.append(td);
        }
        return tr;
      });
    const count = `Showing ${fmt(show.length)} of ${fmt(list.length)} matching players.`;
    $("ranking-caption").textContent = evidenceOnly
      ? `${count} These players recorded attempts. The sample is too small to assign ranks.`
      : state.playerPool
      ? `${count} Ranks are from the original results CSV.`
      : s
      ? `${count} Rank is assigned to players who meet the scenario evidence threshold.`
      : `${count} Select a player to inspect all available scenario scores.`;
    $("export-visible").disabled = !show.length;
    state.visible = { columns, show };
  }

  function renderComparePicker(slot, input) {
    const panel = $(`compare-${slot}-results`);
    const term = input.value.trim();
    const other = comparisonPair()[slot === "a" ? 1 : 0]?.id;
    const matching = playerMatches(term, state.role);
    const hits = matching.filter((p) => p.id !== other);
    panel.hidden = !term;
    input.setAttribute("aria-expanded", String(Boolean(term)));
    panel.replaceChildren(...hits.slice(0, 12).map((p) =>
      selectionOption(p.name, [`ID ${p.id}`, auctionFor(p)?.team]
        .filter(Boolean).join(" · "), () => {
        panel.hidden = true;
        input.setAttribute("aria-expanded", "false");
        chooseComparison(slot === "a" ? 0 : 1, p.id);
      })));
    if (!hits.length && term) panel.append(element("p", matching.length ? "This player is already selected in the other field."
      : `No matching player in the current ${roleName[state.role].toLowerCase()} pool.`, "results-summary"));
  }

  function updateComparison() {
    state.comparisonPage = 0;
    renderCompare();
    renderProfile();
    renderRanking();
  }

  function chooseComparison(index, id) {
    const pair = comparisonPair().map((player) => player?.id ?? null);
    pair[index] = id;
    state.comparisons[state.role] = pair;
    updateComparison();
  }

  function comparisonGap(values) {
    const [a, b] = values;
    if (a?.score == null || b?.score == null) return null;
    return (Math.round(a.score * 100) - Math.round(b.score * 100)) / 100;
  }

  function comparisonRows(pair) {
    const scope = $("compare-scope").value;
    const query = $("compare-scenario").value.trim();
    const selected = scenarios().filter((s) =>
      (scope === "all" || (scope === "combo" ? s.isCombination : !s.isCombination)) &&
      (!query || (/^\d+$/.test(query) ? s.n === Number(query)
        : searchMatch(`${scenarioLabel(s)} ${s.code ?? ""} ${s.family}`, query))));
    const rows = selected.map((s) => ({
      label: scenarioLabel(s), scenario: s, values: pair.map((p) => scenarioResult(s, p.id)),
    })).filter((row) => !$("compare-shared").checked || comparisonGap(row.values) !== null);
    const active = rows.findIndex((row) => row.scenario.id === state.scenario);
    if (active > 0) rows.unshift(...rows.splice(active, 1));
    if (!query && scope === "all" && !$("compare-shared").checked) {
      rows.unshift({ label: "Overall", values: pair.map((p) => overall().find((row) => row.id === p.id)) });
    }
    return rows;
  }

  function renderComparisonSummary(pair, rows) {
    const summary = $("compare-summary");
    summary.hidden = !pair.every(Boolean);
    if (summary.hidden) return;
    const gaps = rows.filter((row) => row.scenario).map((row) => comparisonGap(row.values))
      .filter((gap) => gap !== null);
    const wins = [gaps.filter((gap) => gap > 0).length, gaps.filter((gap) => gap < 0).length];
    const ties = gaps.length - wins[0] - wins[1];
    const winner = wins[0] === wins[1] ? null : Number(wins[1] > wins[0]);
    const shareA = gaps.length ? Math.round((wins[0] + ties / 2) * 100 / gaps.length) : null;
    const shares = shareA === null ? [] : [shareA, 100 - shareA];
    const cards = pair.map((p, i) => {
      const official = overall().find((row) => row.id === p.id);
      const card = element("div", null, winner === i ? "duel-player duel-winner" : "duel-player");
      card.append(
        element("h3", p.name),
        element("span", shares.length ? `${shares[i]} / 100` : "—", "duel-points"),
        element("p", shares.length ? `${wins[i]} scenario wins` : "No comparable score", "duel-meta"),
        element("p", official ? `Overall pressure score ${fmt(official.score, true)} · Rank ${fmt(official.rank)}`
          : "No overall rank", "duel-meta"));
      return card;
    });
    const center = element("div", null, "duel-center");
    center.append(element("h3", !gaps.length ? "No shared evidence"
      : winner === null ? "Head-to-head tied" : `${pair[winner].name} leads`));
    if (gaps.length) {
      const track = element("div", null, "duel-track");
      track.style.setProperty("--duel-share", `${shareA}%`);
      track.append(element("span"), element("span"));
      track.setAttribute("aria-hidden", "true");
      center.append(track, element("p", `${gaps.length} shared situations · ${ties} tied`, "duel-meta"),
        element("p", "One point per win, half per tie. Shares are scaled to 100 across the filtered situations.", "duel-meta"));
    } else {
      center.append(element("p", "Both players need a recorded score in the same situation.", "duel-meta"));
    }
    summary.replaceChildren(cards[0], center, cards[1]);
  }

  function renderCompare() {
    const pair = comparisonPair();
    state.players = pair.filter(Boolean).map((player) => player.id);
    for (const [i, slot] of ["a", "b"].entries()) {
      const input = $(`compare-${slot}`);
      if ($(`compare-${slot}-results`).hidden) input.value = pair[i]?.name ?? "";
      input.disabled = !state.run;
      $(`compare-${slot}-id`).textContent = pair[i] ? `Player ID ${pair[i].id}` : "";
    }
    const ready = pair.every(Boolean);
    const rows = ready ? comparisonRows(pair) : [];
    const pages = Math.max(1, Math.ceil(rows.length / comparisonPageSize));
    state.comparisonPage = Math.min(state.comparisonPage, pages - 1);
    const start = state.comparisonPage * comparisonPageSize;
    const paged = rows.slice(start, start + comparisonPageSize);
    for (const pager of document.querySelectorAll(".compare-pages")) {
      pager.hidden = !rows.length;
      pager.querySelector('[data-page-step="-1"]').disabled = !state.comparisonPage;
      pager.querySelector('[data-page-step="1"]').disabled = state.comparisonPage + 1 >= pages;
      pager.querySelector("[data-page-label]").textContent = `Page ${state.comparisonPage + 1} of ${pages}`;
    }
    $("compare-shared").disabled = !ready;
    renderComparisonSummary(pair, rows);
    const heads = ["Pressure situation", ...pair.map((p, i) => p?.name || `Player ${i ? "B" : "A"}`), "Higher score"];
    const combos = scenarios().filter((s) => s.isCombination).length;
    const scope = $("compare-scope").value;
    const scopeCount = scope === "all" ? scenarios().length : scope === "solo" ? soloScenarios().length : combos;
    $("compare-caption").textContent = ready
      ? `${roleName[state.role]} · ${modelTitle(state.model)} · ${fmt(rows.filter((r) => r.scenario).length)} of ${fmt(scopeCount)} situations`
      : `Choose two players in ${roleName[state.role].toLowerCase()} to compare ${soloScenarios().length} solo scenarios and ${combos} combinations.`;
    $("compare-leaders").disabled = topPair().length < 2;
    $("compare-clear").disabled = !pair.some(Boolean);
    $("compare-export").disabled = !rows.length;
    table($("comparison-table"), heads.map((label, i) => ({ label, className: i < 3 ? "name-cell" : "num" })),
      paged, ready ? "No pressure situations match these filters." : "Choose Player A and Player B to see their scores.", (record) => {
        const tr = element("tr", null, record.scenario?.id === state.scenario ? "is-current" : "");
        const gap = comparisonGap(record.values);
        const winner = gap === null || gap === 0 ? null : Number(gap < 0);
        const first = element("td", null, "name-cell wrapped-cell");
        first.append(record.scenario ? button(record.label, () => changeScenario(record.scenario.id)) : element("strong", record.label));
        tr.append(first);
        for (const [i, row] of record.values.entries()) {
          const cell = element("td", null, "name-cell comparison-stat");
          if (!row) cell.textContent = record.scenario ? "No recorded attempts" : "No overall result";
          else {
            cell.append(element("strong", row.score === null ? "—" : `${fmt(row.score, true)} / 100`));
            cell.append(element("small", [
              row.rank === null ? "Limited evidence" : `Rank ${fmt(row.rank)}`,
              row.matches === null ? "" : `${fmt(row.matches)} ${row.matches === 1 ? "match" : "matches"}`,
              row.attempts === null ? "" : `${fmt(row.attempts)} ${row.attempts === 1 ? "attempt" : "attempts"}`,
              !record.scenario && (auctionFor(pair[i])?.team || auctionFor(pair[i])?.formerTeam)
                ? auctionFor(pair[i]).team || `Formerly ${auctionFor(pair[i]).formerTeam}` : "",
            ].filter(Boolean).join(" · ")));
          }
          if (winner === i) cell.classList.add("comparison-win-cell");
          tr.append(cell);
        }
        const verdict = winner === null ? gap === null ? "—" : "Tie"
          : `${pair[winner].name} +${fmt(Math.abs(gap), true)}`;
        tr.append(element("td", verdict, "comparison-verdict"));
        return tr;
      });
  }

  function scoreFor(p, s) {
    const perScenario = s.rows.find((item) => item.id === p.id);
    const overallScore = number(p.raw[s.code]);
    return {
      score: overallScore ?? perScenario?.score ?? null,
      attempts: perScenario?.attempts ?? null,
      matches: perScenario?.matches ?? null,
      evidence: perScenario?.evidence ?? null,
    };
  }

  function familyScore(p, family) {
    const entries = scenarios().filter((s) => s.family === family);
    const recorded = number(p.raw[family]);
    const scores = entries.map((s) => scoreFor(p, s).score);
    if (recorded !== null && entries.length) return recorded / entries.length;
    if (scores.length && scores.every((score) => score !== null)) {
      return scores.reduce((sum, score) => sum + score, 0) / scores.length;
    }
    return null;
  }

  function renderProfile() {
    const familyList = pressureFamilies();
    const players = state.players.map(lookup).filter(Boolean);
    const legend = $("profile-legend");
    const plot = $("pressure-profile");
    legend.replaceChildren(...players.map((p, i) => {
      const item = element("span", null, "legend-item");
      const swatch = element("span", null, "swatch");
      swatch.style.background = colors[i];
      item.append(swatch, document.createTextNode(p.name));
      return item;
    }));
    if (!players.length || !familyList.length) {
      plot.replaceChildren(element("p", "Choose players to compare their pressure families.", "hint"));
      $("profile-caption").textContent = "";
      return;
    }
    const groups = familyList.map((family) => {
      const group = element("div", null, "profile-group");
      group.append(element("div", family, "profile-label"));
      for (const [i, p] of players.entries()) {
        const value = familyScore(p, family);
        const display = element("div", null, "metric-bar");
        const track = element("div", null, "metric-track");
        const bar = element("i");
        bar.style.setProperty("--fill", `${Math.min(100, Math.max(0, value ?? 0))}%`);
        bar.style.setProperty("--series-color", colors[i]);
        track.append(bar);
        display.setAttribute("aria-label", `${p.name}: ${value === null ? "unavailable" : fmt(value, true) + " out of 100"}`);
        display.append(track, element("span", fmt(value, true), "metric-value"));
        group.append(display);
      }
      return group;
    });
    plot.replaceChildren(...groups);
    $("profile-caption").textContent = "Family subtotals are scaled to 100 here so families with different scenario counts are comparable.";
  }

  function renderBreakdown() {
    const p = lookup(state.focus);
    const families = pressureFamilies();
    const pane = $("player-breakdown");
    $("previous-family").disabled = families.length < 2 || !p;
    $("next-family").disabled = families.length < 2 || !p;
    $("family-steps").replaceChildren(...families.map((f, i) => {
      const b = button("", () => { state.step = i; renderBreakdown(); }, i === state.step ? "flow-dot is-active" : "flow-dot");
      b.title = f;
      b.setAttribute("aria-label", f);
      return b;
    }));
    if (!p) {
      pane.replaceChildren(element("p", "Select a player from the rankings.", "hint"));
      return;
    }
    const heading = element("p");
    heading.append(element("strong", p.name), document.createTextNode(" "),
      element("span", p.total === null ? `${fmt(p.score, true)} / 100` : `${fmt(p.total, true)} / 5,000 · ${fmt(p.score, true)} / 100`, "player-summary"));
    pane.replaceChildren(heading);
    if (p.solo !== null) {
      pane.append(element("p", `Solo ${fmt(p.solo, true)} · Combination ${fmt(p.combination, true)} · Repeat ${fmt(p.repeat, true)} (${fmt(p.positiveMatches)} positive matches)`, "hint"));
    }
    const auctionRecord = auctionFor(p);
    if (auctionRecord?.status) {
      pane.append(element("p", [auction.shown[auctionRecord.status], auctionRecord.team,
        auctionRecord.formerTeam ? `Formerly ${auctionRecord.formerTeam}` : ""].filter(Boolean).join(" · "), "hint"));
    }
    const family = families[state.step];
    if (!family) return;
    const entries = scenarios().filter((s) => s.family === family);
    const metrics = entries.map((s) => scoreFor(p, s));
    const subtotal = number(p.raw[family])
      ?? (metrics.every((m) => m.score !== null) ? metrics.reduce((sum, m) => sum + m.score, 0) : null);
    pane.append(element("p", `${family} · ${fmt(subtotal, true)} / ${fmt(entries.length * 100)}`, "hint"));
    const list = element("ul", null, "player-scenarios");
    for (const [i, s] of entries.entries()) {
      const item = element("li");
      const value = metrics[i];
      const link = button(s.label, () => changeScenario(s.id, true), "");
      const points = element("b", fmt(value.score, true));
      if (value.evidence === false) {
        points.className = "muted";
        points.title = "Neutral score, zero recorded attempts";
      } else if (value.attempts !== null) points.title = `${fmt(value.attempts)} attempts in ${fmt(value.matches)} matches`;
      item.append(link, points);
      list.append(item);
    }
    pane.append(list);
  }

  function renderPlayerEvidence() {
    const p = lookup(state.focus);
    const card = $("selected-player");
    card.hidden = !p || !state.playerLookup;
    if (card.hidden) return;
    const overallRow = overall().find((r) => r.id === p.id);
    const s = current();
    const scenarioRow = scenarioResult(s, p.id);
    $("selected-player-title").textContent = p.name;
    $("selected-player-stats").replaceChildren(
      details("Overall ranking", ["Category", modelTitle(state.model)],
        ["Rank", overallRow?.rank ?? "—"], ["Final score", fmt(overallRow?.score, true)],
        ["Pressure matches", fmt(overallRow?.matches)], ["Pressure attempts", fmt(overallRow?.attempts)]),
      s ? details(s.label,
        ["Scenario rank", scenarioRow ? scenarioRow.rank ?? "Limited evidence" : "No recorded attempts"],
        ["Score", fmt(scenarioRow?.score, true)],
        ["Pressure matches", fmt(scenarioRow?.matches)],
        ["Pressure attempts", fmt(scenarioRow?.attempts)])
        : details("Score breakdown", ["Solo", fmt(overallRow?.solo, true)],
          ["Combination adjustment", fmt(overallRow?.combination, true)],
          ["Repeat bonus", fmt(overallRow?.repeat, true)],
          ["Positive pressure matches", fmt(overallRow?.positiveMatches)]),
      details("IPL 2027", ...iplDetails(p)),
    );
    if (!$("selected-player").querySelector("details").open) return;
    table($("player-evidence-table"), ["Scenario", "Rank", "Score / 100", "Pressure matches", "Attempts"]
      .map((label) => ({ label })), scenarios(), "No scenario results in the loaded dataset.", (scenario) => {
      const row = scenarioResult(scenario, p.id);
      const tr = element("tr", null, scenario.id === state.scenario ? "is-current" : "");
      const name = element("td", null, "wrapped-cell");
      name.append(button(scenarioLabel(scenario), () => changeScenario(scenario.id)));
      tr.append(name, ...[fmt(row?.rank), fmt(row?.score, true), fmt(row?.matches), fmt(row?.attempts)]
        .map((value) => element("td", value, "num")));
      return tr;
    });
  }

  function renderCoverage() {
    const entries = scenarios();
    $("coverage-count").textContent = `${fmt(entries.length)} scenarios`;
    const heads = ["Scenario", "Pressure family", "Eligible", "Scored attempts", "Paired", "NDCG@10"]
      .map((label, i) => ({ label, className: i < 2 ? "name-cell" : "" }));
    table($("coverage-table"), heads, entries, "Load a scenario index or individual scenario rankings.", (s) => {
      const tr = element("tr", null, s.id === state.scenario ? "is-current" : "");
      const lead = element("td", null, "name-cell wrapped-cell");
      lead.append(button(scenarioLabel(s), () => changeScenario(s.id, true)));
      tr.append(lead, element("td", s.family, "name-cell wrapped-cell"),
        element("td", fmt(s.eligible ?? s.rows.filter((p) => p.eligible).length), "num"),
        element("td", fmt(s.attempts), "num"), element("td", fmt(s.paired), "num"),
        element("td", fmt(s.ndcg, true), "num"));
      return tr;
    });
  }

  function renderAttempts() {
    const s = current();
    $("attempt-card").hidden = !s?.deliveries;
    if (!s?.deliveries) return;
    const loaded = state.delivery?.id === s.id ? state.delivery.rows : null;
    $("load-attempts").hidden = Boolean(loaded);
    $("load-attempts").disabled = state.delivery?.loading === true;
    if (!loaded) {
      $("attempt-caption").textContent = state.delivery?.error
        || (state.delivery?.loading ? "Reading the delivery file…" : "Load the run’s per-delivery evidence for this scenario.");
      $("attempt-table").replaceChildren();
      return;
    }
    const p = state.playerLookup ? lookup(state.focus) : null;
    const cumulative = loaded.some((r) => "cumulative_scored_attempt" in r);
    const rows = loaded.filter((r) =>
      (!p || r.player_id === p.id) && (!state.playerPool || auctionAllowed({ id: r.player_id })) &&
      (cumulative ? /^(1|true)$/i.test(r.cumulative_scored_attempt ?? "") : r.pressure_band === "pressure"));
    $("attempt-caption").textContent = `${p?.name ?? (state.playerPool ? "Selected player pool" : "All players")} · ${fmt(rows.length)} scored attempts. Showing up to 100.`;
    const heads = ["Date", "Match ID", "Player", "Runs", "Wickets", "Required rate change", "Evidence weight"]
      .map((label, i) => ({ label, className: i < 3 ? "name-cell" : "" }));
    table($("attempt-table"), heads, rows.slice(0, 100), "No scored deliveries for this player in the loaded file.", (r) => {
      const tr = element("tr");
      for (const [i, value] of [r.date, r.match_id, r.player_name, fmt(number(r.runs_observed)),
        fmt(number(r.wickets_observed)), fmt(number(r.required_rate_change), true),
        fmt(number(r.cumulative_evidence_weight), true)].entries()) {
        tr.append(element("td", value || "—", i < 3 ? "name-cell" : "num"));
      }
      return tr;
    });
  }

  function render() {
    renderControls();
    renderSource();
    renderIntro();
    renderCompare();
    renderRanking();
    renderProfile();
    renderBreakdown();
    renderCoverage();
    renderAttempts();
    renderPlayerEvidence();
  }

  function changeScenario(id, navigate = false) {
    const previous = state.focus;
    state.findScenario = false;
    state.scenarioQuery = "";
    state.scenario = id;
    state.comparisonPage = 0;
    const s = current();
    state.delivery = null;
    state.sort = { key: "rank", order: 1 };
    state.step = Math.max(0, pressureFamilies().indexOf(s?.family));
    const previousPlayer = lookup(previous);
    state.focus = previousPlayer && auctionAllowed(previousPlayer) ? previous : sourceRows().find(auctionAllowed)?.id ?? null;
    render();
    if (navigate) $("ranking-title").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function setRole(role, reset = true) {
    state.role = role;
    state.comparisonPage = 0;
    state.scenario = overall().length ? "" : scenarios().find((s) => s.rows.length)?.id ?? "";
    state.unranked = false;
    state.query = "";
    state.findScenario = state.findPlayer = state.playerLookup = false;
    state.scenarioQuery = "";
    state.minMatches = state.minAttempts = 0;
    state.delivery = null;
    state.step = 0;
    state.sort = { key: "rank", order: 1 };
    const candidates = overall().length ? overall() : sourceRows();
    state.focus = candidates.find(auctionAllowed)?.id ?? null;
    if (reset) render();
  }

  function status(text, isError = false) {
    $("load-status").textContent = text;
    $("load-status").classList.toggle("is-error", isError);
  }

  async function activateModel(collection, model, preserve = false, token = ++loadToken) {
    if (!collection?.entries[model]) return;
    const previous = preserve ? {
      scenario: state.scenario, focus: state.focus, query: state.query,
      minMatches: state.minMatches, minAttempts: state.minAttempts, unranked: state.unranked,
      playerLookup: state.playerLookup,
    } : {};
    status(`Reading ${modelTitle(model)} rankings…`);
    try {
      const entries = collection.entries[model];
      const run = collection.cache.get(model) ?? await buildRun(
        typeof entries === "function" ? await entries() : entries, collection.name,
      );
      if (token !== loadToken) return;
      collection.cache.set(model, run);
      if (!playerIndex.has(run)) {
        const byRole = Object.fromEntries(Object.entries(run.overall).map(([role, players]) =>
          [role, new Map(players.map((p) => [p.id, { ...p, role }]))]));
        for (const s of run.scenarios) {
          for (const p of s.rows) {
            if (!byRole[s.role].has(p.id)) byRole[s.role].set(p.id, { ...p, role: s.role });
          }
        }
        playerIndex.set(run, byRole);
      }
      state.collection = collection;
      state.model = model;
      state.run = run;
      const hasRole = (role) => run.overall[role].length || run.scenarios.some((s) => s.role === role);
      setRole(hasRole(state.role) ? state.role : hasRole("batter") ? "batter" : "bowler", false);
      if (previous.scenario && scenarios().some((s) => s.id === previous.scenario)) {
        state.scenario = previous.scenario;
      }
      state.step = Math.max(0, pressureFamilies().indexOf(current()?.family));
      if (lookup(previous.focus)) state.focus = previous.focus;
      for (const field of ["query", "minMatches", "minAttempts", "unranked", "playerLookup"]) {
        if (field in previous) state[field] = previous[field];
      }
      render();
      const combinations = run.scenarios.filter((s) => s.isCombination).length;
      status(`${modelTitle(model)} ready · ${run.scenarios.length - combinations} solo scenarios · ${combinations} combinations.`);
    } catch (error) {
      if (token !== loadToken) return;
      renderControls();
      status(error.message || "The included rankings could not be read.", true);
    }
  }

  async function load(input, name) {
    const id = ++loadToken;
    status("Reading ranking and scenario files…");
    try {
      const files = await input();
      const readTable = async (path) => parseCSV(await files.find((file) => file.path === path).text());
      const [collection, pool, rankingCategories, validation] = await Promise.all([
        buildCollection(files, name),
        readTable("dashboard_reference/player_pool.csv"),
        readTable("dashboard_reference/ranking_categories.csv"),
        readTable("rr_model_comparison/model_comparison.csv"),
      ]);
      for (const player of pool) {
        playerReference.set(player.player_id, { ...player, team: player.current_team,
          formerTeam: player.former_team, status: player.ipl_status });
      }
      for (const category of rankingCategories) categories.set(category.model, category);
      optionList($("archive-model"), [["", "All categories"], ["shared", "Shared outputs"],
        ...rankingCategories.map((category) => [category.model, category.category])], "");
      renderArchive();
      collection.validation = validation;
      collection.cache = new Map();
      if (id !== loadToken) return;
      const preferred = rankingCategories.find((entry) => entry.default_view === "true")?.model;
      await activateModel(collection, preferred ?? collection.initial, false, id);
    } catch (error) {
      if (id !== loadToken) return;
      status(error.message || "The files could not be loaded.", true);
    }
  }

  const archiveView = { page: 0, size: 35, request: 0 };

  function archiveEntry(file) {
    const blob = async () => {
      const encoded = $(`rr-asset-${file.asset}`)?.textContent;
      if (encoded === undefined) throw new Error(`Data unavailable for ${file.path}.`);
      const bytes = typeof Uint8Array.fromBase64 === "function" ? Uint8Array.fromBase64(encoded)
        : Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      const packed = new Blob([bytes]);
      return file.packed ? new Response(packed.stream().pipeThrough(new DecompressionStream("gzip"))).blob() : packed;
    };
    return { path: file.path, blob, text: async () => (await blob()).text() };
  }

  function saveFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = element("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function archiveLink(file, label) {
    if (file.kind === "parquet") {
      const link = element("a", label, "archive-table-link");
      link.href = `../results/${file.path.split("/").map(encodeURIComponent).join("/")}`;
      link.download = file.path.split("/").at(-1);
      return link;
    }
    return button(label, async () => {
      try { saveFile(await archiveEntry(file).blob(), file.path.split("/").at(-1)); }
      catch (error) { status(error.message, true); }
    }, "btn btn-sm");
  }

  async function previewFile(file) {
    const panel = $("archive-preview");
    const request = ++archiveView.request;
    panel.hidden = false;
    const head = element("div", null, "card-head");
    head.append(element("h3", file.path, "card-title archive-preview-title"),
      archiveLink(file, "Download file"),
      button("Close preview", () => { archiveView.request += 1; panel.hidden = true; }, "btn btn-sm"));
    const contents = element("div");
    panel.replaceChildren(head, contents);
    if (file.kind === "parquet") {
      contents.append(element("p", "Parquet data is available to download. Use the matching ranking or delivery CSV for a browser preview.", "hint"));
      return;
    }
    contents.append(element("p", "Reading archived file…", "hint"));
    try {
      const input = archiveEntry(file);
      if (file.kind === "json") {
        const json = JSON.parse(await input.text());
        if (request === archiveView.request) contents.replaceChildren(element("pre", JSON.stringify(json, null, 2)));
        return;
      }
      const rows = file.kind === "csv.gz" ? await attemptRows(input, 50) : parseCSV(await input.text(), 50);
      if (request !== archiveView.request) return;
      const cols = Object.keys(rows[0] ?? {});
      if (!cols.length) {
        contents.replaceChildren(element("p", "This file contains no data rows.", "hint"));
        return;
      }
      const wrap = element("div", null, "table-wrap coverage-wrap");
      const grid = element("table", null, "data-table");
      table(grid, cols.map((label) => ({ label })), rows.slice(0, 50), "No rows in this file.", (row) => {
        const tr = element("tr");
        tr.append(...cols.map((c) => element("td", row[c])));
        return tr;
      });
      wrap.append(grid);
      contents.replaceChildren(element("p", "Showing up to 50 rows. Download the file for the full contents.", "caption"), wrap);
    } catch (error) {
      if (request === archiveView.request) contents.replaceChildren(element("p", error.message, "hint"));
    }
  }

  function renderArchive() {
    const files = archiveFiles;
    const input = $("archive-search").value;
    const kind = $("archive-type").value;
    const model = $("archive-model").value;
    const hits = files.filter((f) => (!input || searchMatch(f.path, input))
      && (!kind || kind === f.kind) && (!model || model === f.model));
    const pages = Math.max(1, Math.ceil(hits.length / archiveView.size));
    archiveView.page = Math.min(archiveView.page, pages - 1);
    const offset = archiveView.page * archiveView.size;
    const rows = hits.slice(offset, offset + archiveView.size);
    $("archive-count").textContent = `${fmt(files.length)} files`;
    $("archive-page").textContent = hits.length
      ? `${fmt(offset + 1)}–${fmt(offset + rows.length)} of ${fmt(hits.length)} matches` : "0 files match";
    $("archive-prev").disabled = archiveView.page === 0;
    $("archive-next").disabled = archiveView.page + 1 >= pages;
    table($("archive-table"), ["Archive path", "Ranking category", "Type", "Size", "File"].map((label) => ({ label })),
      rows, "No archived files match these filters.", (file) => {
        const tr = element("tr");
        const path = element("td", null, "name-cell wrapped-cell");
        path.append(button(file.path, () => previewFile(file)));
        const size = file.bytes < 1e6 ? `${fmt(file.bytes / 1e3, true)} kB` : `${fmt(file.bytes / 1e6, true)} MB`;
        const download = element("td");
        download.append(archiveLink(file, "Download"));
        tr.append(path, element("td", modelTitle(file.model)), element("td", file.kind.toUpperCase()),
          element("td", size, "num"), download);
        return tr;
      });
  }

  for (const tab of $("role-tabs").querySelectorAll("button")) {
    tab.addEventListener("click", () => setRole(tab.dataset.role));
  }
  $("model").addEventListener("change", (event) => activateModel(state.collection, event.target.value, true));
  $("player-pool").addEventListener("change", (event) => {
    state.playerPool = event.target.value;
    state.comparisonPage = 0;
    state.query = "";
    state.playerLookup = state.findPlayer = false;
    state.sort = { key: "rank", order: 1 };
    state.focus = sourceRows().find((p) => p.eligible && auctionAllowed(p))?.id ?? null;
    render();
  });
  $("overall-view").addEventListener("click", () => changeScenario(""));
  $("scenario-search").addEventListener("focus", () => {
    state.findScenario = true;
    state.findPlayer = false;
    state.scenarioQuery = "";
    $("scenario-search").value = "";
    renderScenarioSearch();
    renderPlayerSearch();
  });
  $("scenario-search").addEventListener("input", (event) => {
    state.findScenario = true;
    state.scenarioQuery = event.target.value;
    renderScenarioSearch();
  });
  $("player-search").addEventListener("focus", () => {
    state.findPlayer = true;
    state.findScenario = false;
    renderPlayerSearch();
    renderScenarioSearch();
  });
  $("player-search").addEventListener("input", (event) => {
    state.query = event.target.value;
    state.findPlayer = true;
    const matches = playerMatches();
    state.playerLookup = matches.length === 1 && matches[0].role === state.role;
    if (state.playerLookup) state.focus = matches[0].id;
    renderRanking();
    renderCompare();
    renderBreakdown();
    renderPlayerSearch();
    renderPlayerEvidence();
  });
  $("clear-player").addEventListener("click", () => {
    state.playerLookup = state.findPlayer = false;
    state.query = "";
    render();
  });
  $("selected-player").querySelector("details").addEventListener("toggle", renderPlayerEvidence);
  for (const [input, menu, close, paint] of [
    ["scenario-search", "scenario-results", () => { state.findScenario = false; }, renderScenarioSearch],
    ["player-search", "player-results", () => { state.findPlayer = false; }, renderPlayerSearch],
  ]) {
    $(input).addEventListener("keydown", (event) => {
      if (event.key === "Escape") { close(); paint(); }
      if (!$(menu).hidden && ["Enter", "ArrowDown"].includes(event.key)) {
        const first = $(menu).querySelector("button");
        if (!first) return;
        event.preventDefault();
        if (event.key === "Enter") first.click();
        else first.focus();
      }
    });
    $(menu).addEventListener("keydown", (event) => {
      const options = [...$(menu).querySelectorAll("button")];
      const index = options.indexOf(document.activeElement);
      if (event.key === "Escape") { $(input).focus(); close(); paint(); }
      if (index < 0 || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      const next = index + (event.key === "ArrowDown" ? 1 : -1);
      if (next < 0) $(input).focus();
      else options[Math.min(options.length - 1, next)].focus();
    });
  }
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".search-field")) {
      state.findScenario = state.findPlayer = false;
      renderScenarioSearch();
      renderPlayerSearch();
    }
  });
  for (const [id, field, label] of [["min-matches", "minMatches", "match-value"], ["min-attempts", "minAttempts", "attempt-value"]]) {
    $(id).addEventListener("input", (event) => {
      state[field] = Number(event.target.value);
      $(label).textContent = formatted(state[field]);
      renderRanking();
    });
  }
  $("row-limit").addEventListener("change", (event) => { state.limit = event.target.value; renderRanking(); });
  $("include-unranked").addEventListener("change", (event) => { state.unranked = event.target.checked; renderRanking(); });
  for (const slot of ["a", "b"]) {
    const input = $(`compare-${slot}`);
    const menu = $(`compare-${slot}-results`);
    const close = () => {
      menu.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.value = comparisonPair()[slot === "a" ? 0 : 1]?.name ?? "";
    };
    input.addEventListener("input", () => renderComparePicker(slot, input));
    input.addEventListener("focus", () => input.select());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
      if (menu.hidden || !["Enter", "ArrowDown"].includes(event.key)) return;
      const first = menu.querySelector("button");
      if (!first) return;
      event.preventDefault();
      if (event.key === "Enter") first.click();
      else first.focus();
    });
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { close(); input.focus(); }
      if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const options = [...menu.querySelectorAll("button")];
      const next = options.indexOf(document.activeElement) + (event.key === "ArrowDown" ? 1 : -1);
      if (next < 0) input.focus();
      else options[Math.min(options.length - 1, next)]?.focus();
    });
    input.parentElement.addEventListener("focusout", (event) => {
      if (input.parentElement.contains(event.relatedTarget)) return;
      const index = slot === "a" ? 0 : 1;
      const pair = comparisonPair();
      if (!menu.hidden) {
        const query = playerQuery(input.value);
        const exact = playerMatches(query, state.role).filter((p) =>
          p.id === query || searchWords(p.name) === searchWords(query) || auction.key(p.name) === auction.key(query));
        if (exact.length === 1 && pair.every((p) => p?.id !== exact[0].id)) chooseComparison(index, exact[0].id);
      }
      close();
    });
  }
  for (const [id, event] of [["compare-scope", "change"], ["compare-scenario", "input"], ["compare-shared", "change"]]) {
    $(id).addEventListener(event, () => { state.comparisonPage = 0; renderCompare(); });
  }
  for (const control of document.querySelectorAll(".compare-pages [data-page-step]")) {
    control.addEventListener("click", () => {
      state.comparisonPage += Number(control.dataset.pageStep);
      renderCompare();
    });
  }
  $("compare-clear").addEventListener("click", () => {
    state.comparisons[state.role] = [null, null];
    updateComparison();
  });
  $("compare-leaders").addEventListener("click", () => {
    state.comparisons[state.role] = null;
    updateComparison();
  });
  $("compare-export").addEventListener("click", () => {
    const pair = comparisonPair();
    if (!pair.every(Boolean)) return;
    const columns = ["scenario", ...pair.flatMap((p) => ["player_id", "score100", "rank", "pressure_matches", "attempts"]
      .map((field) => `${p.name} ${field}`)), "score_gap_a_minus_b", "higher_score_player_id"];
    const rows = comparisonRows(pair).map(({ label, values }) => {
      const gap = comparisonGap(values);
      return [label, ...values.flatMap((r, i) => [pair[i].id, r?.score, r?.rank, r?.matches, r?.attempts]),
        gap, gap > 0 ? pair[0].id : gap < 0 ? pair[1].id : ""];
    });
    saveFile(new Blob([exportCSV(columns, rows)], { type: "text/csv;charset=utf-8" }),
      `rr_${state.role}_${state.model}_comparison.csv`);
  });
  for (const [id, increment] of [["previous-family", -1], ["next-family", 1]]) {
    $(id).addEventListener("click", () => {
      const count = pressureFamilies().length;
      if (count) state.step = (state.step + count + increment) % count;
      renderBreakdown();
    });
  }
  async function loadAttempts() {
    const s = current();
    if (!s?.deliveries || state.delivery?.loading || state.delivery?.rows) return;
    const request = { id: s.id, loading: true };
    state.delivery = request;
    renderAttempts();
    try {
      const rows = await attemptRows(s.deliveries);
      if (state.delivery === request) state.delivery = { id: s.id, rows };
    } catch (error) {
      if (state.delivery === request) state.delivery = { id: s.id, error: error.message };
    }
    renderAttempts();
  }
  $("load-attempts").addEventListener("click", loadAttempts);
  $("scenario-deliveries").addEventListener("click", () => {
    loadAttempts();
    $("attempt-card").scrollIntoView({ block: "start", behavior: "smooth" });
  });
  $("source-csv").addEventListener("click", async () => {
    const source = rankingSource();
    if (!source) return;
    try { saveFile(await source.blob(), source.path.split("/").at(-1)); }
    catch (error) { status(error.message, true); }
  });
  $("export-visible").addEventListener("click", () => {
    if (!state.visible?.show.length) return;
    const { columns, show } = state.visible;
    const bytes = exportCSV(columns.map((c) => c.label), show.map((p) => columns.map((c) => c.get(p))));
    saveFile(new Blob([bytes], { type: "text/csv;charset=utf-8" }), `rr_${state.role}_${state.scenario || "overall"}.csv`);
  });
  $("download-submission").addEventListener("click", async () => {
    const submission = archive.files.find((file) => file.path === "submission.csv");
    try { saveFile(await archiveEntry(submission).blob(), "submission.csv"); }
    catch (error) { status(error.message, true); }
  });

  const themeKey = "rr-pressure-explorer-theme";
  try {
    const theme = localStorage.getItem(themeKey);
    if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
  } catch {}
  $("btn-theme").addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(themeKey, theme); } catch {}
  });

  render();
  if (archive?.files?.length) {
    const distinct = (field) => [...new Set(archiveFiles.map((file) => file[field]))].sort();
    optionList($("archive-type"), [["", "All file types"], ...distinct("kind").map((k) => [k, k.toUpperCase()])], "");
    for (const [id, event] of [["archive-search", "input"], ["archive-type", "change"], ["archive-model", "change"]]) {
      $(id).addEventListener(event, () => { archiveView.page = 0; renderArchive(); });
    }
    $("archive-prev").addEventListener("click", () => { archiveView.page -= 1; renderArchive(); });
    $("archive-next").addEventListener("click", () => { archiveView.page += 1; renderArchive(); });
    document.querySelector('a[href="#archive"]').addEventListener("click", () => { $("archive").open = true; });
    renderArchive();
    load(async () => archive.files.map(archiveEntry), "RR pressure results");
  }
})();
