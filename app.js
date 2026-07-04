let currentPage = 1;
let currentUsername = "";
let currentTag = "";

document.getElementById('calcBtn').addEventListener('click', () => {
    currentUsername = document.getElementById('username').value.trim();
    currentTag = document.getElementById('tag').value.trim();
    
    if (!currentUsername || !currentTag) {
        showError("ERROR: Please fill out both Username and Tag fields.");
        return;
    }
    
    currentPage = 1;
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

        renderMatches(data.matches, data.target_puuid);
        
        resultCard.classList.remove('hidden');
        if (data.matches.length >= 5) {
            loadMoreBtn.classList.remove('hidden');
        } else {
            loadMoreBtn.classList.add('hidden'); // No more matches to load
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
    
    matches.forEach(match => {
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
        
        // Build Scoreboard
        let rowsHtml = "";
        match.scoreboard.forEach(p => {
            const isTarget = p.puuid === targetPuuid;
            
            // Format stats cleanly
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
        
        details.innerHTML = `
            <h3 style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px; letter-spacing: 1px;">MATCH SCOREBOARD (CLICK TO COLLAPSE)</h3>
            <table class="scoreboard-table">
                <thead>
                    <tr>
                        <th>AGENT</th>
                        <th>PLAYER</th>
                        <th>ACS</th>
                        <th>K/D/A</th>
                        <th>PERF SCORE</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        `;
        
        header.addEventListener('click', () => {
            details.classList.toggle('hidden');
        });
        details.addEventListener('click', () => {
            details.classList.add('hidden');
        });
        
        card.appendChild(header);
        card.appendChild(details);
        matchList.appendChild(card);
    });
}