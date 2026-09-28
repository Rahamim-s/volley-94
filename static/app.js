/* Pages : /, /clubs, /clubs/:id, /equipes/:id, /matchs/:id
   Les filtres et les fiches viennent de l’API Python. */

const main = document.getElementById("contenu");
const PIN_KEY = "volley94.equipes";
let meta = null;
let clubs = [];

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

function togglePin(id) {
  const current = pins();
  setPins(current.includes(id) ? current.filter((item) => item !== id) : current.concat(id));
  route();
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
  return group === "haute" ? "Poule haute" : "Groupe " + group;
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
  if (mine > other) return "Gagné " + mine + "-" + other;
  if (mine < other) return "Perdu " + mine + "-" + other;
  return "Égalité " + mine + "-" + other;
}

function pinButton(id) {
  const on = pins().includes(id);
  return h`<button type="button" data-pin="${id}" aria-pressed="${on ? "true" : "false"}">${on ? "Ne plus suivre" : "Suivre cette équipe"}</button>`;
}

function matchRows(matches, teamId) {
  if (!matches.length) return h`<p class="hint">Aucun match dans cette liste.</p>`;
  return raw(matches.map((match) => {
    const result = teamId ? outcome(match, teamId) : "";
    const cls = result.startsWith("Gagné") ? "score" : (result.startsWith("Perdu") ? "lost" : "");
    const place = match.home_team_id === teamId ? "à domicile" : "à l’extérieur";
    return h`<article class="card">
      <p class="meta">${formatDate(match.date)} · ${formatTime(match.time)}</p>
      <h3><a href="/matchs/${match.id}">${match.home_name} – ${match.away_name}</a></h3>
      <p>${match.gym_label || "Salle non indiquée"}${teamId ? raw(" · " + place) : ""}</p>
      ${result ? raw(h`<p class="${cls}">${result}</p>`) : ""}
      ${match.score ? raw(h`<p>Manches : ${match.score}</p>`) : ""}
    </article>`;
  }).join(""));
}

function teamCards(list) {
  if (!list.length) {
    return h`<p>Aucune équipe ne correspond. Essaie un autre club, un autre niveau, ou efface la recherche.</p>`;
  }
  return raw(list.map((team) => {
    const next = team.next_match;
    const nextLine = next
      ? h`<p>Prochain match : ${formatDate(next.date)}, ${formatTime(next.time)}, contre ${next.opponent}${next.gym_label ? raw(h`, ${next.gym_label}`) : ""}.</p>`
      : h`<p class="hint">Pas de match à venir publié.</p>`;
    return h`<article class="card">
      <p class="meta">${team.featured ? raw(`<span class="badge">Maisons-Alfort</span> `) : ""}${team.label}${team.group ? raw(" · " + esc(groupText(team.group))) : ""}</p>
      <h3><a href="/equipes/${team.id}">${team.name}</a></h3>
      <p>${team.club_name}${team.city ? raw(" · " + esc(team.city)) : ""}</p>
      <p>${rankText(team.rank, team.poule_size)}${team.points != null ? raw(" · " + esc(team.points) + " pts") : ""}</p>
      ${raw(nextLine)}
      <div class="actions">
        <a class="button" href="/equipes/${team.id}">Voir l’équipe</a>
        ${raw(pinButton(team.id))}
      </div>
    </article>`;
  }).join(""));
}

