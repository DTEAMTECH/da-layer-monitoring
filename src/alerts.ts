import {
    CONNECTED_PEERS_THRESHOLD,
    OUT_OF_SYNC_HEIGHT_THRESHOLD,
    SYNC_TIME_CHECK,
} from "app/constant.ts";
import { nodesAPI } from "app/services/api.ts";
import config, { getJobPattern, getNetworkType } from "app/config.ts";

type checkPayload = {
    nodeId: string;
};

type Message = {
    title: string;
    text: string;
};

export type CheckResult = {
    isFired: boolean;
    value: number | string;
};

export type Alert = {
    name: string;
    message: (userId: string, nodeId: string, nodeType: string) => {
        alertMessage: Message;
        resolveMessage: Message;
    };
    check(
        payload: checkPayload,
    ): Promise<{
        isFired: boolean;
        value: number | string;
    }>;
};

async function highstsubjectiveHeadGauge() {
    const CACHE_TTL_MS = 60000;
    const now = Date.now();
    
    // Check if cache is valid (exists and not expired)
    if (highstsubjectiveHeadGauge.cache && 
        highstsubjectiveHeadGauge.cacheTimestamp && 
        (now - highstsubjectiveHeadGauge.cacheTimestamp) < CACHE_TTL_MS) {
        console.log(`Using cached highstsubjectiveHeadGauge: ${highstsubjectiveHeadGauge.cache}`);
        return highstsubjectiveHeadGauge.cache;
    }

    console.log(`Fetching fresh highstsubjectiveHeadGauge data...`);
    
    try {
        // Use centralized network-aware logic
        const jobPattern = getJobPattern();
        console.log(`Fetching max head gauge with job pattern: "${jobPattern}"`);
        
        const result = await nodesAPI.promQuery.instantQuery(
            `max(hdr_sync_subjective_head_gauge{exported_job=~"${jobPattern}"})`,
        );

        const value = result.result[0]?.value?.value ?? null;
        
        // Update cache with timestamp
        highstsubjectiveHeadGauge.cache = value;
        highstsubjectiveHeadGauge.cacheTimestamp = now;
        
        console.log(`Updated highstsubjectiveHeadGauge cache: ${value}`);
        return value;
    } catch (error) {
        console.error(`Failed to fetch highstsubjectiveHeadGauge:`, error);
        // Return cached value if available, even if expired, rather than failing completely
        if (highstsubjectiveHeadGauge.cache !== null) {
            console.warn(`Using stale cached value due to fetch error: ${highstsubjectiveHeadGauge.cache}`);
            return highstsubjectiveHeadGauge.cache;
        }
        throw error;
    }
}

highstsubjectiveHeadGauge.cache = null as null | number;
highstsubjectiveHeadGauge.cacheTimestamp = null as null | number;

