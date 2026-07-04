let currentPage = 1;
let currentUsername = "";
let currentTag = "";
let allLoadedMatches = [];

document.getElementById('calcBtn').addEventListener('click', () => {
    currentUsername = document.getElementById('username').value.trim();
    currentTag = document.getElementById('tag').value.trim();
    
    if (!currentUsername || !currentTag) {
        showError("ERROR: Please fill out both Username and Tag fields.");
        return;
    }
    
    currentPage = 1;
    allLoadedMatches = [];
    document.getElementById('matchList').innerHTML = ""; // Clear existing matches
    document.getElementById('resultState').classList.add('hidden');
    document.getElementById('loadMoreBtn').classList.add('hidden');
    
    fetchMatches();
});

document.getElementById('loadMoreBtn').addEventListener('click', () => {
    currentPage++;
    fetchMatches();
});

function showError(msg) {
    const errorCard = document.getElementById('errorState');
    errorCard.innerText = msg;
    errorCard.classList.remove('hidden');
}

function getMatchDateString(gameStart) {
    if (!gameStart) return "UNKNOWN DATE";
    // Check if seconds or milliseconds
    const date = new Date(gameStart < 99999999999 ? gameStart * 1000 : gameStart);
    const options = { month: 'long', day: 'numeric', year: 'numeric' };
    return date.toLocaleDateString('en-US', options).toUpperCase();
}

async function fetchMatches() {
    const errorCard = document.getElementById('errorState');
    const resultCard = document.getElementById('resultState');
    const btn = document.getElementById('calcBtn');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    
    errorCard.classList.add('hidden');
    btn.innerText = "PROCESSING RETRIEVAL...";
    btn.disabled = true;
    if (currentPage > 1) {
        loadMoreBtn.innerText = "LOADING...";
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
        showError(`EXECUTION FAILED: ${err.message}`);
    } finally {
        btn.innerText = "ANALYSE MATCH PERFORMANCE";
        btn.disabled = false;
        loadMoreBtn.innerText = "LOAD MORE MATCHES";
        loadMoreBtn.disabled = false;
    }
}

function renderMatches(matches, targetPuuid) {
    const matchList = document.getElementById('matchList');
    matchList.innerHTML = ""; // Reset HTML list

    // Group matches by date string
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

    // Render grouped layout
    uniqueDates.forEach(dateStr => {
        // Render Date Category Header
        const dateHeader = document.createElement('div');
        dateHeader.className = "date-category-header";
        dateHeader.style = "color: var(--v-red); font-size: 12px; font-weight: bold; margin: 30px 0 15px 0; border-bottom: 1px solid var(--border-grey); padding-bottom: 6px; letter-spacing: 1px;";
        dateHeader.innerText = dateStr;
        matchList.appendChild(dateHeader);

        const groupMatches = dateGroups[dateStr];
        groupMatches.forEach(match => {
            const card = document.createElement('div');
            card.className = "match-card";
            
            // Target player summary
            const target = match.target_player;
            const score = match.performance.final_score;
            
            // Header
            const header = document.createElement('div');
            header.className = "match-header";
            header.innerHTML = `
                <div class="match-info">
                    <span class="match-map">${match.map || 'UNKNOWN'} <span style="color:#767676; font-size:12px;">// ${target.agent || 'Unknown'}</span></span>
                    <span class="match-mode">${match.mode || 'Unknown Mode'}</span>
                </div>
                <div class="match-score-summary">
                    <span class="match-score-num" style="color: ${score >= 600 ? '#4caf50' : (score >= 400 ? '#ffb300' : '#ff4655')}">${score}</span>
                    <span style="font-size: 11px; color: var(--text-muted);">/ 1000</span>
                </div>
            `;
            
            // Details (Hidden by default)
            const details = document.createElement('div');
            details.className = "match-details hidden";
            
            // Group Scoreboard by Team
            const teams = {};
            match.scoreboard.forEach(p => {
                const teamName = p.team || 'UNKNOWN TEAM';
                if (!teams[teamName]) {
                    teams[teamName] = [];
                }
                teams[teamName].push(p);
            });

            // Sort players in each team by performance score (descending)
            for (const teamName in teams) {
                teams[teamName].sort((a, b) => b.final_score - a.final_score);
            }

            let scoreboardHtml = "";
            for (const [teamName, players] of Object.entries(teams)) {
                const isRed = teamName.toLowerCase() === 'red';
                const isBlue = teamName.toLowerCase() === 'blue';
                const teamColor = isRed ? '#ff4655' : (isBlue ? '#1180e6' : 'var(--text-muted)');
                
                let rowsHtml = "";
                players.forEach(p => {
                    const isTarget = p.puuid === targetPuuid;
                    const stats = p.stats || {};
                    const acs = stats.score ? Math.round(stats.score / match.performance.total_rounds) : 0;
                    const kills = stats.kills || 0;
                    const deaths = stats.deaths || 0;
                    const assists = stats.assists || 0;
                    
                    rowsHtml += `
                        <tr class="${isTarget ? 'scoreboard-row-target' : ''}">
                            <td class="agent-col">${p.agent || 'N/A'}</td>
                            <td>${p.name}#${p.tag}</td>
                            <td>${acs} ACS</td>
                            <td>${kills}/${deaths}/${assists}</td>
                            <td style="font-weight: bold; color: ${p.final_score >= 600 ? '#4caf50' : (p.final_score >= 400 ? '#ffb300' : '#ff4655')}">${p.final_score}</td>
                        </tr>
                    `;
                });
                
                scoreboardHtml += `
                    <div class="team-section" style="margin-top: 15px;">
                        <h4 style="font-size: 11px; color: ${teamColor}; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #222; padding-bottom: 3px;">TEAM ${teamName}</h4>
                        <table class="scoreboard-table" style="margin-top: 5px; margin-bottom: 15px;">
                            <thead>
                                <tr>
                                    <th style="width: 15%;">AGENT</th>
                                    <th style="width: 35%;">PLAYER</th>
                                    <th style="width: 15%;">ACS</th>
                                    <th style="width: 20%;">K/D/A</th>
                                    <th style="width: 15%;">SCORE</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml}
                            </tbody>
                        </table>
                    </div>
                `;
            }
            
            details.innerHTML = `
                <h3 style="font-size: 11px; color: var(--text-muted); margin-bottom: 10px; letter-spacing: 1px; text-transform: uppercase;">MATCH SCOREBOARD</h3>
                ${scoreboardHtml}
            `;
            
            header.addEventListener('click', () => {
                details.classList.toggle('hidden');
            });
            
            card.appendChild(header);
            card.appendChild(details);
            matchList.appendChild(card);
        });
    });
}