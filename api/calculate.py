import os
import requests
from dataclasses import dataclass, field
from typing import Any
from flask import Flask, request, jsonify
from flask_cors import CORS
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

app = Flask(__name__, static_folder='../', static_url_path='')
CORS(app)

@app.route('/')
def index():
    return app.send_static_file('index.html')

# ─── DATA STRUCTURES & CONSTANTS ───
@dataclass(frozen=True)
class KillEvent:
    killer_puuid: str | None
    victim_puuid: str | None
    time_in_round_ms: int

@dataclass(frozen=True)
class PlayerRoundEconomy:
    puuid: str
    loadout_value: int

@dataclass
class RoundContext:
    round_num: int
    winning_team: str
    target_team: str
    kill_events: list[KillEvent]
    player_economies: list[PlayerRoundEconomy]
    first_blood_puuid: str | None = None
    first_death_puuid: str | None = None

@dataclass
class ScoredRound:
    round_num: int
    kills_score: float
    first_blood_bonus: float
    first_death_penalty: float
    round_score: float
    winning_team: str
    details: list[dict[str, Any]] = field(default_factory=list)

FIRST_BLOOD_BONUS: int = 25
FIRST_DEATH_PENALTY: int = 35
CLUTCH_MULTIPLIER: float = 1.5
FULL_BUY_THRESHOLD: int = 3500

# Tweak these two numbers to balance your final 0-1000 score!
PERFECT_ROUND_BENCHMARK: float = 55.0  
CURVE_FACTOR: float = 0.65  

