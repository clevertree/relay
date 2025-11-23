export default {
  title: 'Template/Mobile',
};

export const Mobile = () => {
  const iframe = document.createElement('iframe');
  iframe.src = '/.storybook/story-mobile.html';
  iframe.style.width = '100%';
  iframe.style.height = '700px';
  iframe.style.border = '0';
  iframe.style.maxWidth = '420px';
  iframe.style.margin = 'auto';
  iframe.style.display = 'block';
  return iframe;
};
