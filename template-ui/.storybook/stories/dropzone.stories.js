import '../../site/dropzone/dropzone.js';

export default {title: 'Template/Dropzone'};

export const Basic = () => {
    const root = document.createElement('div');
    root.innerHTML = `
    <div class="p-4 border border-dashed rounded-lg text-sm text-neutral-600">
      <relay-dropzone>
        <div class="p-6 min-h-[120px] flex items-center justify-center">
          Drag & drop files here to upload (demo only)
        </div>
      </relay-dropzone>
    </div>
  `;
    return root;
};
