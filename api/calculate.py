import os
import requests
from dataclasses import dataclass, field
from typing import Any
from flask import Flask, request, jsonify
from flask_cors import CORS
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
import time

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
    raw_player_stats: list[dict[str, Any]] = field(default_factory=list)

@dataclass
class ScoredRound:
    round_num: int
    kills_score: float
    damage_score: float
    first_blood_bonus: float
    first_death_penalty: float
    clutch_bonus: float
    round_score: float
    winning_team: str
    details: list[dict[str, Any]] = field(default_factory=list)

FIRST_BLOOD_BONUS: int = 25
FIRST_DEATH_PENALTY: int = 35
CLUTCH_MULTIPLIER: float = 1.5
FULL_BUY_THRESHOLD: int = 3500

# Damage scoring
DAMAGE_WEIGHT: float = 0.15          # Damage contributes ~15% of the round score
DAMAGE_PER_POINT: float = 8.0        # 8 useful-damage HP = 1 point of raw damage score
DAMAGE_LOST_HOPELESS_MULT: float = 0.25  # Discount for damage in hopeless lost situations

# Tweak these two numbers to balance your final 0-1000 score!
PERFECT_ROUND_BENCHMARK: float = 45.0  
CURVE_FACTOR: float = 0.98  

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
                            first_blood_puuid=fb_puuid, first_death_puuid=fd_puuid,
                            raw_player_stats=raw_stats)

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
        clutch_bonus: float = 0.0
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
                    
            clutch_points = 0.0
            if "clutch" in reason:
                kill_points_base = dkv * 1.0
                clutch_points = dkv * (multiplier - 1.0)
            else:
                kill_points_base = dkv * multiplier
                
            kills_score += kill_points_base
            clutch_bonus += clutch_points
            details.append({
                "victim_puuid": victim,
                "enemy_acs": round(enemy_acs, 1),
                "dkv": round(dkv, 2), 
                "multiplier": multiplier,
                "reason": reason,
                "kill_points": round(kill_points_base, 2),
                "clutch_bonus_points": round(clutch_points, 2)
            })
                            
        fb_bonus = FIRST_BLOOD_BONUS if is_fb else 0
        fd_penalty = FIRST_DEATH_PENALTY if is_fd else 0
        
        # ── Damage score ──────────────────────────────────────────────────────
        damage_score = self._calculate_damage_score(ctx, raw_index)
        
        combat_score = kills_score + clutch_bonus + damage_score
        round_score = combat_score + fb_bonus - fd_penalty
        
        return ScoredRound(round_num=ctx.round_num, kills_score=round(kills_score, 2),
                           damage_score=round(damage_score, 2),
                           first_blood_bonus=float(fb_bonus), first_death_penalty=float(fd_penalty),
                           clutch_bonus=round(clutch_bonus, 2),
                           round_score=round(round_score, 2), details=details, winning_team=ctx.winning_team)

    def _calculate_damage_score(self, ctx: RoundContext, raw_index: int) -> float:
        """Score non-kill damage: the 'assist damage' that softened enemies.
        
        Logic:
        - Take all damage_events from the target player this round
        - Subtract damage dealt to enemies the player also killed (already scored)
        - The remaining damage is 'useful assist damage' — it created HP advantages
        - Discount damage in lost rounds where the player was in a hopeless 1vN
        """
        is_round_lost = ctx.winning_team != ctx.target_team
        
        # Find the target player's stats for this round
        target_stats = None
        for ps in ctx.raw_player_stats:
            puuid = ps.get("player_puuid") or ps.get("puuid")
            if puuid == self.target_puuid:
                target_stats = ps
                break
        
        if not target_stats:
            return 0.0
        
        damage_events = target_stats.get("damage_events", [])
        if not damage_events:
            return 0.0
        
        # Identify enemies the player killed this round
        killed_enemies: set[str] = set()
        for ke in ctx.kill_events:
            if ke.killer_puuid == self.target_puuid and ke.victim_puuid:
                killed_enemies.add(ke.victim_puuid)
        
        # Sum damage to enemies NOT killed by this player (= assist/softening damage)
        useful_damage: float = 0.0
        for de in damage_events:
            receiver = de.get("receiver_puuid")
            dmg = de.get("damage", 0)
            if not receiver:
                continue
            # Skip damage to enemies we killed — those kills are already scored
            if receiver in killed_enemies:
                continue
            useful_damage += dmg
        
        if useful_damage <= 0:
            return 0.0
        
        # Base damage points
        raw_damage_pts = useful_damage / DAMAGE_PER_POINT
        
        # Context multiplier
        if is_round_lost:
            # Check if player was in a hopeless situation (1v2+, dead teammates)
            # Count how many teammates were alive at the end (approximation)
            teammates_killed = 0
            for ke in ctx.kill_events:
                victim = ke.victim_puuid
                if victim and victim != self.target_puuid:
                    if self.team_lookup.get(victim) == ctx.target_team:
                        teammates_killed += 1
            
            team_size = sum(1 for p in ctx.player_economies 
                          if self.team_lookup.get(p.puuid) == ctx.target_team)
            alive_at_end = max(0, team_size - teammates_killed)
            
            if alive_at_end <= 1 and teammates_killed >= 3:
                # Hopeless 1vN scenario — likely exit damage, heavily discount
                raw_damage_pts *= DAMAGE_LOST_HOPELESS_MULT
            else:
                # Lost round but damage was still relevant (trade potential, etc.)
                raw_damage_pts *= 0.7
        
        # Apply the weight so damage stays a small part of total score
        return raw_damage_pts * DAMAGE_WEIGHT

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
                "damage_score": sr.damage_score,
                "first_blood_bonus": sr.first_blood_bonus,
                "first_death_penalty": sr.first_death_penalty,
                "clutch_bonus": sr.clutch_bonus,
                "round_score": sr.round_score,
                "winning_team": sr.winning_team,
                "details": sr.details
            })
        return {"target_puuid": self.target_puuid, "total_rounds": r, "round_scores": serialized_rounds,
                "average_round_score": round(avg_round_score, 4), "final_score": final_score}

