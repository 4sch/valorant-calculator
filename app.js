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

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

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
    document.getElementById('performanceState').classList.add('hidden');
    document.getElementById('loadMoreBtn').classList.add('hidden');
    document.getElementById('noMoreMatches').classList.add('hidden');

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

function getInterpolatedColor(score) {
    const stops = [
        [0, 0, 85, 60],       // Red
        [200, 20, 85, 60],    // Lighter Red / Orange
        [300, 35, 90, 60],    // Orange
        [400, 52, 90, 62],    // Yellow
        [600, 100, 70, 60],   // Light Green
        [800, 140, 75, 55],   // Vibrant Green
        [1000, 220, 85, 60]   // Indigo Blue
    ];
    
    const s = Math.max(0, Math.min(1000, score));
    let lower = stops[0];
    let upper = stops[stops.length - 1];
    
    for (let i = 0; i < stops.length - 1; i++) {
        if (s >= stops[i][0] && s <= stops[i+1][0]) {
            lower = stops[i];
            upper = stops[i+1];
            break;
        }
    }
    
    const range = upper[0] - lower[0];
    const fraction = range === 0 ? 0 : (s - lower[0]) / range;
    
    let h = lower[1] + fraction * (upper[1] - lower[1]);
    let sat = lower[2] + fraction * (upper[2] - lower[2]);
    let l = lower[3] + fraction * (upper[3] - lower[3]);
    
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    if (theme === 'light') {
        let textL = Math.max(25, l - 20);
        if (h >= 35 && h <= 65) {
            textL = 30; // Force yellow to be dark olive/gold on light theme
        }
        return {
            text: `hsl(${h.toFixed(1)}, ${sat.toFixed(1)}%, ${textL}%)`,
            bg: `hsla(${h.toFixed(1)}, ${sat.toFixed(1)}%, 90%, 0.4)`
        };
    } else {
        return {
            text: `hsl(${h.toFixed(1)}, ${sat.toFixed(1)}%, ${l.toFixed(1)}%)`,
            bg: `hsla(${h.toFixed(1)}, ${sat.toFixed(1)}%, ${l.toFixed(1)}%, 0.12)`
        };
    }
}

function getScoreColor(score) {
    return getInterpolatedColor(score).text;
}

