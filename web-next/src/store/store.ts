import { configureStore } from "@reduxjs/toolkit";
import catalogReducer from "./catalogSlice";
import forgeReducer from "./forgeSlice";

export const makeStore = () =>
  configureStore({ reducer: { catalog: catalogReducer, forge: forgeReducer } });

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
