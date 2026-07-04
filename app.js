/* ─────────────────────────────────────────────────────────────────────────────
   THEME TOGGLE  (visual only — no business logic)
───────────────────────────────────────────────────────────────────────────── */
const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;

// Restore saved preference
const savedTheme = localStorage.getItem('theme') || 'dark';
html.setAttribute('data-theme', savedTheme);

themeToggle.addEventListener('click', () => {
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
});

/* ─────────────────────────────────────────────────────────────────────────────
   STATE  (unchanged)
───────────────────────────────────────────────────────────────────────────── */
let currentPage = 1;
let currentUsername = "";
let currentTag = "";
let allLoadedMatches = [];

/* ─────────────────────────────────────────────────────────────────────────────
   EVENT LISTENERS  (unchanged logic)
───────────────────────────────────────────────────────────────────────────── */
document.getElementById('calcBtn').addEventListener('click', () => {
    currentUsername = document.getElementById('username').value.trim();
    currentTag = document.getElementById('tag').value.trim();

    if (!currentUsername || !currentTag) {
        showError("Please fill out both Username and Tag fields.");
        return;
    }

    currentPage = 1;
    allLoadedMatches = [];
    document.getElementById('matchList').innerHTML = "";
    document.getElementById('resultState').classList.add('hidden');
    document.getElementById('loadMoreBtn').classList.add('hidden');

    fetchMatches();
});

document.getElementById('loadMoreBtn').addEventListener('click', () => {
    currentPage++;
    fetchMatches();
});

/* ─────────────────────────────────────────────────────────────────────────────
   HELPERS  (unchanged logic, updated text labels)
───────────────────────────────────────────────────────────────────────────── */
function showError(msg) {
    const errorCard = document.getElementById('errorState');
    errorCard.innerText = msg;
    errorCard.classList.remove('hidden');
}

function getMatchDateString(gameStart) {
    if (!gameStart) return "UNKNOWN DATE";
    const date = new Date(gameStart < 99999999999 ? gameStart * 1000 : gameStart);
    const options = { month: 'long', day: 'numeric', year: 'numeric' };
    return date.toLocaleDateString('en-US', options).toUpperCase();
}

function getScoreClass(score) {
    if (score >= 600) return 'great';
    if (score >= 400) return 'mid';
    return 'low';
}

function getScoreColor(score) {
    if (score >= 600) return 'var(--score-great)';
    if (score >= 400) return 'var(--score-mid)';
    return 'var(--score-low)';
}

/* ─────────────────────────────────────────────────────────────────────────────
   COUNT-UP ANIMATION  (visual only)
───────────────────────────────────────────────────────────────────────────── */
function animateCount(el, target, duration = 600) {
    const start = performance.now();
    const from = 0;
    const update = (now) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // ease-out
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(from + (target - from) * eased);
        if (progress < 1) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
}

/* ─────────────────────────────────────────────────────────────────────────────
   FETCH  (unchanged logic — only loading text updated)
───────────────────────────────────────────────────────────────────────────── */
async function fetchMatches() {
    const errorCard   = document.getElementById('errorState');
    const resultCard  = document.getElementById('resultState');
    const btn         = document.getElementById('calcBtn');
    const loadMoreBtn = document.getElementById('loadMoreBtn');

    errorCard.classList.add('hidden');
    btn.querySelector('span').innerText = "Retrieving matches…";
    btn.disabled = true;

    if (currentPage > 1) {
        loadMoreBtn.querySelector('span').innerText = "Loading…";
        loadMoreBtn.disabled = true;
    }

    try {
        const response = await fetch('/api/calculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUsername, tag: currentTag, page: currentPage })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `Server returned error status ${response.status}`);
        }

        if (data.matches.length > 0) {
            allLoadedMatches.push(...data.matches);
            renderMatches(allLoadedMatches, data.target_puuid);
            resultCard.classList.remove('hidden');
            loadMoreBtn.classList.remove('hidden');
        } else {
            loadMoreBtn.classList.add('hidden');
            if (currentPage > 1) {
                alert("No older matches found.");
            } else {
                showError("No matches found for this user.");
            }
        }

    } catch (err) {
        showError(`Error: ${err.message}`);
    } finally {
        btn.querySelector('span').innerText = "Analyse Match Performance";
        btn.disabled = false;
        loadMoreBtn.querySelector('span').innerText = "Load More Matches";
        loadMoreBtn.disabled = false;
    }
}