/* ─────────────────────────────────────────────────────────────────────────────
   COUNT-UP ANIMATION  (visual only)
───────────────────────────────────────────────────────────────────────────── */
function animateCount(el, target, duration = 600) {
    const start = performance.now();
    const from = 0;
    const isSvg = el instanceof SVGElement;
    const update = (now) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(from + (target - from) * eased);
        el.textContent = current;
        
        const colors = getInterpolatedColor(current);
        if (isSvg) {
            el.setAttribute('fill', colors.text);
        } else {
            el.style.color = colors.text;
            el.style.background = colors.bg;
        }
        
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
            
            if (data.matches.length < 5) {
                loadMoreBtn.classList.add('hidden');
                document.getElementById('noMoreMatches').classList.remove('hidden');
            } else {
                loadMoreBtn.classList.remove('hidden');
                document.getElementById('noMoreMatches').classList.add('hidden');
            }
            
            if (currentPage === 1) {
                const perfCard = document.getElementById('performanceState');
                perfCard.classList.remove('hidden');
                perfCard.classList.add('loading');
                fetchPerformance();
            }
        } else {
            loadMoreBtn.classList.add('hidden');
            if (currentPage > 1) {
                document.getElementById('noMoreMatches').classList.remove('hidden');
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

async function fetchPerformance() {
    const perfCard = document.getElementById('performanceState');
    
    try {
        const response = await fetch('/api/performance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUsername, tag: currentTag })
        });
        
        if (!response.ok) {
            perfCard.classList.add('hidden');
            return; // Silent fail for performance stats
        }
        
        const data = await response.json();
        
        document.getElementById('perfAcs').textContent = data.average_acs;
        document.getElementById('perfKda').textContent = `${data.average_kills}/${data.average_deaths}/${data.average_assists}`;
        document.getElementById('perfClutch').textContent = data.total_clutches;
        document.getElementById('perfFbfd').textContent = `${data.total_first_bloods} / ${data.total_first_deaths}`;
        
        const circle = document.getElementById('perfCircle');
        const text = document.getElementById('perfScoreText');
        
        // Show section
        perfCard.classList.remove('hidden');
        
        // Animate score text
        animateCount(text, data.average_score, 1000);
        
        // Animate circle
        const targetPercent = Math.min(100, Math.max(0, data.average_score / 10)); // assuming 1000 is max
        circle.style.stroke = getScoreColor(data.average_score);
        circle.style.strokeDasharray = `${targetPercent}, 100`;
        
        if (data.history && data.history.length > 0) {
            document.getElementById('perfAnalytics').classList.remove('hidden');
            renderTrendChart(data.history);
            renderAgentMapAnalytics(data.agent_performance, data.map_performance);
        }
        
    } catch (e) {
        console.error("Performance fetch error:", e);
        perfCard.classList.add('hidden');
    } finally {
        perfCard.classList.remove('loading');
    }
}

/* ─────────────────────────────────────────────────────────────────────────────
   ANALYTICS RENDER
───────────────────────────────────────────────────────────────────────────── */
let trendChartInstance = null;

function renderTrendChart(history) {
    const canvas = document.getElementById('trendChart');
    const ctx = canvas.getContext('2d');

    if (trendChartInstance) {
        trendChartInstance.destroy();
        trendChartInstance = null;
    }

    const scores = history.map(h => h.score);
    
    // Disambiguate matching date labels using counts
    const tempLabels = [];
    const dateCounts = {};
    history.forEach((h, i) => {
        const d = h.date ? new Date(h.date * 1000) : null;
        if (d) {
            const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
            dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
            tempLabels.push({ dateStr, count: dateCounts[dateStr] });
        } else {
            tempLabels.push({ dateStr: `M${i + 1}`, count: 1 });
        }
    });

    const labels = tempLabels.map(item => {
        const totalOccurrences = history.filter(h => {
            const d = h.date ? new Date(h.date * 1000) : null;
            return d && `${d.getDate()}/${d.getMonth() + 1}` === item.dateStr;
        }).length;
        
        if (totalOccurrences > 1) {
            return `${item.dateStr} (#${item.count})`;
        }
        return item.dateStr;
    });

    // Rolling average (window=5)
    const rollingAvg = scores.map((_, i) => {
        const window = scores.slice(Math.max(0, i - 4), i + 1);
        return Math.round(window.reduce((a, b) => a + b, 0) / window.length);
    });

    // Create gradient fill from bottom of chart to line
    const gradient = ctx.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, 'rgba(205, 161, 83, 0.25)');
    gradient.addColorStop(0.5, 'rgba(205, 161, 83, 0.07)');
    gradient.addColorStop(1, 'rgba(205, 161, 83, 0)');

    trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Score',
                    data: scores,
                    borderColor: '#cda153',
                    backgroundColor: gradient,
                    borderWidth: 2.5,
                    pointBackgroundColor: scores.map(s => getScoreColor(s)),
                    pointBorderColor: '#111',
                    pointBorderWidth: 1.5,
                    pointRadius: 5,
                    pointHoverRadius: 8,
                    pointHoverBorderWidth: 2,
                    fill: true,
                    tension: 0.35,
                    order: 1
                },
                {
                    label: 'Trend',
                    data: rollingAvg,
                    borderColor: 'rgba(130, 130, 160, 0.55)',
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    fill: false,
                    tension: 0.4,
                    order: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 900, easing: 'easeInOutQuart' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(10, 10, 14, 0.92)',
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderWidth: 1,
                    titleColor: '#e5e5e5',
                    bodyColor: '#a0a0b0',
                    titleFont: { family: 'Inter', size: 12, weight: 'bold' },
                    bodyFont: { family: 'Inter', size: 11 },
                    padding: 14,
                    cornerRadius: 10,
                    caretPadding: 8,
                    callbacks: {
                        title: function(items) {
                            const h = history[items[0].dataIndex];
                            return `${h.agent}  ·  ${h.map}`;
                        },
                        label: function(context) {
                            const h = history[context.dataIndex];
                            if (context.datasetIndex === 0) {
                                return `  Score: ${h.score}    ACS: ${h.acs}`;
                            }
                            return `  5-match avg: ${context.parsed.y}`;
                        },
                        labelColor: function(context) {
                            if (context.datasetIndex === 0) {
                                const c = getScoreColor(scores[context.dataIndex]);
                                return { borderColor: c, backgroundColor: c };
                            }
                            return { borderColor: '#8888a0', backgroundColor: '#8888a0' };
                        }
                    }
                }
            },
            interaction: { mode: 'index', axis: 'x', intersect: false },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: {
                        color: '#6a6a7a',
                        font: { family: 'Inter', size: 10 },
                        maxRotation: 0
                    }
                },
                y: {
                    min: 0,
                    max: 1000,
                    grid: {
                        color: (ctx) => {
                            if (ctx.tick.value === 500) return 'rgba(255,255,255,0.15)';
                            return 'rgba(255,255,255,0.05)';
                        },
                        lineWidth: (ctx) => ctx.tick.value === 500 ? 1.5 : 1
                    },
                    border: { display: false, dash: [4, 4] },
                    ticks: {
                        color: '#6a6a7a',
                        font: { family: 'Inter', size: 10 },
                        stepSize: 200,
                        callback: (v) => v === 500 ? '500 ─' : v
                    }
                }
            }
        }
    });
}

