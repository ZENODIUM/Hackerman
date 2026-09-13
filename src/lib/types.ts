export type AgentId = "supervisor" | "registration" | "progress" | "community" | "interview";

export type Activity = {
  id: string;
  ts: string;
  agent: AgentId;
  title: string;
  detail: string;
  ok: boolean;
  payload?: unknown;
};

export type Attendee = {
  id: string;
  name: string;
  email: string;
  discord?: string;
  github?: string;
  teamId?: string;
  checkedIn: boolean;
  source: "eventbrite" | "manual";
};

export type TeamHealth = "healthy" | "stalled" | "noisy" | "unknown";

export type Team = {
  id: string;
  name: string;
  repo: string;
  health: TeamHealth;
  lastCommit?: string;
  commitCount: number;
  stack: string[];
  prizes?: string[];
  notes: string;
  judgeScore?: number;
};

export type InterviewRubric = {
  id: string;
  teamId?: string;
  ts: string;
  scriptLikelihood: number;
  answeredWithoutPrompt: boolean;
  eyeContactProxy?: number;
  toneNatural?: number;
  readingFromScript?: number;
  summary: string;
  recommendAdvance: boolean;
  scoredBy: "gemini" | "heuristic";
  scoreError?: string;
  clipUrl?: string;
  previewFrame?: string;
};

export type HackathonBrief = {
  name: string;
  topic: string;
  description: string;
  free: boolean;
  cost?: string;
  priceLabel: string;
  startAt: string;
  endAt: string;
  timezone: string;
  capacity: number;
};

export type HackathonSummary = {
  id: string;
  name: string;
  topic: string;
  startAt: string;
  endAt: string;
  eventId?: string;
  eventUrl?: string;
};

export type PipelineFlags = {
  eventCreated?: boolean;
  ticketCreated?: boolean;
  attendeesSynced?: boolean;
  discordSetup?: boolean;
  discordOnboarded?: boolean;
  teamChannelsCreated?: boolean;
  githubReposCreated?: boolean;
  githubScanned?: boolean;
  emailsSent?: boolean;
  interviewDone?: boolean;
  judged?: boolean;
};

export type DiscordIds = {
  categoryId?: string;
  supervisorChannelId?: string;
  registrationChannelId?: string;
  progressChannelId?: string;
  communityChannelId?: string;
  interviewChannelId?: string;
  onboardingChannelId?: string;
  alertsChannelId?: string;
  announcementsChannelId?: string;
  mentorsChannelId?: string;
  hackerRoleId?: string;
  stalledRoleId?: string;
  inviteUrl?: string;
  teamChannels?: { name: string; id: string; roleId?: string }[];
};

export type ChecklistStatus = "done" | "pending" | "todo";
export type ChecklistSource = "live" | "fixture" | "unknown";

export type ChecklistItem = {
  id: keyof PipelineFlags;
  label: string;
  done: boolean;
  status: ChecklistStatus;
  source: ChecklistSource;
  detail?: string;
};

export type JudgingRound = {
  id: string;
  ts: string;
  teamId: string;
  teamName: string;
  critic: { flaws: string[]; summary: string };
  promoter: { strengths: string[]; summary: string };
  judge: { score: number; rationale: string; scoredBy: "gemini" | "heuristic" };
  live: boolean;
};

export type AppState = {
  currentHackathonId: string;
  hackathons: HackathonSummary[];
  brief?: HackathonBrief;
  setupPending?: boolean;
  briefConfirmed?: boolean;
  attendees: Attendee[];
  teams: Team[];
  activities: Activity[];
  interviews: InterviewRubric[];
  judging: JudgingRound[];
  meetUrl?: string;
  eventName?: string;
  eventId?: string;
  eventUrl?: string;
  pipeline?: PipelineFlags;
  discord?: DiscordIds;
};

export type AgentTrace = {
  id: string;
  ts: string;
  name: string;
  input: string;
  output: string;
  ok: boolean;
  metadata?: unknown;
};
