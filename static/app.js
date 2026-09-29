/* Pages en ancre : #/, #/clubs, #/equipes/:id, #/matchs/:id.
   Les fiches sont lues dans data/94.json, sans serveur. */

const main = document.getElementById("contenu");
const PIN_KEY = "volley94.equipes";
let meta = null;
let clubs = [];
let returnFocus = null;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function raw(html) { return { raw: html }; }

function h(strings, ...vals) {
  let out = "";
  strings.forEach((part, index) => {
    out += part;
    if (index >= vals.length) return;
    const value = vals[index];
    out += value && value.raw != null ? value.raw : esc(value);
  });
  return out;
}

function ext(href, label) {
  return h`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}<span class="sr-only"> (s’ouvre dans un nouvel onglet)</span></a>`;
}

function countPhrase(n, one, many) {
  return n + " " + (Number(n) > 1 ? many : one);
}

function setsPhrase(home, away) {
  const word = Number(home) === 1 ? "set" : "sets";
  return home + " " + word + " à " + away;
}

const STATIC_BASE = new URL("./", document.currentScript.src);
const DATA_URL = new URL("../data/94.json", STATIC_BASE);
const CALENDAR_FILE = "asa-maisons-alfort-2.ics";
const SM2_CLUB = "0946822";
const SM2_FFVB = "ASA MAISONS-ALFORT 2";
const LEVEL_LABEL = {
  departemental: "Départemental",
  "accession-regionale": "Accession régionale",
  regional: "Régional",
  "pre-national": "Pré-national",
  jeunes: "Jeunes",
  loisir: "Loisir",
  national: "National",
  autre: "Autre"
};
const LEVEL_ORDER = Object.keys(LEVEL_LABEL);

let db = null;
let calendarTeam = null;

function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function queryMatches(query, blob) {
  const folded = fold(query);
  const hay = fold(blob);
  if (!folded) return true;
  if (hay.includes(folded)) return true;
  const words = hay.split(" ");
  return folded.split(" ").every((tok) => hay.includes(tok) || words.some((word) => word.startsWith(tok)));
}

function todayParis() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function indexById(list) {
  const out = {};
  (list || []).forEach((item) => { out[item.id] = item; });
  return out;
}

function cmpText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function cmpMatch(a, b) {
  return cmpText(a.date, b.date) || cmpText(a.time || "99", b.time || "99") || cmpText(a.code, b.code);
}

function publicMatch(match, poule) {
  let score = (match.score || "").trim();
  if (score) score = score.replace(/\s*,\s*/g, ", ");
  let total = match.total || null;
  if (total && String(total).includes("-")) {
    const parts = String(total).split("-");
    total = parts[0].trim() + " à " + parts.slice(1).join("-").trim();
  }
  return {
    id: match.id,
    code: match.code,
    date: match.date,
    time: match.time || null,
    home_name: match.home_name,
    away_name: match.away_name,
    home_team_id: match.home_team_id || null,
    away_team_id: match.away_team_id || null,
    home_club_id: match.home_club_id || null,
    away_club_id: match.away_club_id || null,
    gym_label: match.gym_label || null,
    sets_home: match.sets_home,
    sets_away: match.sets_away,
    score: score || null,
    total,
    status: match.status,
    referee_1: match.referee_1 || null,
    referee_2: match.referee_2 || null,
    poule_id: match.poule_id,
    poule_code: poule ? poule.code : null,
    poule_label: poule ? poule.label : null,
    poule_url: poule ? poule.url : null
  };
}

function nextMatch(teamId) {
  const today = todayParis();
  const mine = Object.values(db.matches).filter((match) =>
    match.home_team_id === teamId || match.away_team_id === teamId
  );
  let found = mine.filter((match) => match.date >= today && match.status !== "joue").sort(cmpMatch);
  if (!found.length) found = mine.filter((match) => match.date >= today).sort(cmpMatch).slice(0, 1);
  if (!found.length) return null;
  const match = found[0];
  const home = match.home_team_id === teamId;
  return {
    id: match.id,
    date: match.date,
    time: match.time || null,
    opponent: home ? match.away_name : match.home_name,
    gym_label: match.gym_label || null,
    home
  };
}

function teamCard(team) {
  const club = db.clubs[team.club_id];
  const poule = db.poules[team.poule_id];
  const standing = team.standing || {};
  return {
    id: team.id,
    name: team.name,
    ffvb_name: team.ffvb_name,
    club_id: club.id,
    club_name: club.name,
    city: club.city || null,
    featured: !!club.featured,
    poule_id: poule.id,
    poule_code: poule.code,
    label: poule.label,
    gender: poule.gender,
    level: poule.level,
    category: poule.category,
    group: poule.group || null,
    usual_gym: team.usual_gym || null,
    rank: standing.rank ?? null,
    poule_size: (poule.rankings || []).length,
    points: standing.points ?? null,
    played: standing.played ?? null,
    won: standing.won ?? null,
    lost: standing.lost ?? null,
    next_match: nextMatch(team.id)
  };
}

function searchBlob(team) {
  const club = db.clubs[team.club_id];
  const poule = db.poules[team.poule_id];
  return [team.name, team.ffvb_name, club.name, club.short_name, club.city, club.ffvb_name, club.note, poule.label, poule.code, poule.official_name]
    .map((part) => part || "").join(" ");
}

