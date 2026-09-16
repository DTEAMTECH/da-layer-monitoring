import {
    CONNECTED_PEERS_THRESHOLD,
    OUT_OF_SYNC_HEIGHT_THRESHOLD,
    SYNC_TIME_CHECK,
} from "app/constant.ts";
import { nodesAPI } from "app/services/api.ts";
import type { CheckStatus } from "app/services/alert_state.ts";
import { getJobPattern } from "app/config.ts";
import type { InstantVector } from "prometheus-query";

type checkPayload = {
    nodeId: string;
};

type Message = {
    title: string;
    text: string;
};

export type CheckResult = {
    status: CheckStatus;
    value: number | string;
};

export type Alert = {
    name: string;
    // Optional node-type filter: when it returns false the check is skipped
    // entirely for that node (e.g. light nodes legitimately report 0
    // archival peers, so NoArchivalPeers does not apply to them).
    // nodeType is null when it could not be determined; checks run in that
    // case unless the filter explicitly handles null otherwise.
    appliesTo?: (nodeType: string | null) => boolean;
    message: (
        userId: string,
        nodeId: string,
        nodeType: string,
        networkType: string,
    ) => {
        alertMessage: Message;
        resolveMessage: Message;
    };
    check(payload: checkPayload): Promise<CheckResult>;
};

// Runs a PromQL expression for a node, trying the exported_instance label
// first and falling back to instance. Returns the first series or null when
// the node has no data for this expression.
async function queryNodeSeries(
    expr: (label: string, nodeId: string) => string,
    nodeId: string,
): Promise<InstantVector | null> {
    let data;
    try {
        data = await nodesAPI.promQuery.instantQuery(
            expr("exported_instance", nodeId),
        );
        if (!data.result || data.result.length === 0) {
            data = await nodesAPI.promQuery.instantQuery(
                expr("instance", nodeId),
            );
        }
    } catch {
        try {
            data = await nodesAPI.promQuery.instantQuery(
                expr("instance", nodeId),
            );
        } catch {
            return null;
        }
    }
    if (!data.result || data.result.length === 0) {
        return null;
    }
    return data.result[0];
}

// Network reference head: quantile(0.9) over all nodes of this network.
// quantile is used instead of max so a single rogue/misconfigured node
// reporting an inflated height cannot make the whole network look out of
// sync. Cached for 60s; null when it cannot be determined (callers must
// treat that as "no_data", never as a violation).
async function networkReferenceHead(): Promise<number | null> {
    const CACHE_TTL_MS = 60000;
    const now = Date.now();

    if (
        networkReferenceHead.cache !== null &&
        networkReferenceHead.cacheTimestamp !== null &&
        (now - networkReferenceHead.cacheTimestamp) < CACHE_TTL_MS
    ) {
        return networkReferenceHead.cache;
    }

    try {
        const jobPattern = getJobPattern();
        const result = await nodesAPI.promQuery.instantQuery(
            `quantile(0.9, hdr_sync_subjective_head_gauge{exported_job=~"${jobPattern}"})`,
        );
        const raw = result.result[0]?.value?.value;
        const value = raw === null || raw === undefined ? null : Number(raw);
        if (value !== null && !Number.isFinite(value)) {
            return networkReferenceHead.cache;
        }
        networkReferenceHead.cache = value;
        networkReferenceHead.cacheTimestamp = now;
        return value;
    } catch (error) {
        console.error(`Failed to fetch network reference head:`, error);
        return networkReferenceHead.cache;
    }
}

networkReferenceHead.cache = null as null | number;
networkReferenceHead.cacheTimestamp = null as null | number;

const alerts: Alert[] = [
    {
        // Fires when the node stops reporting metrics at all (build_info
        // series missing): the node is down or its metrics pipeline is
        // broken. All other checks return "no_data" in that situation and
        // stay frozen, so a downed node produces exactly this one alert.
        name: "NodeDown",
        message: (userId, nodeId, nodeType, networkType) => ({
            alertMessage: {
                title: "**Warning!** Node Down Alert",
                text: `**<@${userId}> take action! Your${" \`" + networkType + " " + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** is not reporting metrics. The node may be down or its metrics pipeline is broken.`,
            },
            resolveMessage: {
                title: "**Resolved!** Node Down Alert",
                text: `**<@${userId}> you can chillin' now! Your${" \`" + networkType + " " + nodeType + "\` " || " "}node**\n\n**\`${nodeId}\`** is reporting metrics again.`,
            },
        }),
        async check(payload: checkPayload) {
            const info = await nodesAPI.buildInfo(payload.nodeId);
            return {
                status: info ? "ok" : "fired",
                value: info ? 1 : 0,
            };
        },
    },
    {
        name: "LowPeersCount",
        message: (userId, nodeId, nodeType, networkType) => ({
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
            const data = await queryNodeSeries(
                (label, nodeId) =>
                    `full_discovery_amount_of_peers{${label}="${nodeId}"}`,
                payload.nodeId,
            );
            if (!data) return { status: "no_data", value: 0 };
            return {
                status: data.value.value < CONNECTED_PEERS_THRESHOLD
                    ? "fired"
                    : "ok",
                value: data.value.value,
            };
        },
    },
    {
        name: "StalledBlocks",
        message: (userId, nodeId, nodeType, networkType) => ({
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
            const data = await queryNodeSeries(
                (label, nodeId) =>
                    `increase(hdr_sync_subjective_head_gauge{${label}="${nodeId}"}[${SYNC_TIME_CHECK}])`,
                payload.nodeId,
            );
            if (!data) return { status: "no_data", value: 0 };
            return {
                status: data.value.value === 0 ? "fired" : "ok",
                value: data.value.value,
            };
        },
    },
    {
        name: "OutOfSync",
        message: (userId, nodeId, nodeType, networkType) => ({
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
            const referenceHead = await networkReferenceHead();
            // Without a trustworthy network reference we cannot evaluate
            // sync status — never treat this as a violation.
            if (referenceHead === null) return { status: "no_data", value: 0 };

            const data = await queryNodeSeries(
                (label, nodeId) =>
                    `hdr_sync_subjective_head_gauge{${label}="${nodeId}"}`,
                payload.nodeId,
            );
            if (!data) return { status: "no_data", value: 0 };
            return {
                status:
                    referenceHead - data.value.value > OUT_OF_SYNC_HEIGHT_THRESHOLD
                        ? "fired"
                        : "ok",
                value: data.value.value,
            };
        },
    },
    {
        name: "NoArchivalPeers",
        // Light nodes legitimately report 0 archival peers: the archival
        // rendezvous set contains only archival full/bridge nodes (a small
        // subset of the network) and light nodes never advertise on it.
        appliesTo: (nodeType) => nodeType !== "Light",
        message: (userId, nodeId, nodeType, networkType) => ({
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
            const data = await queryNodeSeries(
                (label, nodeId) =>
                    `archival_discovery_amount_of_peers{${label}="${nodeId}"}`,
                payload.nodeId,
            );
            if (!data) return { status: "no_data", value: 0 };
            return {
                status: data.value.value < 1 ? "fired" : "ok",
                value: data.value.value,
            };
        },
    },
];

export default alerts;
