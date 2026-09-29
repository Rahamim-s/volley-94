# Volley 94

Alternative gratuite à [Blockout](https://apps.apple.com/fr/app/blockout/id6752107208), limitée au volley du Val-de-Marne. On y retrouve les clubs, les équipes, les classements et les matchs, et on peut ajouter une équipe ou un match à son calendrier.

Pas de compte, pas de paiement, pas de notification sur le téléphone.

## Ouvrir l’application

Page publique, sans compte : https://rahamim-s.github.io/volley-94/

Le calendrier des matchs d’ASA Maisons-Alfort 2 (seniors masculins 2) est le fichier `static/asa-maisons-alfort-2.ics`. Le lien est dans la page. Il ne contient pas les autres équipes du club, ni les autres matchs du 94.

En local :

```bash
cd ~/Projects/perso/volley-app
python3 app.py
```

Puis ouvre http://127.0.0.1:8765/static/ dans le navigateur.

Sur le même Wi-Fi, pour ouvrir la page depuis un téléphone :

```bash
cd ~/Projects/perso/volley-app
python3 app.py --wifi
```

Le serveur écoute sur `0.0.0.0`, port 8765. Le terminal affiche l’adresse à ouvrir, du type http://192.168.1.20:8765/static/.

## Rafraîchir les données

```bash
python3 refresh_data.py
```

Le script relit les pages publiques et réécrit `data/94.json`. Le serveur reprend le fichier tout seul. Compte une à deux minutes : une requête à la fois, pour ne pas taper sur le site de la fédération.

Contrôle :

```bash
python3 tests/test_volley.py
```

Aucune bibliothèque à installer. Python 3.9 ou plus récent suffit.

## Ce qu’on y trouve

Saison lue sur les pages FFVB (2026/2027 au moment de la première collecte).

- Les clubs du comité du Val-de-Marne, avec leur numéro FFVB.
- Leurs équipes en départemental, accession régionale, loisir, jeunes (M11 à M18), régional et pré-national.
- Le classement de la poule, quand la FFVB l’a publié : points, matchs joués, gagnés, perdus, forfaits, scores de 3-0 à 0-3, sets, points, coefficients. Sinon, la liste des équipes engagées.
- Les matchs : date, heure, équipes, sets, manches, total de points, salle, arbitres quand ils sont publiés.
- Un fichier `.ics` pour les matchs d’ASA Maisons-Alfort 2, seniors masculins 2 (libellé FFVB `ASA MAISONS-ALFORT 2`). Il s’ouvre avec Calendrier (Apple), Outlook, ou s’importe dans Google Agenda. Pas d’identifiant de calendrier, pas de contact, pas de licence, pas de feuille de match.
- « Suivre cette équipe » : la liste reste dans le navigateur, sur cet appareil (`localStorage`).

Le club mis en avant est l’**Association sportive amicale Maisons-Alfort** (ASA VB MA), n° **0946822**. Dans les compétitions le nom est **ASA MAISONS ALFORT**. Ce n’est pas l’ASAS, une autre association, à Paris. Pas de site de club. La salle à domicile la plus fréquente est calculée à partir des matchs (souvent le gymnase Condorcet).

## Limite sur « me prévenir »

Il n’y a pas de serveur de notifications. Épingler une équipe permet de la revoir sans compte. Pour être prévenu à l’avance, il faut ajouter l’équipe ou le match au calendrier.

## Sources

Pages publiques seulement. Pas de mot de passe, pas d’espace licences, pas de contournement.

| Usage | Page |
| --- | --- |
| Liste des clubs | https://cdvb94.fr/la-pratique/liste-des-clubs/ |
| Index des résultats du comité | https://cdvb94.fr/resultats/ |
| Poules du 94 | https://www.ffvbbeach.org/ffvbapp/resu/vbspo_home.php?codent=PTIDF94 |
| Poules seniors de la ligue | https://www.ffvbbeach.org/ffvbapp/resu/vbspo_home.php?codent=LIIDF |
| Classement d’une poule | `vbspo_calendrier.php?saison=2026/2027&codent=…&poule=…` |
| Calendrier complet | export public `vbspo_calendrier_export.php` (CSV `;`, windows-1252) |
| Nom du club de Maisons-Alfort | guide municipal 2026-2027, rubrique volley : https://maisons-alfort.fr/wp-content/uploads/2018/12/2026-2027-temps-libre.pdf |

Le guide municipal n’est pas téléchargé par le script : il sert à fixer le nom public. Le portrait municipal (https://maisons-alfort.fr/portrait-kristina-meliksetian-letoile-montante-du-volleyball-maisonnais/) appelle le club « ASA Volleyball » ; il n’est pas recopié dans l’application.

Les poules de ligue ne sont gardées que si au moins un club du 94 y joue. Les autres clubs de la poule restent dans le classement, sans fiche.

## Ce qui n’est pas pris

- Adressier des équipes (noms, téléphones, e-mails, adresses de correspondants).
- Feuilles de match et numéros de licence (`ffvolley_fdme.php`, `fiche_match_ffvb.php`).
- Saisie des résultats, espace licences, extranet, webcoach.
- FSGT, UNSS, loisir municipal hors FFVB.
- Coupe de France et coupes Île-de-France (prévues plus tard : c’est le manque le plus cité sur Blockout).
- Championnat pro LNV, même si un club du 94 y joue (Créteil féminin). Les XML `lnv.fr` sont un autre flux.
- PDF de règlements (RPE, BRI, planning de journées) : ce ne sont pas les scores du week-end.
- Sites tiers (Score’n’co, etc.).

Heures à `00:00`, scores vides et arbitre « SUPERVISION » sont traités comme « pas encore publié ». Un code match avec un `R` est un match retour : il est affiché tel quel.

Si une page publique ne répond pas, le script la signale dans `warnings` du JSON et continue avec le reste.

## Réutilisation si on vend l’application plus tard

Les pages de la FFVB et du comité sont publiques, mais ce n’est pas une licence qui autorise à revendre le fichier ou à se présenter comme une source officielle. Avant une offre payante : accord du comité et de la FFVB, pas de republication des feuilles de match ni des coordonnées de personnes, pas de copie brute des classements vendue comme un produit à part.

## Modèle, pour un autre département

`data/94.json` porte un bloc `department` (`code`, `name`, entité FFVB `PTIDF94`, ligue `LIIDF`). Clubs, poules, équipes et matchs ont un `id` stable. Le serveur charge tous les `data/*.json`.

Pour un autre département : dupliquer le bloc `DEPARTMENT` dans `refresh_data.py` (URL de la liste des clubs du comité, code entité FFVB) et écrire un second fichier, par exemple `data/95.json`. Les poules de ligue sont celles où joue au moins un club de ce département. Si deux fichiers contiennent la même poule de ligue, le dernier chargé remplace l’autre : il faudra dédupliquer par `id` de poule avant de fusionner.

La page (`static/`) lit `data/94.json` dans le navigateur. `app.py` sert les mêmes fichiers en local.

## Fichiers

- `refresh_data.py` — collecte
- `volley_data.py` — lecture, filtres, fiches, `.ics`
- `app.py` — serveur
- `static/` — pages
- `data/94.json` — copie locale des données
