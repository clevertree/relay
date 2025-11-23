

/** @type { import('@storybook/web-components-vite').StorybookConfig } */
const config = {
  stories: [
    "../stories/**/*.mdx",
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