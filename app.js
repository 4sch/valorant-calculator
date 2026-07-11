/* ═══════════════════════════════════════════════════════════════════════════
   VALTRACK — frontend
═══════════════════════════════════════════════════════════════════════════ */

const AGENT_UUIDS = {
    'astra': '41fb69c1-4189-7b37-8e5c-76083e914f5c',
    'breach': '5f8d3a7f-467b-97f3-062c-13acf203c006',
    'brimstone': '9f0d8ba9-4140-b941-57d3-a7ad57c6b417',
    'chamber': '22697a3d-45bf-8dd7-4fec-84a9e28c69d7',
    'clove': '1dbf2edd-4729-0984-3115-daa5eed44993',
    'cypher': '117ed9e3-49f3-6512-3ccf-0cada7e3823b',
    'deadlock': 'cc8b64c8-4b25-4ff9-6e7f-37b4da43d235',
    'fade': 'dade69b4-4f5a-8528-247b-219e5a1facd6',
    'gekko': 'e370fa57-4757-3604-3648-499e1f642d3f',
    'harbor': '95b78ed7-4637-86d9-7e41-71ba8c293152',
    'iso': '0e38b510-41a8-5780-5e8f-568b2a4f2d6c',
    'jett': 'add6443a-41bd-e414-f6ad-e58d267f4e95',
    'kay/o': '601dbbe7-43ce-be57-2a40-4abd24953621',
    'kayo': '601dbbe7-43ce-be57-2a40-4abd24953621',
    'killjoy': '1e58de9c-4950-5125-93e9-a0aee9f98746',
    'neon': 'bb2a4828-46eb-8cd1-e765-15848195d751',
    'omen': '8e253930-4c05-31dd-1b6c-968525494517',
    'phoenix': 'eb93336a-449b-9c1b-0a54-a891f7921d69',
    'raze': 'f94c3b30-42be-e959-889c-5aa313dba261',
    'reyna': 'a3bfb853-43b2-7238-a4f1-ad90e9e46bcc',
    'sage': '569fdd95-4d10-43ab-ca70-79becc718b46',
    'skye': '6f2a04ca-43e0-be17-7f36-b3908627744d',
    'sova': '320b2a48-4d9b-a075-30f1-1f93a9b638fa',
    'tejo': 'b444168c-4e35-8076-db47-ef9bf368f384',
    'viper': '707eab51-4836-f488-046a-cda6bf494859',
    'vyse': 'efba5359-4016-a1e5-7626-b1ae76895940',
    'waylay': 'df1cb487-4902-002e-5c17-d28e83e78588',
    'yoru': '7f94d92c-4234-0a36-9646-3a87eb8b5c89',
};

const RECENT_KEY = 'valtrack_recent';
const MAX_RECENT = 8;

/* ── Theme ─────────────────────────────────────────────────────────────────── */
const html = document.documentElement;
const themeToggle = document.getElementById('themeToggle');
const savedTheme = localStorage.getItem('theme') || 'dark';
html.setAttribute('data-theme', savedTheme);

themeToggle.addEventListener('click', () => {
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    if (trendChartInstance && lastHistory) renderTrendChart(lastHistory);
});

/* ── DOM refs ──────────────────────────────────────────────────────────────── */
const searchForm = document.getElementById('searchForm');
const riotIdInput = document.getElementById('riotId');
const usernameInput = document.getElementById('username');
const tagInput = document.getElementById('tag');
const calcBtn = document.getElementById('calcBtn');
const errorState = document.getElementById('errorState');
const featureStrip = document.getElementById('featureStrip');
const searchHero = document.getElementById('searchHero');

/* ── State ─────────────────────────────────────────────────────────────────── */
let currentPage = 1;
let currentUsername = '';
let currentTag = '';
let allLoadedMatches = [];
let trendChartInstance = null;
let lastHistory = null;
let currentTargetPuuid = null;

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function agentIconUrl(name) {
    if (!name) return '';
    const key = String(name).toLowerCase().trim();
    const uuid = AGENT_UUIDS[key] || AGENT_UUIDS[key.replace('/', '')];
    if (!uuid) return '';
    return `https://media.valorant-api.com/agents/${uuid}/displayicon.png`;
}

function showError(msg) {
    errorState.textContent = msg;
    errorState.classList.remove('hidden');
}

function hideError() {
    errorState.classList.add('hidden');
    errorState.textContent = '';
}

function setLoading(isLoading) {
    calcBtn.disabled = isLoading;
    calcBtn.querySelector('.btn-label').textContent = isLoading ? 'Retrieving matches…' : 'Analyze Performance';
    calcBtn.querySelector('.btn-spinner').classList.toggle('hidden', !isLoading);
}

