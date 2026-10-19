/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        harmonica: {
          bg: "rgba(38, 32, 26, 0.85)",
          panel: "rgba(58, 49, 39, 0.78)",
          border: "rgba(212, 184, 140, 0.35)",
          gold: "#e5c896",
          active: "rgba(235, 215, 175, 0.45)",
        }
      }
    },
  },
  plugins: [],
}
