import { matchSponsors } from "@/lib/sponsors";
import type { AppState, TeamHealth } from "@/lib/types";

const HEALTH_PTS: Record<TeamHealth, number> = {
  healthy: 40,
  noisy: 22,
  unknown: 10,
  stalled: 0,
};

export type LeaderboardRow = {
  name: string;
  repo: string;
  health: TeamHealth;
  score: number;
  prizes: string[];
  stack: string[];
  interviewScore?: number;
  scoredBy?: "gemini" | "heuristic";
  judgeScore?: number;
};

export function buildLeaderboard(state: AppState): LeaderboardRow[] {
  return state.teams
    .map((team) => {
      const prizes = team.prizes?.length ? team.prizes : matchSponsors(team.stack);
      const interview = [...state.interviews]
        .reverse()
        .find((row) => row.teamId === team.name || row.teamId === team.id || row.teamId === team.repo);
      let score = HEALTH_PTS[team.health];
      score += prizes.length * 8;
      if (interview) {
        score += interview.recommendAdvance ? 20 : 6;
        score += Math.round((1 - interview.scriptLikelihood) * 12);
      }
      if (typeof team.judgeScore === "number") score += Math.round(team.judgeScore / 5);
      return {
        name: team.name,
        repo: team.repo,
        health: team.health,
        score,
        prizes,
        stack: team.stack,
        interviewScore: interview ? interview.scriptLikelihood : undefined,
        scoredBy: interview?.scoredBy,
        judgeScore: team.judgeScore,
      };
    })
    .sort((a, b) => b.score - a.score);
}