function parseRiotId(raw) {
    const s = (raw || '').trim();
    if (!s) return null;
    // Support Name#TAG, Name #TAG, Name/TAG
    const m = s.match(/^(.+?)[#\/]\s*(.+)$/);
    if (m) return { name: m[1].trim(), tag: m[2].trim() };
    return null;
}

function syncRiotFieldsFromCombined() {
    const parsed = parseRiotId(riotIdInput.value);
    if (parsed) {
        usernameInput.value = parsed.name;
        tagInput.value = parsed.tag;
    }
}

function syncCombinedFromSplit() {
    const name = usernameInput.value.trim();
    const tag = tagInput.value.trim();
    if (name && tag) {
        riotIdInput.value = `${name}#${tag}`;
    }
}

riotIdInput.addEventListener('input', syncRiotFieldsFromCombined);
riotIdInput.addEventListener('blur', syncRiotFieldsFromCombined);
usernameInput.addEventListener('input', syncCombinedFromSplit);
tagInput.addEventListener('input', syncCombinedFromSplit);

function getMatchDateString(gameStart) {
    if (!gameStart) return 'UNKNOWN DATE';
    const date = new Date(gameStart < 99999999999 ? gameStart * 1000 : gameStart);
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
}

function getInterpolatedColor(score) {
    const stops = [
        [0, 0, 85, 60],
        [200, 20, 85, 60],
        [300, 35, 90, 60],
        [400, 52, 90, 62],
        [600, 100, 70, 60],
        [800, 140, 75, 55],
        [1000, 220, 85, 60],
    ];
    const s = Math.max(0, Math.min(1000, score));
    let lower = stops[0];
    let upper = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
        if (s >= stops[i][0] && s <= stops[i + 1][0]) {
            lower = stops[i];
            upper = stops[i + 1];
            break;
        }
    }
    const range = upper[0] - lower[0];
    const fraction = range === 0 ? 0 : (s - lower[0]) / range;
    const h = lower[1] + fraction * (upper[1] - lower[1]);
    const sat = lower[2] + fraction * (upper[2] - lower[2]);
    let l = lower[3] + fraction * (upper[3] - lower[3]);
    const theme = html.getAttribute('data-theme') || 'dark';
    if (theme === 'light') {
        let textL = Math.max(25, l - 20);
        if (h >= 35 && h <= 65) textL = 30;
        return {
            text: `hsl(${h.toFixed(1)}, ${sat.toFixed(1)}%, ${textL}%)`,
            bg: `hsla(${h.toFixed(1)}, ${sat.toFixed(1)}%, 90%, 0.45)`,
        };
    }
    return {
        text: `hsl(${h.toFixed(1)}, ${sat.toFixed(1)}%, ${l.toFixed(1)}%)`,
        bg: `hsla(${h.toFixed(1)}, ${sat.toFixed(1)}%, ${l.toFixed(1)}%, 0.14)`,
    };
}

function getScoreColor(score) {
    return getInterpolatedColor(score).text;
}

function scoreTierLabel(score) {
    if (score >= 900) return 'Radiant';
    if (score >= 750) return 'Elite';
    if (score >= 600) return 'Strong';
    if (score >= 450) return 'Average';
    if (score >= 300) return 'Below avg';
    return 'Struggle';
}

function animateCount(el, target, duration = 700) {
    const start = performance.now();
    const from = 0;
    const isSvg = el instanceof SVGElement;
    const update = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(from + (target - from) * eased);
        el.textContent = current;
        const colors = getInterpolatedColor(current);
        if (isSvg) {
            el.setAttribute('fill', colors.text);
        } else {
            el.style.color = colors.text;
            if (el.classList.contains('score-chip') || el.classList.contains('ring-value')) {
                if (el.classList.contains('score-chip')) el.style.background = colors.bg;
            }
        }
        if (progress < 1) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
}

/* ── Recent searches ───────────────────────────────────────────────────────── */
function loadRecent() {
    try {
        return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    } catch {
        return [];
    }
}

function saveRecent(name, tag) {
    let list = loadRecent().filter(
        (r) => !(r.name.toLowerCase() === name.toLowerCase() && r.tag.toLowerCase() === tag.toLowerCase())
    );
    list.unshift({ name, tag, at: Date.now() });
    list = list.slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    renderRecent();
}

function renderRecent() {
    const wrap = document.getElementById('recentSearches');
    const chips = document.getElementById('recentChips');
    const list = loadRecent();
    if (!list.length) {
        wrap.classList.add('hidden');
        return;
    }
    wrap.classList.remove('hidden');
    chips.innerHTML = list
        .map(
            (r) => `
        <button type="button" class="recent-chip" data-name="${escapeHtml(r.name)}" data-tag="${escapeHtml(r.tag)}">
            ${escapeHtml(r.name)}<span class="chip-tag">#${escapeHtml(r.tag)}</span>
        </button>`
        )
        .join('');
    chips.querySelectorAll('.recent-chip').forEach((btn) => {
        btn.addEventListener('click', () => {
            usernameInput.value = btn.dataset.name;
            tagInput.value = btn.dataset.tag;
            syncCombinedFromSplit();
            startSearch(btn.dataset.name, btn.dataset.tag);
        });
    });
}

document.getElementById('clearRecent').addEventListener('click', () => {
    localStorage.removeItem(RECENT_KEY);
    renderRecent();
});

/* ── URL share state ───────────────────────────────────────────────────────── */
function updateUrl(name, tag) {
    const id = `${name}#${tag}`;
    const url = new URL(window.location.href);
    url.searchParams.set('id', id);
    history.replaceState(null, '', url);
}

function readUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id') || params.get('player');
    if (id) {
        const parsed = parseRiotId(id);
        if (parsed) return parsed;
    }
    const name = params.get('name') || params.get('username');
    const tag = params.get('tag');
    if (name && tag) return { name, tag };
    return null;
}

