

/** @type { import('@storybook/web-components-vite').StorybookConfig } */
const config = {
  // Only load JS/TS stories here. MDX pages can be added back selectively if
  // they are known to be compatible with the web-components renderer.
  stories: [
    "../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)"
  ],
  addons: [
    "@chromatic-com/storybook",
    "@storybook/addon-docs"
  ],
  staticDirs: [
    // Serve the template directory at the web root so /site/tailwind.css is available
    { from: "../template", to: "/" }
  ],
  framework: {
    name: "@storybook/web-components-vite",
    options: {}
  }
};
export default config;