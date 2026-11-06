import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App.jsx";

// The Modeler Editor renders its own dark, Roboto-based styling inline (design
// tokens in theme.js), replicated from the Meanings design mockup. No MUI theme
// wrapper is needed — styles.css sets the global dark color-scheme and font.
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
