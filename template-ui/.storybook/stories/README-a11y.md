Storybook accessibility helper

You can opt-in to a stricter accessibility check per story by calling the helper in your story's `play` function.

Example:

```js
// stories/MyComponent.stories.js
export const Primary = () => html`<my-component></my-component>`;
Primary.play = async ({ canvasElement }) => {
  // the preview will run axe automatically, but you can run it yourself too
  if (window.axe) {
    const results = await window.axe.run(canvasElement, { runOnly: { type: 'tag', values: ['wcag2aa'] } });
    if (results.violations.length) {
      console.error('A11y violations', results.violations);
    }
  }
};
```

The global preview script already injects `axe-core` and runs checks after each story render. For CI, use `pnpm test:a11y` which navigates stories and reads the `storybook:a11y` events dispatched by preview.
