import { InstantVector, PrometheusDriver } from "prometheus-query";
import config, { getJobPrefix, parseNodeType } from "app/config.ts";

class NodesAPI {
  public promQuery: PrometheusDriver;

  constructor(public promURL: string) {
    this.promURL = promURL;
    this.promQuery = new PrometheusDriver({
      endpoint: this.promURL,
      baseURL: "/api/v1",
    });
  }

  public async getAllNodesIds(): Promise<string[]> {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    
    // Try exported_instance first, then fallback to instance
    let data: string[] = [];
    try {
      console.log("Trying 'exported_instance' label...");
      data = await this.promQuery.labelValues(
          "exported_instance",
          undefined,
          date,
          new Date()
      );
      console.log(`Found ${data.length} exported_instance values`);
    } catch (error) {
      console.log("'exported_instance' failed, trying 'instance' label...");
      try {
        data = await this.promQuery.labelValues(
            "instance",
            undefined,
            date,
            new Date()
        );
        console.log(`Found ${data.length} instance values`);
      } catch (instanceError) {
        console.error("Both 'exported_instance' and 'instance' failed:", instanceError);
        return [];
      }
    }
    
    const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
    const filtered = data.filter((nodeId) => !ipRegex.test(nodeId));
    console.log(`After IP filter: ${filtered.length} nodes (removed ${data.length - filtered.length} IPs)`);
    console.log(`Node IDs: [${filtered.slice(0, 3).join(', ')}${filtered.length > 3 ? '...' : ''}]`);
    
    return filtered;
  }

  public async buildInfo(nodeId: string): Promise<InstantVector | null> {
    let data;
    try {
      data = await this.promQuery.instantQuery(
          `build_info{exported_instance="${nodeId}"}`
      );
      if (!data.result || data.result.length === 0) {
        data = await this.promQuery.instantQuery(
            `build_info{instance="${nodeId}"}`
        );
      }
    } catch (error) {
      data = await this.promQuery.instantQuery(
          `build_info{instance="${nodeId}"}`
      );
    }
    if (!data.result || data.result.length === 0) {
      return null;
    }
    return data.result[0];
  }

  public async getNodeType(nodeId: string): Promise<string | null> {
    try {
      let data;
      try {
        data = await this.promQuery.instantQuery(
            `build_info{exported_instance="${nodeId}"}`
        );
        if (!data.result || data.result.length === 0) {
          data = await this.promQuery.instantQuery(
              `build_info{instance="${nodeId}"}`
          );
        }
      } catch (error) {
        data = await this.promQuery.instantQuery(
            `build_info{instance="${nodeId}"}`
        );
      }
      
      if (!data.result || data.result.length === 0) {
        return null;
      }

      // Use centralized network-aware logic
      const jobPrefix = getJobPrefix();
      console.log(`Looking for job labels with prefix: "${jobPrefix}" (CHAIN_ID: ${config.CHAIN_ID})`);

      for (const result of data.result) {
        const jobLabel: string | undefined = result.metric.labels.exported_job || result.metric.labels.job;
        console.log(`Found job label: "${jobLabel}"`);

        const nodeType = parseNodeType(jobLabel || "");
        if (nodeType) {
          console.log(`Extracted node type: "${nodeType}" from job label: "${jobLabel}"`);
          return nodeType;
        }
      }
      return null;
    } catch (error) {
      console.error(`Error while getting type of node ${nodeId}:`, error);
      return null;
    }
  }
}

export const nodesAPI = new NodesAPI(config.PROMETHEUS_URL);