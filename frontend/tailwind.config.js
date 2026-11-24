/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          purple: "#351044",
          purpleDark: "#240930",
          purpleSoft: "#4B1B5E",
          magenta: "#B81762",
          magentaDark: "#96114F",
          pink: "#F4CEE2",
          pinkBorder: "#E4A8C7",
        },
        sf: {
          bg: "#F8DCEB",
          surface: "#FDF2F8",
          text: "#24172A",
          muted: "#65556D",
          border: "#E6B8D1",
          success: "#16834A",
          warning: "#D97706",
          danger: "#DC2626",
        },
      },
      fontFamily: {
        sans: ["Inter", "Manrope", "system-ui", "-apple-system", "sans-serif"],
        display: ["Manrope", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(53, 16, 68, 0.06), 0 4px 12px rgba(53, 16, 68, 0.04)",
        elevated: "0 8px 24px rgba(53, 16, 68, 0.12)",
      },
    },
  },
  plugins: [],
};
