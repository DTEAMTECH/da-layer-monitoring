import {
    EmbedBuilder,
    SlashCommandBuilder,
    SlashCommandStringOption,
    ApplicationCommandOptionType,
} from "discord.js";
import {kv} from "app/services/storage.ts";
import {nodesAPI} from "app/services/api.ts";
import type {Command} from "app/cmds/mod.ts";
import {json} from "sift/mod.ts";
import type {
    APIApplicationCommandAutocompleteInteraction,
} from "discord.js";
import config from "app/config.ts";

const command = new SlashCommandBuilder()
    .setName("subscribe")
    .setDescription("Subscribe for the updates about your node")
    .addStringOption((option: SlashCommandStringOption) =>
        option
            .setName("id")
            .setDescription("Node id (e.g. 12D3Koo... (Bridge))")
            .setRequired(true)
            .setAutocomplete(true)
    );

const autocomplete = async (
    interaction: APIApplicationCommandAutocompleteInteraction,
) => {
    const nodesIds = await nodesAPI.getAllNodesIds();
    const choices = await Promise.all(
        nodesIds.map(async (nodeId) => ({
            name: `${nodeId} (${(await nodesAPI.getNodeType(nodeId)) ?? "Unknown"})`,
            value: nodeId,
        })),
    );
    const find = interaction.data.options.find((o) => o.name === "id");
    if (find && find.type === ApplicationCommandOptionType.String && find.value.length) {
        const filtered = choices.filter((c) => c.name.includes(find.value));
        return json({type: 8, data: {choices: filtered.slice(0, 5)}});
    }
    return json({type: 8, data: {choices: choices.slice(0, 5)}});
};

export const subscribe: Command = {
    command,
    autocomplete,
    execute: async (data, interaction) => {
        if (!interaction.member) {
            const embed = new EmbedBuilder()
                .setTitle("Error")
                .setDescription("You must be in a server to use this command!")
                .setColor(0xaf3838)
                .setThumbnail("https://raw.githubusercontent.com/DTEAMTECH/contributions/refs/heads/main/celestia/utils/da_layer_metrics.png")
                .setFooter({text: "Powered by www.dteam.tech \uD83D\uDFE0"});
            return json({type: 4, data: {embeds: [embed], flags: 64}});
        }

        const userId = interaction.member.user.id;
        const username = interaction.member.user.username;
        const globalName = interaction.data.name;
        const subscribedAt = new Date().toISOString();

        const param = data.options?.find((opt) => opt.name === "id");
        if (!param || param.type !== 3) {
            const embed = new EmbedBuilder()
                .setTitle("Invalid Parameters")
                .setDescription("You must provide a valid node id")
                .setColor(0xaf3838)
                .setThumbnail("https://raw.githubusercontent.com/DTEAMTECH/contributions/refs/heads/main/celestia/utils/da_layer_metrics.png")
                .setFooter({text: "Powered by www.dteam.tech \uD83D\uDFE0"})
            return json({type: 4, data: {embeds: [embed], flags: 64}});
        }

        const all = await nodesAPI.getAllNodesIds();
        if (!all.includes(param.value)) {
            const embed = new EmbedBuilder()
                .setTitle("Invalid Node Id")
                .setDescription("Please check that your node id is correct and try again")
                .setColor(0xaf3838)
                .setThumbnail("https://raw.githubusercontent.com/DTEAMTECH/contributions/refs/heads/main/celestia/utils/da_layer_metrics.png",)
                .setFooter({text: "Powered by www.dteam.tech \uD83D\uDFE0"})
            return json({type: 4, data: {embeds: [embed], flags: 64}});
        }

        const nodeType = (await nodesAPI.getNodeType(param.value)) ?? "Unknown";
        const nodeInfo = await nodesAPI.buildInfo(param.value);
        if (!nodeInfo) {
            const embed = new EmbedBuilder()
                .setTitle("Error")
                .setDescription("Failed to retrieve node information")
                .setColor(0xaf3838)
                .setThumbnail("https://raw.githubusercontent.com/DTEAMTECH/contributions/refs/heads/main/celestia/utils/da_layer_metrics.png")
                .setFooter({text: "Powered by www.dteam.tech \uD83D\uDFE0"})
            return json({type: 4, data: {embeds: [embed], flags: 64}});
        }
        const labels = nodeInfo.metric.labels;

        await kv.set(["user", userId], {username, id: userId, globalName});

        await kv.set(
            ["subscription", userId, param.value],
            {
                userId,
                nodeId: param.value,
                subscribedAt,
                nodeType,
                labels,
                alerted: {},
            },
        );

        const embed = new EmbedBuilder()
            .setTitle("Subscription Success")
            .setDescription(`You have been subscribed to **\`${config.CHAIN_ID === "celestia" ? "Mainnet" : "Testnet"} ${nodeType ?? "Unknown"}\`** node **\`${param.value}\`**`)
            .setColor(0x7b2bf9)
            .setThumbnail("https://raw.githubusercontent.com/DTEAMTECH/contributions/refs/heads/main/celestia/utils/da_layer_metrics.png")
            .setFooter({text: "Powered by www.dteam.tech \uD83D\uDFE0"})
            .setTimestamp(new Date());
        return json({type: 4, data: {embeds: [embed], flags: 64}});
    },
};
