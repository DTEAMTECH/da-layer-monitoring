import "jsr:@std/dotenv/load";

const config = {
  CHAIN_ID: Deno.env.get("CHAIN_ID") as string,
  BOT_TOKEN: Deno.env.get("BOT_TOKEN") as string,
  CLIENT_ID: Deno.env.get("CLIENT_ID") as string,
  GUILD_ID: Deno.env.get("GUILD_ID") as string,
  DISCORD_PUBLIC_KEY: Deno.env.get("DISCORD_PUBLIC_KEY") as string,
  PROMETHEUS_URL: Deno.env.get("PROMETHEUS_URL") as string,
  BOT_CHANNEL_ID: Deno.env.get("BOT_CHANNEL_ID") as string,
  // don't need for Deno deploy
  KV_PATH: Deno.env.get("KV_PATH") as string,
};

// Network-aware helper functions
// Mainnet chain id is "celestia"; any other chain id (e.g. "mocha-4", "mocha-5")
// is treated as a testnet. Nothing is tied to a specific testnet chain id, so
// testnet migrations (mocha-4 -> mocha-5) only require updating CHAIN_ID.
export const isMainnet = () => {
  return config.CHAIN_ID?.toLowerCase() === "celestia";
};

export const getJobPrefix = () => {
  return `${config.CHAIN_ID}/`;
};

export const getJobPattern = () => {
  return `${config.CHAIN_ID}/.*`;
};

export const getNetworkType = () => {
  return isMainnet() ? "Mainnet" : "Testnet";
};

// Known celestia DA node types (job labels use the "<network>/<type>" format,
// e.g. "celestia/bridge" or "mocha-5/bridge").
const KNOWN_NODE_TYPES = ["bridge", "full", "light"];

const capitalize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

export const parseNodeType = (jobLabel: string): string | null => {
  if (!jobLabel || !jobLabel.includes("/")) {
    return null;
  }

  // Job format: "<network>/<type>", take the last segment as the node type
  const parts = jobLabel.split("/");
  const rawType = parts[parts.length - 1]?.trim();
  if (!rawType) {
    return null;
  }

  // Prefer jobs of the currently configured network
  if (jobLabel.startsWith(getJobPrefix())) {
    return capitalize(rawType);
  }

  // Fallback: accept "<network>/<known type>" from any network. This keeps
  // node type detection working while a network migrates to a new chain id
  // (e.g. mocha-4 -> mocha-5) and stale jobs with the old prefix still exist.
  if (KNOWN_NODE_TYPES.includes(rawType.toLowerCase())) {
    return capitalize(rawType);
  }

  return null;
};

console.log(`Network config: CHAIN_ID=${config.CHAIN_ID}, JobPrefix=${getJobPrefix()}, NetworkType=${getNetworkType()}`);

export default config;
