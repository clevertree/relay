// Storybook story for relay-modal (template UI)
import '../template/site/modal/modal.js';

export default {
  title: 'Template/Modal',
};

export const Basic = () => {
  const root = document.createElement('div');
  root.innerHTML = `
    <button id="open-modal" class="px-3 py-2 rounded-md border border-black/15 bg-blue-600 text-white">Open Modal</button>
    <relay-modal id="example-modal" title="Example Modal">
      <p class="text-sm text-neutral-700">This is a basic modal body rendered from the template UI.</p>
    </relay-modal>
  `;
  const btn = root.querySelector('#open-modal');
  const modal = root.querySelector('#example-modal');
  btn?.addEventListener('click', () => modal?.open());
  return root;
};
