import {kv} from "app/services/storage.ts";
import {nodesAPI} from "app/services/api.ts";
import {disApi, isRecent} from "app/utils.ts";
import {EmbedBuilder} from "discord.js";
import alerts, {CheckResult} from "app/alerts.ts";
import config from "app/config.ts";

interface Subscription {
    userId: string;
    nodeId: string;
    nodeType: string;
    subscribedAt: string;
    alerted: Record<string, string>;
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

        const checksMap = new Map<
            string,
            { name: string; message: Function; isFired: boolean }[]
        >();
        for (const nodeId of allNodeIds) {
            const results: { name: string; message: Function; isFired: boolean }[] = [];
            for (const alertDef of alerts) {
                let res: CheckResult;
                try {
                    res = await alertDef.check({nodeId});
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

        for await (const {key, value} of kv.list<Subscription>({prefix: ["subscription"]})) {
            if (!value || typeof value !== "object") continue;
            const [_, userId, nodeId] = key;
            const checks = checksMap.get(nodeId);
            if (!checks) continue;

            const prev = value;
            const prevAlerted = prev.alerted ?? {};
            const newAlerted: Record<string, string> = {};
            const networkType = config.CHAIN_ID === "mocha-4" ? "Testnet" : "Mainnet";

            for (const {name, message, isFired} of checks) {
                const {alertMessage, resolveMessage} = message(
                    userId,
                    nodeId,
                    prev.nodeType,
                    networkType,
                );
                const embed = isFired
                    ? createEmbed(alertMessage.title, alertMessage.text)
                    : createEmbed(resolveMessage.title, resolveMessage.text);

                if (isFired) {
                    const prevTs = prevAlerted[name];
                    if (prevTs && isRecent(prevTs)) {
                        newAlerted[name] = prevTs;
                    } else {
                        await disApi.sendEmbedMessageUser(userId, embed);
                        newAlerted[name] = new Date().toISOString();
                    }
                } else if (prevAlerted[name]) {
                    await disApi.sendEmbedMessageUser(userId, embed);
                }
            }

            await kv.set<Subscription>(["subscription", userId, nodeId], {
                ...prev,
                alerted: newAlerted,
            });
        }
    } catch (error) {
        console.error("Error in runCron:", error);
        Deno.exit(1);
    }
}

await runCron();
