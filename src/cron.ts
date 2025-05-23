import { kv } from "app/services/storage.ts";
import { nodesAPI } from "app/services/api.ts";
import { disApi } from "app/utils.ts";
import { EmbedBuilder } from "discord.js";
import alerts, { CheckResult } from "app/alerts.ts";
import config from "app/config.ts";
import { CONSECUTIVE_ALERTS_THRESHOLD } from "app/constant.ts";

interface Subscription {
    userId: string;
    nodeId: string;
    nodeType: string;
    subscribedAt: string;
    state?: Record<
        string,
        {
            count: number;
            lastFired: boolean;
        }
    >;
}

const createEmbed = (title: string, text: string) =>
    new EmbedBuilder()
        .setTitle(title)
        .setDescription(text)
        .setColor(title.includes("Warning") ? 0xaf3838 : 0x32b76c)
        .setThumbnail("https://raw.githubusercontent.com/DTEAMTECH/contributions/refs/heads/main/celestia/utils/da_layer_metrics.png",)
        .setFooter({text: "Powered by www.dteam.tech \uD83D\uDFE0"})
        .setTimestamp(new Date());

async function runCron() {
    try {
        const allNodeIds = await nodesAPI.getAllNodesIds();

        const checksMap = new Map<string, { name: string; message: Function; isFired: boolean }[]>();
        for (const nodeId of allNodeIds) {
            const results: { name: string; message: Function; isFired: boolean }[] = [];
            for (const alertDef of alerts) {
                let res: CheckResult;
                try {
                    res = await alertDef.check({ nodeId });
                } catch (e) {
                    console.error(`Error checking ${nodeId} / ${alertDef.name}:`, e);
                    continue;
                }
                results.push({
                    name: alertDef.name,
                    message: alertDef.message,
                    isFired: res.isFired,
                });
            }
            checksMap.set(nodeId, results);
        }

        for await (const { key, value: prev } of kv.list<Subscription>({ prefix: ["subscription"] })) {
            if (!prev || typeof prev !== "object") continue;
            const [, userId, nodeId] = key;
            const checks = checksMap.get(nodeId);
            if (!checks) continue;

            const prevState = prev.state ?? {};
            const newState: Subscription["state"] = {};

            for (const { name, message, isFired } of checks) {
                const { count: prevCount = 0, lastFired: wasActive = false } = prevState[name] || {};
                const newCount = isFired ? prevCount + 1 : 0;
                const isActive = newCount >= CONSECUTIVE_ALERTS_THRESHOLD;

                const { alertMessage, resolveMessage } = message(
                    userId,
                    nodeId,
                    prev.nodeType,
                    config.CHAIN_ID === "mocha-4" ? "Testnet" : "Mainnet",
                );
                const embedAlert = createEmbed(alertMessage.title, alertMessage.text);
                const embedResolve = createEmbed(resolveMessage.title, resolveMessage.text);

                if (isFired && isActive && !wasActive) {
                    await disApi.sendEmbedMessageUser(userId, embedAlert);
                }
                else if (!isFired && wasActive) {
                    await disApi.sendEmbedMessageUser(userId, embedResolve);
                }

                newState[name] = { count: newCount, lastFired: isActive };
            }

            await kv.set<Subscription>(["subscription", userId, nodeId], {
                ...prev,
                state: newState,
            });
        }
    } catch (error) {
        console.error("Error in runCron:", error);
        Deno.exit(1);
    }
}

await runCron();