# ─── IN-MEMORY CACHING SYSTEM ───
ACCOUNT_CACHE: dict[tuple[str, str], dict[str, Any]] = {}
MATCH_CACHE: dict[str, dict[str, Any]] = {}


def _api_headers() -> dict[str, str]:
    key = os.environ.get("VALORANT_API_KEY", "") or os.environ.get("HDEV_API_KEY", "")
    return {"Authorization": key} if key else {}


def _friendly_status_error(status: int, context: str) -> tuple[dict[str, str], int]:
    if status == 404:
        return {"error": f"{context}: account or data not found. Check the Riot ID."}, 404
    if status == 429:
        return {"error": f"{context}: rate limited by the API. Wait a moment and try again."}, 429
    if status in (401, 403):
        return {"error": f"{context}: API authorization failed. Check the server API key."}, 502
    return {"error": f"{context} failed (status {status})."}, 502


def _extract_account_payload(acc_data: dict[str, Any], username: str, tag: str) -> dict[str, Any]:
    card = acc_data.get("card") or {}
    return {
        "name": acc_data.get("name") or username,
        "tag": acc_data.get("tag") or tag,
        "puuid": acc_data.get("puuid"),
        "region": acc_data.get("region"),
        "account_level": acc_data.get("account_level"),
        "card_small": card.get("small") or card.get("wide") or card.get("large"),
        "card_large": card.get("large") or card.get("wide") or card.get("small"),
    }


def resolve_account(username: str, tag: str) -> tuple[dict[str, Any] | None, tuple[dict, int] | None]:
    """Return (account_info, None) or (None, (error_json, status))."""
    cache_key = (username.lower(), tag.lower())
    if cache_key in ACCOUNT_CACHE:
        return ACCOUNT_CACHE[cache_key], None

    headers = _api_headers()
    encoded_name = urllib.parse.quote(username)
    encoded_tag = urllib.parse.quote(tag)
    acc_url = f"https://api.henrikdev.xyz/valorant/v1/account/{encoded_name}/{encoded_tag}"
    try:
        acc_res = requests.get(acc_url, headers=headers, timeout=12)
    except requests.RequestException as exc:
        return None, ({"error": f"Could not reach account API: {exc}"}, 502)

    if acc_res.status_code != 200:
        return None, _friendly_status_error(acc_res.status_code, "Account lookup")

    acc_data = acc_res.json().get("data", {}) or {}
    region = acc_data.get("region")
    target_puuid = acc_data.get("puuid")
    if not region or not target_puuid:
        return None, ({"error": "Invalid account data received from API."}, 500)

    account = _extract_account_payload(acc_data, username, tag)
    ACCOUNT_CACHE[cache_key] = account
    return account, None


