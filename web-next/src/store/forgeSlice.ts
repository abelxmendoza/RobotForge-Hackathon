import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface ForgeState { step: number; tab: string }
const initialState: ForgeState = { step: 0, tab: "words" };

const forgeSlice = createSlice({
  name: "forge",
  initialState,
  reducers: {
    setStep(state, a: PayloadAction<number>) { state.step = a.payload; },
    setTab(state, a: PayloadAction<string>) { state.tab = a.payload; },
  },
});
export const { setStep, setTab } = forgeSlice.actions;
export default forgeSlice.reducer;
