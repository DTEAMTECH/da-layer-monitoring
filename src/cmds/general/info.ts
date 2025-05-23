import {
    EmbedBuilder,
    SlashCommandBuilder,
    SlashCommandStringOption,
} from "discord.js";
import {kv} from "app/services/storage.ts";
import {nodesAPI} from "app/services/api.ts";
import alerts from "app/alerts.ts";
import type {Command} from "app/cmds/mod.ts";
import {json} from "sift/mod.ts";
import type {
    APIApplicationCommandAutocompleteInteraction,
} from "discord.js";
import config from "app/config.ts";

interface SubRecord {
    nodeType?: string;
    labels?: Record<string, string>;
    alerted?: Record<string, string>;
}

const command = new SlashCommandBuilder()
    .setName("info")
    .setDescription("Get information about your subscribed node")
    .addStringOption((option: SlashCommandStringOption) =>
        option
            .setName("id")
            .setDescription("Subscribed node id")
            .setRequired(true)
            .setAutocomplete(true)
    );

const autocomplete = async (interaction: APIApplicationCommandAutocompleteInteraction) => {
    if (!interaction.member) return json({type: 4, data: {}});
    const userId = interaction.member.user.id;
    const choices: { name: string; value: string }[] = [];
    for await (const {key, value} of kv.list({prefix: ["subscription", userId]})) {
        const nodeId = key[2];
        const nodeType = (value as SubRecord).nodeType ?? "Unknown";
        choices.push({name: `${nodeId} (${nodeType})`, value: nodeId});
    }
    return json({type: 8, data: {choices}});
};

export const info: Command = {
    command,
    autocomplete,
    execute: async (_data, interaction) => {
        if (!interaction.member) {
            const embed = new EmbedBuilder()
                .setTitle("Error")
                .setDescription("You must be in a server to use this command!")
                .setColor(0xaf3838)
                .setThumbnail("https://raw.githubusercontent.com/DTEAMTECH/contributions/refs/heads/main/celestia/utils/da_layer_metrics.png")
                .setFooter({ text: "Powered by www.dteam.tech \uD83D\uDFE0" });
            return json({type: 4, data: {embeds: [embed], flags: 64}});
        }

        const userId = interaction.member.user.id;
        const param = _data.options?.find((o) => o.name === "id");
        if (!param) {
            const embed = new EmbedBuilder()
                .setTitle("Missing Parameters")
                .setDescription("You must provide a node id")
                .setColor(0xaf3838)
                .setThumbnail("https://raw.githubusercontent.com/DTEAMTECH/contributions/refs/heads/main/celestia/utils/da_layer_metrics.png",)
                .setFooter({text: "Powered by www.dteam.tech \uD83D\uDFE0"})
            return json({type: 4, data: {embeds: [embed], flags: 64}});
        }

        const nodeId = param.value;
        const entry = await kv.get<SubRecord>(["subscription", userId, nodeId]);
        if (!entry.value) {
            const embed = new EmbedBuilder()
                .setTitle("Invalid Node Id")
                .setDescription("You are not subscribed to that node id")
                .setColor(0xaf3838)
                .setThumbnail("https://raw.githubusercontent.com/DTEAMTECH/contributions/refs/heads/main/celestia/utils/da_layer_metrics.png",)
                .setFooter({text: "Powered by www.dteam.tech \uD83D\uDFE0"})
            return json({type: 4, data: {embeds: [embed], flags: 64}});
        }

        const sub = entry.value;
        const nodeType = sub.nodeType ?? "Unknown";

        let labels = sub.labels;
        if (!labels) {
            const info = await nodesAPI.buildInfo(nodeId);
            labels = info?.metric.labels ?? {};
        }

        const liveAlerts: string[] = [];
        for (const alertDef of alerts) {
            let result;
            try {
                result = await alertDef.check({nodeId});
            } catch {
                continue;
            }
            if (result.isFired) {
                liveAlerts.push(alertDef.name);
            }
        }
        const alertMsg = liveAlerts.length > 0
            ? `\u{1F534} You have ${liveAlerts.length}/4 active alerts: ${liveAlerts.join(", ")}`
            : "\u{1F7E2} Your node is synced and has no active alerts.";

        const details = `**Build Version:** ${labels.semantic_version ?? "N/A"}\n` +
            `**Go Version:** ${labels.golang_version ?? "N/A"}\n` +
            `**Last Commit:** ${labels.last_commit ?? "N/A"}\n` +
            `**Build Time:** ${labels.build_time ?? "N/A"}\n` +
            `**System Version:** ${labels.system_version ?? "N/A"}`;

        const embed = new EmbedBuilder()
            .setTitle("Subscribed Node Information")
            .setColor(0x7b2bf9)
            .setThumbnail("https://raw.githubusercontent.com/DTEAMTECH/contributions/refs/heads/main/celestia/utils/da_layer_metrics.png",)
            .setFooter({text: "Powered by www.dteam.tech \uD83D\uDFE0"})
            .setTimestamp(new Date())
            .addFields([
                { name: "Node Id", value: `**\`${labels.exported_instance ?? "Unknown"}\`**`, inline: false},
                { name: "Node Type", value: `**\`${nodeType ?? "Unknown"}\`**`, inline: false },
                { name: "Chain ID", value: `**\`${config.CHAIN_ID ?? "Unknown"}\`**`, inline: false },
                { name: "Alerts", value: `**\`${alertMsg}\`**`, inline: false },
                { name: "", value: "", inline: false },
                { name: "Node Details", value: details, inline: false }
            ]);

        return json({type: 4, data: {embeds: [embed], flags: 64}});
    },
};