def fetch_match_details(match_id: str, headers: dict[str, str]) -> dict[str, Any] | None:
    if match_id in MATCH_CACHE:
        return MATCH_CACHE[match_id]
    for attempt in range(3):
        try:
            url = f"https://api.henrikdev.xyz/valorant/v2/match/{match_id}"
            res = requests.get(url, headers=headers, timeout=12)
            if res.status_code == 200:
                data = res.json().get("data", {})
                if data:
                    MATCH_CACHE[match_id] = data
                return data
            if res.status_code == 429:
                time.sleep(1.0 * (attempt + 1))
        except Exception:
            time.sleep(0.5)
    return None


def _match_outcome(match_data: dict[str, Any], target_puuid: str) -> tuple[bool | None, int, int]:
    """Return (has_won, rounds_won, rounds_lost) for the target player."""
    players = (match_data.get("players") or {}).get("all_players") or []
    target = next((p for p in players if p.get("puuid") == target_puuid), None)
    if not target:
        return None, 0, 0
    team = (target.get("team") or "").lower()
    teams = match_data.get("teams") or {}
    team_info = teams.get(team) or {}
    has_won = team_info.get("has_won")
    rounds_won = int(team_info.get("rounds_won") or 0)
    rounds_lost = int(team_info.get("rounds_lost") or 0)
    if has_won is None and rounds_won + rounds_lost > 0:
        has_won = rounds_won > rounds_lost
    return has_won, rounds_won, rounds_lost


def _player_headshot_pct(stats: dict[str, Any]) -> float | None:
    hs = stats.get("headshots")
    bs = stats.get("bodyshots")
    ls = stats.get("legshots")
    if hs is None:
        return None
    total = (hs or 0) + (bs or 0) + (ls or 0)
    if total <= 0:
        return None
    return (hs or 0) / total * 100.0


