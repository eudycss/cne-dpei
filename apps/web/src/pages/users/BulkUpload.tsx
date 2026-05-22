import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BulkUploadResult } from '@cne/shared-types';
import { api } from '../../lib/api';

export function BulkUpload() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BulkUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!file) {
      setError('Selecciona un archivo');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    setUploading(true);
    try {
      const res = await api.post<BulkUploadResult>('/users/bulk', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Error en la carga');
    } finally {
      setUploading(false);
    }
  }

  async function downloadTemplate() {
    const res = await api.get('/users/template.xlsx', { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla_usuarios.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <h2>Carga masiva de usuarios</h2>
      <form className="card" onSubmit={onSubmit} style={{ maxWidth: 720 }}>
        <p className="muted">
          Sube un archivo <strong>.xlsx</strong> o <strong>.csv</strong> con las columnas:{' '}
          <code>cedula, email, nombres, apellidos, telefono</code>.
        </p>
        <button type="button" className="btn secondary" onClick={downloadTemplate}>
          Descargar plantilla
        </button>
        <div className="field" style={{ marginTop: '1rem' }}>
          <label>Archivo</label>
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        {error && <div className="banner error">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn secondary" onClick={() => navigate('/users')}>
            Volver
          </button>
          <button className="btn" type="submit" disabled={uploading}>
            {uploading ? 'Procesando…' : 'Cargar'}
          </button>
        </div>
      </form>

      {result && (
        <div className="card">
          <h3>Resultado</h3>
          <p>
            ✅ Creados: <strong>{result.creados}</strong> ·{' '}
            ❌ Errores: <strong>{result.errores.length}</strong>
          </p>
          {result.errores.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Error</th>
                  <th>Datos</th>
                </tr>
              </thead>
              <tbody>
                {result.errores.map((e) => (
                  <tr key={`${e.fila}-${e.error}`}>
                    <td>{e.fila}</td>
                    <td>{e.error}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {JSON.stringify(e.datos)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
