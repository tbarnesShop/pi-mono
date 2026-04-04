import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	root: "frontend",
	base: "/pi/",
	plugins: [tailwindcss()],
	build: {
		outDir: "../dist/public",
		emptyOutDir: true,
	},
});
