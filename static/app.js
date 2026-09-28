/* Pages : /, /clubs, /clubs/:id, /equipes/:id, /matchs/:id
   Les filtres et les fiches viennent de l’API Python. */

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

async function api(path) {
  const response = await fetch(path);
  const type = response.headers.get("content-type") || "";
  const body = type.includes("json") ? await response.json() : await response.text();
  if (!response.ok) {
    const message = body && body.error ? body.error : "Réponse " + response.status;
    throw new Error(message);
  }
  return body;
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
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long"
  });
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
  if (mine > other) return "Gagné, " + mine + " sets à " + other;
  if (mine < other) return "Perdu, " + mine + " sets à " + other;
  return "Égalité, " + mine + " sets à " + other;
}

function pinButton(id, name) {
  const on = pins().includes(id);
  const visible = on ? "Ne plus suivre" : "Suivre cette équipe";
  return h`<button type="button" data-pin="${id}" aria-pressed="${on ? "true" : "false"}" aria-label="${visible} : ${name}">${visible}</button>`;
}

function teamLink(row) {
  if (row.team_id) return h`<a href="/equipes/${row.team_id}">${row.name}</a>`;
  return esc(row.name) + (row.in_department ? "" : " (autre département)");
}

function matchRows(matches, teamId, emptyText) {
  if (!matches.length) {
    return h`<p class="empty">${emptyText || "Aucun match publié pour l’instant."}</p>`;
  }
  return matches.map((match) => {
    const result = teamId ? outcome(match, teamId) : "";
    const cls = result.startsWith("Gagné") ? "score" : (result.startsWith("Perdu") ? "lost" : "");
    const place = match.home_team_id === teamId ? "à la maison" : "chez l’adversaire";
    const sets = match.sets_home != null
      ? match.sets_home + " sets à " + match.sets_away + " (équipe à la maison d’abord)"
      : "";
    return h`<article class="card">
      <p class="meta"><time datetime="${match.date}">${formatDate(match.date)}</time> · ${formatTime(match.time)}</p>
      <h3><a href="/matchs/${match.id}">${match.home_name} – ${match.away_name}</a></h3>
      <p>${match.gym_label || "Salle non indiquée"}${teamId ? raw(" · " + place) : ""}</p>
      ${result ? raw(h`<p class="${cls}">${result}</p>`) : (sets ? raw(h`<p>${sets}</p>`) : "")}
      ${match.score ? raw(h`<p>Manche par manche : ${match.score}</p>`) : ""}
    </article>`;
  }).join("");
}

function teamCards(list) {
  if (!list.length) {
    return h`<p class="empty">Aucune équipe ne correspond. Essaie un autre club, un autre niveau, ou efface la recherche.</p>`;
  }
  return list.map((team) => {
    const next = team.next_match;
    const nextLine = next
      ? h`<p>Prochain match : ${formatDate(next.date)}, ${formatTime(next.time)}, contre ${next.opponent}${next.gym_label ? raw(h`, ${next.gym_label}`) : ""}.</p>`
      : h`<p class="hint">Pas de match à venir publié.</p>`;
    const points = team.points != null ? " · " + countPhrase(team.points, "point", "points") : "";
    return h`<article class="card">
      <p class="meta">${team.featured ? raw(`<span class="badge">Maisons-Alfort</span> `) : ""}${team.label}${team.group ? raw(" · " + esc(groupText(team.group))) : ""}</p>
      <h3><a href="/equipes/${team.id}">${team.name}</a></h3>
      <p>${team.club_name}${team.city ? raw(" · " + esc(team.city)) : ""}</p>
      <p>${rankText(team.rank, team.poule_size)}${raw(points)}</p>
      ${raw(nextLine)}
      <div class="actions">
        <a class="button" href="/equipes/${team.id}">Voir l’équipe</a>
        ${raw(pinButton(team.id, team.name))}
      </div>
    </article>`;
  }).join("");
}