/* ─────────────────────────────────────────────────────────────────────────────
   RENDER  (logic unchanged — classes & markup updated for new design)
───────────────────────────────────────────────────────────────────────────── */
function renderMatches(matches, targetPuuid) {
    const matchList = document.getElementById('matchList');
    matchList.innerHTML = "";

    // ── Group by date ────────────────────────────────────────────────────────
    const dateGroups = {};
    const uniqueDates = [];

    matches.forEach(match => {
        const dateStr = getMatchDateString(match.game_start);
        if (!dateGroups[dateStr]) {
            dateGroups[dateStr] = [];
            uniqueDates.push(dateStr);
        }
        dateGroups[dateStr].push(match);
    });

    // ── Render each date group ───────────────────────────────────────────────
    uniqueDates.forEach(dateStr => {

        // Date divider
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.innerHTML = `
            <div class="date-divider-dot"></div>
            <span class="date-divider-label">${dateStr}</span>
            <div class="date-divider-line"></div>
        `;
        matchList.appendChild(divider);

        // Match cards in this group
        dateGroups[dateStr].forEach(match => {
            const card = document.createElement('div');
            card.className = 'match-card';

            const target = match.target_player;
            const score  = match.performance.final_score;
            const cls    = getScoreClass(score);

            // ── Header ──────────────────────────────────────────────────────
            const header = document.createElement('div');
            header.className = 'match-header';
            header.innerHTML = `
                <div class="match-info">
                    <span class="match-map">
                        ${match.map || 'UNKNOWN'}
                        <span class="match-map-sep">//</span>
                        <span class="match-agent">${target.agent || 'Unknown'}</span>
                    </span>
                    <span class="match-mode">${match.mode || 'Unknown Mode'}</span>
                </div>
                <div class="match-header-right">
                    <div class="match-score-summary">
                        <span class="score-chip ${cls}" data-target-score="${score}">0</span>
                    </div>
                    <span class="chevron">›</span>
                </div>
            `;

            // ── Details ─────────────────────────────────────────────────────
            const details = document.createElement('div');
            details.className = 'match-details';

            // Group scoreboard by team
            const teams = {};
            match.scoreboard.forEach(p => {
                const teamName = p.team || 'UNKNOWN';
                if (!teams[teamName]) teams[teamName] = [];
                teams[teamName].push(p);
            });

            for (const teamName in teams) {
                teams[teamName].sort((a, b) => b.final_score - a.final_score);
            }

            let scoreboardHtml = '';
            for (const [teamName, players] of Object.entries(teams)) {
                const teamClass = teamName.toLowerCase() === 'red' ? 'red'
                                : teamName.toLowerCase() === 'blue' ? 'blue'
                                : 'other';

                let rowsHtml = '';
                players.forEach(p => {
                    const isTarget = p.puuid === targetPuuid;
                    const stats    = p.stats || {};
                    const acs      = stats.score ? Math.round(stats.score / match.performance.total_rounds) : 0;
                    const kills    = stats.kills   || 0;
                    const deaths   = stats.deaths  || 0;
                    const assists  = stats.assists || 0;
                    const pCls     = getScoreClass(p.final_score);

                    rowsHtml += `
                        <tr class="${isTarget ? 'scoreboard-row-target' : ''}">
                            <td class="agent-col">${p.agent || 'N/A'}</td>
                            <td>
                                <span class="player-name">${p.name}</span>
                                <span class="player-tag">#${p.tag}</span>
                            </td>
                            <td>${acs}</td>
                            <td class="kda-cell">${kills}/${deaths}/${assists}</td>
                            <td><span class="score-chip ${pCls}">${p.final_score}</span></td>
                        </tr>
                    `;
                });

                scoreboardHtml += `
                    <div class="team-section ${teamClass}">
                        <div class="team-header">
                            <div class="team-header-dot"></div>
                            Team ${teamName}
                        </div>
                        <table class="scoreboard-table">
                            <thead>
                                <tr>
                                    <th style="width:14%">Agent</th>
                                    <th style="width:34%">Player</th>
                                    <th style="width:14%">ACS</th>
                                    <th style="width:20%">K / D / A</th>
                                    <th style="width:18%">Score</th>
                                </tr>
                            </thead>
                            <tbody>${rowsHtml}</tbody>
                        </table>
                    </div>
                `;
            }

            details.innerHTML = `
                <div class="match-details-inner">
                    <p class="scoreboard-label">Match Scoreboard</p>
                    ${scoreboardHtml}
                </div>
            `;

            // ── Toggle accordion ─────────────────────────────────────────────
            header.addEventListener('click', () => {
                const isOpen = card.classList.contains('open');
                card.classList.toggle('open', !isOpen);

                // Run count-up on all score chips in this card on first open
                if (!isOpen) {
                    card.querySelectorAll('.score-chip[data-target-score]').forEach(chip => {
                        const target = parseInt(chip.dataset.targetScore, 10);
                        animateCount(chip, target, 500);
                        delete chip.dataset.targetScore; // only animate once
                    });
                }
            });

            // ── Count-up on the header chip too (runs immediately on render) ─
            const headerChip = header.querySelector('.score-chip[data-target-score]');
            if (headerChip) {
                setTimeout(() => {
                    const target = parseInt(headerChip.dataset.targetScore, 10);
                    animateCount(headerChip, target, 700);
                    delete headerChip.dataset.targetScore;
                }, 80);
            }

            card.appendChild(header);
            card.appendChild(details);
            matchList.appendChild(card);
        });
    });
}