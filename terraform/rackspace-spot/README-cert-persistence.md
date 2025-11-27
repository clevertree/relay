Certificate persistence and backup

What changed

- The DaemonSet mounts two hostPath directories from the node into the container:
  - Host: /opt/relay/letsencrypt -> Container: /etc/letsencrypt
  - Host: /opt/relay/letsencrypt-var -> Container: /var/lib/letsencrypt
- An initContainer ensures these directories exist and sets ownership to UID/GID 1000 so certbot can write them.
- The entrypoint will use these directories for certbot and will only enable HTTPS when valid certs are present.

Backup and restore

- To back up certificates from a node:

```bash
# on the node (or via sudo on node):
tar -czf relay-letsencrypt-$(date +%F).tgz -C /opt/relay letsencrypt letsencrypt-var
# copy the tarball off-node for safekeeping
```

- To restore on a new node, stop the pod on that node, copy the tarball to the node, extract into /opt/relay, then restart the pod:

```bash
# on the node:
sudo tar -xzf relay-letsencrypt-YYYY-MM-DD.tgz -C /opt/relay
# ensure proper ownership
sudo chown -R 1000:1000 /opt/relay/letsencrypt /opt/relay/letsencrypt-var
```

Notes and recommendations

- hostPath is simple but ties cert storage to the node. If nodes are ephemeral or you run a multi-node cluster where pods may move, consider using:
  - A shared PersistentVolume (NFS, EFS, GCP/Azure disk with ReadWriteMany support), or
  - cert-manager to manage certificates centrally and provision them to Ingress/Secrets (recommended long-term).

- If you plan to switch to cert-manager, you can migrate existing certs by creating secrets from the files in /opt/relay/letsencrypt/live/<FQDN> and referencing them, or simply let cert-manager issue fresh certs.
