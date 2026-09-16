import { assertEquals } from "@std/assert";
import { nextAlertState } from "app/services/alert_state.ts";
import {
    CONSECUTIVE_ALERTS_THRESHOLD,
    RESOLVE_OK_THRESHOLD,
} from "app/constant.ts";

Deno.test("ok on a fresh state does nothing", () => {
    const { state, action } = nextAlertState(undefined, "ok");
    assertEquals(action, "none");
    assertEquals(state, { count: 0, okCount: 1, lastFired: false });
});

Deno.test("fires only after CONSECUTIVE_ALERTS_THRESHOLD consecutive fired checks", () => {
    let state;
    let action: string = "none";
    for (let i = 0; i < CONSECUTIVE_ALERTS_THRESHOLD - 1; i++) {
        ({ state, action } = nextAlertState(state, "fired"));
        assertEquals(action, "none");
        assertEquals(state.lastFired, false);
    }
    ({ state, action } = nextAlertState(state, "fired"));
    assertEquals(action, "alert");
    assertEquals(state.lastFired, true);
});

Deno.test("continued firing while active never re-notifies", () => {
    let state;
    for (let i = 0; i < CONSECUTIVE_ALERTS_THRESHOLD; i++) {
        state = nextAlertState(state, "fired").state;
    }
    for (let i = 0; i < 10; i++) {
        const result = nextAlertState(state, "fired");
        assertEquals(result.action, "none");
        state = result.state;
    }
});

Deno.test("a single ok check does not resolve an active alert (hysteresis)", () => {
    let state;
    for (let i = 0; i < CONSECUTIVE_ALERTS_THRESHOLD; i++) {
        state = nextAlertState(state, "fired").state;
    }
    for (let i = 0; i < RESOLVE_OK_THRESHOLD - 1; i++) {
        const result = nextAlertState(state, "ok");
        assertEquals(result.action, "none");
        assertEquals(result.state.lastFired, true);
        state = result.state;
    }
    const resolved = nextAlertState(state, "ok");
    assertEquals(resolved.action, "resolve");
    assertEquals(resolved.state.lastFired, false);
});

Deno.test("one fired check between ok checks delays the resolve", () => {
    let state;
    for (let i = 0; i < CONSECUTIVE_ALERTS_THRESHOLD; i++) {
        state = nextAlertState(state, "fired").state;
    }
    state = nextAlertState(state, "ok").state; // okCount = 1
    state = nextAlertState(state, "fired").state; // still active, okCount reset
    assertEquals(state.lastFired, true);
    // needs the full RESOLVE_OK_THRESHOLD ok streak again
    for (let i = 0; i < RESOLVE_OK_THRESHOLD - 1; i++) {
        const result = nextAlertState(state, "ok");
        assertEquals(result.action, "none");
        state = result.state;
    }
    assertEquals(nextAlertState(state, "ok").action, "resolve");
});

Deno.test("no_data freezes the state machine", () => {
    let state = nextAlertState(undefined, "fired").state; // count = 1
    state = nextAlertState(state, "no_data").state;
    assertEquals(state, { count: 1, okCount: 0, lastFired: false });
    // the fired streak resumes where it left off once data is back
    let result = nextAlertState(state, "fired");
    for (let i = 0; i < CONSECUTIVE_ALERTS_THRESHOLD - 2; i++) {
        assertEquals(result.action, "none");
        result = nextAlertState(result.state, "fired");
    }
    assertEquals(result.action, "alert");
});

Deno.test("no_data while an alert is active keeps it active", () => {
    let state;
    for (let i = 0; i < CONSECUTIVE_ALERTS_THRESHOLD; i++) {
        state = nextAlertState(state, "fired").state;
    }
    const result = nextAlertState(state, "no_data");
    assertEquals(result.action, "none");
    assertEquals(result.state.lastFired, true);
});

Deno.test("flapping around the threshold never alerts", () => {
    let state;
    for (let i = 0; i < 20; i++) {
        const status = i % 2 === 0 ? "fired" : "ok";
        const result = nextAlertState(state, status);
        assertEquals(result.action, "none");
        state = result.state;
    }
});

Deno.test("re-alerting after a resolve requires a fresh fired streak", () => {
    let state;
    for (let i = 0; i < CONSECUTIVE_ALERTS_THRESHOLD; i++) {
        state = nextAlertState(state, "fired").state;
    }
    for (let i = 0; i < RESOLVE_OK_THRESHOLD; i++) {
        state = nextAlertState(state, "ok").state;
    }
    for (let i = 0; i < CONSECUTIVE_ALERTS_THRESHOLD - 1; i++) {
        const result = nextAlertState(state, "fired");
        assertEquals(result.action, "none");
        state = result.state;
    }
    assertEquals(nextAlertState(state, "fired").action, "alert");
});