const alerts = [
    {
        name: "LowPeersCount",
        message: (userId: string, nodeId: string, nodeType: string, networkType: string) => ({
            alertMessage: {
                title: "**Warning!** Low Peer Count Alert",
                text: `**<@${userId}> take action! Your${" \`" + networkType + " " + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** has fewer than ${CONNECTED_PEERS_THRESHOLD} connected peers.`,
            },
            resolveMessage: {
                title: "**Resolved!** Low Peer Count Alert",
                text: `**<@${userId}> you can chillin' now! Your${" \`" + networkType + " " + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** now has more than ${CONNECTED_PEERS_THRESHOLD} connected peers.`,
            },
        }),
        async check(payload: checkPayload) {
            const { nodeId } = payload;
            // Try exported_instance first, then instance
            let connectedPeers;
            try {
                connectedPeers = await nodesAPI.promQuery.instantQuery(
                    `full_discovery_amount_of_peers{exported_instance="${nodeId}"}`,
                );
                if (!connectedPeers.result || connectedPeers.result.length === 0) {
                    connectedPeers = await nodesAPI.promQuery.instantQuery(
                        `full_discovery_amount_of_peers{instance="${nodeId}"}`,
                    );
                }
            } catch (error) {
                connectedPeers = await nodesAPI.promQuery.instantQuery(
                    `full_discovery_amount_of_peers{instance="${nodeId}"}`,
                );
            }
            const [data] = connectedPeers.result;
            return {
                isFired: !data || data.value.value < CONNECTED_PEERS_THRESHOLD,
                value: data ? data.value.value : 0,
            };
        },
    },
    {
        name: "StalledBlocks",
        message: (userId: string, nodeId: string, nodeType: string, networkType: string) => ({
            alertMessage: {
                title: "**Warning!** Stalled Blocks Alert",
                text: `**<@${userId}> take action! Your${" \`" + networkType + " " + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** has stalled blocks.`,
            },
            resolveMessage: {
                title: "**Resolved!** Stalled Blocks Alert",
                text: `**<@${userId}> you can chillin' now! Your${" \`" + networkType + " " + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** has no stalled blocks now.`,
            },
        }),
        async check(payload: checkPayload) {
            const { nodeId } = payload;
            let hightChange;
            try {
                hightChange = await nodesAPI.promQuery.instantQuery(
                    `increase(hdr_sync_subjective_head_gauge{exported_instance="${nodeId}"}[${SYNC_TIME_CHECK}])`,
                );
                if (!hightChange.result || hightChange.result.length === 0) {
                    hightChange = await nodesAPI.promQuery.instantQuery(
                        `increase(hdr_sync_subjective_head_gauge{instance="${nodeId}"}[${SYNC_TIME_CHECK}])`,
                    );
                }
            } catch (error) {
                hightChange = await nodesAPI.promQuery.instantQuery(
                    `increase(hdr_sync_subjective_head_gauge{instance="${nodeId}"}[${SYNC_TIME_CHECK}])`,
                );
            }
            const [data] = hightChange.result;
            return {
                isFired: !data || data.value.value === 0,
                value: data ? data.value.value : 0,
            };
        },
    },
    {
        name: "OutOfSync",
        message: (userId: string, nodeId: string, nodeType: string, networkType: string) => ({
            alertMessage: {
                title: "**Warning!** Node Sync Alert",
                text: `**<@${userId}> take action! Your${" \`" + networkType + " " + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** is out of sync.`,
            },
            resolveMessage: {
                title: "**Resolved!** Node Sync Alert",
                text: `**<@${userId}> you can chillin' now! Your${" \`" + networkType + " " + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** is synced now.`,
            },
        }),
        async check(payload: checkPayload) {
            const { nodeId } = payload;
            const highestSubjectiveHeadGaugeValue = await highstsubjectiveHeadGauge();
            let hightOfNodeResult;
            try {
                hightOfNodeResult = await nodesAPI.promQuery
                    .instantQuery(
                        `hdr_sync_subjective_head_gauge{exported_instance="${nodeId}"}`,
                    );
                if (!hightOfNodeResult.result || hightOfNodeResult.result.length === 0) {
                    hightOfNodeResult = await nodesAPI.promQuery
                        .instantQuery(
                            `hdr_sync_subjective_head_gauge{instance="${nodeId}"}`,
                        );
                }
            } catch (error) {
                hightOfNodeResult = await nodesAPI.promQuery
                    .instantQuery(
                        `hdr_sync_subjective_head_gauge{instance="${nodeId}"}`,
                    );
            }
            const [data] = hightOfNodeResult.result;
            return {
                isFired: !data ||
                    highestSubjectiveHeadGaugeValue === null ||
                    highestSubjectiveHeadGaugeValue - data.value.value >
                    OUT_OF_SYNC_HEIGHT_THRESHOLD,
                value: data ? data.value.value : 0,
            };
        },
    },
    {
        name: "NoArchivalPeers",
        message: (userId: string, nodeId: string, nodeType: string, networkType: string) => ({
            alertMessage: {
                title: "**Warning!** No Archival Peers Alert",
                text: `**<@${userId}> take action! Your${" \`" + networkType + " " + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** has no archival peers.`,
            },
            resolveMessage: {
                title: "**Resolved!** No Archival Peers Alert",
                text: `**<@${userId}> you can chillin' now! Your${" \`" + networkType + " " + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** now has archival peers.`,
            },
        }),
        async check(payload: checkPayload) {
            const { nodeId } = payload;
            let connectedPeers;
            try {
                connectedPeers = await nodesAPI.promQuery.instantQuery(
                    `archival_discovery_amount_of_peers{exported_instance="${nodeId}"}`,
                );
                if (!connectedPeers.result || connectedPeers.result.length === 0) {
                    connectedPeers = await nodesAPI.promQuery.instantQuery(
                        `archival_discovery_amount_of_peers{instance="${nodeId}"}`,
                    );
                }
            } catch (error) {
                connectedPeers = await nodesAPI.promQuery.instantQuery(
                    `archival_discovery_amount_of_peers{instance="${nodeId}"}`,
                );
            }
            const [data] = connectedPeers.result;
            return {
                isFired: !data || data.value.value < 1,
                value: data ? data.value.value : 0,
            };
        },
    },
];

