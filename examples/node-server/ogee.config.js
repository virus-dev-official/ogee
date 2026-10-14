import { defineConfig } from "@virusdev/ogee";

export default defineConfig({
  site: "https://example.com",
  name: "Example",
  description: "An example app with link previews",
  titleTemplate: "%s · Example",
  brand: {
    colors: { background: "#0b0b0f", foreground: "#f4f4f5", accent: "#e8590c" },
  },
  routes: {
    "/": { title: "Example" },
    "/pricing": { title: "Pricing", description: "Simple plans for everyone" },
  },
});