/* ── Help modal ────────────────────────────────────────────────────────────── */
const helpModal = document.getElementById('helpModal');
document.getElementById('helpBtn').addEventListener('click', () => helpModal.classList.remove('hidden'));
document.getElementById('helpClose').addEventListener('click', () => helpModal.classList.add('hidden'));
helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) helpModal.classList.add('hidden');
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') helpModal.classList.add('hidden');
});

document.getElementById('brandHome').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* ── Search submit ─────────────────────────────────────────────────────────── */
searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    syncRiotFieldsFromCombined();
    syncCombinedFromSplit();

    let name = usernameInput.value.trim();
    let tag = tagInput.value.trim();

    if ((!name || !tag) && riotIdInput.value.trim()) {
        const parsed = parseRiotId(riotIdInput.value);
        if (parsed) {
            name = parsed.name;
            tag = parsed.tag;
            usernameInput.value = name;
            tagInput.value = tag;
        }
    }

    if (!name || !tag) {
        showError('Enter a Riot ID like Name#TAG (both name and tag required).');
        return;
    }

    startSearch(name, tag);
});

function startSearch(name, tag) {
    currentUsername = name;
    currentTag = tag;
    currentPage = 1;
    allLoadedMatches = [];
    currentTargetPuuid = null;

    document.getElementById('matchList').innerHTML = '';
    document.getElementById('resultState').classList.add('hidden');
    document.getElementById('profileState').classList.add('hidden');
    document.getElementById('analyticsState').classList.add('hidden');
    document.getElementById('loadMoreBtn').classList.add('hidden');
    document.getElementById('noMoreMatches').classList.add('hidden');
    featureStrip.classList.add('hidden');
    searchHero.classList.add('hidden');
    hideError();

    usernameInput.value = name;
    tagInput.value = tag;
    syncCombinedFromSplit();
    updateUrl(name, tag);
    saveRecent(name, tag);

    fetchMatches();
}

document.getElementById('loadMoreBtn').addEventListener('click', () => {
    currentPage++;
    fetchMatches();
});

/* ── Fetch matches ─────────────────────────────────────────────────────────── */
async function fetchMatches() {
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    hideError();
    setLoading(true);

    if (currentPage > 1) {
        loadMoreBtn.querySelector('span').textContent = 'Loading…';
        loadMoreBtn.disabled = true;
    }

    try {
        const response = await fetch('/api/calculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: currentUsername,
                tag: currentTag,
                page: currentPage,
            }),
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || `Server error ${response.status}`);
        }

        if (data.account && currentPage === 1) {
            hydrateProfileShell(data.account);
        }

        if (data.matches && data.matches.length > 0) {
            currentTargetPuuid = data.target_puuid;
            allLoadedMatches.push(...data.matches);
            renderMatches(allLoadedMatches, data.target_puuid);
            document.getElementById('resultState').classList.remove('hidden');
            document.getElementById('matchCountLabel').textContent =
                `${allLoadedMatches.length} loaded`;

            if (data.matches.length < 5) {
                loadMoreBtn.classList.add('hidden');
                document.getElementById('noMoreMatches').classList.remove('hidden');
            } else {
                loadMoreBtn.classList.remove('hidden');
                document.getElementById('noMoreMatches').classList.add('hidden');
            }

            if (currentPage === 1) {
                const profile = document.getElementById('profileState');
                profile.classList.remove('hidden');
                profile.classList.add('loading');
                fetchPerformance();
            }
        } else {
            loadMoreBtn.classList.add('hidden');
            if (currentPage > 1) {
                document.getElementById('noMoreMatches').classList.remove('hidden');
            } else {
                showError('No competitive matches found for this account.');
                document.getElementById('profileState').classList.add('hidden');
                featureStrip.classList.remove('hidden');
                searchHero.classList.remove('hidden');
            }
        }
    } catch (err) {
        showError(err.message || 'Something went wrong.');
        if (currentPage === 1) {
            featureStrip.classList.remove('hidden');
            searchHero.classList.remove('hidden');
            document.getElementById('profileState').classList.add('hidden');
        }
    } finally {
        setLoading(false);
        loadMoreBtn.querySelector('span').textContent = 'Load more matches';
        loadMoreBtn.disabled = false;
    }
}

