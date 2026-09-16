import { kv } from "app/services/storage.ts";
import { nodesAPI } from "app/services/api.ts";
import { disApi } from "app/utils.ts";
import { EmbedBuilder } from "discord.js";
import alerts, { Alert, CheckResult } from "app/alerts.ts";
import {
    AlertState,
    CheckStatus,
    nextAlertState,
} from "app/services/alert_state.ts";
import config, { getNetworkType, parseNodeType } from "app/config.ts";

interface Subscription {
    userId: string;
    nodeId: string;
    nodeType: string;
    subscribedAt: string;
    state?: Record<string, AlertState>;
    labels?: Record<string, string>;
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
    const cronStartTime = Date.now();
    console.log(`[${new Date().toISOString()}] Starting cron execution`);
    
    try {
        console.log("Fetching all node IDs...");
        console.log(`Debug info: Prometheus URL = ${config.PROMETHEUS_URL}`);
        
        let allNodeIds: string[] = [];
        try {
            console.log("Testing Prometheus connectivity...");
            const basicQuery = await nodesAPI.promQuery.instantQuery('up');
            console.log(`Prometheus connection OK, found ${basicQuery.result.length} 'up' metrics`);
            
            console.log("Checking available labels...");
            const allLabels = await nodesAPI.promQuery.labelNames();
            console.log(`Available labels: [${allLabels.slice(0, 10).join(', ')}${allLabels.length > 10 ? '...' : ''}] (${allLabels.length} total)`);
            
            if (allLabels.includes('exported_instance')) {
                console.log("'exported_instance' label found");
                
                console.log("Fetching all exported_instance values (no time filter)...");
                const allInstancesNoFilter = await nodesAPI.promQuery.labelValues('exported_instance');
                console.log(`Total exported_instance values: ${allInstancesNoFilter.length}`);
                console.log(`Sample values: [${allInstancesNoFilter.slice(0, 5).join(', ')}${allInstancesNoFilter.length > 5 ? '...' : ''}]`);
                
                const date = new Date();
                date.setDate(date.getDate() - 1);
                console.log(`Using time range: ${date.toISOString()} to ${new Date().toISOString()}`);
                
                const timeFilteredInstances = await nodesAPI.promQuery.labelValues(
                    'exported_instance',
                    undefined,
                    date,
                    new Date()
                );
                console.log(`Time-filtered exported_instance values: ${timeFilteredInstances.length}`);
                
                // Apply IP filter
                const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
                const beforeFilter = timeFilteredInstances.length;
                allNodeIds = timeFilteredInstances.filter((nodeId) => !ipRegex.test(nodeId));
                console.log(`After IP filter: ${allNodeIds.length} (removed ${beforeFilter - allNodeIds.length} IP addresses)`);
                
            } else {
                console.error("'exported_instance' label NOT found in Prometheus!");
                console.log("Looking for similar labels...");
                const similarLabels = allLabels.filter(label => 
                    label.includes('instance') || 
                    label.includes('exported') || 
                    label.includes('node')
                );
                console.log(`Similar labels found: [${similarLabels.join(', ')}]`);
            }
            
        } catch (error) {
            console.error("Error during enhanced node ID fetching:", error);
            console.error("Error details:", error instanceof Error ? error.message : 'Unknown error');
            
            console.log("Falling back to original getAllNodesIds method...");
            allNodeIds = await nodesAPI.getAllNodesIds();
        }
        
        console.log(`Final result: Found ${allNodeIds.length} node IDs: [${allNodeIds.join(', ')}]`);

        // Per node: run all applicable checks once and cache the node's
        // build_info labels + parsed node type, so the subscription loop
        // below does not need to query Prometheus again.
        interface NodeCheckData {
            results: { name: string; message: Alert["message"]; status: CheckStatus }[];
            labels: Record<string, string> | null;
            nodeType: string | null;
        }
        const checksMap = new Map<string, NodeCheckData>();
        let totalChecks = 0;
        let failedChecks = 0;
        let skippedChecks = 0;

        for (const nodeId of allNodeIds) {
            console.log(`Processing node: ${nodeId}`);

            let labels: Record<string, string> | null = null;
            let nodeType: string | null = null;
            try {
                const nodeInfo = await nodesAPI.buildInfo(nodeId);
                if (nodeInfo && nodeInfo.metric && nodeInfo.metric.labels) {
                    labels = nodeInfo.metric.labels as Record<string, string>;
                    nodeType = parseNodeType(labels.exported_job || labels.job || "");
                }
            } catch {
                console.log(`  Failed to fetch build_info for ${nodeId}, node type unknown`);
            }

            const results: NodeCheckData["results"] = [];

            for (const alertDef of alerts) {
                if (alertDef.appliesTo && !alertDef.appliesTo(nodeType)) {
                    skippedChecks++;
                    console.log(`  Skipping check: ${alertDef.name} for ${nodeId} (not applicable to node type ${nodeType ?? "unknown"})`);
                    continue;
                }
                totalChecks++;
                let res: CheckResult;
                try {
                    console.log(`  Running check: ${alertDef.name} for ${nodeId}`);
                    res = await alertDef.check({ nodeId });
                    console.log(`  ${alertDef.name}: status=${res.status}, value=${res.value}${res.status === "fired" ? " [FIRED]" : res.status === "no_data" ? " [NO DATA]" : " [OK]"}`);
                } catch (e) {
                    failedChecks++;
                    console.error(`  Error checking ${nodeId} / ${alertDef.name}:`, e);
                    console.error(`  Failed check details: ${e instanceof Error ? e.message : 'Unknown error'}`);
                    continue;
                }
                results.push({
                    name: alertDef.name,
                    message: alertDef.message,
                    status: res.status,
                });
            }
            checksMap.set(nodeId, { results, labels, nodeType });
            console.log(`Completed checks for ${nodeId}: ${results.length} successful checks`);
        }

        console.log(`Check summary: ${totalChecks - failedChecks}/${totalChecks} successful, ${failedChecks} failed, ${skippedChecks} skipped (node type filter)`);

        console.log("Processing subscriptions...");
        let subscriptionsProcessed = 0;
        let notificationsSent = 0;
        let subscriptionErrors = 0;

        for await (const { key, value: prev } of kv.list<Subscription>({ prefix: ["subscription"] })) {
            subscriptionsProcessed++;
            
            if (!prev || typeof prev !== "object") {
                console.warn(`Invalid subscription data for key: ${key}`);
                continue;
            }
            
            const [, userId, nodeId] = key;
            console.log(`Processing subscription: userId=${userId}, nodeId=${nodeId}`);
            
            const nodeData = checksMap.get(nodeId);
            if (!nodeData) {
                console.warn(`No checks found for nodeId: ${nodeId} (user: ${userId})`);
                continue;
            }

            // Reuse the labels/node type fetched during the check phase.
            // Heal missing/Unknown node type (e.g. after a network migration
            // like mocha-4 -> mocha-5).
            const updatedLabels = nodeData.labels ?? prev.labels;
            let updatedNodeType = prev.nodeType;
            if ((!updatedNodeType || updatedNodeType === "Unknown") && nodeData.nodeType) {
                updatedNodeType = nodeData.nodeType;
                console.log(`  Healed node type for ${String(nodeId)}: ${updatedNodeType}`);
            }

            const prevState = prev.state ?? {};
            const newState: Subscription["state"] = {};
            let alertsTriggered = 0;
            let alertsResolved = 0;

            for (const { name, message, status } of nodeData.results) {
                const { state, action } = nextAlertState(prevState[name], status);

                console.log(`  Alert ${name}: status=${status}, count=${state.count}, okCount=${state.okCount}, active=${state.lastFired}, action=${action}`);

                if (action !== "none") {
                    try {
                        const { alertMessage, resolveMessage } = message(
                            userId,
                            String(nodeId),
                            updatedNodeType,
                            getNetworkType(),
                        );

                        if (action === "alert") {
                            console.log(`  Sending alert notification for ${name} to user ${userId}`);
                            await disApi.sendEmbedMessageUser(userId, createEmbed(alertMessage.title, alertMessage.text));
                            alertsTriggered++;
                            notificationsSent++;
                        } else {
                            console.log(`  Sending resolve notification for ${name} to user ${userId}`);
                            await disApi.sendEmbedMessageUser(userId, createEmbed(resolveMessage.title, resolveMessage.text));
                            alertsResolved++;
                            notificationsSent++;
                        }
                    } catch (error) {
                        subscriptionErrors++;
                        console.error(`  Failed to send notification for ${name} to user ${userId}:`, error);
                    }
                }

                newState[name] = state;
            }

            try {
                await kv.set<Subscription>(["subscription", userId, nodeId], {
                    ...prev,
                    nodeType: updatedNodeType,
                    labels: updatedLabels,
                    state: newState,
                });
                console.log(`  Updated state for ${userId}/${nodeId}: ${alertsTriggered} triggered, ${alertsResolved} resolved`);
            } catch (error) {
                subscriptionErrors++;
                console.error(`  Failed to update subscription state for ${userId}/${nodeId}:`, error);
            }
        }
        
        console.log(`Subscription summary: ${subscriptionsProcessed} processed, ${notificationsSent} notifications sent, ${subscriptionErrors} errors`);
        
        const cronDuration = Date.now() - cronStartTime;
        console.log(`[${new Date().toISOString()}] Cron execution completed successfully in ${cronDuration}ms`);
        
        return {
            success: true,
            duration: cronDuration,
            nodeCount: allNodeIds.length,
            totalChecks: totalChecks - failedChecks,
            failedChecks,
            subscriptionsProcessed,
            notificationsSent,
            subscriptionErrors
        };
        
    } catch (error) {
        const cronDuration = Date.now() - cronStartTime;
        console.error(`[${new Date().toISOString()}] CRITICAL ERROR in runCron after ${cronDuration}ms:`, error);
        console.error(`Error stack:`, error instanceof Error ? error.stack : 'No stack trace available');
        
        console.error(`Debug info:`);
        console.error(`  - PROMETHEUS_URL: ${config.PROMETHEUS_URL || 'NOT SET'}`);
        console.error(`  - BOT_TOKEN: ${config.BOT_TOKEN ? '[SET]' : '[NOT SET]'}`);
        console.error(`  - CHAIN_ID: ${config.CHAIN_ID || 'NOT SET'}`);
        
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            duration: cronDuration
        };
    }
}

try {
    const result = await runCron();
    if (result.success) {
        console.log(`Cron completed successfully`);
    } else {
        console.error(`Cron failed: ${result.error}`);
    }
} catch (unexpectedError) {
    console.error(`Unexpected error outside runCron:`, unexpectedError);
}
