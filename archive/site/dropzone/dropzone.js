export class RelayDropzone extends HTMLElement {
    constructor() {
        super();
        this._onDragOver = this._onDragOver.bind(this);
        this._onDragLeave = this._onDragLeave.bind(this);
        this._onDrop = this._onDrop.bind(this);
    }

    connectedCallback() {
        // Styling hint; use globals
        this.style.position ||= 'relative';
        this.classList.add('block');
        this.addEventListener('dragover', this._onDragOver);
        this.addEventListener('dragleave', this._onDragLeave);
        this.addEventListener('dragend', this._onDragLeave);
        this.addEventListener('drop', this._onDrop);
    }

    disconnectedCallback() {
        this.removeEventListener('dragover', this._onDragOver);
        this.removeEventListener('dragleave', this._onDragLeave);
        this.removeEventListener('dragend', this._onDragLeave);
        this.removeEventListener('drop', this._onDrop);
    }

    _onDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        this.classList.add('relay-dragover');
        // Class-based highlight
        this.classList.add('ring-4','ring-blue-500/30','outline-dashed','bg-blue-50','shadow-xl','scale-[1.01]','transition');
    }

    _onDragLeave() {
        this.classList.remove('relay-dragover');
        this.classList.remove('ring-4','ring-blue-500/30','outline-dashed','bg-blue-50','shadow-xl','scale-[1.01]','transition');
    }

    async _onDrop(e) {
        e.preventDefault();
        this.classList.remove('relay-dragover');
        const files = Array.from(e.dataTransfer?.files || []);
        if (!files.length) return;

        const branch = document.querySelector('meta[name="relay-branch"]')?.content || 'main';

        // Determine target base path: if current path ends with '/', use it; else use dirname
        const pathname = window.location.pathname;
        const isDir = pathname.endsWith('/');
        const base = isDir ? pathname : pathname.replace(/[^\/]*$/, '');

        for (const file of files) {
            try {
                const targetPath = base + encodeURIComponent(file.name);
                await this._uploadFile(targetPath, file, branch);
                this._flash(`Uploaded ${file.name}`);
            } catch (err) {
                console.error(err);
                this._flash(`Failed ${file.name}: ${err?.message || err}`, true);
            }
        }
    }

    async _uploadFile(targetPath, file, branch) {
        const url = `${targetPath}?branch=${encodeURIComponent(branch)}`;
        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'X-Relay-Branch': branch,
            },
            body: file,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(text || `HTTP ${res.status}`);
        }
        return res.json().catch(() => ({}));
    }

    _flash(message, isError = false) {
        let toast = document.createElement('div');
        toast.textContent = message;
        toast.style.position = 'fixed';
        toast.style.right = '16px';
        toast.style.bottom = '16px';
        toast.style.padding = '8px 12px';
        toast.style.borderRadius = '6px';
        toast.style.zIndex = '2147483647';
        toast.style.font = '14px system-ui, sans-serif';
        toast.style.color = isError ? '#fff' : '#0a3622';
        toast.style.background = isError ? '#dc3545' : '#d1e7dd';
        toast.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.transition = 'opacity 300ms';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 350);
        }, 1800);
    }
}

// Update document

customElements.define('relay-dropzone', RelayDropzone);