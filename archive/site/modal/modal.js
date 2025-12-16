class Modal extends HTMLElement {
    constructor() {
        super();
        this._onBackdrop = this._onBackdrop.bind(this);
    }

    connectedCallback() {
        const title = this.getAttribute('title') || '';
        // Preserve existing children to move into modal body
        const frag = document.createDocumentFragment();
        while (this.firstChild) frag.appendChild(this.firstChild);
        this.innerHTML = `
      <div class="relay-modal-backdrop fixed inset-0 bg-black/40 hidden items-center justify-center z-[1000]" role="dialog" aria-modal="true">
        <div class="relay-modal-content bg-white text-black dark:text-white dark:bg-neutral-900 rounded-xl shadow-2xl w-[92vw] max-w-[720px] max-h-[86vh] overflow-auto transform transition-all duration-150">
          <header class="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-black/10 dark:border-white/10 bg-white dark:bg-neutral-900">
            <h3 class="m-0 text-base font-semibold">${title}</h3>
            <button class="relay-modal-close text-xl leading-none" title="Close" aria-label="Close">×</button>
          </header>
          <section class="p-4 relay-modal-body"></section>
        </div>
      </div>
    `;
        this._backdrop = this.querySelector('.relay-modal-backdrop');
        this._closeBtn = this.querySelector('.relay-modal-close');
        const body = this.querySelector('.relay-modal-body');
        if (body) body.appendChild(frag);
        this._backdrop?.addEventListener('click', this._onBackdrop);
        this._closeBtn?.addEventListener('click', () => this.close());
    }

    disconnectedCallback() {
        this._backdrop?.removeEventListener('click', this._onBackdrop);
    }

    _onBackdrop(e) {
        if (e.target === this._backdrop) this.close();
    }

    open() {
        this._backdrop?.classList.remove('hidden');
        // small enter animation
        const panel = this.querySelector('.relay-modal-content');
        if (panel) {
            panel.classList.add('translate-y-2', 'opacity-0');
            requestAnimationFrame(() => {
                panel.classList.remove('translate-y-2', 'opacity-0');
            });
        }
    }

    close() {
        this._backdrop?.classList.add('hidden');
    }
}

customElements.define('relay-modal', Modal);