function hydrateProfileShell(account) {
    const profile = document.getElementById('profileState');
    profile.classList.remove('hidden');

    document.getElementById('profileName').textContent = account.name || currentUsername;
    document.getElementById('profileTag').textContent = `#${account.tag || currentTag}`;
    document.getElementById('profileRegion').textContent = (account.region || '—').toUpperCase();
    document.getElementById('profileLevel').textContent = account.account_level ?? '—';

    const img = document.getElementById('profileCard');
    img.onerror = () => {
        img.onerror = null;
        img.src = 'data:image/svg+xml,' + encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect fill="#1c2538" width="72" height="72"/><text x="36" y="42" text-anchor="middle" fill="#8b96a8" font-family="sans-serif" font-size="18" font-weight="700">${escapeHtml((account.name || '?')[0] || '?').toUpperCase()}</text></svg>`
        );
    };
    if (account.card_small) {
        img.src = account.card_small;
        img.alt = `${account.name || 'Player'} card`;
    } else {
        img.onerror();
        img.alt = '';
    }
}

/* ── Performance ───────────────────────────────────────────────────────────── */
async function fetchPerformance() {
    const profile = document.getElementById('profileState');
    try {
        const response = await fetch('/api/performance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUsername, tag: currentTag }),
        });

        if (!response.ok) {
            profile.classList.remove('loading');
            return;
        }

        const data = await response.json();

        if (data.account) hydrateProfileShell(data.account);

        document.getElementById('profileMatches').textContent =
            `${data.matches_analyzed} matches`;

        document.getElementById('perfAcs').textContent = data.average_acs;
        document.getElementById('perfKda').textContent =
            `${data.average_kills}/${data.average_deaths}/${data.average_assists}`;
        document.getElementById('perfClutch').textContent = data.total_clutches;
        document.getElementById('perfFbfd').textContent =
            `${data.total_first_bloods} / ${data.total_first_deaths}`;

        const wr = data.winrate ?? 0;
        const wrEl = document.getElementById('perfWr');
        wrEl.textContent = `${wr}%`;
        wrEl.style.color = wr >= 55 ? 'var(--win)' : wr >= 45 ? 'var(--mid)' : 'var(--loss)';

        const kd = data.kd_ratio ?? 0;
        const kdEl = document.getElementById('perfKd');
        kdEl.textContent = Number(kd).toFixed(2);
        kdEl.style.color = kd >= 1.1 ? 'var(--win)' : kd >= 0.9 ? 'var(--mid)' : 'var(--loss)';

        document.getElementById('perfHs').textContent =
            data.headshot_pct != null ? `${data.headshot_pct}%` : '—';
        document.getElementById('perfAdr').textContent =
            data.average_adr != null ? data.average_adr : '—';

        const tier = document.getElementById('scoreTier');
        tier.textContent = scoreTierLabel(data.average_score);
        tier.style.color = getScoreColor(data.average_score);

        const circle = document.getElementById('perfCircle');
        const text = document.getElementById('perfScoreText');
        animateCount(text, data.average_score, 1000);
        const pct = Math.min(100, Math.max(0, data.average_score / 10));
        circle.style.stroke = getScoreColor(data.average_score);
        circle.style.strokeDasharray = `${pct}, 100`;

        // Form streak (most recent first)
        const formEl = document.getElementById('formStreak');
        const form = data.form || [];
        if (form.length) {
            formEl.innerHTML = form
                .map((r) => `<span class="form-pip ${r === 'W' ? 'w' : 'l'}" title="${r === 'W' ? 'Win' : 'Loss'}">${r}</span>`)
                .join('');
            formEl.classList.remove('hidden');
        } else {
            formEl.innerHTML = '';
        }

        if (data.history && data.history.length > 0) {
            document.getElementById('analyticsState').classList.remove('hidden');
            lastHistory = data.history;
            renderTrendChart(data.history);
            renderAgentMapAnalytics(data.agent_performance, data.map_performance);
        }
    } catch (e) {
        console.error('Performance fetch error:', e);
    } finally {
        profile.classList.remove('loading');
    }
}

/* ── Charts ────────────────────────────────────────────────────────────────── */
function renderTrendChart(history) {
    const canvas = document.getElementById('trendChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');

    if (trendChartInstance) {
        trendChartInstance.destroy();
        trendChartInstance = null;
    }

    const scores = history.map((h) => h.score);
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

    const labels = tempLabels.map((item) => {
        const total = history.filter((h) => {
            const d = h.date ? new Date(h.date * 1000) : null;
            return d && `${d.getDate()}/${d.getMonth() + 1}` === item.dateStr;
        }).length;
        return total > 1 ? `${item.dateStr} (#${item.count})` : item.dateStr;
    });

    const rollingAvg = scores.map((_, i) => {
        const window = scores.slice(Math.max(0, i - 4), i + 1);
        return Math.round(window.reduce((a, b) => a + b, 0) / window.length);
    });

    const theme = html.getAttribute('data-theme') || 'dark';
    const gridColor = theme === 'light' ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.05)';
    const midGrid = theme === 'light' ? 'rgba(15,23,42,0.14)' : 'rgba(255,255,255,0.14)';
    const tickColor = theme === 'light' ? '#64748b' : '#6a6a7a';
    const tipBg = theme === 'light' ? 'rgba(255,255,255,0.96)' : 'rgba(10,10,14,0.94)';
    const tipTitle = theme === 'light' ? '#0f172a' : '#e5e5e5';
    const tipBody = theme === 'light' ? '#64748b' : '#a0a0b0';

    const gradient = ctx.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, 'rgba(255, 70, 85, 0.28)');
    gradient.addColorStop(0.55, 'rgba(255, 70, 85, 0.06)');
    gradient.addColorStop(1, 'rgba(255, 70, 85, 0)');

    trendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Score',
                    data: scores,
                    borderColor: '#ff4655',
                    backgroundColor: gradient,
                    borderWidth: 2.5,
                    pointBackgroundColor: scores.map((s) => getScoreColor(s)),
                    pointBorderColor: theme === 'light' ? '#fff' : '#111',
                    pointBorderWidth: 1.5,
                    pointRadius: 5,
                    pointHoverRadius: 8,
                    fill: true,
                    tension: 0.35,
                    order: 1,
                },
                {
                    label: 'Trend',
                    data: rollingAvg,
                    borderColor: 'rgba(130, 130, 160, 0.55)',
                    borderWidth: 1.5,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    fill: false,
                    tension: 0.4,
                    order: 2,
                },
            ],
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
                    backgroundColor: tipBg,
                    borderColor: 'rgba(128,128,128,0.2)',
                    borderWidth: 1,
                    titleColor: tipTitle,
                    bodyColor: tipBody,
                    titleFont: { family: 'Inter', size: 12, weight: 'bold' },
                    bodyFont: { family: 'Inter', size: 11 },
                    padding: 14,
                    cornerRadius: 10,
                    callbacks: {
                        title(items) {
                            const h = history[items[0].dataIndex];
                            return `${h.agent}  ·  ${h.map}`;
                        },
                        label(context) {
                            const h = history[context.dataIndex];
                            if (context.datasetIndex === 0) {
                                return `  Score: ${h.score}    ACS: ${h.acs}${h.won != null ? (h.won ? '    W' : '    L') : ''}`;
                            }
                            return `  5-match avg: ${context.parsed.y}`;
                        },
                    },
                },
            },
            interaction: { mode: 'index', axis: 'x', intersect: false },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { color: tickColor, font: { family: 'Inter', size: 10 }, maxRotation: 0 },
                },
                y: {
                    min: 0,
                    max: 1000,
                    grid: {
                        color: (ctx) => (ctx.tick.value === 500 ? midGrid : gridColor),
                        lineWidth: (ctx) => (ctx.tick.value === 500 ? 1.5 : 1),
                    },
                    border: { display: false },
                    ticks: {
                        color: tickColor,
                        font: { family: 'Inter', size: 10 },
                        stepSize: 200,
                    },
                },
            },
        },
    });
}

