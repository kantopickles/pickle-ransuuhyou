export type DemoScenario = "new" | "friend" | "blocked";
export type DemoStage = "sign-in" | "friend" | "denied" | "schedule";
export type DemoState = { scenario: DemoScenario; stage: DemoStage };
export type DemoAction =
  | { type: "sign-in" | "confirm-friend" | "skip-friend" | "retry" | "reset" }
  | { type: "scenario"; scenario: DemoScenario };

export const INITIAL_DEMO_STATE: DemoState = { scenario: "new", stage: "sign-in" };

// 画面の体験だけを再現するデモです。LINE API・認証情報・本番データには接続しません。
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "scenario": return { scenario: action.scenario, stage: "sign-in" };
    case "reset": return { ...state, stage: "sign-in" };
    case "sign-in": return state.stage === "sign-in"
      ? { ...state, stage: state.scenario === "friend" ? "schedule" : "friend" }
      : state;
    case "confirm-friend": return state.stage === "friend" ? { ...state, stage: "schedule" } : state;
    case "skip-friend": return state.stage === "friend" ? { ...state, stage: "denied" } : state;
    case "retry": return state.stage === "denied" ? { ...state, stage: "friend" } : state;
  }
}