export default alerts as Alert[];

// const alertsMock = [
//     {
//         name: "LowPeersCount",
//         message: (userId: string, nodeId: string, nodeType: string) => ({
//             alertMessage: {
//                 title: "**Warning!** Low Peer Count Alert",
//                 text: `**<@${userId}> take action! Your${" \`" + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** has fewer than ${CONNECTED_PEERS_THRESHOLD} connected peers.`,
//             },
//             resolveMessage: {
//                 title: "**Resolved!** Low Peer Count Alert",
//                 text: `**<@${userId}> you can chillin' now! Your${" \`" + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** now has more than ${CONNECTED_PEERS_THRESHOLD} connected peers.`,
//             },
//         }),
//         async check(payload: checkPayload) {
//             return {
//                 isFired: false,
//                 value: 1,
//             };
//         },
//     },
//     {
//         name: "StalledBlocks",
//         message: (userId: string, nodeId: string, nodeType: string) => ({
//             alertMessage: {
//                 title: "**Warning!** Stalled Blocks Alert",
//                 text: `**<@${userId}> take action! Your${" \`" + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** has stalled blocks.`,
//             },
//             resolveMessage: {
//                 title: "**Resolved!** Stalled Blocks Alert",
//                 text: `**<@${userId}> you can chillin' now! Your${" \`" + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** has no stalled blocks now.`,
//             },
//         }),
//         async check(payload: checkPayload) {
//             return {
//                 isFired: false,
//                 value: 1,
//             };
//         },
//     },
//     {
//         name: "OutOfSync",
//         message: (userId: string, nodeId: string, nodeType: string) => ({
//             alertMessage: {
//                 title: "**Warning!** Node Sync Alert",
//                 text: `**<@${userId}> take action! Your${" \`" + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** is out of sync.`,
//             },
//             resolveMessage: {
//                 title: "**Resolved!** Node Sync Alert",
//                 text: `**<@${userId}> you can chillin' now! Your${" \`" + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** is synced now.`,
//             },
//         }),
//         async check(payload: checkPayload) {
//             return {
//                 isFired: false,
//                 value: 0,
//             };
//         },
//     },
//     {
//         name: "NoArchivalPeers",
//         message: (userId: string, nodeId: string, nodeType: string) => ({
//             alertMessage: {
//                 title: "**Warning!** No Archival Peers Alert",
//                 text: `**<@${userId}> take action! Your${" \`" + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** has no archival peers.`,
//             },
//             resolveMessage: {
//                 title: "**Resolved!** No Archival Peers Alert",
//                 text: `**<@${userId}> you can chillin' now! Your${" \`" + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** now has archival peers.`,
//             },
//         }),
//         async check(payload: checkPayload) {
//             return {
//                 isFired: false,
//                 value: 0,
//             };
//         },
//     },
// ];
//
// export default alertsMock as Alert[];