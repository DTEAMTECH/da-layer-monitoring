export const CONNECTED_PEERS_THRESHOLD = 2;
// Should be more then Promethus scrape interval in 2 times
export const SYNC_TIME_CHECK = "10m";
export const OUT_OF_SYNC_HEIGHT_THRESHOLD = 50;
// The time in minutes to consider an alert recent, to avoid spamming the user alerts
export const TIME_RECENT_ALERT_IN_MINUTES = 120;
export const CONSECUTIVE_ALERTS_THRESHOLD = 3;