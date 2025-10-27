module.exports = {
  content: ["./src/**/*.{svelte,js,ts,html}"],
  safelist: [
    "[perspective:1000px]",
    "[transform-style:preserve-3d]",
    "[transform:rotateY(180deg)]",
    "[-webkit-backface-visibility:hidden]",
    "[backface-visibility:hidden]",
  ],
  theme: { extend: {} },
  plugins: [],
};