# ─── THE SCORING ENGINE ───
class ValorantPerformanceEngine:
    def __init__(self, match_data: dict[str, Any], target_puuid: str) -> None:
        self.raw = match_data
        self.target_puuid = target_puuid
        self.all_players: list[dict[str, Any]] = match_data.get("players", {}).get("all_players", [])
        self.raw_rounds: list[dict[str, Any]] = match_data.get("rounds", [])
        self.total_rounds: int = self._resolve_total_rounds()
        self.acs_lookup: dict[str, float] = self._build_acs_lookup()
        self.team_lookup: dict[str, str] = {p["puuid"]: p["team"] for p in self.all_players if p.get("puuid")}
        self.target_team: str = self._resolve_target_team()

    def _resolve_total_rounds(self) -> int:
        meta = self.raw.get("metadata", {})
        explicit = meta.get("rounds_played")
        if explicit: return int(explicit)
        return len(self.raw_rounds)

    def _build_acs_lookup(self) -> dict[str, float]:
        lookup: dict[str, float] = {}
        meta_rounds = self.raw.get("metadata", {}).get("rounds_played") or self.total_rounds or 1
        for p in self.all_players:
            puuid = p.get("puuid")
            if not puuid: continue
            stats = p.get("stats", {})
            score = stats.get("score", 0)
            rounds = stats.get("rounds_played") or p.get("rounds_played") or meta_rounds or 1
            lookup[puuid] = score / rounds
        return lookup

    def _resolve_target_team(self) -> str:
        team = self.team_lookup.get(self.target_puuid)
        if not team: 
            raise ValueError(f"Target puuid {self.target_puuid} not found in this match dataset.")
        return team

    @staticmethod
    def _normalise_round_number(raw_round: dict[str, Any], index: int) -> int:
        num = raw_round.get("round_num") or raw_round.get("round")
        if num is None: return index + 1
        num = int(num)
        if num == 0 and index == 0: return 1
        return num

    def _parse_round(self, raw_round: dict[str, Any], index: int) -> RoundContext:
        round_num = self._normalise_round_number(raw_round, index)
        winning_team: str = raw_round.get("winning_team", "")
        raw_stats: list[dict[str, Any]] = raw_round.get("player_stats", [])
        
        raw_kills: list[dict[str, Any]] = []
        economies = []
        
        for ps in raw_stats:
            puuid = ps.get("player_puuid") or ps.get("puuid")
            if puuid:
                economies.append(
                    PlayerRoundEconomy(
                        puuid=puuid, 
                        loadout_value=ps.get("economy", {}).get("loadout_value", 0)
                    )
                )
            
            player_kills = ps.get("kill_events", [])
            for k in player_kills:
                raw_kills.append(k)
                
        raw_kills.sort(key=lambda k: k.get("kill_time_in_round", 0))
        
        kill_events = [
            KillEvent(killer_puuid=k.get("killer_puuid"), victim_puuid=k.get("victim_puuid"),
                      time_in_round_ms=k.get("kill_time_in_round", 0))
            for k in raw_kills
        ]
        
        fb_puuid, fd_puuid = None, None
        if kill_events:
            fb_puuid = kill_events[0].killer_puuid
            fd_puuid = kill_events[0].victim_puuid
            
        return RoundContext(round_num=round_num, winning_team=winning_team, target_team=self.target_team,
                            kill_events=kill_events, player_economies=economies,
                            first_blood_puuid=fb_puuid, first_death_puuid=fd_puuid)

    def _find_clutch_kills(self, ctx: RoundContext) -> dict[str, int]:
        alive: set[str] = {e.puuid for e in ctx.player_economies}
        for ke in ctx.kill_events:
            if ke.killer_puuid: alive.add(ke.killer_puuid)
            if ke.victim_puuid: alive.add(ke.victim_puuid)
        clutch_victims: dict[str, int] = {}
        for ke in ctx.kill_events:
            killer, victim = ke.killer_puuid, ke.victim_puuid
            if killer == self.target_puuid and victim:
                teammates_alive = {p for p in alive if p != self.target_puuid and self.team_lookup.get(p) == self.target_team}
                if len(teammates_alive) == 0:
                    enemies_alive = {p for p in alive if self.team_lookup.get(p) != self.target_team}
                    clutch_victims[victim] = len(enemies_alive)
            if victim: alive.discard(victim)
        return clutch_victims

    def _get_enemy_loadout_next_round(self, victim_puuid: str, current_round_index: int) -> int | None:
        next_index = current_round_index + 1
        if next_index >= len(self.raw_rounds): return None
        next_round = self.raw_rounds[next_index]
        for ps in next_round.get("player_stats", []):
            if ps.get("player_puuid") == victim_puuid or ps.get("puuid") == victim_puuid:
                return ps.get("economy", {}).get("loadout_value", 0)
        return None

    def _score_round(self, ctx: RoundContext, raw_index: int) -> ScoredRound:
        is_round_lost: bool = ctx.winning_team != ctx.target_team
        is_fb: bool = ctx.first_blood_puuid == self.target_puuid
        is_fd: bool = ctx.first_death_puuid == self.target_puuid
        clutch_victims: dict[str, int] = self._find_clutch_kills(ctx)
        
        kills_score: float = 0.0
        details: list[dict[str, Any]] = []
        
        for ke in ctx.kill_events:
            if ke.killer_puuid != self.target_puuid: continue
            victim = ke.victim_puuid
            if not victim: continue
            
            enemy_acs: float = self.acs_lookup.get(victim, 0.0)
            # Base kill value + ACS scaling
            dkv: float = (enemy_acs / 10.0) + 15.0 
            
            multiplier: float = 1.0
            reason: str = "standard"
            
            if is_round_lost:
                next_loadout = self._get_enemy_loadout_next_round(victim, raw_index)
                if next_loadout is not None and next_loadout < FULL_BUY_THRESHOLD:
                    # You killed them and damaged their economy for next round!
                    multiplier, reason = 1.25, f"eco damage ({next_loadout})"
                else:
                    # Standard kill, but the round was ultimately lost.
                    multiplier, reason = 1.0, "standard (lost round)"
            else:
                if victim in clutch_victims: 
                    clutch_size = clutch_victims[victim]
                    multiplier, reason = CLUTCH_MULTIPLIER, f"clutch (1v{clutch_size})"
                else:
                    # Standard kill in a won round (Includes Pistol rounds now!)
                    multiplier, reason = 1.0, "standard"
                    
            kill_points = dkv * multiplier
            kills_score += kill_points
            details.append({"victim_puuid": victim, "enemy_acs": round(enemy_acs, 1), "dkv": round(dkv, 2), 
                            "multiplier": multiplier, "reason": reason, "kill_points": round(kill_points, 2)})
                            
        fb_bonus = FIRST_BLOOD_BONUS if is_fb else 0
        fd_penalty = FIRST_DEATH_PENALTY if is_fd else 0
        round_score = kills_score + fb_bonus - fd_penalty
        
        return ScoredRound(round_num=ctx.round_num, kills_score=round(kills_score, 2),
                           first_blood_bonus=float(fb_bonus), first_death_penalty=float(fd_penalty),
                           round_score=round(round_score, 2), details=details, winning_team=ctx.winning_team)

    def calculate(self) -> dict[str, Any]:
        scored_rounds: list[ScoredRound] = []
        for idx, raw_round in enumerate(self.raw_rounds):
            ctx = self._parse_round(raw_round, idx)
            scored_rounds.append(self._score_round(ctx, idx))
        r = len(scored_rounds) or 1
        avg_round_score = sum(sr.round_score for sr in scored_rounds) / r
        ratio = avg_round_score / PERFECT_ROUND_BENCHMARK
        safe_ratio = max(0.0, ratio)  
        curved_value = (safe_ratio ** CURVE_FACTOR) * 1000
        final_score: int = int(max(0, min(1000, curved_value)))
        
        serialized_rounds = []
        for sr in scored_rounds:
            serialized_rounds.append({
                "round_num": sr.round_num,
                "kills_score": sr.kills_score,
                "first_blood_bonus": sr.first_blood_bonus,
                "first_death_penalty": sr.first_death_penalty,
                "round_score": sr.round_score,
                "winning_team": sr.winning_team,
                "details": sr.details
            })
        return {"target_puuid": self.target_puuid, "total_rounds": r, "round_scores": serialized_rounds,
                "average_round_score": round(avg_round_score, 4), "final_score": final_score}

