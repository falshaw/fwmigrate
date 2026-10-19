import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#f97316",
          primary: "#f97316",
          light: "#fb923c",
          dark: "#ea580c",
          darker: "#c2410c",
        },
        purple: {
          DEFAULT: "#7c3aed",
          light: "#a78bfa",
          dark: "#6d28d9",
          darker: "#5b21b6",
        },
        navy: {
          DEFAULT: "#0a1628",
          dark: "#0a1628",
          mid: "#0d1e36",
          light: "#132743",
        },
        status: {
          success: "#10b981",
          warning: "#f59e0b",
          error: "#ef4444",
          info: "#06b6d4",
        },
      },
      backgroundImage: {
        "hero-gradient":
          "linear-gradient(135deg, #0a1628 0%, #0d1e36 50%, #132743 100%)",
        "brand-gradient": "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
        "brand-gradient-hover":
          "linear-gradient(135deg, #ea580c 0%, #c2410c 100%)",
      },
      boxShadow: {
        brand: "0 8px 24px rgba(249, 115, 22, 0.3)",
        "brand-lg": "0 12px 32px rgba(249, 115, 22, 0.4)",
        "brand-glow": "0 20px 60px rgba(249, 115, 22, 0.15)",
      },
      borderRadius: {
        lg: "8px",
        xl: "12px",
        "2xl": "16px",
        "3xl": "24px",
        card: "16px",
        button: "8px",
        input: "8px",
      },
    },
  },
  plugins: [],
};

export default config;