function markNav() {
  document.querySelectorAll("nav a").forEach((link) => {
    const current = link.pathname === location.pathname && !link.hash;
    if (current) link.setAttribute("aria-current", "page");
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
  const banner = featured ? h`<section class="featured">
      <p class="eyebrow">Club mis en avant</p>
      <h2>${featured.name}</h2>
      <p>${featured.short_name}${featured.city ? raw(" · " + esc(featured.city)) : ""}</p>
      <p>Numéro de club ${featured.id}. Dans les classements, il s’écrit « ${featured.ffvb_name} ».</p>
      ${featured.usual_gym ? raw(h`<p>Salle la plus utilisée à domicile : ${featured.usual_gym}.</p>`) : ""}
      <p>${featured.note || ""}</p>
      <div class="actions"><a class="button" href="/clubs/${featured.id}">Voir le club</a></div>
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
    ${raw(banner)}
    <section id="suivies" class="panel">
      <h2>Mes équipes</h2>
      <p class="hint">Elles restent enregistrées dans ce navigateur, sur cet appareil. Pour un rappel avant le match, ajoute le calendrier.</p>
      <div id="suivies-liste"></div>
    </section>
    <form id="filtres" class="filters" role="search" aria-label="Filtrer les équipes">
      <div class="wide">
        <label for="q">Recherche</label>
        <input id="q" name="q" type="search" autocomplete="off" placeholder="Nom du club, de la ville ou de l’équipe">
      </div>
      <div>
        <label for="club">Club</label>
        <select id="club" name="club"><option value="">Tous les clubs</option>${raw(clubOptions)}</select>
      </div>
      <div>
        <label for="niveau">Niveau</label>
        <select id="niveau" name="niveau" aria-describedby="aide-niveau"><option value="">Tous les niveaux</option>${raw(levelOptions)}</select>
      </div>
      <div>
        <label for="sexe">Féminin, masculin ou mixte</label>
        <select id="sexe" name="sexe"><option value="">Tous</option>${raw(genderOptions)}</select>
      </div>
      <p id="aide-niveau" class="hint wide" aria-live="polite"></p>
      <div class="actions wide">
        <button type="button" class="ghost" id="effacer">Effacer les filtres</button>
      </div>
    </form>
    <section aria-labelledby="titre-resultats">
      <h2 id="titre-resultats">Équipes trouvées</h2>
      <p id="compte" aria-live="polite"></p>
      <div id="resultats" class="list"></div>
    </section>`;
}

function readFilters() {
  const params = new URLSearchParams(location.search);
  return {
    q: document.getElementById("q") ? document.getElementById("q").value : (params.get("q") || ""),
    club: document.getElementById("club") ? document.getElementById("club").value : (params.get("club") || ""),
    niveau: document.getElementById("niveau") ? document.getElementById("niveau").value : (params.get("niveau") || ""),
    sexe: document.getElementById("sexe") ? document.getElementById("sexe").value : (params.get("sexe") || "")
  };
}

function applyFiltersToForm() {
  const params = new URLSearchParams(location.search);
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
  history.replaceState(null, "", "/" + (params.toString() ? "?" + params.toString() : "") + location.hash);
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
  if (location.hash === "#suivies") document.getElementById("suivies").scrollIntoView();
}

function renderClubs() {
  main.innerHTML = h`<h1>Clubs du Val-de-Marne</h1>
    <p class="lead">${clubs.length} clubs. Choisis-en un pour voir ses équipes.</p>
    <form id="filtre-clubs" class="filters" role="search" aria-label="Rechercher un club">
      <div class="wide">
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
    document.getElementById("club-list").innerHTML = found.map((club) => h`<article class="card">
      <h3><a href="/clubs/${club.id}">${club.name}</a></h3>
      <p>${club.city || "Ville non indiquée"} · numéro ${club.id}</p>
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
  main.innerHTML = h`<nav class="crumbs" aria-label="Fil d’Ariane"><a href="/clubs">Clubs</a></nav>
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
      <p>${raw(teamLink(row))}</p>
      ${stats ? raw(h`<p class="hint">${stats}</p>`) : ""}
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
  const calendar = data.upcoming_count
    ? h`<a class="button" href="/calendrier/equipe/${team.id}.ics">Ajouter les prochains matchs au calendrier</a>`
    : h`<p class="hint">Pas de match à venir à mettre dans le calendrier.</p>`;
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
  main.innerHTML = h`<nav class="crumbs" aria-label="Fil d’Ariane"><a href="/">Équipes</a> <span aria-hidden="true">/</span> <a href="/clubs/${team.club_id}">${team.club_name}</a></nav>
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
    <p class="hint">Le fichier s’ouvre dans Calendrier (iPhone, Mac), Outlook, ou s’importe dans Google Agenda. Ce n’est pas une alarme automatique.</p>
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
  const sets = match.sets_home != null ? match.sets_home + " sets à " + match.sets_away : "Match à venir";
  const refs = [match.referee_1, match.referee_2].filter(Boolean);
  main.innerHTML = h`<nav class="crumbs" aria-label="Fil d’Ariane"><a href="/">Équipes</a></nav>
    <h1>${match.home_name} – ${match.away_name}</h1>
    <p class="lead">${match.poule_label || ""}</p>
    <p><time datetime="${match.date}">${formatDate(match.date)}</time> · ${formatTime(match.time)}</p>
    <p class="${match.status === "joue" ? "score" : ""}">${sets}</p>
    <p class="hint">La première équipe joue à la maison.</p>
    ${match.score ? raw(h`<p>Manche par manche : ${match.score}</p><p class="hint">Chaque paire de nombres est le score d’une manche (un set).</p>`) : ""}
    ${match.total ? raw(h`<p>Points marqués au total : ${match.total}.</p>`) : ""}
    <p>Salle : ${match.gym_label || "non indiquée"}.</p>
    <p>${refs.length ? raw("Arbitre : " + esc(refs.join(" et ")) + ".") : "Arbitre pas encore désigné."}</p>
    <p class="hint">Référence du match : ${match.code}. Elle sert à le retrouver sur le site officiel. La composition des équipes n’est pas affichée ici.</p>
    <div class="actions">
      <a class="button" href="/calendrier/match/${match.id}.ics">Ajouter ce match au calendrier</a>
      ${match.home_team_id ? raw(h`<a class="button ghost" href="/equipes/${match.home_team_id}">Équipe à la maison</a>`) : ""}
      ${match.away_team_id ? raw(h`<a class="button ghost" href="/equipes/${match.away_team_id}">Équipe en déplacement</a>`) : ""}
    </div>
    ${match.poule_url ? raw(h`<p>${raw(ext(match.poule_url, "Page officielle de ce groupe"))}</p>`) : ""}`;
  document.title = match.home_name + " – " + match.away_name + " — Volley 94";
}

function showError(error) {
  main.innerHTML = h`<p role="alert">Impossible d’afficher la page. ${error.message || ""}</p>
    <p><a href="/">Retour aux équipes</a></p>`;
}

let started = false;

async function route() {
  markNav();
  document.title = "Volley 94 — équipes et matchs";
  const path = location.pathname;
  try {
    if (path === "/" || path === "") await renderHome();
    else if (path === "/clubs") renderClubs();
    else if (/^\/clubs\/\d+$/.test(path)) await renderClub(path.split("/")[2]);
    else if (/^\/equipes\/[A-Za-z0-9_-]+$/.test(path)) await renderTeam(path.split("/")[2]);
    else if (/^\/matchs\/[A-Za-z0-9_-]+$/.test(path)) await renderMatch(path.split("/")[2]);
    else main.innerHTML = h`<h1>Page introuvable</h1><p>Cette adresse ne correspond à aucune page.</p><p><a href="/">Retour aux équipes</a></p>`;
  } catch (error) {
    showError(error);
  }
  if (returnFocus) {
    const wanted = returnFocus;
    returnFocus = null;
    focusPinned(wanted.where, wanted.id);
  } else if (started && location.hash !== "#suivies") {
    main.focus();
  }
  started = true;
}

document.body.addEventListener("click", (event) => {
  const pin = event.target.closest("[data-pin]");
  if (pin) {
    event.preventDefault();
    togglePin(pin.dataset.pin, pin.closest("#suivies") ? "suivies" : "page");
    return;
  }
  const link = event.target.closest("a");
  if (!link || link.target === "_blank") return;
  const url = new URL(link.href, location.origin);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/calendrier") || url.pathname.startsWith("/static") || url.pathname.startsWith("/api")) return;
  if (url.pathname === location.pathname && url.hash) return;
  event.preventDefault();
  history.pushState(null, "", url.pathname + url.search + url.hash);
  route();
});

window.addEventListener("popstate", () => { route(); });

boot().catch((error) => {
  main.innerHTML = h`<p role="alert">Les données n’ont pas pu être chargées. ${error.message || ""}</p>
    <p>Depuis le dossier de l’application : <code>python3 refresh_data.py</code> puis <code>python3 app.py</code>.</p>`;
});

async function boot() {
  meta = await api("/api/meta");
  clubs = (await api("/api/clubs")).clubs;
  renderFooter();
  await route();
}