function markNav() {
  document.querySelectorAll("nav a").forEach((link) => {
    const current = link.pathname === location.pathname && !link.hash;
    if (current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function renderFooter() {
  const pied = document.getElementById("pied");
  const when = meta.generated_at
    ? new Date(meta.generated_at).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })
    : "";
  const sources = (meta.sources || []).map((source) =>
    h`<li><a href="${source.url}" target="_blank" rel="noopener noreferrer">${source.label}</a></li>`
  ).join("");
  const warnings = (meta.warnings || []).length
    ? h`<details><summary>Réserves sur les données</summary><ul>${raw((meta.warnings || []).map((item) => h`<li>${item}</li>`).join(""))}</ul></details>`
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
      <p>${featured.short_name} · n° ${featured.id}${featured.city ? raw(" · " + esc(featured.city)) : ""}</p>
      <p>Nom dans les compétitions : ${featured.ffvb_name}.</p>
      ${featured.usual_gym ? raw(h`<p>Salle la plus utilisée à domicile : ${featured.usual_gym}.</p>`) : ""}
      <p>${featured.note || ""}</p>
      <div class="actions"><a class="button" href="/clubs/${featured.id}">Voir le club</a></div>
    </section>` : "";
  return h`<h1>Les équipes du Val-de-Marne</h1>
    <p class="lead">Retrouve un club, un niveau et les prochains matchs. Gratuit, sans créer de compte.</p>
    ${raw(banner)}
    <section id="suivies" class="panel">
      <h2>Mes équipes</h2>
      <p class="hint">Elles restent enregistrées dans ce navigateur, sur cet appareil. Pour un rappel avant le match, ajoute le calendrier.</p>
      <div id="suivies-liste"></div>
    </section>
    <form id="filtres" class="filters" role="search">
      <div class="wide">
        <label for="q">Recherche</label>
        <input id="q" name="q" type="search" autocomplete="off" placeholder="Club, ville, équipe…">
      </div>
      <div>
        <label for="club">Club</label>
        <select id="club" name="club"><option value="">Tous les clubs</option>${raw(clubOptions)}</select>
      </div>
      <div>
        <label for="niveau">Niveau</label>
        <select id="niveau" name="niveau"><option value="">Tous les niveaux</option>${raw(levelOptions)}</select>
      </div>
      <div>
        <label for="sexe">Féminin, masculin ou mixte</label>
        <select id="sexe" name="sexe"><option value="">Tous</option>${raw(genderOptions)}</select>
      </div>
      <p id="aide-niveau" class="hint wide"></p>
      <div class="actions wide">
        <button type="button" class="ghost" id="reset">Effacer les filtres</button>
      </div>
    </form>
    <p id="compte" aria-live="polite"></p>
    <div id="resultats" class="list"></div>`;
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
  help.textContent = level && level.help ? level.help : "Le niveau est celui de la compétition, pas un jugement sur le club.";
}

async function refreshPins() {
  const box = document.getElementById("suivies-liste");
  if (!box) return;
  const ids = pins();
  if (!ids.length) {
    box.innerHTML = h`<p>Aucune équipe suivie pour l’instant. Ouvre une équipe et choisis « Suivre cette équipe ».</p>`;
    return;
  }
  const data = await api("/api/equipes?ids=" + ids.map(encodeURIComponent).join(","));
  let html = teamCards(data.teams);
  if (data.missing && data.missing.length) {
    html += h`<p class="hint">Certaines équipes suivies ne sont plus dans les données. <button type="button" id="oublier">Les retirer</button></p>`;
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

async function refreshList() {
  const filters = readFilters();
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  history.replaceState(null, "", "/" + (params.toString() ? "?" + params.toString() : "") + location.hash);
  helpForLevel();
  const data = await api("/api/equipes?" + params.toString());
  document.getElementById("compte").textContent = data.total + (data.total > 1 ? " équipes" : " équipe");
  document.getElementById("resultats").innerHTML = teamCards(data.teams);
}

async function renderHome() {
  if (!document.getElementById("filtres")) {
    main.innerHTML = homeShell();
    applyFiltersToForm();
    document.getElementById("filtres").addEventListener("input", () => { refreshList().catch(showError); });
    document.getElementById("filtres").addEventListener("change", () => { refreshList().catch(showError); });
    document.getElementById("reset").addEventListener("click", () => {
      document.getElementById("filtres").reset();
      refreshList().catch(showError);
    });
  }
  await refreshPins();
  await refreshList();
  if (location.hash === "#suivies") document.getElementById("suivies").scrollIntoView();
}

function renderClubs() {
  main.innerHTML = h`<h1>Clubs du Val-de-Marne</h1>
    <p class="lead">${clubs.length} clubs inscrits au comité. Choisis-en un pour voir ses équipes.</p>
    <form class="filters" role="search">
      <div class="wide">
        <label for="q-club">Recherche un club</label>
        <input id="q-club" type="search" autocomplete="off" placeholder="Nom ou ville">
      </div>
    </form>
    <div id="club-list" class="list"></div>`;
  const paint = () => {
    const query = document.getElementById("q-club").value;
    const folded = query.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const found = clubs.filter((club) => {
      const blob = [club.name, club.short_name, club.ffvb_name, club.city, club.note].join(" ");
      const text = blob.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
      return !folded || folded.split(/\s+/).every((token) => text.includes(token) || text.split(/[^a-z0-9]+/).some((word) => word.startsWith(token)));
    });
    document.getElementById("club-list").innerHTML = found.map((club) => h`<article class="card">
      <h3><a href="/clubs/${club.id}">${club.name}</a></h3>
      <p>${club.city || "Ville non indiquée sur la liste du comité"} · n° ${club.id}</p>
      <p class="hint">${club.team_count} équipe${club.team_count > 1 ? "s" : ""} dans les compétitions chargées.</p>
    </article>`).join("") || h`<p>Aucun club ne correspond.</p>`;
  };
  document.getElementById("q-club").addEventListener("input", paint);
  paint();
}

async function renderClub(id) {
  const data = await api("/api/clubs/" + id);
  const club = data.club;
  const site = club.website
    ? h`<p>Site indiqué sur la page FFVB : <a href="${club.website}" target="_blank" rel="noopener noreferrer">${club.website}</a></p>`
    : (club.featured ? h`<p>Pas de site internet du club.</p>` : h`<p class="hint">Aucun site n’est indiqué sur les pages de poule consultées.</p>`);
  main.innerHTML = h`<p class="meta"><a href="/clubs">Clubs</a></p>
    <h1>${club.name}</h1>
    <p>${club.short_name && club.short_name !== club.name ? raw(esc(club.short_name) + " · ") : ""}n° ${club.id}${club.city ? raw(" · " + esc(club.city)) : ""}</p>
    <p>Nom dans les compétitions : ${club.ffvb_name}.</p>
    ${club.usual_gym ? raw(h`<p>Salle la plus utilisée à domicile : ${club.usual_gym}.</p>`) : ""}
    ${club.note ? raw(h`<p>${club.note}</p>`) : ""}
    ${raw(site)}
    <p><a href="${club.planning_url}" target="_blank" rel="noopener noreferrer">Semaine du club sur la FFVB</a></p>
    <h2>Équipes</h2>
    <div class="list">${raw(teamCards(data.teams))}</div>
    <h2>Prochains matchs</h2>
    ${raw(matchRows(data.upcoming))}
    <h2>Derniers résultats</h2>
    ${raw(matchRows(data.recent))}`;
  document.title = club.name + " — Volley 94";
}

function rankingTable(rankings) {
  const columns = [
    ["rank", "Rang"], ["name", "Équipe"], ["points", "Points"],
    ["played", "Joués"], ["won", "Gagnés"], ["lost", "Perdus"], ["forfeit", "Forfaits"],
    ["w3_0", "3-0"], ["w3_1", "3-1"], ["w3_2", "3-2"], ["l2_3", "2-3"], ["l1_3", "1-3"], ["l0_3", "0-3"],
    ["sets_for", "Sets pour"], ["sets_against", "Sets contre"], ["sets_ratio", "Coeff. sets"],
    ["points_for", "Points pour"], ["points_against", "Points contre"], ["points_ratio", "Coeff. points"]
  ];
  const head = columns.map((col) => h`<th scope="col">${col[1]}</th>`).join("");
  const body = rankings.map((row) => {
    const cells = columns.map((col, index) => {
      let value = row[col[0]];
      if (value === "MAX") value = "max";
      if (index === 1) {
        value = row.team_id
          ? h`<a href="/equipes/${row.team_id}">${row.name}</a>`
          : esc(row.name) + (row.in_department ? "" : " (hors 94)");
        return h`<td>${raw(value)}</td>`;
      }
      return h`<td>${value}</td>`;
    }).join("");
    return h`<tr>${raw(cells)}</tr>`;
  }).join("");
  return h`<div class="table-scroll" tabindex="0" aria-label="Classement complet, défilement horizontal">
    <table>
      <caption>3-0 à 0-3 : nombre de matchs gagnés ou perdus sur ce score en sets. « max » : aucun set encaissé.</caption>
      <thead><tr>${raw(head)}</tr></thead>
      <tbody>${raw(body)}</tbody>
    </table>
  </div>`;
}

function rosterList(rankings) {
  const items = rankings.map((row) => {
    const label = row.team_id
      ? h`<a href="/equipes/${row.team_id}">${row.name}</a>`
      : esc(row.name) + (row.in_department ? "" : " (hors 94)");
    return h`<li>${raw(label)}</li>`;
  }).join("");
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
    ? h`<details><summary>Tout le classement</summary>${raw(rankingTable(data.rankings))}</details>`
    : (data.rankings.length
      ? h`<h2>Équipes de la poule</h2><p class="hint">Le classement chiffré n’est pas encore publié.</p>${raw(rosterList(data.rankings))}`
      : h`<p class="hint">Le classement n’est pas encore publié.</p>`);
  const mixedText = mixed
    ? (hasStanding
      ? "Ce classement mélange des clubs du Val-de-Marne et d’autres départements."
      : "Cette poule mélange des clubs du Val-de-Marne et d’autres départements.")
    : "";
  main.innerHTML = h`<p class="meta"><a href="/clubs/${team.club_id}">${team.club_name}</a></p>
    <h1>${team.name}</h1>
    <p>${team.label}${data.poule.group ? raw(" · " + esc(groupText(data.poule.group))) : ""} · poule ${data.poule.code}</p>
    <p class="hint">Une poule est le groupe d’équipes qui se rencontrent dans cette compétition.</p>
    <p>Nom FFVB : ${team.ffvb_name}. ${team.usual_gym ? raw("Salle habituelle à domicile : " + esc(team.usual_gym) + ".") : ""}</p>
    <p>${rankText(team.rank, team.poule_size)}${team.won != null ? raw(". " + esc(team.won) + " victoire" + (team.won > 1 ? "s" : "") + " en " + esc(team.played) + " match" + (team.played > 1 ? "s" : "") + ".") : ""}</p>
    <div class="actions">${raw(pinButton(team.id))}${raw(calendar)}</div>
    <p class="hint">Le fichier .ics s’ouvre avec Calendrier (Apple), Outlook, ou s’importe dans Google Agenda. Rien n’est envoyé vers un serveur de notification.</p>
    ${mixedText ? raw(h`<p class="hint">${mixedText}</p>`) : ""}
    ${raw(board)}
    <h2>Prochains matchs</h2>
    ${raw(matchRows(data.upcoming, team.id))}
    <h2>Résultats</h2>
    ${raw(matchRows(data.played, team.id))}
    <p><a href="${data.poule.url}" target="_blank" rel="noopener noreferrer">Calendrier officiel de la poule</a>
      · <a href="${data.club.planning_url}" target="_blank" rel="noopener noreferrer">Semaine du club sur la FFVB</a></p>`;
  document.title = team.name + " — Volley 94";
}

async function renderMatch(id) {
  const data = await api("/api/matchs/" + id);
  const match = data.match;
  const sets = match.sets_home != null ? match.sets_home + " sets à " + match.sets_away : "Match à venir";
  const refs = [match.referee_1, match.referee_2].filter(Boolean);
  main.innerHTML = h`<p class="meta"><a href="/">Équipes</a>${match.poule_label ? raw(" · " + esc(match.poule_label)) : ""}</p>
    <h1>${match.home_name} – ${match.away_name}</h1>
    <p>${formatDate(match.date)} · ${formatTime(match.time)}</p>
    <p class="${match.status === "joue" ? "score" : ""}">${sets}</p>
    ${match.score ? raw(h`<p>Manches : ${match.score}</p>`) : ""}
    ${match.total ? raw(h`<p>Total des points : ${match.total}</p>`) : ""}
    <p>Salle : ${match.gym_label || "non indiquée"}.</p>
    <p>${refs.length ? raw("Arbitre : " + esc(refs.join(" et ")) + ".") : "Arbitre pas encore désigné."}</p>
    <p class="hint">Code match ${match.code}. La feuille de match officielle n’est pas recopiée ici.</p>
    <div class="actions">
      <a class="button" href="/calendrier/match/${match.id}.ics">Ajouter ce match au calendrier</a>
      ${match.home_team_id ? raw(h`<a class="button ghost" href="/equipes/${match.home_team_id}">Équipe à domicile</a>`) : ""}
      ${match.away_team_id ? raw(h`<a class="button ghost" href="/equipes/${match.away_team_id}">Équipe à l’extérieur</a>`) : ""}
    </div>
    ${match.poule_url ? raw(h`<p><a href="${match.poule_url}" target="_blank" rel="noopener noreferrer">Page officielle de la poule</a></p>`) : ""}`;
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
    else main.innerHTML = h`<h1>Page introuvable</h1><p><a href="/">Retour aux équipes</a></p>`;
  } catch (error) {
    showError(error);
  }
  if (started && location.hash !== "#suivies") main.focus();
  started = true;
}

document.body.addEventListener("click", (event) => {
  const pin = event.target.closest("[data-pin]");
  if (pin) {
    event.preventDefault();
    togglePin(pin.dataset.pin);
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
