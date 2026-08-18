import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App.tsx";

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found");

createRoot(container).render(<App />);