function publicClub(club, teamCount) {
  const payload = {
    id: club.id,
    department_code: club.department_code,
    name: club.name,
    short_name: club.short_name || null,
    ffvb_name: club.ffvb_name,
    city: club.city || null,
    featured: !!club.featured,
    website: club.website || null,
    usual_gym: club.usual_gym || null,
    note: club.note || null,
    planning_url: club.planning_url || null
  };
  if (teamCount != null) payload.team_count = teamCount;
  return payload;
}

function listTeams(params) {
  if (params.ids) {
    const teams = [];
    const missing = [];
    params.ids.split(",").filter(Boolean).forEach((id) => {
      const team = db.teams[id];
      if (team) teams.push(teamCard(team));
      else missing.push(id);
    });
    return { teams, missing, total: teams.length };
  }
  const found = Object.values(db.teams).filter((team) => {
    const poule = db.poules[team.poule_id];
    if (params.club && team.club_id !== params.club) return false;
    if (params.niveau && poule.level !== params.niveau) return false;
    if (params.sexe && poule.gender !== params.sexe) return false;
    if (params.q && !queryMatches(params.q, searchBlob(team))) return false;
    return true;
  }).map(teamCard);
  found.sort((a, b) =>
    (a.featured ? 0 : 1) - (b.featured ? 0 : 1)
    || cmpText(a.next_match ? a.next_match.date : "9999-99-99", b.next_match ? b.next_match.date : "9999-99-99")
    || cmpText(fold(a.name), fold(b.name))
    || cmpText(a.label, b.label)
  );
  return { teams: found, missing: [], total: found.length };
}

function listClubs() {
  const clubs = Object.values(db.clubs).map((club) => {
    const count = Object.values(db.teams).filter((team) => team.club_id === club.id).length;
    return publicClub(club, count);
  });
  clubs.sort((a, b) => (a.featured ? 0 : 1) - (b.featured ? 0 : 1) || cmpText(fold(a.name), fold(b.name)));
  return { clubs };
}

function clubDetail(id) {
  const club = db.clubs[id];
  if (!club) return null;
  const teams = Object.values(db.teams).filter((team) => team.club_id === id).map(teamCard);
  teams.sort((a, b) => cmpText(a.label, b.label) || cmpText(a.name, b.name));
  const today = todayParis();
  const own = Object.values(db.matches).filter((match) => match.home_club_id === id || match.away_club_id === id);
  own.sort(cmpMatch);
  const upcoming = [];
  const recent = [];
  own.forEach((match) => {
    const view = publicMatch(match, db.poules[match.poule_id]);
    if (match.date >= today && match.status !== "joue") upcoming.push(view);
    else if (match.date < today || match.status === "joue") recent.push(view);
  });
  return {
    club: publicClub(club, teams.length),
    teams,
    upcoming: upcoming.slice(0, 12),
    recent: recent.slice(-5).reverse()
  };
}

function publicRanking(row) {
  const kept = {
    rank: row.rank ?? null,
    name: row.name,
    ffvb_name: row.ffvb_name,
    ffvb_code: row.ffvb_code,
    team_id: row.team_id || null,
    in_department: !!row.in_department
  };
  ["points", "played", "won", "lost", "forfeit", "w3_0", "w3_1", "w3_2", "l2_3", "l1_3", "l0_3", "sets_for", "sets_against", "sets_ratio", "points_for", "points_against", "points_ratio"]
    .forEach((key) => { kept[key] = Object.prototype.hasOwnProperty.call(row, key) ? row[key] : 0; });
  return kept;
}

function teamDetail(id) {
  const team = db.teams[id];
  if (!team) return null;
  const poule = db.poules[team.poule_id];
  const matches = Object.values(db.matches).filter((match) => match.home_team_id === id || match.away_team_id === id);
  matches.sort(cmpMatch);
  const today = todayParis();
  const upcoming = [];
  const played = [];
  matches.forEach((match) => {
    const view = publicMatch(match, poule);
    if (match.date >= today && match.status !== "joue") upcoming.push(view);
    else played.push(view);
  });
  return {
    team: teamCard(team),
    club: publicClub(db.clubs[team.club_id]),
    poule: {
      id: poule.id,
      code: poule.code,
      label: poule.label,
      official_name: poule.official_name || null,
      gender: poule.gender,
      level: poule.level,
      category: poule.category,
      group: poule.group || null,
      url: poule.url,
      scope: poule.scope || null,
      shared: !!poule.shared
    },
    rankings: (poule.rankings || []).map(publicRanking),
    upcoming,
    played: played.slice().reverse(),
    upcoming_count: upcoming.length
  };
}

function matchDetail(id) {
  const match = db.matches[id];
  if (!match) return null;
  return { match: publicMatch(match, db.poules[match.poule_id]) };
}