# ─── WEB API ROUTE ───
ACCOUNT_CACHE = {
    ("nocap on god bro", "deeep"): {
        "region": "eu",
        "puuid": "3f123e34-b8cf-57bf-a4d7-e9349dde21c2"
    }
}
MATCH_CACHE = {}

@app.route('/api/calculate', methods=['POST'])
def handle_calculation():
    try:
        req_data = request.get_json() or {}
        username = req_data.get("username", "").strip()
        tag = req_data.get("tag", "").strip()
        try:
            page = int(req_data.get("page", 1))
            if page < 1:
                page = 1
        except (ValueError, TypeError):
            page = 1
        if not username or not tag:
            return jsonify({"error": "Missing username or tag parameter"}), 400
            
        headers = {"Authorization": os.environ.get("VALORANT_API_KEY", "")}
        
        # 1. Fetch account or read from cache
        cache_key = (username.lower(), tag.lower())
        if cache_key in ACCOUNT_CACHE:
            region = ACCOUNT_CACHE[cache_key]["region"]
            target_puuid = ACCOUNT_CACHE[cache_key]["puuid"]
        else:
            encoded_name = urllib.parse.quote(username)
            encoded_tag = urllib.parse.quote(tag)
            acc_url = f"https://api.henrikdev.xyz/valorant/v1/account/{encoded_name}/{encoded_tag}"
            acc_res = requests.get(acc_url, headers=headers, timeout=12)
            
            if acc_res.status_code != 200:
                return jsonify({"error": f"Failed to fetch account (Status {acc_res.status_code})"}), 502
                
            acc_data = acc_res.json().get("data", {})
            region = acc_data.get("region")
            target_puuid = acc_data.get("puuid")
            
            if not region or not target_puuid:
                return jsonify({"error": "Invalid account data received"}), 500
                
            ACCOUNT_CACHE[cache_key] = {"region": region, "puuid": target_puuid}
            
        # 2. Fetch Lifetime matches (paginated)
        encoded_name = urllib.parse.quote(username)
        encoded_tag = urllib.parse.quote(tag)
        lifetime_url = f"https://api.henrikdev.xyz/valorant/v1/lifetime/matches/{region}/{encoded_name}/{encoded_tag}?size=5&page={page}&mode=competitive"
        lifetime_res = requests.get(lifetime_url, headers=headers, timeout=15)
        
        if lifetime_res.status_code != 200:
            return jsonify({"error": f"Failed to fetch lifetime match history (Status {lifetime_res.status_code})"}), 502
            
        lifetime_payload = lifetime_res.json().get("data", [])
        match_ids = [m.get("meta", {}).get("id") for m in lifetime_payload if m.get("meta", {}).get("id")]
        
        # 3. Fetch full match details in parallel
        from concurrent.futures import ThreadPoolExecutor
        
        def fetch_match_details(match_id):
            if match_id in MATCH_CACHE:
                return MATCH_CACHE[match_id]
            try:
                url = f"https://api.henrikdev.xyz/valorant/v2/match/{match_id}"
                res = requests.get(url, headers=headers, timeout=12)
                if res.status_code == 200:
                    data = res.json().get("data", {})
                    if data:
                        MATCH_CACHE[match_id] = data
                    return data
            except Exception:
                pass
            return None

        with ThreadPoolExecutor(max_workers=5) as executor:
            matches_payload = list(executor.map(fetch_match_details, match_ids))
            
        matches_payload = [m for m in matches_payload if m]
        
        # 4. Process matches
        results = []
        for match_data in matches_payload:
            metadata = match_data.get("metadata") or {}
            match_id = metadata.get("matchid")
            map_name = metadata.get("map")
            mode = metadata.get("mode")
            
            players_dict = match_data.get("players") or {}
            all_players = players_dict.get("all_players") or []
            
            target_player_data = next((p for p in all_players if p.get("puuid") == target_puuid), None)
            if not target_player_data:
                continue
                
            # Scoreboard for all players
            scoreboard = []
            for p in all_players:
                p_puuid = p.get("puuid")
                if not p_puuid: continue
                try:
                    engine = ValorantPerformanceEngine(match_data, p_puuid)
                    p_result = engine.calculate()
                    scoreboard.append({
                        "puuid": p_puuid,
                        "name": p.get("name"),
                        "tag": p.get("tag"),
                        "team": p.get("team"),
                        "agent": p.get("character"),
                        "stats": p.get("stats", {}),
                        "final_score": p_result["final_score"],
                        "average_round_score": p_result["average_round_score"]
                    })
                except Exception:
                    pass
                    
            scoreboard.sort(key=lambda x: x["final_score"], reverse=True)
            
            # Target player performance
            engine_target = ValorantPerformanceEngine(match_data, target_puuid)
            target_result = engine_target.calculate()
            
            results.append({
                "match_id": match_id,
                "map": map_name,
                "mode": mode,
                "game_start": metadata.get("game_start"),
                "game_start_patched": metadata.get("game_start_patched"),
                "target_player": {
                    "name": target_player_data.get("name"),
                    "tag": target_player_data.get("tag"),
                    "agent": target_player_data.get("character"),
                    "team": target_player_data.get("team"),
                    "stats": target_player_data.get("stats", {})
                },
                "performance": target_result,
                "scoreboard": scoreboard
            })
            
        return jsonify({"matches": results, "page": page, "target_puuid": target_puuid}), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/performance', methods=['POST'])
