import { useRef, useState } from 'react';
import { useCtx } from '../app/AuthProvider';
import { Alert, Badge, Button, Input, Loading, Table, useAction, useAsync } from './ui';
import { ACCEPT, KINDS, downloadFile, listFiles, removeFile, uploadFile } from '../lib/files';

// canUpload: may add files. canRemove(file): may remove a given file.
export default function FilePanel({ collection, ownerId, kind = 'DOCUMENT', canUpload, canRemove = () => canUpload }) {
  const { iid, uid } = useCtx();
  const { data, loading, error, reload } = useAsync(() => listFiles(iid, collection, ownerId), [iid, collection, ownerId]);
  const action = useAction();
  const [title, setTitle] = useState('');
  const input = useRef();
  const max = KINDS[collection].max / 1048576;

  if (loading) return <Loading />;
  const upload = (e) => {
    e.preventDefault();
    const file = input.current.files[0];
    if (!file) return;
    action.run(async () => {
      await uploadFile({ iid, uid, collection, ownerId, file, title: title.trim(), kind, existing: data });
      setTitle('');
      input.current.value = '';
      reload();
    }, 'Uploaded.');
  };

  return (
    <div>
      <Alert kind="error">{error?.message || action.error}</Alert>
      <Alert kind="ok">{action.done}</Alert>
      {canUpload && (
        <form className="row" onSubmit={upload} style={{ marginBottom: 12 }}>
          <Input label="Title" value={title} onChange={setTitle} hint="Shown in the list" />
          <label className="field">
            <span>File (PDF, JPEG or PNG, up to {max} MB)</span>
            <input type="file" accept={ACCEPT.join(',')} ref={input} required />
          </label>
          <Button variant="primary" type="submit" disabled={action.busy}>{action.busy ? 'Uploading…' : 'Upload'}</Button>
        </form>
      )}
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
              <Button small variant="danger" disabled={action.busy} onClick={() => action.run(async () => { await removeFile(iid, collection, ownerId, d); reload(); })}>Remove</Button>
            )}
          </>
        )}
      />
    </div>
  );
}
