import os
import requests
from dataclasses import dataclass, field
from typing import Any
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Allows your frontend website to securely talk to this backend

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
    details: list[dict[str, Any]] = field(default_factory=list)

FIRST_BLOOD_BONUS: int = 20
FIRST_DEATH_PENALTY: int = 50
CLUTCH_MULTIPLIER: float = 1.5
FULL_BUY_THRESHOLD: int = 3500
PERFECT_ROUND_BENCHMARK: float = 200.0
ECONOMY_RESET_ROUNDS: frozenset[int] = frozenset({12, 24})
CURVE_FACTOR: float = 0.5  

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
        for p in self.all_players:
            puuid = p.get("puuid")
            if not puuid: continue
            stats = p.get("stats", {})
            score = stats.get("score", 0)
            rounds = stats.get("rounds_played", 1) or 1
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
        raw_kills: list[dict[str, Any]] = raw_round.get("kill_events", [])
        raw_kills.sort(key=lambda k: k.get("time_in_round_in_millis", 0))
        
        kill_events = [
            KillEvent(killer_puuid=k.get("killer_puuid"), victim_puuid=k.get("victim_puuid"),
                      time_in_round_ms=k.get("time_in_round_in_millis", 0))
            for k in raw_kills
        ]
        
        raw_stats: list[dict[str, Any]] = raw_round.get("player_stats", [])
        economies = [
            PlayerRoundEconomy(puuid=ps.get("puuid", ""), loadout_value=ps.get("economy", {}).get("loadout_value", 0))
            for ps in raw_stats if ps.get("puuid")
        ]
        
        fb_puuid, fd_puuid = None, None
        if kill_events:
            fb_puuid = kill_events[0].killer_puuid
            fd_puuid = kill_events[0].victim_puuid

        return RoundContext(round_num=round_num, winning_team=winning_team, target_team=self.target_team,
                            kill_events=kill_events, player_economies=economies,
                            first_blood_puuid=fb_puuid, first_death_puuid=fd_puuid)

    def _find_clutch_kills(self, ctx: RoundContext) -> set[str]:
        alive: set[str] = {e.puuid for e in ctx.player_economies}
        for ke in ctx.kill_events:
            if ke.killer_puuid: alive.add(ke.killer_puuid)
            if ke.victim_puuid: alive.add(ke.victim_puuid)

        clutch_victims: set[str] = set()
        for ke in ctx.kill_events:
            killer, victim = ke.killer_puuid, ke.victim_puuid
            if killer == self.target_puuid and victim:
                teammates_alive = {p for p in alive if p != self.target_puuid and self.team_lookup.get(p) == self.target_team}
                if len(teammates_alive) == 0: clutch_victims.add(victim)
            if victim: alive.discard(victim)
        return clutch_victims

    def _get_enemy_loadout_next_round(self, victim_puuid: str, current_round_index: int) -> int | None:
        next_index = current_round_index + 1
        if next_index >= len(self.raw_rounds): return None
        next_round = self.raw_rounds[next_index]
        for ps in next_round.get("player_stats", []):
            if ps.get("puuid") == victim_puuid:
                return ps.get("economy", {}).get("loadout_value", 0)
        return None

    def _score_round(self, ctx: RoundContext, raw_index: int) -> ScoredRound:
        is_round_lost: bool = ctx.winning_team != ctx.target_team
        is_fb: bool = ctx.first_blood_puuid == self.target_puuid
        is_fd: bool = ctx.first_death_puuid == self.target_puuid
        clutch_victims: set[str] = self._find_clutch_kills(ctx)

        kills_score: float = 0.0
        details: list[dict[str, Any]] = []

        for ke in ctx.kill_events:
            if ke.killer_puuid != self.target_puuid: continue
            victim = ke.victim_puuid
            if not victim: continue

            enemy_acs: float = self.acs_lookup.get(victim, 0.0)
            dkv: float = enemy_acs / 10.0
            multiplier: float = 1.0
            reason: str = "standard"

            if is_round_lost:
                if ctx.round_num in ECONOMY_RESET_ROUNDS or ctx.round_num == self.total_rounds:
                    multiplier, reason = 0.0, "economy-reset round"
                else:
                    next_loadout = self._get_enemy_loadout_next_round(victim, raw_index)
                    if next_loadout is None: multiplier, reason = 1.0, "no next-round data"
                    elif next_loadout < FULL_BUY_THRESHOLD: multiplier, reason = 1.0, f"broke eco ({next_loadout})"
                    else: multiplier, reason = 0.0, f"futile exit frag ({next_loadout})"
            else:
                if victim in clutch_victims: multiplier, reason = CLUTCH_MULTIPLIER, "clutch"

            kill_points = dkv * multiplier
            kills_score += kill_points
            details.append({"victim_puuid": victim, "enemy_acs": enemy_acs, "dkv": dkv, 
                            "multiplier": multiplier, "reason": reason, "kill_points": kill_points})

        fb_bonus = FIRST_BLOOD_BONUS if is_fb else 0
        fd_penalty = FIRST_DEATH_PENALTY if is_fd else 0
        round_score = kills_score + fb_bonus - fd_penalty

        return ScoredRound(round_num=ctx.round_num, kills_score=round(kills_score, 4),
                           first_blood_bonus=float(fb_bonus), first_death_penalty=float(fd_penalty),
                           round_score=round(round_score, 4), details=details)

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

        # Convert ScoredRound objects to standard dict structures for JSON output
        serialized_rounds = []
        for sr in scored_rounds:
            serialized_rounds.append({
                "round_num": sr.round_num,
                "kills_score": sr.kills_score,
                "first_blood_bonus": sr.first_blood_bonus,
                "first_death_penalty": sr.first_death_penalty,
                "round_score": sr.round_score,
                "details": sr.details
            })

        return {"target_puuid": self.target_puuid, "total_rounds": r, "round_scores": serialized_rounds,
                "average_round_score": round(avg_round_score, 4), "final_score": final_score}

# ─── WEB API ROUTE ───
@app.route('/api/calculate', methods=['POST'])
def handle_calculation():
    try:
        req_data = request.get_json() or {}
        match_id = req_data.get("match_id", "").strip()
        puuid = req_data.get("puuid", "").strip()

        if not match_id or not puuid:
            return jsonify({"error": "Missing match_id or puuid parameter"}), 400

        # Fetch data from HenrikDev Unofficial API
        url = f"https://api.henrikdev.xyz/valorant/v2/match/{match_id}"
        response = requests.get(url, timeout=12)
        
        if response.status_code != 200:
            return jsonify({"error": f"Riot API proxy error (Status {response.status_code})"}), 502
            
        payload = response.json()
        match_data = payload.get("data", {})

        if not match_data:
            return jsonify({"error": "Match dataset empty or invalid ID"}), 404

        # Execute your engine
        engine = ValorantPerformanceEngine(match_data, puuid)
        result = engine.calculate()
        return jsonify(result), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500
