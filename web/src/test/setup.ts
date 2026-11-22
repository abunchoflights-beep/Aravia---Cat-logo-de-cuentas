import { cleanup } from "@testing-library/react";
import { afterEach } from "vite-plus/test";

// Test globals are disabled, so Testing Library cannot register its automatic cleanup.
afterEach(() => {
  cleanup();
});
