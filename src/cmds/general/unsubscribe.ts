import {
    EmbedBuilder,
    SlashCommandBuilder,
    SlashCommandStringOption,
} from "discord.js";
import {kv} from "app/services/storage.ts";
import type {Command} from "app/cmds/mod.ts";
import {json} from "sift/mod.ts";
import config from "app/config.ts";

const command = new SlashCommandBuilder()
    .setName("unsubscribe")
    .setDescription("Unsubscribe from updates about your node")
    .addStringOption((option: SlashCommandStringOption) =>
        option
            .setName("id")
            .setDescription("Node id (e.g. 12D3Koo... (Bridge))")
            .setRequired(true)
            .setAutocomplete(true)
    );

export const unsubscribe: Command = {
    command,
    autocomplete: async (interaction) => {
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
        const subs = [];
        for await (const {key, value} of kv.list({prefix: ["subscription", userId]})) {
            const nodeId = key[2];
            const nodeType = (value as any).nodeType ?? "Unknown";
            subs.push({value: nodeId, name: `${nodeId} (${nodeType})`});
        }
        return json({type: 8, data: {choices: subs}});
    },
    execute: async (data, interaction) => {
        if (!interaction.member) {
            const embed = new EmbedBuilder()
                .setTitle("Error")
                .setDescription("You must be in a server to use this command!")
                .setColor(0xaf3838)
                .setThumbnail("https://raw.githubusercontent.com/DTEAMTECH/contributions/refs/heads/main/celestia/utils/da_layer_metrics.png",)
                .setFooter({text: "Powered by www.dteam.tech \uD83D\uDFE0"})
            return json({type: 4, data: {embeds: [embed], flags: 64}});
        }

        const userId = interaction.member.user.id;

        const param = data.options?.find((opt) => opt.name === "id");
        if (!param || param.type !== 3) {
            const embed = new EmbedBuilder()
                .setTitle("Invalid Parameters")
                .setDescription("You must provide a valid node id")
                .setColor(0xaf3838)
                .setThumbnail("https://raw.githubusercontent.com/DTEAMTECH/contributions/refs/heads/main/celestia/utils/da_layer_metrics.png")
                .setFooter({ text: "Powered by www.dteam.tech \uD83D\uDFE0" })
            return json({type: 4, data: {embeds: [embed], flags: 64}});
        }

        const entry = await kv.get(["subscription", userId, param.value]);
        if (!entry.value) {
            const embed = new EmbedBuilder()
                .setTitle("Not Subscribed")
                .setDescription("You are not subscribed to this node id")
                .setColor(0xaf3838)
                .setThumbnail("https://raw.githubusercontent.com/DTEAMTECH/contributions/refs/heads/main/celestia/utils/da_layer_metrics.png")
                .setFooter({ text: "Powered by www.dteam.tech \uD83D\uDFE0" })
            return json({type: 4, data: {embeds: [embed], flags: 64}});
        }

        const nodeType = (entry.value as any).nodeType ?? "Unknown";
        await kv.delete(["subscription", userId, param.value]);

        const embed = new EmbedBuilder()
            .setTitle("Unsubscribed Successfully")
            .setDescription(`You have successfully unsubscribed from **\`${config.CHAIN_ID === "celestia" ? "Mainnet" : "Testnet"} ${nodeType ?? "Unknown"}\`** node **\`${param.value}\`**`)
            .setColor(0x7b2bf9)
            .setThumbnail("https://raw.githubusercontent.com/DTEAMTECH/contributions/refs/heads/main/celestia/utils/da_layer_metrics.png")
            .setFooter({text: "Powered by www.dteam.tech \uD83D\uDFE0"})
            .setTimestamp(new Date());
        return json({type: 4, data: {embeds: [embed], flags: 64}});
    },
};
