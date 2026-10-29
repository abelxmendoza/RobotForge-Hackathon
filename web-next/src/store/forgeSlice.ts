import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { PartialSpec } from "@/components/forge/model";
export interface ForgeState { step: number; tab: string; activeSpec: PartialSpec | null; source: string }
const initialState: ForgeState = { step: 0, tab: "words", activeSpec: null, source: "" };

const forgeSlice = createSlice({
  name: "forge",
  initialState,
  reducers: {
    setActiveRobot(state, a: PayloadAction<{spec:PartialSpec;source:string}>) { state.activeSpec=a.payload.spec;state.source=a.payload.source; },
    clearActiveRobot(state) { state.activeSpec=null;state.source=""; },
    setStep(state, a: PayloadAction<number>) { state.step = a.payload; },
    setTab(state, a: PayloadAction<string>) { state.tab = a.payload; },
  },
});
export const { setStep, setTab, setActiveRobot, clearActiveRobot } = forgeSlice.actions;
export default forgeSlice.reducer;
