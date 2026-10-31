import { useRef, useState } from 'react';
import { useCtx } from '../app/AuthProvider';
import { Alert, Badge, Button, Input, Loading, Modal, Table, useAction, useAsync, useConfirm } from './ui';
import { ACCEPT, MAX_BYTES, downloadFile, listFiles, removeFile, uploadFile } from '../lib/files';

// canUpload: may add files. canRemove(file): may remove a given file.
export default function FilePanel({ collection, ownerId, kind = 'DOCUMENT', canUpload, canRemove = () => canUpload }) {
  const { iid, uid } = useCtx();
  const { data, loading, error, reload } = useAsync(() => listFiles(iid, collection, ownerId), [iid, collection, ownerId]);
  const action = useAction();
  const confirm = useConfirm();
  const [uploading, setUploading] = useState(false);

  if (loading) return <Loading />;
  const upload = async (file, title) => {
    await uploadFile({ iid, uid, collection, ownerId, file, title, kind, existing: data });
    reload();
  };

  return (
    <div>
      <Alert kind="error">{error?.message || action.error}</Alert>
      {canUpload && <div className="row" style={{ marginBottom: 12 }}><Button variant="primary" onClick={() => setUploading(true)}>Upload file</Button></div>}
      <Table
        rows={data}
        empty="No files yet."
        columns={[
          { key: 'name', label: 'Title' },
          { key: 'size', label: 'Size', render: (d) => `${Math.max(1, Math.round(d.size / 1024))} KB` },
          { key: 'status', label: 'Status', render: (d) => <Badge kind={d.status === 'READY' ? 'ok' : 'warn'}>{d.status}</Badge> },
        ]}
        actions={(d) => (
          <>
            {d.status === 'READY' && (
              <Button small disabled={action.busy} onClick={() => action.run(() => downloadFile(iid, collection, ownerId, d))}>Download</Button>
            )}{' '}
            {canRemove(d) && (
              <Button small variant="danger" disabled={action.busy} onClick={() => confirm.ask(
                { title: `Remove ${d.name}?`, body: 'The file is deleted for good.', label: 'Remove' },
                () => action.run(async () => { await removeFile(iid, collection, ownerId, d); reload(); }),
              )}>Remove</Button>
            )}
          </>
        )}
      />
      {confirm.dialog}
      {uploading && <UploadModal onUpload={upload} onClose={() => setUploading(false)} />}
    </div>
  );
}

function UploadModal({ onUpload, onClose }) {
  const [title, setTitle] = useState('');
  const input = useRef();
  const { busy, error, run } = useAction();
  const submit = (e) => {
    e.preventDefault();
    const file = input.current.files[0];
    if (file) run(async () => { await onUpload(file, title.trim()); onClose(); });
  };
  return (
    <Modal title="Upload file" onClose={busy ? () => {} : onClose}>
      <form onSubmit={submit}>
        <Alert kind="error">{error}</Alert>
        <div className="form-grid">
          <Input label="Title" value={title} onChange={setTitle} hint="Shown in the list" />
          <label className="field">
            <span>File</span>
            <input type="file" accept={ACCEPT.join(',')} ref={input} required />
            <span className="hint">PDF, JPEG or PNG, up to {Math.round(MAX_BYTES / 1024)} KB. Big photos are shrunk for you.</span>
          </label>
        </div>
        <div className="row">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</Button>
        </div>
      </form>
    </Modal>
  );
}
