export default {
  title: 'Template/Desktop',
};

export const Desktop = () => {
  const iframe = document.createElement('iframe');
  iframe.src = '/.storybook/story-desktop.html';
  iframe.style.width = '100%';
  iframe.style.height = '800px';
  iframe.style.border = '0';
  return iframe;
};