function renderAgentMapAnalytics(agents, maps) {
    const agentList = document.getElementById('agentAnalyticsList');
    const mapList = document.getElementById('mapAnalyticsList');
    agentList.innerHTML = '';
    mapList.innerHTML = '';

    if (!agents || !agents.length) {
        agentList.innerHTML = '<div class="empty-analytics">No agent history yet.</div>';
    } else {
        agents.slice(0, 5).forEach((a) => {
            const item = document.createElement('div');
            item.className = 'analytics-item';
            const width = Math.min(100, Math.max(0, a.average_score / 10));
            const color = getScoreColor(a.average_score);
            const wrColor = a.winrate >= 60 ? 'var(--win)' : a.winrate >= 45 ? 'var(--mid)' : 'var(--loss)';
            const wrBg = a.winrate >= 60 ? 'var(--win-bg)' : a.winrate >= 45 ? 'var(--mid-bg)' : 'var(--loss-bg)';
            const icon = agentIconUrl(a.agent);
            item.innerHTML = `
                <div class="analytics-item-header">
                    <span class="analytics-item-name">
                        ${icon ? `<img class="agent-mini" src="${icon}" alt="" loading="lazy">` : ''}
                        ${escapeHtml(a.agent)}
                        <span style="font-size:10px;color:var(--text-muted);font-weight:400">(${a.matches})</span>
                    </span>
                    <span class="analytics-item-score" style="color:${color}">${a.average_score}</span>
                </div>
                <div class="analytics-item-stats">
                    <span class="winrate-badge" style="color:${wrColor};background:${wrBg}">WR ${a.winrate}%</span>
                    <span>K/D/A ${(a.kills / a.matches).toFixed(1)} / ${(a.deaths / a.matches).toFixed(1)} / ${(a.assists / a.matches).toFixed(1)}</span>
                </div>
                <div class="analytics-bar-bg"><div class="analytics-bar-fill" style="background:${color}"></div></div>
            `;
            agentList.appendChild(item);
            requestAnimationFrame(() => {
                const fill = item.querySelector('.analytics-bar-fill');
                if (fill) fill.style.width = width + '%';
            });
        });
    }

    if (!maps || !maps.length) {
        mapList.innerHTML = '<div class="empty-analytics">No map history yet.</div>';
    } else {
        maps.slice(0, 5).forEach((m) => {
            const item = document.createElement('div');
            item.className = 'analytics-item';
            const width = Math.min(100, Math.max(0, m.average_score / 10));
            const color = getScoreColor(m.average_score);
            const wrColor = m.winrate >= 60 ? 'var(--win)' : m.winrate >= 45 ? 'var(--mid)' : 'var(--loss)';
            const wrBg = m.winrate >= 60 ? 'var(--win-bg)' : m.winrate >= 45 ? 'var(--mid-bg)' : 'var(--loss-bg)';
            item.innerHTML = `
                <div class="analytics-item-header">
                    <span class="analytics-item-name">
                        ${escapeHtml(m.map)}
                        <span style="font-size:10px;color:var(--text-muted);font-weight:400">(${m.matches})</span>
                    </span>
                    <span class="analytics-item-score" style="color:${color}">${m.average_score}</span>
                </div>
                <div class="analytics-item-stats">
                    <span class="winrate-badge" style="color:${wrColor};background:${wrBg}">WR ${m.winrate}%</span>
                </div>
                <div class="analytics-bar-bg"><div class="analytics-bar-fill" style="background:${color}"></div></div>
            `;
            mapList.appendChild(item);
            requestAnimationFrame(() => {
                const fill = item.querySelector('.analytics-bar-fill');
                if (fill) fill.style.width = width + '%';
            });
        });
    }
}

