export type SpeakerRole = "agent" | "customer" | "supervisor" | "bot" | "system" | "unknown";

export interface SpeakerContext {
  salesCall?: boolean;
  explicitRole?: SpeakerRole;
}

export interface SpeakerMappingResult {
  role: SpeakerRole;
  confidence: number;
  mappingDecision: string;
  rawSpeaker: string;
}

const AGENT_LABELS = [
  "agent", "rep", "representative", "advisor", "producer", "licensed agent",
  "insurance agent", "csr", "support", "associate", "operator", "specialist",
  "consultant", "sales rep",
];

const CUSTOMER_LABELS = [
  "customer", "caller", "client", "prospect", "lead", "buyer", "purchaser",
  "user", "patient", "member", "senior", "consumer",
];

const SUPERVISOR_LABELS = ["supervisor", "manager", "team lead", "director"];
const BOT_LABELS = ["bot", "ivr", "automated", "assistant"];
const SYSTEM_LABELS = ["system"];

function cleanSpeaker(rawSpeaker: string): string {
  return rawSpeaker
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasExactLabel(cleaned: string, labels: string[]): string | undefined {
  return labels.find(label => cleaned === label);
}

function hasRoleLabel(cleaned: string, labels: string[]): string | undefined {
  return labels.find(label =>
    cleaned === label ||
    cleaned.startsWith(`${label} `) ||
    cleaned.endsWith(` ${label}`) ||
    cleaned.includes(` ${label} `)
  );
}

export function mapSpeakerToRole(rawSpeaker: string, context?: SpeakerContext): SpeakerMappingResult {
  const cleaned = cleanSpeaker(rawSpeaker || "");

  if (context?.explicitRole) {
    return {
      role: context.explicitRole,
      confidence: 1,
      mappingDecision: `explicit override -> ${context.explicitRole}`,
      rawSpeaker,
    };
  }

  if (!cleaned || cleaned === "unknown") {
    return { role: "unknown", confidence: 0.2, mappingDecision: "empty or unknown speaker", rawSpeaker };
  }

  // Disambiguate lead before generic label checks.
  if (cleaned === "team lead") {
    return { role: "supervisor", confidence: 0.98, mappingDecision: "matched team lead -> supervisor", rawSpeaker };
  }
  if (cleaned === "lead") {
    return { role: "customer", confidence: 0.92, mappingDecision: "matched lead prospect -> customer", rawSpeaker };
  }
  if (/\blead agent\b|\blead rep\b|\blead representative\b/.test(cleaned)) {
    return { role: "agent", confidence: 0.96, mappingDecision: "matched lead agent label -> agent", rawSpeaker };
  }

  const exactSupervisor = hasExactLabel(cleaned, SUPERVISOR_LABELS);
  if (exactSupervisor) {
    return { role: "supervisor", confidence: 0.98, mappingDecision: `matched ${exactSupervisor} -> supervisor`, rawSpeaker };
  }

  const exactBot = hasExactLabel(cleaned, BOT_LABELS);
  if (exactBot) {
    return { role: "bot", confidence: 0.98, mappingDecision: `matched ${exactBot} -> bot`, rawSpeaker };
  }

  const exactSystem = hasExactLabel(cleaned, SYSTEM_LABELS);
  if (exactSystem) {
    return { role: "system", confidence: 0.98, mappingDecision: `matched ${exactSystem} -> system`, rawSpeaker };
  }

  const exactAgent = hasExactLabel(cleaned, AGENT_LABELS);
  if (exactAgent) {
    return { role: "agent", confidence: 0.98, mappingDecision: `matched ${exactAgent} -> agent`, rawSpeaker };
  }

  const exactCustomer = hasExactLabel(cleaned, CUSTOMER_LABELS);
  if (exactCustomer) {
    return { role: "customer", confidence: 0.98, mappingDecision: `matched ${exactCustomer} -> customer`, rawSpeaker };
  }

  const supervisor = hasRoleLabel(cleaned, SUPERVISOR_LABELS);
  if (supervisor) {
    return { role: "supervisor", confidence: 0.9, mappingDecision: `contained ${supervisor} -> supervisor`, rawSpeaker };
  }

  const bot = hasRoleLabel(cleaned, BOT_LABELS);
  if (bot) {
    return { role: "bot", confidence: 0.9, mappingDecision: `contained ${bot} -> bot`, rawSpeaker };
  }

  const system = hasRoleLabel(cleaned, SYSTEM_LABELS);
  if (system) {
    return { role: "system", confidence: 0.9, mappingDecision: `contained ${system} -> system`, rawSpeaker };
  }

  const agent = hasRoleLabel(cleaned, AGENT_LABELS);
  if (agent) {
    return { role: "agent", confidence: 0.9, mappingDecision: `contained ${agent} -> agent`, rawSpeaker };
  }

  const customer = hasRoleLabel(cleaned, CUSTOMER_LABELS);
  if (customer) {
    return { role: "customer", confidence: 0.9, mappingDecision: `contained ${customer} -> customer`, rawSpeaker };
  }

  return { role: "unknown", confidence: 0.35, mappingDecision: "no canonical speaker mapping matched", rawSpeaker };
}

export function speakerRoleToDisplay(role: SpeakerRole): "Agent" | "Customer" | "Supervisor" | "Bot" | "System" | "Unknown" {
  switch (role) {
    case "agent":
      return "Agent";
    case "customer":
      return "Customer";
    case "supervisor":
      return "Supervisor";
    case "bot":
      return "Bot";
    case "system":
      return "System";
    default:
      return "Unknown";
  }
}

export function isRecognizedTranscriptSpeaker(rawSpeaker: string): boolean {
  return mapSpeakerToRole(rawSpeaker).role !== "unknown";
}
