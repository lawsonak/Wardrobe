import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        blush: {
          50: "#fff5f7",
          100: "#ffe4ec",
          200: "#ffc6d5",
          300: "#ffa1bb",
          400: "#ff7aa0",
          500: "#f25c87",
          600: "#d6406b",
          700: "#a82c52",
          800: "#7d1e3c",
          900: "#561029",
        },
        cream: {
          50: "#fdfaf6",
          100: "#f8f1e7",
          200: "#efe1cc",
        },
        sage: {
          200: "#d6e2cf",
          400: "#8fb18a",
          600: "#5b8259",
        },
      },
      fontFamily: {
        display: ["Georgia", "serif"],
      },
      boxShadow: {
        card: "0 6px 24px -8px rgba(120, 50, 80, 0.18)",
      },
    },
  },
  plugins: [],
} satisfies Config;