/* ── Match render ──────────────────────────────────────────────────────────── */
function renderMatches(matches, targetPuuid) {
    const matchList = document.getElementById('matchList');
    matchList.innerHTML = '';

    const dateGroups = {};
    const uniqueDates = [];

    matches.forEach((match) => {
        const dateStr = getMatchDateString(match.game_start);
        if (!dateGroups[dateStr]) {
            dateGroups[dateStr] = [];
            uniqueDates.push(dateStr);
        }
        dateGroups[dateStr].push(match);
    });

    uniqueDates.forEach((dateStr) => {
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.innerHTML = `
            <div class="date-divider-dot"></div>
            <span class="date-divider-label">${escapeHtml(dateStr)}</span>
            <div class="date-divider-line"></div>
        `;
        matchList.appendChild(divider);

        dateGroups[dateStr].forEach((match) => {
            const target = match.target_player;
            const score = match.performance.final_score;

            let targetTeam = target.team;
            let roundsWon = 0;
            let roundsLost = 0;
            if (match.performance && match.performance.round_scores) {
                match.performance.round_scores.forEach((sr) => {
                    if (sr.winning_team === targetTeam) roundsWon++;
                    else roundsLost++;
                });
            }
            // Prefer teams API if available from backend
            if (match.rounds_won != null && match.rounds_lost != null) {
                roundsWon = match.rounds_won;
                roundsLost = match.rounds_lost;
            }
            const isMatchWon = match.has_won != null ? match.has_won : roundsWon > roundsLost;
            const matchOutcomeText = isMatchWon ? 'WIN' : 'LOSS';
            const matchOutcomeClass = isMatchWon ? 'win' : 'lost';
            const scoreSummary = `${roundsWon}-${roundsLost}`;

            const card = document.createElement('div');
            card.className = `match-card ${matchOutcomeClass}`;

            let maxClutchSize = 0;
            const multikills = { 5: 0, 4: 0, 3: 0 };
            if (match.performance && match.performance.round_scores) {
                match.performance.round_scores.forEach((sr) => {
                    const killsInRound = sr.details ? sr.details.length : 0;
                    if (killsInRound >= 5) multikills[5]++;
                    else if (killsInRound === 4) multikills[4]++;
                    else if (killsInRound === 3) multikills[3]++;
                    if (sr.details) {
                        sr.details.forEach((d) => {
                            if (d.reason && d.reason.includes('clutch')) {
                                const m = d.reason.match(/1v(\d+)/);
                                if (m) maxClutchSize = Math.max(maxClutchSize, parseInt(m[1], 10));
                                else if (maxClutchSize === 0) maxClutchSize = 1;
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
            if (highlightsHtml) highlightsHtml = `<div class="match-highlights">${highlightsHtml}</div>`;

            const rankIndex = match.scoreboard.findIndex((p) => p.puuid === targetPuuid);
            const rank = rankIndex !== -1 ? rankIndex + 1 : 10;
            let rankText = `${rank}th`;
            let rankClass = 'rank-other';
            if (rank === 1) {
                rankText = 'MVP';
                rankClass = 'rank-1';
            } else if (rank === 2) {
                rankText = '2nd';
                rankClass = 'rank-2';
            } else if (rank === 3) {
                rankText = '3rd';
                rankClass = 'rank-3';
            }

            const icon = agentIconUrl(target.agent);
            const header = document.createElement('div');
            header.className = 'match-header';
            header.innerHTML = `
                <div class="match-left">
                    ${icon ? `<img class="agent-thumb" src="${icon}" alt="${escapeHtml(target.agent || '')}" loading="lazy">` : '<div class="agent-thumb"></div>'}
                    <div class="match-info">
                        <div class="match-map-line">
                            ${escapeHtml(match.map || 'UNKNOWN')}
                            <span class="rank-badge ${rankClass}">${rankText}</span>
                            <span class="match-agent">${escapeHtml(target.agent || 'Unknown')}</span>
                        </div>
                        <div class="match-meta-line">
                            <span>${escapeHtml(match.mode || 'Competitive')}</span>
                            <span class="sep">//</span>
                            <span class="outcome-text ${matchOutcomeClass}">${matchOutcomeText} ${scoreSummary}</span>
                        </div>
                        ${highlightsHtml}
                    </div>
                </div>
                <div class="match-header-right">
                    <span class="score-chip" data-target-score="${score}">0</span>
                    <span class="chevron">›</span>
                </div>
            `;

            const details = document.createElement('div');
            details.className = 'match-details';

            const teams = {};
            match.scoreboard.forEach((p) => {
                const teamName = p.team || 'UNKNOWN';
                if (!teams[teamName]) teams[teamName] = [];
                teams[teamName].push(p);
            });
            for (const teamName in teams) {
                teams[teamName].sort((a, b) => b.final_score - a.final_score);
            }

            let scoreboardHtml = '';
            for (const [teamName, players] of Object.entries(teams)) {
                const teamClass =
                    teamName.toLowerCase() === 'red'
                        ? 'red'
                        : teamName.toLowerCase() === 'blue'
                          ? 'blue'
                          : 'other';
                let rowsHtml = '';
                players.forEach((p) => {
                    const isTarget = p.puuid === targetPuuid;
                    const stats = p.stats || {};
                    const totalRounds = match.performance.total_rounds || 1;
                    const acs = stats.score ? Math.round(stats.score / totalRounds) : 0;
                    const kills = stats.kills || 0;
                    const deaths = stats.deaths || 0;
                    const assists = stats.assists || 0;
                    const colors = getInterpolatedColor(p.final_score);
                    const aIcon = agentIconUrl(p.agent);
                    rowsHtml += `
                        <tr class="${isTarget ? 'scoreboard-row-target' : ''}">
                            <td>
                                <div class="agent-cell">
                                    ${aIcon ? `<img src="${aIcon}" alt="" loading="lazy">` : ''}
                                    <span>${escapeHtml(p.agent || 'N/A')}</span>
                                </div>
                            </td>
                            <td>
                                <span class="clickable-player" data-name="${escapeHtml(p.name)}" data-tag="${escapeHtml(p.tag)}">
                                    <span class="player-name">${escapeHtml(p.name)}</span>
                                    <span class="player-tag">#${escapeHtml(p.tag)}</span>
                                </span>
                            </td>
                            <td>${acs}</td>
                            <td class="kda-cell">${kills}/${deaths}/${assists}</td>
                            <td><span class="score-chip" style="color:${colors.text};background:${colors.bg}">${p.final_score}</span></td>
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
                                    <th style="width:22%">Agent</th>
                                    <th style="width:32%">Player</th>
                                    <th style="width:12%">ACS</th>
                                    <th style="width:18%">K/D/A</th>
                                    <th style="width:16%">Score</th>
                                </tr>
                            </thead>
                            <tbody>${rowsHtml}</tbody>
                        </table>
                    </div>
                `;
            }

            const nameLookup = {};
            match.scoreboard.forEach((p) => {
                nameLookup[p.puuid] = { name: p.name, tag: p.tag };
            });

            let roundsHtml = '';
            if (match.performance && match.performance.round_scores) {
                match.performance.round_scores.forEach((sr) => {
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
                                <div class="round-event-desc">Secured <span class="event-highlight">First Blood</span> <span class="event-pts">(+${sr.first_blood_bonus.toFixed(1)})</span></div>
                            </div>`;
                    }
                    if (sr.first_death_penalty > 0) {
                        eventItems += `
                            <div class="round-event-item fd">
                                <div class="round-event-bullet"></div>
                                <div class="round-event-desc">Conceded <span class="event-highlight">First Death</span> <span class="event-pts">(-${sr.first_death_penalty.toFixed(1)})</span></div>
                            </div>`;
                    }
                    if (sr.details && sr.details.length > 0) {
                        sr.details.forEach((d) => {
                            const victimInfo = nameLookup[d.victim_puuid];
                            const victimName = victimInfo
                                ? `${escapeHtml(victimInfo.name)}#${escapeHtml(victimInfo.tag)}`
                                : 'Unknown';
                            let reasonStr = '';
                            if (d.reason && d.reason.includes('clutch')) {
                                const m = d.reason.match(/1v(\d+)/);
                                const suffix = m ? `1v${m[1]} ` : '';
                                reasonStr = ` — <span class="event-clutch">${suffix}CLUTCH (+${(d.clutch_bonus_points || 0).toFixed(1)})</span>`;
                            } else if (d.reason && d.reason.includes('eco damage')) {
                                reasonStr = ` — <span class="event-eco">ECO DAMAGE</span>`;
                            }
                            eventItems += `
                                <div class="round-event-item">
                                    <div class="round-event-bullet"></div>
                                    <div class="round-event-desc">Killed <span class="event-highlight">${victimName}</span> <span class="event-pts">(+${d.kill_points.toFixed(1)})</span>${reasonStr}</div>
                                </div>`;
                        });
                    }
                    if (sr.damage_score && sr.damage_score > 0) {
                        eventItems += `
                            <div class="round-event-item dmg">
                                <div class="round-event-bullet"></div>
                                <div class="round-event-desc">Assist damage <span class="event-pts">(+${sr.damage_score.toFixed(1)})</span></div>
                            </div>`;
                    }
                    if (!eventItems) {
                        eventItems = `
                            <div class="round-event-item">
                                <div class="round-event-bullet"></div>
                                <div class="round-event-desc" style="color:var(--text-muted)">No target interactions this round.</div>
                            </div>`;
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
                            <div class="rounds-events-list round-events-list">${eventItems}</div>
                        </div>`;
                });
            }

            let mathKills = 0,
                mathClutches = 0,
                mathFB = 0,
                mathFD = 0,
                mathDmg = 0;
            if (match.performance && match.performance.round_scores) {
                match.performance.round_scores.forEach((sr) => {
                    mathKills += sr.kills_score || 0;
                    mathClutches += sr.clutch_bonus || 0;
                    mathFB += sr.first_blood_bonus || 0;
                    mathFD += sr.first_death_penalty || 0;
                    mathDmg += sr.damage_score || 0;
                });
            }
            const mathTotal = mathKills + mathClutches + mathFB - mathFD + mathDmg;
            const mathRounds = match.performance.total_rounds || 1;
            const mathAvg = match.performance.average_round_score || mathTotal / mathRounds;
            const mathCurved = match.performance.final_score;

            details.innerHTML = `
                <div class="match-details-inner">
                    <div class="match-tabs">
                        <button type="button" class="tab-btn active" data-target="scoreboard-${match.match_id}">Scoreboard</button>
                        <button type="button" class="tab-btn" data-target="rounds-${match.match_id}">Rounds</button>
                        <button type="button" class="tab-btn" data-target="math-${match.match_id}">Score Math</button>
                    </div>
                    <div class="tab-content" id="scoreboard-${match.match_id}">
                        <p class="scoreboard-label">Match scoreboard</p>
                        ${scoreboardHtml}
                    </div>
                    <div class="tab-content hidden" id="rounds-${match.match_id}">
                        <p class="scoreboard-label">Round-by-round breakdown</p>
                        <div class="rounds-timeline">${roundsHtml}</div>
                    </div>
                    <div class="tab-content hidden" id="math-${match.match_id}">
                        <p class="scoreboard-label">Score calculation</p>
                        <div class="math-container">
                            <div class="math-breakdown-card">
                                <div class="math-row">
                                    <span class="math-label">Kills (base)
                                        <span class="tooltip-trigger" data-tooltip="Kill points weighted by enemy ACS and eco modifiers."><i class="info-icon">i</i></span>
                                    </span>
                                    <span class="math-value positive">+${mathKills.toFixed(1)}</span>
                                </div>
                                <div class="math-row">
                                    <span class="math-label">Clutch bonus
                                        <span class="tooltip-trigger" data-tooltip="Extra value for kills in clutch 1vN wins."><i class="info-icon">i</i></span>
                                    </span>
                                    <span class="math-value positive">+${mathClutches.toFixed(1)}</span>
                                </div>
                                <div class="math-row">
                                    <span class="math-label">First bloods
                                        <span class="tooltip-trigger" data-tooltip="+25 pts per first blood."><i class="info-icon">i</i></span>
                                    </span>
                                    <span class="math-value positive">+${mathFB.toFixed(1)}</span>
                                </div>
                                <div class="math-row">
                                    <span class="math-label">First deaths
                                        <span class="tooltip-trigger" data-tooltip="-35 pts per first death."><i class="info-icon">i</i></span>
                                    </span>
                                    <span class="math-value negative">-${mathFD.toFixed(1)}</span>
                                </div>
                                <div class="math-row">
                                    <span class="math-label">Assist damage
                                        <span class="tooltip-trigger" data-tooltip="Useful damage on enemies you did not finish."><i class="info-icon">i</i></span>
                                    </span>
                                    <span class="math-value positive">+${mathDmg.toFixed(1)}</span>
                                </div>
                                <div class="math-row divider"></div>
                                <div class="math-row total">
                                    <span class="math-label">Raw match total</span>
                                    <span class="math-value">${mathTotal.toFixed(1)}</span>
                                </div>
                                <div class="math-row formula">
                                    <span class="math-label">Avg round score</span>
                                    <span class="math-value">${mathAvg.toFixed(2)}</span>
                                </div>
                                <div class="math-row final">
                                    <span class="math-label">Performance score</span>
                                    <span class="math-value highlight">${mathCurved} / 1000</span>
                                </div>
                            </div>
                            <div class="math-explanation-card">
                                <h4 class="formula-title">Scoring formula</h4>
                                <div class="formula-math">
                                    <span class="formula-block">Avg = Raw Total / Rounds (${mathRounds})</span>
                                    <span class="formula-block">Score = (Avg / 45.0)<sup>0.98</sup> × 1000</span>
                                </div>
                                <div class="formula-notes">
                                    <p>Round combat is scaled against a 45.0 perfect-round benchmark, then curved into the 0–1000 index.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            header.addEventListener('click', () => {
                const isOpen = card.classList.contains('open');
                card.classList.toggle('open', !isOpen);
                if (!isOpen) {
                    details.style.maxHeight = details.scrollHeight + 'px';
                    card.querySelectorAll('.score-chip[data-target-score]').forEach((chip) => {
                        const targetVal = parseInt(chip.dataset.targetScore, 10);
                        animateCount(chip, targetVal, 500);
                        delete chip.dataset.targetScore;
                    });
                } else {
                    details.style.maxHeight = '0';
                }
            });

            const headerChip = header.querySelector('.score-chip[data-target-score]');
            if (headerChip) {
                setTimeout(() => {
                    const targetVal = parseInt(headerChip.dataset.targetScore, 10);
                    animateCount(headerChip, targetVal, 700);
                    delete headerChip.dataset.targetScore;
                }, 60);
            }

            details.querySelectorAll('.clickable-player').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const name = btn.getAttribute('data-name');
                    const tag = btn.getAttribute('data-tag');
                    if (name && tag) {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                        startSearch(name, tag);
                    }
                });
            });

            const tabButtons = details.querySelectorAll('.tab-btn');
            tabButtons.forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const targetId = btn.getAttribute('data-target');
                    tabButtons.forEach((b) => b.classList.remove('active'));
                    btn.classList.add('active');
                    details.querySelectorAll('.tab-content').forEach((tc) => {
                        tc.classList.toggle('hidden', tc.id !== targetId);
                    });
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

/* ── Boot ──────────────────────────────────────────────────────────────────── */
renderRecent();

const fromUrl = readUrlParams();
if (fromUrl) {
    usernameInput.value = fromUrl.name;
    tagInput.value = fromUrl.tag;
    syncCombinedFromSplit();
    startSearch(fromUrl.name, fromUrl.tag);
}
