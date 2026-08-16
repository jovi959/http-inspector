import "@/styles/tokens.css";
import "@/styles/app.css";
import "@/styles/inspector.css";
import "@/styles/project-integrations.css";

import { bootstrap } from "@/app/bootstrap";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("HTTP Inspector root element is missing.");

// Startup stays deliberately thin; the app bootstrap owns dependency composition.
bootstrap(rootElement);
