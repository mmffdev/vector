"use client";

import Widget from "@/app/store/shared/Widget";
import type { UiAppProps } from "@/app/store/shared/types";
import "./c_store_app_name.css";

export default function UiAppName({ appId }: UiAppProps) {
  return (
    <Widget title="App Name" className="ui-app-name">
      <p className="ui-app-name__placeholder">
        App body for {appId}.
      </p>
    </Widget>
  );
}
