import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      fontFamily: {
        sans: ["Inter", "Geist", "system-ui", "-apple-system", "sans-serif"],
      },
      animation: {
        "spin-slow": "spin 3s linear infinite",
        "pulse-dot": "pulse 1.4s ease-in-out infinite",
        "slide-in": "slideInLeft 0.35s cubic-bezier(0.16,1,0.3,1) both",
        "fade-up": "fadeInUp 0.5s cubic-bezier(0.16,1,0.3,1) both",
        "gradient-shift": "gradient-shift 4s ease infinite",
      },
      keyframes: {
        slideInLeft: {
          from: { opacity: "0", transform: "translateX(-12px)" },
          to:   { opacity: "1", transform: "translateX(0)"     },
        },
        fadeInUp: {
          from: { opacity: "0", transform: "translateY(16px)" },
          to:   { opacity: "1", transform: "translateY(0)"    },
        },
        "gradient-shift": {
          "0%, 100%": { backgroundPosition: "0% 50%"   },
          "50%":       { backgroundPosition: "100% 50%" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
