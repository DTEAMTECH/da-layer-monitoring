// LowPeersCount: peers in the "full" discovery set below this is critical.
// Note: celestia-node caps the discovery set at ~5 peers (PeersLimit), so
// healthy nodes report ~5 and only real connectivity drops reach 0-1.
export const CONNECTED_PEERS_THRESHOLD = 2;
// Should be more then Promethus scrape interval in 2 times
export const SYNC_TIME_CHECK = "10m";
// OutOfSync: node is considered behind when it lags the network reference
// head (quantile(0.9) over all nodes of the network) by this many blocks
export const OUT_OF_SYNC_HEIGHT_THRESHOLD = 50;
// Consecutive fired checks (one per cron run, ~5 min) before an alert
// notification is sent: 3 runs ≈ 15 min to alert
export const CONSECUTIVE_ALERTS_THRESHOLD = 3;
// Consecutive ok checks before an active alert is resolved (hysteresis,
// prevents alert/resolve ping-pong on flapping nodes): 3 runs ≈ 15 min
export const RESOLVE_OK_THRESHOLD = 3;
