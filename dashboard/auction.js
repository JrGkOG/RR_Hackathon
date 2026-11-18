(() => {
  "use strict";
  const clean = (text) => String(text ?? "").normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  const shown = { unsold: "Unsold", sold: "Sold", traded: "Traded", retained: "Retained",
    unauctioned: "Listed, not called", released: "Released", retired: "Retired" };
  const aliases = {
    williamjacks: "willjacks", josephbuttler: "josbuttler", lokeshrahul: "klrahul",
    patrickcummins: "patcummins", philipsalt: "philsalt", matthewshort: "mattshort",
    mshahrukhkhan: "shahrukhkhan", vaibhavsooryavanshi: "vaibhavsuryavanshi",
    jakemcgurk: "jakefrasermcgurk", varunchakravarthy: "varunchakaravarthy",
    nambooritilakvarma: "tilakvarma", nitishreddy: "nitishkumarreddy",
    digveshrathi: "digveshsinghrathi", allahghazanfar: "amghazanfar",
    rasikhsalam: "rasikhdarsalam", saikishore: "ravisrinivasansaikishore",
    vyshakkumar: "vijaykumarvyshak",
    vyshakvijaykumar: "vijaykumarvyshak", lungisaningidi: "lungingidi",
    mohammadsiraj: "mohammedsiraj", mohdarshadkhan: "arshadkhan",
    rsaikishore: "ravisrinivasansaikishore", rasikhdar: "rasikhdarsalam",
    abhishekporel: "abishekporel", mahendrasinghdhoni: "msdhoni",
    zakfoulkes: "zakaryfoulkes", yudhvirsingh: "yudhvircharak",
  };
  function key(name) {
    const n = clean(name);
    return Object.hasOwn(aliases, n) ? aliases[n] : n;
  }
  const present = (value) => value === null || value === undefined || value === "--" || value === "—" ? "" : String(value);

  function index(players) {
    return new Map(players.filter((p) => p.name && Object.hasOwn(shown, p.status)).map((p) => [
      key(p.name), { name: p.name, status: p.status, team: present(p.team), formerTeam: present(p.formerTeam),
        released: Boolean(p.formerTeam), basePrice: present(p.basePrice), finalPrice: present(p.finalPrice) },
    ]));
  }

  function historicalIndex(auctionPlayers, releases) {
    const players = index(releases);
    for (const [id, result] of index(auctionPlayers)) {
      const release = players.get(id);
      players.set(id, { ...result, formerTeam: release?.formerTeam ?? "", released: Boolean(release) });
    }
    return players;
  }

  function matches(record, filter, season) {
    if (!filter) return true;
    if (filter === "shortlist") {
      return season === "2027" ? record?.status === "released" : record?.released && record.status === "unsold";
    }
    if (filter === "released") return Boolean(record?.released);
    if (filter === "squad") return Boolean(record?.team);
    return record?.status === filter;
  }

  globalThis.PressureAuction = { key, index, historicalIndex, matches, shown };
  if (typeof module !== "undefined") module.exports = globalThis.PressureAuction;
})();
