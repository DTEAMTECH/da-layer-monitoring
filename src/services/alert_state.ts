import {
    CONSECUTIVE_ALERTS_THRESHOLD,
    RESOLVE_OK_THRESHOLD,
} from "app/constant.ts";

// Result of a single alert check.
// - "ok": condition is not violated
// - "fired": condition is violated
// - "no_data": the check could not be evaluated (metric series missing,
//   network reference unavailable, ...). Never counts as a violation.
export type CheckStatus = "ok" | "fired" | "no_data";

export interface AlertState {
    // consecutive "fired" checks (reset by "ok", frozen by "no_data")
    count: number;
    // consecutive "ok" checks while an alert is active (resolve hysteresis)
    okCount: number;
    // whether the alert notification is currently active for the user
    lastFired: boolean;
}

export type AlertAction = "alert" | "resolve" | "none";

/**
 * Pure alert state machine with hysteresis:
 * - fires only after CONSECUTIVE_ALERTS_THRESHOLD consecutive "fired" checks
 * - resolves only after RESOLVE_OK_THRESHOLD consecutive "ok" checks
 * - "no_data" freezes the machine (monitoring gaps neither fire nor resolve)
 * - while an alert is active, further "fired" checks never re-notify
 */
export function nextAlertState(
    prev: AlertState | undefined,
    status: CheckStatus,
): { state: AlertState; action: AlertAction } {
    const { count = 0, okCount = 0, lastFired = false } = prev ?? {};

    if (status === "no_data") {
        return { state: { count, okCount, lastFired }, action: "none" };
    }

    if (status === "fired") {
        const newCount = count + 1;
        const shouldAlert = !lastFired && newCount >= CONSECUTIVE_ALERTS_THRESHOLD;
        return {
            state: {
                count: newCount,
                okCount: 0,
                lastFired: lastFired || shouldAlert,
            },
            action: shouldAlert ? "alert" : "none",
        };
    }

    // status === "ok"
    const newOkCount = okCount + 1;
    const shouldResolve = lastFired && newOkCount >= RESOLVE_OK_THRESHOLD;
    return {
        state: {
            count: 0,
            okCount: shouldResolve ? 0 : newOkCount,
            lastFired: shouldResolve ? false : lastFired,
        },
        action: shouldResolve ? "resolve" : "none",
    };
}