function renderAgentMapAnalytics(agents, maps) {
    const agentList = document.getElementById('agentAnalyticsList');
    const mapList = document.getElementById('mapAnalyticsList');
    
    agentList.innerHTML = '';
    mapList.innerHTML = '';
    
    if (!agents || agents.length === 0) {
        agentList.innerHTML = `<div class="empty-analytics">No Agent history found.</div>`;
    } else {
        agents.slice(0, 5).forEach(a => {
            const item = document.createElement('div');
            item.className = 'analytics-item';
            
            const width = Math.min(100, Math.max(0, a.average_score / 10));
            const color = getScoreColor(a.average_score);
            const wrColor = a.winrate >= 60 ? '#4ade80' : a.winrate >= 45 ? '#facc15' : '#f87171';
            const wrBg = a.winrate >= 60 ? 'rgba(74,222,128,0.12)' : a.winrate >= 45 ? 'rgba(250,204,21,0.12)' : 'rgba(248,113,113,0.12)';
            
            item.innerHTML = `
                <div class="analytics-item-header">
                    <span class="analytics-item-name">${a.agent} <span style="font-size: 10px; color: var(--text-muted); font-weight: 400;">(${a.matches} matches)</span></span>
                    <span class="analytics-item-score" style="color: ${color}">${a.average_score}</span>
                </div>
                <div class="analytics-item-stats">
                    <span class="winrate-badge" style="color: ${wrColor}; background: ${wrBg};">WR ${a.winrate}%</span>
                    <span>K/D/A: ${(a.kills/a.matches).toFixed(1)} / ${(a.deaths/a.matches).toFixed(1)} / ${(a.assists/a.matches).toFixed(1)}</span>
                </div>
                <div class="analytics-bar-bg">
                    <div class="analytics-bar-fill" style="width: 0%; background: ${color}"></div>
                </div>
            `;
            agentList.appendChild(item);
            
            // Trigger animation
            setTimeout(() => {
                const fill = item.querySelector('.analytics-bar-fill');
                if (fill) fill.style.width = width + '%';
            }, 50);
        });
    }
    
    if (!maps || maps.length === 0) {
        mapList.innerHTML = `<div class="empty-analytics">No Map history found.</div>`;
    } else {
        maps.slice(0, 5).forEach(m => {
            const item = document.createElement('div');
            item.className = 'analytics-item';
            
            const width = Math.min(100, Math.max(0, m.average_score / 10));
            const color = getScoreColor(m.average_score);
            const wrColor = m.winrate >= 60 ? '#4ade80' : m.winrate >= 45 ? '#facc15' : '#f87171';
            const wrBg = m.winrate >= 60 ? 'rgba(74,222,128,0.12)' : m.winrate >= 45 ? 'rgba(250,204,21,0.12)' : 'rgba(248,113,113,0.12)';
            
            item.innerHTML = `
                <div class="analytics-item-header">
                    <span class="analytics-item-name">${m.map} <span style="font-size: 10px; color: var(--text-muted); font-weight: 400;">(${m.matches} matches)</span></span>
                    <span class="analytics-item-score" style="color: ${color}">${m.average_score}</span>
                </div>
                <div class="analytics-item-stats">
                    <span class="winrate-badge" style="color: ${wrColor}; background: ${wrBg};">WR ${m.winrate}%</span>
                </div>
                <div class="analytics-bar-bg">
                    <div class="analytics-bar-fill" style="width: 0%; background: ${color}"></div>
                </div>
            `;
            mapList.appendChild(item);
            
            // Trigger animation
            setTimeout(() => {
                const fill = item.querySelector('.analytics-bar-fill');
                if (fill) fill.style.width = width + '%';
            }, 50);
        });
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
            <span class="date-divider-label">${escapeHtml(dateStr)}</span>
            <div class="date-divider-line"></div>
        `;
        matchList.appendChild(divider);

        // Match cards in this group
        dateGroups[dateStr].forEach(match => {
            const target = match.target_player;
            const score  = match.performance.final_score;


            // ── Calculate Match Win/Loss Outcome ─────────────────────────────
            let targetTeam = target.team;
            let roundsWon = 0;
            let roundsLost = 0;
            if (match.performance && match.performance.round_scores) {
                match.performance.round_scores.forEach(sr => {
                    if (sr.winning_team === targetTeam) {
                        roundsWon++;
                    } else {
                        roundsLost++;
                    }
                });
            }
            const isMatchWon = roundsWon > roundsLost;
            const matchOutcomeText = isMatchWon ? 'WIN' : 'LOST';
            const matchOutcomeClass = isMatchWon ? 'win' : 'lost';
            const scoreSummary = `${roundsWon}-${roundsLost}`;

            const card = document.createElement('div');
            card.className = `match-card ${matchOutcomeClass}`;

            // ── Calculate Highlights & Clutches ──────────────────────────────
            let maxClutchSize = 0;
            const multikills = { 5: 0, 4: 0, 3: 0 };
            
            if (match.performance && match.performance.round_scores) {
                match.performance.round_scores.forEach(sr => {
                    const killsInRound = sr.details ? sr.details.length : 0;
                    if (killsInRound >= 5) multikills[5]++;
                    else if (killsInRound === 4) multikills[4]++;
                    else if (killsInRound === 3) multikills[3]++;
                    
                    if (sr.details) {
                        sr.details.forEach(d => {
                            if (d.reason && d.reason.includes('clutch')) {
                                const m = d.reason.match(/1v(\d+)/);
                                if (m) {
                                    const size = parseInt(m[1], 10);
                                    if (size > maxClutchSize) maxClutchSize = size;
                                } else {
                                    if (maxClutchSize === 0) maxClutchSize = 1;
                                }
                            }
                        });
                    }
                });
            }
            
            let highlightsHtml = '';
            if (multikills[5] > 0) highlightsHtml += `<span class="badge ace">ACE x${multikills[5]}</span>`;
            if (multikills[4] > 0) highlightsHtml += `<span class="badge quad">4K x${multikills[4]}</span>`;
            if (multikills[3] > 0) highlightsHtml += `<span class="badge triple">3K x${multikills[3]}</span>`;
            if (maxClutchSize > 0) highlightsHtml += `<span class="badge clutch">1v${maxClutchSize} CLUTCH</span>`;
            
            if (highlightsHtml) {
                highlightsHtml = `<div class="match-highlights">${highlightsHtml}</div>`;
            }

            // ── Lobby Ranking Find ───────────────────────────────────────────
            const rankIndex = match.scoreboard.findIndex(p => p.puuid === targetPuuid);
            const rank = rankIndex !== -1 ? rankIndex + 1 : 10;
            let rankText = `${rank}th`;
            let rankClass = 'rank-other';
            if (rank === 1) { rankText = 'MVP'; rankClass = 'rank-1'; }
            else if (rank === 2) { rankText = '2nd'; rankClass = 'rank-2'; }
            else if (rank === 3) { rankText = '3rd'; rankClass = 'rank-3'; }
            
            const rankBadgeHtml = `<span class="rank-badge ${rankClass}">${rankText}</span>`;

            // ── Header ──────────────────────────────────────────────────────
            const header = document.createElement('div');
            header.className = 'match-header';
            header.innerHTML = `
                <div class="match-info">
                    <span class="match-map">
                        ${escapeHtml(match.map || 'UNKNOWN')}
                        ${rankBadgeHtml}
                        <span class="match-map-sep">//</span>
                        <span class="match-agent">${escapeHtml(target.agent || 'Unknown')}</span>
                    </span>
                    <span class="match-mode">
                        ${escapeHtml(match.mode || 'Unknown Mode')}
                        <span class="match-map-sep">//</span>
                        <span class="outcome-text ${matchOutcomeClass}">${matchOutcomeText} (${scoreSummary})</span>
                    </span>
                    ${highlightsHtml}
                </div>
                <div class="match-header-right">
                    <div class="match-score-summary">
                        <span class="score-chip" data-target-score="${score}">0</span>
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
                    const colors = getInterpolatedColor(p.final_score);

                    rowsHtml += `
                        <tr class="${isTarget ? 'scoreboard-row-target' : ''}">
                            <td class="agent-col">${escapeHtml(p.agent || 'N/A')}</td>
                            <td>
                                <span class="clickable-player" data-name="${escapeHtml(p.name)}" data-tag="${escapeHtml(p.tag)}">
                                    <span class="player-name">${escapeHtml(p.name)}</span>
                                    <span class="player-tag">#${escapeHtml(p.tag)}</span>
                                </span>
                            </td>
                            <td>${acs}</td>
                            <td class="kda-cell">${kills}/${deaths}/${assists}</td>
                            <td><span class="score-chip" style="color: ${colors.text}; background: ${colors.bg}">${p.final_score}</span></td>
                        </tr>
                    `;
                });

                scoreboardHtml += `
                    <div class="team-section ${teamClass}">
                        <div class="team-header">
                            <div class="team-header-dot"></div>
                            Team ${escapeHtml(teamName)}
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

            // Build name lookup for round details
            const nameLookup = {};
            match.scoreboard.forEach(p => {
                nameLookup[p.puuid] = { name: p.name, tag: p.tag };
            });

            // Build Rounds Breakdown HTML
            let roundsHtml = '';
            if (match.performance && match.performance.round_scores) {
                match.performance.round_scores.forEach(sr => {
                    const isWon = sr.winning_team === target.team;
                    const roundOutcome = isWon ? 'WON' : 'LOST';
                    const roundScore = sr.round_score;
                    const scoreSign = roundScore >= 0 ? `+${roundScore}` : `${roundScore}`;
                    const scoreClass = roundScore >= 0 ? 'positive' : 'negative';
                    
                    let eventItems = '';
                    
                    if (sr.first_blood_bonus > 0) {
                        eventItems += `
                            <div class="round-event-item fb">
                                <div class="round-event-bullet"></div>
                                <div class="round-event-desc">Secured <span class="event-highlight">First Blood</span> <span class="event-pts">(+${sr.first_blood_bonus.toFixed(1)} pts)</span></div>
                            </div>
                        `;
                    }
                    if (sr.first_death_penalty > 0) {
                        eventItems += `
                            <div class="round-event-item fd">
                                <div class="round-event-bullet"></div>
                                <div class="round-event-desc">Conceded <span class="event-highlight">First Death</span> <span class="event-pts">(-${sr.first_death_penalty.toFixed(1)} pts)</span></div>
                            </div>
                        `;
                    }
                    
                    if (sr.details && sr.details.length > 0) {
                        sr.details.forEach(d => {
                            const victimInfo = nameLookup[d.victim_puuid];
                            const victimName = victimInfo ? `${escapeHtml(victimInfo.name)}#${escapeHtml(victimInfo.tag)}` : 'Unknown Player';
                            let reasonStr = '';
                            if (d.reason && d.reason.includes('clutch')) {
                                const m = d.reason.match(/1v(\d+)/);
                                const suffix = m ? `1v${m[1]} ` : '';
                                reasonStr = ` - <span class="event-clutch">${suffix}CLUTCH (+${(d.clutch_bonus_points || 0).toFixed(1)} pts)</span>`;
                            } else if (d.reason && d.reason.includes('eco damage')) {
                                reasonStr = ` - <span class="event-eco">ECO DAMAGE</span>`;
                            }
                            
                            eventItems += `
                                <div class="round-event-item">
                                    <div class="round-event-bullet"></div>
                                    <div class="round-event-desc">Killed <span class="event-highlight">${victimName}</span> <span class="event-pts">(+${d.kill_points.toFixed(1)} pts)</span>${reasonStr}</div>
                                </div>
                            `;
                        });
                    }
                    
                    if (sr.damage_score && sr.damage_score > 0) {
                        eventItems += `
                            <div class="round-event-item dmg">
                                <div class="round-event-bullet"></div>
                                <div class="round-event-desc">Assist damage <span class="event-pts">(+${sr.damage_score.toFixed(1)} pts)</span></div>
                            </div>
                        `;
                    }
                    
                    if (!eventItems) {
                        eventItems = `
                            <div class="round-event-item">
                                <div class="round-event-bullet"></div>
                                <div class="round-event-desc" style="color:var(--text-muted)">No target interactions this round.</div>
                            </div>
                        `;
                    }
                    
                    roundsHtml += `
                        <div class="round-row-card ${isWon ? 'won' : 'lost'}">
                            <div class="round-row-header">
                                <div class="round-num-title">
                                    Round ${String(sr.round_num).padStart(2, '0')}
                                    <span class="round-outcome-lbl">${roundOutcome}</span>
                                </div>
                                <div class="round-row-score-chip ${scoreClass}">${scoreSign} pts</div>
                            </div>
                            <div class="round-events-list">
                                ${eventItems}
                            </div>
                        </div>
                    `;
                });
            }

            let mathKills = 0;
            let mathClutches = 0;
            let mathFB = 0;
            let mathFD = 0;
            let mathDmg = 0;
            let mathTotal = 0;
            
            if (match.performance && match.performance.round_scores) {
                match.performance.round_scores.forEach(sr => {
                    mathKills += sr.kills_score || 0;
                    mathClutches += sr.clutch_bonus || 0;
                    mathFB += sr.first_blood_bonus || 0;
                    mathFD += sr.first_death_penalty || 0;
                    mathDmg += sr.damage_score || 0;
                });
            }
            mathTotal = mathKills + mathClutches + mathFB - mathFD + mathDmg;
            const mathRounds = match.performance.total_rounds || 1;
            const mathAvg = match.performance.average_round_score || (mathTotal / mathRounds);
            const mathCurved = match.performance.final_score;

            details.innerHTML = `
                <div class="match-details-inner">
                    <div class="match-tabs">
                        <button class="tab-btn active" data-target="scoreboard-${match.match_id}">Scoreboard</button>
                        <button class="tab-btn" data-target="rounds-${match.match_id}">Rounds</button>
                        <button class="tab-btn" data-target="math-${match.match_id}">Score Math</button>
                    </div>
                    
                    <div class="tab-content" id="scoreboard-${match.match_id}">
                        <p class="scoreboard-label">Match Scoreboard</p>
                        ${scoreboardHtml}
                    </div>
                    
                    <div class="tab-content hidden" id="rounds-${match.match_id}">
                        <p class="scoreboard-label">Round-by-Round Breakdown</p>
                        <div class="rounds-timeline">
                            ${roundsHtml}
                        </div>
                    </div>

                    <div class="tab-content hidden" id="math-${match.match_id}">
                        <p class="scoreboard-label">Score Calculation Breakdown</p>
                        <div class="math-container">
                            <div class="math-breakdown-card">
                                <div class="math-row">
                                    <span class="math-label">
                                        Kills (Base)
                                        <span class="tooltip-trigger" data-tooltip="Points gained from round kills (excluding clutch multipliers). Weighted by enemy ACS and eco-damage modifiers.">
                                            <i class="info-icon">i</i>
                                        </span>
                                    </span>
                                    <span class="math-value positive">+${mathKills.toFixed(1)} pts</span>
                                </div>
                                <div class="math-row">
                                    <span class="math-label">
                                        Clutch Bonus
                                        <span class="tooltip-trigger" data-tooltip="Extra bonus points (+0.5x multiplier) gained for securing kills in clutch 1vN round-won scenarios.">
                                            <i class="info-icon">i</i>
                                        </span>
                                    </span>
                                    <span class="math-value positive">+${mathClutches.toFixed(1)} pts</span>
                                </div>
                                <div class="math-row">
                                    <span class="math-label">
                                        First Bloods
                                        <span class="tooltip-trigger" data-tooltip="Bonus points gained for securing the first kill of a round (+25.0 pts per occurrence).">
                                            <i class="info-icon">i</i>
                                        </span>
                                    </span>
                                    <span class="math-value positive">+${mathFB.toFixed(1)} pts</span>
                                </div>
                                <div class="math-row">
                                    <span class="math-label">
                                        First Deaths
                                        <span class="tooltip-trigger" data-tooltip="Penalties deducted for being the first to die in a round (-35.0 pts per occurrence).">
                                            <i class="info-icon">i</i>
                                        </span>
                                    </span>
                                    <span class="math-value negative">-${mathFD.toFixed(1)} pts</span>
                                </div>
                                <div class="math-row">
                                    <span class="math-label">
                                        Assist Damage
                                        <span class="tooltip-trigger" data-tooltip="Points gained from damage dealt to enemies you did not kill. Discounted in hopeless round-lost scenarios.">
                                            <i class="info-icon">i</i>
                                        </span>
                                    </span>
                                    <span class="math-value positive">+${mathDmg.toFixed(1)} pts</span>
                                </div>
                                
                                <div class="math-row divider"></div>
                                
                                <div class="math-row total">
                                    <span class="math-label">
                                        Raw Match Total
                                        <span class="tooltip-trigger" data-tooltip="Total raw score accumulated over all rounds of the match.">
                                            <i class="info-icon">i</i>
                                        </span>
                                    </span>
                                    <span class="math-value">${mathTotal.toFixed(1)} pts</span>
                                </div>
                                <div class="math-row formula">
                                    <span class="math-label">
                                        Avg Round Score
                                        <span class="tooltip-trigger" data-tooltip="Raw match total divided by the total number of rounds played (${mathRounds}).">
                                            <i class="info-icon">i</i>
                                        </span>
                                    </span>
                                    <span class="math-value">${mathAvg.toFixed(2)} pts</span>
                                </div>
                                <div class="math-row final">
                                    <span class="math-label">
                                        Performance Score
                                        <span class="tooltip-trigger" data-tooltip="Scaled against the 45.0 perfect-round benchmark and curved: (Avg Round Score / 45.0) ^ 0.98 * 1000.">
                                            <i class="info-icon">i</i>
                                        </span>
                                    </span>
                                    <span class="math-value highlight">${mathCurved} / 1000</span>
                                </div>
                            </div>
                            <div class="math-explanation-card">
                                <h4 class="formula-title">Scoring Formula</h4>
                                <div class="formula-math">
                                    <span class="formula-block">Avg Round Score = Raw Total / Rounds</span>
                                    <span class="formula-block">Performance Score = (Avg / 45.0)<sup>0.98</sup> × 1000</span>
                                </div>
                                <div class="formula-notes">
                                    <p>Your performance is evaluated round-by-round and scaled against a combat benchmark of 45.0 points per round.</p>
                                    <p>An exponent curve of 0.98 is applied to map raw performance ratio into a premium 0-1000 score index.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // ── Toggle accordion ─────────────────────────────────────────────
            header.addEventListener('click', () => {
                const isOpen = card.classList.contains('open');
                card.classList.toggle('open', !isOpen);

                if (!isOpen) {
                    // Set max-height to actual content height so nothing gets clipped
                    details.style.maxHeight = details.scrollHeight + 'px';

                    // Run count-up on all score chips in this card on first open
                    card.querySelectorAll('.score-chip[data-target-score]').forEach(chip => {
                        const targetVal = parseInt(chip.dataset.targetScore, 10);
                        animateCount(chip, targetVal, 500);
                        delete chip.dataset.targetScore; // only animate once
                    });
                } else {
                    details.style.maxHeight = '0';
                }
            });

            // ── Count-up on the header chip too (runs immediately on render) ─
            const headerChip = header.querySelector('.score-chip[data-target-score]');
            if (headerChip) {
                setTimeout(() => {
                    const targetVal = parseInt(headerChip.dataset.targetScore, 10);
                    animateCount(headerChip, targetVal, 700);
                    delete headerChip.dataset.targetScore;
                }, 80);
            }

            // ── Clickable player names ───────────────────────────────────────
            const clickables = details.querySelectorAll('.clickable-player');
            clickables.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const name = btn.getAttribute('data-name');
                    const tag = btn.getAttribute('data-tag');
                    if (name && tag) {
                        document.getElementById('username').value = name;
                        document.getElementById('tag').value = tag;
                        document.getElementById('calcBtn').click();
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                });
            });

            // ── Tabs Switching ───────────────────────────────────────────────
            const tabButtons = details.querySelectorAll('.tab-btn');
            tabButtons.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const targetId = btn.getAttribute('data-target');
                    
                    // Toggle active button
                    tabButtons.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    
                    // Toggle content visibility
                    const tabContents = details.querySelectorAll('.tab-content');
                    tabContents.forEach(tc => {
                        if (tc.id === targetId) {
                            tc.classList.remove('hidden');
                        } else {
                            tc.classList.add('hidden');
                        }
                    });
                    
                    // Recalculate max-height after tab switch since content height changes
                    requestAnimationFrame(() => {
                        details.style.maxHeight = details.scrollHeight + 'px';
                    });
                });
            });

            card.appendChild(header);
            card.appendChild(details);
            matchList.appendChild(card);
        });
    });
}