function metaView() {
  const seen = new Set();
  const levels = [];
  Object.values(db.poules).forEach((poule) => {
    if (seen.has(poule.level)) return;
    seen.add(poule.level);
    levels.push({
      id: poule.level,
      label: LEVEL_LABEL[poule.level] || poule.level,
      help: (db.level_help || {})[poule.level] || ""
    });
  });
  levels.sort((a, b) => {
    const ia = LEVEL_ORDER.indexOf(a.id);
    const ib = LEVEL_ORDER.indexOf(b.id);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const pouleNames = {};
  Object.values(db.poules).forEach((poule) => { pouleNames[poule.code] = poule.label; });
  return {
    season: db.season,
    generated_at: db.generated_at,
    featured_club_id: db.featured_club_id,
    departments: db.departments,
    counts: {
      clubs: Object.keys(db.clubs).length,
      teams: Object.keys(db.teams).length,
      matches: Object.keys(db.matches).length,
      poules: Object.keys(db.poules).length
    },
    levels,
    genders: [
      { id: "feminin", label: "Féminin (femmes, filles)" },
      { id: "masculin", label: "Masculin (hommes, garçons)" },
      { id: "mixte", label: "Mixte" }
    ],
    level_help: db.level_help,
    limits: db.limits,
    sources: db.sources,
    warnings: db.warnings,
    poule_names: pouleNames
  };
}

function answer(path) {
  const cut = path.indexOf("?");
  const route = cut === -1 ? path : path.slice(0, cut);
  const query = {};
  new URLSearchParams(cut === -1 ? "" : path.slice(cut + 1)).forEach((value, key) => { query[key] = value; });
  if (route === "/api/meta") return metaView();
  if (route === "/api/clubs") return listClubs();
  if (route === "/api/equipes") return listTeams(query);
  let found = route.match(/^\/api\/clubs\/(\d+)$/);
  if (found) {
    const detail = clubDetail(found[1]);
    if (!detail) throw new Error("Club introuvable.");
    return detail;
  }
  found = route.match(/^\/api\/equipes\/([A-Za-z0-9_-]+)$/);
  if (found) {
    const detail = teamDetail(found[1]);
    if (!detail) throw new Error("Équipe introuvable.");
    return detail;
  }
  found = route.match(/^\/api\/matchs\/([A-Za-z0-9_-]+)$/);
  if (found) {
    const detail = matchDetail(found[1]);
    if (!detail) throw new Error("Match introuvable.");
    return detail;
  }
  throw new Error("Adresse inconnue.");
}

function api(path) {
  return Promise.resolve(answer(path));
}

function hashParts() {
  const raw = location.hash.replace(/^#/, "");
  const cut = raw.indexOf("?");
  const path = (cut === -1 ? raw : raw.slice(0, cut)) || "/";
  return {
    path: path.startsWith("/") ? path : "/" + path,
    query: new URLSearchParams(cut === -1 ? "" : raw.slice(cut + 1))
  };
}

function calendarButton(label) {
  return h`<a class="button" href="${CALENDAR_FILE}">${label}</a>`;
}

function pins() {
  try {
    const list = JSON.parse(localStorage.getItem(PIN_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch (_err) {
    return [];
  }
}

function setPins(list) {
  localStorage.setItem(PIN_KEY, JSON.stringify(list));
}

function togglePin(id, where) {
  const current = pins();
  setPins(current.includes(id) ? current.filter((item) => item !== id) : current.concat(id));
  returnFocus = { id, where };
  route();
}

function focusPinned(where, id) {
  const sel = `[data-pin="${CSS.escape(id)}"]`;
  let scope = main;
  if (where === "suivies") scope = document.getElementById("suivies");
  else if (document.getElementById("resultats")) scope = document.getElementById("resultats");
  const again = (scope && scope.querySelector(sel)) || main.querySelector(sel);
  if (again) again.focus();
}

function formatDate(iso) {
  if (!iso) return "";
  const parts = dateParts(iso);
  return parts.weekday + " " + parts.rest;
}

function dateParts(iso) {
  if (!iso) return { weekday: "", rest: "" };
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return {
    weekday: date.toLocaleDateString("fr-FR", { weekday: "long" }),
    rest: date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })
  };
}

function formatTime(value) {
  if (!value) return "horaire à confirmer";
  const [hour, minute] = value.split(":");
  return hour + "h" + minute;
}

function groupText(group) {
  if (!group) return "";
  if (group === "haute") return "groupe des équipes les mieux classées";
  return "groupe " + group;
}

function rankText(rank, size) {
  if (!rank) return "Pas encore classée";
  const suffix = rank === 1 ? "er" : "e";
  return size ? rank + suffix + " sur " + size : rank + suffix;
}

function outcome(match, teamId) {
  if (match.status !== "joue" || match.sets_home == null) {
    return match.status === "joue" ? "Score incomplet" : "À venir";
  }
  const mine = match.home_team_id === teamId ? match.sets_home : match.sets_away;
  const other = match.home_team_id === teamId ? match.sets_away : match.sets_home;
  if (mine > other) return "Gagné, " + setsPhrase(mine, other);
  if (mine < other) return "Perdu, " + setsPhrase(mine, other);
  return "Égalité, " + setsPhrase(mine, other);
}

function pinButton(id, name) {
  const on = pins().includes(id);
  const visible = on ? "Ne plus suivre" : "Suivre cette équipe";
  return h`<button type="button" data-pin="${id}" aria-pressed="${on ? "true" : "false"}" aria-label="${visible} : ${name}">${visible}</button>`;
}

function teamLink(row) {
  if (row.team_id) return h`<a href="#/equipes/${row.team_id}">${row.name}</a>`;
  return esc(row.name) + (row.in_department ? "" : " (autre département)");
}

function matchRows(matches, teamId, emptyText) {
  const body = !matches.length
    ? h`<p class="empty">${emptyText || "Aucun match publié pour l’instant."}</p>`
    : matches.map((match) => {
      const result = teamId ? outcome(match, teamId) : "";
      const cls = result.startsWith("Gagné") ? "score" : (result.startsWith("Perdu") ? "lost" : "");
      const place = match.home_team_id === teamId ? "à la maison" : "chez l’adversaire";
      const sets = match.sets_home != null ? setsPhrase(match.sets_home, match.sets_away) : "";
      const parts = dateParts(match.date);
      const outcomeBlock = result
        ? h`<p class="match-outcome ${cls}">${result}</p>`
        : (sets ? h`<p class="match-outcome">${sets}</p>` : "");
      const where = (match.gym_label || "Salle non indiquée") + (teamId ? " · " + place : "");
      const homeNote = sets && !result ? "Équipe à la maison d’abord." : "";
      const extra = homeNote || match.score
        ? h`<div class="match-extra">${homeNote ? raw(h`<p class="match-detail">${homeNote}</p>`) : ""}${match.score ? raw(h`<p class="match-detail">Manche par manche : ${match.score}</p>`) : ""}</div>`
        : "";
      return h`<article class="card match${extra ? " has-extra" : ""}">
        <div class="match-when">
          <time datetime="${match.date}"><span class="when-day">${parts.weekday}</span><span class="when-date">${parts.rest}</span></time>
          <span class="when-time">${formatTime(match.time)}</span>
        </div>
        <div class="match-main">
          <h3><a href="#/matchs/${match.id}">${match.home_name} – ${match.away_name}</a></h3>
          <p class="match-where">${where}</p>
        </div>
        ${raw(outcomeBlock)}
        ${raw(extra)}
      </article>`;
    }).join("");
  return h`<div class="matches">${raw(body)}</div>`;
}

function teamCards(list) {
  if (!list.length) {
    return h`<p class="empty">Aucune équipe ne correspond. Essaie un autre club, un autre niveau, ou efface la recherche.</p>`;
  }
  return list.map((team) => {
    const next = team.next_match;
    const nextLine = next
      ? h`<p class="next">Prochain match : ${formatDate(next.date)}, ${formatTime(next.time)}, contre ${next.opponent}${next.gym_label ? raw(h`, ${next.gym_label}`) : ""}.</p>`
      : h`<p class="hint next">Pas de match à venir publié.</p>`;
    const points = team.points != null ? " · " + countPhrase(team.points, "point", "points") : "";
    return h`<article class="card team">
      <p class="meta">${team.featured ? raw(`<span class="badge">Maisons-Alfort</span> `) : ""}${team.label}${team.group ? raw(" · " + esc(groupText(team.group))) : ""}</p>
      <h3><a href="#/equipes/${team.id}">${team.name}</a></h3>
      <p class="team-club">${team.club_name}${team.city ? raw(" · " + esc(team.city)) : ""}</p>
      <p class="team-rank">${rankText(team.rank, team.poule_size)}${raw(points)}</p>
      ${raw(nextLine)}
      <div class="actions">
        <a class="button" href="#/equipes/${team.id}">Voir l’équipe</a>
        ${raw(pinButton(team.id, team.name))}
      </div>
    </article>`;
  }).join("");
}

function markNav() {
  const path = hashParts().path;
  document.querySelectorAll("nav a").forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (!href.startsWith("#/")) {
      link.removeAttribute("aria-current");
      return;
    }
    const target = href.slice(1).split("?")[0];
    if (target === path) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function humanizeWarning(text) {
  const names = meta.poule_names || {};
  const sentence = text.replace("Poules sans match publié", "Groupes sans match publié");
  return sentence.replace(/\b([A-Z0-9]{2,4})\b/g, (code) => {
    const label = names[code];
    return label ? label + " (" + code + ")" : code;
  });
}

function renderFooter() {
  const pied = document.getElementById("pied");
  const when = meta.generated_at
    ? new Date(meta.generated_at).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })
    : "";
  const sources = (meta.sources || []).map((source) =>
    h`<li>${raw(ext(source.url, source.label))}</li>`
  ).join("");
  const warnings = (meta.warnings || []).length
    ? h`<details><summary>Ce qui manque encore</summary><ul>${raw((meta.warnings || []).map((item) => h`<li>${humanizeWarning(item)}</li>`).join(""))}</ul></details>`
    : "";
  pied.innerHTML = h`<p>Saison ${meta.season || ""}. Données du ${when}. ${meta.counts.clubs} clubs, ${meta.counts.teams} équipes, ${meta.counts.matches} matchs.</p>
    <p>Consultation gratuite, sans compte. Une équipe suivie reste sur cet appareil seulement. Pas de notification : le fichier calendrier sert de rappel.</p>
    ${raw(warnings)}
    <p>Sources publiques :</p>
    <ul>${raw(sources)}</ul>`;
}

function homeShell() {
  const clubOptions = clubs.map((club) =>
    h`<option value="${club.id}">${club.name}${club.city ? raw(" — " + esc(club.city)) : ""}</option>`
  ).join("");
  const levelOptions = (meta.levels || []).map((level) =>
    h`<option value="${level.id}">${level.label}</option>`
  ).join("");
  const genderOptions = (meta.genders || []).map((gender) =>
    h`<option value="${gender.id}">${gender.label}</option>`
  ).join("");
  const featured = clubs.find((club) => club.featured);
  const sm2 = calendarTeam ? teamCard(calendarTeam) : null;
  const calendar = sm2 ? h`<section class="featured">
      <div>
        <p class="eyebrow">Calendrier</p>
        <h2>${sm2.name}</h2>
        <p>Seniors masculins 2 · ${sm2.label}. Un seul fichier, avec uniquement les matchs de cette équipe.</p>
      </div>
      <div class="actions">${raw(calendarButton("Ajouter les matchs au calendrier"))}</div>
    </section>` : "";
  const banner = featured ? h`<section class="featured">
      <div>
        <p class="eyebrow">Club mis en avant</p>
        <h2>${featured.name}</h2>
        <p>${featured.short_name}${featured.city ? raw(" · " + esc(featured.city)) : ""}</p>
        <p>Numéro de club ${featured.id}. Dans les classements, il s’écrit « ${featured.ffvb_name} ».</p>
        ${featured.usual_gym ? raw(h`<p>Salle la plus utilisée à domicile : ${featured.usual_gym}.</p>`) : ""}
        <p>${featured.note || ""}</p>
      </div>
      <div class="actions"><a class="button" href="#/clubs/${featured.id}">Voir le club</a></div>
    </section>` : "";
  return h`<h1>Les équipes du Val-de-Marne</h1>
    <p class="lead">Choisis un club ou un niveau pour voir les équipes et les prochains matchs. Gratuit, sans compte.</p>
    <details>
      <summary>Les mots utiles</summary>
      <dl class="gloss">
        <dt>Set</dt>
        <dd>Une manche. « 3 sets à 1 » veut dire 3 manches gagnées et 1 perdue.</dd>
        <dt>Poule</dt>
        <dd>Le groupe d’équipes qui jouent les unes contre les autres.</dd>
        <dt>Départemental</dt>
        <dd>Le championnat du département.</dd>
        <dt>Régional</dt>
        <dd>Le championnat d’Île-de-France.</dd>
        <dt>Pré-national</dt>
        <dd>Juste en dessous du championnat de France.</dd>
        <dt>Accession régionale</dt>
        <dd>Entre le départemental et le régional.</dd>
        <dt>Numéro de club</dt>
        <dd>L’identifiant officiel. Celui de Maisons-Alfort est 0946822.</dd>
      </dl>
    </details>
    ${raw(calendar)}
    ${raw(banner)}
    <section id="suivies" class="panel">
      <h2>Mes équipes</h2>
      <p class="hint">Elles restent enregistrées dans ce navigateur, sur cet appareil. Pour un rappel avant le match, ajoute le calendrier.</p>
      <div id="suivies-liste" class="list"></div>
    </section>
    <form id="filtres" class="filters" role="search" aria-label="Filtrer les équipes">
      <div class="field search-field wide">
        <label for="q">Recherche</label>
        <input id="q" name="q" type="search" autocomplete="off" placeholder="Nom du club, de la ville ou de l’équipe">
      </div>
      <div class="field">
        <label for="club">Club</label>
        <select id="club" name="club"><option value="">Tous les clubs</option>${raw(clubOptions)}</select>
      </div>
      <div class="field">
        <label for="niveau">Niveau</label>
        <select id="niveau" name="niveau" aria-describedby="aide-niveau"><option value="">Tous les niveaux</option>${raw(levelOptions)}</select>
      </div>
      <div class="field">
        <label for="sexe">Féminin, masculin ou mixte</label>
        <select id="sexe" name="sexe"><option value="">Tous</option>${raw(genderOptions)}</select>
      </div>
      <p id="aide-niveau" class="hint wide" aria-live="polite"></p>
      <div class="actions wide">
        <button type="button" class="ghost" id="effacer">Effacer les filtres</button>
      </div>
    </form>
    <section aria-labelledby="titre-resultats">
      <div class="section-head">
        <h2 id="titre-resultats">Équipes trouvées</h2>
        <p id="compte" aria-live="polite"></p>
      </div>
      <div id="resultats" class="list"></div>
    </section>`;
}

function readFilters() {
  const params = hashParts().query;
  return {
    q: document.getElementById("q") ? document.getElementById("q").value : (params.get("q") || ""),
    club: document.getElementById("club") ? document.getElementById("club").value : (params.get("club") || ""),
    niveau: document.getElementById("niveau") ? document.getElementById("niveau").value : (params.get("niveau") || ""),
    sexe: document.getElementById("sexe") ? document.getElementById("sexe").value : (params.get("sexe") || "")
  };
}

function applyFiltersToForm() {
  const params = hashParts().query;
  ["q", "club", "niveau", "sexe"].forEach((key) => {
    const field = document.getElementById(key);
    if (field && params.has(key)) field.value = params.get(key);
  });
}

function helpForLevel() {
  const help = document.getElementById("aide-niveau");
  const selected = document.getElementById("niveau").value;
  const level = (meta.levels || []).find((item) => item.id === selected);
  help.textContent = level && level.help
    ? level.help
    : "Le niveau décrit la compétition. Ce n’est pas une note donnée au club.";
}

async function refreshPins() {
  const box = document.getElementById("suivies-liste");
  if (!box) return;
  const ids = pins();
  if (!ids.length) {
    box.innerHTML = h`<p class="empty">Aucune équipe suivie pour l’instant. Ouvre une équipe et choisis « Suivre cette équipe ».</p>`;
    return;
  }
  const data = await api("/api/equipes?ids=" + ids.map(encodeURIComponent).join(","));
  let html = teamCards(data.teams);
  if (data.missing && data.missing.length) {
    html += h`<p class="hint">Certaines équipes suivies ne sont plus dans les données. <button type="button" class="ghost" id="oublier">Retirer les équipes introuvables</button></p>`;
  }
  box.innerHTML = html;
  const forget = document.getElementById("oublier");
  if (forget) {
    forget.addEventListener("click", () => {
      const known = new Set(data.teams.map((team) => team.id));
      setPins(pins().filter((id) => known.has(id)));
      refreshPins();
    });
  }
}

function countText(total) {
  if (total === 0) return "Aucune équipe";
  if (total === 1) return "1 équipe";
  return total + " équipes";
}

let listToken = 0;

async function refreshList() {
  const token = ++listToken;
  const filters = readFilters();
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  if (hashParts().path !== "/suivies") {
    const query = params.toString();
    const next = "#/" + (query ? "?" + query : "");
    if (location.hash !== next) history.replaceState(null, "", next);
  }
  helpForLevel();
  const data = await api("/api/equipes?" + params.toString());
  if (token !== listToken || !document.getElementById("compte")) return;
  document.getElementById("compte").textContent = countText(data.total);
  document.getElementById("resultats").innerHTML = teamCards(data.teams);
}

async function renderHome() {
  if (!document.getElementById("filtres")) {
    main.innerHTML = homeShell();
    applyFiltersToForm();
    const form = document.getElementById("filtres");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      refreshList().catch(showError);
    });
    form.addEventListener("input", () => { refreshList().catch(showError); });
    form.addEventListener("change", () => { refreshList().catch(showError); });
    document.getElementById("effacer").addEventListener("click", () => {
      form.reset();
      refreshList().catch(showError);
    });
  }
  await refreshPins();
  await refreshList();
}

function renderClubs() {
  main.innerHTML = h`<h1>Clubs du Val-de-Marne</h1>
    <p class="lead">${clubs.length} clubs. Choisis-en un pour voir ses équipes.</p>
    <form id="filtre-clubs" class="filters" role="search" aria-label="Rechercher un club">
      <div class="field search-field wide">
        <label for="q-club">Recherche un club</label>
        <input id="q-club" type="search" autocomplete="off" placeholder="Nom ou ville">
      </div>
    </form>
    <p id="club-compte" aria-live="polite"></p>
    <div id="club-list" class="list"></div>`;
  const paint = () => {
    const query = document.getElementById("q-club").value;
    const folded = query.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const found = clubs.filter((club) => {
      const blob = [club.name, club.short_name, club.ffvb_name, club.city, club.note].join(" ");
      const text = blob.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
      return !folded || folded.split(/\s+/).every((token) => text.includes(token) || text.split(/[^a-z0-9]+/).some((word) => word.startsWith(token)));
    });
    const compte = document.getElementById("club-compte");
    compte.textContent = found.length === 0 ? "Aucun club" : (found.length === 1 ? "1 club" : found.length + " clubs");
    document.getElementById("club-list").innerHTML = found.map((club) => h`<article class="card${club.featured ? " is-featured" : ""}">
      <p class="meta">numéro ${club.id}</p>
      <h3><a href="#/clubs/${club.id}">${club.name}</a></h3>
      <p class="team-club">${club.city || "Ville non indiquée"}</p>
      <p class="hint">${countPhrase(club.team_count, "équipe engagée", "équipes engagées")}.</p>
    </article>`).join("") || h`<p class="empty">Aucun club ne correspond à cette recherche.</p>`;
  };
  const form = document.getElementById("filtre-clubs");
  form.addEventListener("submit", (event) => event.preventDefault());
  document.getElementById("q-club").addEventListener("input", paint);
  paint();
}

function fact(label, value) {
  if (!value) return "";
  return h`<div><dt>${label}</dt><dd>${value}</dd></div>`;
}

async function renderClub(id) {
  const data = await api("/api/clubs/" + id);
  const club = data.club;
  const site = club.website
    ? h`<p>Site du club : ${raw(ext(club.website, club.website))}</p>`
    : h`<p>Pas de site internet indiqué pour ce club.</p>`;
  const city = club.city || "Ville non indiquée";
  main.innerHTML = h`<nav class="crumbs" aria-label="Fil d’Ariane"><a href="#/clubs">Clubs</a></nav>
    <h1>${club.name}</h1>
    <p class="lead">${club.short_name && club.short_name !== club.name ? raw(esc(club.short_name) + " · ") : ""}${city}</p>
    <dl class="facts">
      ${raw(fact("Numéro de club", club.id))}
      ${raw(fact("Nom dans les classements", club.ffvb_name))}
      ${raw(fact("Salle la plus utilisée à domicile", club.usual_gym))}
    </dl>
    ${club.note ? raw(h`<p>${club.note}</p>`) : ""}
    ${raw(site)}
    <p>${raw(ext(club.planning_url, "Voir les matchs de la semaine"))}</p>
    <h2>Équipes</h2>
    <div class="list">${raw(teamCards(data.teams))}</div>
    <h2>Prochains matchs</h2>
    ${raw(matchRows(data.upcoming, null, "Aucun match à venir n’est publié pour l’instant."))}
    <h2>Derniers résultats</h2>
    ${raw(matchRows(data.recent, null, "Aucun résultat n’est publié pour l’instant."))}`;
  document.title = club.name + " — Volley 94";
}

function rankingTable(rankings) {
  const columns = [
    ["rank", "Place"], ["name", "Équipe"], ["points", "Points"],
    ["played", "Matchs joués"], ["won", "Victoires"], ["lost", "Défaites"], ["forfeit", "Forfaits"],
    ["w3_0", "Gagnés 3-0"], ["w3_1", "Gagnés 3-1"], ["w3_2", "Gagnés 3-2"],
    ["l2_3", "Perdus 2-3"], ["l1_3", "Perdus 1-3"], ["l0_3", "Perdus 0-3"],
    ["sets_for", "Sets gagnés"], ["sets_against", "Sets perdus"], ["sets_ratio", "Rapport de sets"],
    ["points_for", "Points marqués"], ["points_against", "Points encaissés"], ["points_ratio", "Rapport de points"]
  ];
  const head = columns.map((col) => h`<th scope="col">${col[1]}</th>`).join("");
  const body = rankings.map((row) => {
    const cells = columns.map((col, index) => {
      let value = row[col[0]];
      if (value === "MAX") value = "max";
      if (index === 1) return h`<th scope="row">${raw(teamLink(row))}</th>`;
      return h`<td>${value}</td>`;
    }).join("");
    return h`<tr>${raw(cells)}</tr>`;
  }).join("");
  return h`<div class="table-scroll" tabindex="0" aria-label="Classement complet, défilement horizontal">
    <table>
      <caption>« Gagnés 3-0 » : matchs gagnés en trois manches à zéro. « max » : aucun set perdu.</caption>
      <thead><tr>${raw(head)}</tr></thead>
      <tbody>${raw(body)}</tbody>
    </table>
  </div>`;
}

function standingList(rankings) {
  const items = rankings.map((row) => {
    let stats = "";
    if (row.points != null) {
      stats = countPhrase(row.points, "point", "points");
      if (row.won != null) stats += ", " + countPhrase(row.won, "victoire", "victoires");
      if (row.lost != null) stats += ", " + countPhrase(row.lost, "défaite", "défaites");
      if (row.forfeit) stats += ", " + countPhrase(row.forfeit, "forfait", "forfaits");
    }
    return h`<li>
      <p class="place">${rankText(row.rank, rankings.length)}</p>
      <div>
        <p class="standing-name">${raw(teamLink(row))}</p>
        ${stats ? raw(h`<p class="hint">${stats}</p>`) : ""}
      </div>
    </li>`;
  }).join("");
  return h`<ol class="standing">${raw(items)}</ol>`;
}

function rosterList(rankings) {
  const items = rankings.map((row) => h`<li>${raw(teamLink(row))}</li>`).join("");
  return h`<ul>${raw(items)}</ul>`;
}

async function renderTeam(id) {
  const data = await api("/api/equipes/" + id);
  const team = data.team;
  const hasStanding = data.rankings.some((row) => row.points != null);
  const mixed = data.rankings.some((row) => !row.in_department);
  const isSm2 = calendarTeam && team.id === calendarTeam.id;
  const calendar = isSm2 ? calendarButton("Ajouter les matchs au calendrier") : "";
  const board = hasStanding
    ? h`<h2>Classement</h2>${raw(standingList(data.rankings))}
      <details><summary>Tous les chiffres</summary>
        <p class="hint">Le tableau est large. Sur un téléphone, fais-le glisser sur le côté.</p>
        ${raw(rankingTable(data.rankings))}
      </details>`
    : (data.rankings.length
      ? h`<h2>Équipes de ce groupe</h2><p class="hint">La place et les points ne sont pas encore publiés.</p>${raw(rosterList(data.rankings))}`
      : h`<p class="empty">Le classement n’est pas encore publié.</p>`);
  const mixedText = mixed
    ? "Ce groupe mélange des clubs du Val-de-Marne et d’autres départements."
    : "";
  const group = data.poule.group ? " · " + groupText(data.poule.group) : "";
  let rankLine = rankText(team.rank, team.poule_size);
  if (team.points != null) rankLine += " · " + countPhrase(team.points, "point", "points");
  if (team.won != null && team.played != null) {
    rankLine += ". " + countPhrase(team.won, "victoire", "victoires") + " en " + countPhrase(team.played, "match", "matchs");
  }
  main.innerHTML = h`<nav class="crumbs" aria-label="Fil d’Ariane"><a href="#/">Équipes</a> <span aria-hidden="true">/</span> <a href="#/clubs/${team.club_id}">${team.club_name}</a></nav>
    <h1>${team.name}</h1>
    <p class="lead">${team.label}${raw(group)}</p>
    <dl class="facts">
      ${raw(fact("Classement", rankLine))}
      ${raw(fact("Nom dans le calendrier officiel", team.ffvb_name))}
      ${raw(fact("Salle habituelle à domicile", team.usual_gym))}
      ${raw(fact("Code du groupe", data.poule.code))}
    </dl>
    <p class="hint">Une poule est le groupe d’équipes qui se rencontrent. Le code sert à retrouver ce groupe sur le site des résultats.</p>
    <div class="actions">${raw(pinButton(team.id, team.name))}${raw(calendar)}</div>
    ${isSm2 ? raw(h`<p class="hint">Le fichier s’ouvre dans Calendrier (iPhone, Mac), Outlook, ou s’importe dans Google Agenda. Il ne contient que les matchs de ${team.name}. Ce n’est pas une alarme automatique.</p>`) : ""}
    ${mixedText ? raw(h`<p class="hint">${mixedText}</p>`) : ""}
    ${raw(board)}
    <h2>Prochains matchs</h2>
    ${raw(matchRows(data.upcoming, team.id, "Aucun match à venir n’est publié pour l’instant."))}
    <h2>Résultats</h2>
    ${raw(matchRows(data.played, team.id, "Aucun résultat n’est publié pour l’instant."))}
    <p>${raw(ext(data.poule.url, "Calendrier officiel de ce groupe"))}
      · ${raw(ext(data.club.planning_url, "Matchs de la semaine du club"))}</p>`;
  document.title = team.name + " — Volley 94";
}

async function renderMatch(id) {
  const data = await api("/api/matchs/" + id);
  const match = data.match;
  const sets = match.sets_home != null ? setsPhrase(match.sets_home, match.sets_away) : "Match à venir";
  const refs = [match.referee_1, match.referee_2].filter(Boolean);
  main.innerHTML = h`<nav class="crumbs" aria-label="Fil d’Ariane"><a href="#/">Équipes</a></nav>
    <h1>${match.home_name} – ${match.away_name}</h1>
    <p class="lead">${match.poule_label || ""}</p>
    <p class="match-kick"><time datetime="${match.date}">${formatDate(match.date)}</time> · ${formatTime(match.time)}</p>
    <p class="scoreline ${match.status === "joue" ? "score" : ""}">${sets}</p>
    <p class="hint">La première équipe joue à la maison.</p>
    ${match.score ? raw(h`<p>Manche par manche : ${match.score}</p><p class="hint">Chaque paire de nombres est le score d’une manche (un set).</p>`) : ""}
    ${match.total ? raw(h`<p>Points marqués au total : ${match.total}.</p>`) : ""}
    <p>Salle : ${match.gym_label || "non indiquée"}.</p>
    <p>${refs.length ? raw("Arbitre : " + esc(refs.join(" et ")) + ".") : "Arbitre pas encore désigné."}</p>
    <p class="hint">Référence du match : ${match.code}. Elle sert à le retrouver sur le site officiel. La composition des équipes n’est pas affichée ici.</p>
    <div class="actions">
      ${calendarTeam && (match.home_team_id === calendarTeam.id || match.away_team_id === calendarTeam.id) ? raw(calendarButton("Ajouter les matchs d’" + calendarTeam.name + " au calendrier")) : ""}
      ${match.home_team_id ? raw(h`<a class="button ghost" href="#/equipes/${match.home_team_id}">Équipe à la maison</a>`) : ""}
      ${match.away_team_id ? raw(h`<a class="button ghost" href="#/equipes/${match.away_team_id}">Équipe en déplacement</a>`) : ""}
    </div>
    ${match.poule_url ? raw(h`<p>${raw(ext(match.poule_url, "Page officielle de ce groupe"))}</p>`) : ""}`;
  document.title = match.home_name + " – " + match.away_name + " — Volley 94";
}

function showError(error) {
  main.innerHTML = h`<p role="alert">Impossible d’afficher la page. ${error.message || ""}</p>
    <p><a href="#/">Retour aux équipes</a></p>`;
}

let started = false;

async function route() {
  markNav();
  document.title = "Volley 94 — équipes et matchs";
  const path = hashParts().path;
  try {
    if (path === "/" || path === "/suivies") await renderHome();
    else if (path === "/clubs") renderClubs();
    else if (/^\/clubs\/\d+$/.test(path)) await renderClub(path.split("/")[2]);
    else if (/^\/equipes\/[A-Za-z0-9_-]+$/.test(path)) await renderTeam(path.split("/")[2]);
    else if (/^\/matchs\/[A-Za-z0-9_-]+$/.test(path)) await renderMatch(path.split("/")[2]);
    else main.innerHTML = h`<h1>Page introuvable</h1><p>Cette adresse ne correspond à aucune page.</p><p><a href="#/">Retour aux équipes</a></p>`;
  } catch (error) {
    showError(error);
  }
  if (path === "/suivies") {
    const box = document.getElementById("suivies");
    if (box) box.scrollIntoView();
  }
  if (returnFocus) {
    const wanted = returnFocus;
    returnFocus = null;
    focusPinned(wanted.where, wanted.id);
  } else if (started && path !== "/suivies") {
    main.focus();
  }
  started = true;
}

document.body.addEventListener("click", (event) => {
  const pin = event.target.closest("[data-pin]");
  if (pin) {
    event.preventDefault();
    togglePin(pin.dataset.pin, pin.closest("#suivies") ? "suivies" : "page");
  }
});

window.addEventListener("hashchange", () => { route(); });

boot().catch((error) => {
  main.innerHTML = h`<p role="alert">Les données n’ont pas pu être chargées. ${error.message || ""}</p>`;
});

async function boot() {
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error("Fichier de données introuvable.");
  const blob = await response.json();
  db = {
    season: blob.season,
    generated_at: blob.generated_at,
    featured_club_id: blob.featured_club_id,
    departments: blob.department ? [blob.department] : [],
    sources: blob.sources || [],
    limits: blob.limits || [],
    warnings: blob.warnings || [],
    level_help: blob.level_help || {},
    clubs: indexById(blob.clubs),
    poules: indexById(blob.poules),
    teams: indexById(blob.teams),
    matches: indexById(blob.matches)
  };
  calendarTeam = Object.values(db.teams).find((team) =>
    team.club_id === SM2_CLUB && team.ffvb_name === SM2_FFVB
  ) || null;
  const cal = document.getElementById("lien-calendrier");
  if (cal && calendarTeam) cal.textContent = "Calendrier " + calendarTeam.name;
  meta = metaView();
  clubs = listClubs().clubs;
  renderFooter();
  await route();
}
