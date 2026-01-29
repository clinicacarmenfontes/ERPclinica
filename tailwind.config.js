/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#B87C7C",     // Rosa Mauve
        secondary: "#546051",   // Verde Sage
        background: "#F1EFE7",  // Crema
        surface: "#FAEBE4",     // Rosa Pálido
        text: "#5B5F62",        // Gris Oscuro
        border: "#D1B7A1",      // Arena
      }
    },
  },
  plugins: [],
}