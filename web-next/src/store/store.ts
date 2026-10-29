import { configureStore } from "@reduxjs/toolkit";
import catalogReducer from "./catalogSlice";
import workspaceReducer from "./workspaceSlice";
import forgeReducer from "./forgeSlice";

export const makeStore = () =>
  configureStore({ reducer: { catalog: catalogReducer, forge: forgeReducer, workspace: workspaceReducer } });

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