def handle_performance():
    try:
        req_data = request.get_json() or {}
        username = req_data.get("username", "").strip()
        tag = req_data.get("tag", "").strip()
        
        if not username or not tag:
            return jsonify({"error": "Missing username or tag parameter"}), 400
            
        headers = {"Authorization": os.environ.get("VALORANT_API_KEY", "")}
        
        # 1. Fetch account or read from cache
        cache_key = (username.lower(), tag.lower())
        if cache_key in ACCOUNT_CACHE:
            region = ACCOUNT_CACHE[cache_key]["region"]
            target_puuid = ACCOUNT_CACHE[cache_key]["puuid"]
        else:
            encoded_name = urllib.parse.quote(username)
            encoded_tag = urllib.parse.quote(tag)
            acc_url = f"https://api.henrikdev.xyz/valorant/v1/account/{encoded_name}/{encoded_tag}"
            acc_res = requests.get(acc_url, headers=headers, timeout=12)
            
            if acc_res.status_code != 200:
                return jsonify({"error": f"Failed to fetch account (Status {acc_res.status_code})"}), 502
                
            acc_data = acc_res.json().get("data", {})
            region = acc_data.get("region")
            target_puuid = acc_data.get("puuid")
            
            if not region or not target_puuid:
                return jsonify({"error": "Invalid account data received"}), 500
                
            ACCOUNT_CACHE[cache_key] = {"region": region, "puuid": target_puuid}
            
        # 2. Fetch Lifetime matches (last 20)
        encoded_name = urllib.parse.quote(username)
        encoded_tag = urllib.parse.quote(tag)
        lifetime_url = f"https://api.henrikdev.xyz/valorant/v1/lifetime/matches/{region}/{encoded_name}/{encoded_tag}?size=20&page=1&mode=competitive"
        lifetime_res = requests.get(lifetime_url, headers=headers, timeout=15)
        
        if lifetime_res.status_code != 200:
            return jsonify({"error": f"Failed to fetch lifetime match history (Status {lifetime_res.status_code})"}), 502
            
        lifetime_payload = lifetime_res.json().get("data", [])
        match_ids = [m.get("meta", {}).get("id") for m in lifetime_payload if m.get("meta", {}).get("id")]
        
        # 3. Fetch full match details in parallel
        def fetch_match_details(match_id):
            if match_id in MATCH_CACHE:
                return MATCH_CACHE[match_id]
            try:
                url = f"https://api.henrikdev.xyz/valorant/v2/match/{match_id}"
                res = requests.get(url, headers=headers, timeout=12)
                if res.status_code == 200:
                    data = res.json().get("data", {})
                    if data:
                        MATCH_CACHE[match_id] = data
                    return data
            except Exception:
                pass
            return None

        with ThreadPoolExecutor(max_workers=5) as executor:
            matches_payload = list(executor.map(fetch_match_details, match_ids))
            
        valid_matches = [m for m in matches_payload if m]
        
        # 4. Aggregate performance
        total_score = 0
        total_acs = 0
        total_kills = 0
        total_deaths = 0
        total_assists = 0
        total_clutches = 0
        total_first_bloods = 0
        total_first_deaths = 0
        
        analyzed = 0
        
        history = []
        agent_stats = {}
        map_stats = {}
        
        for match_data in valid_matches:
            try:
                engine = ValorantPerformanceEngine(match_data, target_puuid)
                result = engine.calculate()
                
                final_score = result["final_score"]
                total_score += final_score
                
                metadata = match_data.get("metadata", {})
                match_id = metadata.get("matchid")
                map_name = metadata.get("map")
                game_start = metadata.get("game_start")
                
                # Extract stats for the target player
                players_dict = match_data.get("players") or {}
                all_players = players_dict.get("all_players") or []
                target_player_data = next((p for p in all_players if p.get("puuid") == target_puuid), None)
                
                agent = "Unknown"
                if target_player_data:
                    agent = target_player_data.get("character", "Unknown")
                    stats = target_player_data.get("stats") or {}
                    
                    rounds_played = engine.total_rounds
                    acs = (stats.get("score") or 0) / rounds_played if rounds_played > 0 else 0
                    total_acs += acs
                    
                    kills = stats.get("kills", 0)
                    deaths = stats.get("deaths", 0)
                    assists = stats.get("assists", 0)
                    total_kills += kills
                    total_deaths += deaths
                    total_assists += assists
                    
                    # Check if win
                    is_win = False
                    team = target_player_data.get("team")
                    if team:
                        is_win = match_data.get("teams", {}).get(team.lower(), {}).get("has_won", False)

                    # Agent stats aggregation
                    if agent not in agent_stats:
                        agent_stats[agent] = {"matches": 0, "wins": 0, "total_score": 0, "kills": 0, "deaths": 0, "assists": 0}
                    agent_stats[agent]["matches"] += 1
                    if is_win:
                        agent_stats[agent]["wins"] += 1
                    agent_stats[agent]["total_score"] += final_score
                    agent_stats[agent]["kills"] += kills
                    agent_stats[agent]["deaths"] += deaths
                    agent_stats[agent]["assists"] += assists
                    
                # Extract clutches, FB, FD from round_scores
                for sr in result.get("round_scores", []):
                    total_first_bloods += 1 if sr.get("first_blood_bonus") > 0 else 0
                    total_first_deaths += 1 if sr.get("first_death_penalty") > 0 else 0
                    
                    # Count clutches by looking at details
                    for d in sr.get("details", []):
                        if d.get("reason", "").startswith("clutch"):
                            total_clutches += 1
                            break # Count clutch once per round
                
                # Map stats aggregation
                if map_name not in map_stats:
                    map_stats[map_name] = {"matches": 0, "wins": 0, "total_score": 0}
                map_stats[map_name]["matches"] += 1
                
                # If target_player_data was missing, we won't know if it's a win, but usually we skip the match above if missing
                if 'is_win' in locals() and is_win:
                    map_stats[map_name]["wins"] += 1
                    
                map_stats[map_name]["total_score"] += final_score
                            
                history.append({
                    "match_id": match_id,
                    "map": map_name,
                    "agent": agent,
                    "score": final_score,
                    "acs": round(acs, 1) if target_player_data else 0,
                    "date": game_start
                })
                
                analyzed += 1
            except Exception:
                pass
                
        if analyzed == 0:
            return jsonify({"error": "Could not analyze any matches"}), 404
            
        # Format agent and map stats
        agent_performance = []
        for a, s in agent_stats.items():
            agent_performance.append({
                "agent": a,
                "matches": s["matches"],
                "winrate": round((s["wins"] / s["matches"]) * 100) if s["matches"] > 0 else 0,
                "average_score": round(s["total_score"] / s["matches"]),
                "kills": s["kills"],
                "deaths": s["deaths"],
                "assists": s["assists"]
            })
        agent_performance.sort(key=lambda x: x["average_score"], reverse=True)
        
        map_performance = []
        for m, s in map_stats.items():
            map_performance.append({
                "map": m,
                "matches": s["matches"],
                "winrate": round((s["wins"] / s["matches"]) * 100) if s["matches"] > 0 else 0,
                "average_score": round(s["total_score"] / s["matches"])
            })
        map_performance.sort(key=lambda x: x["average_score"], reverse=True)
        
        # Sort history by date ascending for charts
        history.sort(key=lambda x: x["date"] if x["date"] else 0)
            
        return jsonify({
            "target_puuid": target_puuid,
            "matches_analyzed": analyzed,
            "average_score": round(total_score / analyzed),
            "average_acs": round(total_acs / analyzed, 1),
            "average_kills": round(total_kills / analyzed, 1),
            "average_deaths": round(total_deaths / analyzed, 1),
            "average_assists": round(total_assists / analyzed, 1),
            "total_clutches": total_clutches,
            "total_first_bloods": total_first_bloods,
            "total_first_deaths": total_first_deaths,
            "history": history,
            "agent_performance": agent_performance,
            "map_performance": map_performance
        }), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
