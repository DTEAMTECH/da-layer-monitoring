import { kv } from "app/services/storage.ts";
import { nodesAPI } from "app/services/api.ts";
import { disApi } from "app/utils.ts";
import { EmbedBuilder } from "discord.js";
import alerts, { CheckResult } from "app/alerts.ts";
import config, { getNetworkType } from "app/config.ts";
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
    const cronStartTime = Date.now();
    console.log(`[${new Date().toISOString()}] Starting cron execution`);
    
    try {
        console.log("Fetching all node IDs...");
        console.log(`Debug info: Prometheus URL = ${config.PROMETHEUS_URL}`);
        
        // Enhanced debugging for getAllNodesIds
        let allNodeIds: string[] = [];
        try {
            // Check basic Prometheus connectivity first
            console.log("Testing Prometheus connectivity...");
            const basicQuery = await nodesAPI.promQuery.instantQuery('up');
            console.log(`Prometheus connection OK, found ${basicQuery.result.length} 'up' metrics`);
            
            // Check what labels exist
            console.log("Checking available labels...");
            const allLabels = await nodesAPI.promQuery.labelNames();
            console.log(`Available labels: [${allLabels.slice(0, 10).join(', ')}${allLabels.length > 10 ? '...' : ''}] (${allLabels.length} total)`);
            
            // Check if exported_instance label exists
            if (allLabels.includes('exported_instance')) {
                console.log("'exported_instance' label found");
                
                // Get all exported_instance values without time filter first
                console.log("Fetching all exported_instance values (no time filter)...");
                const allInstancesNoFilter = await nodesAPI.promQuery.labelValues('exported_instance');
                console.log(`Total exported_instance values: ${allInstancesNoFilter.length}`);
                console.log(`Sample values: [${allInstancesNoFilter.slice(0, 5).join(', ')}${allInstancesNoFilter.length > 5 ? '...' : ''}]`);
                
                // Now try with time filter
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
            
            // Fallback to original method
            console.log("Falling back to original getAllNodesIds method...");
            allNodeIds = await nodesAPI.getAllNodesIds();
        }
        
        console.log(`Final result: Found ${allNodeIds.length} node IDs: [${allNodeIds.join(', ')}]`);

        const checksMap = new Map<string, { name: string; message: Function; isFired: boolean }[]>();
        let totalChecks = 0;
        let failedChecks = 0;
        
        for (const nodeId of allNodeIds) {
            console.log(`Processing node: ${nodeId}`);
            const results: { name: string; message: Function; isFired: boolean }[] = [];
            
            for (const alertDef of alerts) {
                totalChecks++;
                let res: CheckResult;
                try {
                    console.log(`  Running check: ${alertDef.name} for ${nodeId}`);
                    res = await alertDef.check({ nodeId });
                    console.log(`  ${alertDef.name}: isFired=${res.isFired}, value=${res.value} ${res.isFired ? '[FIRED]' : '[OK]'}`);
                } catch (e) {
                    failedChecks++;
                    console.error(`  Error checking ${nodeId} / ${alertDef.name}:`, e);
                    console.error(`  Failed check details: ${e instanceof Error ? e.message : 'Unknown error'}`);
                    continue;
                }
                results.push({
                    name: alertDef.name,
                    message: alertDef.message,
                    isFired: res.isFired,
                });
            }
            checksMap.set(nodeId, results);
            console.log(`Completed checks for ${nodeId}: ${results.length} successful checks`);
        }
        
        console.log(`Check summary: ${totalChecks - failedChecks}/${totalChecks} successful, ${failedChecks} failed`);

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
            
            const checks = checksMap.get(nodeId);
            if (!checks) {
                console.warn(`No checks found for nodeId: ${nodeId} (user: ${userId})`);
                continue;
            }

            const prevState = prev.state ?? {};
            const newState: Subscription["state"] = {};
            let alertsTriggered = 0;
            let alertsResolved = 0;

            for (const { name, message, isFired } of checks) {
                const { count: prevCount = 0, lastFired: wasActive = false } = prevState[name] || {};
                const newCount = isFired ? prevCount + 1 : 0;
                const isActive = newCount >= CONSECUTIVE_ALERTS_THRESHOLD;

                console.log(`  Alert ${name}: count=${newCount}, isActive=${isActive}, wasActive=${wasActive}, isFired=${isFired}`);

                try {
                    const { alertMessage, resolveMessage } = message(
                        userId,
                        nodeId,
                        prev.nodeType,
                        getNetworkType(),
                    );
                    const embedAlert = createEmbed(alertMessage.title, alertMessage.text);
                    const embedResolve = createEmbed(resolveMessage.title, resolveMessage.text);

                    if (isFired && isActive && !wasActive) {
                        console.log(`  Sending alert notification for ${name} to user ${userId}`);
                        await disApi.sendEmbedMessageUser(userId, embedAlert);
                        alertsTriggered++;
                        notificationsSent++;
                    }
                    else if (!isFired && wasActive) {
                        console.log(`  Sending resolve notification for ${name} to user ${userId}`);
                        await disApi.sendEmbedMessageUser(userId, embedResolve);
                        alertsResolved++;
                        notificationsSent++;
                    }
                } catch (error) {
                    subscriptionErrors++;
                    console.error(`  Failed to send notification for ${name} to user ${userId}:`, error);
                }

                newState[name] = { count: newCount, lastFired: isActive };
            }

            try {
                await kv.set<Subscription>(["subscription", userId, nodeId], {
                    ...prev,
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
        
        // Return success metrics for monitoring
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
        
        // Log environment information for debugging
        console.error(`Debug info:`);
        console.error(`  - PROMETHEUS_URL: ${config.PROMETHEUS_URL || 'NOT SET'}`);
        console.error(`  - BOT_TOKEN: ${config.BOT_TOKEN ? '[SET]' : '[NOT SET]'}`);
        console.error(`  - CHAIN_ID: ${config.CHAIN_ID || 'NOT SET'}`);
        
        // Instead of exiting, return error information
        // This prevents the entire process from terminating
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            duration: cronDuration
        };
    }
}

// Execute cron and handle the result
try {
    const result = await runCron();
    if (result.success) {
        console.log(`Cron completed successfully`);
    } else {
        console.error(`Cron failed: ${result.error}`);
        // Log the error but don't exit - this allows the cron to retry later
    }
} catch (unexpectedError) {
    console.error(`Unexpected error outside runCron:`, unexpectedError);
    // Even here, we don't exit - we want the process to stay alive
}
