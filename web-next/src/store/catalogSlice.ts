import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface CatalogState { drivetrain: string; verdict: string; query: string }
const initialState: CatalogState = { drivetrain: "all", verdict: "all", query: "" };

const catalogSlice = createSlice({
  name: "catalog",
  initialState,
  reducers: {
    setDrivetrain(state, a: PayloadAction<string>) { state.drivetrain = a.payload; },
    setVerdict(state, a: PayloadAction<string>) { state.verdict = a.payload; },
    setQuery(state, a: PayloadAction<string>) { state.query = a.payload; },
  },
});
export const { setDrivetrain, setVerdict, setQuery } = catalogSlice.actions;
export default catalogSlice.reducer;
