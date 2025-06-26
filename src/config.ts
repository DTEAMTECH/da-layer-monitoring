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
export const getJobPrefix = () => {
  return config.CHAIN_ID === "mocha-4" ? "mocha-4/" : "celestia/";
};

export const getJobPattern = () => {
  return config.CHAIN_ID === "mocha-4" ? "mocha-4/.*" : "celestia/.*";
};

export const getNetworkType = () => {
  return config.CHAIN_ID === "mocha-4" ? "Testnet" : "Mainnet";
};

export const parseNodeType = (jobLabel: string): string | null => {
  const jobPrefix = getJobPrefix();
  
  if (!jobLabel || !jobLabel.startsWith(jobPrefix)) {
    return null;
  }
  
  // Both testnet and mainnet now use the same format: "prefix/type"
  const parts = jobLabel.split("/");
  return parts.length >= 2 ? parts[1] : null;
};

console.log(`🌐 Network config: CHAIN_ID=${config.CHAIN_ID}, JobPrefix=${getJobPrefix()}, NetworkType=${getNetworkType()}`);

export default config;
