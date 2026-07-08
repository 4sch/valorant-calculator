document.getElementById('calcBtn').addEventListener('click', async () => {
    const matchId = document.getElementById('matchId').value.trim();
    const puuid = document.getElementById('puuid').value.trim();
    
    const errorCard = document.getElementById('errorState');
    const resultCard = document.getElementById('resultState');
    const btn = document.getElementById('calcBtn');

    errorCard.classList.add('hidden');
    resultCard.classList.add('hidden');

    if (!matchId || !puuid) {
        errorCard.innerText = "ERROR: Please fill out both Match ID and Player PUUID fields.";
        errorCard.classList.remove('hidden');
        return;
    }

    btn.innerText = "PROCESSING RETRIEVAL LOOP...";
    btn.disabled = true;

    try {
        // Points directly to the serverless function file inside your api directory
        const response = await fetch('/api/calculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ match_id: matchId, puuid: puuid })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `Server returned error status ${response.status}`);
        }

        // Render metrics to UI layout
        document.getElementById('finalScore').innerText = data.final_score;
        document.getElementById('avgRoundScore').innerText = data.average_round_score;
        document.getElementById('totalRounds').innerText = data.total_rounds;

        const logsContainer = document.getElementById('roundsLog');
        logsContainer.innerHTML = "";

        data.round_scores.forEach(round => {
            const row = document.createElement('div');
            row.className = "round-row";
            row.innerHTML = `
                <span class="round-num-label">ROUND ${String(round.round_num).padStart(2, '0')}</span>
                <span class="round-score-val">${round.round_score.toFixed(1)} pts</span>
            `;
            logsContainer.appendChild(row);
        });

        resultCard.classList.remove('hidden');

    } catch (err) {
        errorCard.innerText = `EXECUTION FAILED: ${err.message}`;
        errorCard.classList.remove('hidden');
    } finally {
        btn.innerText = "ANALYSE MATCH PERFORMANCE";
        btn.disabled = false;
    }
});