def _player_adr(stats: dict[str, Any], rounds: int) -> float | None:
    dmg = stats.get("damage")
    if dmg is None:
        # Some payloads nest damage under damage_made
        dmg = stats.get("damage_made")
    if dmg is None or rounds <= 0:
        return None
    return float(dmg) / rounds


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

        account, err = resolve_account(username, tag)
        if err:
            return jsonify(err[0]), err[1]

        region = account["region"]
        target_puuid = account["puuid"]
        headers = _api_headers()

        encoded_name = urllib.parse.quote(username)
        encoded_tag = urllib.parse.quote(tag)
        lifetime_url = (
            f"https://api.henrikdev.xyz/valorant/v1/lifetime/matches/"
            f"{region}/{encoded_name}/{encoded_tag}?size=5&page={page}&mode=competitive"
        )
        try:
            lifetime_res = requests.get(lifetime_url, headers=headers, timeout=15)
        except requests.RequestException as exc:
            return jsonify({"error": f"Could not reach match history API: {exc}"}), 502

        if lifetime_res.status_code != 200:
            body, code = _friendly_status_error(lifetime_res.status_code, "Match history")
            return jsonify(body), code

        lifetime_payload = lifetime_res.json().get("data", []) or []
        match_ids = [m.get("meta", {}).get("id") for m in lifetime_payload if m.get("meta", {}).get("id")]

        with ThreadPoolExecutor(max_workers=5) as executor:
            matches_payload = list(executor.map(lambda mid: fetch_match_details(mid, headers), match_ids))

        matches_payload = [m for m in matches_payload if m]

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

            scoreboard = []
            for p in all_players:
                p_puuid = p.get("puuid")
                if not p_puuid:
                    continue
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
                        "average_round_score": p_result["average_round_score"],
                    })
                except Exception:
                    pass

            scoreboard.sort(key=lambda x: x["final_score"], reverse=True)

            engine_target = ValorantPerformanceEngine(match_data, target_puuid)
            target_result = engine_target.calculate()
            has_won, rounds_won, rounds_lost = _match_outcome(match_data, target_puuid)

            results.append({
                "match_id": match_id,
                "map": map_name,
                "mode": mode,
                "game_start": metadata.get("game_start"),
                "game_start_patched": metadata.get("game_start_patched"),
                "has_won": has_won,
                "rounds_won": rounds_won,
                "rounds_lost": rounds_lost,
                "target_player": {
                    "name": target_player_data.get("name"),
                    "tag": target_player_data.get("tag"),
                    "agent": target_player_data.get("character"),
                    "team": target_player_data.get("team"),
                    "stats": target_player_data.get("stats", {}),
                },
                "performance": target_result,
                "scoreboard": scoreboard,
            })

        return jsonify({
            "matches": results,
            "page": page,
            "target_puuid": target_puuid,
            "account": account,
        }), 200

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

        account, err = resolve_account(username, tag)
        if err:
            return jsonify(err[0]), err[1]

        region = account["region"]
        target_puuid = account["puuid"]
        headers = _api_headers()

        encoded_name = urllib.parse.quote(username)
        encoded_tag = urllib.parse.quote(tag)
        lifetime_url = (
            f"https://api.henrikdev.xyz/valorant/v1/lifetime/matches/"
            f"{region}/{encoded_name}/{encoded_tag}?size=10&page=1&mode=competitive"
        )
        try:
            lifetime_res = requests.get(lifetime_url, headers=headers, timeout=15)
        except requests.RequestException as exc:
            return jsonify({"error": f"Could not reach match history API: {exc}"}), 502

        if lifetime_res.status_code != 200:
            body, code = _friendly_status_error(lifetime_res.status_code, "Match history")
            return jsonify(body), code

        lifetime_payload = lifetime_res.json().get("data", []) or []
        match_ids = [m.get("meta", {}).get("id") for m in lifetime_payload if m.get("meta", {}).get("id")]

        with ThreadPoolExecutor(max_workers=5) as executor:
            matches_payload = list(executor.map(lambda mid: fetch_match_details(mid, headers), match_ids))

        valid_matches = [m for m in matches_payload if m]

        total_score = 0
        total_acs = 0
        total_kills = 0
        total_deaths = 0
        total_assists = 0
        total_clutches = 0
        total_first_bloods = 0
        total_first_deaths = 0
        total_wins = 0
        hs_samples: list[float] = []
        adr_samples: list[float] = []

        analyzed = 0
        history = []
        form_chrono: list[tuple[int, str]] = []
        agent_stats: dict[str, dict[str, Any]] = {}
        map_stats: dict[str, dict[str, Any]] = {}

        for match_data in valid_matches:
            try:
                engine = ValorantPerformanceEngine(match_data, target_puuid)
                result = engine.calculate()

                final_score = result["final_score"]
                total_score += final_score

                metadata = match_data.get("metadata", {})
                match_id = metadata.get("matchid")
                map_name = metadata.get("map") or "Unknown"
                game_start = metadata.get("game_start") or 0

                players_dict = match_data.get("players") or {}
                all_players = players_dict.get("all_players") or []
                target_player_data = next((p for p in all_players if p.get("puuid") == target_puuid), None)

                agent = "Unknown"
                is_win = False
                acs = 0.0
                kills = deaths = assists = 0

                if target_player_data:
                    agent = target_player_data.get("character", "Unknown")
                    stats = target_player_data.get("stats") or {}

                    rounds_played = engine.total_rounds or 1
                    acs = (stats.get("score") or 0) / rounds_played
                    total_acs += acs

                    kills = stats.get("kills", 0) or 0
                    deaths = stats.get("deaths", 0) or 0
                    assists = stats.get("assists", 0) or 0
                    total_kills += kills
                    total_deaths += deaths
                    total_assists += assists

                    has_won, _, _ = _match_outcome(match_data, target_puuid)
                    is_win = bool(has_won)
                    if is_win:
                        total_wins += 1

                    hs = _player_headshot_pct(stats)
                    if hs is not None:
                        hs_samples.append(hs)
                    adr = _player_adr(stats, rounds_played)
                    if adr is not None:
                        adr_samples.append(adr)

                    if agent not in agent_stats:
                        agent_stats[agent] = {
                            "matches": 0, "wins": 0, "total_score": 0,
                            "kills": 0, "deaths": 0, "assists": 0,
                        }
                    agent_stats[agent]["matches"] += 1
                    if is_win:
                        agent_stats[agent]["wins"] += 1
                    agent_stats[agent]["total_score"] += final_score
                    agent_stats[agent]["kills"] += kills
                    agent_stats[agent]["deaths"] += deaths
                    agent_stats[agent]["assists"] += assists

                for sr in result.get("round_scores", []):
                    total_first_bloods += 1 if sr.get("first_blood_bonus", 0) > 0 else 0
                    total_first_deaths += 1 if sr.get("first_death_penalty", 0) > 0 else 0
                    for d in sr.get("details", []):
                        if str(d.get("reason", "")).startswith("clutch"):
                            total_clutches += 1
                            break

                if map_name not in map_stats:
                    map_stats[map_name] = {"matches": 0, "wins": 0, "total_score": 0}
                map_stats[map_name]["matches"] += 1
                if target_player_data and is_win:
                    map_stats[map_name]["wins"] += 1
                map_stats[map_name]["total_score"] += final_score

                form_chrono.append((game_start, "W" if is_win else "L"))

                history.append({
                    "match_id": match_id,
                    "map": map_name,
                    "agent": agent,
                    "score": final_score,
                    "acs": round(acs, 1) if target_player_data else 0,
                    "date": game_start,
                    "won": is_win if target_player_data else None,
                })

                analyzed += 1
            except Exception:
                pass

        if analyzed == 0:
            return jsonify({"error": "Could not analyze any competitive matches for this account."}), 404

        agent_performance = []
        for a, s in agent_stats.items():
            agent_performance.append({
                "agent": a,
                "matches": s["matches"],
                "winrate": round((s["wins"] / s["matches"]) * 100) if s["matches"] > 0 else 0,
                "average_score": round(s["total_score"] / s["matches"]),
                "kills": s["kills"],
                "deaths": s["deaths"],
                "assists": s["assists"],
            })
        agent_performance.sort(key=lambda x: x["average_score"], reverse=True)

        map_performance = []
        for m, s in map_stats.items():
            map_performance.append({
                "map": m,
                "matches": s["matches"],
                "winrate": round((s["wins"] / s["matches"]) * 100) if s["matches"] > 0 else 0,
                "average_score": round(s["total_score"] / s["matches"]),
            })
        map_performance.sort(key=lambda x: x["average_score"], reverse=True)

        history.sort(key=lambda x: x["date"] if x["date"] else 0)

        # Form: most recent first
        form_chrono.sort(key=lambda x: x[0], reverse=True)
        form = [r for _, r in form_chrono]

        kd_ratio = (total_kills / total_deaths) if total_deaths > 0 else float(total_kills)
        winrate = round((total_wins / analyzed) * 100) if analyzed else 0
        headshot_pct = round(sum(hs_samples) / len(hs_samples), 1) if hs_samples else None
        average_adr = round(sum(adr_samples) / len(adr_samples), 1) if adr_samples else None

        return jsonify({
            "target_puuid": target_puuid,
            "account": account,
            "matches_analyzed": analyzed,
            "average_score": round(total_score / analyzed),
            "average_acs": round(total_acs / analyzed, 1),
            "average_kills": round(total_kills / analyzed, 1),
            "average_deaths": round(total_deaths / analyzed, 1),
            "average_assists": round(total_assists / analyzed, 1),
            "kd_ratio": round(kd_ratio, 2),
            "winrate": winrate,
            "wins": total_wins,
            "losses": analyzed - total_wins,
            "form": form,
            "headshot_pct": headshot_pct,
            "average_adr": average_adr,
            "total_clutches": total_clutches,
            "total_first_bloods": total_first_bloods,
            "total_first_deaths": total_first_deaths,
            "history": history,
            "agent_performance": agent_performance,
            "map_performance": map_performance,
        }), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)

